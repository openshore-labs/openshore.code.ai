// The Vault's organize components (Vault M6 6.2, 6.3; CTO K5, K6 with R1 to
// R3; CX X5 to X10), mounted in a small real DOM:
// - Options deletes in ONE tap only where Trash is real, and keeps two taps,
//   worded "for good", everywhere else (R2);
// - the Undo toast shows 6 s, pauses under a hand, says Undo with a label
//   naming what it restores and "Also in Trash.";
// - Trash lists rows with Restore, empties only on a second tap with the
//   count, and a team Trash has no Empty (R3);
// - the rename sheet refuses a bad name in place, renames at once when no
//   link points at the note, and asks "Update links?" when links do;
// - the folder sheet states its counts and deletes on the second tap;
// and the stream's copy passes the M6 retired list and the house voice.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import type { VaultMovePreview } from '../src/state/vaultOps.js';

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
});
afterEach(async () => {
  await dom.unmount();
  vi.useRealTimers();
});

const noop = () => {};

async function options(trashReal: boolean, confirmDelete = false) {
  const { VaultNoteOptions } = await import('../src/components/vault/VaultNoteOptions.js');
  const calls: string[] = [];
  await dom.render(
    <VaultNoteOptions
      open
      title="Ideas"
      confirmDelete={confirmDelete}
      canAsk={false}
      canPin={false}
      canRename
      trashReal={trashReal}
      deleteDisabled={false}
      onClose={noop}
      onAsk={noop}
      onPin={noop}
      onRename={() => calls.push('rename')}
      onArmDelete={() => calls.push('arm')}
      onDelete={() => calls.push('delete')}
    />,
  );
  return calls;
}

describe('Options (R2, CX X8)', () => {
  it('deletes in one tap where Trash is real', async () => {
    const calls = await options(true);
    expect(dom.buttons()).toContain('Rename or move');
    await dom.click('Delete this note');
    expect(calls).toEqual(['delete']);
  });

  it('arms first where the delete is for good, and says so', async () => {
    const calls = await options(false);
    await dom.click('Delete this note');
    expect(calls).toEqual(['arm']);
    const armed = await options(false, true);
    await dom.click('Really delete "Ideas" for good? Tap to confirm.');
    expect(armed).toEqual(['delete']);
    expect(dom.text()).not.toContain('Really delete? Tap to confirm.');
  });
});

describe('the Undo toast (CX X9)', () => {
  it('names what it restores, points at Trash, and waits 6 s unless a hand is on it', async () => {
    vi.useFakeTimers();
    const { VaultUndoToast, VAULT_UNDO_MS } =
      await import('../src/components/vault/VaultUndoToast.js');
    expect(VAULT_UNDO_MS).toBe(6000);
    const done: string[] = [];
    const undone: string[] = [];
    const item = { id: '1', text: 'Moved to Trash.', title: 'Ideas', trashed: true };
    await dom.render(
      <VaultUndoToast
        item={item}
        onUndo={(i) => undone.push(i.id)}
        onDone={(i) => done.push(i.id)}
      />,
    );
    const toast = dom.container.querySelector('.vault-undo-toast')!;
    expect(toast.getAttribute('role')).toBe('status');
    const button = toast.querySelector('button')!;
    expect(button.textContent).toBe('Undo');
    expect(button.getAttribute('aria-label')).toBe('Undo, restore Ideas');
    expect(button.getAttribute('aria-description')).toBe('Also in Trash.');
    await vi.advanceTimersByTimeAsync(5900);
    expect(done).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toEqual(['1']);
    await dom.click('Undo');
    expect(undone).toEqual(['1']);
  });
});

