// The routine scheduler: the piece that makes a crew member work while the
// person is away. One instance per process, shared by the daemon (phone
// reachable) and the desktop shell (engine in-process), so a routine fires
// exactly once whichever surface is up.
//
// The contract, ruled by the CTO before the build:
//   - A run is a normal journaled session on the HEADLESS profile: shell,
//     push, and cloud spend can never resolve to allow, and the step ceiling
//     is the profile's 40. The routine's own access level maps to plan mode
//     (read-only) or acceptEdits (edits inside the jail flow, shell asks).
//   - One run on the box at a time, one run per routine at a time. A slot that
//     lands while another routine works waits its turn (within the grace
//     window), never runs alongside it.
//   - A slot the machine slept through is recorded as skipped, once, and never
//     replayed as a catch-up burst.
//   - An approval nobody answers pauses the run (the daemon's push already
//     fires on approval-request), then times out to a denial with a reason the
//     model can act on. It never times out to an approval.
//   - A wall-clock cap per run, on top of the engine's own guardrails.
//   - The result lands as a dated markdown note in the vault (plain files,
//     Obsidian-compatible) with the session id, so the transcript is one tap
//     away; the run record carries a one-line summary for the inbox.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { bootstrapSession } from '../core/agent/bootstrap.js';
import type { DriverEvent, PermissionMode } from '../core/agent/types.js';
import { loadConfig } from '../config/load.js';
import type { LocalDriver } from '../daemon/session.js';
import { isOutboxAllowedPath } from '../core/security/workspaces.js';
import { logger } from '../util/log.js';
import {
  latestSlotAtOrBefore,
  nextSlotAfter,
  presenceOf,
  slotKey,
  type Routine,
  type RoutineInput,
  type RoutineRun,
  type RoutineView,
} from './model.js';
import * as store from './store.js';

const log = logger('routines');

/** How often the clock is checked. */
const DEFAULT_TICK_MS = 30_000;
/** A slot older than this when first seen (the box was off) is skipped. */
const DEFAULT_GRACE_MS = 10 * 60_000;
/** How long a run waits on an approval before declining it. */
const DEFAULT_APPROVAL_TIMEOUT_MS = 15 * 60_000;

/** The minimal driver surface the scheduler drives, so a test can hand it a
 *  fake session without booting a model. */
export interface RoutineDriver {
  readonly id: string;
  send(text: string): void;
  abort(): void;
  onEvent(listener: (event: DriverEvent, seq: number) => void): () => void;
  answerApproval(id: string, answer: { approve: boolean; reason?: string }): void;
  setOwner?(userId: string): void;
}

export interface OpenedSession {
  driver: RoutineDriver;
  warnings: string[];
}

export interface SchedulerDeps {
  now?: () => number;
  tickMs?: number;
  graceMs?: number;
  approvalTimeoutMs?: number;
  /** Open the session a run lives in. Defaults to a real headless bootstrap. */
  openSession?: (routine: Routine, permissionMode: PermissionMode) => OpenedSession;
  /** Where result notes go. Defaults to the configured vault dir. */
  vaultRoot?: () => string;
  /** The workspace gate. Defaults to the machine's allowed-roots predicate. */
  allowedWorkspace?: (cwd: string) => boolean;
  /** Scheduling only; a manual Run now never waits for the clock. */
  autostart?: boolean;
}

/** The framing every run receives as its standing instructions, ahead of the
 *  crew member's persona. Plain, honest about the conditions. */
export function routineInstructions(routine: Routine): string {
  return [
    `You are ${routine.agentName}, a member of the person's crew, running the scheduled routine "${routine.name}" on their own computer while they are away. Nobody is watching this session.`,
    `Persona: ${routine.persona}`,
    routine.access === 'read-only'
      ? 'This routine is read-only: you can read files, search, and inspect the repository, but you cannot change anything. Do not try.'
      : 'This routine may edit files inside this workspace. Any shell command will ask for approval; if nobody answers within a few minutes the step is declined and you should carry on without it, or stop and say what is blocked.',
    `You have about ${routine.maxMinutes} minutes. Work efficiently. When you finish, end with a short plain-language report the person will read first thing: what you found or did, anything risky, and a checklist of what needs them. Lead with the one thing that matters most. Never use em dashes.`,
  ].join('\n');
}

