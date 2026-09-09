// Agentic Currents and Wayfinding: the pure core.
//
// The founder's frame (2026-09-09): the app evolves by connecting to new tech
// and layering it in, never by reshaping the familiar rooms. Two groups in
// Settings hold that promise. Wayfinding (memory, skills, browser) is how the
// agent finds its way and is on by default. Agentic Currents (Hermes Agent,
// CLI Pairing, Vellum, OpenAGI, A2A) are opt-in modalities for agent work, a
// BETA, one on at a time everywhere: flip one on and the same rooms gain rows
// for it (a Bench entry, a Crew member, a Vault folder, a tool for the coding
// agent, a header pill); flip it off and every trace is gone.
//
// Everything here is pure and tested. Every room renders a current ONLY
// through `activeContribution`, never by naming one itself; the guard test
// keeps it so, which is what makes "off leaves no trace" a fact rather than a
// hope. The name "Currents" is the CMO and Creative Studio's (water in motion
// through the familiar app); "Layers" was retired as a mechanism word.
import type { CurrentsHandles, CurrentsHostProbe } from 'os-code/protocol';
import { AGENTIC_CURRENT_IDS, type AgenticCurrentId } from 'os-code/protocol';
import type { StackModelRef } from './stack.js';
import { byomSecretKey } from './byom.js';
import type { SetupGuideId } from './setupGuides.js';

export type { AgenticCurrentId } from 'os-code/protocol';
export { AGENTIC_CURRENT_IDS } from 'os-code/protocol';

// ------------------------------------------------------------- wayfinding

export type WayfindingId = 'memory' | 'skills' | 'browser';
export const WAYFINDING_IDS: readonly WayfindingId[] = ['memory', 'skills', 'browser'];

export interface WayfindingInfo {
  id: WayfindingId;
  label: string;
  /** One line under the label, the truth about what it does today. */
  sub: string;
}

export const WAYFINDING: Record<WayfindingId, WayfindingInfo> = {
  memory: {
    id: 'memory',
    label: 'Memory',
    sub: 'The agent keeps project notes in your vault and reads them back into every session there.',
  },
  skills: {
    id: 'skills',
    label: 'Skills',
    sub: 'Reusable recipes the agent wrote or you gave it, kept as markdown it reads before it builds.',
  },
  browser: {
    id: 'browser',
    label: 'Browser',
    sub: 'A driven browser on your paired computer. Every action asks first. Docked only.',
  },
};

export type WayfindingSettings = Partial<Record<WayfindingId, boolean>>;

/** Wayfinding is on unless the person turned it off: missing means on. */
export function wayfindingOn(
  settings: { wayfinding?: WayfindingSettings },
  id: WayfindingId,
): boolean {
  return settings.wayfinding?.[id] !== false;
}

// ------------------------------------------------------------ the roster

/** How a current connects, which decides its sheet and which engine tool it
 *  hands the session. */
export type CurrentConnectKind = 'hermes' | 'cli' | 'a2a' | 'endpoint';

export interface AgenticCurrentInfo {
  id: AgenticCurrentId;
  label: string;
  /** One line under the label. */
  sub: string;
  /** What has to exist for it to be On. Shown while it is arriving. */
  needs: string;
  kind: CurrentConnectKind;
  /** False for a current with no known integration surface yet: it lists as
   *  Arriving, full opacity, and the endpoint sheet still lets a person try a
   *  URL their install exposes (A2A card or OpenAI-compatible). */
  available: boolean;
  guide: SetupGuideId;
}

