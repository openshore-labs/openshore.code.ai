// When the desktop's one-time move card shows (Vault M1 1.3, CX 1.3). Pure,
// so the rule is a table a test can read.
//
// The card is for a vault sealed on This device by default, never by the
// person's own choice (a move they made stamps the resource's chosenAt). Its
// quiet button is a decision, and it is respected: the card comes back once,
// and only when it has become more relevant, the first time the Vault opens
// at least seven days later with the folder holding more notes than it did
// then (the agent or routines kept writing there while the person's notes
// stayed apart). A second decline is final on this computer, and any move,
// by any path, ends the offer.

/** What this computer remembers about the offer. Device local, never synced. */
export interface VaultMoveOfferState {
  dismissals: 1 | 2;
  /** When the last decline was, ISO. */
  at: string;
  /** The folder's note count at that decline. */
  folderNotes: number;
}

export const VAULT_REOFFER_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether the offer may show, given what was declined and the folder's note
 *  count now (undefined when it could not be counted). */
export function shouldOfferFolderMove(
  state: VaultMoveOfferState | undefined,
  now: number,
  folderNotesNow: number | undefined,
): boolean {
  if (!state) return true;
  if (state.dismissals >= 2) return false;
  const at = Date.parse(state.at);
  if (Number.isNaN(at) || now - at < VAULT_REOFFER_MS) return false;
  return folderNotesNow !== undefined && folderNotesNow > state.folderNotes;
}

/** The state after a decline. */
export function declineFolderMove(
  state: VaultMoveOfferState | undefined,
  now: number,
  folderNotes: number | undefined,
): VaultMoveOfferState {
  return {
    dismissals: state ? 2 : 1,
    at: new Date(now).toISOString(),
    folderNotes: folderNotes ?? state?.folderNotes ?? 0,
  };
}

/** The notes the folder gained since the decline, on the one return. */
export function folderNotesSince(
  state: VaultMoveOfferState | undefined,
  folderNotesNow: number | undefined,
): number {
  if (!state || folderNotesNow === undefined) return 0;
  return Math.max(0, folderNotesNow - state.folderNotes);
}