interface ActiveRun {
  run: RoutineRun;
  routine: Routine;
  driver: RoutineDriver;
  off: () => void;
  finalText: string;
  steps: string[];
  /** The agent's own plan (its latest todoWrite), written into the note so the
   *  founder sees what the routine set out to do, not just what it touched. */
  plan: string[];
  /** Why the scheduler itself ended the run (the wall-clock cap), if it did. */
  endNote?: string;
  approvalTimer?: ReturnType<typeof setTimeout>;
  wallTimer?: ReturnType<typeof setTimeout>;
  finished: boolean;
}

interface QueuedRun {
  routineId: string;
  trigger: 'schedule' | 'manual';
  queuedAt: number;
}

export class RoutineScheduler {
  private readonly now: () => number;
  private readonly tickMs: number;
  private readonly graceMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly openSession: (routine: Routine, permissionMode: PermissionMode) => OpenedSession;
  private readonly vaultRoot: () => string;
  private readonly allowedWorkspace: (cwd: string) => boolean;
  private timer?: ReturnType<typeof setInterval>;
  private active?: ActiveRun;
  private queue: QueuedRun[] = [];
  private driverHooks: Array<(driver: RoutineDriver, routine: Routine) => void> = [];
  /** Live drivers by session id, so a client attaching to a run's session
   *  finds the one the run is using instead of rehydrating a second copy. */
  private live = new Map<string, RoutineDriver>();

  constructor(deps: SchedulerDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    this.approvalTimeoutMs = deps.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    this.openSession = deps.openSession ?? defaultOpenSession;
    this.vaultRoot = deps.vaultRoot ?? defaultVaultRoot;
    this.allowedWorkspace = deps.allowedWorkspace ?? ((cwd) => isOutboxAllowedPath(cwd));
    // A run the previous process left open can never finish now; say so
    // rather than show "working" forever. The journal is still on disk.
    for (const run of store.listRuns(MAX_ORPHANS)) {
      if (run.state === 'running' || run.state === 'waiting') {
        store.updateRun(run.id, {
          state: 'failed',
          finishedAt: new Date(this.now()).toISOString(),
          summary: 'The computer restarted before this run finished.',
        });
      }
    }
    if (deps.autostart !== false) this.start();
  }

