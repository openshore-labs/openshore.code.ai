// The Vault room's fallback (0.10) always has a way out that works. App.tsx
// mounts the room as <VaultRoom />, the Vault screen inside its error
// boundary. On a note, the way back closes the note and shows the notes list.
// In the notes list there is no note to close, and the same render would
// fault again, so the fallback leaves the room (the next visit mounts it
// fresh) and offers a try again for a fault that has passed. Mounted in a real
// (small) DOM, since a boundary only catches inside a real render.
//
// The real Vault screen is mounted too, for what only a real render shows:
// the New note sheet refills a dot-led name instead of renaming it silently
// (T6), and a read-only Drive vault leaves out the controls that write, with
// its card at every folder level and its one button that works (C1a, X2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

// The store, as far as the room and the screen read it: the open note,
// closing it, moving to another room, and the vault's own state and actions.
const app = vi.hoisted(() => {
  type State = Record<string, unknown> & {
    vaultNote?: {
      path: string;
      text?: string;
      updatedAt?: string;
      fresh?: boolean;
      reloaded?: number;
      reloadedFrom?: 'elsewhere' | 'resolve';
    };
    vaultConflict?: Record<string, unknown> & { deferred: boolean };
    vaultCloseNote: () => void;
    setView: (view: string) => void;
  };
  const listeners = new Set<() => void>();
  const views: string[] = [];
  const toasts: string[] = [];
  const created: string[] = [];
  const opened: string[] = [];
  const drive = { readOnly: undefined as string | undefined, connected: true, configured: true };
  // What the folder controls answer: a pick's result, whether the move card
  // is offered, and the two texts of each forked pair.
  const folderIo = {
    pick: undefined as unknown,
    offer: false,
    declined: 0,
    settled: [] as string[],
    pairs: {} as Record<
      string,
      {
        there: { path: string; text: string; updatedAt: string; version: string };
        moved: { path: string; text: string; updatedAt: string; version: string };
      }
    >,
  };
  const state: State = {
    vaultNote: undefined,
    vaultCloseNote: () => {
      state.vaultNote = undefined;
      listeners.forEach((l) => l());
    },
    setView: (view) => {
      views.push(view);
    },
    vaultFiles: [] as Array<{ path: string; updatedAt: string; size: number }>,
    vaultScope: 'personal',
    setVaultScope: async () => {},
    teamVaultAvailable: () => false,
    vaultRefresh: async () => {},
    vaultOpen: async (path: string) => {
      opened.push(path);
    },
    vaultCreate: async (path: string) => {
      created.push(path);
    },
    vaultSave: async () => undefined,
    vaultDelete: async () => false,
    vaultReadAll: async () => Object.assign([], { failed: [] }),
    vaultMoveTo: async () => ({ ok: false, skipped: [] }),
    vaultError: undefined,
    vaultHeld: [],
    vaultTargetRef: () => ({ providerId: 'local', resourceId: 'vault.personal' }),
    vaultReadOnly: () => drive.readOnly,
    vaultDiscardHeld: async () => {},
    vaultAcquireLease: async () => {},
    vaultReleaseLease: async () => {},
    vaultLeaseHeldByOther: undefined,
    connectGdriveAccount: async () => ({ ok: false }),
    disconnectGdriveAccount: async () => {},
    authSession: undefined,
    settings: {},
    hubRole: undefined,
    showToast: (text: string) => {
      toasts.push(text);
    },
    openProjectMemory: () => {},
    repoSyncConflicts: undefined,
    vaultConflict: undefined,
    vaultReturnFolder: undefined,
    vaultRecheck: async () => {},
    vaultResolve: async () => ({ ok: true }),
    vaultDeferConflict: (deferred: boolean) => {
      if (state.vaultConflict) state.vaultConflict = { ...state.vaultConflict, deferred };
      listeners.forEach((l) => l());
    },
    vaultLeaveConflict: async () => {},
    vaultNoteDraft: () => {},
    vaultTakeReturnFolder: () => undefined,
    // Vault M1 1.3 and 1.4: the desktop folder, the move card, the picker.
    vaultFolder: undefined as Record<string, unknown> | undefined,
    vaultMoving: false,
    vaultListed: true,
    vaultLoadFolder: async () => app.state.vaultFolder,
    vaultChooseFolder: async () => folderIo.pick,
    vaultRefineFolder: async () => folderIo.pick,
    vaultFolderOfferShown: () => folderIo.offer,
    vaultDeclineFolderMove: async () => {
      folderIo.declined++;
      folderIo.offer = false;
      listeners.forEach((l) => l());
    },
    vaultReadForkPair: async (pair: { from: string; to: string }) => folderIo.pairs[pair.from],
    vaultSettleFork: async (pair: { from: string; to: string }, choice: string) => {
      folderIo.settled.push(`${choice}:${pair.from}`);
      return { ok: true };
    },
    vaultDesktopChatOpen: () => false,
    vaultBringPrevious: async () => ({ ok: true, moved: [], skipped: [], forked: [] }),
  };
  return { state, listeners, views, toasts, created, opened, drive, folderIo };
});
vi.mock('../src/state/store.js', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (l: () => void) => {
    app.listeners.add(l);
    return () => app.listeners.delete(l);
  };
  return {
    useApp: <T,>(select?: (s: typeof app.state) => T) =>
      useSyncExternalStore(subscribe, () => (select ? select(app.state) : app.state)),
    agenticView: () => ({}),
    vaultHeldFor: () => [],
  };
});
// Whether this device reaches the Google account behind a Drive vault.
vi.mock('../src/lib/gitos/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/gitos/index.js')>()),
  isGdriveConnected: async () => app.drive.connected,
  isGdriveConfigured: () => app.drive.configured,
  probeReady: async () => false,
}));
const external = vi.hoisted(() => [] as string[]);
// Whether this render is the desktop app (the move card and the folder rows
// are desktop only).
const onDesk = vi.hoisted(() => ({ on: false }));
vi.mock('../src/lib/platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/platform.js')>();
  return {
    ...actual,
    platform: () => (onDesk.on ? 'electron' : actual.platform()),
    isDesktop: () => onDesk.on || actual.isDesktop(),
    openExternal: (url: string) => {
      external.push(url);
    },
  };
});
// The folder controls reach main through the bridge; here they only record.
const folderCalls = vi.hoisted(() => [] as string[]);
vi.mock('../src/lib/vaultFolder.js', () => ({
  canPickVaultFolder: () => onDesk.on,
  vaultFolderInfo: async () => undefined,
  chooseVaultFolder: async () => undefined,
  refineVaultFolder: async () => undefined,
  revealVaultFolder: async () => {
    folderCalls.push('reveal');
    return true;
  },
  openVaultInObsidian: async () => {
    folderCalls.push('obsidian');
  },
  openPrivacySettings: async () => {
    folderCalls.push('privacy');
  },
}));
// The top bar reads the rest of the store; the fallback is what is tested.
vi.mock('../src/components/BackBar.js', () => ({
  BackBar: ({ title }: { title: string }) => <header>{title}</header>,
}));