export const AGENTIC_CURRENTS: AgenticCurrentInfo[] = [
  {
    id: 'hermes',
    label: 'Hermes Agent',
    sub: 'An always-on agent on a computer you own, with its own memory and skills.',
    needs: 'A Hermes box reachable over your Tailscale network, with its API server on.',
    kind: 'hermes',
    available: true,
    guide: 'connect-hermes',
  },
  {
    id: 'cli',
    label: 'CLI Pairing',
    sub: 'Claude Code or Codex on your paired computer, as a specialist your stack can hand work to.',
    needs: 'Claude Code or Codex installed on the paired computer.',
    kind: 'cli',
    available: true,
    guide: 'cli-pairing',
  },
  {
    id: 'vellum',
    label: 'Vellum',
    sub: 'An open-source assistant whose memory follows you across surfaces.',
    needs:
      'Vellum has no documented API yet. If your install exposes an A2A card or an OpenAI-compatible endpoint, paste its address and OpenShore will try.',
    kind: 'endpoint',
    available: false,
    guide: 'connect-a2a',
  },
  {
    id: 'openagi',
    label: 'OpenAGI',
    sub: 'A self-improving agent that learns from how you work.',
    needs:
      'OpenAGI runs in-process with no network API yet. If your install exposes an A2A card or an OpenAI-compatible endpoint, paste its address and OpenShore will try.',
    kind: 'endpoint',
    available: false,
    guide: 'connect-a2a',
  },
  {
    id: 'a2a',
    label: 'A2A',
    sub: 'Any agent that speaks the open agent-to-agent protocol. The generic door.',
    needs: 'An agent that publishes an A2A agent card at an address you can reach.',
    kind: 'a2a',
    available: true,
    guide: 'connect-a2a',
  },
];

export function currentInfo(id: AgenticCurrentId): AgenticCurrentInfo {
  return AGENTIC_CURRENTS.find((c) => c.id === id)!;
}

/** The BETA line under the group heading. Honest about what beta means here. */
export const AGENTIC_CURRENTS_BETA_LINE =
  'An imperfect addition we are exploring. One on at a time. Off leaves no trace.';

// ---------------------------------------------------------- connections

/** What the person saved for a current. Metadata only; an API key lives in
 *  the secret store under currentSecretKey(id). */
export interface CurrentConnection {
  /** hermes: the OpenAI-compatible base URL ending in /v1. a2a and endpoint:
   *  the agent's base address. cli: unused. */
  endpoint?: string;
  /** For hermes and an OpenAI-compatible endpoint: the model id to send. */
  model?: string;
  /** For cli: which CLI. */
  command?: 'claude' | 'codex';
  /** For an endpoint current: which door the probe found it answers on. */
  via?: 'a2a' | 'openai';
  /** The agent's name from its A2A card, once read. */
  agentName?: string;
}

export type CurrentConnections = Partial<Record<AgenticCurrentId, CurrentConnection>>;

/** The secret-store key holding a current's API key. For a current that also
 *  sits on the bench as a model, this is the same key the BYOM path reads, so
 *  the bench row works with no second copy of the secret. */
export function currentSecretKey(id: AgenticCurrentId): string {
  return byomSecretKey(currentBenchId(id));
}

/** The stable BYOM-shaped id a current's bench entry carries. Prefixed so a
 *  room can tell it from a hand-connected model and so turning the current
 *  off can purge it from every stack. */
export function currentBenchId(id: AgenticCurrentId): string {
  return `current-${id}`;
}

export function isCurrentBenchId(benchId: string): boolean {
  return benchId.startsWith('current-');
}

// ------------------------------------------------------------ the state

export type CurrentState = 'off' | 'arriving' | 'ready' | 'on';

export interface CurrentsSettings {
  agenticCurrent?: AgenticCurrentId | null;
  currentConnections?: CurrentConnections;
}

/** Live facts a probe established: whether the saved connection answered. */
export type CurrentProbes = Partial<Record<AgenticCurrentId, boolean>>;

export function activeCurrent(settings: CurrentsSettings): AgenticCurrentId | null {
  const id = settings.agenticCurrent;
  return id && (AGENTIC_CURRENT_IDS as readonly string[]).includes(id) ? id : null;
}

/** Whether a current has what it needs saved (not whether it answers). */
export function currentConfigured(id: AgenticCurrentId, settings: CurrentsSettings): boolean {
  const c = settings.currentConnections?.[id];
  if (!c) return false;
  const info = currentInfo(id);
  if (info.kind === 'cli') return c.command === 'claude' || c.command === 'codex';
  return typeof c.endpoint === 'string' && c.endpoint.length > 0;
}

/** The two-part gate, as one pure decision: the toggle AND a live probe.
 *    on        the toggle is on and the connection answered
 *    arriving  the toggle is on and it has not (nothing saved, or unreachable)
 *    ready     saved and answering, but the toggle is off (or another is on)
 *    off       nothing saved, toggle off */
