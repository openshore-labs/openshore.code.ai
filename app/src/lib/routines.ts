// Crew routines, app side: one client that reaches the scheduler wherever it
// runs (this desktop's engine over the bridge, or the paired desktop over the
// daemon), and the pure helpers the command center and the Crew cards render
// with. The model and the schedule math come from the engine's protocol
// module so both sides agree on every shape.
//
// The founder's brief (botOS, the always-on-agents clone, local-first): this
// is the same thing, honestly named. "Always on" here means while your
// computer is on; the copy below never says otherwise.
import type { DaemonTarget } from '../drivers/remoteDriver.js';
import { bridge } from './electronBridge.js';
import { isDesktop } from './platform.js';
import {
  PRESET_ROUTINE,
  nextSlotAfter,
  scheduleLabel,
  scheduleTimeLabel,
  type RoutineInput,
  type RoutineRun,
  type RoutineView,
} from 'os-code/protocol';

export type { RoutineInput, RoutineRun, RoutineView } from 'os-code/protocol';

export interface RoutinesSnapshot {
  routines: RoutineView[];
  runs: RoutineRun[];
}

export interface RoutinesClient {
  /** Where the scheduler lives, for the copy ("this computer" or the hub). */
  readonly where: 'desktop' | 'daemon';
  list(): Promise<RoutinesSnapshot>;
  create(input: RoutineInput): Promise<RoutineView>;
  update(id: string, patch: Partial<RoutineInput>): Promise<RoutineView>;
  remove(id: string): Promise<void>;
  run(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  note(runId: string): Promise<{ path: string; markdown: string } | null>;
}

function headers(target: DaemonTarget): Record<string, string> {
  return { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' };
}

async function daemonJson<T>(
  target: DaemonTarget,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${target.baseUrl}${path}`, {
    ...init,
    headers: { ...headers(target), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The desktop answered ${res.status}.`);
  return body;
}

function daemonClient(target: DaemonTarget): RoutinesClient {
  return {
    where: 'daemon',
    list: () => daemonJson<RoutinesSnapshot>(target, '/routines'),
    create: async (input) =>
      (
        await daemonJson<{ routine: RoutineView }>(target, '/routines', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).routine,
    update: async (id, patch) =>
      (
        await daemonJson<{ routine: RoutineView }>(target, `/routines/${id}`, {
          method: 'POST',
          body: JSON.stringify(patch),
        })
      ).routine,
    remove: async (id) => {
      await daemonJson(target, `/routines/${id}`, { method: 'DELETE' });
    },
    run: async (id) => {
      await daemonJson(target, `/routines/${id}/run`, { method: 'POST' });
    },
    stop: async (id) => {
      await daemonJson(target, `/routines/${id}/stop`, { method: 'POST' });
    },
    note: async (runId) => {
      try {
        return await daemonJson<{ path: string; markdown: string }>(
          target,
          `/routines/runs/${runId}/note`,
        );
      } catch {
        return null;
      }
    },
  };
}

function bridgeClient(): RoutinesClient {
  const b = () => {
    const x = bridge();
    if (!x) throw new Error('The desktop bridge is not available in this shell.');
    return x;
  };
  const unwrap = <T>(r: T | { error: string }): T => {
    if (r && typeof r === 'object' && 'error' in r) throw new Error((r as { error: string }).error);
    return r as T;
  };
  return {
    where: 'desktop',
    list: () => b().routinesList(),
    create: async (input) => unwrap(await b().routineCreate(input)).routine,
    update: async (id, patch) => unwrap(await b().routineUpdate(id, patch)).routine,
    remove: async (id) => {
      await b().routineDelete(id);
    },
    run: async (id) => {
      unwrap(await b().routineRun(id));
    },
    stop: async (id) => {
      await b().routineStop(id);
    },
    note: (runId) => b().routineNote(runId),
  };
}

/** The client for this device, or undefined when nothing can run a routine
 *  here (a phone with no paired desktop, the web dev shell). The same rule
 *  the coding agent uses: the desktop is its own engine unless the person
 *  pointed it at a remote hub. */
export function routinesClient(settings: {
  daemon?: DaemonTarget;
  preferRemoteHub?: boolean;
}): RoutinesClient | undefined {
  if (isDesktop() && bridge() && !settings.preferRemoteHub) return bridgeClient();
  if (settings.daemon) return daemonClient(settings.daemon);
  return undefined;
}

// ---- copy and presence -------------------------------------------------------

export type PresenceTone = 'working' | 'waiting' | 'ok' | 'failed' | 'muted';

/** The dot colour and the word beside it, per presence. Working pulses teal
 *  (local work), waiting wears the amber the app reserves for "needs you",
 *  done is the ok green, failed the danger red, everything else muted. */
export function presenceTone(presence: RoutineView['presence']): PresenceTone {
  switch (presence) {
    case 'working':
      return 'working';
    case 'waiting':
      return 'waiting';
    case 'done':
      return 'ok';
    case 'failed':
      return 'failed';
    default:
      return 'muted';
  }
}

function clock(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = `${d.getHours()}:${d.getMinutes() < 10 ? '0' : ''}${d.getMinutes()}`;
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return time;
  const yesterday = new Date(today.getTime() - 86_400_000);
  const wasYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (wasYesterday) return `yesterday ${time}`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${time}`;
}

/** "Working", "Waiting for you", "Done 6:12", "Next Mon 6:00", "Paused". */
export function presenceLabel(view: RoutineView, now = Date.now()): string {
  switch (view.presence) {
    case 'working':
      return 'Working';
    case 'waiting':
      return 'Waiting for you';
    case 'paused':
      return 'Paused';
    case 'done':
      return `Done ${clock(view.lastRun?.finishedAt ?? view.lastRun?.startedAt ?? view.updatedAt, now)}`;
    case 'failed':
      return `Failed ${clock(view.lastRun?.finishedAt ?? view.updatedAt, now)}`;
    case 'stopped':
      return `Stopped ${clock(view.lastRun?.finishedAt ?? view.updatedAt, now)}`;
    case 'skipped':
      return view.nextRunAt ? `Missed, next ${clock(view.nextRunAt, now)}` : 'Missed';
    default:
      return view.nextRunAt ? `Next ${clock(view.nextRunAt, now)}` : 'Idle';
  }
}

export function runStateLabel(state: RoutineRun['state']): string {
  switch (state) {
    case 'running':
      return 'Working';
    case 'waiting':
      return 'Waiting for you';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'skipped':
      return 'Missed';
  }
}

export function runWhen(run: RoutineRun, now = Date.now()): string {
  return clock(run.finishedAt ?? run.startedAt, now);
}

export function accessLabel(access: RoutineView['access']): string {
  return access === 'edit' ? 'May edit files' : 'Read-only';
}

export { scheduleLabel, scheduleTimeLabel, nextSlotAfter };

/** The one line at the top of the command center. */
export function crewHeadline(
  routines: RoutineView[],
  runs: RoutineRun[],
  now = Date.now(),
): string {
  if (!routines.length) return 'Your crew is ready to work while you are away.';
  const working = routines.filter((r) => r.presence === 'working').length;
  const waiting = routines.filter((r) => r.presence === 'waiting').length;
  if (waiting) return `${waiting} ${waiting === 1 ? 'routine needs' : 'routines need'} you.`;
  if (working)
    return `${working} ${working === 1 ? 'routine is' : 'routines are'} working right now.`;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const doneToday = runs.filter(
    (r) => r.state === 'done' && Date.parse(r.finishedAt ?? r.startedAt) >= startOfDay.getTime(),
  ).length;
  if (doneToday) return `${doneToday} ${doneToday === 1 ? 'result' : 'results'} waiting for you.`;
  const next = routines
    .map((r) => r.nextRunAt)
    .filter((x): x is string => Boolean(x))
    .sort()[0];
  return next ? `Quiet. Next run ${clock(next, now)}.` : 'Quiet. Every routine is paused.';
}

/** Custom routines unlock after the first routine finishes on its own (CX:
 *  ship one preset, gate the rest behind a first successful run). */
export function customRoutinesUnlocked(runs: RoutineRun[]): boolean {
  return runs.some((r) => r.state === 'done');
}

/** The preset, as a create payload for a chosen workspace and crew member. */
export function presetRoutineInput(
  cwd: string,
  agent: { id?: string; name: string; persona: string },
  projectName?: string,
): RoutineInput {
  return {
    name: PRESET_ROUTINE.name,
    agentId: agent.id,
    agentName: agent.name,
    persona: agent.persona,
    task: PRESET_ROUTINE.task,
    cwd,
    projectName,
    schedule: { ...PRESET_ROUTINE.schedule, days: [...PRESET_ROUTINE.schedule.days] },
    access: PRESET_ROUTINE.access,
    maxMinutes: PRESET_ROUTINE.maxMinutes,
    enabled: true,
  };
}

export const PRESET = PRESET_ROUTINE;

/** The routines a crew member is part of (by id when the routine was built
 *  from the card, else by name, so a hand-made routine still lights its card). */
export function routinesForAgent(
  routines: RoutineView[],
  agent: { id: string; name: string },
): RoutineView[] {
  return routines.filter((r) => (r.agentId ? r.agentId === agent.id : r.agentName === agent.name));
}

/** Presence, ordered by how much it needs the eye: waiting first, then
 *  working, then the results, then the quiet states. */
const PRESENCE_RANK: Record<string, number> = {
  waiting: 0,
  working: 1,
  failed: 2,
  done: 3,
  stopped: 4,
  skipped: 5,
  idle: 6,
  paused: 7,
};

/** A copy sorted busiest first, then by name, so lists and cards agree. */
export function busiestFirst(routines: RoutineView[]): RoutineView[] {
  return [...routines].sort(
    (a, b) =>
      (PRESENCE_RANK[a.presence] ?? 9) - (PRESENCE_RANK[b.presence] ?? 9) ||
      a.name.localeCompare(b.name),
  );
}

/** The one presence line for a crew card: the busiest routine wins. */
export function agentPresenceLine(routines: RoutineView[], now = Date.now()): string | undefined {
  if (!routines.length) return undefined;
  const top = busiestFirst(routines)[0]!;
  return `${presenceLabel(top, now)} · ${top.name}`;
}

/** Workspace folder name for a row. */
export function workspaceName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}
