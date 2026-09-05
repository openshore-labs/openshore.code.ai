// Crew routines: the schedule math, the sealed store, and the scheduler's
// contract as the CTO ruled it before the build. The session a run lives in
// is stood in by a fake driver, so these test the decisions (when to fire,
// when to skip, one at a time, the approval timeout, the cap, the note), not
// a model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
import {
  RoutineScheduler,
  _resetRoutineScheduler,
  routineInstructions,
  summarize,
  type RoutineDriver,
} from '../src/routines/scheduler.js';
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

function makeScheduler(clock: { now: Date }, opts: { approvalTimeoutMs?: number } = {}) {
  const opened: FakeDriver[] = [];
  const scheduler = new RoutineScheduler({
    now: () => clock.now.getTime(),
    autostart: false,
    graceMs: 10 * 60_000,
    approvalTimeoutMs: opts.approvalTimeoutMs ?? 1000,
    vaultRoot: () => vault,
    allowedWorkspace: (cwd) => cwd.startsWith(workspace),
    openSession: () => {
      const driver = new FakeDriver();
      opened.push(driver);
      return { driver, warnings: [] };
    },
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
      expect('error' in result && result.error).toContain('workspace');
      const ok = scheduler.create(input());
      expect('error' in ok).toBe(false);
      const moved = scheduler.update((ok as { id: string }).id, { cwd: outside });
      expect('error' in moved).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
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
