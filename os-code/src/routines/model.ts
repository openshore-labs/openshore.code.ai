// Crew routines: the pure model. A routine is one crew member, one task, one
// workspace, and a clock. When the clock strikes and the computer is on, the
// daemon opens a normal journaled session on the headless profile, the crew
// member works through the task, and the result lands as a dated note in the
// vault with the transcript a tap away. This file is browser-safe on purpose:
// the phone and the desktop render the same shapes through 'os-code/protocol',
// and the schedule math runs on both sides (the app shows "next run" without
// asking the daemon).
//
// The clone brief (botOS): the always-on-agents idea, local-first. The bots'
// computer is the person's own desktop; "always on" is honestly "while your
// computer is on", and every slot the machine sleeps through is recorded as
// skipped, never replayed in a burst.

/** What a routine may do unattended. Read-only maps to the engine's plan mode
 *  (no mutating tool can run); edit maps to acceptEdits (file edits inside the
 *  workspace jail flow, shell still asks). Shell never auto-runs on the
 *  headless profile whatever the routine says. */
export type RoutineAccess = 'read-only' | 'edit';

/** A weekly clock in the box's local time. `days` are JavaScript weekdays
 *  (0 is Sunday); empty means every day. */
export interface RoutineSchedule {
  hour: number;
  minute: number;
  days: number[];
}

export type RoutineRunState = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'skipped';

export interface RoutineRun {
  id: string;
  routineId: string;
  /** The journaled session this run opened, for transcript replay. Absent on
   *  a skipped slot (nothing ran). */
  sessionId?: string;
  startedAt: string;
  finishedAt?: string;
  state: RoutineRunState;
  /** One line for the inbox: the first line of the result, or why it ended. */
  summary?: string;
  /** Vault-relative path of the result note, once written. */
  notePath?: string;
  trigger: 'schedule' | 'manual';
  /** Tool steps the run took. */
  steps?: number;
}

export interface Routine {
  id: string;
  name: string;
  /** The crew member's app-side id, when the routine was built from one. */
  agentId?: string;
  agentName: string;
  /** The crew member's persona, snapshotted so a routine keeps its voice even
   *  if the crew card is edited later. */
  persona: string;
  /** The task, in the person's words. Sent as the routine's one message. */
  task: string;
  /** The workspace the session runs in. Must be an allowed workspace on the
   *  machine (see the scheduler): a routine never runs in an arbitrary folder. */
  cwd: string;
  projectName?: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  access: RoutineAccess;
  /** Wall-clock cap for one run, in minutes. */
  maxMinutes: number;
  ownerUserId?: string;
  createdAt: string;
  updatedAt: string;
  /** The slot key of the last scheduled slot handled (fired or skipped), so a
   *  restart never fires the same slot twice and a missed slot is skipped once. */
  lastSlotKey?: string;
}

/** What the phone or desktop renders: the routine plus its live state. */
export type RoutinePresence = 'working' | 'waiting' | 'paused' | 'idle' | RoutineRunState;

export interface RoutineView extends Routine {
  lastRun?: RoutineRun;
  nextRunAt?: string;
  presence: RoutinePresence;
}

/** Create/update payload, as the wire carries it. */
export interface RoutineInput {
  name: string;
  agentId?: string;
  agentName: string;
  persona: string;
  task: string;
  cwd: string;
  projectName?: string;
  schedule: RoutineSchedule;
  enabled?: boolean;
  access?: RoutineAccess;
  maxMinutes?: number;
}

export const ROUTINE_LIMITS = {
  name: 80,
  task: 4000,
  persona: 4000,
  agentName: 60,
  minMinutes: 5,
  maxMinutes: 60,
  defaultMinutes: 20,
} as const;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Validate a wire payload into a RoutineInput, or explain what is wrong in
 *  one sentence the app can show. Shared by the daemon and the desktop IPC so
 *  both refuse the same shapes. */
