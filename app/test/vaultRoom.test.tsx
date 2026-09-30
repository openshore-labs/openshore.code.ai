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
  // What the editor asked of the lease: keystrokes, and Take over editing.
  const leases = { touches: 0, takeOvers: 0 };
  // The team poll's start and stop calls, in order.
  const polls: string[] = [];
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
    vaultReadBody: async () => undefined as string | undefined,
    vaultMoveTo: async () => ({ ok: false, skipped: [] }),
    vaultError: undefined,
    vaultHeld: [],
    vaultTargetRef: () => ({ providerId: 'local', resourceId: 'vault.personal' }),
    vaultReadOnly: () => drive.readOnly,
    vaultDiscardHeld: async () => {},
    vaultAcquireLease: async () => {},
    vaultReleaseLease: async () => {},
    vaultLeaseTouch: async () => {
      leases.touches++;
    },
    vaultTakeOverLease: async () => {
      leases.takeOvers++;
    },
    vaultLeaseHeldByOther: undefined as boolean | undefined,
    vaultLeaseOther: undefined as { mode: 'advisory' | 'enforced'; label?: string } | undefined,
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
    vaultRecheck: async () => 'skipped',
    vaultStartPoll: (opts?: { now?: boolean }) => {
      polls.push(opts?.now ? 'start-now' : 'start');
    },
    vaultStopPoll: () => {
      polls.push('stop');
    },
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
    // Vault M5: a note to a model, pins, the hub card, what the agent wrote.
    askAboutVaultNote: async () => {},
    pinVaultNoteToProject: async () => 'pinned' as const,
    canEditProjectPins: () => true,
    vaultHubOfferShown: () => false,
    vaultAcceptHubMove: async () => ({ ok: true, moved: [], skipped: [], forked: [] }),
    vaultDeclineHubMove: async () => {},
    vaultAgentRecent: async () => [],
    // Vault M6: the operations' call sites and what the storage may do.
    vaultBindAutosave: () => {},
    vaultCapsNow: () => ({
      rename: false,
      renameNative: false,
      folders: false,
      trash: false,
      emptyTrash: false,
      attachments: false,
      taskWriteBack: false,
      linkRewrite: false,
      today: false,
    }),
    vaultDeleteNote: async () => undefined,
    vaultUndoDelete: async () => undefined,
    vaultTrash: undefined,
    vaultLoadTrash: async () => [],
    vaultRestoreTrash: async () => ({ ok: false, reason: 'unsupported' }),
    vaultEmptyTrash: async () => ({ ok: false, reason: 'unsupported' }),
    vaultDeleteFolder: async () => undefined,
    vaultPrepareMove: async () => undefined,
    vaultApplyMove: async () => undefined,
    vaultUpdateRest: async () => undefined,
    vaultCreateFolder: async () => ({ ok: false, reason: 'unsupported' }),
    vaultFolderCounts: async () => ({ notes: 0, attachments: 0 }),
    vaultFolders: undefined,
    vaultSearchSource: () => undefined,
    vaultRecentRing: () => [],
    vaultToday: async () => undefined,
    vaultToggleTask: async () => false,
    vaultMediaNow: async () => undefined,
    vaultRewriteNote: async () => false,
    // Vault M7 wave 2: the settings, provenance and starter actions.
    vaultSettings: undefined,
    vaultLoadSettings: async () => undefined,
    vaultSaveSetting: async () => ({ kind: 'read-only' }),
    vaultMarkReviewed: async () => 'ok',
    vaultStarterOffered: async () => false,
    vaultApplyStarter: async () => ({ added: 0, total: 0 }),
    vaultSheetRequest: undefined,
    vaultRequestSheet: () => {},
  };
  return { state, listeners, views, toasts, created, opened, drive, folderIo, leases, polls };
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
    isOrgAdmin: () => true,
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