const { VaultRoom } = await import('../src/screens/VaultScreen.js');

// Stands in for the Vault screen: it faults while `faults.list` (the notes
// list) or `faults.note` (a note is open) says so.
const faults = { list: true, note: true };
function Screen() {
  const open = app.state.vaultNote !== undefined;
  if (open ? faults.note : faults.list) throw new Error('render fault');
  return <p>{open ? 'the note' : 'the notes list'}</p>;
}

describe('the Vault room fallback', () => {
  let dom: TestDom;
  beforeEach(async () => {
    app.state.vaultNote = undefined;
    app.views.length = 0;
    faults.list = true;
    faults.note = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    vi.restoreAllMocks();
  });

  it('a fault in the notes list leaves the room, never re-renders the same fault', async () => {
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    expect(dom.text()).toContain('This could not be shown.');
    expect(dom.buttons()).not.toContain('Back to your notes');
    await dom.click('Back to Chat');
    expect(app.views).toEqual(['chat']);
  });

  it('a try again in the notes list shows it once the fault has passed', async () => {
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    faults.list = false;
    await dom.click('Try again');
    expect(dom.text()).toBe('the notes list');
    expect(app.views).toEqual([]);
  });

  it('a fault on a note goes back to the notes list', async () => {
    app.state.vaultNote = { path: 'Plan.md' };
    faults.list = false;
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    expect(dom.buttons()).toContain('Back to your notes');
    await dom.click('Back to your notes');
    expect(app.state.vaultNote).toBeUndefined();
    expect(dom.text()).toBe('the notes list');
    expect(app.views).toEqual([]);
  });

  it('a note whose list faults too still ends on a way out', async () => {
    app.state.vaultNote = { path: 'Plan.md' };
    await dom.render(
      <VaultRoom>
        <Screen />
      </VaultRoom>,
    );
    await dom.click('Back to your notes');
    expect(dom.buttons()).toContain('Back to Chat');
  });
});