  /** Called with every driver a run opens, so the host can track it (the
   *  daemon puts it in its session map and watches it for push). */
  onDriver(hook: (driver: RoutineDriver, routine: Routine) => void): () => void {
    this.driverHooks.push(hook);
    return () => {
      this.driverHooks = this.driverHooks.filter((h) => h !== hook);
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The live driver behind a run's session, if that run is in flight. */
  liveDriver(sessionId: string): RoutineDriver | undefined {
    return this.live.get(sessionId);
  }

  // ---- the roster ----------------------------------------------------------

  list(ownerUserId?: string): RoutineView[] {
    return store
      .listRoutines()
      .filter((r) => ownerUserId === undefined || r.ownerUserId === ownerUserId)
      .map((r) => this.view(r));
  }

  get(id: string): RoutineView | undefined {
    const r = store.getRoutine(id);
    return r ? this.view(r) : undefined;
  }

  runs(limit = 50, routineId?: string): RoutineRun[] {
    return store.listRuns(limit, routineId);
  }

  create(input: RoutineInput, ownerUserId?: string): RoutineView | { error: string } {
    if (!this.allowedWorkspace(input.cwd)) {
      return {
        error:
          'A routine runs only in a workspace on this computer: a repository cloned here, or a folder an admin allowed.',
      };
    }
    if (!existsSync(input.cwd)) return { error: 'That workspace folder does not exist.' };
    return this.view(store.createRoutine(input, ownerUserId));
  }

  update(id: string, patch: Partial<RoutineInput>): RoutineView | { error: string } {
    if (patch.cwd !== undefined) {
      if (!this.allowedWorkspace(patch.cwd)) {
        return {
          error:
            'A routine runs only in a workspace on this computer: a repository cloned here, or a folder an admin allowed.',
        };
      }
      if (!existsSync(patch.cwd)) return { error: 'That workspace folder does not exist.' };
    }
    const next = store.updateRoutine(id, patch);
    if (!next) return { error: 'No such routine.' };
    return this.view(next);
  }

  remove(id: string): boolean {
    if (this.active?.routine.id === id) this.stopRun(id);
    this.queue = this.queue.filter((q) => q.routineId !== id);
    return store.deleteRoutine(id);
  }

  /** Read a run's result note back, for the inbox detail. */
  readNote(runId: string): { path: string; markdown: string } | undefined {
    const run = store.getRun(runId);
    if (!run?.notePath) return undefined;
    const abs = join(this.vaultRoot(), run.notePath);
    try {
      return { path: run.notePath, markdown: readNoteFile(abs) };
    } catch {
      return undefined;
    }
  }

  // ---- running -------------------------------------------------------------

  /** Run a routine now, ahead of its clock. Queues behind a run in flight. */
  runNow(id: string): { queued: true; position: number } | { error: string } {
    const routine = store.getRoutine(id);
    if (!routine) return { error: 'No such routine.' };
    if (this.active?.routine.id === id) return { error: `${routine.name} is already running.` };
    if (this.queue.some((q) => q.routineId === id)) {
      return { error: `${routine.name} is already waiting its turn.` };
    }
    this.queue.push({ routineId: id, trigger: 'manual', queuedAt: this.now() });
    const position = this.queue.length;
    void this.pump();
    return { queued: true, position };
  }

  /** Stop the run in flight for this routine (or drop it from the queue). */
  stopRun(id: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.routineId !== id);
    if (this.active?.routine.id === id) {
      this.active.driver.abort();
      return true;
    }
    return this.queue.length !== before;
  }

  /** The clock check. Public so tests can drive it without waiting. */
  async tick(): Promise<void> {
    const nowMs = this.now();
    const now = new Date(nowMs);
    for (const routine of store.listRoutines()) {
      const slot = latestSlotAtOrBefore(routine.schedule, now);
      if (!slot) continue;
      const key = slotKey(slot);
      if (routine.lastSlotKey === key) continue;
      // A paused routine still consumes its slots, so turning it back on at
      // noon does not backfill a "missed 06:00" record it never meant to run.
      // A brand-new routine likewise starts from its NEXT slot: a clock set
      // for 06:00 at 09:00 must not fire on the spot as if it had been missed.
      if (
        !routine.enabled ||
        (!routine.lastSlotKey && slot.getTime() < Date.parse(routine.updatedAt))
      ) {
        store.markSlot(routine.id, key);
        continue;
      }
      store.markSlot(routine.id, key);
      if (nowMs - slot.getTime() > this.graceMs) {
        store.appendRun({
          routineId: routine.id,
          startedAt: slot.toISOString(),
          finishedAt: now.toISOString(),
          state: 'skipped',
          trigger: 'schedule',
          summary: `Missed the ${slotLabel(slot)} slot: the computer was off or asleep.`,
        });
        log.info('routine slot skipped', { id: routine.id, slot: key });
        continue;
      }
      if (
        this.active?.routine.id === routine.id ||
        this.queue.some((q) => q.routineId === routine.id)
      ) {
        continue;
      }
      this.queue.push({ routineId: routine.id, trigger: 'schedule', queuedAt: nowMs });
    }
    await this.pump();
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    const routine = store.getRoutine(next.routineId);
    if (!routine) return void this.pump();
    // A scheduled run that waited too long behind another is stale: skip it
    // rather than start the morning review at noon.
    if (next.trigger === 'schedule' && this.now() - next.queuedAt > this.graceMs) {
      store.appendRun({
        routineId: routine.id,
        startedAt: new Date(next.queuedAt).toISOString(),
        finishedAt: new Date(this.now()).toISOString(),
        state: 'skipped',
        trigger: 'schedule',
        summary: 'Skipped: another routine was still working when its slot passed.',
      });
      return void this.pump();
    }
    this.startRun(routine, next.trigger);
  }

  private startRun(routine: Routine, trigger: 'schedule' | 'manual'): void {
    const startedAt = new Date(this.now()).toISOString();
    const permissionMode: PermissionMode = routine.access === 'edit' ? 'acceptEdits' : 'plan';
    let opened: OpenedSession;
    try {
      opened = this.openSession(routine, permissionMode);
    } catch (err) {
      store.appendRun({
        routineId: routine.id,
        startedAt,
        finishedAt: startedAt,
        state: 'failed',
        trigger,
        summary: `Could not start: ${(err as Error).message}`,
      });
      log.warn('routine failed to start', { id: routine.id, err: String(err) });
      void this.pump();
      return;
    }
    const { driver } = opened;
    if (routine.ownerUserId) driver.setOwner?.(routine.ownerUserId);
    const run = store.appendRun({
      routineId: routine.id,
      sessionId: driver.id,
      startedAt,
      state: 'running',
      trigger,
      steps: 0,
    });
    const active: ActiveRun = {
      run,
      routine,
      driver,
      off: () => {},
      finalText: '',
      steps: [],
      plan: [],
      finished: false,
    };
    this.active = active;
    this.live.set(driver.id, driver);
    for (const hook of this.driverHooks) {
      try {
        hook(driver, routine);
      } catch (err) {
        log.warn('driver hook failed', { err: String(err) });
      }
    }
    active.off = driver.onEvent((event) => this.onEvent(active, event));
    active.wallTimer = setTimeout(() => {
      if (active.finished) return;
      active.endNote = `Stopped at the ${routine.maxMinutes} minute cap.`;
      driver.abort();
    }, routine.maxMinutes * 60_000);
    active.wallTimer.unref?.();
    log.info('routine run started', { id: routine.id, run: run.id, session: driver.id, trigger });
    driver.send(routine.task);
  }

  private onEvent(active: ActiveRun, event: DriverEvent): void {
    if (active.finished) return;
    switch (event.type) {
      case 'approval-request': {
        store.updateRun(active.run.id, { state: 'waiting' });
        if (active.approvalTimer) clearTimeout(active.approvalTimer);
        const approvalId = event.request.id;
        active.approvalTimer = setTimeout(() => {
          active.approvalTimer = undefined;
          if (active.finished) return;
          active.driver.answerApproval(approvalId, {
            approve: false,
            reason: `Nobody answered within ${Math.round(this.approvalTimeoutMs / 60_000)} minutes, so this unattended routine declined the step. Carry on without it if you can, or stop and say what is blocked.`,
          });
        }, this.approvalTimeoutMs);
        active.approvalTimer.unref?.();
        break;
      }
      case 'approval-resolved': {
        if (active.approvalTimer) clearTimeout(active.approvalTimer);
        active.approvalTimer = undefined;
        store.updateRun(active.run.id, { state: 'running' });
        break;
      }
      case 'text-final': {
        if (event.text.trim()) active.finalText = event.text.trim();
        break;
      }
      case 'todos': {
        // The agent's own plan, replaced whole each todoWrite. The latest one is
        // written into the note as a Plan section, so the founder sees what the
        // routine set out to do. No extra model call; this is the loop's own plan.
        if (event.items.length) active.plan = event.items.map((i) => i.content);
        break;
      }
      case 'tool-start': {
        active.steps.push(`${event.call.name}`);
        store.updateRun(active.run.id, { steps: active.steps.length });
        break;
      }
      case 'tool-end': {
        const i = active.steps.length - 1;
        if (i >= 0) active.steps[i] = `${event.call.name} (${event.result.ok ? 'ok' : 'failed'})`;
        break;
      }
      case 'tool-denied': {
        const i = active.steps.length - 1;
        if (i >= 0) active.steps[i] = `${event.call.name} (declined)`;
        break;
      }
      case 'task-done': {
        this.finish(active, event.reason, event.message);
        break;
      }
      default:
        break;
    }
  }

  private finish(
    active: ActiveRun,
    reason: 'complete' | 'guardrail' | 'aborted' | 'declined' | 'error',
    message?: string,
  ): void {
    if (active.finished) return;
    active.finished = true;
    active.off();
    if (active.approvalTimer) clearTimeout(active.approvalTimer);
    if (active.wallTimer) clearTimeout(active.wallTimer);
    this.live.delete(active.driver.id);
    const finishedAt = new Date(this.now()).toISOString();
    // A guardrail stop (the step ceiling, the engine's own wall clock) is a
    // calm end with partial work, like the scheduler's cap: stopped, not
    // failed. Failed is reserved for an error or a declined run.
    const state: RoutineRun['state'] =
      reason === 'complete'
        ? 'done'
        : reason === 'aborted' || reason === 'guardrail'
          ? 'stopped'
          : 'failed';
    const endNote = active.endNote ?? message;
    const summary = summarize(state, active.finalText, endNote);
    let notePath: string | undefined;
    try {
      notePath = this.writeNote(active, state, finishedAt, endNote);
    } catch (err) {
      log.warn('could not write routine note', { err: String(err) });
    }
    store.updateRun(active.run.id, {
      state,
      finishedAt,
      summary,
      notePath,
      steps: active.steps.length,
    });
    log.info('routine run finished', { id: active.routine.id, run: active.run.id, state });
    this.active = undefined;
    void this.pump();
  }

  private writeNote(
    active: ActiveRun,
    state: RoutineRun['state'],
    finishedAt: string,
    endNote?: string,
  ): string {
    const root = this.vaultRoot();
    const started = new Date(active.run.startedAt);
    const stamp = `${started.getFullYear()}-${two(started.getMonth() + 1)}-${two(started.getDate())} ${two(started.getHours())}-${two(started.getMinutes())}`;
    const rel = join('Crew', safeName(active.routine.name), `${stamp}.md`).split('\\').join('/');
    const abs = join(root, rel);
    const minutes = Math.max(1, Math.round((Date.parse(finishedAt) - started.getTime()) / 60_000));
    const lines = [
      `# ${active.routine.name}: ${stamp.replace(' ', ' at ').replace('-', ':')}`,
      '',
      `Crew: ${active.routine.agentName} · Workspace: ${basename(active.routine.cwd)} · ${stateWord(state)} · ${minutes} min · session ${active.driver.id}`,
      '',
      '## Result',
      '',
      active.finalText || (endNote ? endNote : 'No result text was written.'),
    ];
    if (endNote && active.finalText) lines.push('', `Note: ${endNote}`);
    if (active.plan.length) {
      lines.push('', '## Plan', '', ...active.plan.map((s) => `- ${s}`));
    }
    if (active.steps.length) {
      lines.push('', '## Steps', '', ...active.steps.map((s) => `- ${s}`));
    }
    lines.push('');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, lines.join('\n'));
    return rel;
  }

