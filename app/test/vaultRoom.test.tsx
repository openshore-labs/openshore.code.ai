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
  };
  return { state, listeners, views, toasts, created, opened, drive };
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
vi.mock('../src/lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform.js')>()),
  openExternal: (url: string) => {
    external.push(url);
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