describe('the Vault screen', () => {
  let dom: TestDom;
  beforeEach(async () => {
    app.state.vaultNote = undefined;
    app.state.vaultFiles = [];
    app.views.length = 0;
    app.toasts.length = 0;
    app.created.length = 0;
    app.opened.length = 0;
    external.length = 0;
    Object.assign(app.drive, { readOnly: undefined, connected: true, configured: true });
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
  });

  // T6: v1 has no rename, so a dot the typed-name rule would strip is shown
  // before the note is made, never lost silently.
  it('refills a dot-led name and creates nothing on the first tap; the second tap creates it', async () => {
    await dom.render(<VaultRoom />);
    await dom.click('Write your first note');
    await dom.type('Note name', '.NET migration');
    await dom.click('Create');
    expect(app.created).toEqual([]);
    expect(dom.value('Note name')).toBe('NET migration');
    expect(app.toasts).toEqual([
      'Note names cannot start with a dot, since Obsidian and your vault hide them. Tap Create to use "NET migration", or change it.',
    ]);
    await dom.click('Create');
    expect(app.created).toEqual(['NET migration.md']);
  });

  it('a plain name is created on the first tap', async () => {
    await dom.render(<VaultRoom />);
    await dom.click('Write your first note');
    await dom.type('Note name', 'ideas/first');
    await dom.click('Create');
    expect(app.created).toEqual(['ideas/first.md']);
    expect(app.toasts).toEqual([]);
  });

  // C1a: a read-only Drive vault leaves out every control that writes, and
  // its card, the reason, shows at every folder level.
  it('a read-only Drive vault leaves out New note, and its card shows in a subfolder', async () => {
    app.drive.readOnly =
      'Google Drive vaults are read-only for now. Move this vault to keep editing.';
    app.state.vaultFiles = [{ path: 'ideas/a.md', updatedAt: 'x', size: 1 }];
    await dom.render(<VaultRoom />);
    await dom.settle();
    expect(dom.container.querySelector('[aria-label="New note"]')).toBeNull();
    expect(dom.text()).toContain('This vault is read-only');
    await dom.click('ideas');
    expect(dom.text()).toContain('This vault is read-only');
    expect(dom.buttons()).toContain('Move to This device');
    expect(dom.container.querySelector('button:disabled')).toBeNull();
  });

  // C1a: when a move off Drive lands, the card folds out keeping its last
  // words, so the controls coming back read as the card leaving, never a cut.
  it('when the vault stops being read-only, the card folds out and New note returns', async () => {
    app.drive.readOnly =
      'Google Drive vaults are read-only for now. Move this vault to keep editing.';
    app.state.vaultFiles = [{ path: 'a.md', updatedAt: 'x', size: 1 }];
    await dom.render(<VaultRoom />);
    await dom.settle();
    app.drive.readOnly = undefined;
    await dom.render(<VaultRoom />);
    const card = dom.container.querySelector('.vault-drive-card');
    expect(card?.className).toContain('closing');
    expect(card?.textContent).toContain('Move to This device');
    expect(dom.container.querySelector('[aria-label="New note"]')).not.toBeNull();
  });

  it('an empty read-only Drive vault shows the ramp with no ways in that write', async () => {
    app.drive.readOnly =
      'Google Drive vaults are read-only for now. Move this vault to keep editing.';
    await dom.render(<VaultRoom />);
    await dom.settle();
    expect(dom.text()).toContain('A home for what you know');
    expect(dom.buttons()).not.toContain('Write your first note');
    expect(dom.buttons()).not.toContain('Add a welcome note');
  });

  // X2: a build that cannot connect to Google cannot move or reconnect, so
  // the card names the folder and opens Google Drive, and nothing on screen
  // contradicts it.
  it('on a build that cannot connect, the card alone explains, and opens Google Drive', async () => {
    Object.assign(app.drive, {
      readOnly: 'Google Drive vaults are read-only for now. Move this vault to keep editing.',
      connected: false,
      configured: false,
    });
    app.state.vaultError = 'load';
    try {
      await dom.render(<VaultRoom />);
      await dom.settle();
      const text = dom.text();
      expect(text).toContain('in the folder vault.personal');
      expect(text).not.toContain('Move this vault to keep editing');
      expect(text).not.toContain('Your vault storage is offline.');
      expect(text).not.toContain('A home for what you know');
      expect(dom.buttons()).not.toContain('Try again');
      await dom.click('Open Google Drive');
      expect(external).toEqual(['https://drive.google.com/drive/my-drive']);
      expect(app.opened).toEqual([]);
    } finally {
      app.state.vaultError = undefined;
    }
  });
});