export function currentState(
  id: AgenticCurrentId,
  settings: CurrentsSettings,
  probes: CurrentProbes,
): CurrentState {
  const active = activeCurrent(settings) === id;
  const answered = currentConfigured(id, settings) && probes[id] === true;
  if (active) return answered ? 'on' : 'arriving';
  return answered ? 'ready' : 'off';
}

export function currentStateLabel(state: CurrentState): string {
  switch (state) {
    case 'on':
      return 'On';
    case 'arriving':
      return 'Arriving';
    case 'ready':
      return 'Ready';
    default:
      return 'Off';
  }
}

/** One line for the row: what is true right now, and what it needs. */
export function currentStateLine(
  id: AgenticCurrentId,
  settings: CurrentsSettings,
  probes: CurrentProbes,
): string {
  const info = currentInfo(id);
  const state = currentState(id, settings, probes);
  const c = settings.currentConnections?.[id];
  if (state === 'on') {
    if (info.kind === 'cli') return `On. ${cliLabel(c?.command)} on your paired computer.`;
    if (c?.agentName) return `On. ${c.agentName} answered at ${hostOf(c.endpoint)}.`;
    return `On. Answering at ${hostOf(c?.endpoint)}.`;
  }
  if (state === 'arriving') {
    if (!currentConfigured(id, settings)) return `Arriving. ${info.needs}`;
    if (info.kind === 'cli')
      return `Arriving. ${cliLabel(c?.command)} is not on the paired computer yet, or you are not docked.`;
    return `Arriving. ${hostOf(c?.endpoint)} did not answer yet. Check the box is up and you are on its network.`;
  }
  if (state === 'ready') return `Ready. Turn it on to bring it in.`;
  return info.sub;
}

export function cliLabel(command: 'claude' | 'codex' | undefined): string {
  return command === 'codex' ? 'Codex' : 'Claude Code';
}

