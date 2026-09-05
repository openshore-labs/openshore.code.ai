// Sessions and drivers. A SessionDriver is the one interface every renderer
// (Ink TUI, plain, remote attach) speaks; the LocalDriver wraps a live
// AgentSession and journals every event to ~/.os-code/sessions/<id>/ so a
// dropped phone connection reattaches to the in-flight run with nothing lost.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { oscHome } from '../config/load.js';
import type { AgentSession } from '../core/agent/loop.js';
import type { ApprovalAnswer, ApprovalRequest, DriverEvent } from '../core/agent/types.js';
import { redactSecrets } from '../core/security/redaction.js';
import { isSealed, loadOrCreateDataKey, openString, sealString } from '../core/security/atRest.js';
import { runCommand as spawnCommand, type CommandRun } from '../core/exec/commandRunner.js';
import { capContent } from '../core/tools/index.js';
import { walkFiles } from '../core/tools/walk.js';
import { relative } from 'node:path';
import { simpleGit } from 'simple-git';
import type { PermissionMode } from '../core/agent/types.js';

// DriverEvent lives in core/agent/types.ts (pure, browser-safe) so the app's
// remote driver can share the exact protocol type; re-exported here so
// existing engine imports keep working.
export type { DriverEvent } from '../core/agent/types.js';

export interface SessionDriver {
  readonly id: string;
  readonly cwd: string;
  /** Queue a user message; tasks run one at a time in arrival order. */
  send(text: string, images?: Array<{ base64: string; mediaType: string }>): void;
  abort(): void;
  subscribe(sink: (event: DriverEvent, seq: number) => void, sinceSeq?: number): () => void;
  answerApproval(id: string, answer: ApprovalAnswer): void;
  describeModel(): { model: string; kind: 'local' | 'cloud' };
  readonly busy: boolean;
}

export function sessionsDir(): string {
  return join(oscHome(), 'sessions');
}

export interface SessionInfo {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The user who created this session. Recorded by the daemon so ownership can
   * be enforced across a rehydrate (a member may only drive their own sessions,
   * D1). Absent on legacy sessions created before ownership was tracked.
   */
  ownerUserId?: string;
}

// The session title is derived from the user's first prompt, so it is user
// content and seals like the journal. Timestamps, ids, and cwd stay plain:
// they order and locate sessions and carry no content.
function openTitle(title: string): string {
  if (!isSealed(title)) return title;
  const dk = loadOrCreateDataKey();
  return (dk && openString(dk.key, title)) || 'Sealed session';
}

function sealTitle(title: string): string {
  const dk = loadOrCreateDataKey();
  return dk ? sealString(dk.key, title) : title;
}

/**
 * info.json is written through a temp file and a rename (DAE-6), so a crash
 * mid-write never leaves a torn file that hides the whole session. Every
 * in-process write also drops the cached index below.
 */
function writeInfoAtomic(path: string, info: SessionInfo): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(info, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  invalidateSessionIndex();
}

// The session index (DAE-12): listSessions used to re-read and re-open every
// info.json on every call, and the daemon calls it on every listing, every
// rehydrate, and every workspace scan. The parsed list is cached per sessions
// dir; any in-process write invalidates it, and two cheap checks catch other
// writers (the CLI's own sessions): the dir mtime moves on a create or delete,
// and a short TTL bounds how stale a title or updatedAt can be.
interface SessionIndex {
  dir: string;
  dirMtimeMs: number;
  readAt: number;
  entries: SessionInfo[];
}
const INDEX_TTL_MS = 5_000;
let sessionIndex: SessionIndex | undefined;

export function invalidateSessionIndex(): void {
  sessionIndex = undefined;
}

