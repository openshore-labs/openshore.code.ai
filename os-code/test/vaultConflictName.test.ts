// The keep-both name for a note's second version, shared by the app's store
// (a stash replay, a move's forks, Keep both) and the desktop's main process
// (Bring from the previous folder), so both write the same name for the same
// note and minute (tech review ruling on Bring, item 4). Pure, and on the protocol.
import { describe, expect, it } from 'vitest';
import { vaultConflictCopyPath } from '../src/protocol.js';

const when = new Date(2026, 8, 27, 14, 5);

describe('vaultConflictCopyPath', () => {
  it('names the copy beside the note, in local time, with a counter past the first', () => {
    expect(vaultConflictCopyPath('Plan.md', when)).toBe('Plan (conflict 2026-09-27 1405).md');
    expect(vaultConflictCopyPath('Ideas/Plan.md', when, 2)).toBe(
      'Ideas/Plan (conflict 2026-09-27 1405 2).md',
    );
    expect(vaultConflictCopyPath('a.MD', when)).toBe('a (conflict 2026-09-27 1405).md');
  });

  it('keeps the typed-name rule, so the app can open, link, and delete the copy', () => {
    expect(vaultConflictCopyPath('Why #1?.md', when)).toBe('Why 1 (conflict 2026-09-27 1405).md');
    expect(vaultConflictCopyPath('back\\slash.md', when)).toBe(
      'back/slash (conflict 2026-09-27 1405).md',
    );
    expect(vaultConflictCopyPath('Café.md', when)).toBe('Café (conflict 2026-09-27 1405).md');
  });
});