// Vault M1, 1.1: a note that changed somewhere else under unsaved edits.
describe('the Vault screen with a choice open (1.1)', () => {
  let dom: TestDom;
  const EDITOR = 'Write. Plain markdown, and [[wikilinks]] to connect notes.';
  const conflict = (over: Record<string, unknown> = {}) => ({
    path: 'Plan.md',
    target: { providerId: 'files', resourceId: 'vault.personal' },
    kind: 'changed',
    base: 'loaded',
    theirs: { path: 'Plan.md', text: 'theirs', updatedAt: 'x', version: 'v2' },
    copyPath: 'Plan (conflict 2026-09-27 1405).md',
    foundAt: 0,
    deferred: false,
    ...over,
  });
  // The mock store hands the screen one mutable object, so a change is shown
  // by rendering again, as the Drive card cases do.
  const notify = () => dom.render(<VaultRoom />);
  beforeEach(async () => {
    // The small DOM has no frame clock; the screen restores the caret on one.
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    app.state.vaultNote = { path: 'Plan.md', text: 'loaded', updatedAt: 'v1', fresh: true };
    app.state.vaultConflict = undefined;
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: 'v1', size: 6 }];
    app.toasts.length = 0;
    Object.assign(app.drive, { readOnly: undefined, connected: true, configured: true });
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    app.state.vaultNote = undefined;
    app.state.vaultConflict = undefined;
  });
  const sheet = () => dom.container.querySelector('.vault-resolve');

  it('rises at once when the editor is not in use; closing it shows the card, and the editor stays editable', async () => {
    await dom.render(<VaultRoom />);
    app.state.vaultConflict = conflict();
    await notify();
    await dom.settle();
    expect(sheet()).not.toBeNull();
    expect(dom.text()).toContain('Two versions of this note');
    // Options (Delete) is left out while a choice is open.
    expect(dom.container.querySelector('[aria-label="Options"]')).toBeNull();
    const close = sheet()!.querySelector<HTMLButtonElement>('.mode-close')!;
    const { act } = await import('react');
    await act(async () => {
      const w = globalThis.window as unknown as { Event: typeof Event };
      close.dispatchEvent(new w.Event('click', { bubbles: true }));
    });
    expect(app.state.vaultConflict?.deferred).toBe(true);
    await notify();
    expect(dom.text()).toContain('Your edits stay here, unsaved, until you choose.');
    expect(dom.buttons()).toContain('Choose a version');
    const editor = dom.container.querySelector('textarea')!;
    expect(editor.disabled).toBe(false);
    // Its button brings the sheet back.
    await dom.click('Choose a version');
    expect(app.state.vaultConflict?.deferred).toBe(false);
  });

  it('does not rise while the person is typing, only once the editor has been quiet', async () => {
    await dom.render(<VaultRoom />);
    const editor = dom.container.querySelector('textarea')!;
    // linkedom keeps no focus: stand in for a focused editor.
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => editor });
    try {
      await dom.type(EDITOR, 'loaded, and more');
      app.state.vaultConflict = conflict();
      await notify();
      await dom.settle();
      expect(sheet()).toBeNull();
      // Nothing is inserted above the editor while it waits.
      expect(dom.container.querySelector('.vault-conflict-card')).toBeNull();
      const { act } = await import('react');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1300));
      });
      expect(sheet()).not.toBeNull();
    } finally {
      delete (document as unknown as { activeElement?: unknown }).activeElement;
    }
  });

  it('a calm reload says Updated from elsewhere, with no toast, until the next edit', async () => {
    await dom.render(<VaultRoom />);
    app.state.vaultNote = {
      path: 'Plan.md',
      text: 'written elsewhere',
      updatedAt: 'v2',
      reloaded: 1,
      reloadedFrom: 'elsewhere',
    };
    await notify();
    await dom.settle();
    expect(dom.text()).toContain('Updated from elsewhere');
    expect(dom.container.querySelector('textarea')!.value).toBe('written elsewhere');
    expect(app.toasts).toEqual([]);
    await dom.type(EDITOR, 'written elsewhere, and mine');
    expect(dom.text()).not.toContain('Updated from elsewhere');
  });
});

