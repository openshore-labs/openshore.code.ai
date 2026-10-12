// The routine scheduler: the piece that makes a crew member work while the
// person is away. One instance per process, shared by the daemon (phone
// reachable) and the desktop shell (engine in-process), so a routine fires
// exactly once whichever surface is up.
//
// The contract, ruled by the tech review before the build:
//   - A run is a normal journaled session on the HEADLESS profile: shell,
//     push, and cloud spend can never resolve to allow, and the step ceiling
//     is the profile's 40. It works offline (tech review 3, 2026-09-29): no tool that
//     reaches the network is registered, and a network step is denied, never
//     asked. The routine's own access level maps to plan mode
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
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { bootstrapSession } from '../core/agent/bootstrap.js';
import { writeNewNoteSync } from '../core/vault/noteFile.js';
import { safeNoteName } from '../harness/vault/paths.js';
import type { DriverEvent, PermissionMode } from '../core/agent/types.js';
import { loadDaemonConfig, saveGlobalConfig } from '../config/load.js';
import { ensureVaultRootAt, vaultRootForOwner } from '../core/vault/memberRoots.js';
import { openSessionDrivers, type LocalDriver } from '../daemon/session.js';
import { MEMORY_ROUTINE_DENIED } from '../core/agent/loop.js';
import { PROJECT_MEMORY_WRITE_TOOL } from '../core/agent/projectMemory.js';
import { profileFor } from '../core/security/profiles.js';
import { isOutboxAllowedPath, realOrResolve } from '../core/security/workspaces.js';
import { logger } from '../util/log.js';
import {
  ROUTINE_NEEDS_LOCAL_MODEL,
  latestSlotAtOrBefore,
  nextSlotAfter,
  presenceOf,
  routineCaps,
  slotKey,
  type Routine,
  type RoutineClockStatus,
  type RoutineInput,
  type RoutineRun,
  type RoutineView,
} from './model.js';
import {
  acquireSchedulerLock,
  holderAlive,
  ownProcessStart,
  releaseSchedulerLock,
  type SchedulerLock,
} from './lock.js';
import * as store from './store.js';
import { dailyNoteConfigOf, runNoteDayPath, runNoteFrontmatter } from './runNote.js';
import type { RunNoteProvenance } from './runNote.js';
import { readVaultConfigFile } from '../core/vault/configFile.js';
import { resolvedAgentWritable } from '../core/vault/folderFs.js';
import { vaultSettingsFor } from '../core/vault/settingsFile.js';
import { dailyNotePath, datePartsOf } from '../harness/vault/dates.js';
import { deriveModelClass } from '../harness/profile.js';
import { loadConfig } from '../config/load.js';

const log = logger('routines');

/** How often the clock is checked. */
const DEFAULT_TICK_MS = 30_000;
/** How often a passive scheduler (another process holds the clock) tries to
 *  take the clock over, so closing that process never leaves the crew idle. */
const DEFAULT_TAKEOVER_MS = 30_000;
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
  /** Whether the run's session held a private note's text at any point, so
   *  its note is marked private (UX and copy review, 2026-10-08, A). A LocalDriver
   *  answers from its session; absent reads as no. */
  heldLocalOnly?(): boolean;
}

export interface OpenedSession {
  driver: RoutineDriver;
  warnings: string[];
  /** The orchestrator's model name, for the run note's frontmatter. */
  model?: string;
  /** Where the orchestrator runs, judged by address, for the note's
   *  `oscode-where` line (Vault M7, tech review L9). Left out when unknown. */
  where?: 'local' | 'cloud';
  /** The orchestrator's provider, for a cloud seat's `oscode-provider`. */
  provider?: string;
  /** The tools the run left out because it works offline (tech review 3), by name,
   *  so its note can say what it could not do. */
  offline?: string[];
}

/** What each tool an offline run leaves out would have done, in the words the
 *  run's note uses ("It ran offline, so it could not ..."). */
const OFFLINE_WORDS: Record<string, string> = {
  webSearch: 'search the web',
  webFetch: 'open web pages',
  codemagic: 'start Codemagic builds',
  askHermes: 'hand work to another agent',
  askAgent: 'hand work to another agent',
  cliAgent: 'hand work to another agent',
  delegate: 'hand work to another model',
  analyzeImage: 'look at images with another model',
  generateImage: 'make images',
};

