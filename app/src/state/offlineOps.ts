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
import { pullFailedLine, type OfflineReason, type PullResult } from 'os-code/protocol';

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

/** Under a cloud row on the model sheet's first page while offline (the
 *  Cloud models row, a cloud favorite): shown, not picked. The cloud sheet
 *  itself says it once at the top (CLOUD_SHEET_OFFLINE) over muted names. */
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

/** The chat's offline banner. The network down keeps its words; Offline
 *  chosen says it was the person's choice, so a working network with cloud
 *  models standing aside never reads as a fault. `here` names the device in
 *  hand; before a computer is connected the line never speaks of one (D1). */
export function offlineBannerLine(s: {
  desktop: boolean;
  paired: boolean;
  chosen: boolean;
  here: string;
}): string {
  const where = s.desktop ? 'this computer' : s.here;
  const waits = !s.desktop && s.paired ? 'Your computer and cloud models' : 'Cloud models';
  return s.chosen
    ? `Offline, by your choice. Models on ${where} answer. ${waits} wait until you follow the connection again.`
    : `Offline. Models on ${where} still answer. ${waits} wait for a connection.`;
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
  // After a failed download the door is the way on its line names, in the
  // First Seat's words.
  if (s.download?.failed) return { label: `Try ${HARBOR_MASTER_MODEL_NAME} again`, busy: false };
  return { label: `Install ${HARBOR_MASTER_MODEL_NAME}`, busy: false };
}

/** The line a DeepBlue download leaves when it fails (Desktop Offline
 *  follow-up, 2026-10-08). With no network it keeps its own words. With the
 *  network up it says what failed and the way on, in the engine's words
 *  (pullFailedLine) with DeepBlue's name, never the model server's error. A
 *  name Ollama lacks is the catalog's, not the person's, so it reads as a
 *  plain failure. A result with no reason is one of the engine's own plain
 *  lines (no Ollama to run it); anything else, a bridge that failed, gets the
 *  plain failure too. */
export function localModelFailedLine(
  networkIsUp: boolean,
  pulled?: Pick<PullResult, 'detail' | 'reason'>,
): string {
  if (!networkIsUp || pulled?.reason === 'offline') {
    return `Offline. ${HARBOR_MASTER_MODEL_NAME} downloads once you are back online.`;
  }
  if (pulled?.reason) {
    return pullFailedLine(
      HARBOR_MASTER_MODEL_NAME,
      pulled.reason === 'not-found' ? 'failed' : pulled.reason,
    );
  }
  return pulled?.detail || pullFailedLine(HARBOR_MASTER_MODEL_NAME, 'failed');
}

/** Said once DeepBlue is on this computer from that door. */
export const LOCAL_MODEL_READY = `${HARBOR_MASTER_MODEL_NAME} is on this computer. Try your message again.`;

/** The desktop Stack's "Runs the show" line: online, what the slot does;
 *  offline with a model that leaves this network in it, that it waits and
 *  who answers meanwhile, named (the engine's offline seat, which status()
 *  reads across every provider by address), or that nothing here can yet. */
export function reasoningSlotSub(offline: boolean, leaves: boolean, seat?: string): string {
  if (!offline || !leaves) return 'Reasoning model · Plans every task and routes it.';
  return seat
    ? `Reasoning model · Waits for a connection. ${seat} on this computer answers for now.`
    : 'Reasoning model · Waits for a connection. No model on this computer can answer yet.';
}

/** The model sheet's computer row while that computer works offline and a
 *  cloud model runs its show: the model there that answers meanwhile, named.
 *  `computer` is "this computer" on the desktop, "your computer" on a phone. */
export function offlineSeatSub(seat: string, computer: string): string {
  return `Offline, so ${seat} on ${computer} answers for now`;
}

/** The same row when no model on that computer can answer. */
export function offlineNoSeatSub(computer: string): string {
  return `Offline, and no model on ${computer} can answer yet.`;
}

/** Why the paired computer works offline, from what its daemon answered
 *  (GET /health or GET /stack). Undefined while it is online, and for an
 *  older daemon that does not say, which reads as online. */
export function computerOfflineOf(body: unknown): OfflineReason | undefined {
  const offline = (body as { offline?: unknown } | null)?.offline;
  return offline === 'network' || offline === 'chosen' ? offline : undefined;
}

/** The phone's Stack, Docked, while the paired computer works offline: the
 *  computer's cloud models wait for its connection, and whether its own
 *  models answer meanwhile (`seat`, undefined until the computer has said;
 *  that sentence is left out until then, so the line is true either way).
 *  The phone's own cloud models are untouched, so nothing here speaks of
 *  them. A chosen Offline is undone on the computer, so the line says where. */
export function computerOfflineNote(reason: OfflineReason, seat: boolean | undefined): string {
  const chosen = reason === 'chosen';
  const head = chosen
    ? 'Connected to your computer, which is offline by your choice.'
    : 'Connected to your computer, which is offline.';
  const answers =
    seat === undefined
      ? ''
      : seat
        ? chosen
          ? ' Models on your computer answer.'
          : ' Models on your computer still answer.'
        : ' No model on your computer can answer yet.';
  const waits = chosen
    ? ' Its cloud models wait until you follow the connection there.'
    : ' Its cloud models wait for its connection.';
  return `${head}${answers}${waits}`;
}
