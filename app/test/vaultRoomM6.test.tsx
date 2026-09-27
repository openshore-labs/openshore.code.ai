// The Vault room with M6 mounted end to end (Vault M6 6.1 to 6.9): the real
// screen and the real store, over the real Local provider on an in-memory
// device store, so every M6 cap is lit (rename, a real Trash with Restore
// and Empty, Today). A smoke over what each new mount does:
// - the search field filters the tree to the note typed;
// - the Today button opens today's note, creating it the first time;
// - Options offers Rename or move, deletes in one tap, and the Undo toast
//   brings the note back;
// - the Trash row shows once a note is in Trash, and the Trash page restores;
// - on a storage with no Trash, Options says why and a delete asks twice,
//   worded "for good".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

// The device store, in memory: what the Local provider keeps its notes in.
const mem = vi.hoisted(() => new Map<string, string>());
vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  openExternal: () => {},
  openInAppBrowser: () => {},
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
  storeKeys: async (prefix: string) => [...mem.keys()].filter((k) => k.startsWith(prefix)),
  sealExistingKeys: async () => {},
  sealBlob: async (t: string) => t,
  openBlob: async (t: string) => t,
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
}));
vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));
vi.mock('../src/lib/vaultFolder.js', () => ({
  canPickVaultFolder: () => false,
  vaultFolderInfo: async () => undefined,
  chooseVaultFolder: async () => undefined,
  refineVaultFolder: async () => undefined,
  bringPreviousVaultFolder: async () => undefined,
  revealVaultFolder: async () => true,
  openVaultInObsidian: async () => {},
  openPrivacySettings: async () => {},
}));
// The Local provider, as is, or with its Trash taken away (a storage that
// has none, where a delete is for good).
const storage = vi.hoisted(() => ({ trash: true }));
vi.mock('../src/lib/gitos/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/gitos/index.js')>();
  const { localProvider } = await vi.importActual<typeof import('../src/lib/gitos/local.js')>(
    '../src/lib/gitos/local.js',
  );
  const bare = {
    ...localProvider,
    trash: undefined,
    listTrash: undefined,
    restore: undefined,
    emptyTrash: undefined,
  };
  return {
    ...actual,
    providerFor: (id: string) =>
      id === 'local' ? (storage.trash ? localProvider : bare) : actual.providerFor(id as never),
    probeReady: async (id: string) => id === 'local',
    isGdriveConnected: async () => false,
  };
});
// The top bar reads the rest of the store; its way back is what is used.
vi.mock('../src/components/BackBar.js', () => ({
  BackBar: ({ title, back }: { title: string; back?: { to: string; onBack?: () => void } }) => (
    <header>
      {back ? (
        <button type="button" onClick={back.onBack}>
          {back.to}
        </button>
      ) : null}
      {title}
    </header>
  ),
}));

let dom: TestDom;
let useApp: typeof import('../src/state/store.js').useApp;
let VaultRoom: typeof import('../src/screens/VaultScreen.js').VaultRoom;
let copy: typeof import('../src/lib/vaultCopy.js');

beforeEach(async () => {
  dom = await mountDom();
  // A frame, the way a browser gives one (the editor's caret waits a frame).
  const frame = {
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  };
  Object.assign(globalThis, frame);
  Object.assign(window, frame);
  ({ useApp } = await import('../src/state/store.js'));
  ({ VaultRoom } = await import('../src/screens/VaultScreen.js'));
  copy = await import('../src/lib/vaultCopy.js');
  mem.clear();
  storage.trash = true;
  useApp.setState({
    settings: {
      ...useApp.getState().settings,
      onboarded: true,
      deviceId: 'this-device',
      gitosResources: [
        {
          id: 'vault.personal',
          name: 'Vault',
          kind: 'vault',
          providerId: 'local',
          createdAt: 'x',
        },
      ],
    },
    vaultScope: 'personal',
    vaultFiles: [],
    vaultNote: undefined,
    vaultError: undefined,
    vaultHeld: [],
    vaultTrash: undefined,
    toast: undefined,
  } as never);
});
afterEach(async () => {
  await dom.unmount();
});

async function seed(notes: Record<string, string>) {
  const { localProvider } = await import('../src/lib/gitos/local.js');
  for (const [path, text] of Object.entries(notes)) {
    await localProvider.write('vault.personal', path, text);
  }
}

async function mount() {
  await dom.render(<VaultRoom />);
  await dom.settle();
  await dom.settle();
}

