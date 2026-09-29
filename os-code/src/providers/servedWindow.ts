// The window a local server really serves (C1, the small model's true window).
// Ollama serves every request its own default unless the request or the
// model's Modelfile names another, and cuts whatever does not fit without a
// word. The engine budgets against that window, not the model's own, so a 32k
// budget never runs into a 4k server. This module holds the defaults by
// Ollama version, the cost of a larger window, and the one action that gives
// a model more room: `providers.<id>.numCtx: 'auto'` in machine config, in
// force for every provider on that server from its next request.
import { loadConfig, saveGlobalConfig } from '../config/load.js';
import type { OscConfig } from '../config/schema.js';

export type { MoreRoom } from './types.js';

/** The window Ollama serves a model when nothing asks for another, from
 *  0.6.7 on. From 0.15.5 the default follows the graphics memory (4096 under
 *  24 GiB, 32768 to 48 GiB, 262144 above), and 4096 is its lowest tier: a
 *  server started with `OLLAMA_CONTEXT_LENGTH`, or on a large graphics card,
 *  serves more than this, which /api/show cannot see. So this errs low: the
 *  cost is an earlier compaction, never a prompt cut without a word. */
export const OLLAMA_DEFAULT_NUM_CTX = 4096;

/** Ollama's default before 0.6.7. */
export const OLLAMA_OLD_DEFAULT_NUM_CTX = 2048;

/** The first Ollama release that served 4096 by default. */
const FOUR_K_SINCE: readonly [number, number, number] = [0, 6, 7];

/** The default window for an Ollama `version` ("0.6.7", "0.12.3-rc1"). An
 *  unknown or unreadable version gets the smaller default, never more. */
export function ollamaDefaultNumCtx(version: string | undefined): number {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version?.trim() ?? '');
  if (!m) return OLLAMA_OLD_DEFAULT_NUM_CTX;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i]! > FOUR_K_SINCE[i]!) return OLLAMA_DEFAULT_NUM_CTX;
    if (v[i]! < FOUR_K_SINCE[i]!) return OLLAMA_OLD_DEFAULT_NUM_CTX;
  }
  return OLLAMA_DEFAULT_NUM_CTX;
}

/** Bytes one token of context holds in memory, from /api/show's model_info:
 *  a key and a value per layer per key-value head, at two bytes each (the
 *  f16 cache Ollama keeps by default). Undefined when the model does not say
 *  enough to work it out. */
export function kvBytesPerToken(modelInfo: Record<string, unknown>): number | undefined {
  const field = (suffix: string): number | undefined => {
    for (const [k, v] of Object.entries(modelInfo)) {
      if (!k.endsWith(suffix)) continue;
      if (typeof v === 'number' && v > 0) return v;
      // Some models list a count per layer; the largest is the safe reading.
      if (Array.isArray(v)) {
        const nums = v.filter((n): n is number => typeof n === 'number' && n > 0);
        if (nums.length) return Math.max(...nums);
      }
    }
    return undefined;
  };
  const layers = field('.block_count');
  const kvHeads = field('.attention.head_count_kv') ?? field('.attention.head_count');
  const heads = field('.attention.head_count');
  const embedding = field('.embedding_length');
  const headDim = heads && embedding ? embedding / heads : undefined;
  const keyLength = field('.attention.key_length') ?? headDim;
  const valueLength = field('.attention.value_length') ?? headDim;
  if (!layers || !kvHeads || !keyLength || !valueLength) return undefined;
  return layers * kvHeads * (keyLength + valueLength) * 2;
}

/** The GB a larger window costs, rounded up to a tenth, from the bytes a
 *  token holds; undefined when that is unknown. */
export function extraGB(fromTokens: number, toTokens: number, bytesPerToken: number | undefined) {
  if (bytesPerToken === undefined || toTokens <= fromTokens) return undefined;
  const gb = ((toTokens - fromTokens) * bytesPerToken) / 1024 ** 3;
  return Math.max(0.1, Math.ceil(gb * 10) / 10);
}

// Servers the person gave more room in this process, by base URL. Every
// provider on one reads 'auto' from its next request, the way the machine
// config just written reads for a session that starts later: "from your next
// message, in every chat". A process-wide set on purpose, since each session
// builds its own provider registry over the same server.
const moreRoomServers = new Set<string>();

function normalize(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

/** Whether the person gave this server more room since the process started. */
export function hasMoreRoom(baseUrl: string): boolean {
  return moreRoomServers.has(normalize(baseUrl));
}

/** Test seam: forget every server given more room. */
export function _resetMoreRoom(): void {
  moreRoomServers.clear();
}

/**
 * The truncation card's action: serve this provider's models the larger
 * window from now on. Writes `providers.<id>.numCtx: 'auto'` to machine config
 * (the whole endpoint, so a provider that came from the schema default is
 * written out whole and the file stays valid), and switches every live
 * provider on that server from its next request. Only an OpenAI-compatible
 * endpoint takes it; Ollama is the one server that reads it.
 */
export function giveMoreRoom(
  config: OscConfig,
  providerId: string,
): { ok: true; provider: string } | { error: string } {
  const endpoint = config.providers[providerId];
  if (!endpoint || endpoint.kind !== 'openai-compatible') {
    return { error: `There is no local model server named ${providerId} on this computer.` };
  }
  try {
    saveGlobalConfig({ providers: { [providerId]: { ...endpoint, numCtx: 'auto' } } });
  } catch (err) {
    return { error: (err as Error).message };
  }
  moreRoomServers.add(normalize(endpoint.baseUrl));
  return { ok: true, provider: providerId };
}

/** `giveMoreRoom` against this computer's own config as it stands now: the
 *  providers are machine config, never a project's, so the daemon and the
 *  desktop host read them fresh from the file. */
export function giveMoreRoomHere(
  providerId: string,
): { ok: true; provider: string } | { error: string } {
  return giveMoreRoom(loadConfig().config, providerId);
}