// Session ids are short hex; a path-shaped id must never reach rmSync (DAE-12).
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Remove a stored session (its journal and info) from disk. */
export function deleteSession(id: string): boolean {
  if (!SAFE_SESSION_ID.test(id)) return false;
  const dir = join(sessionsDir(), id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  invalidateSessionIndex();
  return true;
}

export function listSessions(): SessionInfo[] {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  let dirMtimeMs = 0;
  try {
    dirMtimeMs = statSync(dir).mtimeMs;
  } catch {}
  const now = Date.now();
  if (
    sessionIndex &&
    sessionIndex.dir === dir &&
    sessionIndex.dirMtimeMs === dirMtimeMs &&
    now - sessionIndex.readAt < INDEX_TTL_MS
  ) {
    return sessionIndex.entries.map((e) => ({ ...e }));
  }
  const out: SessionInfo[] = [];
  for (const id of readdirSync(dir)) {
    const info = readSessionInfo(dir, id);
    if (info) out.push(info);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  sessionIndex = { dir, dirMtimeMs, readAt: now, entries: out };
  return out.map((e) => ({ ...e }));
}

function readSessionInfo(dir: string, id: string): SessionInfo | undefined {
  try {
    const info = JSON.parse(readFileSync(join(dir, id, 'info.json'), 'utf8')) as SessionInfo;
    if (!info || typeof info.cwd !== 'string') return repairSessionInfo(dir, id);
    info.title = openTitle(info.title);
    return info;
  } catch {
    return repairSessionInfo(dir, id);
  }
}

/**
 * A torn or missing info.json next to a valid journal (DAE-6): rebuild the
 * info from the journal instead of hiding the session. The first repo-info
 * event carries the cwd; the first task-start (or the last title) gives the
 * title; the file times stand in for the stamps. The owner cannot be
 * recovered, so the repaired session is admin-only until it is re-owned. The
 * repair is written back atomically so the next list is a plain read.
 */
function repairSessionInfo(dir: string, id: string): SessionInfo | undefined {
  const journalPath = join(dir, id, 'events.jsonl');
  if (!SAFE_SESSION_ID.test(id) || !existsSync(journalPath)) return undefined;
  try {
    const raw = readFileSync(journalPath, 'utf8');
    const dk = loadOrCreateDataKey();
    let cwd: string | undefined;
    let title: string | undefined;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const clear = isSealed(line) ? (dk ? openString(dk.key, line) : null) : line;
      if (!clear) continue;
      let event: DriverEvent | undefined;
      try {
        event = (JSON.parse(clear) as { event?: DriverEvent }).event;
      } catch {
        continue;
      }
      if (!event) continue;
      if (event.type === 'repo-info' && !cwd) cwd = event.cwd;
      if (event.type === 'task-start' && !title) title = event.input.slice(0, 60);
      if (event.type === 'title') title = event.title;
    }
    if (!cwd) return undefined;
    const st = statSync(journalPath);
    const info: SessionInfo = {
      id,
      cwd,
      title: title ?? `Session ${id}`,
      createdAt: new Date(st.birthtimeMs || st.mtimeMs).toISOString(),
      updatedAt: new Date(st.mtimeMs).toISOString(),
    };
    writeInfoAtomic(join(dir, id, 'info.json'), { ...info, title: sealTitle(info.title) });
    return info;
  } catch {
    return undefined;
  }
}

// The events that move info.json (title, updatedAt): task boundaries, a
// generated title, and the content-free terminal markers.
const INFO_MILESTONES = new Set<DriverEvent['type']>([
  'task-start',
  'task-done',
  'title',
  'terminal-opened',
  'terminal-closed',
]);

/**
 * LocalDriver: owns one AgentSession, an event journal, and the approval
 * hand-off between the loop (which awaits) and whichever UI is attached.
 */
export class LocalDriver implements SessionDriver {
  readonly id: string;
  private events: Array<{ seq: number; event: DriverEvent }> = [];
  private seq = 0;
  private sinks = new Set<(event: DriverEvent, seq: number) => void>();
  // The subset of sinks that are attached clients (subscribe), as opposed to
  // the daemon's own observers (onEvent, the push watcher): eviction counts
  // only clients (DAE-12).
  private viewers = new Set<(event: DriverEvent, seq: number) => void>();
  /** Last moment a client touched this driver, for idle eviction. */
  lastActivityAt = Date.now();
  private pendingApprovals = new Map<string, (answer: ApprovalAnswer) => void>();
  private queue: Array<{ text: string; images?: Array<{ base64: string; mediaType: string }> }> =
    [];
  private running = false;
  private agent?: AgentSession;
  private persist: boolean;
  private ownerUserId?: string;
  private ensuredTrailingNewline = false;
  // The user-initiated command lane: live runs keyed by runId, and a queue of
  // framed results the model reads on its next turn (so it sees command
  // outcomes without a screenshot).
  private commands = new Map<string, CommandRun>();
  private pendingTerminalContext: string[] = [];
  // Set once the first completed exchange has been titled, so the cheap title
  // call runs once per session, never per turn.
  private titled = false;

  constructor(
    readonly cwd: string,
    options: { id?: string; persist?: boolean } = {},
  ) {
    this.id = options.id ?? randomUUID().slice(0, 8);
    this.persist = options.persist ?? true;
    if (this.persist) {
      const dir = this.dir();
      mkdirSync(dir, { recursive: true });
      const infoPath = join(dir, 'info.json');
      const info: SessionInfo = {
        id: this.id,
        cwd,
        title: `Session ${this.id}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!existsSync(infoPath)) {
        writeInfoAtomic(infoPath, info);
      } else {
        // Rehydrating a stored session: carry its recorded owner forward so the
        // daemon can enforce ownership after a restart (D1).
        try {
          const existing = JSON.parse(readFileSync(infoPath, 'utf8')) as SessionInfo;
          this.ownerUserId = existing.ownerUserId;
        } catch {}
      }
      this.loadJournal();
    }
  }

  /** The user who owns this session, if one was recorded. */
  get owner(): string | undefined {
    return this.ownerUserId;
  }

  /** Record the owning user and persist it to info.json. */
  setOwner(userId: string): void {
    this.ownerUserId = userId;
    if (!this.persist) return;
    try {
      const infoPath = join(this.dir(), 'info.json');
      const info = JSON.parse(readFileSync(infoPath, 'utf8')) as SessionInfo;
      info.ownerUserId = userId;
      writeInfoAtomic(infoPath, info);
    } catch {}
  }

  /** Attached clients (not the daemon's own observers). */
  get viewerCount(): number {
    return this.viewers.size;
  }

  /**
   * True when dropping this driver from memory loses nothing: it is stored on
   * disk (rehydratable), no task is running or queued, no command is live, no
   * approval is pending, and no client is attached (DAE-12).
   */
  get evictable(): boolean {
    return (
      this.persist &&
      !this.running &&
      this.queue.length === 0 &&
      this.commands.size === 0 &&
      this.pendingApprovals.size === 0 &&
      this.viewers.size === 0
    );
  }

  /** Release what an evicted driver holds: its listeners and its in-memory
   *  journal copy. The journal on disk is the source of truth from here. */
  dispose(): void {
    this.sinks.clear();
    this.viewers.clear();
    this.events = [];
  }

  /** The agent is attached after construction so the deps can reference the driver's approver. */
  attachAgent(agent: AgentSession): void {
    this.agent = agent;
  }

  /** The journaled events, in order (used to seed history on rehydrate). */
  replayEvents(): DriverEvent[] {
    return this.events.map((e) => e.event);
  }

  get busy(): boolean {
    return this.running;
  }

  /** No task running and none queued: safe to treat a just-finished run as a
   *  true idle completion rather than a pause between batched messages. */
  get idle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  /**
   * Subscribe to LIVE events only, with no journal replay (unlike subscribe,
   * which replays history first). The push notifier uses this so reattaching or
   * rehydrating a driver never re-fires old approvals or completions.
   */
  onEvent(listener: (event: DriverEvent, seq: number) => void): () => void {
    this.sinks.add(listener);
    return () => this.sinks.delete(listener);
  }

  private dir(): string {
    return join(sessionsDir(), this.id);
  }

  private loadJournal(): void {
    try {
      const raw = readFileSync(join(this.dir(), 'events.jsonl'), 'utf8');
      const dk = loadOrCreateDataKey();
      let skippedSealed = 0;
      let lineCount = 0;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        lineCount += 1;
        // Sealed lines open with the data key; plaintext (pre-encryption)
        // lines pass through. A line that cannot be opened or parsed is
        // skipped, never fatal: a journal must always replay as far as it can.
        const clear = isSealed(line) ? (dk ? openString(dk.key, line) : null) : line;
        if (clear === null) {
          skippedSealed += 1;
          continue;
        }
        try {
          const parsed = JSON.parse(clear) as { seq: number; event: DriverEvent };
          this.events.push(parsed);
          this.seq = Math.max(this.seq, parsed.seq);
        } catch {}
      }
      // Advance seq past EVERY journaled line, not just the ones we could open
      // (B2). Seqs are contiguous 1..N, so the line count is the high-water
      // mark; deriving seq only from openable lines would let a reload without
      // the key re-issue 1,2,3 on top of existing sealed 1..N and corrupt
      // resume ordering.
      this.seq = Math.max(this.seq, lineCount);
      if (skippedSealed > 0) {
        // Surface masked history rather than letting it vanish silently: a
        // sealed line that will not open usually means the data key changed.
        console.warn(
          `[os-code] session ${this.id}: ${skippedSealed} sealed journal ${skippedSealed === 1 ? 'line' : 'lines'} could not be opened and ${skippedSealed === 1 ? 'was' : 'were'} skipped.`,
        );
      }
    } catch {}
  }

  /**
   * Before the first append of this run, guarantee the journal ends with a
   * newline. A crash mid-append can leave a final line with no trailing `\n`;
   * appending onto it would merge the truncated line and the new event into one
   * unparseable line, losing both (P2-6). Runs at most once per driver.
   */
  private ensureTrailingNewline(journalPath: string): void {
    if (this.ensuredTrailingNewline) return;
    this.ensuredTrailingNewline = true;
    try {
      if (!existsSync(journalPath)) return;
      const buf = readFileSync(journalPath);
      if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) {
        appendFileSync(journalPath, '\n');
      }
    } catch {}
  }

  emit(event: DriverEvent): void {
    const seq = ++this.seq;
    const entry = { seq, event };
    this.events.push(entry);
    if (this.persist) {
      try {
        // Redact first, then seal: even if the key is ever compromised, the
        // journal never held a raw secret. No key (store failure) degrades to
        // plaintext rather than losing the event.
        const dk = loadOrCreateDataKey();
        const line = redactSecrets(JSON.stringify(entry));
        const journalPath = join(this.dir(), 'events.jsonl');
        this.ensureTrailingNewline(journalPath);
        appendFileSync(journalPath, `${dk ? sealString(dk.key, line) : line}\n`);
        // info.json moves only on milestones, never per text delta (DAE-6):
        // it carries a title and a stamp, and rewriting it per token was a
        // torn-file race on every crash.
        if (INFO_MILESTONES.has(event.type)) {
          const infoPath = join(this.dir(), 'info.json');
          const info = JSON.parse(readFileSync(infoPath, 'utf8')) as SessionInfo;
          info.updatedAt = new Date().toISOString();
          if (event.type === 'task-start' && !this.titled) {
            // The title is the user's own words until a generated one lands;
            // it seals like the journal.
            info.title = sealTitle(event.input.slice(0, 60));
          }
          if (event.type === 'title') {
            this.titled = true;
            info.title = sealTitle(event.title);
          }
          writeInfoAtomic(infoPath, info);
        }
      } catch {}
    }
    for (const sink of this.sinks) sink(event, seq);
  }

  /** The Approver the AgentSession deps should use. */
  approver = (request: ApprovalRequest): Promise<ApprovalAnswer> => {
    return new Promise((resolve) => {
      this.pendingApprovals.set(request.id, (answer) => {
        this.emit({ type: 'approval-resolved', id: request.id, approved: answer.approve });
        resolve(answer);
      });
      this.emit({ type: 'approval-request', request });
    });
  };

  answerApproval(id: string, answer: ApprovalAnswer): void {
    this.lastActivityAt = Date.now();
    const resolve = this.pendingApprovals.get(id);
    if (resolve) {
      this.pendingApprovals.delete(id);
      resolve(answer);
    }
  }

  send(text: string, images?: Array<{ base64: string; mediaType: string }>): void {
    this.lastActivityAt = Date.now();
    this.queue.push({ text, images });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running || !this.agent) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    const preamble = this.drainTerminalContext();
    let completed = false;
    try {
      await this.emitRepoInfo();
      await this.agent.run(next.text, next.images, preamble);
      completed = this.lastTaskCompleted();
    } catch (err) {
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running = false;
      // The bookend: the branch may have moved and files may now be dirty.
      void this.emitRepoInfo();
      // One generated title per session, after the first completed exchange.
      if (completed && !this.titled && this.queue.length === 0) {
        this.titled = true;
        void this.agent.generateTitle().then((title) => {
          if (title) this.emit({ type: 'title', title });
        });
      }
      if (this.queue.length) void this.pump();
    }
  }

  private lastTaskCompleted(): boolean {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]!.event;
      if (e.type === 'task-done') return e.reason === 'complete';
    }
    return false;
  }

  /** Where this session works and the branch it is on, for the chat's chip.
   *  Best effort: a non-repo cwd reports only the cwd. */
  async emitRepoInfo(): Promise<void> {
    try {
      const git = simpleGit(this.cwd);
      if (!(await git.checkIsRepo())) {
        this.emit({ type: 'repo-info', cwd: this.cwd });
        return;
      }
      const status = await git.status();
      this.emit({
        type: 'repo-info',
        cwd: this.cwd,
        branch: status.current ?? undefined,
        dirty: !status.isClean(),
      });
    } catch {
      this.emit({ type: 'repo-info', cwd: this.cwd });
    }
  }

  // ---- the person's controls over the agent (mode, instructions, compact) ---

  setMode(mode: PermissionMode): void {
    this.agent?.setMode(mode);
  }

  get mode(): PermissionMode {
    return this.agent?.permissionMode ?? 'default';
  }

  setInstructions(text: string | undefined): void {
    this.agent?.setInstructions(text);
  }

  /** Manual compaction (/compact). Refused mid-task; the loop compacts itself. */
  async compact(focus?: string): Promise<{ before: number; after: number } | { error: string }> {
    if (!this.agent) return { error: 'No agent on this session.' };
    if (this.running) return { error: 'Wait for the current step to finish, then compact.' };
    return this.agent.compactNow(focus);
  }

  /**
   * Workspace files for the composer's @ mentions: paths under the workspace
   * root ranked by a case-insensitive subsequence match on the query, best
   * first. Metadata only (paths), capped, never contents.
   */
  listFiles(query: string, limit = 25): string[] {
    const q = query.trim().toLowerCase();
    const scored: Array<{ path: string; score: number }> = [];
    for (const abs of walkFiles(this.cwd, 20_000)) {
      const rel = relative(this.cwd, abs).split('\\').join('/');
      const score = q ? fuzzyScore(rel.toLowerCase(), q) : rel.length;
      if (score === Infinity) continue;
      scored.push({ path: rel, score });
    }
    scored.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
    return scored.slice(0, limit).map((s) => s.path);
  }

  // ---- user-initiated command lane (chat-to-terminal bridge) --------------
  // The journaled/emitted output per run is capped so a reattaching phone
  // rebuilds the card cheaply; the model still gets a fuller (capContent) tail.
  private static readonly COMMAND_EMIT_CAP = 64 * 1024;
  private static readonly MAX_PENDING_CONTEXT = 16;

  /**
   * Run a command the user asked for (not the agent). Streams output as
   * command-* events, records the result for the model's next turn, and
   * returns the runId the caller drives (stdin, kill). The authenticated
   * owner's tap IS the approval; this raises no model approval.
   */
  runCommand(command: string, opts: { source?: 'user' | 'agent' } = {}): { runId: string } {
    this.lastActivityAt = Date.now();
    const runId = randomUUID().slice(0, 8);
    const source = opts.source ?? 'user';
    const startedAt = Date.now();
    this.emit({ type: 'command-start', runId, command, cwd: this.cwd, source });

    let emitted = 0;
    let truncated = false;
    const run = spawnCommand({
      command,
      cwd: this.cwd,
      stdin: 'pipe',
      onChunk: (stream, text) => {
        if (emitted >= LocalDriver.COMMAND_EMIT_CAP) {
          truncated = true;
          return;
        }
        let chunk = text;
        if (emitted + chunk.length > LocalDriver.COMMAND_EMIT_CAP) {
          chunk = chunk.slice(0, LocalDriver.COMMAND_EMIT_CAP - emitted);
          truncated = true;
        }
        emitted += chunk.length;
        this.emit({ type: 'command-output', runId, chunk, stream });
      },
    });
    this.commands.set(runId, run);

    void run.done.then((result) => {
      this.commands.delete(runId);
      const durationMs = Date.now() - startedAt;
      this.emit({
        type: 'command-end',
        runId,
        exitCode: result.exitCode,
        signal: result.signal ?? undefined,
        durationMs,
        truncated: truncated || result.timedOut,
      });
      // Frame the result for the model's next turn (drained in pump). Output is
      // already secret-redacted by the runner; cap the tail for context.
      const combined = [result.stdout, result.stderr].filter((s) => s.trim()).join('\n');
      const exitNote = result.startError
        ? `failed to start: ${result.startError}`
        : result.timedOut
          ? 'timed out and was killed'
          : `exit ${result.exitCode}`;
      this.pendingTerminalContext.push(
        `[terminal] the user ran \`${command}\` in ${this.cwd} (${exitNote}, ${(durationMs / 1000).toFixed(1)}s):\n${capContent(combined, 8000)}`,
      );
      if (this.pendingTerminalContext.length > LocalDriver.MAX_PENDING_CONTEXT) {
        this.pendingTerminalContext.shift();
      }
    });

    return { runId };
  }

  /** Feed stdin to a running command (answers a prompt). */
  writeCommandStdin(runId: string, data: string): boolean {
    const run = this.commands.get(runId);
    if (!run) return false;
    run.write(data);
    return true;
  }

  /** Ask a running command to stop. */
  killCommand(runId: string): boolean {
    const run = this.commands.get(runId);
    if (!run) return false;
    run.kill();
    return true;
  }

  private drainTerminalContext(): string | undefined {
    if (!this.pendingTerminalContext.length) return undefined;
    const joined = this.pendingTerminalContext.join('\n\n');
    this.pendingTerminalContext = [];
    return joined;
  }

  abort(): void {
    this.queue = [];
    // Settle every outstanding approval as declined before aborting the agent.
    // A run parked on the approver promise would otherwise never resume after
    // an abort (the session wedges), and a later approve would execute the tool
    // the user already aborted (C1). Snapshot first: the resolver emits and
    // deletes, so iterate a copy.
    const pending = [...this.pendingApprovals.values()];
    this.pendingApprovals.clear();
    for (const resolve of pending) resolve({ approve: false });
    this.agent?.abort();
  }

  subscribe(sink: (event: DriverEvent, seq: number) => void, sinceSeq = 0): () => void {
    this.lastActivityAt = Date.now();
    for (const entry of this.events) {
      if (entry.seq > sinceSeq) sink(entry.event, entry.seq);
    }
    this.sinks.add(sink);
    this.viewers.add(sink);
    return () => {
      this.lastActivityAt = Date.now();
      this.sinks.delete(sink);
      this.viewers.delete(sink);
    };
  }

  describeModel(): { model: string; kind: 'local' | 'cloud' } {
    return this.agent?.activeModel ?? { model: '(not started)', kind: 'local' };
  }

  /** Outstanding approval requests (a reattaching client needs these). */
  pendingApprovalIds(): string[] {
    return [...this.pendingApprovals.keys()];
  }
}