// Vault M2 2.2: where the text stands, and conflict copies in the tree.
describe('the save chip and conflict badges (M2 2.2)', () => {
  let dom: TestDom;
  const EDITOR = 'Write. Plain markdown, and [[wikilinks]] to connect notes.';
  let refreshed = 0;
  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    refreshed = 0;
    app.state.vaultRefresh = async () => {
      refreshed++;
    };
    app.state.vaultNote = { path: 'Plan.md', text: 'loaded', updatedAt: 'v1', fresh: true };
    app.state.vaultConflict = undefined;
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: 'v1', size: 6 }];
    app.state.vaultPending = [];
    app.state.vaultSaving = false;
    app.state.vaultError = undefined;
    Object.assign(app.drive, { readOnly: undefined, connected: true, configured: true });
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    app.state.vaultNote = undefined;
    app.state.vaultPending = [];
    app.state.vaultSaving = false;
    app.state.vaultError = undefined;
    app.state.vaultRefresh = async () => {};
  });
  const chip = () => dom.container.querySelector('.vault-save-chip');

  it('says Saved, then Saving while typed text waits', async () => {
    await dom.render(<VaultRoom />);
    expect(chip()?.textContent).toBe('Saved');
    await dom.type(EDITOR, 'loaded, and more');
    expect(chip()?.textContent).toBe('Saving');
  });

  it('says the text is kept on this device, how many notes wait, and retries', async () => {
    app.state.vaultPending = [
      { providerId: 'local', resourceId: 'vault.personal', path: 'Plan.md' },
      { providerId: 'local', resourceId: 'vault.personal', path: 'Other.md' },
      { providerId: 'files', resourceId: 'vault.personal', path: 'Elsewhere.md' },
    ];
    await dom.render(<VaultRoom />);
    expect(chip()?.getAttribute('role')).toBe('status');
    expect(chip()?.textContent).toContain('Offline, kept on this device');
    expect(chip()?.textContent).toContain('2 notes waiting');
    const before = refreshed;
    await dom.click('Try again');
    expect(refreshed).toBe(before + 1);
  });

  it('is left out while a choice about the note is open', async () => {
    app.state.vaultConflict = {
      path: 'Plan.md',
      target: { providerId: 'local', resourceId: 'vault.personal' },
      kind: 'changed',
      base: 'loaded',
      copyPath: 'Plan (conflict 2026-09-27 1405).md',
      foundAt: 0,
      deferred: true,
    };
    await dom.render(<VaultRoom />);
    expect(chip()).toBeNull();
    app.state.vaultConflict = undefined;
  });

  it('a conflict copy wears a badge in the tree, and a plain note does not', async () => {
    app.state.vaultNote = undefined;
    app.state.vaultFiles = [
      { path: 'Plan.md', updatedAt: 'v1', size: 6 },
      { path: 'Plan (conflict 2026-09-27 1405).md', updatedAt: 'v1', size: 6 },
    ];
    await dom.render(<VaultRoom />);
    const badges = dom.container.querySelectorAll('.vault-conflict-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest('button')!.textContent).toContain('Plan (conflict 2026-09-27 1405)');
  });
});

// Vault M2 2.6: an expired team sign-in keeps the note, read-only.
describe('a team note kept after the sign-in expired (M2 2.6)', () => {
  let dom: TestDom;
  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    app.state.vaultScope = 'team';
    app.state.vaultTeamExpired = true;
    app.state.vaultNote = { path: 'Plan.md', text: 'the team plan', updatedAt: '1' };
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: '1', size: 13 }];
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    app.state.vaultScope = 'personal';
    app.state.vaultTeamExpired = undefined;
    app.state.vaultNote = undefined;
  });

  it('stays open, read-only, and says how to save again', async () => {
    let switched = 0;
    app.state.setVaultScope = async () => {
      switched++;
    };
    await dom.render(<VaultRoom />);
    expect(dom.text()).toContain('the team plan');
    expect(dom.text()).toContain('Sign in again to save to your team.');
    expect(dom.container.querySelector('[aria-label="Edit"]')).toBeNull();
    expect(dom.container.querySelector('textarea')).toBeNull();
    expect(dom.container.querySelector('.vault-save-chip')).toBeNull();
    // The team vault is not available, and the note is still not thrown away.
    expect(switched).toBe(0);
    app.state.setVaultScope = async () => {};
  });
});

