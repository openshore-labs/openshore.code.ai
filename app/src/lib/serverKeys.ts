// Keys on your server (2026-10-09; docs/design/byok-any-provider-plan.md,
// part 3), the app's pure half: which of this device's providers a docked
// server can keep a key for, what goes with each key, the models this device
// knows for a provider the server keeps a key for, and the plain words for
// where a docked machine's model runs. The wire is drivers/remoteDriver.ts,
// the lifecycle state/serverKeysOps.ts, the room Cloud Connections. Pure, so
// the choices and the copy are a tested rule (app/test/serverKeys.test.tsx).
import type { DaemonPutKeyBody, DaemonStackInfo } from 'os-code/protocol';
import type { DaemonTarget } from '../drivers/remoteDriver.js';
import type { HubRole } from '../drivers/types.js';
import { PROVIDERS, providerBenchModels, providerInfo, type ProviderInfo } from './providers.js';

/** A provider a server can keep a key for: Claude, whose key goes only to
 *  Anthropic's own address, and every provider whose OpenAI-compatible API
 *  sits at an https address (the engine takes no other off its network). */
export function serverTakes(p: Pick<ProviderInfo, 'id' | 'openaiBaseUrl'>): boolean {
  return p.id === 'anthropic' || Boolean(p.openaiBaseUrl?.startsWith('https://'));
}

/** This device's connected providers a server can take, in Cloud
 *  Connections' order. */
export function serverKeyProviders(connected: Record<string, boolean>): ProviderInfo[] {
  return PROVIDERS.filter((p) => connected[p.id] && serverTakes(p));
}

/** What goes with a key: Claude's with its workspace id and nothing else,
 *  every other provider's with its OpenAI-compatible base and its name, so
 *  the server needs no table of its own to reach it. */
export function serverPutBody(
  p: Pick<ProviderInfo, 'id' | 'name' | 'openaiBaseUrl'>,
  key: string,
  workspaceId?: string,
): DaemonPutKeyBody {
  if (p.id === 'anthropic') {
    const ws = workspaceId?.trim();
    return { key, ...(ws ? { workspaceId: ws } : {}) };
  }
  return { key, ...(p.openaiBaseUrl ? { baseUrl: p.openaiBaseUrl } : {}), label: p.name };
}

export interface ServerModelChoice {
  provider: string;
  /** The provider's name, as Cloud Connections shows it. */
  name: string;
  models: Array<{ id: string; label: string }>;
}

/** The models this device knows for each provider the server keeps a key
 *  for: Claude's lineup, a typed provider's list, a live provider's picks on
 *  this device. A model that only makes images cannot run a coding session,
 *  so it is not offered; a provider this device knows no models for is left
 *  out. */
export function serverModelChoices(held: readonly string[]): ServerModelChoice[] {
  return PROVIDERS.filter((p) => held.includes(p.id) && serverTakes(p))
    .map((p) => {
      const imageOnly = new Set(
        p.models.filter((m) => m.categories?.includes('image-gen')).map((m) => m.id),
      );
      return {
        provider: p.id,
        name: p.name,
        models: providerBenchModels(p)
          .filter((m) => !imageOnly.has(m.id))
          .map(({ id, label }) => ({ id, label })),
      };
    })
    .filter((c) => c.models.length > 0);
}

/** The window the engine keeps for a placed model, in tokens (WINDOW_MIN and
 *  WINDOW_MAX in os-code/src/auth/providerKeys.ts). */
const WINDOW_MIN = 1024;
const WINDOW_MAX = 10_000_000;

/** The window this device knows for a provider's model, sent with a
 *  placement so the server budgets against it. Claude's the server knows
 *  itself; a model whose list said nothing sends none, and the server keeps
 *  its cautious guess. */
export function serverModelWindow(provider: string, model: string): number | undefined {
  if (provider === 'anthropic') return undefined;
  const n = providerInfo(provider)?.models.find((m) => m.id === model)?.contextTokens;
  return n !== undefined && Number.isInteger(n) && n >= WINDOW_MIN && n <= WINDOW_MAX
    ? n
    : undefined;
}

/** Who a provider's models run at, by the company a person pays. */
const COMPANY: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  google: 'Google',
  moonshot: 'Moonshot',
};

function companyOf(provider: string): string | undefined {
  return Object.hasOwn(COMPANY, provider) ? COMPANY[provider] : providerInfo(provider)?.name;
}

