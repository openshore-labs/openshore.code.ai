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
// scan walks. A key in `full` refuses writes the way a browser does when the
// origin's quota is spent.
const local = new Map<string, string>();
const full = new Set<string>();
const fakeLocalStorage = {
  get length() {
    return local.size;
  },
  key: (i: number) => [...local.keys()][i] ?? null,
  getItem: (k: string) => local.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (full.has(k)) {
      throw Object.assign(new Error('The quota has been exceeded.'), {
        name: 'QuotaExceededError',
      });
    }
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
const { normalizeNotePath, resolveWikilink } = await import('../src/lib/vault.js');

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

  it('a failed write-back still lists the orphan, and a later list keeps it', async () => {
    // The usual orphan: a body landed and its index write then threw because
    // the store was full. Listing must not throw on every call after that, or
    // the vault shows nothing and cannot be moved off to free the space.
    const r = 'vault.quota';
    const index = `oscode.gitos.index.${r}`;
    await localProvider.write(r, 'a.md', 'a');
    full.add(index);
    try {
      await expect(localProvider.write(r, 'b.md', 'b')).rejects.toThrow(/quota/);
      expect(await listed(r)).toEqual(['a.md', 'b.md']);
      expect(await localProvider.stat(r, 'a.md')).toMatchObject({ path: 'a.md' });
      expect(await localProvider.stat(r, 'b.md')).toMatchObject({ path: 'b.md', size: 1 });
    } finally {
      full.delete(index);
    }
    // Space is back: the next list writes the rebuilt index.
    expect(await listed(r)).toEqual(['a.md', 'b.md']);
    const stored = await platform.storeGetJson<{ files: Array<{ path: string }> }>(index);
    expect(stored?.files.map((f) => f.path)).toEqual(['a.md', 'b.md']);
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

// What vaultCreate does with a typed name: normalize it, open it when the
// list or stat knows it, and write an empty body only when neither does.
async function createTyped(resourceId: string, typed: string): Promise<string> {
  const path = normalizeNotePath(typed)!;
  const files = await localProvider.list(resourceId);
  if (files.some((f) => f.path === path)) return path;
  if (await localProvider.stat(resourceId, path)) return path;
  await localProvider.write(resourceId, path, '');
  return path;
}

describe('a dot-typed note name never truncates the note (0.2, 0.6)', () => {
  it('create, type, create again: the body stays and the note lists', async () => {
    const r = 'vault.dotname';
    const path = await createTyped(r, '.NET migration');
    await localProvider.write(r, path, 'three pages of migration notes');
    expect(await listed(r)).toContain(path);
    expect(await createTyped(r, '.NET migration')).toBe(path);
    expect((await localProvider.read(r, path))?.text).toBe('three pages of migration notes');
  });

  it('a link tap on [[.NET migration]] opens that note, never an empty one', async () => {
    const r = 'vault.dotlink';
    const path = await createTyped(r, 'Ideas/.env setup');
    await localProvider.write(r, path, 'PORT and the API key');
    const resolved = resolveWikilink('.env setup', await listed(r));
    expect(resolved).toBe(path);
    // A tap on a resolved link opens it; even the create path finds it.
    expect(await createTyped(r, 'Ideas/.env setup')).toBe(path);
    expect((await localProvider.read(r, path))?.text).toBe('PORT and the API key');
  });

  it('stat still sees a hidden legacy note, so nothing writes over it', async () => {
    // Before 0.6 the app stored a typed ".NET migration" as is. It no longer
    // lists, but a create or a draft replay that asks stat must still learn
    // that bytes live there.
    const r = 'vault.legacydot';
    await localProvider.write(r, '.NET migration.md', 'old body');
    expect(await listed(r)).toEqual([]);
    expect(await localProvider.stat(r, '.NET migration.md')).toMatchObject({
      path: '.NET migration.md',
      size: 'old body'.length,
    });
    // An orphaned hidden body is seen too, though it never lists.
    await platform.storeSetJson(`oscode.gitos.file.${r}..env notes.md`, {
      text: 'orphan',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(await localProvider.stat(r, '.env notes.md')).toMatchObject({ size: 6 });
    expect(await listed(r)).toEqual([]);
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