describe('Trash (CX X10, R3)', () => {
  const entries = [
    {
      id: 'a',
      path: 'Work/Plans.md',
      kind: 'note' as const,
      size: 3,
      trashedAt: '2026-09-20T10:00:00.000Z',
    },
    { id: 'b', path: 'Ideas.md', kind: 'note' as const, size: 3 },
  ];

  async function trash(kind: 'folder' | 'local' | 'team') {
    const { VaultTrashView } = await import('../src/components/vault/VaultTrashView.js');
    const calls: string[] = [];
    await dom.render(
      <VaultTrashView
        kind={kind}
        entries={entries}
        now={Date.parse('2026-09-27T12:00:00.000Z')}
        onBack={noop}
        onRestore={async (e) => {
          calls.push(`restore ${e.id}`);
        }}
        onEmpty={async () => {
          calls.push('empty');
        }}
      />,
    );
    return calls;
  }

  it('lists each note with where it came from, restores it, and empties on the second tap', async () => {
    const calls = await trash('folder');
    expect(dom.text()).toContain(
      'Deleted notes wait here, in the .trash folder, until you empty it.',
    );
    expect(dom.text()).toContain('From Work \u00b7 Deleted Sep 20');
    expect(dom.text()).toContain('From the top of the vault');
    const restore = [...dom.container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Restore',
    );
    expect(restore.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Restore Plans',
      'Restore Ideas',
    ]);
    await dom.click('Restore');
    await dom.settle();
    await dom.click('Empty Trash');
    expect(calls).toEqual(['restore a']);
    await dom.click('Really delete 2 notes for good? Tap to confirm.');
    await dom.settle();
    expect(calls).toEqual(['restore a', 'empty']);
  });

  it('a team Trash restores only, and says for how long (0021 purge)', async () => {
    await trash('team');
    expect(dom.buttons()).not.toContain('Empty Trash');
    // The weekly purge clears what has been in Trash 30 days, so the page
    // says so and never promises the notes are kept.
    expect(dom.text()).toContain('Deleted team notes can be restored from here for 30 days.');
    expect(dom.text()).toContain("After that they are cleared from your organization's history.");
    expect(dom.text()).not.toContain("Team notes are kept in your organization's history.");
  });
});

describe('the rename sheet (CX X5, X6)', () => {
  const preview = (links: number): VaultMovePreview => ({
    kind: 'note',
    from: 'Ideas.md',
    to: 'Plans.md',
    moves: new Map([['Ideas.md', 'Plans.md']]),
    notes: 1,
    attachments: 0,
    links,
    linkNotes: links ? 2 : 0,
    plan: { edits: [], links, notes: links ? 2 : 0, left: [] },
    sources: [],
  });

  async function sheet(links: number) {
    const { VaultRenameSheet } = await import('../src/components/vault/VaultRenameSheet.js');
    const applied: boolean[] = [];
    const prepared: string[] = [];
    await dom.render(
      <VaultRenameSheet
        open
        kind="note"
        from="Ideas.md"
        folders={['Work']}
        known={['Ideas.md', 'Taken.md']}
        prepare={async (to) => {
          prepared.push(to);
          return preview(links);
        }}
        apply={async (_p, update) => {
          applied.push(update);
        }}
        onClose={noop}
      />,
    );
    return { applied, prepared };
  }

  it('says why a name cannot be used, before anything is planned', async () => {
    const { prepared } = await sheet(0);
    await dom.type('Ideas', 'a#b');
    await dom.click('Rename');
    expect(dom.text()).toContain('Note names cannot use [ ] # ^ | \\ : * ? " < or >.');
    await dom.type('Ideas', 'Taken');
    await dom.click('Rename');
    expect(dom.text()).toContain('"Taken" is already in your vault. Pick another name.');
    expect(prepared).toEqual([]);
  });

  it('renames at once when no link points at the note', async () => {
    const { applied, prepared } = await sheet(0);
    await dom.type('Ideas', 'Plans');
    await dom.click('Rename');
    await dom.settle();
    expect(prepared).toEqual(['Plans.md']);
    expect(applied).toEqual([false]);
  });

  it('asks "Update links?" when links point at it, with Rename only beside it', async () => {
    const { applied } = await sheet(3);
    await dom.type('Ideas', 'Plans');
    await dom.click('Rename');
    await dom.settle();
    expect(dom.text()).toContain('Update links?');
    expect(dom.text()).toContain('3 links in 2 notes point to "Ideas". Update them to "Plans"?');
    expect(dom.text()).toContain('Links to "Ideas" will not open "Plans" until you change them.');
    await dom.click('Rename only');
    await dom.settle();
    expect(applied).toEqual([false]);
  });

  it('the standing card names each note still pointing at the old name', async () => {
    const { VaultLinksLeftCard } = await import('../src/components/vault/VaultRenameSheet.js');
    let rest = 0;
    await dom.render(
      <VaultLinksLeftCard old="Ideas" notes={['C.md']} onOpen={noop} onUpdateRest={() => rest++} />,
    );
    expect(dom.text()).toContain('Some links still point to "Ideas"');
    expect(dom.buttons()).toEqual(['C', 'Update the rest']);
    await dom.click('Update the rest');
    expect(rest).toBe(1);
  });
});