/** The host a provider's key goes to by default, as this device knows it. */
function knownHost(provider: string): string | undefined {
  if (provider === 'anthropic') return 'api.anthropic.com';
  const base = providerInfo(provider)?.openaiBaseUrl;
  try {
    return base ? new URL(base).host : undefined;
  } catch {
    return undefined;
  }
}

/** Where a docked machine's model runs, for a row's sub. One that stays runs
 *  on the machine; a cloud one runs at its provider, on your key, and the
 *  machine only sends it each turn. `where` is "your server", "your
 *  computer" or "this computer". `host` is where the server says that
 *  provider's key goes (GET /keys, an admin's view only): one pointed
 *  somewhere other than the provider's own address is named by its host,
 *  never by a company that does not get the turn. */
export function dockedModelLine(
  orchestrator: NonNullable<DaemonStackInfo['orchestrator']>,
  where: string,
  host?: string,
): string {
  if (orchestrator.kind !== 'cloud') return `${orchestrator.model}, running on ${where}`;
  const known = knownHost(orchestrator.provider);
  if (host && known && host !== known) {
    return `${orchestrator.model}, at ${host} on your key, from ${where}`;
  }
  const company = companyOf(orchestrator.provider);
  return company
    ? `${orchestrator.model}, at ${company} on your key, from ${where}`
    : `${orchestrator.model}, a cloud model reached from ${where}`;
}

/** The same, as a sentence of its own: the Stack's docked card. */
export function dockedRunsLine(
  orchestrator: NonNullable<DaemonStackInfo['orchestrator']>,
  where: string,
): string {
  if (orchestrator.kind !== 'cloud') return `Runs ${orchestrator.model}.`;
  const company = companyOf(orchestrator.provider);
  return company
    ? `Runs ${orchestrator.model} at ${company} on your key, from ${where}.`
    : `Runs ${orchestrator.model}, a cloud model reached from ${where}.`;
}

/** A docked machine with no model yet, and how one is chosen. A server's
 *  is chosen from an admin device in Cloud Connections (whose Model on your
 *  server sheet also shows the SSH way, as the server's account); a
 *  computer's in its own Stack. */
export function dockedNoModelLine(
  target: Pick<DaemonTarget, 'kind'>,
  role: HubRole | undefined,
): string {
  if (target.kind !== 'server') {
    return 'No model set up on your computer yet. Set one up in the Stack, in OpenShore on that computer.';
  }
  if (role === 'member') return 'No model on your server yet. Its admin chooses one.';
  return 'No model on your server yet. Choose one in Cloud Connections, under Your server.';
}

/** The server named in a sentence: its own name, else "your server" when it
 *  is the only one, else its address. */
export function serverWhere(
  target: Pick<DaemonTarget, 'baseUrl' | 'name'>,
  servers: number,
): string {
  const named = target.name?.trim();
  if (named) return named;
  if (servers <= 1) return 'your server';
  try {
    return new URL(target.baseUrl).hostname;
  } catch {
    return target.baseUrl;
  }
}

/** A server named at the start of a sentence: "your server" (or a list that
 *  starts with it) takes its capital; a name or an address stays as written. */
export function whereStartsSentence(where: string): string {
  return where.startsWith('your ') ? `Y${where.slice(1)}` : where;
}

/** Names in a sentence: "Groq", "Groq and Claude", "Groq, Claude and Mistral". */
export function namesLine(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What turning a key on means, said once in the keys sheet. Each way out
 *  is tried once, so the line says what happens when the server is away. */
export const SERVER_KEYS_LEAD =
  'A key you turn on goes once over your private Tailscale link and is kept on that server, so its coding sessions can use it while this device sleeps. Turning it off, disconnecting the provider here, or forgetting the server deletes it there if the server answers then; if it does not, OpenShore shows how to delete it over SSH.';

/** How a server holds a key, in the engine's own words (auth/keyHome.ts):
 *  never called encrypted. Most rented servers have no keychain. */
export const SERVER_KEYS_HOLD =
  "A server with no keychain, as most rented ones are, keeps keys in a file only its OpenShore account and root can read, locked with the server's own name and id, so anyone who can read that file or a copy of its disk can read them. The company you rent from can reach that disk.";

/** What a cloud model as the server's model means for the rest of it: Crew
 *  routines (routines/scheduler.ts, ROUTINE_NEEDS_LOCAL_MODEL) and the free
 *  chat (daemon/freeChat.ts) refuse a model that leaves, so they stop while
 *  one is placed, and never use it (tech review 3). */
export const SERVER_MODEL_LOCAL_ONLY =
  "Routines and Chat with your server run only on a local model, so they do not run while a cloud model is the server's model.";