// Vault M1 1.3 (Creative Studio 2, 1d; CX 1.3): the one-time desktop move
// card, and the move-mode sheet for a move's forked pairs.
describe('the desktop move card (1.3)', () => {
  let dom: TestDom;
  const FOLDER = {
    dir: '/home/me/OSCode/Vault',
    display: '~/OSCode/Vault',
    exists: true,
    os: 'linux',
    obsidian: 'none',
    count: 2,
  };
  const card = () => dom.container.querySelector('.vault-move-card');
  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    onDesk.on = true;
    app.state.vaultNote = undefined;
    app.state.vaultFiles = [
      { path: 'a.md', updatedAt: 'x', size: 1 },
      { path: 'b.md', updatedAt: 'x', size: 1 },
      { path: 'ideas/c.md', updatedAt: 'x', size: 1 },
    ];
    app.state.vaultFolder = { ...FOLDER };
    app.state.settings = {};
    app.toasts.length = 0;
    app.folderIo.offer = true;
    app.folderIo.declined = 0;
    app.folderIo.settled.length = 0;
    app.folderIo.pairs = {};
    Object.assign(app.drive, { readOnly: undefined, connected: true, configured: true });
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    onDesk.on = false;
    app.folderIo.offer = false;
    app.state.vaultFolder = undefined;
    app.state.vaultFiles = [];
    app.state.vaultMoveTo = async () => ({ ok: false, skipped: [] });
  });

  it('shows at the root with the folder path, and not in a subfolder', async () => {
    await dom.render(<VaultRoom />);
    expect(card()).not.toBeNull();
    const text = card()!.textContent!;
    expect(text).toContain('One folder for you and your agent');
    expect(text).toContain('Your 3 notes are sealed on this device');
    expect(text).toContain('~/OSCode/Vault');
    expect(text).toContain('The 2 notes already in the folder stay as they are.');
    expect(dom.buttons()).toContain('Move to This folder');
    expect(dom.buttons()).toContain('Keep it on this device');
    // The lead leaves its own pointer to This folder to the card.
    expect(dom.text()).not.toContain('Move the vault to This folder to share it.');
    await dom.click('ideas');
    expect(card()?.className ?? 'closing').toContain('closing');
  });

  it('Keep it on this device hides it for good', async () => {
    await dom.render(<VaultRoom />);
    await dom.click('Keep it on this device');
    expect(app.folderIo.declined).toBe(1);
    await dom.render(<VaultRoom />);
    // It folds out (never a snap), then is gone.
    expect(card()?.className ?? 'closing').toContain('closing');
  });

  it('a person-chosen or folder vault never shows it', async () => {
    app.folderIo.offer = false;
    await dom.render(<VaultRoom />);
    expect(card()).toBeNull();
    expect(dom.text()).toContain('Move the vault to This folder to share it.');
  });

  it('a refused move keeps the card, says why inside it, and offers Try again', async () => {
    app.state.vaultMoveTo = async () => ({
      ok: false,
      moved: [],
      skipped: [],
      forked: [],
      reason: 'copy-failed',
    });
    await dom.render(<VaultRoom />);
    await dom.click('Move to This folder');
    await dom.settle();
    expect(card()!.textContent).toContain('Could not copy your notes to This folder');
    expect(dom.buttons()).toContain('Try again');
    expect(app.toasts).toEqual([]);
  });

  it('a move with two forks opens the move sheet at 1 of 2; closing keeps both; Keep the one you moved takes two taps', async () => {
    const pair = (from: string, to: string) => ({
      there: { path: from, text: 'already there', updatedAt: 'x', version: 'v1' },
      moved: { path: to, text: 'the one you moved', updatedAt: 'x', version: 'v2' },
    });
    app.folderIo.pairs = {
      'a.md': pair('a.md', 'a (conflict 2026-09-27 1405).md'),
      'b.md': pair('b.md', 'b (conflict 2026-09-27 1405).md'),
    };
    app.state.vaultMoveTo = async () => ({
      ok: true,
      moved: ['a.md', 'b.md', 'ideas/c.md'],
      skipped: [],
      forked: [
        { from: 'a.md', to: 'a (conflict 2026-09-27 1405).md' },
        { from: 'b.md', to: 'b (conflict 2026-09-27 1405).md' },
      ],
    });
    await dom.render(<VaultRoom />);
    await dom.click('Move to This folder');
    await dom.settle();
    await new Promise((r) => setTimeout(r, 10));
    await dom.settle();
    // The toast leaves the forked sentence to the sheet.
    expect(app.toasts).toEqual([
      'Your vault moved to This folder. Obsidian opens this folder as a vault.',
    ]);
    const sheet = () => dom.container.querySelector('.vault-resolve');
    expect(sheet()).not.toBeNull();
    expect(sheet()!.textContent).toContain('Two versions of a note');
    expect(sheet()!.textContent).toContain('1 of 2');
    expect(sheet()!.textContent).toContain('Closing keeps both.');
    const row = (c: string) =>
      dom.container.querySelector<HTMLButtonElement>(`[data-choice="${c}"]`)!;
    const { act } = await import('react');
    const tap = (el: HTMLElement) =>
      act(async () => {
        const w = globalThis.window as unknown as { Event: typeof Event };
        el.dispatchEvent(new w.Event('click', { bubbles: true }));
      });
    // The first tap only arms it.
    await tap(row('mine'));
    expect(app.folderIo.settled).toEqual([]);
    expect(row('mine').textContent).toContain('Really delete the other? Tap to confirm.');
    await tap(row('mine'));
    await dom.settle();
    expect(app.folderIo.settled).toEqual(['mine:a.md']);
    expect(sheet()!.textContent).toContain('2 of 2');
    // Closing now keeps both of the second pair: nothing more is settled.
    await tap(sheet()!.querySelector<HTMLButtonElement>('.mode-close')!);
    await dom.settle();
    expect(app.folderIo.settled).toEqual(['mine:a.md']);
  });
});

