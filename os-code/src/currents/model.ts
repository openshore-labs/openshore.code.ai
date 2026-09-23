// Agentic Currents: the wire shapes the engine, the daemon, the desktop shell,
// and the phone all share. Browser-safe on purpose (no node imports), exported
// through 'os-code/protocol' like the routines model.
//
// A Current is an opt-in modality layered over the familiar app: turn one on
// and the same rooms gain rows for it (a Bench entry, a Crew member, a Vault
// folder, a tool for the coding agent); turn it off and every trace is gone.
// The engine side is deliberately small: a per-session handle for each
// current the person connected, a probe of what this machine can host, and a
// read-only view of a Hermes home folder. Nothing here installs anything.

/** The five Agentic Currents in the first BETA. The roster is fixed here so
 *  the phone, the daemon, and the engine agree on the ids. */
export const AGENTIC_CURRENT_IDS = ['hermes', 'cli', 'vellum', 'openagi', 'a2a'] as const;
export type AgenticCurrentId = (typeof AGENTIC_CURRENT_IDS)[number];

export function isAgenticCurrentId(v: unknown): v is AgenticCurrentId {
  return typeof v === 'string' && (AGENTIC_CURRENT_IDS as readonly string[]).includes(v);
}

/** A connected Hermes Agent box: its OpenAI-compatible API server. */
export interface HermesHandle {
  /** e.g. http://mini.tail1234.ts.net:8642/v1 (no trailing /chat/completions). */
  baseUrl: string;
  apiKey?: string;
  /** The model id to send. Hermes routes it to whatever the box is configured
   *  for; empty means the box's default. */
  model?: string;
}

/** A connected A2A agent: the URL its agent card lives under. The same door
 *  serves any agent that speaks A2A, Hermes and Vellum included when they
 *  expose one. */
export interface A2aHandle {
  /** The agent's base URL; the card is read from /.well-known/agent-card.json
   *  (or the older /.well-known/agent.json). */
  agentUrl: string;
  apiKey?: string;
}

/** A coding CLI paired on the machine the session runs on. */
export type CliAgentCommand = 'claude' | 'codex';
export interface CliHandle {
  command: CliAgentCommand;
}

/** What a session was handed for the current that is on. One current at a
 *  time everywhere (founder ruling), so at most one field is set; the shape
 *  still names each so the tools stay independent. */
export interface CurrentsHandles {
  hermes?: HermesHandle;
  a2a?: A2aHandle;
  cli?: CliHandle;
}

/** What this machine can host, as the daemon and the desktop report it. */
export interface CurrentsHostProbe {
  hermes: {
    /** The Hermes home folder the daemon would read (HERMES_HOME or ~/.hermes). */
    home: string;
    /** Whether that folder exists here, so the Vault can offer its memory. */
    present: boolean;
  };
  cli: {
    claude: boolean;
    codex: boolean;
  };
}

/** One markdown note in a Hermes home: its memory, its soul, a skill. */
export interface HermesNoteMeta {
  /** Home-relative path, forward slashes: MEMORY.md, skills/foo/SKILL.md. */
  path: string;
  title: string;
  updatedAt: string;
  size: number;
}

export interface HermesNote extends HermesNoteMeta {
  text: string;
}

/** Sanity limits shared by every side. */
export const CURRENTS_LIMITS = {
  /** The largest note the daemon will hand over. */
  noteBytes: 512 * 1024,
  /** How many notes a listing returns at most. */
  notes: 400,
  /** A delegated ask cannot be longer than this. */
  askChars: 24_000,
} as const;

/** Trim a pasted base URL the way BYOM does: no trailing slash, and a pasted
 *  /chat/completions is dropped. */
export function normalizeHermesBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/, '');
  return url;
}

/** Validate a wire payload into CurrentsHandles, dropping anything malformed
 *  rather than refusing the session: a bad handle simply leaves that tool out.
 *  Only http(s) URLs pass, so a handle can never name a file or a scheme the
 *  tools would not fetch. */