describe('the folder sheet (K5, CX X8)', () => {
  it('states its counts, and moves to Trash only on the second tap', async () => {
    const { VaultFolderSheet } = await import('../src/components/vault/VaultFolderSheet.js');
    const calls: string[] = [];
    await dom.render(
      <VaultFolderSheet
        open
        folder="Work"
        counts={{ notes: 12, attachments: 3 }}
        canRename
        canCreate
        canTrash
        onClose={noop}
        onRename={() => calls.push('rename')}
        onMove={() => calls.push('move')}
        onCreate={async () => undefined}
        onDelete={() => calls.push('delete')}
      />,
    );
    expect(dom.text()).toContain('This folder holds 12 notes and 3 other files.');
    await dom.click('Delete folder');
    expect(calls).toEqual([]);
    await dom.click('Really move 12 notes and 3 other files to Trash? Tap to confirm.');
    expect(calls).toEqual(['delete']);
  });
});

describe("stream G's copy", () => {
  const SRC = join(process.cwd(), 'src');
  const fence = (() => {
    const all = readFileSync(join(SRC, 'lib', 'vaultCopy.ts'), 'utf8');
    return all.slice(
      all.indexOf('// ---- M6 stream G begin ----'),
      all.indexOf('// ---- M6 stream G end ----'),
    );
  })();
  const files = [
    fence,
    ...[
      'VaultNoteOptions',
      'VaultRenameSheet',
      'VaultFolderSheet',
      'VaultTrashView',
      'VaultUndoToast',
    ].map((f) => readFileSync(join(SRC, 'components', 'vault', `${f}.tsx`), 'utf8')),
  ];

  it('never says the lines M6 retired for trash-backed deletes (CX X8, X14)', () => {
    for (const text of files) {
      for (const retired of [
        'Note deleted.',
        'Really delete? Tap to confirm.',
        'embed not supported yet',
      ]) {
        expect(text).not.toContain(retired);
      }
    }
  });

  it('says "Moved to Trash" only where Trash is real, "Deleted" elsewhere, never synced or safe', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    expect(copy.vaultUndoText({ trashed: true, folder: false, notes: 1 })).toBe('Moved to Trash.');
    expect(copy.vaultUndoText({ trashed: true, folder: true, notes: 4 })).toBe(
      'Moved 4 notes to Trash.',
    );
    expect(copy.vaultUndoText({ trashed: false, folder: false, notes: 1 })).toBe('Deleted.');
    expect(fence).not.toMatch(/\bsynced\b|\bsafe\b|successfully|oops/i);
  });

  it('a partial pass names what was left and never reads as a plain success (CX X7)', async () => {
    const { vaultRenameToast } = await import('../src/lib/vaultCopy.js');
    const several = vaultRenameToast({
      old: 'Ideas',
      next: 'Plans',
      rewrite: { updated: 5, total: 9, skipped: ['C', 'D'], notUpdated: [], stopped: false },
    });
    expect(several).toBe(
      'Renamed to "Plans". 5 of 9 links updated. 2 notes changed while this ran, so their links still point to "Ideas".',
    );
    const failed = vaultRenameToast({
      old: 'Ideas',
      next: 'Plans',
      rewrite: { updated: 0, total: 9, skipped: [], notUpdated: ['C'], stopped: true },
    });
    expect(failed).toBe(
      'Renamed to "Plans", but its links could not be updated. Update the rest tries again.',
    );
    expect(vaultRenameToast({ old: 'Ideas', next: 'Plans' })).toBe('Renamed to "Plans".');
  });

  it('Trash rows and Empty Trash read in the house voice', async () => {
    const c = await import('../src/lib/vaultCopy.js');
    expect(c.vaultTrashEmptied(3, 3)).toBe('Trash emptied. 3 notes deleted for good.');
    expect(c.vaultTrashEmptied(2, 3)).toBe(
      '2 notes deleted for good. 1 could not be removed and is still in Trash.',
    );
    expect(c.vaultRestoredToast({ title: 'Plans', folder: 'Work', sayFolder: true })).toBe(
      'Restored "Plans" to Work.',
    );
    expect(c.vaultRestoredToast({ title: 'Plans', folder: 'Work', renamed: true })).toBe(
      '"Plans" was already in Work, so the restored one is "Plans (restored)".',
    );
    expect(c.vaultTrashLead('local')).toBe('Deleted notes wait here until you empty Trash.');
  });
});