describe('a move whose forked pair cannot be shown (review M1-2)', () => {
  let dom: TestDom;
  beforeEach(async () => {
    onDesk.on = true;
    app.state.vaultNote = undefined;
    app.state.vaultFiles = [{ path: 'a.md', updatedAt: 'x', size: 1 }];
    app.state.vaultFolder = {
      dir: '/home/me/OSCode/Vault',
      display: '~/OSCode/Vault',
      exists: true,
      os: 'linux',
      obsidian: 'none',
      count: 1,
    };
    app.state.settings = {};
    app.toasts.length = 0;
    app.folderIo.offer = true;
    app.folderIo.pairs = {};
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    onDesk.on = false;
    app.folderIo.offer = false;
    app.state.vaultFolder = undefined;
    app.state.vaultFiles = [];
    app.state.vaultMoveTo = async () => ({ ok: false, skipped: [] });
  });

  it('keeps the forked sentence in the toast when the sheet could not open', async () => {
    app.state.vaultMoveTo = async () => ({
      ok: true,
      moved: ['a.md'],
      skipped: [],
      forked: [{ from: 'a.md', to: 'a (conflict 2026-09-27 1405).md' }],
    });
    await dom.render(<VaultRoom />);
    await dom.click('Move to This folder');
    await dom.settle();
    await new Promise((r) => setTimeout(r, 10));
    await dom.settle();
    expect(dom.container.querySelector('.vault-resolve')).toBeNull();
    expect(app.toasts).toEqual([
      'Your vault moved to This folder. "a" was already there with different text, so the one you moved is beside it as "a (conflict 2026-09-27 1405)". Obsidian opens this folder as a vault.',
    ]);
  });
});