// Vault M2 2.5: the lease is a quiet line where the storage checks every
// write, and read-only with Take over editing only where it cannot.
describe('the lease on the Vault screen (M2 2.5)', () => {
  let dom: TestDom;
  const EDITOR = 'Write. Plain markdown, and [[wikilinks]] to connect notes.';
  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    app.leases.touches = 0;
    app.leases.takeOvers = 0;
    app.state.vaultNote = { path: 'Plan.md', text: 'loaded', updatedAt: 'v1', fresh: true };
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: 'v1', size: 6 }];
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    app.state.vaultNote = undefined;
    app.state.vaultLeaseHeldByOther = undefined;
    app.state.vaultLeaseOther = undefined;
  });

  it('a keystroke asks for the lease; opening the note does not', async () => {
    await dom.render(<VaultRoom />);
    expect(app.leases.touches).toBe(0);
    await dom.type(EDITOR, 'loaded, and more');
    expect(app.leases.touches).toBeGreaterThan(0);
  });

  it('advisory: one quiet line, and the editor stays', async () => {
    app.state.vaultLeaseOther = { mode: 'advisory', label: 'iPad' };
    await dom.render(<VaultRoom />);
    expect(dom.text()).toContain('Also open on your iPad.');
    expect(dom.container.querySelector('textarea')).not.toBeNull();
    expect(dom.buttons()).not.toContain('Take over editing');
  });

  it('enforced: read-only, the controls that write are left out, and Take over editing works', async () => {
    app.state.vaultLeaseHeldByOther = true;
    app.state.vaultLeaseOther = { mode: 'enforced', label: 'Mac' };
    await dom.render(<VaultRoom />);
    expect(dom.text()).toContain('Being edited on your Mac.');
    expect(dom.container.querySelector('textarea')).toBeNull();
    expect(dom.container.querySelector('[aria-label="Edit"]')).toBeNull();
    expect(dom.container.querySelector('[aria-label="Options"]')).toBeNull();
    await dom.click('Take over editing');
    expect(app.leases.takeOvers).toBe(1);
  });

  it('enforced in the list: New note is left out, and the line says why', async () => {
    app.state.vaultNote = undefined;
    app.state.vaultLeaseHeldByOther = true;
    app.state.vaultLeaseOther = { mode: 'enforced' };
    await dom.render(<VaultRoom />);
    expect(dom.container.querySelector('[aria-label="New note"]')).toBeNull();
    expect(dom.text()).toContain('Being edited on another of your devices.');
  });
});

// Vault M2 2.7: the screen only starts and stops the store's poll.
describe('the team poll and who last saved (M2 2.7)', () => {
  let dom: TestDom;
  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    app.polls.length = 0;
    app.state.vaultScope = 'team';
    app.state.teamVaultAvailable = () => true;
    app.state.authSession = { user: { id: 'u1' } };
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    app.state.vaultScope = 'personal';
    app.state.teamVaultAvailable = () => false;
    app.state.authSession = undefined;
    app.state.vaultNote = undefined;
  });

  it('starts with a team note open, and stops when the room goes', async () => {
    app.state.vaultNote = { path: 'Plan.md', text: 'the team plan', updatedAt: 'x' };
    await dom.render(<VaultRoom />);
    expect(app.polls).toContain('start');
    await dom.unmount();
    expect(app.polls.at(-1)).toBe('stop');
    dom = await mountDom();
  });

  it('never starts in the list', async () => {
    await dom.render(<VaultRoom />);
    expect(app.polls).not.toContain('start');
  });

  it("names a teammate's save on the meta line, and not the person's own", async () => {
    const at = new Date(Date.now() - 2 * 60_000 - 5_000).toISOString();
    app.state.vaultNote = {
      path: 'Plan.md',
      text: 'the team plan',
      updatedAt: at,
      editedBy: { id: 'u2', label: 'sam' },
    } as typeof app.state.vaultNote;
    await dom.render(<VaultRoom />);
    expect(dom.text()).toContain('Edited by sam, 2 min ago');
    await dom.unmount();
    dom = await mountDom();
    app.state.vaultNote = {
      path: 'Plan.md',
      text: 'the team plan',
      updatedAt: at,
      editedBy: { id: 'u1', label: 'me' },
    } as typeof app.state.vaultNote;
    await dom.render(<VaultRoom />);
    expect(dom.text()).not.toContain('Edited by');
  });
});

