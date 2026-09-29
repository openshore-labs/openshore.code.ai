// The security package's store logic (CTO 9: a sibling module, store.ts only
// wires it in): the truncation card's item and its "Give it more room" tap,
// and the ticked files a commit approval carries back.
import type { DriverEvent } from 'os-code/protocol';
import type { ChatDriver } from '../drivers/types.js';
import type { ThreadItem } from './types.js';

type WindowCutEvent = Extract<DriverEvent, { type: 'window-cut' }>;
type WindowCutItem = Extract<ThreadItem, { kind: 'window-cut' }>;

/** The card a `window-cut` event becomes (CX 6). The engine sends it once per
 *  chat per model, so every event is a card. */
export function windowCutItem(event: WindowCutEvent): Omit<WindowCutItem, 'id'> {
  return {
    kind: 'window-cut',
    model: event.model,
    provider: event.provider,
    ...(event.room ? { room: event.room } : {}),
    ...(event.room === 'more' && event.gb !== undefined ? { gb: event.gb } : {}),
  };
}

/** What the tap on "Give it more room" changes on its card. */
export type WindowCutPatch = Pick<WindowCutItem, 'state' | 'error'>;

/**
 * The tap on "Give it more room": asks the session's computer to serve this
 * provider's models the larger window (`numCtx: 'auto'`, CTO 5), reporting
 * each step through `patch` so the card answers at once and settles on the
 * result. A driver that cannot (a chat that does not run on a computer) says
 * so in plain words.
 */
export async function giveMoreRoomFor(
  driver: ChatDriver | undefined,
  provider: string,
  patch: (next: WindowCutPatch) => void,
): Promise<void> {
  if (!driver?.giveMoreRoom) {
    patch({
      state: undefined,
      error: 'This chat is not running on your computer, so there is no model here to give room.',
    });
    return;
  }
  patch({ state: 'giving', error: undefined });
  let result: { ok: true; provider: string } | { error: string };
  try {
    result = await driver.giveMoreRoom(provider);
  } catch {
    result = { error: 'Could not reach your computer to give the model more room.' };
  }
  if ('error' in result) patch({ state: undefined, error: result.error });
  else patch({ state: 'given', error: undefined });
}

/** The ticked files an answer carries, only for a commit card and only as a
 *  list of strings (D3). */
export function answerFiles(files: unknown): { files: string[] } | Record<string, never> {
  return Array.isArray(files) && files.every((f) => typeof f === 'string')
    ? { files: files as string[] }
    : {};
}
