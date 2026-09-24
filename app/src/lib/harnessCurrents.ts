// Harness Currents: the pure core (founder, 2026-09-23).
//
// A second, independent group in Settings, sitting ABOVE Agentic Currents. An
// Agentic Current is a modality for agent work (an external agent you hand a
// task to). A Harness Current is different: it layers a cheap decision method
// INTO the harness. It does not answer for a seat; it steers which seat answers
// and whether a step is even needed, so you can use any of your models with the
// method applied. The two groups are independent, so one of each can be on at
// once. Within the harness group it is one at a time, the same rule the agentic
// group holds.
//
// The first Harness Current is Jev, TypeSafe AI's System One decision model. It
// is a cloud call that costs money per turn, so it is scoped to a paid/cloud
// seat (there is nothing to save against a free local seat, and a cloud call
// would only add latency and break the offline floor). The honesty bar holds:
// the copy says what it does, never that it saves you money, until `osc eval`
// shows a number on the reference box (tenet 2).
//
// Everything here is pure and tested, mirroring currents.ts. Rooms render a
// harness current ONLY through `activeHarnessContribution`, never by naming one
// themselves; the guard test in harnessCurrents.test.ts keeps it so.
import type { HarnessCurrentsHandle } from 'os-code/protocol';
import { HARNESS_CURRENT_IDS, JEV_DEFAULT_MODEL, normalizeJevBaseUrl } from 'os-code/protocol';
import type { HarnessCurrentId } from 'os-code/protocol';
import type { CurrentState } from './currents.js';
import type { SetupGuideId } from './setupGuides.js';

export type { HarnessCurrentId } from 'os-code/protocol';
export { HARNESS_CURRENT_IDS } from 'os-code/protocol';
export { currentStateLabel } from './currents.js';
export type { CurrentState } from './currents.js';

// ------------------------------------------------------------ the roster

export interface HarnessCurrentInfo {
  id: HarnessCurrentId;
  label: string;
  /** One line under the label. */
  sub: string;
  /** What has to exist for it to be On. Shown while it is arriving. */
  needs: string;
  /** The default API base, prefilled in the connect sheet. */
  apiBase: string;
  /** Where to sign in and copy a key. Opened in an in-app browser on iOS. */
  apiKeyUrl: string;
  /** The default model id sent when the person pins none. */
  defaultModel: string;
  /** The mechanical jobs this current does around a seat, honest and short.
   *  Shown in the connect sheet and the doc; never a savings claim. */
  jobs: string[];
  guide: SetupGuideId;
}

// NOTE: apiKeyUrl and the model default below are from TypeSafe's public docs
// as of 2026-09 and, like every provider id in providers.ts, must be verified
// against the live API before a distribution build. A retired id or a dead key
// page is a dead button.
export const HARNESS_CURRENTS: HarnessCurrentInfo[] = [
  {
    id: 'jev',
    label: 'Jev',
    sub: 'A cheap decision model that steers your seats: it picks the seat for a turn and skips steps that do not need one.',
    needs:
      'A TypeSafe API key. Jev is a cloud decision model, so it needs an API key and spends a small amount per turn.',
    apiBase: 'https://api.typesafe.ai',
    apiKeyUrl: 'https://typesafe.ai',
    defaultModel: JEV_DEFAULT_MODEL,
    jobs: [
      'Checks whether a smaller local seat can handle a turn before the paid seat is spent.',
      'Routes each turn to the seat placed for that kind of work.',
      'Judges whether a result satisfies the task when there is no check to run.',
    ],
    guide: 'connect-jev',
  },
];

export function harnessCurrentInfo(id: HarnessCurrentId): HarnessCurrentInfo {
  return HARNESS_CURRENTS.find((c) => c.id === id)!;
}

/** The group's name as the app shows it, for Harbor Lite's fact cards, so the
 *  name lives only here. */
export const HARNESS_CURRENTS_TITLE = 'Harness Currents';

/** The BETA line under the group heading. Same honesty as the agentic group. */
export const HARNESS_CURRENTS_BETA_LINE =
  'An imperfect addition we are exploring. It only spends on a paid seat. One on at a time. Off leaves no trace.';

// ---------------------------------------------------------- connections

/** What the person saved for a harness current. Metadata only; the API key
 *  lives in the secret store under harnessCurrentSecretKey(id). */
export interface HarnessCurrentConnection {
  /** The API base URL (defaults to the roster's apiBase when blank). */
  endpoint?: string;
  /** The model id to send; blank means the roster's defaultModel. */
  model?: string;
}

export type HarnessCurrentConnections = Partial<Record<HarnessCurrentId, HarnessCurrentConnection>>;

/** The secret-store key holding a harness current's API key. Distinct from the
 *  BYOM/agentic-current keys: a harness current has no bench model, so it does
 *  not share the BYOM secret seam. */
export function harnessCurrentSecretKey(id: HarnessCurrentId): string {
  return `oscode.secret.harness.${id}`;
}

// ------------------------------------------------------------ the state

export interface HarnessCurrentsSettings {
  harnessCurrent?: HarnessCurrentId | null;
  harnessCurrentConnections?: HarnessCurrentConnections;
}

/** Live facts a probe established: whether the saved connection answered. */
export type HarnessCurrentProbes = Partial<Record<HarnessCurrentId, boolean>>;

/** Build the HarnessCurrentsSettings view for a project: its selection plus the
 *  device-local connections (connect once, select per project). */