export function parseCurrentsHandles(v: unknown): CurrentsHandles | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: CurrentsHandles = {};
  const h = o.hermes as Record<string, unknown> | undefined;
  if (h && typeof h === 'object' && isHttpUrl(h.baseUrl)) {
    out.hermes = {
      baseUrl: normalizeHermesBaseUrl(h.baseUrl),
      apiKey: optString(h.apiKey),
      model: optString(h.model),
    };
  }
  const a = o.a2a as Record<string, unknown> | undefined;
  if (a && typeof a === 'object' && isHttpUrl(a.agentUrl)) {
    out.a2a = { agentUrl: a.agentUrl.replace(/\/+$/, ''), apiKey: optString(a.apiKey) };
  }
  const c = o.cli as Record<string, unknown> | undefined;
  if (c && typeof c === 'object' && (c.command === 'claude' || c.command === 'codex')) {
    out.cli = { command: c.command };
  }
  return Object.keys(out).length ? out : undefined;
}

// --------------------------------------------------------- harness currents
//
// A second, independent group of currents (founder, 2026-09-23). Where an
// Agentic Current is a modality for agent work (an external agent you hand a
// task to), a Harness Current layers a cost-saving decision method INTO the
// harness itself: it does not answer for a seat, it steers which seat answers
// and whether a step is even needed. The two groups are independent, so one of
// each can be on at once; within the harness group it is one at a time, the
// same rule the agentic group holds. The first is Jev, TypeSafe AI's System One
// decision model: a call sends state plus typed questions and gets back typed
// answers (a choice, a yes/no probability, a score), never chat.

/** The Harness Currents roster. Fixed here so every side agrees on the ids. */
export const HARNESS_CURRENT_IDS = ['jev'] as const;
export type HarnessCurrentId = (typeof HARNESS_CURRENT_IDS)[number];

export function isHarnessCurrentId(v: unknown): v is HarnessCurrentId {
  return typeof v === 'string' && (HARNESS_CURRENT_IDS as readonly string[]).includes(v);
}

/** TypeSafe AI's default Jev model alias. `jev-latest` tracks the flagship
 *  (jev-1.13.0 as of 2026-09); a project may pin a specific id in the handle. */
export const JEV_DEFAULT_MODEL = 'jev-latest';

/** A connected Jev decision model. The endpoint is the TypeSafe base URL; the
 *  System One call is POSTed to `${baseUrl}/v1/systemone` (see harness/jev.ts).
 *  The key lives in the device secret store, handed over per session like a
 *  BYOM key, never persisted on the wire shape. */
export interface JevHandle {
  /** e.g. https://api.typesafe.ai (no trailing /v1 or /v1/systemone). */
  baseUrl: string;
  apiKey?: string;
  /** The model id to send; empty means JEV_DEFAULT_MODEL. */
  model?: string;
}

/** What a session was handed for the harness current that is on. One at a time
 *  within the group, so at most one field is set; the shape still names each so
 *  the jobs stay independent as the roster grows. */
export interface HarnessCurrentsHandle {
  jev?: JevHandle;
}

/** Trim a pasted TypeSafe base URL: no trailing slash, and a pasted
 *  /v1/systemone or /v1 is dropped so only the host base remains. */
export function normalizeJevBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/v1\/systemone$/, '').replace(/\/v1$/, '');
  return url.replace(/\/+$/, '');
}

/** Validate a wire payload into a HarnessCurrentsHandle, dropping anything
 *  malformed rather than refusing the session: a bad handle simply leaves the
 *  harness current off for that session. Only http(s) URLs pass. */
export function parseHarnessCurrentsHandle(v: unknown): HarnessCurrentsHandle | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: HarnessCurrentsHandle = {};
  const j = o.jev as Record<string, unknown> | undefined;
  if (j && typeof j === 'object' && isHttpUrl(j.baseUrl)) {
    out.jev = {
      baseUrl: normalizeJevBaseUrl(j.baseUrl),
      apiKey: optString(j.apiKey),
      model: optString(j.model),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
