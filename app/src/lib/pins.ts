// Pinned models. A user can swipe a specific model in the Cloud Providers or
// Local LLMs sheet to pin it; pinned models surface under My Stack on the root
// model sheet for one-tap selection, and swipe there to unpin. Only concrete
// models pin (a Claude model, an on-device model), never the stack itself or a
// repo session. Pure helpers so the logic is testable and the store just saves
// the result.
import type { ConversationSource } from '../state/types.js';

/** A stable identity for a pinnable source, or undefined when it cannot pin. */
export function pinKey(s: ConversationSource): string | undefined {
  if (s.kind === 'cloud') return `cloud:${s.provider}:${s.model}`;
  if (s.kind === 'device') return `device:${s.modelId}`;
  return undefined;
}

export function isPinnable(s: ConversationSource): boolean {
  return pinKey(s) !== undefined;
}

export function isPinned(pins: ConversationSource[] | undefined, s: ConversationSource): boolean {
  const k = pinKey(s);
  return Boolean(k && (pins ?? []).some((p) => pinKey(p) === k));
}

/** Add the source if absent, remove it if present. Returns the next list. */
export function togglePin(
  pins: ConversationSource[] | undefined,
  s: ConversationSource,
): ConversationSource[] {
  const k = pinKey(s);
  const current = pins ?? [];
  if (!k) return current;
  return isPinned(current, s) ? current.filter((p) => pinKey(p) !== k) : [...current, s];
}