  private view(routine: Routine): RoutineView {
    const lastRun = store.listRuns(1, routine.id)[0];
    const nextRunAt = routine.enabled
      ? nextSlotAfter(routine.schedule, new Date(this.now())).toISOString()
      : undefined;
    return { ...routine, lastRun, nextRunAt, presence: presenceOf(routine, lastRun) };
  }
}

const MAX_ORPHANS = 50;

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function slotLabel(slot: Date): string {
  return `${two(slot.getHours())}:${two(slot.getMinutes())}`;
}

function safeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Routine';
}

function stateWord(state: RoutineRun['state']): string {
  switch (state) {
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'skipped':
      return 'Skipped';
    case 'waiting':
      return 'Waiting';
    default:
      return 'Working';
  }
}

/** The inbox line: the first meaningful line of the result, capped. */
export function summarize(state: RoutineRun['state'], finalText: string, endNote?: string): string {
  const first = finalText
    .split('\n')
    .map((l) =>
      l
        .replace(/^#+\s*/, '')
        .replace(/^[-*]\s+/, '')
        .trim(),
    )
    .find((l) => l.length > 0);
  const base = first ?? endNote ?? (state === 'done' ? 'Finished.' : 'Ended without a result.');
  const line = base.length > 160 ? `${base.slice(0, 157)}...` : base;
  if (state === 'done' || !endNote || first === undefined) return line;
  return `${stateWord(state)}: ${line}`;
}

function readNoteFile(abs: string): string {
  return readFileSync(abs, 'utf8');
}

function defaultVaultRoot(): string {
  const { config } = loadConfig();
  return config.vault?.dir ?? join(homedir(), 'OSCode', 'Vault');
}

/** A real run: a persisted, journaled session on the headless profile. The
 *  LocalDriver is a RoutineDriver structurally, so the daemon can put the very
 *  same object in its session map and a phone can attach to the run. */
function defaultOpenSession(routine: Routine, permissionMode: PermissionMode): OpenedSession {
  const { driver, warnings }: { driver: LocalDriver; warnings: string[] } = bootstrapSession({
    cwd: routine.cwd,
    profile: 'headless',
    instructions: routineInstructions(routine),
    projectName: routine.projectName,
    permissionMode,
  });
  return { driver, warnings };
}

// ---- the process singleton ---------------------------------------------------

let singleton: RoutineScheduler | undefined;

/** The one scheduler for this process. The first caller's deps win; later
 *  callers share it. */
export function getRoutineScheduler(deps?: SchedulerDeps): RoutineScheduler {
  if (!singleton) singleton = new RoutineScheduler(deps);
  return singleton;
}

/** Tests: drop the singleton (stopping its clock) so the next call builds a
 *  fresh one against a fresh OSC_HOME. */
export function _resetRoutineScheduler(): void {
  singleton?.stop();
  singleton = undefined;
  store.invalidateRoutineStore();
}
