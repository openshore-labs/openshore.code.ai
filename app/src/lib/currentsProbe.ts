// The live half of the two-part gate: does the saved connection answer? A
// current is On only when its toggle is on AND a probe came back, the way
// iCloud readiness is a runtime probe and never a flag. Also the small
// read clients the rooms use once a current is on: a Hermes box's scheduled
// jobs (Crew), and a Hermes home's notes (Vault) through the paired computer.
//
// Fetch is injectable so the pure tests need no network. Every probe is
// bounded by a short timeout and never throws: false means "did not answer",
// which the row renders as Arriving with the honest line.
import type { CurrentsHostProbe, HermesNote, HermesNoteMeta } from 'os-code/protocol';
import type { DaemonTarget } from '../drivers/remoteDriver.js';
import { bridge } from './electronBridge.js';
import { isDesktop } from './platform.js';
import type { AgenticCurrentId, CurrentConnection } from './currents.js';
import { currentInfo } from './currents.js';

export type Fetch = typeof fetch;

const PROBE_MS = 6000;

/** The desktop bridge, only where one can exist (a window with the preload).
 *  Never throws outside a browser, so a probe in a headless test or a worker
 *  simply falls through to the daemon path. */
function desktopBridge() {
  if (typeof window === 'undefined' || !isDesktop()) return undefined;
  return bridge();
}

function withTimeout(init: RequestInit = {}): RequestInit {
  return { ...init, signal: AbortSignal.timeout(PROBE_MS) };
}

function authHeaders(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (apiKey) h.authorization = `Bearer ${apiKey}`;
  return h;
}

/** An OpenAI-compatible server answers GET /models under its /v1 base. A
 *  server that answers anything but a 404 there counts: some serve /models
 *  behind auth (401) and still take chat completions with the right key. */