// Vault M2 2.8: the team vault exports to its own folder.
describe('the team export row (M2 2.8)', () => {
  let dom: TestDom;
  const calls: unknown[][] = [];
  beforeEach(async () => {
    calls.length = 0;
    app.toasts.length = 0;
    onDesk.on = true;
    app.state.vaultScope = 'team';
    app.state.teamVaultAvailable = () => true;
    app.state.settings = { account: { org: { name: 'Acme', serverId: 'org-1' } } };
    app.state.vaultFiles = [{ path: 'plan.md', updatedAt: '1', size: 4 }];
    app.state.vaultReadAll = async () =>
      Object.assign([{ path: 'plan.md', text: 'plan' }], { failed: [] as string[] });
    dom = await mountDom();
    (window as unknown as { oscode: unknown }).oscode = {
      platform: 'electron',
      vaultTeamExport: async (...args: unknown[]) => {
        calls.push(args);
        return {
          written: 1,
          total: 1,
          removed: 0,
          unread: 0,
          kept: [],
          dir: '/x',
          display: '~/OSCode/Vault Team/Acme',
        };
      },
    };
  });
  afterEach(async () => {
    delete (window as unknown as { oscode?: unknown }).oscode;
    await dom.unmount();
    onDesk.on = false;
    app.state.vaultScope = 'personal';
    app.state.teamVaultAvailable = () => false;
    app.state.settings = {};
    app.state.vaultFiles = [];
    app.state.vaultReadAll = async () => Object.assign([], { failed: [] });
  });

  it('exports the team notes to their own folder and says where', async () => {
    await dom.render(<VaultRoom />);
    await dom.click('Export as plain files');
    await dom.settle();
    expect(calls).toEqual([['Acme', [{ path: 'plan.md', text: 'plan' }], []]]);
    expect(app.toasts.at(-1)).toContain('~/OSCode/Vault Team/Acme');
    expect(app.toasts.at(-1)).toContain('Obsidian can open it as a vault.');
  });

  it('is not offered in the personal vault on the desktop', async () => {
    app.state.vaultScope = 'personal';
    await dom.render(<VaultRoom />);
    expect(dom.buttons()).not.toContain('Export as plain files');
  });
});

describe('Linked mentions come from the index (M3 3.2)', () => {
  let dom: TestDom;
  const notes: Record<string, string> = {
    'Plan.md': '# Plan\n\nThe plan.',
    'Idea.md': 'Build on [[Plan]] next week.',
    'Other.md': 'Nothing links from here.',
    'Code.md': '```\n[[Plan]] in a fence is not a link\n```',
  };
  const listed = Object.entries(notes).map(([path, text]) => ({
    path,
    updatedAt: 'x',
    size: text.length,
    version: `v-${path}`,
  }));
  beforeEach(async () => {
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    app.state.vaultNote = undefined;
    app.state.vaultFiles = [];
    app.state.vaultReadAll = async () => Object.assign([], { failed: [] });
    app.state.vaultReadBody = async () => undefined;
  });

  it('names the notes that link here and reads only those for excerpts, never the whole vault', async () => {
    const { vaultIndexFor, currentVaultIndex } = await import('../src/lib/vaultIndexHost.js');
    const host = vaultIndexFor(
      { providerId: 'local', resourceId: 'vault.personal' },
      {
        read: async (_r: string, path: string) => ({
          path,
          text: notes[path]!,
          updatedAt: 'x',
          version: `v-${path}`,
        }),
      },
    );
    await host.reconcile(listed);
    let readAll = 0;
    const bodies: string[] = [];
    app.state.vaultReadAll = async () => {
      readAll++;
      return Object.assign([], { failed: [] });
    };
    app.state.vaultReadBody = async (path: string) => {
      bodies.push(path);
      return notes[path];
    };
    app.state.vaultFiles = listed;
    app.state.vaultNote = { path: 'Plan.md', text: notes['Plan.md'], updatedAt: 'x' };
    await dom.render(<VaultRoom />);
    await dom.settle();
    await dom.settle();
    expect(dom.text()).toContain('Linked mentions');
    expect(dom.buttons().some((b) => b.startsWith('Idea') && b.includes('Build on'))).toBe(true);
    // A link inside a code fence is not a mention.
    expect(dom.buttons().some((b) => b.startsWith('Code'))).toBe(false);
    expect(bodies).toEqual(['Idea.md']);
    expect(readAll).toBe(0);
    // Leaving the Vault keeps the personal index warm for a chat's pack
    // (Vault M5, CTO J1); the store closes it on a move, a sign-out, or a
    // pairing change.
    await dom.unmount();
    expect(currentVaultIndex()).toBeDefined();
    const { closeVaultIndex } = await import('../src/lib/vaultIndexHost.js');
    await closeVaultIndex();
    expect(currentVaultIndex()).toBeUndefined();
    dom = await mountDom();
  });
});

