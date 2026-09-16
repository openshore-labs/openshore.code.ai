// Crew routines: the schedule math, the sealed store, and the scheduler's
// contract as the CTO ruled it before the build. The session a run lives in
// is stood in by a fake driver, so these test the decisions (when to fire,
// when to skip, one at a time, the approval timeout, the cap, the note), not
// a model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriverEvent } from '../src/core/agent/types.js';
import {
  PRESET_ROUTINE,
  latestSlotAtOrBefore,
  nextSlotAfter,
  presenceOf,
  scheduleLabel,
  slotKey,
  validateRoutineInput,
  type Routine,
  type RoutineSchedule,
} from '../src/routines/model.js';
import { ROUTINE_NEEDS_LOCAL_MODEL, routineCaps } from '../src/routines/model.js';
import {
  RoutineRefused,
  RoutineScheduler,
  WORKSPACE_NOT_ALLOWED,
  _resetRoutineScheduler,
  defaultOpenSession,
  routineInstructions,
  summarize,
  type RoutineDriver,
} from '../src/routines/scheduler.js';
import {
  acquireSchedulerLock,
  pidAlive,
  readSchedulerLock,
  releaseSchedulerLock,
} from '../src/routines/lock.js';
import { spawn, type ChildProcess } from 'node:child_process';
import * as store from '../src/routines/store.js';

let home: string;
let vault: string;
let workspace: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  vault = join(home, 'Vault');
  workspace = mkdtempSync(join(tmpdir(), 'osc-ws-'));
  _resetRoutineScheduler();
});

