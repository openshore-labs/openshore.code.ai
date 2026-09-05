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
      detail: load.detail ?? `${model.name} would not load. Re-download it from the marketplace.`,
    };
  }
  slot = { id: model.id, contextSize: model.contextSize };
  return { ok: true };
}
