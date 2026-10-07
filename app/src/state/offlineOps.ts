// Desktop Offline (founder, 2026-10-07): "Desktop app can use offline when
// there is no internet and it needs to use just the local models, where the
// cloud connections are no longer viable options for work." The store's half,
// kept beside it (the premium build's sibling-module rule): what the desktop
// counts as offline, how the person's choice reaches this computer's engine
// (main combines it with its own read of the network and sets the engine's
// one machine flag), and the plain lines the rooms say while cloud models
// wait. The engine's half is os-code core/agent/offline.ts.
import {
  autoProfile,
  effectiveProfile,
  type Connectivity,
  type ProfileId,
} from '../lib/profiles.js';
import type { DesktopOfflineAnswer } from '../lib/electronBridge.js';
import type { ConversationSource } from './types.js';
import { HARBOR_MASTER_MODEL_NAME } from '../lib/harborMaster.js';

/** Before the store has read the connection, it is taken as up. */
const UNREAD: Connectivity = { homeReachable: false, online: true };

/** Whether this device works offline now: the connection says Offline, or
 *  the person chose it. One rule for every room, the same the Stack's reach
 *  and the reach pill read. */
export function offlineNow(connectivity: Connectivity | undefined, override?: ProfileId): boolean {
  return effectiveProfile(autoProfile(connectivity ?? UNREAD), override) === 'offline';
}

/** Whether the Offline in force is the person's choice rather than the
 *  connection's: chosen, and the connection alone would not say Offline. */
export function offlineChosen(
  connectivity: Connectivity | undefined,
  override?: ProfileId,
): boolean {
  return override === 'offline' && autoProfile(connectivity ?? UNREAD) !== 'offline';
}

/** Whether the network itself is up (a chosen Offline leaves it up). */
export function networkUp(connectivity: Connectivity | undefined): boolean {
  return (connectivity ?? UNREAD).online;
}

/** The desktop's online value: the window's own (navigator.onLine) and
 *  main's (Electron's net.isOnline()), offline when either says so. Main's is
 *  undefined until it has answered. */
export function desktopOnline(windowOnline: boolean, mainOnline: boolean | undefined): boolean {
  return windowOnline && mainOnline !== false;
}

/** Tell this computer's engine the person's choice (true for Offline). Main
 *  answers with its own read of the network; undefined with no bridge, an
 *  older main, or a call that failed, so the window's own read stands. */
export async function reportDesktopOffline(
  bridge: { setOffline?: (chosen: boolean) => Promise<DesktopOfflineAnswer> } | undefined,
  chosen: boolean,
): Promise<boolean | undefined> {
  if (!bridge?.setOffline) return undefined;
  try {
    return (await bridge.setOffline(chosen)).online;
  } catch {
    return undefined;
  }
}

/** A cloud model's row, while offline: shown, not picked. */
export const CLOUD_WAITS = 'Waits for a connection';

/** The cloud sheet's line above its waiting rows. */
export const CLOUD_SHEET_OFFLINE = 'Offline. Cloud models wait for a connection.';

/** A pick the composer may keep: a cloud model waits while offline, so a new
 *  chat falls back to the default brain (never a cloud one) instead. */
export function usablePick(
  picked: ConversationSource | undefined,
  offline: boolean,
): ConversationSource | undefined {
  return offline && picked?.kind === 'cloud' ? undefined : picked;
}

/** The line a cloud chat ends a send with while offline, in place of a
 *  request that cannot leave (or, with Offline chosen, should not): the
 *  model's own name, and why it waits. `here` names the device in hand ("this
 *  computer" on the desktop, thisDeviceNoun() elsewhere). The stop card's
 *  doors (Choose another model, Try again) carry on from it. */
export function cloudWaitLine(modelName: string, chosen: boolean, here: string): string {
  return chosen
    ? `Offline is chosen, so ${modelName} waits until you follow the connection again. Choose a model on ${here} to keep going.`
    : `Offline, so ${modelName} waits for a connection. Choose a model on ${here} to keep going, or try again once you are online.`;
}

/** The desktop Stack's status line under its lead (the phone's note, in this
 *  computer's words). */
export function desktopStackNote(offline: boolean, chosen: boolean): string {
  if (!offline) return "Online. Cloud models and this computer's models can answer.";
  return chosen
    ? "Offline, by your choice. This computer's models answer. Cloud models wait until you follow the connection again."
    : "Offline. This computer's models answer. Cloud models wait for a connection.";
}

/** Cloud Connections' line at the top while offline. */
export function connectionsOfflineLine(chosen: boolean): string {
  return chosen
    ? 'Offline is chosen, so these models wait until you follow the connection again. Keys stay saved.'
    : 'Offline. These models wait for a connection. Keys stay saved.';
}

/** Why Save waits in a key sheet while the network is down: the key is
 *  checked with its provider before it is kept. */
export function keyCheckWaits(providerName: string): string {
  return `Saving checks the key with ${providerName}, so it waits for a connection.`;
}

/** The stop card's one door when this computer is offline and no model on it
 *  can answer (the engine's offlineNoModelLine): get DeepBlue, pulled and
 *  left unseated, so the person's own Reasoning model stays theirs. Only on
 *  the desktop, and only while the network is up (Offline chosen), since the
 *  download needs it; with the network down the line itself says when. Its
 *  words follow the download once it runs. */
export function installLocalDoor(s: {
  desktop: boolean;
  networkUp: boolean;
  download?: { label: string; failed?: boolean };
}): { label: string; busy: boolean } | undefined {
  if (!s.desktop || !s.networkUp) return undefined;
  if (s.download && !s.download.failed) {
    return { label: `Getting ${HARBOR_MASTER_MODEL_NAME}, ${s.download.label}`, busy: true };
  }
  return { label: `Install ${HARBOR_MASTER_MODEL_NAME}`, busy: false };
}

/** Said once DeepBlue is on this computer from that door. */
export const LOCAL_MODEL_READY = `${HARBOR_MASTER_MODEL_NAME} is on this computer. Try your message again.`;

/** The desktop Stack's "Runs the show" line: online, what the slot does;
 *  offline with a model that leaves this network in it, that it waits and
 *  who answers meanwhile (the engine's offline seat, a model here), or that
 *  nothing here can yet. */
export function reasoningSlotSub(offline: boolean, leaves: boolean, localModels: number): string {
  if (!offline || !leaves) return 'Reasoning model · Plans every task and routes it.';
  return localModels > 0
    ? 'Reasoning model · Waits for a connection. A model on this computer answers for now.'
    : 'Reasoning model · Waits for a connection. No model on this computer can answer yet.';
}