/** The run note's offline line: that the run worked offline and what that
 *  left out, in plain words. */
export function offlineLine(leftOut: readonly string[] | undefined): string {
  const words = [...new Set((leftOut ?? []).map((name) => OFFLINE_WORDS[name] ?? name))];
  if (!words.length) return 'It ran offline.';
  const list =
    words.length === 1
      ? words[0]!
      : `${words.slice(0, -1).join(', ')}${words.length > 2 ? ',' : ''} or ${words[words.length - 1]!}`;
  return `It ran offline, so it could not ${list}.`;
}

/** The run note's one Note line when a search did not run: where it worked
 *  from instead. The query itself is never copied into the note, since the
 *  note sits in the vault and the query may be what an injected line wanted
 *  written down (tech review 2026-10-01, F1). */
export function triedToSearchLine(workspace: string): string {
  return `A web search did not run, so it used only the files in ${workspace}.`;
}

/** A run refused before it started, for a reason the person can act on. The
 *  message is recorded on the run verbatim (no "Could not start" prefix), so
 *  the inbox line is the instruction itself. */
export class RoutineRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutineRefused';
  }
}

/** The plain line for a workspace the scheduler will not run in. Written for
 *  a solo person on their own computer, not an admin. */
export const WORKSPACE_NOT_ALLOWED =
  'A routine runs only in a folder on this computer that OpenShore knows: a repository under ~/OSCode, or a folder you allowed. Pick one from Repositories, or allow this folder.';

/** A run refused because its folder left the allowed ones since the routine
 *  was made (taken off the list, or swapped for a link that leads elsewhere). */
export const WORKSPACE_LEFT =
  "This routine's folder is no longer one routines may run in: it was taken off the allowed folders, or it now leads somewhere else. Pick its folder again, or allow it, and the next run will start.";

/** A run refused because its folder is gone. */
export const WORKSPACE_GONE =
  "This routine's folder is not on this computer anymore, so the run did not start. Pick its folder again.";

/** A scheduled slot skipped because the person was working in the same
 *  folder (H1): two agents editing one folder at once is how work is lost. */
export const SLOT_WAITED_FOR_YOU =
  'You were working in this folder, so this run waited for the next time.';

/** The same, for a Run now tap. */
export const RUN_WAITED_FOR_YOU =
  'You were working in this folder, so this run did not start. Run it again once that chat is done.';

/** A run whose process closed before it finished (the orphan sweep): what
 *  closed, not why, and what it left behind (UX review cleanup 3). */
export const RUN_ORPHANED =
  'OpenShore closed before this run finished. Any changes it made before then are still in the folder.';

export interface SchedulerDeps {
  now?: () => number;
  tickMs?: number;
  /** How often a passive scheduler tries to take the clock over. */
  takeoverMs?: number;
  graceMs?: number;
  approvalTimeoutMs?: number;
  /** Open the session a run lives in. Defaults to a real headless bootstrap. */
  openSession?: (routine: Routine, permissionMode: PermissionMode) => OpenedSession;
  /** Where a routine's result notes go, by the routine's owner (Vault M5,
   *  tech review J8). Defaults to `vaultRootForOwner`: the machine's vault for an
   *  admin, a member's own root for a member, so Crew notes land in the
   *  routine owner's vault. */
  vaultRoot?: (ownerUserId?: string) => string;
  /** The workspace gate. Defaults to the machine's allowed-roots predicate. */
  allowedWorkspace?: (cwd: string) => boolean;
  /** Scheduling only; a manual Run now never waits for the clock. */
  autostart?: boolean;
  /** The machine-wide clock lock. Defaults to the lock file under
   *  ~/.os-code/routines; a test hands in its own. */
  lock?: { acquire: () => SchedulerLock; release: () => void };
  /** Persist a folder as allowed for routines. Defaults to the global config's
   *  daemon.outboxAllowedRoots; a test hands in its own. */
  persistAllowedRoot?: (cwd: string) => void;
  /** Whether a run note carries the provenance lines (`vault.provenance`,
   *  machine config, Vault M7, tech review L9). Defaults to the config the run's
   *  workspace loads (the key is machine-only, so a project cannot move it). */
  provenance?: (routine: Routine) => boolean;
  /** Whether a person's own session is working in this folder right now
   *  (the real path), so a run waits instead of editing under them (H1).
   *  Defaults to every stored session this process has open (the daemon's
   *  and the desktop engine host's alike), less the scheduler's own runs. */
  workspaceBusy?: (realCwd: string) => boolean;
}

