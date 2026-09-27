// The Local vault provider (data-8, truth-13, 0.6), run against the REAL
// sealed store with the Electron bridge and the browser storage mocked around
// it. The sealed store awaits between reading the index and writing it back,
// so two unchained writes each read the same index and the later one drops
// the other's entry: the note's bytes stay, but it never lists again. These
// cases pin the chain that orders every index mutation per resource, the
// key-prefix scan that lists an orphaned body again, and the note filter.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const secure = new Map<string, string>();
const fakeBridge = {
  platform: 'electron' as const,
  secureHas: async (key: string) => secure.has(key),
  secureGet: async (key: string) => secure.get(key) ?? null,
  secureSet: async (key: string, value: string) => {
    secure.set(key, value);
    return true;
  },
  secureDelete: async (key: string) => {
    secure.delete(key);
  },
};

vi.mock('../src/lib/electronBridge.js', () => ({
  bridge: () => fakeBridge,
  requireBridge: () => fakeBridge,
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async () => ({ value: null }),
    set: async () => {},
    remove: async () => {},
    keys: async () => ({ keys: [] }),
  },
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: async () => {} } }));
vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    secureGet: async () => ({ value: null }),
    secureSet: async () => {},
    secureDelete: async () => {},
  },
}));

// Browser storage with the enumeration surface (length and key) the recovery
// scan walks.
const local = new Map<string, string>();
const fakeLocalStorage = {
  get length() {
    return local.size;
  },
  key: (i: number) => [...local.keys()][i] ?? null,
  getItem: (k: string) => local.get(k) ?? null,
  setItem: (k: string, v: string) => {
    local.set(k, v);
  },
  removeItem: (k: string) => {
    local.delete(k);
  },
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { oscode: fakeBridge },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeLocalStorage,
    configurable: true,
    writable: true,
  });
});

const { localProvider } = await import('../src/lib/gitos/local.js');
const platform = await import('../src/lib/platform.js');

const listed = async (resourceId: string) =>
  (await localProvider.list(resourceId)).map((f) => f.path);

describe('Local provider index writes are serialized (0.8)', () => {
  it('20 concurrent creates all list', async () => {
    const r = 'vault.concurrent';
    const paths = Array.from({ length: 20 }, (_, i) => `Note ${String(i).padStart(2, '0')}.md`);
    await Promise.all(paths.map((p) => localProvider.write(r, p, `body of ${p}`)));
    expect(await listed(r)).toEqual(paths);
    for (const p of paths) expect((await localProvider.read(r, p))?.text).toBe(`body of ${p}`);
  });

  it('a remove racing two creates drops only the removed note', async () => {
    const r = 'vault.mixed';
    await localProvider.write(r, 'a.md', 'a');
    await localProvider.write(r, 'b.md', 'b');
    await Promise.all([
      localProvider.remove(r, 'a.md'),
      localProvider.write(r, 'c.md', 'c'),
      localProvider.write(r, 'd.md', 'd'),
    ]);
    expect(await listed(r)).toEqual(['b.md', 'c.md', 'd.md']);
    expect(await localProvider.read(r, 'a.md')).toBeUndefined();
  });
});

describe('Local provider rebuilds orphaned notes (0.8)', () => {
  it('an orphan is rebuilt into the index, and stat sees it', async () => {
    const r = 'vault.orphans';
    await localProvider.write(r, 'Kept.md', 'kept');
    // A body with no index entry: a write interrupted between its two steps,
    // or one an earlier unchained race left behind.
    await platform.storeSetJson(`oscode.gitos.file.${r}.ideas/Lost.md`, {
      text: 'still here',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(await listed(r)).toEqual(['ideas/Lost.md', 'Kept.md']);
    expect(await localProvider.stat(r, 'ideas/Lost.md')).toEqual({
      path: 'ideas/Lost.md',
      updatedAt: '2026-09-01T00:00:00.000Z',
      size: 'still here'.length,
    });
    // The rebuild is written back, so the entry holds without another scan.
    const index = await platform.storeGetJson<{ files: Array<{ path: string }> }>(
      `oscode.gitos.index.${r}`,
    );
    expect(index?.files.map((f) => f.path)).toContain('ideas/Lost.md');
  });

  it('rebuilds only notes under this resource, never a copy aside or a non-note', async () => {
    const r = 'vault.scoped';
    const body = { text: 'x', updatedAt: '2026-09-01T00:00:00.000Z' };
    await platform.storeSetJson(`oscode.gitos.file.${r}.Real.md`, body);
    await platform.storeSetJson(`oscode.gitos.file.${r}.pic.png`, body);
    await platform.storeSetJson(`oscode.gitos.file.${r}..obsidian/app.json`, body);
    await platform.storeSetJson(`oscode.gitos.file.${r}.Real.md.recovery.1700000000000`, body);
    await platform.storeSetJson(`oscode.gitos.file.vault.elsewhere.Other.md`, body);
    expect(await listed(r)).toEqual(['Real.md']);
  });
});

describe('Local provider lists only notes (0.6)', () => {
  it('a stored non-note never lists', async () => {
    const r = 'vault.filter';
    await localProvider.write(r, 'Note.md', 'n');
    await localProvider.write(r, 'diagram.png', 'not a note');
    await localProvider.write(r, '.obsidian/app.json', '{}');
    expect(await listed(r)).toEqual(['Note.md']);
  });
});

describe('storeKeys', () => {
  it('names only the keys under a prefix, never their values', async () => {
    await platform.storeSetJson('oscode.gitos.file.vault.keys.a.md', { text: 'a' });
    await platform.storeSetJson('oscode.gitos.file.vault.keysX.b.md', { text: 'b' });
    expect(await platform.storeKeys('oscode.gitos.file.vault.keys.')).toEqual([
      'oscode.gitos.file.vault.keys.a.md',
    ]);
  });
});