/** Lower is better: a subsequence match scored by span and start, Infinity
 *  when the query is not a subsequence of the path. Basename hits win. */
function fuzzyScore(path: string, q: string): number {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base.includes(q)) return base.indexOf(q) + (path.length - base.length) * 0.01;
  if (path.includes(q)) return 100 + path.indexOf(q);
  let i = 0;
  let first = -1;
  for (let j = 0; j < path.length && i < q.length; j++) {
    if (path[j] === q[i]) {
      if (first === -1) first = j;
      i += 1;
    }
  }
  if (i < q.length) return Infinity;
  return 1000 + first + path.length;
}

/**
 * One-shot at-rest migration, run at engine startup: any plaintext journal
 * line or session title that predates encryption is resealed in place. Each
 * file is rewritten atomically (tmp then rename) and already-sealed lines are
 * left byte-identical, so the pass is idempotent and a crash mid-run loses
 * nothing. Per-session failures are tolerated: one unreadable session must
 * never block the engine from starting.
 *
 * skipNewerThanMs guards against clobbering a journal another process is
 * appending to right now (read, rewrite, rename would drop the line that
 * landed in the window): a file touched more recently than the guard is left
 * for the next pass. The startup hooks pass a minute; tests pass nothing.
 */
// Test seam: invoked (when set) after the resealed journal is staged to its
// tmp file but before the rename, so a test can simulate a concurrent append
// landing in the read->rewrite->rename window and assert the guard aborts
// instead of clobbering the new line (P2-5).
let onBeforeMigrationRename: ((journalPath: string) => void) | undefined;
export function _setMigrationRenameHook(fn: ((journalPath: string) => void) | undefined): void {
  onBeforeMigrationRename = fn;
}

