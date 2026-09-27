// When the desktop's one-time move card shows (Vault M1 1.3, CX 1.3), as a
// table: first time yes; after one decline, only on a visit at least 7 days
// later with more notes in the folder than at the decline; never after two.
import { describe, expect, it } from 'vitest';
import {
  VAULT_REOFFER_MS,
  declineFolderMove,
  folderNotesSince,
  shouldOfferFolderMove,
} from '../src/lib/vaultOffer.js';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('the desktop move offer', () => {
  it('follows the table', () => {
    const rows: Array<[Parameters<typeof shouldOfferFolderMove>[0], number | undefined, boolean]> =
      [
        [undefined, 0, true],
        [undefined, undefined, true],
        [{ dismissals: 1, at: at(VAULT_REOFFER_MS - 1), folderNotes: 2 }, 9, false],
        [{ dismissals: 1, at: at(VAULT_REOFFER_MS), folderNotes: 2 }, 2, false],
        [{ dismissals: 1, at: at(VAULT_REOFFER_MS), folderNotes: 2 }, 3, true],
        [{ dismissals: 1, at: at(VAULT_REOFFER_MS), folderNotes: 2 }, undefined, false],
        [{ dismissals: 1, at: 'not a date', folderNotes: 2 }, 9, false],
        [{ dismissals: 2, at: at(30 * VAULT_REOFFER_MS), folderNotes: 0 }, 99, false],
      ];
    for (const [state, count, want] of rows) {
      expect(shouldOfferFolderMove(state, NOW, count), JSON.stringify([state, count])).toBe(want);
    }
  });

  it('a decline records when and the folder count, and a second one is final', () => {
    const first = declineFolderMove(undefined, NOW, 4);
    expect(first).toEqual({ dismissals: 1, at: new Date(NOW).toISOString(), folderNotes: 4 });
    expect(declineFolderMove(first, NOW + VAULT_REOFFER_MS, 7).dismissals).toBe(2);
    expect(folderNotesSince(first, 7)).toBe(3);
    expect(folderNotesSince(first, 1)).toBe(0);
    expect(folderNotesSince(undefined, 7)).toBe(0);
  });
});
