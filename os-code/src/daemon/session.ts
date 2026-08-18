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
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { oscHome } from '../config/load.js';
import type { AgentSession } from '../core/agent/loop.js';
import type { ApprovalAnswer, ApprovalRequest, DriverEvent } from '../core/agent/types.js';
import { redactSecrets } from '../core/security/redaction.js';

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
}

export function listSessions(): SessionInfo[] {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  const out: SessionInfo[] = [];
  for (const id of readdirSync(dir)) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, id, 'info.json'), 'utf8')));
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * LocalDriver: owns one AgentSession, an event journal, and the approval
 * hand-off between the loop (which awaits) and whichever UI is attached.
 */
export class LocalDriver implements SessionDriver {
  readonly id: string;
  private events: Array<{ seq: number; event: DriverEvent }> = [];
  private seq = 0;
  private sinks = new Set<(event: DriverEvent, seq: number) => void>();
  private pendingApprovals = new Map<string, (answer: ApprovalAnswer) => void>();
  private queue: Array<{ text: string; images?: Array<{ base64: string; mediaType: string }> }> =
    [];
  private running = false;
  private agent?: AgentSession;
  private persist: boolean;

  constructor(
    readonly cwd: string,
    options: { id?: string; persist?: boolean } = {},
  ) {
    this.id = options.id ?? randomUUID().slice(0, 8);
    this.persist = options.persist ?? true;
    if (this.persist) {
      const dir = this.dir();
      mkdirSync(dir, { recursive: true });
      const info: SessionInfo = {
        id: this.id,
        cwd,
        title: `Session ${this.id}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!existsSync(join(dir, 'info.json'))) {
        writeFileSync(join(dir, 'info.json'), JSON.stringify(info, null, 2));
      }
      this.loadJournal();
    }
  }

  /** The agent is attached after construction so the deps can reference the driver's approver. */
  attachAgent(agent: AgentSession): void {
    this.agent = agent;
  }

  get busy(): boolean {
    return this.running;
  }

  private dir(): string {
    return join(sessionsDir(), this.id);
  }

  private loadJournal(): void {
    try {
      const raw = readFileSync(join(this.dir(), 'events.jsonl'), 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as { seq: number; event: DriverEvent };
        this.events.push(parsed);
        this.seq = Math.max(this.seq, parsed.seq);
      }
    } catch {}
  }

  emit(event: DriverEvent): void {
    const seq = ++this.seq;
    const entry = { seq, event };
    this.events.push(entry);
    if (this.persist) {
      try {
        appendFileSync(
          join(this.dir(), 'events.jsonl'),
          `${redactSecrets(JSON.stringify(entry))}\n`,
        );
        const infoPath = join(this.dir(), 'info.json');
        const info = JSON.parse(readFileSync(infoPath, 'utf8')) as SessionInfo;
        info.updatedAt = new Date().toISOString();
        if (event.type === 'task-start') {
          info.title = event.input.slice(0, 60);
        }
        writeFileSync(infoPath, JSON.stringify(info, null, 2));
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
    const resolve = this.pendingApprovals.get(id);
    if (resolve) {
      this.pendingApprovals.delete(id);
      resolve(answer);
    }
  }

  send(text: string, images?: Array<{ base64: string; mediaType: string }>): void {
    this.queue.push({ text, images });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running || !this.agent) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    try {
      await this.agent.run(next.text, next.images);
    } catch (err) {
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running = false;
      if (this.queue.length) void this.pump();
    }
  }

  abort(): void {
    this.queue = [];
    this.agent?.abort();
  }

  subscribe(sink: (event: DriverEvent, seq: number) => void, sinceSeq = 0): () => void {
    for (const entry of this.events) {
      if (entry.seq > sinceSeq) sink(entry.event, entry.seq);
    }
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  describeModel(): { model: string; kind: 'local' | 'cloud' } {
    return this.agent?.activeModel ?? { model: '(not started)', kind: 'local' };
  }

  /** Outstanding approval requests (a reattaching client needs these). */
  pendingApprovalIds(): string[] {
    return [...this.pendingApprovals.keys()];
  }
}