const q = (sel: string) => dom.container.querySelector(sel) as HTMLElement | null;
async function tap(el: Element | null) {
  if (!el) throw new Error('nothing to tap');
  const { act } = await import('react');
  await act(async () => {
    (el as HTMLElement).click();
  });
  await dom.settle();
}
const byLabel = (label: string) => q(`[aria-label="${label}"]`);
const liveText = () => {
  // The room's own text, never a leaving view's fading snapshot.
  const clone = dom.container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.view-ghost').forEach((g) => g.remove());
  return clone.textContent ?? '';
};

describe('the Vault room with M6 mounted', () => {
  it('filters the tree to the note typed in the search field', async () => {
    await seed({ 'Ideas.md': 'a thought', 'Groceries.md': 'milk' });
    await mount();
    expect(liveText()).toContain('Groceries');
    await dom.type(copy.VAULT_SEARCH_PLACEHOLDER, 'Ideas');
    await dom.settle();
    const results = q('.vault-search-results');
    expect(results?.textContent).toContain('Ideas');
    expect(results?.textContent).not.toContain('Groceries');
  });

  it("opens today's note from the Today button, creating it the first time", async () => {
    await mount();
    const today = q('.vault-today-btn');
    expect(today).toBeTruthy();
    await tap(today);
    await dom.settle();
    const note = useApp.getState().vaultNote;
    expect(note).toBeTruthy();
    const { localProvider } = await import('../src/lib/gitos/local.js');
    const listed = await localProvider.list('vault.personal');
    expect(listed.map((f) => f.path)).toContain(note!.path);
  });

  it('Options offers Rename or move and deletes in one tap; Undo brings the note back', async () => {
    await seed({ 'Ideas.md': 'a thought' });
    await mount();
    await dom.click('Ideas');
    await dom.settle();
    expect(useApp.getState().vaultNote?.path).toBe('Ideas.md');
    await tap(byLabel('Options'));
    expect(dom.buttons()).toContain(copy.VAULT_RENAME_ROW);
    await dom.click(copy.VAULT_DELETE_ROW);
    await dom.settle();
    await dom.settle();
    const { localProvider } = await import('../src/lib/gitos/local.js');
    expect((await localProvider.list('vault.personal')).map((f) => f.path)).toEqual([]);
    expect(dom.buttons()).toContain(copy.VAULT_UNDO);
    await dom.click(copy.VAULT_UNDO);
    await dom.settle();
    await dom.settle();
    expect((await localProvider.list('vault.personal')).map((f) => f.path)).toEqual(['Ideas.md']);
  });

  it('shows the Trash row after a delete, and the Trash page restores', async () => {
    await seed({ 'Ideas.md': 'a thought', 'Groceries.md': 'milk' });
    await mount();
    await dom.click('Ideas');
    await dom.settle();
    await tap(byLabel('Options'));
    await dom.click(copy.VAULT_DELETE_ROW);
    await dom.settle();
    await dom.settle();
    expect(useApp.getState().vaultNote).toBeUndefined();
    const row = [...dom.container.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith(copy.VAULT_TRASH),
    );
    expect(row, 'the Trash row').toBeTruthy();
    await tap(row!);
    await dom.settle();
    expect(liveText()).toContain('Ideas');
    await dom.click(copy.VAULT_TRASH_RESTORE);
    await dom.settle();
    await dom.settle();
    const { localProvider } = await import('../src/lib/gitos/local.js');
    expect((await localProvider.list('vault.personal')).map((f) => f.path).sort()).toEqual([
      'Groceries.md',
      'Ideas.md',
    ]);
  });

  it('on a storage with no Trash, says why and asks twice, for good', async () => {
    storage.trash = false;
    await seed({ 'Ideas.md': 'a thought' });
    await mount();
    await dom.click('Ideas');
    await dom.settle();
    await tap(byLabel('Options'));
    expect(liveText()).toContain(copy.vaultCapLine('local', 'trash'));
    await dom.click(copy.VAULT_DELETE_ROW);
    await dom.settle();
    const { localProvider } = await import('../src/lib/gitos/local.js');
    // The first tap only arms it.
    expect((await localProvider.list('vault.personal')).map((f) => f.path)).toEqual(['Ideas.md']);
    const armed = copy.vaultDeleteForGood('Ideas');
    expect(dom.buttons()).toContain(armed);
    await dom.click(armed);
    await dom.settle();
    await dom.settle();
    expect((await localProvider.list('vault.personal')).map((f) => f.path)).toEqual([]);
  });
});