export function sealSessionsAtRest(options: { skipNewerThanMs?: number } = {}): {
  sessions: number;
  sealedLines: number;
} {
  const summary = { sessions: 0, sealedLines: 0 };
  const dk = loadOrCreateDataKey();
  const dir = sessionsDir();
  if (!dk || !existsSync(dir)) return summary;
  const tooRecent = (path: string): boolean => {
    if (!options.skipNewerThanMs) return false;
    try {
      return Date.now() - statSync(path).mtimeMs < options.skipNewerThanMs;
    } catch {
      return true;
    }
  };
  for (const id of readdirSync(dir)) {
    try {
      const journalPath = join(dir, id, 'events.jsonl');
      if (existsSync(journalPath) && !tooRecent(journalPath)) {
        // Snapshot the file identity before reading. The reseal is a
        // read->rewrite->rename; if a live process appends between the read and
        // the rename, the rename would clobber that new line (P2-5). Re-stat
        // just before renaming and abort if it moved, leaving the file for the
        // next pass.
        const before = statSync(journalPath);
        const lines = readFileSync(journalPath, 'utf8').split('\n');
        let changed = 0;
        const out = lines.map((line) => {
          if (!line.trim() || isSealed(line)) return line;
          changed += 1;
          return sealString(dk.key, line);
        });
        if (changed > 0) {
          // Force the trailing newline: a crash-truncated legacy file must
          // not make the next append concatenate onto a sealed line.
          const content = out.join('\n');
          const tmp = `${journalPath}.tmp`;
          writeFileSync(tmp, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 });
          onBeforeMigrationRename?.(journalPath);
          const after = statSync(journalPath);
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
            // The journal changed under us (a concurrent append): do not
            // clobber it. Drop the staged tmp and leave it for the next pass.
            try {
              rmSync(tmp, { force: true });
            } catch {}
          } else {
            renameSync(tmp, journalPath);
            summary.sealedLines += changed;
          }
        }
      }
      const infoPath = join(dir, id, 'info.json');
      if (existsSync(infoPath) && !tooRecent(infoPath)) {
        const info = JSON.parse(readFileSync(infoPath, 'utf8')) as SessionInfo;
        if (typeof info.title === 'string' && !isSealed(info.title)) {
          info.title = sealString(dk.key, info.title);
          const tmp = `${infoPath}.tmp`;
          writeFileSync(tmp, JSON.stringify(info, null, 2), { mode: 0o600 });
          renameSync(tmp, infoPath);
        }
      }
      summary.sessions += 1;
    } catch {}
  }
  return summary;
}