// The team room offers only what the server takes from this person on this
// plan (review, 2026-09-30; 0025's OV403 and OV402): a member under
// admins-only delete gets no Delete folder, and says why; a lapsed plan's
// empty vault offers no New note and promises no first note; a lapsed plan's
// missing link is never offered as a create.
describe('the team room offers only what the server takes (Y14, Y15)', () => {
  let dom: TestDom;
  const TEAM_CAPS = {
    rename: true,
    renameNative: true,
    folders: true,
    trash: true,
    emptyTrash: false,
    attachments: false,
    taskWriteBack: true,
    linkRewrite: true,
    today: true,
    settingsWrite: false,
  };
  // Lapsed is read-only in the store (capsOf), so every write cap is off.
  const LAPSED_CAPS = {
    ...TEAM_CAPS,
    rename: false,
    renameNative: false,
    folders: false,
    trash: false,
    taskWriteBack: false,
    linkRewrite: false,
  };
  const caps = app.state.vaultCapsNow;
  // The store's state before each case, put back after it, so a case that
  // hands the room its own store answers leaves none behind.
  let saved: typeof app.state;
  beforeEach(async () => {
    saved = { ...app.state };
    globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    app.toasts.length = 0;
    app.created.length = 0;
    app.state.vaultScope = 'team';
    app.state.teamVaultAvailable = () => true;
    app.state.authSession = { user: { id: 'u1' } };
    app.state.vaultCapsNow = () => TEAM_CAPS;
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    app.state.vaultScope = 'personal';
    app.state.teamVaultAvailable = () => false;
    app.state.authSession = undefined;
    app.state.vaultNote = undefined;
    app.state.vaultFiles = [];
    app.state.vaultTeamPlan = undefined;
    app.state.vaultCapsNow = caps;
    Object.assign(app.state, saved);
  });

  async function openFolderSheet(plan: Record<string, unknown>) {
    app.state.vaultTeamPlan = plan;
    app.state.vaultFiles = [{ path: 'Work/Plan.md', updatedAt: '1', size: 4 }];
    await dom.render(<VaultRoom />);
    await dom.click('Work');
    await dom.settle();
    const options = dom.container.querySelector('[aria-label="Options for Work"]');
    expect(options).toBeTruthy();
    const { act } = await import('react');
    await act(async () => {
      (options as HTMLElement).click();
    });
    await dom.settle();
    expect(dom.buttons()).toContain('Rename folder');
  }

  it('a member under admins-only delete gets no Delete folder, and the admins-only line', async () => {
    await openFolderSheet({ entitled: true, deleteRole: 'admin', isAdmin: false });
    expect(dom.buttons().some((b) => b.startsWith('Delete folder'))).toBe(false);
    expect(dom.text()).toContain('Only admins can delete team notes here.');
    // Rename and Move are not gated by the delete rule (0025 section 5).
    expect(dom.buttons()).toContain('Move folder');
    expect(dom.buttons()).toContain('New folder');
  });

  it('an admin, or everyone under member delete, still gets Delete folder', async () => {
    await openFolderSheet({ entitled: true, deleteRole: 'admin', isAdmin: true });
    expect(dom.buttons()).toContain('Delete folder');
    expect(dom.text()).not.toContain('Only admins can delete team notes here.');
    await dom.unmount();
    dom = await mountDom();
    await openFolderSheet({ entitled: true, deleteRole: 'member', isAdmin: false });
    expect(dom.buttons()).toContain('Delete folder');
    expect(dom.text()).not.toContain('Only admins can delete team notes here.');
  });

  it('a lapsed plan with an empty vault offers no New note and promises no first note', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultCapsNow = () => LAPSED_CAPS;
    app.state.vaultTeamPlan = { entitled: false, deleteRole: 'member', isAdmin: false };
    await dom.render(<VaultRoom />);
    expect(dom.text()).toContain('Your team vault is empty.');
    expect(dom.text()).toContain(copy.VAULT_TEAM_LAPSED_LEAD);
    expect(dom.buttons()).not.toContain('New note');
    expect(dom.container.querySelector('[aria-label="New note"]')).toBeNull();
    expect(dom.text()).not.toContain('The first note you write');
  });

  it('an active plan with an empty vault still offers New note', async () => {
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    await dom.render(<VaultRoom />);
    expect(dom.buttons()).toContain('New note');
    expect(dom.text()).toContain('The first note you write is shared with your organization.');
  });

  it('a lapsed plan never offers a missing link as a create, and says why on a tap', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    const { vaultIndexFor } = await import('../src/lib/vaultIndexHost.js');
    const text = 'See [[Nowhere]] next.';
    // The team vault's own index (a fresh target, so no parked personal
    // index answers with other text); the room closes it when it goes.
    const host = vaultIndexFor(
      { providerId: 'org', resourceId: 'org-1' },
      {
        read: async (_r: string, path: string) => ({ path, text, updatedAt: 'x', version: 'v1' }),
      },
    );
    const listed = [{ path: 'Plan.md', updatedAt: 'x', size: text.length, version: 'v1' }];
    await host.reconcile(listed);
    app.state.vaultCapsNow = () => LAPSED_CAPS;
    app.state.vaultTeamPlan = { entitled: false, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = listed;
    app.state.vaultNote = { path: 'Plan.md', text, updatedAt: 'x' };
    await dom.render(<VaultRoom />);
    await dom.settle();
    await dom.settle();
    // Links from this note: the missing one reads as not created, and does
    // not take a tap.
    expect(dom.text()).toContain('Links from this note');
    expect(dom.text()).not.toContain(copy.VAULT_OUTGOING_MISSING);
    const row = dom.container.querySelector('.vault-outgoing-missing') as HTMLButtonElement;
    expect(row?.disabled).toBe(true);
    // The link in the note says why, and asks the server nothing.
    const link = dom.container.querySelector('a.wikilink.unresolved') as HTMLElement;
    expect(link).toBeTruthy();
    const { act } = await import('react');
    await act(async () => {
      link.click();
    });
    await dom.settle();
    expect(app.created).toEqual([]);
    expect(app.toasts.at(-1)).toBe(copy.VAULT_TEAM_LAPSED_NOT_CREATED);
  });

  // The quick switcher (Cmd or Ctrl+O) offers Today and New note only where
  // the header does: a lapsed plan's switcher opens notes and nothing else.
  async function openSwitcher(): Promise<HTMLElement> {
    const { act } = await import('react');
    await act(async () => {
      const e = new window.Event('keydown', { bubbles: true });
      Object.assign(e, { key: 'o', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false });
      window.dispatchEvent(e);
    });
    await dom.settle();
    const list = dom.container.querySelector('.vault-switcher-list');
    expect(list).toBeTruthy();
    return list as HTMLElement;
  }
  const rowsIn = (list: HTMLElement) =>
    [...list.querySelectorAll('[role="option"]')].map(
      (b) => b.querySelector('.vault-search-row-title')?.textContent ?? '',
    );
  async function shiftEnter() {
    const { act } = await import('react');
    const field = dom.container.querySelector(
      '[placeholder="Type a note name"]',
    ) as HTMLInputElement;
    await act(async () => {
      const e = new window.Event('keydown', { bubbles: true });
      Object.assign(e, { key: 'Enter', shiftKey: true, isComposing: false });
      field.dispatchEvent(e);
    });
    await dom.settle();
  }

  it("a lapsed plan's switcher offers no Today's note and no New note", async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultCapsNow = () => LAPSED_CAPS;
    app.state.vaultTeamPlan = { entitled: false, deleteRole: 'member', isAdmin: false };
    await dom.render(<VaultRoom />);
    // The header leaves Today out too.
    expect(dom.container.querySelector('.vault-today-btn')).toBeNull();
    const list = await openSwitcher();
    expect(rowsIn(list)).not.toContain(copy.VAULT_SWITCHER_TODAY);
    await dom.type(copy.VAULT_SWITCHER_PLACEHOLDER, 'Ideas');
    expect(rowsIn(list).some((r) => r.startsWith('New note'))).toBe(false);
    expect(dom.text()).not.toContain(copy.vaultSwitcherNew('Ideas'));
    // Shift+Enter, the New note chord, makes nothing either.
    await shiftEnter();
    expect(app.created).toEqual([]);
  });

  it("an active plan's switcher still offers Today's note and New note", async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    await dom.render(<VaultRoom />);
    expect(dom.container.querySelector('.vault-today-btn')).toBeTruthy();
    const list = await openSwitcher();
    expect(rowsIn(list)[0]).toBe(copy.VAULT_SWITCHER_TODAY);
    await dom.type(copy.VAULT_SWITCHER_PLACEHOLDER, 'Ideas');
    expect(rowsIn(list)).toContain(copy.vaultSwitcherNew('Ideas'));
    await shiftEnter();
    await new Promise((r) => setTimeout(r, 600));
    await dom.settle();
    expect(app.created).toEqual(['Ideas.md']);
  });

  it("an Undo the plan refuses says the plan's line, not a generic failure", async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: 'x', size: 4 }];
    app.state.vaultNote = { path: 'Plan.md', text: 'plan', updatedAt: 'x' };
    app.state.vaultDeleteNote = async () => ({
      ok: true,
      trashed: true,
      undo: { kind: 'trash', id: 'n:Plan.md', path: 'Plan.md', folder: false, notes: 1 },
      notes: 1,
      attachments: 0,
    });
    const undos: unknown[] = [];
    app.state.vaultUndoDelete = async (undo: unknown) => {
      undos.push(undo);
      return { ok: false, reason: 'unsupported', line: copy.VAULT_TEAM_LAPSED_NOT_RESTORED };
    };
    await dom.render(<VaultRoom />);
    await dom.click('⋯');
    await dom.settle();
    await dom.click(copy.VAULT_DELETE_ROW);
    await dom.settle();
    await dom.click(copy.VAULT_UNDO);
    await dom.settle();
    expect(undos).toHaveLength(1);
    expect(app.toasts.at(-1)).toBe(copy.VAULT_TEAM_LAPSED_NOT_RESTORED);
  });

  it("a Restore in Trash the plan refuses says the plan's line", async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: 'x', size: 4 }];
    app.state.vaultTrash = [
      { id: 'n:Old.md', path: 'Old.md', kind: 'note', size: 0, trashedAt: '2026-09-30T00:00:00Z' },
    ];
    app.state.vaultRestoreTrash = async () => ({
      ok: false,
      reason: 'unsupported',
      line: copy.VAULT_TEAM_LAPSED_NOT_RESTORED,
    });
    await dom.render(<VaultRoom />);
    const { act } = await import('react');
    const row = dom.container.querySelector('.vault-trash-entry') as HTMLElement;
    expect(row).toBeTruthy();
    await act(async () => {
      row.click();
    });
    await dom.settle();
    await dom.click(copy.VAULT_TRASH_RESTORE);
    await dom.settle();
    expect(app.toasts.at(-1)).toBe(copy.VAULT_TEAM_LAPSED_NOT_RESTORED);
  });

  // 0023's free space (the 2026-09-30 review, finding 1): the store says a
  // refusal for good as one whole line, and a folder that came back in part
  // with its counts; the room shows exactly that, never "Try again".
  it('an Undo that came back only in part says how many, and which stayed in Trash', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: 'x', size: 4 }];
    app.state.vaultNote = { path: 'Plan.md', text: 'plan', updatedAt: 'x' };
    app.state.vaultDeleteNote = async () => ({
      ok: true,
      trashed: true,
      undo: { kind: 'trash', id: 'n:Plan.md', path: 'Plan.md', folder: false, notes: 1 },
      notes: 1,
      attachments: 0,
    });
    app.state.vaultUndoDelete = async () => ({
      ok: true,
      path: 'Work/a.md',
      renamed: false,
      partial: { restored: 1, left: ['Work/big.md'], line: copy.VAULT_TEAM_FULL },
    });
    await dom.render(<VaultRoom />);
    await dom.click('⋯');
    await dom.settle();
    await dom.click(copy.VAULT_DELETE_ROW);
    await dom.settle();
    await dom.click(copy.VAULT_UNDO);
    await dom.settle();
    expect(app.toasts.at(-1)).toBe(
      'Restored 1 of 2 notes from "Plan". Still in Trash: "big". ' + copy.VAULT_TEAM_FULL,
    );
  });

  it('a Restore in Trash past the free space says Not restored and why', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = [{ path: 'Plan.md', updatedAt: 'x', size: 4 }];
    app.state.vaultTrash = [
      { id: 'n:Old.md', path: 'Old.md', kind: 'note', size: 0, trashedAt: '2026-09-30T00:00:00Z' },
    ];
    const line = `Not restored. ${copy.VAULT_TEAM_FULL}`;
    app.state.vaultRestoreTrash = async () => ({ ok: false, reason: 'storage', line, whole: true });
    await dom.render(<VaultRoom />);
    const { act } = await import('react');
    const row = dom.container.querySelector('.vault-trash-entry') as HTMLElement;
    await act(async () => {
      row.click();
    });
    await dom.settle();
    await dom.click(copy.VAULT_TRASH_RESTORE);
    await dom.settle();
    expect(app.toasts.at(-1)).toBe(line);
    expect(app.toasts.some((t) => /Try again/.test(t))).toBe(false);
  });

  it('a rename past the free space says Not renamed and why, never Try again', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = [{ path: 'Ideas.md', updatedAt: 'x', size: 4 }];
    app.state.vaultNote = { path: 'Ideas.md', text: 'ideas', updatedAt: 'x' };
    const preview = {
      kind: 'note',
      from: 'Ideas.md',
      to: 'Plans.md',
      moves: new Map([['Ideas.md', 'Plans.md']]),
      notes: 1,
      attachments: 0,
      links: 0,
      linkNotes: 0,
      plan: { edits: [], links: 0, notes: 0, left: [] },
      sources: [],
    };
    const line = `Not renamed. ${copy.VAULT_TEAM_FULL}`;
    app.state.vaultPrepareMove = async () => preview;
    app.state.vaultApplyMove = async () => ({ ok: false, reason: 'storage', line, whole: true });
    await dom.render(<VaultRoom />);
    await dom.click('⋯');
    await dom.settle();
    await dom.click(copy.VAULT_RENAME_ROW);
    await new Promise((r) => setTimeout(r, 600));
    await dom.settle();
    await dom.type('Ideas', 'Plans');
    await dom.click('Rename');
    await dom.settle();
    await dom.settle();
    expect(app.toasts.at(-1)).toBe(line);
    expect(app.toasts).not.toContain(copy.vaultRenameFailed('Ideas'));
  });

  it('a rename sheet up when the plan lapses says why, and plans nothing', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = [{ path: 'Ideas.md', updatedAt: 'x', size: 4 }];
    app.state.vaultNote = { path: 'Ideas.md', text: 'ideas', updatedAt: 'x' };
    const prepared: string[] = [];
    app.state.vaultPrepareMove = async (_kind: string, _from: string, to: string) => {
      prepared.push(to);
      return undefined;
    };
    await dom.render(<VaultRoom />);
    await dom.click('⋯');
    await dom.settle();
    await dom.click(copy.VAULT_RENAME_ROW);
    await new Promise((r) => setTimeout(r, 600));
    await dom.settle();
    app.state.vaultCapsNow = () => LAPSED_CAPS;
    app.state.vaultTeamPlan = { entitled: false, deleteRole: 'member', isAdmin: false };
    await dom.render(<VaultRoom />);
    await dom.type('Ideas', 'Plans');
    await dom.click('Rename');
    await dom.settle();
    expect(dom.text()).toContain(copy.VAULT_TEAM_LAPSED_NOT_SAVED);
    expect(dom.text()).not.toContain(copy.vaultRenameFailed('Ideas'));
    expect(prepared).toEqual([]);
  });

  it('the links-left card offers Update the rest only while links can be rewritten', async () => {
    const copy = await import('../src/lib/vaultCopy.js');
    app.state.vaultTeamPlan = { entitled: true, deleteRole: 'member', isAdmin: false };
    app.state.vaultFiles = [
      { path: 'Ideas.md', updatedAt: 'x', size: 4 },
      { path: 'C.md', updatedAt: 'x', size: 4 },
    ];
    app.state.vaultNote = { path: 'Ideas.md', text: 'ideas', updatedAt: 'x' };
    const preview = {
      kind: 'note',
      from: 'Ideas.md',
      to: 'Plans.md',
      moves: new Map([['Ideas.md', 'Plans.md']]),
      notes: 1,
      attachments: 0,
      links: 0,
      linkNotes: 0,
      plan: { edits: [], links: 0, notes: 0, left: [] },
      sources: [],
    };
    app.state.vaultPrepareMove = async () => preview;
    app.state.vaultApplyMove = async () => {
      app.state.vaultNote = { path: 'Plans.md', text: 'ideas', updatedAt: 'x' };
      app.listeners.forEach((l) => l());
      return {
        ok: true,
        preview,
        moved: [{ path: 'Plans.md', updatedAt: 'x', size: 5 }],
        rewrite: {
          updated: 0,
          total: 1,
          notesUpdated: 0,
          skipped: [],
          notUpdated: ['C.md'],
          stopped: true,
        },
      };
    };
    await dom.render(<VaultRoom />);
    await dom.click('⋯');
    await dom.settle();
    await dom.click(copy.VAULT_RENAME_ROW);
    // The rename sheet rises once Options has left (the door clock).
    await new Promise((r) => setTimeout(r, 600));
    await dom.settle();
    await dom.type('Ideas', 'Plans');
    await dom.click('Rename');
    await dom.settle();
    await dom.settle();
    const button = copy.vaultLinksLeftCard('Ideas').button;
    expect(dom.text()).toContain(copy.vaultLinksLeftCard('Ideas').title);
    expect(dom.buttons()).toContain(button);
    // The plan lapses while the card is up: the card only lists the notes.
    app.state.vaultCapsNow = () => LAPSED_CAPS;
    app.state.vaultTeamPlan = { entitled: false, deleteRole: 'member', isAdmin: false };
    // The mock store hands the same state object back, so render again (the
    // room keeps its own state: the card is still up).
    await dom.render(<VaultRoom />);
    expect(dom.text()).toContain(copy.vaultLinksLeftCard('Ideas').title);
    expect(dom.buttons()).toContain('C');
    expect(dom.buttons()).not.toContain(button);
  });
});
