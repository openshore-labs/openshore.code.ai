// The one owner of the phone's single model slot. The native runner holds
// exactly one loaded model, but every device chat keeps its own driver alive,
// and each driver used to remember only what it loaded last. Open a Harbor
// chat, then a Qwen chat, come back to Harbor and send: the slot held Qwen, and
// Harbor's prompt ran against it (APP-3). Every driver now asks here before
// every generate; a mismatch (another model, or the same model at another
// context size) reloads, and a match is free.
import { Llama } from '../lib/llamaPlugin.js';

interface Slot {
  id: string;
  contextSize: number;
}

let slot: Slot | undefined;

/** How long a started reply may go without a token before the JS side ends
 *  the task itself. The native side can lose a request (a load from another
 *  chat unloading the model mid-reply, UI-1); without this the chat spins
 *  forever. Prompt processing on a phone with a full context can take a
 *  while before the first token, so this is generous. */
export const STALL_TIMEOUT_MS = 120_000;

/** How long a stop waits for the native runner's generationDone before the
 *  driver ends the turn itself. A stop that the runner never acknowledges
 *  (the request was already lost) must not leave the chat busy. */
export const ABORT_BEAT_MS = 1500;

/** The context window every device model loads with. Harbor Lite once loaded
 *  at 2048 to keep its KV cache small, but its system prompt (persona, app
 *  facts, the setup step) alone runs past 2048 tokens, so the prompt overflowed
 *  before the question was read and the reply came back empty: the chat sat on
 *  "Warming up Harbor Lite" with nothing under it. A 135M model's cache at 4096
 *  is under 100 MB, so one size for every device model is cheap and safe. */
export const DEVICE_CONTEXT_TOKENS = 4096;

/** A conservative characters-per-token figure for sizing a prompt without the
 *  model's tokenizer. English prose runs near four; code and markdown run
 *  lower, so this errs toward a smaller history rather than an overflow. */
const CHARS_PER_TOKEN = 3.2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The user turn that opens a trimmed history when the kept window starts on
 *  the assistant's own lines. */
export const TRIMMED_HISTORY_OPENER = '(Earlier messages in this chat were trimmed to fit.)';

/** The newest turns that fit the window beside the system prompt and room for
 *  the reply, oldest dropped first. The live question (the last message) is
 *  always kept, and history never opens on an assistant turn, since a chat
 *  template expects a user turn first (a chat that fits whole goes as it is).
 *  When the kept window starts on
 *  assistant turns, a short opener goes in front rather than those turns being
 *  dropped: the guided setup posts several guide lines in a row, and dropping
 *  them left the model with only the question and none of the thread. */
export function fitDeviceHistory<M extends { role: 'user' | 'assistant'; content: string }>(
  system: string,
  messages: M[],
  replyTokens: number,
  contextTokens: number = DEVICE_CONTEXT_TOKENS,
): M[] {
  if (messages.length === 0) return messages;
  let budget =
    contextTokens - replyTokens - estimateTokens(system) - estimateTokens(TRIMMED_HISTORY_OPENER);
  let start = messages.length - 1;
  budget -= estimateTokens(messages[start]!.content);
  while (start > 0) {
    const cost = estimateTokens(messages[start - 1]!.content);
    if (cost > budget) break;
    budget -= cost;
    start -= 1;
  }
  // Nothing trimmed: the chat goes as it is, even when it opens on the guide's
  // greeting, so the model is never told messages were dropped when none were.
  if (start === 0) return messages;
  const kept = messages.slice(start);
  if (kept[0]!.role === 'user') return kept;
  return [{ ...kept[0]!, role: 'user', content: TRIMMED_HISTORY_OPENER }, ...kept];
}

/** What a device reply that ended with no words says, instead of ending
 *  silently under the "Warming up" line. */
export function emptyReplyMessage(modelName: string): string {
  return `${modelName} did not come up with an answer. Try asking again, or in fewer words.`;
}

export type EnsureDeviceModel = { ok: true } | { ok: false; detail: string };

/** The model id in the slot right now, as far as the JS side knows. */
export function loadedDeviceModel(): string | undefined {
  return slot?.id;
}

/** The slot's model is gone or unknown (an error, a delete, an unload):
 *  the next ensure reloads no matter what. */
export function forgetDeviceModel(): void {
  slot = undefined;
}

// The native side can unload the model on its own, e.g. when iOS raises a
// memory warning and the plugin drops the weights to keep the app alive. When
// that happens the slot no longer reflects reality, so forget it here and the
// next send reloads. Subscribed once, lazily, the first time a device model is
// ensured, so importing this module has no side effect and the web stub (which
// never emits the event) costs nothing.
let unloadWatchStarted = false;
function watchNativeUnload(): void {
  if (unloadWatchStarted) return;
  unloadWatchStarted = true;
  void Llama.addListener('deviceModelUnloaded', () => forgetDeviceModel()).catch(() => {
    // A build without the event (older native) simply never fires it; the
    // error/watchdog recovery path in onDeviceDriver still heals the slot.
    unloadWatchStarted = false;
  });
}

/** Make `id` the model in the slot at `contextSize`, loading it if it is not
 *  already. `onStatus` carries the human "warming up" line so the chat can
 *  show it only when a load actually happens. */
export async function ensureDeviceModel(
  model: { id: string; name: string; contextSize: number },
  onStatus?: (message: string) => void,
): Promise<EnsureDeviceModel> {
  watchNativeUnload();
  if (slot && slot.id === model.id && slot.contextSize === model.contextSize) return { ok: true };
  // A model kept in iCloud may be evicted (placeholder only). Pull its bytes
  // down first; a device-stored model is a no-op. If it cannot be fetched
  // (offline with an evicted model), fail with a real message rather than a
  // load error that reads as corruption.
  const local = await Llama.ensureLocal({ id: model.id }).catch(() => ({ ready: true }));
  if (!local.ready) {
    return {
      ok: false,
      detail: `${model.name} lives in your iCloud and is not on this device yet. Connect to the internet so it can download, then try again.`,
    };
  }
  onStatus?.(`Warming up ${model.name} on this device.`);
  // Whatever was in the slot is about to be replaced; forget it before the
  // load so a failure never leaves a stale claim behind.
  slot = undefined;
  const load = await Llama.load({ id: model.id, contextSize: model.contextSize });
  if (!load.ok) {
    return {
      ok: false,
      detail:
        load.detail ?? `${model.name} would not load. Download it again from Settings, Harbor.`,
    };
  }
  slot = { id: model.id, contextSize: model.contextSize };
  return { ok: true };
}