/** Just the host of an address, for copy. */
export function hostOf(url: string | undefined): string {
  if (!url) return 'the address';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Decide the next active current when a switch is flipped: one at a time
 *  everywhere (founder, 2026-09-09), so turning one on turns the other off. */
export function nextActiveCurrent(
  current: AgenticCurrentId | null,
  id: AgenticCurrentId,
  on: boolean,
): AgenticCurrentId | null {
  if (on) return id;
  return current === id ? null : current;
}

// ------------------------------------------------------ the contribution

/** A slot a current fills, or the reason it cannot. Every current fills every
 *  slot one way or the other, and a test refuses one that leaves a slot silent.
 *  That contract is the "mirrored pattern": the rooms render every current
 *  through the same slots, so the modality reads the same whichever is on. */
export type Slot<T> = T | { none: string };

export function slotNone<T>(slot: Slot<T>): slot is { none: string } {
  return typeof slot === 'object' && slot !== null && 'none' in slot;
}

export interface CurrentContribution {
  id: AgenticCurrentId;
  label: string;
  /** A model on the bench, placeable like any BYOM ref. */
  bench: Slot<{ ref: StackModelRef; pill: string }>;
  /** A member in Crew command, with the line under its name. */
  crew: Slot<{ name: string; line: string; jobsFrom?: 'hermes' }>;
  /** A folder in the Vault. */
  vault: Slot<{ title: string; sub: string; source: 'hermes-home' }>;
  /** The engine tools this current hands the coding agent. */
  tools: Slot<{ names: string[] }>;
  guide: SetupGuideId;
  /** The pill beside the reach pill while it is on. */
  header: { label: string };
}

export const CONTRIBUTION_SLOTS = ['bench', 'crew', 'vault', 'tools'] as const;

/** What a current adds to the rooms, given the saved connection. Pure. */
export function contributionFor(
  id: AgenticCurrentId,
  settings: CurrentsSettings,
): CurrentContribution {
  const info = currentInfo(id);
  const c = settings.currentConnections?.[id];
  const base = { id, label: info.label, guide: info.guide, header: { label: info.label } };
  switch (id) {
    case 'hermes':
      return {
        ...base,
        bench: c?.endpoint
          ? {
              ref: {
                kind: 'byom',
                id: currentBenchId(id),
                label: 'Hermes',
                baseUrl: c.endpoint,
                model: c.model || 'hermes',
              },
              pill: 'via Hermes',
            }
          : { none: 'Connect the Hermes box first.' },
        crew: {
          name: 'Hermes',
          line: 'Runs on its own computer. Its scheduled jobs show here.',
          jobsFrom: 'hermes',
        },
        vault: {
          title: 'Hermes memory',
          sub: 'What Hermes remembers and the skills it wrote, read from its home folder on the paired computer.',
          source: 'hermes-home',
        },
        tools: { names: ['askHermes'] },
      };
    case 'cli':
      return {
        ...base,
        bench: {
          none: 'A CLI is a runner, not a model. It is handed work through the cliAgent tool.',
        },
        crew: {
          name: cliLabel(c?.command),
          line: 'On your paired computer. A coding chat can hand it a task you approve.',
        },
        vault: {
          none: 'A CLI keeps its memory in the repo, which the Vault already shows under Coding projects.',
        },
        tools: { names: ['cliAgent'] },
      };
    case 'a2a':
      return {
        ...base,
        bench: { none: 'An agent is not a model. It is handed work through the askAgent tool.' },
        crew: {
          name: c?.agentName || 'A2A agent',
          line: 'Reached over the agent-to-agent protocol. Runs under its own rules.',
        },
        vault: { none: 'A2A carries messages, not files. Nothing to read here.' },
        tools: { names: ['askAgent'] },
      };
    case 'vellum':
    case 'openagi': {
      const endpointModel = c?.via === 'openai' && c.endpoint;
      return {
        ...base,
        bench: endpointModel
          ? {
              ref: {
                kind: 'byom',
                id: currentBenchId(id),
                label: info.label,
                baseUrl: c.endpoint!,
                model: c.model || 'default',
              },
              pill: `via ${info.label}`,
            }
          : { none: `${info.label} has no OpenAI-compatible endpoint connected.` },
        crew: {
          name: c?.agentName || info.label,
          line:
            c?.via === 'a2a'
              ? 'Reached over the agent-to-agent protocol. Runs under its own rules.'
              : 'Arriving. It shows here once an address answers.',
        },
        vault: { none: `${info.label} has no documented memory files to read yet.` },
        tools: c?.via === 'a2a' ? { names: ['askAgent'] } : { none: 'No agent door answered yet.' },
      };
    }
  }
}

/** The active current's contribution, or undefined when none is on. The one
 *  way a room learns a current exists: with none on, this is undefined and the
 *  room renders exactly as it did before currents existed. */
export function activeContribution(settings: CurrentsSettings): CurrentContribution | undefined {
  const id = activeCurrent(settings);
  return id ? contributionFor(id, settings) : undefined;
}

/** The bench refs the active current adds. Empty when none is on. */
export function currentBenchRefs(settings: CurrentsSettings): StackModelRef[] {
  const c = activeContribution(settings);
  if (!c || slotNone(c.bench)) return [];
  return [c.bench.ref];
}

// --------------------------------------------------------- the handles

/** The per-session handle the engine gets for the active current, built from
 *  the saved connection and its secret. Undefined when none is on or nothing
 *  usable is saved, which leaves every current tool out of the session. */
export function currentsHandles(
  settings: CurrentsSettings,
  apiKey: string | undefined,
  host?: CurrentsHostProbe,
): CurrentsHandles | undefined {
  const id = activeCurrent(settings);
  if (!id) return undefined;
  const c = settings.currentConnections?.[id];
  const info = currentInfo(id);
  if (info.kind === 'hermes') {
    if (!c?.endpoint) return undefined;
    return { hermes: { baseUrl: c.endpoint, apiKey, model: c.model || undefined } };
  }
  if (info.kind === 'a2a' || (info.kind === 'endpoint' && c?.via === 'a2a')) {
    if (!c?.endpoint) return undefined;
    return { a2a: { agentUrl: c.endpoint, apiKey } };
  }
  if (info.kind === 'cli') {
    const command = c?.command;
    if (!command) return undefined;
    // Only hand over a CLI the host actually has, when we know.
    if (host && !host.cli[command]) return undefined;
    return { cli: { command } };
  }
  return undefined;
}
