// The one owner of the phone's single model slot. The native runner holds
// exactly one loaded model, but every device chat keeps its own driver alive,
// and each driver used to remember only what it loaded last. Open a Harbor
// chat, then a Qwen chat, come back to Harbor and send: the slot held Qwen, and
// Harbor's prompt ran against it (APP-3). Every driver now asks here before
// every generate; a mismatch (another model, or the same model at another
// context size) reloads, and a match is free.
import { Llama } from '../lib/llamaPlugin.js';
import { fitSeed } from 'os-code/protocol';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import {
  HARBOR_CONTEXT_TOKENS,
  HARBOR_IMAGE_TOKENS,
  HARBOR_MAX_IMAGES,
  HARBOR_SAMPLING,
  HARBOR_THINK_BUDGET,
  HARBOR_THINK_SAMPLING,
  HARBOR_VISION_MODEL_ID,
  harborReadsImages,
  harborThinks,
  isHarbor,
} from '../lib/harbor.js';

interface Slot {
  id: string;
  contextSize: number;
  visionId?: string;
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

/** How a device model loads: its window, and its vision file when it has one
 *  on this device. Harbor loads wider than the rest (HARBOR_CONTEXT_TOKENS);
 *  every other device model keeps DEVICE_CONTEXT_TOKENS. */
export function deviceLoadFor(modelId: string): { contextSize: number; visionId?: string } {
  if (!isHarbor(modelId)) return { contextSize: DEVICE_CONTEXT_TOKENS };
  return {
    contextSize: HARBOR_CONTEXT_TOKENS,
    visionId: harborReadsImages() ? HARBOR_VISION_MODEL_ID : undefined,
  };
}

/** The sampling a device model's reply asks for: Harbor's own numbers
 *  (HARBOR_SAMPLING), or the caller's temperature with the runner's defaults
 *  for the rest. */
export function deviceSamplingFor(
  modelId: string,
  temperature: number,
): { temperature: number; topK?: number; topP?: number; minP?: number; repeatPenalty?: number } {
  return isHarbor(modelId) ? { ...HARBOR_SAMPLING } : { temperature };
}

/** How one device turn is asked for: whether it thinks, whether its thought
 *  shows, the answer's cap, the thought's budget (0: none, the thought shares
 *  the cap), the room to keep free in the window, and its sampling. A Harbor
 *  coding request thinks first with a capped thought and shows it, so a reply
 *  that takes a while visibly works; Chain of Thought keeps its doubled cap on
 *  every other turn. */
export interface DeviceTurnShape {
  thinking: boolean;
  showThought: boolean;
  maxTokens: number;
  thinkBudget: number;
  replyRoom: number;
  sampling: ReturnType<typeof deviceSamplingFor>;
}

/** The thought's cutoff words, counted generously, kept free beside the budget. */
const CUTOFF_ROOM = 64;

export function deviceTurnShape(
  modelId: string,
  last: { content: string; pictures: boolean } | undefined,
  opts: { cot: boolean; guide: boolean; base: number; temperature: number },
): DeviceTurnShape {
  if (isHarbor(modelId) && !opts.guide && last && harborThinks(last.content, last.pictures)) {
    return {
      thinking: true,
      showThought: true,
      maxTokens: opts.base,
      thinkBudget: HARBOR_THINK_BUDGET,
      replyRoom: opts.base + HARBOR_THINK_BUDGET + CUTOFF_ROOM,
      sampling: { ...HARBOR_THINK_SAMPLING },
    };
  }
  const cot = opts.cot && !opts.guide;
  const maxTokens = cot ? opts.base * 2 : opts.base;
  return {
    thinking: cot,
    showThought: cot,
    maxTokens,
    thinkBudget: 0,
    replyRoom: maxTokens,
    sampling: deviceSamplingFor(modelId, opts.temperature),
  };
}

/** A test build's timing line under each reply (VITE_HARBOR_TIMING=1, set
 *  only for a device measurement build): what the prompt, the thought and the
 *  answer took on this device. Never on in a store build. */
export const DEVICE_TIMING = import.meta.env?.VITE_HARBOR_TIMING === '1';

export function deviceTimingLine(s: {
  promptTokens: number;
  promptSeconds: number;
  thoughtTokens: number;
  thoughtSeconds: number;
  answerTokens: number;
  answerSeconds: number;
}): string {
  const n = (x: number) => x.toLocaleString('en-US');
  const sec = (x: number) => `${x.toFixed(1)} s`;
  const rate = (tokens: number, seconds: number) =>
    seconds > 0 ? `, ${(tokens / seconds).toFixed(1)} tokens/s` : '';
  const thought = s.thoughtTokens
    ? `; thought ${n(s.thoughtTokens)} tokens in ${sec(s.thoughtSeconds)}${rate(s.thoughtTokens, s.thoughtSeconds)}`
    : '';
  const total = s.promptSeconds + s.thoughtSeconds + s.answerSeconds;
  return `Timing on this device: read the prompt (${n(s.promptTokens)} tokens) in ${sec(s.promptSeconds)}${thought}; answered ${n(s.answerTokens)} tokens in ${sec(s.answerSeconds)}${rate(s.answerTokens, s.answerSeconds)}; ${sec(total)} in all.`;
}

/** Whether this device model reads pictures right now. */
export function deviceReadsImages(modelId: string): boolean {
  return isHarbor(modelId) && harborReadsImages();
}

/** The pictures a device turn carries, as the base64 the runner takes: the
 *  images among the attachments, at most HARBOR_MAX_IMAGES. A video's frames
 *  are spread evenly across that many, first and last kept, so the model
 *  still sees the clip from start to end. */
export function devicePictures(attachments: Attachment[] | undefined): string[] {
  const images = (attachments ?? []).filter((a) => a.isImage);
  const picked =
    images.length <= HARBOR_MAX_IMAGES
      ? images
      : Array.from(
          { length: HARBOR_MAX_IMAGES },
          (_, i) => images[Math.round((i * (images.length - 1)) / (HARBOR_MAX_IMAGES - 1))],
        );
  return picked.map((a) => imageBlockParts(a)?.base64).filter((b): b is string => Boolean(b));
}

/** What a turn that carried pictures says in the history once a newer turn
 *  carries its own: the window holds one turn's pictures at a time. */
export const EARLIER_PICTURES_NOTE = '(Pictures were shared with this message.)';

/** A device conversation as the runner takes it: the pictures ride only on
 *  the newest turn that has any (older ones keep a short note instead), and
 *  their tokens are counted against the window before the history is fitted,
 *  so the reply still has its room. */
export function deviceMessages(
  system: string,
  history: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>,
  replyTokens: number,
  contextTokens: number,
): Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }> {
  let newest = -1;
  history.forEach((m, i) => {
    if (m.images?.length) newest = i;
  });
  const shaped = history.map((m, i) => {
    if (!m.images?.length) return { role: m.role, content: m.content };
    if (i === newest) return { role: m.role, content: m.content, images: m.images };
    return {
      role: m.role,
      content: m.content ? `${EARLIER_PICTURES_NOTE}\n${m.content}` : EARLIER_PICTURES_NOTE,
    };
  });
  const pictureTokens =
    newest >= 0 ? (history[newest].images?.length ?? 0) * HARBOR_IMAGE_TOKENS : 0;
  return fitDeviceHistory(system, shaped, replyTokens + pictureTokens, contextTokens);
}

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
  // One fitting rule for the device and a switch (tech review J11): the core's
  // fitSeed, with the app's estimator and the trimmed-history opener.
  return fitSeed({
    system,
    messages,
    replyTokens,
    contextTokens,
    estimate: estimateTokens,
    opener: TRIMMED_HISTORY_OPENER,
  }).messages;
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
  model: { id: string; name: string; contextSize: number; visionId?: string },
  onStatus?: (message: string) => void,
): Promise<EnsureDeviceModel> {
  watchNativeUnload();
  if (
    slot &&
    slot.id === model.id &&
    slot.contextSize === model.contextSize &&
    slot.visionId === model.visionId
  ) {
    return { ok: true };
  }
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
  const load = await Llama.load({
    id: model.id,
    contextSize: model.contextSize,
    ...(model.visionId ? { visionId: model.visionId } : {}),
  });
  if (!load.ok) {
    return {
      ok: false,
      detail:
        load.detail ?? `${model.name} would not load. Download it again from Settings, Harbor.`,
    };
  }
  slot = { id: model.id, contextSize: model.contextSize, visionId: model.visionId };
  return { ok: true };
}
