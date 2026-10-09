// The model list an address you connect offers (bring your own keys, Part 2,
// 2026-10-09). The Stack's Connect a model reads it so the person ticks models
// instead of typing ids: GET {base}/models with a Bearer key for the OpenAI
// format, GET {base}/v1/models with x-api-key and anthropic-version for the
// Anthropic one. The answer is read by the same reader Cloud Connections uses
// for a named provider's list (parseLiveModels). Through the native shim, on a
// clock, so an address that never answers cannot hold the sheet; the key goes
// only to the address the person typed. A refusal (401 or 403: a wrong or
// missing key) is said as one, so the person fixes the key rather than
// connecting on a key the address has just turned down; undefined when there
// is no list to pick from, and a typed model name is the way on.
import { nativeFetch } from './nativeFetch.js';
import { parseLiveModels, type LiveModel } from './providers.js';
import { normalizeAnthropicBase, normalizeBaseUrl, type ByomWire } from './byom.js';

/** How long a list read waits before the sheet offers a typed name. */
export const BYOM_LIST_TIMEOUT_MS = 8000;

/** The request a list read sends, for the address and its format. The
 *  Anthropic format pages its list, so one page asks for as many as it may. */
export function byomListRequest(
  baseUrl: string,
  wire: ByomWire,
  key?: string,
): { url: string; headers: Record<string, string> } {
  const k = key?.trim();
  if (wire === 'anthropic') {
    return {
      url: `${normalizeAnthropicBase(baseUrl)}/v1/models?limit=1000`,
      headers: { 'anthropic-version': '2023-06-01', ...(k ? { 'x-api-key': k } : {}) },
    };
  }
  return {
    url: `${normalizeBaseUrl(baseUrl)}/models`,
    headers: k ? { authorization: `Bearer ${k}` } : {},
  };
}

/** The chat models an address lists; 'refused' when it turned the key (or
 *  its absence) down; undefined when there is no list to pick from (no
 *  answer in time, another failure, an unreadable or empty one). */
export async function readByomModels(
  baseUrl: string,
  wire: ByomWire,
  key?: string,
): Promise<LiveModel[] | 'refused' | undefined> {
  const { url, headers } = byomListRequest(baseUrl, wire, key);
  try {
    const res = await nativeFetch(url, {
      method: 'GET',
      headers,
      responseType: 'json',
      timeoutMs: BYOM_LIST_TIMEOUT_MS,
    });
    if (res.status === 401 || res.status === 403) return 'refused';
    if (!res.ok) return undefined;
    const models = parseLiveModels('byom', await res.json());
    return models.length ? models : undefined;
  } catch {
    return undefined;
  }
}
