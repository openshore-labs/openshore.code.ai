// The Local vault provider (data-8, truth-13, 0.6), run against the REAL
// sealed store with the Electron bridge and the browser storage mocked around
// it. The sealed store awaits between reading the index and writing it back,
// so two unchained writes each read the same index and the later one drops
// the other's entry: the note's bytes stay, but it never lists again. These
// cases pin the chain that orders every index mutation per resource, the
// key-prefix scan that lists an orphaned body again, and the note filter.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
      version: '2026-09-01T00:00:00.000Z',
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
    // A dot path is refused on write (Vault M7, tech review L8), so a legacy body is
    // planted straight into the store, as an older build would have left it.
    await expect(localProvider.write(r, '.obsidian/app.json', '{}')).rejects.toThrow(
      /not a note name/,
    );
    await platform.storeSetJson(`oscode.gitos.file.${r}..obsidian/app.json`, {
      text: '{}',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
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
    // The link names the note by its path, as typed. A bare [[.env setup]]
    // from the root no longer finds "Ideas/env setup.md": the core's cleaned
    // name fallback is a whole path, not a basename anywhere (Vault M3 H4,
    // step 5), so it lands only on the note that same name would create.
    const resolved = resolveWikilink('Ideas/.env setup', await listed(r));
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
    await platform.storeSetJson(`oscode.gitos.file.${r}..NET migration.md`, {
      text: 'old body',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
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

// Compare-and-swap on Local (Vault M2 2.1, tech review G1). The version is a random
// token made fresh on every write and stored in the body; a body written
// before M2 has none, and its version is its updatedAt, which is what
// versionOf answered in M1, so a draft stashed then still replays.
describe('Local provider compare-and-swap (M2 2.1)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const versionOfWrite = (r: Awaited<ReturnType<typeof localProvider.write>>) =>
    r.ok ? r.file.version : undefined;

  it('declares compareAndSwap', () => {
    expect(localProvider.compareAndSwap).toBe(true);
  });

  it('two writes in the same millisecond get different versions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    const r = 'vault.samems';
    const a = await localProvider.write(r, 'n.md', 'one');
    const b = await localProvider.write(r, 'n.md', 'two');
    expect(a.ok && b.ok && a.file.updatedAt === b.file.updatedAt).toBe(true);
    expect(versionOfWrite(a)).toBeTruthy();
    expect(versionOfWrite(a)).not.toBe(versionOfWrite(b));
    // The first version is stale now: a draft typed against it conflicts.
    const stale = await localProvider.write(r, 'n.md', 'mine', { ifMatch: versionOfWrite(a)! });
    expect(stale).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'two' } });
    expect((await localProvider.read(r, 'n.md'))?.text).toBe('two');
  });

  it('a delete and re-create never matches the old version', async () => {
    const r = 'vault.aba';
    const first = await localProvider.write(r, 'n.md', 'first', { ifAbsent: true });
    const old = versionOfWrite(first)!;
    expect(await localProvider.remove(r, 'n.md', { ifMatch: old })).toEqual({ ok: true });
    const again = await localProvider.write(r, 'n.md', 'second', { ifAbsent: true });
    expect(again.ok).toBe(true);
    expect(versionOfWrite(again)).not.toBe(old);
    const stale = await localProvider.write(r, 'n.md', 'typed against first', { ifMatch: old });
    expect(stale).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'second' } });
    expect(await localProvider.remove(r, 'n.md', { ifMatch: old })).toMatchObject({
      ok: false,
      conflict: 'changed',
    });
    expect((await localProvider.read(r, 'n.md'))?.text).toBe('second');
  });

  it('a pre-M2 body (no v) accepts ifMatch: updatedAt, and the write mints a token', async () => {
    const r = 'vault.prem2';
    const updatedAt = '2026-09-01T00:00:00.000Z';
    await platform.storeSetJson(`oscode.gitos.file.${r}.Old.md`, { text: 'old', updatedAt });
    await platform.storeSetJson(`oscode.gitos.index.${r}`, {
      files: [{ path: 'Old.md', updatedAt, size: 3 }],
    });
    expect((await localProvider.read(r, 'Old.md'))?.version).toBe(updatedAt);
    expect((await localProvider.stat(r, 'Old.md'))?.version).toBe(updatedAt);
    const w = await localProvider.write(r, 'Old.md', 'new', { ifMatch: updatedAt });
    expect(w.ok).toBe(true);
    expect(versionOfWrite(w)).not.toBe(updatedAt);
    expect((await localProvider.read(r, 'Old.md'))?.text).toBe('new');
    // The old base is spent once the note is written again.
    expect(await localProvider.write(r, 'Old.md', 'x', { ifMatch: updatedAt })).toMatchObject({
      ok: false,
      conflict: 'changed',
    });
  });

  it('20 concurrent guarded creates to 20 paths all list', async () => {
    const r = 'vault.guardedcreates';
    const paths = Array.from({ length: 20 }, (_, i) => `Note ${String(i).padStart(2, '0')}.md`);
    const results = await Promise.all(
      paths.map((p) => localProvider.write(r, p, `body of ${p}`, { ifAbsent: true })),
    );
    expect(results.every((x) => x.ok)).toBe(true);
    expect(await listed(r)).toEqual(paths);
    const list = await localProvider.list(r);
    for (const [i, p] of paths.entries()) {
      expect(list.find((f) => f.path === p)?.version).toBe(versionOfWrite(results[i]!));
    }
  });

  it('two concurrent ifMatch writes to one path: exactly one lands', async () => {
    const r = 'vault.race';
    const base = versionOfWrite(await localProvider.write(r, 'n.md', 'base', { ifAbsent: true }))!;
    const [a, b] = await Promise.all([
      localProvider.write(r, 'n.md', 'from a', { ifMatch: base }),
      localProvider.write(r, 'n.md', 'from b', { ifMatch: base }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const winner = a.ok ? a : b;
    const loser = a.ok ? b : a;
    expect(loser).toMatchObject({ ok: false, conflict: 'changed' });
    expect(!loser.ok && loser.theirs?.version).toBe(versionOfWrite(winner));
    expect((await localProvider.read(r, 'n.md'))?.text).toBe(winner.ok ? winner.file.text : '');
  });

  it('two concurrent ifAbsent creates to one path: exactly one lands', async () => {
    const r = 'vault.racecreate';
    const [a, b] = await Promise.all([
      localProvider.write(r, 'n.md', 'from a', { ifAbsent: true }),
      localProvider.write(r, 'n.md', 'from b', { ifAbsent: true }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(a.ok ? b : a).toMatchObject({ ok: false, conflict: 'exists' });
  });

  it('a guarded remove racing a write to the same note never removes the new text', async () => {
    const r = 'vault.removerace';
    const base = versionOfWrite(await localProvider.write(r, 'n.md', 'base', { ifAbsent: true }))!;
    const [w, rm] = await Promise.all([
      localProvider.write(r, 'n.md', 'newer', { ifMatch: base }),
      localProvider.remove(r, 'n.md', { ifMatch: base }),
    ]);
    // The chain runs the write first, so the remove sees a moved version.
    expect(w.ok).toBe(true);
    expect(rm).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'newer' } });
    expect(await listed(r)).toEqual(['n.md']);
  });

  it('ifMatch on a missing note is missing and writes nothing', async () => {
    const r = 'vault.missing';
    expect(await localProvider.write(r, 'n.md', 'mine', { ifMatch: 'anything' })).toEqual({
      ok: false,
      conflict: 'missing',
    });
    expect(await localProvider.read(r, 'n.md')).toBeUndefined();
    expect(await listed(r)).toEqual([]);
  });

  it('sizes are bytes, not UTF-16 units, in the write, list, and stat', async () => {
    const r = 'vault.bytes';
    const text = 'caf\u00e9 \u{1F30A}';
    const bytes = new TextEncoder().encode(text).length;
    expect(bytes).not.toBe(text.length);
    await localProvider.write(r, 'n.md', text);
    expect((await localProvider.list(r))[0]?.size).toBe(bytes);
    expect((await localProvider.stat(r, 'n.md'))?.size).toBe(bytes);
  });

  it('a rebuilt orphan carries the version its body holds', async () => {
    const r = 'vault.orphanversion';
    const w = await localProvider.write(r, 'n.md', 'body', { ifAbsent: true });
    await platform.storeSetJson(`oscode.gitos.index.${r}`, { files: [] });
    const [entry] = await localProvider.list(r);
    expect(entry).toMatchObject({ path: 'n.md', version: versionOfWrite(w), size: 4 });
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

// Vault M6 (tech review K3, K6, R3): a rename is a key move in the chain that keeps
// the body whole, `v` included; Trash is one sealed key per entry plus a list
// doc, and a restore puts back the same version, beside a taken name as
// "{title} (restored)". The cross-provider cases live in providerContract;
// these pin what is Local's own.
describe('Local provider rename and Trash (M6)', () => {
  const versionOf = (r: { ok: boolean; file?: { version?: string } }) =>
    r.ok ? r.file!.version! : '';

  it('offers rename and Trash, and no folders, attachments or bytes of its own', () => {
    for (const m of ['rename', 'trash', 'listTrash', 'restore', 'emptyTrash'] as const) {
      expect(typeof localProvider[m], m).toBe('function');
    }
    for (const m of [
      'listFolders',
      'createFolder',
      'renameFolder',
      'listAttachments',
      'readBytes',
    ] as const) {
      expect(localProvider[m], m).toBeUndefined();
    }
  });

  it('a rename keeps the version token, and the old key is gone', async () => {
    const r = 'vault.m6.rename';
    const w = await localProvider.write(r, 'Plans.md', 'the plan', { ifAbsent: true });
    const moved = await localProvider.rename!(r, 'Plans.md', 'Work/Plans 2.md', {
      ifMatch: versionOf(w),
    });
    expect(moved).toMatchObject({ ok: true, file: { path: 'Work/Plans 2.md' } });
    expect(moved.ok && moved.file.version).toBe(versionOf(w));
    expect(await platform.storeGetJson(`oscode.gitos.file.${r}.Plans.md`)).toBeUndefined();
    expect(await listed(r)).toEqual(['Work/Plans 2.md']);
    // The version it kept is the one the next write accepts.
    const next = await localProvider.write(r, 'Work/Plans 2.md', 'more', {
      ifMatch: versionOf(w),
    });
    expect(next.ok).toBe(true);
  });

  it('a pre-M2 body (no v) renames with its updatedAt as the version', async () => {
    const r = 'vault.m6.legacy';
    await platform.storeSetJson(`oscode.gitos.file.${r}.Old.md`, {
      text: 'old',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const moved = await localProvider.rename!(r, 'Old.md', 'New.md', {
      ifMatch: '2026-08-01T00:00:00.000Z',
    });
    expect(moved).toMatchObject({
      ok: true,
      file: { path: 'New.md', version: '2026-08-01T00:00:00.000Z' },
    });
  });

  it('a rename racing a write to the source never loses the new text', async () => {
    const r = 'vault.m6.race';
    const w = await localProvider.write(r, 'a.md', 'one', { ifAbsent: true });
    const [write, move] = await Promise.all([
      localProvider.write(r, 'a.md', 'two', { ifMatch: versionOf(w) }),
      localProvider.rename!(r, 'a.md', 'b.md', { ifMatch: versionOf(w) }),
    ]);
    // The chain runs the write first, so the rename sees a moved version.
    expect(write.ok).toBe(true);
    expect(move).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'two' } });
    expect((await localProvider.read(r, 'a.md'))?.text).toBe('two');
    expect(await localProvider.read(r, 'b.md')).toBeUndefined();
  });

  it('a trashed note is one sealed key with its path, text, updatedAt, v and trashedAt', async () => {
    const r = 'vault.m6.key';
    const w = await localProvider.write(r, 'Ideas/x.md', 'body', { ifAbsent: true });
    const t = await localProvider.trash!(r, {
      kind: 'note',
      path: 'Ideas/x.md',
      ifMatch: versionOf(w),
    });
    expect(t).toMatchObject({ ok: true, notes: 1, attachments: 0 });
    const id = t.ok ? t.entry.id : '';
    const doc = await platform.storeGetJson<Record<string, unknown>>(
      `oscode.gitos.trash.${r}.${id}`,
    );
    expect(doc).toMatchObject({ kind: 'note', path: 'Ideas/x.md', text: 'body', v: versionOf(w) });
    expect(typeof doc?.trashedAt).toBe('string');
    expect(await listed(r)).toEqual([]);
    const back = await localProvider.restore!(r, id);
    expect(back).toMatchObject({ ok: true, renamed: false, file: { path: 'Ideas/x.md' } });
    expect(back.ok && back.file.version).toBe(versionOf(w));
  });

  it('an orphaned trash key (cut off before the list) lists again', async () => {
    const r = 'vault.m6.orphan';
    await platform.storeSetJson(`oscode.gitos.trash.${r}.lost`, {
      kind: 'note',
      path: 'Lost.md',
      text: 'still here',
      updatedAt: '2026-09-01T00:00:00.000Z',
      trashedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(await localProvider.listTrash!(r)).toEqual([
      {
        id: 'lost',
        path: 'Lost.md',
        kind: 'note',
        size: 'still here'.length,
        trashedAt: '2026-09-02T00:00:00.000Z',
      },
    ]);
  });

  it('a folder goes to Trash whole and comes back note by note', async () => {
    const r = 'vault.m6.folder';
    await localProvider.write(r, 'Work/a.md', 'a');
    await localProvider.write(r, 'Work/Deep/b.md', 'b');
    await localProvider.write(r, 'Workshop.md', 'not under Work');
    const t = await localProvider.trash!(r, { kind: 'folder', path: 'Work' });
    expect(t).toMatchObject({ ok: true, notes: 2, entry: { kind: 'folder', path: 'Work' } });
    expect(await listed(r)).toEqual(['Workshop.md']);
    // Someone made Work/a.md again meanwhile: that one comes back beside it.
    await localProvider.write(r, 'Work/a.md', 'new a');
    const back = await localProvider.restore!(r, t.ok ? t.entry.id : '');
    expect(back).toMatchObject({ ok: true, renamed: true });
    expect(await listed(r)).toEqual([
      'Work/a (restored).md',
      'Work/a.md',
      'Work/Deep/b.md',
      'Workshop.md',
    ]);
    expect((await localProvider.read(r, 'Work/a.md'))?.text).toBe('new a');
    expect((await localProvider.read(r, 'Work/a (restored).md'))?.text).toBe('a');
  });

  it('an empty folder moves nothing and lists nothing', async () => {
    const r = 'vault.m6.empty';
    const t = await localProvider.trash!(r, { kind: 'folder', path: 'Nothing' });
    expect(t).toMatchObject({ ok: true, notes: 0 });
    expect(await localProvider.listTrash!(r)).toEqual([]);
  });

  it('refuses a folder path that is the root or a dot folder', async () => {
    for (const path of ['', '.trash', 'a/.obsidian', '/abs']) {
      await expect(localProvider.trash!('vault.m6.bad', { kind: 'folder', path })).rejects.toThrow(
        /not a folder/,
      );
    }
  });

  it('Empty Trash removes the entries named, then all of them', async () => {
    const r = 'vault.m6.emptytrash';
    const ids: string[] = [];
    for (const p of ['a.md', 'b.md', 'c.md']) {
      const w = await localProvider.write(r, p, p, { ifAbsent: true });
      const t = await localProvider.trash!(r, { kind: 'note', path: p, ifMatch: versionOf(w) });
      ids.push(t.ok ? t.entry.id : '');
    }
    expect(await localProvider.emptyTrash!(r, [ids[0]!, 'nope'])).toEqual({ removed: 1 });
    expect((await localProvider.listTrash!(r)).map((e) => e.path).sort()).toEqual(['b.md', 'c.md']);
    expect(await platform.storeGetJson(`oscode.gitos.trash.${r}.${ids[0]}`)).toBeUndefined();
    expect(await localProvider.emptyTrash!(r)).toEqual({ removed: 2 });
    expect(await localProvider.listTrash!(r)).toEqual([]);
    expect(await localProvider.restore!(r, ids[1]!)).toEqual({ ok: false, conflict: 'missing' });
  });

  it('a note gone since it was read answers changed, and nothing lists in Trash', async () => {
    const r = 'vault.m6.gone';
    expect(await localProvider.trash!(r, { kind: 'note', path: 'never.md', ifMatch: 'x' })).toEqual(
      { ok: false, conflict: 'changed' },
    );
    expect(await localProvider.listTrash!(r)).toEqual([]);
  });
});