/** The framing every run receives as its standing instructions, ahead of the
 *  crew member's persona. Plain, honest about the conditions. */
export function routineInstructions(routine: Routine): string {
  return [
    `You are ${routine.agentName}, a member of the person's crew, running the scheduled routine "${routine.name}" on their own computer while they are away. Nobody is watching this session.`,
    `Persona: ${routine.persona}`,
    'This run is offline: there is no web search and no web access. Work only from the files in this workspace and your vault notes.',
    routine.access === 'read-only'
      ? 'This routine is read-only: you can read files, search, and inspect the repository, but you cannot change anything. Do not try.'
      : 'This routine may edit files inside this workspace. Any shell command will ask for approval; if nobody answers within a few minutes the step is declined and you should carry on without it, or stop and say what is blocked.',
    `Your earlier runs of this routine are notes in the vault under ${routineFolder(routine)}/ (newest last by name, each linking the one before it as "previous"); read the latest with vaultList and vaultRead when it helps you build on what was found before.`,
    `You have about ${routine.maxMinutes} minutes. Work efficiently. When you finish, end with a short plain-language report the person will read first thing: what you found or did, anything risky, and a checklist of what needs them. Lead with the one thing that matters most. The report is saved to their vault as this run's note on its own, so do not try to write a note yourself. Never use em dashes.`,
  ].join('\n');
}

/** The routine's notes folder, vault-relative: the vault's one new-name rule
 *  (Vault M3, H4) applied to the routine's name. */
function routineFolder(routine: Pick<Routine, 'name'>): string {
  return `Crew/${safeNoteName(routine.name, 'Routine')}`;
}

interface ActiveRun {
  run: RoutineRun;
  routine: Routine;
  driver: RoutineDriver;
  /** The orchestrator's model, when the session said. */
  model?: string;
  /** Where the orchestrator runs, when the session said. */
  where?: 'local' | 'cloud';
  /** The orchestrator's provider, when the session said. */
  provider?: string;
  /** The tools the run left out because it works offline. */
  offline?: string[];
  /** The first web search the model tried anyway, for the note's Note line. */
  searchTried?: string;
  /** The run's session carried a private note's text, as its events showed
   *  it (a marked tool result or pack, a marked check), beside what the
   *  driver itself says (heldLocalOnly). */
  sawLocalOnly?: boolean;
  /** A change to the project's memory notes was left undone because the run
   *  drew on a private note and nobody could approve it (A). */
  memoryKept?: boolean;
  off: () => void;
  finalText: string;
  steps: string[];
  /** The agent's own plan (its latest todoWrite), written into the note so the
   *  maintainer sees what the routine set out to do, not just what it touched. */
  plan: string[];
  /** Why the scheduler itself ended the run (the wall-clock cap), if it did. */
  endNote?: string;
  /** The day's note the run note links to (Vault M6, 6.4), once the vault's
   *  daily-notes settings are read at the start. Left out when they are not
   *  read yet or name a format the vault core does not support. */
  dayPath?: string;
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
  private readonly takeoverMs: number;
  private readonly graceMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly openSession: (routine: Routine, permissionMode: PermissionMode) => OpenedSession;
  private readonly vaultRoot: (ownerUserId?: string) => string;
  private readonly allowedWorkspace: (cwd: string) => boolean;
  private readonly lock: { acquire: () => SchedulerLock; release: () => void };
  private readonly persistAllowedRoot: (cwd: string) => void;
  private readonly provenance: (routine: Routine) => boolean;
  private readonly workspaceBusy: (realCwd: string) => boolean;
  /** The other process's lock, when its clock is live and ours is not. */
  private clockHeldBy?: SchedulerLock;
  private timer?: ReturnType<typeof setInterval>;
  /** A passive scheduler's retry: takes the clock once its holder is gone. */
  private takeover?: ReturnType<typeof setInterval>;
  private active?: ActiveRun;
  private queue: QueuedRun[] = [];
  private driverHooks: Array<(driver: RoutineDriver, routine: Routine) => void> = [];
  /** Live drivers by session id, so a client attaching to a run's session
   *  finds the one the run is using instead of rehydrating a second copy. */
  private live = new Map<string, RoutineDriver>();

