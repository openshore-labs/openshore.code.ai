// What pairing does to the personal vault (Vault M5, CTO J9, D2). Pure, so
// the rule is a table a test can read; the store runs it and the Vault room
// shows the card.
//
// On pairing, a vault on This device by default (never by the person's own
// choice: a move stamps `chosenAt`) that holds no notes and no text waiting to
// save points at the computer with one toast. One that holds notes gets the
// one-time move card, whose move is the existing one (every copy `ifAbsent`).
// A storage the person chose (a folder, iCloud, the iPhone folder) is never
// repointed. Unpairing returns the vault to where it was and moves nothing
// back.
import type { GitosResource, StorageProviderId } from './gitos/providers.js';

/** Where the vault was before it pointed at the computer, so unpairing can
 *  return it. Device local, never synced. */
export interface VaultBeforeHub {
  providerId: StorageProviderId;
  chosenAt?: string;
  /** The hub it pointed at (its base URL). */
  hub: string;
}

/** The one-time move card after pairing. Device local. */
export interface VaultHubOffer {
  /** The hub it is for (its base URL). */
  hub: string;
  state: 'offered' | 'declined';
}

export type HubPairingPlan = 'repoint' | 'offer' | 'none';

/**
 * What pairing does. `notes` is how many notes the vault's list gave, or
 * undefined when the list failed (a failed list never counts as empty);
 * `waiting` is whether text is stashed or held for it.
 */
export function hubPairingPlan(input: {
  resource: Pick<GitosResource, 'providerId' | 'chosenAt'> | undefined;
  hubReady: boolean;
  notes: number | undefined;
  waiting: boolean;
  offer: VaultHubOffer | undefined;
  hub: string;
}): HubPairingPlan {
  const providerId = input.resource?.providerId ?? 'local';
  if (!input.hubReady || providerId !== 'local' || input.resource?.chosenAt) return 'none';
  if (input.notes === undefined) return 'none';
  if (input.notes === 0 && !input.waiting) return 'repoint';
  // A decline is respected for this hub; a new hub may ask once.
  if (input.offer?.hub === input.hub && input.offer.state === 'declined') return 'none';
  return 'offer';
}

/** The toast after an empty vault points at the computer. */
export const HUB_REPOINT_TOAST =
  'Your Vault now lives on your computer, so every device you pair sees the same notes while it is on.';

/** The move card's lines. */
export const HUB_OFFER_COPY = {
  title: 'Keep one vault on your computer',
  body: 'Your notes are on this device. Move them to your computer and every device you pair sees the same vault while it is on. Nothing on your computer is replaced.',
  move: 'Move my notes',
  later: 'Keep them here',
} as const;

/** The toast after unpairing returned the vault. */
export const HUB_UNPAIR_TOAST =
  'Your Vault is back on this device. Notes saved on your computer stay there.';