export async function probeOpenAiCompatible(
  baseUrl: string,
  apiKey: string | undefined,
  fetchFn: Fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${baseUrl}/models`, withTimeout({ headers: authHeaders(apiKey) }));
    return res.status !== 404 && res.status < 500;
  } catch {
    return false;
  }
}

export interface AgentCardSummary {
  name?: string;
  description?: string;
}

/** Read an A2A agent card from either well-known location. */
export async function probeAgentCard(
  agentUrl: string,
  apiKey: string | undefined,
  fetchFn: Fetch = fetch,
): Promise<AgentCardSummary | undefined> {
  for (const path of ['/.well-known/agent-card.json', '/.well-known/agent.json']) {
    try {
      const res = await fetchFn(
        `${agentUrl}${path}`,
        withTimeout({ headers: authHeaders(apiKey) }),
      );
      if (!res.ok) continue;
      const card = (await res.json()) as AgentCardSummary;
      if (card && typeof card === 'object') {
        return {
          name: typeof card.name === 'string' ? card.name : undefined,
          description: card.description,
        };
      }
    } catch {
      // try the next location
    }
  }
  return undefined;
}

export interface ProbeResult {
  answered: boolean;
  /** For an endpoint current: which door it answered on. */
  via?: 'a2a' | 'openai';
  agentName?: string;
}

/** Probe one current's saved connection. The host probe (from the paired
 *  computer) decides a CLI current; the network decides the rest. */
export async function probeCurrent(
  id: AgenticCurrentId,
  connection: CurrentConnection | undefined,
  apiKey: string | undefined,
  host: CurrentsHostProbe | undefined,
  fetchFn: Fetch = fetch,
): Promise<ProbeResult> {
  const info = currentInfo(id);
  if (info.kind === 'cli') {
    const command = connection?.command;
    if (!command || !host) return { answered: false };
    return { answered: host.cli[command] === true };
  }
  const endpoint = connection?.endpoint;
  if (!endpoint) return { answered: false };
  if (info.kind === 'hermes') {
    return { answered: await probeOpenAiCompatible(endpoint, apiKey, fetchFn) };
  }
  if (info.kind === 'a2a') {
    const card = await probeAgentCard(endpoint, apiKey, fetchFn);
    return card ? { answered: true, via: 'a2a', agentName: card.name } : { answered: false };
  }
  // An endpoint current (Vellum, OpenAGI): try the A2A door first, then an
  // OpenAI-compatible one, and remember which answered.
  const card = await probeAgentCard(endpoint, apiKey, fetchFn);
  if (card) return { answered: true, via: 'a2a', agentName: card.name };
  if (await probeOpenAiCompatible(endpoint, apiKey, fetchFn))
    return { answered: true, via: 'openai' };
  return { answered: false };
}

// ------------------------------------------------------------ hermes jobs

export interface HermesJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

/** The Hermes API server's job list lives beside its /v1 base at /api/jobs.
 *  Tolerant of the field names shifting between releases: a job needs an id
 *  and a name; everything else is best effort. Empty on any failure. */
export async function hermesJobs(
  baseUrl: string,
  apiKey: string | undefined,
  fetchFn: Fetch = fetch,
): Promise<HermesJob[]> {
  const root = baseUrl.replace(/\/v1\/?$/, '');
  try {
    const res = await fetchFn(`${root}/api/jobs`, withTimeout({ headers: authHeaders(apiKey) }));
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as { jobs?: unknown[] })?.jobs)
        ? (data as { jobs: unknown[] }).jobs
        : [];
    return list.flatMap((raw): HermesJob[] => {
      if (!raw || typeof raw !== 'object') return [];
      const j = raw as Record<string, unknown>;
      const id = str(j.id) ?? str(j.job_id);
      const name = str(j.name) ?? str(j.title) ?? str(j.prompt)?.slice(0, 60);
      if (!id || !name) return [];
      return [
        {
          id,
          name,
          schedule: str(j.schedule) ?? str(j.cron) ?? str(j.interval) ?? '',
          enabled: j.enabled !== false && j.paused !== true,
          lastRunAt: str(j.last_run_at) ?? str(j.lastRunAt),
          nextRunAt: str(j.next_run_at) ?? str(j.nextRunAt),
        },
      ];
    });
  } catch {
    return [];
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

// ------------------------------------------------- host probe and notes

function daemonHeaders(target: DaemonTarget): Record<string, string> {
  return { authorization: `Bearer ${target.token}`, accept: 'application/json' };
}

/** What the paired computer can host: over the bridge on the desktop, over
 *  the daemon when docked, undefined when neither is reachable. */
export async function currentsHost(
  daemon: DaemonTarget | undefined,
  fetchFn: Fetch = fetch,
): Promise<CurrentsHostProbe | undefined> {
  const b = desktopBridge();
  if (b) {
    try {
      return await b.currentsProbe();
    } catch {
      return undefined;
    }
  }
  if (!daemon) return undefined;
  try {
    const res = await fetchFn(
      `${daemon.baseUrl}/currents`,
      withTimeout({ headers: daemonHeaders(daemon) }),
    );
    if (!res.ok) return undefined;
    return (await res.json()) as CurrentsHostProbe;
  } catch {
    return undefined;
  }
}

/** The notes in the Hermes home on the paired computer. */
export async function hermesNotesList(
  daemon: DaemonTarget | undefined,
  fetchFn: Fetch = fetch,
): Promise<{ home: string; notes: HermesNoteMeta[] } | undefined> {
  const b = desktopBridge();
  if (b) {
    try {
      return await b.hermesNotes();
    } catch {
      return undefined;
    }
  }
  if (!daemon) return undefined;
  try {
    const res = await fetchFn(
      `${daemon.baseUrl}/currents/hermes/notes`,
      withTimeout({ headers: daemonHeaders(daemon) }),
    );
    if (!res.ok) return undefined;
    return (await res.json()) as { home: string; notes: HermesNoteMeta[] };
  } catch {
    return undefined;
  }
}

export async function hermesNoteRead(
  daemon: DaemonTarget | undefined,
  path: string,
  fetchFn: Fetch = fetch,
): Promise<HermesNote | undefined> {
  const b = desktopBridge();
  if (b) {
    try {
      return (await b.hermesNote(path)) ?? undefined;
    } catch {
      return undefined;
    }
  }
  if (!daemon) return undefined;
  try {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetchFn(
      `${daemon.baseUrl}/currents/hermes/notes/${encoded}`,
      withTimeout({ headers: daemonHeaders(daemon) }),
    );
    if (!res.ok) return undefined;
    return (await res.json()) as HermesNote;
  } catch {
    return undefined;
  }
}
