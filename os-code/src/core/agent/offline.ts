// Desktop Offline (founder, 2026-10-07): "Desktop app can use offline when
// there is no internet and it needs to use just the local models." One
// machine-wide flag says whether this computer works without the internet
// right now, because the network is down or because the person chose
// Offline. The desktop's main process sets it (it watches the connection and
// hears the person's choice); every session this process hosts reads it per
// turn, the desktop's own and a paired phone's through the daemon alike, so a
// chat that goes offline mid-task answers its next turn with a model on this
// network, and one that comes back gets its configured stack again.
//
// While it is set, only a model whose requests stay on this network runs
// (judged by address and a cloud tag, seatLeaves, never by a label): a cloud
// orchestrator gives way to the best local model, a cloud specialist is
// skipped, nothing escalates, and the tools that reach the network leave the
// menu, the routine's offline slice. Pure on purpose: the copy and the ranking
// ride os-code/protocol, so the app's doors match the engine's words.

import { isOllamaCloudTag } from '../../harness/locality.js';

/** Why this computer works offline: no network, or the person chose it. */
export type OfflineReason = 'network' | 'chosen';

/** The machine's offline state as a session reads it. */
export interface MachineOffline {
  offline: boolean;
  /** Set while offline. */
  reason?: OfflineReason;
}

const ONLINE: MachineOffline = Object.freeze({ offline: false });

let state: MachineOffline = ONLINE;

/** Set this computer's offline state (the desktop's main process does,
 *  through the engine host). Undefined means online. */
export function setMachineOffline(reason: OfflineReason | undefined): MachineOffline {
  state = reason ? { offline: true, reason } : ONLINE;
  return state;
}

/** This computer's offline state now. Online until a host says otherwise,
 *  so the CLI and a standalone daemon work as they always have. */
export function machineOffline(): MachineOffline {
  return state;
}

/** The transcript's note when a session first works offline. A chosen
 *  Offline keeps the network up, so the seat may be a model server elsewhere
 *  on the person's own network (a LAN or tailnet address stays on this
 *  network, locality.ts), never only this computer's. */
export function offlineNote(reason: OfflineReason | undefined): string {
  return reason === 'chosen'
    ? 'Offline is chosen, so models on your own network do the work. Cloud models wait until you follow the connection again.'
    : "Offline, so your computer's own models do the work. Cloud models wait for a connection.";
}

/** The transcript's note when a session that worked offline is online again. */
export const ONLINE_AGAIN_NOTE = 'Back online. Your full stack is available again.';

/** How a turn ends when this computer is offline and no model on its network
 *  can answer. Starts with the words the app's door looks for
 *  (offlineNeedsLocalModel). */
export function offlineNoModelLine(reason: OfflineReason | undefined): string {
  return reason === 'chosen'
    ? 'Offline, and no model on your computer can answer yet. Install DeepBlue to work offline.'
    : 'Offline, and no model on your computer can answer yet. Once you are back online, install DeepBlue to work offline.';
}

/** True for the stop line above, so a client offers the way to a local
 *  model rather than a model picker that has nothing to pick. */
export function offlineNeedsLocalModel(message: string): boolean {
  return message.startsWith('Offline, and no model on your computer can answer yet.');
}

/** Why a call to a tool that reaches the network did not run while this
 *  computer is offline. A chosen Offline keeps the network up (a shell
 *  command or a model download still reaches it), so it says only that the
 *  web tools wait. */
export function offlineNowDenied(reason: OfflineReason | undefined): string {
  return reason === 'chosen'
    ? 'Offline is chosen, so the web tools wait until you follow the connection again.'
    : 'Your computer is offline, so nothing here reaches the web.';
}

/** What the model is told while this computer is offline, as a routine's
 *  prompt tells it. */
export const OFFLINE_PROMPT =
  'This computer is offline right now: there is no web search, no web access and no cloud model. Work from the files in this workspace and what you already know, and say plainly what you could not check.';

/** Names that are not chat models: an embedding or a reranking model cannot
 *  answer a turn. */
const NOT_CHAT = /embed|rerank|bge-|minilm|nomic-|\be5-|clip|whisper/i;

/** A model name's size in billions of parameters, when its tag says ("7b",
 *  "qwen3:4b", "32b-instruct"); 0 when it does not. */
function paramsB(name: string): number {
  const m = /(\d+(?:\.\d+)?)b\b/i.exec(name.split('/').pop() ?? name);
  return m ? Number(m[1]) : 0;
}

/**
 * The models a server on this network serves, best seat first: chat models
 * only, a coding model before any other (DeepBlue and the curated coders are
 * coders), then the larger before the smaller, then the server's own order.
 * Installed means it fits: the person, or DeepBlue's fit table, put it there.
 * An Ollama cloud tag is never ranked: Ollama lists it like a pulled model,
 * but it answers on ollama.com, so it can never be the seat that stays here.
 */
export function rankLocalModels(names: readonly string[]): string[] {
  const coder = (n: string): number => (/coder|code/i.test(n) ? 1 : 0);
  return names
    .map((name, i) => ({ name, i }))
    .filter(({ name }) => name.trim() && !NOT_CHAT.test(name) && !isOllamaCloudTag(name))
    .sort((a, b) => coder(b.name) - coder(a.name) || paramsB(b.name) - paramsB(a.name) || a.i - b.i)
    .map(({ name }) => name);
}