// Vault M1 1.4 (Creative Studio 3a): the desktop folder rows.
describe('the desktop folder rows in Where it lives (1.4)', () => {
  let dom: TestDom;
  const FOLDER = {
    dir: '/home/me/Brain',
    display: '~/Brain',
    exists: true,
    os: 'darwin',
    obsidian: 'vault',
    count: 4,
  };
  beforeEach(async () => {
    onDesk.on = true;
    app.state.vaultNote = undefined;
    app.state.vaultFiles = [{ path: 'a.md', updatedAt: 'x', size: 1 }];
    app.state.settings = {
      gitosResources: [
        { id: 'vault.personal', name: 'Vault', kind: 'vault', providerId: 'files', createdAt: 'x' },
      ],
    };
    app.toasts.length = 0;
    folderCalls.length = 0;
    app.folderIo.offer = false;
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    onDesk.on = false;
    app.state.vaultFolder = undefined;
    app.state.settings = {};
    app.state.vaultFiles = [];
    app.folderIo.pick = undefined;
  });
  const openSheet = async () => {
    await dom.render(<VaultRoom />);
    await dom.click('Where it lives');
    await dom.settle();
  };

  it('shows the path, Open in Finder, and Open in Obsidian only for a folder Obsidian knows', async () => {
    app.state.vaultFolder = { ...FOLDER };
    await openSheet();
    expect(dom.container.querySelector('.vault-path')?.textContent).toBe('~/Brain');
    expect(dom.buttons()).toContain('Open in Finder');
    expect(dom.buttons()).toContain('Open in Obsidian');
    await dom.click('Open in Obsidian');
    await dom.click('Open in Finder');
    await dom.settle();
    expect(folderCalls).toEqual(['obsidian', 'reveal']);
    // The retired duplicate row is gone.
    expect(dom.text()).not.toContain('Keep as plain files');
  });

  it('Obsidian installed but the folder not a vault yet: the step, never a button', async () => {
    app.state.vaultFolder = { ...FOLDER, obsidian: 'installed', os: 'linux' };
    await openSheet();
    expect(dom.buttons()).not.toContain('Open in Obsidian');
    expect(dom.buttons()).toContain('Open folder');
    expect(dom.text()).toContain('To open it in Obsidian, choose Open folder as vault there');
  });

  it('a missing folder shows Not found and the warn line, and the room writes nothing', async () => {
    app.state.vaultFolder = { ...FOLDER, exists: false };
    app.state.vaultFiles = [];
    await dom.render(<VaultRoom />);
    expect(dom.text()).toContain('Your vault folder is missing');
    expect(dom.container.querySelector('[aria-label="New note"]')).toBeNull();
    await dom.click('Where it lives');
    await dom.settle();
    expect(dom.text()).toContain('Not found');
    expect(dom.text()).toContain('This folder is not there right now.');
  });

  it("shows the engine's relative-path warning verbatim under the path", async () => {
    app.state.vaultFolder = { ...FOLDER, warning: 'vault.dir "notes" is not an absolute path.' };
    await openSheet();
    expect(dom.text()).toContain(
      'vault.dir "notes" is not an absolute path. Or use a folder below, which saves a full path.',
    );
  });

  it('after a pick the sheet shows what it found, and no toast fires', async () => {
    app.state.vaultFolder = { ...FOLDER };
    app.folderIo.pick = {
      ok: true,
      info: { ...FOLDER, dir: '/home/me/Brain/Projects', display: '~/Brain/Projects' },
      survey: {
        notes: 3,
        capped: false,
        otherFiles: 0,
        obsidian: false,
        inside: { name: 'Brain' },
      },
      previous: { display: '~/OSCode/Vault' },
    };
    await openSheet();
    await dom.click(
      'Use a folder…Pick another folder, an existing Obsidian vault included. Notes are not copied.',
    );
    await dom.settle();
    const text = dom.text();
    expect(text).toContain('Your vault is now ~/Brain/Projects.');
    expect(text).toContain('A folder with 3 notes.');
    expect(text).toContain('"Projects" is a folder inside your Obsidian vault "Brain".');
    expect(dom.buttons()).toContain('Go back to ~/OSCode/Vault');
    expect(app.toasts).toEqual([]);
  });

  it('a refusal shows under the picker row, in the sheet', async () => {
    app.state.vaultFolder = { ...FOLDER };
    app.folderIo.pick = { ok: false, refused: 'home' };
    await openSheet();
    await dom.click(
      'Use a folder…Pick another folder, an existing Obsidian vault included. Notes are not copied.',
    );
    await dom.settle();
    expect(dom.text()).toContain('That is your whole home folder. Pick a folder inside it.');
    expect(app.toasts).toEqual([]);
  });

  // The CTO's Bring: after a pick, the notes of the folder before can be
  // copied in, nothing replaced, and the originals left where they are.
  const pickFrom = (notes: number | undefined) => {
    app.state.vaultFolder = { ...FOLDER };
    app.folderIo.pick = {
      ok: true,
      info: { ...FOLDER, dir: '/home/me/Notes', display: '~/Notes', obsidian: 'installed' },
      survey: { notes: 1, capped: false, otherFiles: 0, obsidian: false },
      previous: { display: '~/OSCode/Vault', ...(notes === undefined ? {} : { notes }) },
    };
  };
  const PICK_ROW =
    'Use a folder…Pick another folder, an existing Obsidian vault included. Notes are not copied.';
  const BRING_SUB =
    'Copies them here. Nothing here is replaced, and the originals stay where they are.';

  it('Bring shows only when the folder before held notes', async () => {
    pickFrom(0);
    await openSheet();
    await dom.click(PICK_ROW);
    await dom.settle();
    expect(dom.text()).not.toContain('Bring');
    pickFrom(undefined);
    await dom.click(PICK_ROW);
    await dom.settle();
    expect(dom.text()).not.toContain('Bring');
    pickFrom(1);
    await dom.click(PICK_ROW);
    await dom.settle();
    expect(dom.buttons()).toContain(`Bring 1 note from ~/OSCode/Vault${BRING_SUB}`);
  });

  it('Bring copies the notes in, says so, and goes', async () => {
    pickFrom(3);
    let finish: (v: unknown) => void = () => {};
    app.state.vaultBringPrevious = () => new Promise((r) => (finish = r));
    await openSheet();
    await dom.click(PICK_ROW);
    await dom.settle();
    await dom.click(`Bring 3 notes from ~/OSCode/Vault${BRING_SUB}`);
    await dom.settle();
    expect(dom.text()).toContain('Bringing your notes');
    finish({ ok: true, moved: ['a.md', 'b.md', 'c.md'], skipped: [], forked: [] });
    await dom.settle();
    expect(app.toasts).toEqual([
      'Your notes from ~/OSCode/Vault are here now. The originals stay there.',
    ]);
    expect(dom.text()).not.toContain('Bring 3 notes');
    app.state.vaultBringPrevious = async () => ({ ok: true, moved: [], skipped: [], forked: [] });
  });

  it('Bring with forks opens the move sheet and leaves the forked sentence to it', async () => {
    pickFrom(2);
    app.folderIo.pairs = {
      'b.md': {
        there: { path: 'b.md', text: 'already here', updatedAt: 'x', version: 'v1' },
        moved: {
          path: 'b (conflict 2026-09-27 1405).md',
          text: 'from the old folder',
          updatedAt: 'x',
          version: 'v2',
        },
      },
    };
    app.state.vaultBringPrevious = async () => ({
      ok: true,
      moved: ['a.md'],
      skipped: [],
      forked: [{ from: 'b.md', to: 'b (conflict 2026-09-27 1405).md' }],
    });
    await openSheet();
    await dom.click(PICK_ROW);
    await dom.settle();
    await dom.click(`Bring 2 notes from ~/OSCode/Vault${BRING_SUB}`);
    await dom.settle();
    await new Promise((r) => setTimeout(r, 900));
    await dom.settle();
    expect(dom.container.querySelector('.vault-resolve')?.textContent).toContain(
      'Two versions of a note',
    );
    expect(app.toasts).toEqual([
      'Your notes from ~/OSCode/Vault are here now. The originals stay there.',
    ]);
    app.state.vaultBringPrevious = async () => ({ ok: true, moved: [], skipped: [], forked: [] });
    app.folderIo.pairs = {};
  });
});