export function projectHarnessSettings(
  project: { harnessCurrent?: HarnessCurrentId | null } | undefined,
  connections: HarnessCurrentConnections | undefined,
): HarnessCurrentsSettings {
  return {
    harnessCurrent: project?.harnessCurrent ?? null,
    harnessCurrentConnections: connections,
  };
}

export function activeHarnessCurrent(settings: HarnessCurrentsSettings): HarnessCurrentId | null {
  const id = settings.harnessCurrent;
  return id && (HARNESS_CURRENT_IDS as readonly string[]).includes(id) ? id : null;
}

/** Whether a harness current has what it needs saved (not whether it answers).
 *  A blank endpoint is allowed: it means the roster's default API base. So
 *  configured is really "a key has been saved", which the store proves by the
 *  probe; here we treat a saved connection object as configured. */
export function harnessCurrentConfigured(
  id: HarnessCurrentId,
  settings: HarnessCurrentsSettings,
): boolean {
  return Boolean(settings.harnessCurrentConnections?.[id]);
}

/** The two-part gate, as one pure decision, identical in spirit to the agentic
 *  one: the toggle AND a live probe.
 *    on        the toggle is on and the connection answered
 *    arriving  the toggle is on and it has not (nothing saved, or unreachable)
 *    ready     saved and answering, but the toggle is off
 *    off       nothing saved, toggle off */
export function harnessCurrentState(
  id: HarnessCurrentId,
  settings: HarnessCurrentsSettings,
  probes: HarnessCurrentProbes,
): CurrentState {
  const active = activeHarnessCurrent(settings) === id;
  const answered = harnessCurrentConfigured(id, settings) && probes[id] === true;
  if (active) return answered ? 'on' : 'arriving';
  return answered ? 'ready' : 'off';
}

/** One line for the row: what is true right now, and what it needs. */
export function harnessCurrentStateLine(
  id: HarnessCurrentId,
  settings: HarnessCurrentsSettings,
  probes: HarnessCurrentProbes,
): string {
  const info = harnessCurrentInfo(id);
  const state = harnessCurrentState(id, settings, probes);
  const c = settings.harnessCurrentConnections?.[id];
  const host = hostOf(c?.endpoint) || hostOf(info.apiBase);
  if (state === 'on') return `On. Steering your seats through ${host}.`;
  if (state === 'arriving') {
    if (!harnessCurrentConfigured(id, settings)) return `Not set up. ${info.needs}`;
    return `Not answering. ${host} did not answer yet. Check the API key and that you are online.`;
  }
  if (state === 'ready') return 'Ready. Turn it on to layer it in.';
  return info.sub;
}

/** Just the host of an address, for copy. */
export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Decide the next active harness current when a switch is flipped: one at a
 *  time WITHIN the harness group (the agentic group is untouched, so one of
 *  each can be on together). Turning one on turns the other harness one off. */
export function nextActiveHarnessCurrent(
  current: HarnessCurrentId | null,
  id: HarnessCurrentId,
  on: boolean,
): HarnessCurrentId | null {
  if (on) return id;
  return current === id ? null : current;
}

// ------------------------------------------------------ the contribution

/** What a harness current shows when on. Unlike an Agentic Current it fills no
 *  Bench, Crew, or Vault slot (it is not a model or an agent); it shows a pill
 *  beside the reach pill and its decisions as cards in the transcript. So the
 *  contribution is small and honest: a header label, the guide, and the jobs. */
export interface HarnessCurrentContribution {
  id: HarnessCurrentId;
  label: string;
  header: { label: string };
  guide: SetupGuideId;
  jobs: string[];
}

export function contributionForHarness(id: HarnessCurrentId): HarnessCurrentContribution {
  const info = harnessCurrentInfo(id);
  return {
    id,
    label: info.label,
    header: { label: info.label },
    guide: info.guide,
    jobs: info.jobs,
  };
}

/** The active harness current's contribution, or undefined when none is on.
 *  The one way a room learns a harness current exists. */
export function activeHarnessContribution(
  settings: HarnessCurrentsSettings,
): HarnessCurrentContribution | undefined {
  const id = activeHarnessCurrent(settings);
  return id ? contributionForHarness(id) : undefined;
}

/** The active harness current's id read back from a session handle, so a room
 *  that holds only the handle (the stack driver) can name it through the roster
 *  rather than hardcoding the proper noun. Only Jev today. */
export function activeHarnessId(
  handle: HarnessCurrentsHandle | undefined,
): HarnessCurrentId | undefined {
  return handle?.jev ? 'jev' : undefined;
}

// --------------------------------------------------------- the handle

/** The per-session handle the engine gets for the active harness current, built
 *  from the saved connection and its secret. Undefined when none is on or
 *  nothing usable is saved, which leaves the harness current off for the
 *  session. Only Jev today; the shape names each so the roster can grow. */
export function harnessCurrentsHandle(
  settings: HarnessCurrentsSettings,
  apiKey: string | undefined,
): HarnessCurrentsHandle | undefined {
  const id = activeHarnessCurrent(settings);
  if (id !== 'jev') return undefined;
  const info = harnessCurrentInfo(id);
  const c = settings.harnessCurrentConnections?.[id];
  const baseUrl = normalizeJevBaseUrl((c?.endpoint || info.apiBase).trim());
  if (!baseUrl) return undefined;
  return { jev: { baseUrl, apiKey, model: c?.model?.trim() || undefined } };
}