afterEach(() => {
  vi.useRealTimers();
  _resetRoutineScheduler();
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

/** A local-time moment relative to today, so "tomorrow at 06:00" is always in
 *  the future of the store's real createdAt stamp. */
function at(dayOffset: number, hour: number, minute: number, second = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, second, 0);
  return d;
}

class FakeDriver implements RoutineDriver {
  static seq = 0;
  readonly id = `fake${++FakeDriver.seq}`;
  sent: string[] = [];
  aborted = false;
  answers: Array<{ id: string; approve: boolean; reason?: string }> = [];
  owner?: string;
  private listeners = new Set<(e: DriverEvent, seq: number) => void>();
  send(text: string): void {
    this.sent.push(text);
  }
  abort(): void {
    this.aborted = true;
    this.emit({ type: 'task-done', reason: 'aborted' });
  }
  onEvent(l: (e: DriverEvent, seq: number) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  answerApproval(id: string, answer: { approve: boolean; reason?: string }): void {
    this.answers.push({ id, ...answer });
    this.emit({ type: 'approval-resolved', id, approved: answer.approve });
  }
  setOwner(userId: string): void {
    this.owner = userId;
  }
  emit(event: DriverEvent): void {
    for (const l of [...this.listeners]) l(event, 0);
  }
}

function input(overrides: Partial<Parameters<typeof store.createRoutine>[0]> = {}) {
  return {
    name: 'Morning review',
    agentName: 'Reviewer',
    persona: 'A calm reviewer.',
    task: 'Review what changed.',
    cwd: workspace,
    schedule: { hour: 6, minute: 0, days: [] } as RoutineSchedule,
    ...overrides,
  };
}

function makeScheduler(
  clock: { now: Date },
  opts: {
    approvalTimeoutMs?: number;
    openSession?: () => { driver: FakeDriver; warnings: string[] };
    lock?: { acquire: () => { pid: number; startedAt: string }; release: () => void };
    allowed?: Set<string>;
  } = {},
) {
  const opened: FakeDriver[] = [];
  const allowed = opts.allowed ?? new Set<string>();
  const scheduler = new RoutineScheduler({
    now: () => clock.now.getTime(),
    autostart: false,
    graceMs: 10 * 60_000,
    approvalTimeoutMs: opts.approvalTimeoutMs ?? 1000,
    vaultRoot: () => vault,
    allowedWorkspace: (cwd) => cwd.startsWith(workspace) || allowed.has(cwd),
    persistAllowedRoot: (cwd) => allowed.add(cwd),
    lock: opts.lock ?? { acquire: () => ({ pid: process.pid, startedAt: '' }), release: () => {} },
    openSession:
      opts.openSession ??
      (() => {
        const driver = new FakeDriver();
        opened.push(driver);
        return { driver, warnings: [] };
      }),
  });
  return { scheduler, opened };
}

describe('routine model', () => {
  it('validates a routine payload and fills the defaults', () => {
    const bad = validateRoutineInput({ name: 'x' });
    expect(bad.ok).toBe(false);
    const good = validateRoutineInput(input());
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value.access).toBe('read-only');
      expect(good.value.maxMinutes).toBe(20);
      expect(good.value.enabled).toBe(true);
    }
    const capped = validateRoutineInput(input({ maxMinutes: 500 }));
    expect(capped.ok).toBe(false);
    const badDay = validateRoutineInput(input({ schedule: { hour: 6, minute: 0, days: [7] } }));
    expect(badDay.ok).toBe(false);
  });

  it('finds the latest and next slot on a weekday clock, in local time', () => {
    const monday = at(0, 6, 0);
    // Walk to the next Monday so the weekday math is not tied to today.
    while (monday.getDay() !== 1) monday.setDate(monday.getDate() + 1);
    const schedule: RoutineSchedule = { hour: 6, minute: 0, days: [1] };
    const justBefore = new Date(monday.getTime() - 10 * 60_000);
    const latest = latestSlotAtOrBefore(schedule, justBefore)!;
    expect(latest.getDay()).toBe(1);
    expect(monday.getTime() - latest.getTime()).toBe(7 * 86_400_000);
    expect(slotKey(latestSlotAtOrBefore(schedule, monday)!)).toBe(slotKey(monday));
    const next = nextSlotAfter(schedule, monday);
    expect(next.getTime() - monday.getTime()).toBe(7 * 86_400_000);
    expect(scheduleLabel({ hour: 6, minute: 0, days: [1, 2, 3, 4, 5] })).toBe('Weekdays at 06:00');
    expect(scheduleLabel({ hour: 21, minute: 30, days: [] })).toBe('Every day at 21:30');
  });

  it('derives presence from the routine and its last run', () => {
    const routine = { enabled: true } as Routine;
    expect(presenceOf(routine)).toBe('idle');
    expect(presenceOf({ enabled: false } as Routine)).toBe('paused');
    expect(presenceOf(routine, { state: 'running' } as never)).toBe('working');
    expect(presenceOf(routine, { state: 'waiting' } as never)).toBe('waiting');
    expect(presenceOf(routine, { state: 'done' } as never)).toBe('done');
  });

  it('summarizes a result as its first meaningful line', () => {
    expect(summarize('done', '## Report\n\n- All green.')).toBe('Report');
    expect(summarize('stopped', '', 'Stopped at the 5 minute cap.')).toBe(
      'Stopped at the 5 minute cap.',
    );
    expect(summarize('stopped', 'Partial work.', 'Stopped at the cap.')).toBe(
      'Stopped: Partial work.',
    );
    expect(summarize('failed', '')).toBe('Ended without a result.');
  });

  it('ships a read-only preset and honest framing', () => {
    expect(PRESET_ROUTINE.access).toBe('read-only');
    const routine = store.createRoutine(input({ access: 'read-only' }));
    const text = routineInstructions(routine);
    expect(text).toContain('Nobody is watching');
    expect(text).toContain('read-only');
    expect(text).not.toContain(String.fromCharCode(8212));
  });
});