  constructor(deps: SchedulerDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.takeoverMs = deps.takeoverMs ?? DEFAULT_TAKEOVER_MS;
    this.graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    this.approvalTimeoutMs = deps.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    this.openSession = deps.openSession ?? defaultOpenSession;
    this.vaultRoot = deps.vaultRoot ?? ((owner) => vaultRootForOwner(owner));
    this.allowedWorkspace = deps.allowedWorkspace ?? ((cwd) => isOutboxAllowedPath(cwd));
    this.lock = deps.lock ?? {
      acquire: () => acquireSchedulerLock(),
      release: () => releaseSchedulerLock(),
    };
    this.persistAllowedRoot = deps.persistAllowedRoot ?? persistOutboxRoot;
    this.provenance = deps.provenance ?? provenanceOn;
    this.workspaceBusy =
      deps.workspaceBusy ??
      ((real) =>
        openSessionDrivers().some(
          (d) => d.busy && !this.live.has(d.id) && realOrResolve(d.cwd) === real,
        ));
    // Runs the previous process left open are swept by the clock holder
    // alone (tick), never here: a passive scheduler in a second process must
    // not mark the first process's live run failed (H1).
    if (deps.autostart !== false) this.start();
  }

  /**
   * A run whose process is gone can never finish now; say so rather than
   * show "working" forever (the journal is still on disk). Only runs whose
   * recorded process is dead, or was replaced by another under the same pid,
   * or that predate the record (an older build, whose clock this process now
   * holds). The write lands only while the run still reads as working.
   */
  private sweepOrphans(): void {
    for (const run of store.listRuns(MAX_ORPHANS)) {
      if (run.state !== 'running' && run.state !== 'waiting') continue;
      if (this.active?.run.id === run.id) continue;
      if (run.pid !== undefined && holderAlive(run.pid, run.pidStart)) continue;
      store.updateRun(
        run.id,
        {
          state: 'failed',
          finishedAt: new Date(this.now()).toISOString(),
          summary: RUN_ORPHANED,
        },
        (current) => current.state === 'running' || current.state === 'waiting',
      );
    }
  }

  /** Called with every driver a run opens, so the host can track it (the
   *  daemon puts it in its session map and watches it for push). */
  onDriver(hook: (driver: RoutineDriver, routine: Routine) => void): () => void {
    this.driverHooks.push(hook);
    return () => {
      this.driverHooks = this.driverHooks.filter((h) => h !== hook);
    };
  }

  /** Start the clock, unless another live process on this machine already
   *  holds it (the desktop app beside `osc serve`): then this instance stays
   *  passive, so a slot fires once per box, never once per process. Run now
   *  and the roster still work here. A passive instance tries again every
   *  `takeoverMs` and takes the clock once the holder is gone, so closing the
   *  terminal that held it never leaves the routines without a clock (UX review
   *  cleanup 6). */
  start(): void {
    if (this.timer || this.takeover) return;
    if (this.takeClock(true)) return;
    this.takeover = setInterval(() => {
      if (!this.takeClock(false)) return;
      if (this.takeover) clearInterval(this.takeover);
      this.takeover = undefined;
    }, this.takeoverMs);
    this.takeover.unref?.();
  }

