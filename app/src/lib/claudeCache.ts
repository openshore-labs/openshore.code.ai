// A stable prefix in the app's Claude requests (Vault M5, CTO J16). The system
// prompt runs static, then per chat, then per task: the head (the base prompt,
// the standards, the project's own words) stays byte-identical from send to
// send, and everything that moves (the effort line, the walk line, the vault
// pack) rides a separate tail block after it. With prompt caching on, the head
// carries the one `cache_control` marker, and the request asks for automatic
// caching on the growing history too (two of the API's four slots).
//
// Off by default (`settings.promptCache`, no UI in M5): it flips on only with
// the eval number (CTO J19, tenet 2), so no copy claims a saving. Kept
// dependency-free like effort.ts: the store mirrors the setting here, and the
// drivers read it once per send. A prefix under the model's minimum simply
// does not cache; the request is still valid.
import type Anthropic from '@anthropic-ai/sdk';

let active = false;

/** Mirror `settings.promptCache` (the store calls this on load and change). */
export function setPromptCache(on: boolean): void {
  active = on;
}

/** Whether prompt caching is on right now. */
export function promptCacheOn(): boolean {
  return active;
}

/** The ephemeral marker, one shape for every use. */
const EPHEMERAL: Anthropic.CacheControlEphemeral = { type: 'ephemeral' };

/**
 * The system blocks for one Claude request: one block for the stable head
 * (marked for caching when `cache` is on), one for the volatile tail (the
 * parts joined, empty parts dropped), in that order. No tail means one block.
 * The same inputs always give the same bytes, so the head is a real prefix.
 */
export function claudeSystem(
  stable: string,
  volatile: readonly (string | undefined)[],
  cache: boolean,
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [];
  const head = stable.trim();
  if (head) {
    blocks.push({ type: 'text', text: head, ...(cache ? { cache_control: EPHEMERAL } : {}) });
  }
  const tail = volatile
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join('\n');
  if (tail) blocks.push({ type: 'text', text: tail });
  return blocks;
}

/** The request's top-level automatic caching for the growing history while
 *  caching is on; nothing while it is off (today's request, unchanged). */
export function claudeHistoryCache(cache: boolean): {
  cache_control?: Anthropic.CacheControlEphemeral;
} {
  return cache ? { cache_control: EPHEMERAL } : {};
}