describe('routine store', () => {
  it('persists routines and runs across a reload, and drops runs with their routine', () => {
    const r = store.createRoutine(input());
    store.appendRun({
      routineId: r.id,
      startedAt: new Date().toISOString(),
      state: 'done',
      trigger: 'manual',
    });
    store.invalidateRoutineStore();
    expect(store.listRoutines().map((x) => x.id)).toEqual([r.id]);
    expect(store.listRuns(10, r.id)).toHaveLength(1);
    expect(existsSync(join(home, 'routines.json'))).toBe(true);
    store.updateRoutine(r.id, { enabled: false });
    expect(store.getRoutine(r.id)?.enabled).toBe(false);
    expect(store.deleteRoutine(r.id)).toBe(true);
    expect(store.listRuns(10)).toHaveLength(0);
  });

  it('resets the slot bookkeeping when the clock changes', () => {
    const r = store.createRoutine(input());
    store.markSlot(r.id, '2026-09-07T06:00');
    expect(store.getRoutine(r.id)?.lastSlotKey).toBe('2026-09-07T06:00');
    store.updateRoutine(r.id, { schedule: { hour: 7, minute: 0, days: [] } });
    expect(store.getRoutine(r.id)?.lastSlotKey).toBeUndefined();
  });
});

describe('routine scheduler', () => {
  it('fires a due slot once, sends the task, and leaves a dated note when the run completes', async () => {
    const routine = store.createRoutine(input());
    const clock = { now: at(1, 6, 0, 20) };
    const { scheduler, opened } = makeScheduler(clock);
    await scheduler.tick();
    expect(opened).toHaveLength(1);
    expect(opened[0]!.sent).toEqual(['Review what changed.']);
    expect(scheduler.get(routine.id)?.presence).toBe('working');
    // The same slot never fires twice.
    await scheduler.tick();
    expect(opened).toHaveLength(1);

    opened[0]!.emit({ type: 'tool-start', call: { name: 'gitLog', args: {} } as never });
    opened[0]!.emit({
      type: 'tool-end',
      call: { name: 'gitLog', args: {} } as never,
      result: { ok: true, content: '' } as never,
      durationMs: 5,
    });
    opened[0]!.emit({ type: 'text-final', text: '## Report\nTwo commits landed. Nothing risky.' });
    clock.now = at(1, 6, 4);
    opened[0]!.emit({ type: 'task-done', reason: 'complete' });

    const view = scheduler.get(routine.id)!;
    expect(view.presence).toBe('done');
    expect(view.lastRun?.summary).toBe('Report');
    expect(view.lastRun?.steps).toBe(1);
    expect(view.lastRun?.sessionId).toBe(opened[0]!.id);
    const notePath = view.lastRun!.notePath!;
    expect(notePath.startsWith('Crew/Morning review/')).toBe(true);
    const note = readFileSync(join(vault, notePath), 'utf8');
    expect(note).toContain('Two commits landed.');
    expect(note).toContain(`session ${opened[0]!.id}`);
    expect(note).toContain('- gitLog (ok)');
    expect(scheduler.readNote(view.lastRun!.id)?.markdown).toBe(note);
    expect(readdirSync(join(vault, 'Crew', 'Morning review'))).toHaveLength(1);
  });

  it('records a slot the computer slept through as skipped, once, and never replays it', async () => {
    const routine = store.createRoutine(input());
    const clock = { now: at(1, 6, 45) };
    const { scheduler, opened } = makeScheduler(clock);
    await scheduler.tick();
    await scheduler.tick();
    expect(opened).toHaveLength(0);
    const runs = scheduler.runs(10, routine.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.state).toBe('skipped');
    expect(runs[0]!.summary).toContain('Missed the 06:00 slot');
    expect(scheduler.get(routine.id)?.presence).toBe('skipped');
  });

  it('starts a brand-new routine from its next slot, not the one that already passed today', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60 * 60_000);
    const routine = store.createRoutine(
      input({ schedule: { hour: earlier.getHours(), minute: earlier.getMinutes(), days: [] } }),
    );
    const clock = { now: new Date(now.getTime() + 60_000) };
    const { scheduler, opened } = makeScheduler(clock);
    await scheduler.tick();
    expect(opened).toHaveLength(0);
    expect(scheduler.runs(10, routine.id)).toHaveLength(0);
    expect(scheduler.get(routine.id)?.nextRunAt).toBeDefined();
  });

  it('runs one routine at a time and queues the other behind it', async () => {
    const a = store.createRoutine(input({ name: 'A' }));
    const b = store.createRoutine(input({ name: 'B' }));
    const clock = { now: at(1, 6, 0, 5) };
    const { scheduler, opened } = makeScheduler(clock);
    await scheduler.tick();
    expect(opened).toHaveLength(1);
    expect(scheduler.get(a.id)?.presence).toBe('working');
    expect(scheduler.get(b.id)?.presence).toBe('idle');
    opened[0]!.emit({ type: 'text-final', text: 'A done.' });
    opened[0]!.emit({ type: 'task-done', reason: 'complete' });
    expect(opened).toHaveLength(2);
    expect(scheduler.get(b.id)?.presence).toBe('working');
  });

  it('a manual run starts at once when idle, and refuses a second while it works', () => {
    const routine = store.createRoutine(input());
    const clock = { now: at(0, 12, 0) };
    const { scheduler, opened } = makeScheduler(clock);
    const first = scheduler.runNow(routine.id);
    expect('queued' in first).toBe(true);
    expect(opened).toHaveLength(1);
    const again = scheduler.runNow(routine.id);
    expect('error' in again && again.error).toContain('already running');
    expect(scheduler.stopRun(routine.id)).toBe(true);
    expect(opened[0]!.aborted).toBe(true);
    expect(scheduler.get(routine.id)?.lastRun?.state).toBe('stopped');
  });

  it('pauses on an approval nobody answers, then declines it with a reason', () => {
    vi.useFakeTimers();
    const routine = store.createRoutine(input({ access: 'edit' }));
    const clock = { now: at(0, 12, 0) };
    const { scheduler, opened } = makeScheduler(clock, { approvalTimeoutMs: 1000 });
    scheduler.runNow(routine.id);
    const driver = opened[0]!;
    driver.emit({
      type: 'approval-request',
      request: {
        id: 'ap1',
        kind: 'tool',
        toolName: 'runShell',
        risk: 'shell',
        summary: 'npm test',
      },
    });
    expect(scheduler.get(routine.id)?.presence).toBe('waiting');
    vi.advanceTimersByTime(1001);
    expect(driver.answers).toEqual([
      expect.objectContaining({
        id: 'ap1',
        approve: false,
        reason: expect.stringContaining('declined'),
      }),
    ]);
    expect(scheduler.get(routine.id)?.presence).toBe('working');
  });

  it('stops a run at its wall-clock cap and says so in the inbox', () => {
    vi.useFakeTimers();
    const routine = store.createRoutine(input({ maxMinutes: 5 }));
    const clock = { now: at(0, 12, 0) };
    const { scheduler, opened } = makeScheduler(clock);
    scheduler.runNow(routine.id);
    opened[0]!.emit({ type: 'text-final', text: 'Halfway through.' });
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(opened[0]!.aborted).toBe(true);
    const run = scheduler.get(routine.id)?.lastRun;
    expect(run?.state).toBe('stopped');
    expect(run?.summary).toBe('Stopped: Halfway through.');
    const note = readFileSync(join(vault, run!.notePath!), 'utf8');
    expect(note).toContain('Stopped at the 5 minute cap.');
  });

  it('refuses a workspace outside the allowed roots', () => {
    const clock = { now: at(0, 12, 0) };
    const { scheduler } = makeScheduler(clock);
    const outside = mkdtempSync(join(tmpdir(), 'osc-outside-'));
    try {
      const result = scheduler.create(input({ cwd: outside }));
      expect('error' in result && result.error).toBe(WORKSPACE_NOT_ALLOWED);
      // Written for a solo person on their own box, not an admin.
      expect(WORKSPACE_NOT_ALLOWED).not.toMatch(/admin/i);
      expect(WORKSPACE_NOT_ALLOWED).toMatch(/allow this folder/i);
      const ok = scheduler.create(input());
      expect('error' in ok).toBe(false);
      const moved = scheduler.update((ok as { id: string }).id, { cwd: outside });
      expect('error' in moved).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('"Allow this folder" remembers a folder outside ~/OSCode and then accepts it', () => {
    const clock = { now: at(0, 12, 0) };
    const { scheduler } = makeScheduler(clock);
    const outside = mkdtempSync(join(tmpdir(), 'osc-outside2-'));
    try {
      expect(scheduler.workspaceAllowed(outside)).toBe(false);
      expect(scheduler.allowWorkspace(join(outside, 'missing'))).toEqual({
        error: 'That folder does not exist.',
      });
      expect(scheduler.allowWorkspace(outside)).toEqual({ ok: true });
      expect(scheduler.workspaceAllowed(outside)).toBe(true);
      expect('error' in scheduler.create(input({ cwd: outside }))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('records a refused run with its own line, so the person can act on it', () => {
    const routine = store.createRoutine(input());
    const clock = { now: at(0, 12, 0) };
    const { scheduler } = makeScheduler(clock, {
      openSession: () => {
        throw new RoutineRefused(ROUTINE_NEEDS_LOCAL_MODEL);
      },
    });
    scheduler.runNow(routine.id);
    const run = scheduler.get(routine.id)?.lastRun;
    expect(run?.state).toBe('failed');
    expect(run?.summary).toBe(ROUTINE_NEEDS_LOCAL_MODEL);
    // Any other start failure keeps the plain prefix. A later clock, so the
    // newest run is unambiguous.
    const { scheduler: other } = makeScheduler(
      { now: at(0, 12, 5) },
      {
        openSession: () => {
          throw new Error('no model configured');
        },
      },
    );
    other.runNow(routine.id);
    expect(other.get(routine.id)?.lastRun?.summary).toBe('Could not start: no model configured');
  });

  it('refuses at once when the orchestrator is cloud, and passes the caps through', () => {
    const routine = store.createRoutine(input({ maxMinutes: 45 }));
    const disposed: string[] = [];
    const seenCaps: unknown[] = [];
    const boot = (options: { caps?: unknown }) => {
      seenCaps.push(options.caps);
      return {
        driver: { id: 'd1', dispose: () => disposed.push('d1') },
        warnings: [],
        orchestratorKind: 'cloud' as const,
      };
    };
    expect(() =>
      defaultOpenSession(
        routine,
        'plan',
        boot as unknown as Parameters<typeof defaultOpenSession>[2],
      ),
    ).toThrow(ROUTINE_NEEDS_LOCAL_MODEL);
    expect(disposed).toEqual(['d1']);
    expect(seenCaps[0]).toEqual({ wallClockSeconds: 45 * 60, maxSteps: 40 });
    // A local orchestrator opens normally.
    const local = () => ({
      driver: { id: 'd2', dispose: () => {} },
      warnings: [],
      orchestratorKind: 'local' as const,
    });
    const opened = defaultOpenSession(
      routine,
      'plan',
      local as unknown as Parameters<typeof defaultOpenSession>[2],
    );
    expect(opened.driver.id).toBe('d2');
    expect(routineCaps({ maxMinutes: 20 })).toEqual({ wallClockSeconds: 1200, maxSteps: 40 });
  });

  it('covers Friday in the Monday morning review', () => {
    expect(PRESET_ROUTINE.task).toMatch(/Monday/);
    expect(PRESET_ROUTINE.task).toMatch(/3 days ago/);
    expect(PRESET_ROUTINE.task).toMatch(/Friday/);
  });

  it('leaves its clock off when another live process holds the machine lock', async () => {
    const routine = store.createRoutine(input({ schedule: { hour: 6, minute: 0, days: [] } }));
    store.markSlot(routine.id, 'seed');
    const clock = { now: at(0, 6, 1) };
    const other = { pid: process.pid + 100_000, startedAt: '' };
    const { scheduler, opened } = makeScheduler(clock, {
      lock: { acquire: () => other, release: () => {} },
    });
    scheduler.start();
    expect(scheduler.clockLive()).toBe(false);
    expect(scheduler.clockHolder()).toBe(other.pid);
    // No timer means no clock-driven firing from this process...
    await scheduler.tick();
    // (...tick itself still works when called by hand; the point is the
    // interval never runs.) Run now still works in a passive process.
    scheduler.stopRun(routine.id);
    scheduler.runNow(routine.id);
    expect(opened.length).toBeGreaterThan(0);
    const { scheduler: mine } = makeScheduler(clock);
    mine.start();
    expect(mine.clockLive()).toBe(true);
    mine.stop();
  });
});

describe('the scheduler lock file', () => {
  let child: ChildProcess | undefined;
  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
  });

  it('is taken when absent, re-entrant for our own pid, and released only by its owner', () => {
    const path = join(home, 'routines', 'scheduler.lock');
    expect(readSchedulerLock(path)).toBeUndefined();
    expect(acquireSchedulerLock(path).pid).toBe(process.pid);
    expect(readSchedulerLock(path)?.pid).toBe(process.pid);
    expect(acquireSchedulerLock(path).pid).toBe(process.pid);
    releaseSchedulerLock(path);
    expect(existsSync(path)).toBe(false);
  });

  it('takes over a stale lock whose pid is dead', () => {
    const path = join(home, 'routines', 'scheduler.lock');
    mkdirSync(join(home, 'routines'), { recursive: true });
    // pid_max is 2^22 on Linux; nothing runs there.
    writeFileSync(path, JSON.stringify({ pid: 4_194_303, startedAt: '' }));
    expect(pidAlive(4_194_303)).toBe(false);
    expect(acquireSchedulerLock(path).pid).toBe(process.pid);
  });

  it('defers to a lock held by another live process', async () => {
    const path = join(home, 'routines', 'scheduler.lock');
    child = spawn('sleep', ['30'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 50));
    const pid = child.pid!;
    expect(pidAlive(pid)).toBe(true);
    mkdirSync(join(home, 'routines'), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid, startedAt: '' }));
    const held = acquireSchedulerLock(path);
    expect(held.pid).toBe(pid);
    // Not ours: release leaves it alone.
    releaseSchedulerLock(path);
    expect(readSchedulerLock(path)?.pid).toBe(pid);
  });

  it('marks a run the previous process left open as failed on startup', () => {
    const routine = store.createRoutine(input());
    store.appendRun({
      routineId: routine.id,
      startedAt: new Date().toISOString(),
      state: 'running',
      trigger: 'schedule',
      sessionId: 'old1',
    });
    const clock = { now: at(0, 12, 0) };
    const { scheduler } = makeScheduler(clock);
    const run = scheduler.get(routine.id)?.lastRun;
    expect(run?.state).toBe('failed');
    expect(run?.summary).toContain('restarted');
  });

  it('hands every opened driver to the host hook and sets the owner', () => {
    const routine = store.createRoutine(input(), 'u_owner');
    const clock = { now: at(0, 12, 0) };
    const { scheduler, opened } = makeScheduler(clock);
    const seen: string[] = [];
    scheduler.onDriver((driver) => seen.push(driver.id));
    scheduler.runNow(routine.id);
    expect(seen).toEqual([opened[0]!.id]);
    expect(opened[0]!.owner).toBe('u_owner');
    expect(scheduler.liveDriver(opened[0]!.id)).toBe(opened[0]);
    opened[0]!.emit({ type: 'task-done', reason: 'complete' });
    expect(scheduler.liveDriver(opened[0]!.id)).toBeUndefined();
  });
});