  /** Try to hold the clock; true once this process holds it and the clock
   *  runs. `first` is start's own try: an unwritable ~/.os-code is not a
   *  reason to leave the crew idle, so that try runs the clock anyway. A
   *  retry that meets an error stays passive instead, since another process
   *  held the clock a moment ago and two clocks would fire a slot twice. */
  private takeClock(first: boolean): boolean {
    let held: SchedulerLock;
    try {
      held = this.lock.acquire();
    } catch (err) {
      if (!first) return false;
      log.warn('scheduler lock unavailable; running the clock anyway', { err: String(err) });
      held = { pid: process.pid, startedAt: new Date(this.now()).toISOString() };
    }
    if (held.pid !== process.pid) {
      if (first || this.clockHeldBy?.pid !== held.pid) {
        log.info('scheduler clock held by another process; this one stays passive', {
          pid: held.pid,
          since: held.startedAt,
        });
      }
      this.clockHeldBy = held;
      return false;
    }
    if (!first) log.info('scheduler clock taken over; its holder is gone');
    this.clockHeldBy = undefined;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
    void this.tick();
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.takeover) clearInterval(this.takeover);
    this.takeover = undefined;
    try {
      this.lock.release();
    } catch {
      // Nothing to release.
    }
  }

  /** True when this process's clock is live; false when another process on
   *  this machine holds it (see start). */
  clockLive(): boolean {
    return Boolean(this.timer);
  }

  /** The pid holding the clock when it is not ours. */
  clockHolder(): number | undefined {
    return this.clockHeldBy?.pid;
  }

  /** Whose clock fires the slots, for the Crew room: "held by pid N since T"
   *  when another process on this computer has it. */
  clockStatus(): RoutineClockStatus {
    if (this.timer) return { live: true };
    const held = this.clockHeldBy;
    return held
      ? { live: false, heldBy: { pid: held.pid, since: held.startedAt } }
      : { live: false };
  }

  // ---- workspaces -----------------------------------------------------------

  /** Whether a routine may run in this folder. */
  workspaceAllowed(cwd: string): boolean {
    return this.allowedWorkspace(cwd);
  }

  /** "Allow this folder": remember a folder outside ~/OSCode as one routines
   *  may run in. The folder has to exist; the person picked it themselves. */
  allowWorkspace(cwd: string): { ok: true } | { error: string } {
    if (!cwd || !existsSync(cwd)) return { error: 'That folder does not exist.' };
    if (this.allowedWorkspace(cwd)) return { ok: true };
    try {
      this.persistAllowedRoot(cwd);
    } catch (err) {
      return { error: `Could not remember that folder: ${(err as Error).message}` };
    }
    return { ok: true };
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
    if (!this.allowedWorkspace(input.cwd)) return { error: WORKSPACE_NOT_ALLOWED };
    if (!existsSync(input.cwd)) return { error: 'That workspace folder does not exist.' };
    return this.view(store.createRoutine(input, ownerUserId));
  }

  update(id: string, patch: Partial<RoutineInput>): RoutineView | { error: string } {
    if (patch.cwd !== undefined) {
      if (!this.allowedWorkspace(patch.cwd)) return { error: WORKSPACE_NOT_ALLOWED };
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
    // Where the note landed, then the same path in the folder the vault uses
    // now: a record from before the absolute path was kept, or a note whose
    // folder moved on (a pick, then Bring from the previous folder).
    const owner = store.getRoutine(run.routineId)?.ownerUserId;
    const tries = [run.noteAbsPath, join(this.vaultRoot(owner), run.notePath)];
    for (const abs of tries) {
      if (!abs) continue;
      try {
        return { path: run.notePath, markdown: readNoteFile(abs) };
      } catch {
        // Not there; try the next place.
      }
    }
    return undefined;
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
    // The clock holder, and only the clock holder, sweeps orphaned runs.
    if (this.timer) this.sweepOrphans();
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
        store.claimSlot(routine.id, key);
        continue;
      }
      // Claimed on a fresh read under the store lock: if another clock took
      // this slot first, it is theirs and this one moves on.
      if (!store.claimSlot(routine.id, key)) continue;
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
      // The folder is checked again at the start, as create checked it: it
      // may have been taken off the allowed ones, or swapped for a link that
      // leads elsewhere, since the routine was made.
      const real = this.checkWorkspace(routine);
      if (this.isBusy(real)) {
        store.appendRun({
          routineId: routine.id,
          startedAt,
          finishedAt: startedAt,
          state: 'skipped',
          trigger,
          summary: trigger === 'schedule' ? SLOT_WAITED_FOR_YOU : RUN_WAITED_FOR_YOU,
        });
        log.info('routine waited for the person', { id: routine.id, trigger });
        void this.pump();
        return;
      }
      opened = this.openSession(routine, permissionMode);
    } catch (err) {
      // A refusal is recorded as its own line (the person can act on it); any
      // other failure keeps the plain prefix.
      const summary =
        err instanceof RoutineRefused ? err.message : `Could not start: ${(err as Error).message}`;
      store.appendRun({
        routineId: routine.id,
        startedAt,
        finishedAt: startedAt,
        state: 'failed',
        trigger,
        summary,
      });
      log.warn('routine failed to start', { id: routine.id, err: String(err) });
      void this.pump();
      return;
    }
    const { driver, model, where, provider, offline } = opened;
    if (routine.ownerUserId) driver.setOwner?.(routine.ownerUserId);
    const pidStart = ownProcessStart();
    const run = store.appendRun({
      routineId: routine.id,
      sessionId: driver.id,
      startedAt,
      state: 'running',
      trigger,
      steps: 0,
      // Which process runs it, so another process never calls it orphaned
      // while this one is alive.
      pid: process.pid,
      ...(pidStart ? { pidStart } : {}),
    });
    const active: ActiveRun = {
      run,
      routine,
      driver,
      model,
      ...(where ? { where } : {}),
      ...(provider ? { provider } : {}),
      ...(offline ? { offline } : {}),
      off: () => {},
      finalText: '',
      steps: [],
      plan: [],
      finished: false,
    };
    this.active = active;
    void this.loadDayPath(active);
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

  /** Refuse a run whose folder is gone or no longer allowed, judged on the
   *  path as written and on where it leads. Answers the real path. */
  private checkWorkspace(routine: Routine): string {
    let real: string;
    try {
      real = realpathSync(routine.cwd);
      if (!statSync(real).isDirectory()) throw new Error('not a folder');
    } catch {
      throw new RoutineRefused(WORKSPACE_GONE);
    }
    if (!this.allowedWorkspace(routine.cwd) || !this.allowedWorkspace(real)) {
      throw new RoutineRefused(WORKSPACE_LEFT);
    }
    return real;
  }

  private isBusy(real: string): boolean {
    try {
      return this.workspaceBusy(real);
    } catch {
      return false;
    }
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
        // written into the note as a Plan section, so a maintainer sees what the
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
        if (event.result.localOnly) active.sawLocalOnly = true;
        break;
      }
      case 'context-pack':
      case 'verify':
      case 'task-start': {
        if (event.localOnly) active.sawLocalOnly = true;
        break;
      }
      case 'tool-denied': {
        // A change to the memory notes a routine could not ask about (A):
        // named in the note, and the run did not take that step.
        if (
          event.call.name === PROJECT_MEMORY_WRITE_TOOL &&
          event.reason === MEMORY_ROUTINE_DENIED
        ) {
          active.memoryKept = true;
          active.sawLocalOnly = true;
          break;
        }
        // A search the model reached for although the run works offline: the
        // first one is named in the note (tech review 3). The refused call never ran,
        // so it adds no step of its own.
        if (event.call.name === 'webSearch') {
          const query = event.call.args?.query;
          if (active.searchTried === undefined && typeof query === 'string' && query.trim()) {
            active.searchTried = query;
          }
          break;
        }
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
    let note: { rel: string; abs: string } | undefined;
    let noteError: string | undefined;
    try {
      note = this.writeNote(active, state, finishedAt, endNote);
    } catch (err) {
      // Recorded on the run, never written somewhere else: a vault folder
      // that went missing is not recreated (ensureVaultRoot).
      noteError = (err as Error).message;
      log.warn('could not write routine note', { err: String(err) });
    }
    store.updateRun(active.run.id, {
      state,
      finishedAt,
      summary,
      ...(note ? { notePath: note.rel, noteAbsPath: note.abs } : {}),
      ...(noteError ? { noteError } : {}),
      steps: active.steps.length,
    });
    log.info('routine run finished', { id: active.routine.id, run: active.run.id, state });
    this.active = undefined;
    void this.pump();
  }

  /** Read the vault's daily-notes settings while the run works, so its note
   *  can link to the day's note (Vault M6, 6.4, tech review K7). The note is never
   *  created or appended to from here. */
  private async loadDayPath(active: ActiveRun): Promise<void> {
    const root = this.vaultRoot(active.routine.ownerUserId);
    const started = new Date(active.run.startedAt);
    try {
      // Obsidian's daily-notes file present but unreadable: no link, since
      // the resolver would fall back to the default format and guess a name
      // that could fork the day's note (K7). Absent or readable goes on.
      const obsidianDaily = await readVaultConfigFile(root, 'obsidian/daily-notes');
      if (dailyNoteConfigOf(obsidianDaily) === undefined) {
        active.dayPath = undefined;
        return;
      }
      // The vault's resolved settings (Vault M7, tech review L5): Obsidian's daily
      // notes where it sets them, else the vault's own file, else the default.
      const settings = await vaultSettingsFor(root, { force: true });
      const path = dailyNotePath(datePartsOf(started), settings.daily);
      active.dayPath = path.ok ? path.path : undefined;
      return;
    } catch (err) {
      log.warn('vault settings unavailable; reading the daily notes settings alone', {
        err: String(err),
      });
    }
    try {
      const read = await readVaultConfigFile(root, 'obsidian/daily-notes');
      active.dayPath = runNoteDayPath(started, read);
    } catch (err) {
      log.warn('could not read the daily notes settings', { err: String(err) });
    }
  }

  /** What the run note's provenance lines carry (Vault M7, tech review L9), or
   *  'off' when `vault.provenance` is off. `runNoteFrontmatter` merges them
   *  byte for byte (L10) through the one `mergeProvenance`; a merge that
   *  skips leaves the block as built, so the run is recorded either way. */
  private provenanceFor(active: ActiveRun): RunNoteProvenance | 'off' {
    let on = false;
    try {
      on = this.provenance(active.routine);
    } catch {
      on = false;
    }
    if (!on) return 'off';
    const where = active.where;
    return {
      ...(where ? { where } : {}),
      ...(where && active.model
        ? { size: deriveModelClass({ model: active.model, kind: where }) }
        : {}),
      ...(where === 'cloud' && active.provider ? { provider: active.provider } : {}),
    };
  }

  /** Whether the run held a private note's text: as the driver's session
   *  says, or as its events showed. A driver that cannot say is read by its
   *  events alone. */
  private heldLocalOnly(active: ActiveRun): boolean {
    if (active.sawLocalOnly) return true;
    try {
      return active.driver.heldLocalOnly?.() === true;
    } catch {
      return false;
    }
  }

  private writeNote(
    active: ActiveRun,
    state: RoutineRun['state'],
    finishedAt: string,
    endNote?: string,
  ): { rel: string; abs: string } {
    // The default folder is made on first use; a configured one that went
    // missing throws here, before anything is written.
    const root = ensureVaultRootAt(this.vaultRoot(active.routine.ownerUserId));
    const started = new Date(active.run.startedAt);
    const date = `${started.getFullYear()}-${two(started.getMonth() + 1)}-${two(started.getDate())}`;
    const hh = two(started.getHours());
    const mm = two(started.getMinutes());
    const minutes = Math.max(1, Math.round((Date.parse(finishedAt) - started.getTime()) / 60_000));
    // The routine's previous run note (the newest earlier run that left one),
    // linked by full path so the model and the person can walk back.
    const previousPath = store
      .listRuns(50, active.routine.id)
      .find((r) => r.id !== active.run.id && r.notePath)?.notePath;
    const folder = routineFolder(active.routine);
    const lines = [
      runNoteFrontmatter({
        routine: active.routine.name,
        project: basename(active.routine.cwd),
        model: active.model || 'unknown',
        session: active.driver.id,
        started: active.run.startedAt,
        state,
        folder: folder.slice('Crew/'.length),
        previousPath,
        ...(active.dayPath ? { dayPath: active.dayPath } : {}),
        provenance: this.provenanceFor(active),
        // A run that drew on a private note leaves a private note (A).
        ...(this.heldLocalOnly(active) ? { localOnly: true as const } : {}),
      }),
      `# ${active.routine.name}: ${date} at ${hh}:${mm}`,
      '',
      `Crew: ${active.routine.agentName} · Workspace: ${basename(active.routine.cwd)} · ${stateWord(state)} · ${minutes} min · session ${active.driver.id}`,
      '',
      // Headless means offline (tech review 3): every note says so, and what that
      // left out.
      offlineLine(active.offline),
      '',
      '## Result',
      '',
      active.finalText || (endNote ? endNote : 'No result text was written.'),
    ];
    if (endNote && active.finalText) lines.push('', `Note: ${endNote}`);
    if (active.searchTried !== undefined) {
      lines.push('', `Note: ${triedToSearchLine(basename(active.routine.cwd))}`);
    }
    if (active.memoryKept) lines.push('', `Note: ${MEMORY_ROUTINE_DENIED}`);
    if (active.plan.length) {
      lines.push('', '## Plan', '', ...active.plan.map((s) => `- ${s}`));
    }
    if (active.steps.length) {
      lines.push('', '## Steps', '', ...active.steps.map((s) => `- ${s}`));
    }
    lines.push('');
    // The file is named for the minute the run started (a colon is not safe in
    // a file name on every system, so the time reads 06-00 there). A second run
    // in the same minute gets its own file, "06-00 (2)", never the first's: the
    // note is published whole with link() and never replaces a name that is
    // taken (the ifAbsent path of the vault's one writeNote, in its
    // synchronous form, since a run's end is recorded in one tick).
    // The routine's folder follows the vault's one new-name rule (Vault M3,
    // H4): no character Obsidian's links or a file system refuse, no dot-led
    // or dot-ended segment, no reserved name. Old runs keep the absolute path
    // their record already holds, so nothing is moved.
    const text = lines.join('\n');
    for (let n = 1; ; n++) {
      const name = `${date} ${hh}-${mm}${n === 1 ? '' : ` (${n})`}.md`;
      const rel = join(folder, name).split('\\').join('/');
      const abs = join(root, rel);
      // Never into a settings folder (Vault M7, tech review L8), judged on where the
      // path resolves: a Crew folder linked into .oscode/ is refused.
      if (!resolvedAgentWritable(root, abs)) {
        throw new Error(
          'The routine folder leads into a vault settings folder, so no note was written.',
        );
      }
      if (writeNewNoteSync(abs, text).ok) return { rel, abs };
      if (n >= 100) throw new Error(`Every note name for ${date} ${hh}-${mm} is taken.`);
    }
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

/** Remember a folder in the global config's daemon.outboxAllowedRoots, the
 *  same list the daemon's outbox routes honor. Arrays replace on merge, so
 *  the whole list is written back. */
function persistOutboxRoot(cwd: string): void {
  const real = realOrResolve(cwd);
  const roots = loadDaemonConfig().outboxAllowedRoots ?? [];
  if (roots.some((r) => realOrResolve(r) === real)) return;
  saveGlobalConfig({ daemon: { outboxAllowedRoots: [...roots, real] } });
}

/** A real run: a persisted, journaled session on the headless profile. The
 *  LocalDriver is a RoutineDriver structurally, so the daemon can put the very
 *  same object in its session map and a phone can attach to the run.
 *
 *  Refuses at once, before any task is sent, when the box's orchestrator is a
 *  cloud model: the headless profile can never auto-approve cloud spend, so
 *  the run would sit on an approval nobody answers and fail 15 minutes late
 *  (review 5, defect 3.1). The run's own caps ride into the engine's rails. */
export function defaultOpenSession(
  routine: Routine,
  permissionMode: PermissionMode,
  boot: typeof bootstrapSession = bootstrapSession,
): OpenedSession {
  const profile = profileFor('headless');
  const {
    driver,
    warnings,
    orchestratorKind,
    router,
    offlineTools,
  }: {
    driver: LocalDriver;
    warnings: string[];
    orchestratorKind: 'local' | 'cloud';
    router?: { orchestrator(): { ref: { model: string; provider?: string } } };
    offlineTools?: string[];
  } = boot({
    cwd: routine.cwd,
    profile: 'headless',
    instructions: routineInstructions(routine),
    projectName: routine.projectName,
    permissionMode,
    caps: routineCaps(routine),
    // The run reads its earlier notes in its owner's vault (tech review J8).
    vaultRoot: vaultRootForOwner(routine.ownerUserId),
    // The person's web search switch, as this computer holds it (machine config).
    routineSearch: routineSearchOn(routine),
  });
  if (orchestratorKind === 'cloud' && !profile.allowCloudAutoApprove) {
    try {
      driver.dispose();
    } catch {
      // The session never ran a turn; nothing to clean up beyond the handle.
    }
    throw new RoutineRefused(ROUTINE_NEEDS_LOCAL_MODEL);
  }
  let model: string | undefined;
  let provider: string | undefined;
  try {
    const ref = router?.orchestrator().ref;
    model = ref?.model;
    provider = ref?.provider;
  } catch {
    // The note says "unknown" rather than fail the run over a label.
  }
  return {
    driver,
    warnings,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    where: orchestratorKind,
    ...(offlineTools ? { offline: offlineTools } : {}),
  };
}

/** `routines.webSearch` from the config the run's workspace loads; the key is
 *  machine-only, so this is the machine's value. Off unless the person's
 *  switch says on. */
function routineSearchOn(routine: Routine): boolean {
  try {
    return loadConfig(routine.cwd).config.routines.webSearch === true;
  } catch {
    return false;
  }
}

/** `vault.provenance` from the config the run's workspace loads; the key is
 *  machine-only, so this is the machine's value. On unless it says off. */
function provenanceOn(routine: Routine): boolean {
  try {
    return loadConfig(routine.cwd).config.vault?.provenance !== 'off';
  } catch {
    return true;
  }
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