export function validateRoutineInput(
  body: unknown,
): { ok: true; value: RoutineInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Send a routine object.' };
  }
  const b = body as Record<string, unknown>;
  const text = (key: string, max: number, required = true): string | undefined => {
    const v = b[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') throw new Error(`${key} must be text.`);
    const t = v.trim();
    if (!t && required) throw new Error(`${key} is required.`);
    if (t.length > max) throw new Error(`${key} is too long (limit ${max} characters).`);
    return t || undefined;
  };
  try {
    const name = text('name', ROUTINE_LIMITS.name);
    const agentName = text('agentName', ROUTINE_LIMITS.agentName);
    const persona = text('persona', ROUTINE_LIMITS.persona);
    const task = text('task', ROUTINE_LIMITS.task);
    const cwd = text('cwd', 1024);
    if (!name || !agentName || !persona || !task || !cwd) {
      return {
        ok: false,
        error: 'A routine needs a name, a crew member, a task, and a workspace.',
      };
    }
    const schedule = validateSchedule(b.schedule);
    if (!schedule.ok) return schedule;
    const access = b.access === undefined ? 'read-only' : b.access;
    if (access !== 'read-only' && access !== 'edit') {
      return { ok: false, error: 'access must be "read-only" or "edit".' };
    }
    let maxMinutes: number = ROUTINE_LIMITS.defaultMinutes;
    if (b.maxMinutes !== undefined) {
      if (typeof b.maxMinutes !== 'number' || !Number.isFinite(b.maxMinutes)) {
        return { ok: false, error: 'maxMinutes must be a number.' };
      }
      maxMinutes = Math.round(b.maxMinutes);
      if (maxMinutes < ROUTINE_LIMITS.minMinutes || maxMinutes > ROUTINE_LIMITS.maxMinutes) {
        return {
          ok: false,
          error: `maxMinutes must be between ${ROUTINE_LIMITS.minMinutes} and ${ROUTINE_LIMITS.maxMinutes}.`,
        };
      }
    }
    const enabled = b.enabled === undefined ? true : b.enabled === true;
    const agentId =
      typeof b.agentId === 'string' && b.agentId.trim() ? b.agentId.trim() : undefined;
    const projectName = text('projectName', 120, false);
    return {
      ok: true,
      value: {
        name,
        agentId,
        agentName,
        persona,
        task,
        cwd,
        projectName,
        schedule: schedule.value,
        enabled,
        access,
        maxMinutes,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function validateSchedule(
  raw: unknown,
): { ok: true; value: RoutineSchedule } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'A routine needs a schedule (hour, minute, days).' };
  }
  const s = raw as Record<string, unknown>;
  const hour = s.hour;
  const minute = s.minute;
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, error: 'schedule.hour must be 0 to 23.' };
  }
  if (typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, error: 'schedule.minute must be 0 to 59.' };
  }
  const daysRaw = s.days === undefined ? [] : s.days;
  if (!Array.isArray(daysRaw)) return { ok: false, error: 'schedule.days must be a list.' };
  const days: number[] = [];
  for (const d of daysRaw) {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
      return { ok: false, error: 'schedule.days holds weekdays 0 (Sunday) to 6 (Saturday).' };
    }
    if (!days.includes(d)) days.push(d);
  }
  days.sort((a, b) => a - b);
  return { ok: true, value: { hour, minute, days } };
}

/** The slot's identity: local date plus time, e.g. 2026-09-05T06:00. */
export function slotKey(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function slotOn(schedule: RoutineSchedule, day: Date): Date {
  const d = new Date(day.getTime());
  d.setHours(schedule.hour, schedule.minute, 0, 0);
  return d;
}

function dayAllowed(schedule: RoutineSchedule, day: Date): boolean {
  return schedule.days.length === 0 || schedule.days.includes(day.getDay());
}

/** The most recent slot at or before `now`, or undefined when none falls in
 *  the last week (an empty day list never returns undefined). */
export function latestSlotAtOrBefore(schedule: RoutineSchedule, now: Date): Date | undefined {
  for (let back = 0; back < 8; back++) {
    const day = new Date(now.getTime());
    day.setDate(day.getDate() - back);
    const slot = slotOn(schedule, day);
    if (slot.getTime() <= now.getTime() && dayAllowed(schedule, slot)) return slot;
  }
  return undefined;
}

/** The next slot strictly after `now`. */
export function nextSlotAfter(schedule: RoutineSchedule, now: Date): Date {
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = new Date(now.getTime());
    day.setDate(day.getDate() + ahead);
    const slot = slotOn(schedule, day);
    if (slot.getTime() > now.getTime() && dayAllowed(schedule, slot)) return slot;
  }
  // Unreachable: a week always holds at least one allowed day.
  return slotOn(schedule, new Date(now.getTime() + 7 * 86_400_000));
}

/** The 24-hour clock, e.g. "06:00". */
export function scheduleTimeLabel(schedule: RoutineSchedule): string {
  return `${pad(schedule.hour)}:${pad(schedule.minute)}`;
}

/** "Every day", "Weekdays", "Weekends", or the day list. */
export function scheduleDaysLabel(schedule: RoutineSchedule): string {
  const days = schedule.days;
  if (days.length === 0 || days.length === 7) return 'Every day';
  const key = days.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return days.map((d) => DAY_NAMES[d]).join(' ');
}

/** "Weekdays at 06:00". */
export function scheduleLabel(schedule: RoutineSchedule): string {
  return `${scheduleDaysLabel(schedule)} at ${scheduleTimeLabel(schedule)}`;
}

/** Presence, derived from the routine and its latest run. */
export function presenceOf(routine: Routine, lastRun?: RoutineRun): RoutinePresence {
  if (lastRun?.state === 'running') return 'working';
  if (lastRun?.state === 'waiting') return 'waiting';
  if (!routine.enabled) return 'paused';
  if (!lastRun) return 'idle';
  return lastRun.state;
}

/** The one preset routine every crew ships with: a read-only morning review
 *  that reads what changed and leaves a checklist. Read-only, so the first
 *  unattended run can never need an approval. */
export const PRESET_ROUTINE = {
  name: 'Morning review',
  agentName: 'Reviewer',
  persona: [
    'You are the Reviewer, a calm senior engineer who reads what changed and says plainly what it means.',
    'You separate what is safe to ship from what needs a decision, and you never invent a finding without a concrete path to the problem.',
    'Advisory only: you review and recommend, the person decides.',
  ].join(' '),
  task: [
    'Review what changed in this repository over the last day. Use the gitLog tool with since "1 day ago" and patch on to read the commits and their diffs, and gitStatus for anything uncommitted.',
    'Then leave a short report: what landed, anything that looks risky or unfinished, and a checklist of the decisions or fixes that need the person this morning.',
    'Keep it under 300 words. Lead with the one thing that matters most.',
  ].join(' '),
  schedule: { hour: 6, minute: 0, days: [1, 2, 3, 4, 5] } as RoutineSchedule,
  access: 'read-only' as RoutineAccess,
  maxMinutes: 15,
};
