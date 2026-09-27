// Your computer, the hub vault (Vault M5, CTO J9), through the real provider
// against a fake of the daemon's /vault routes (support/fakeHubDaemon.ts):
// - online, it lists, reads and writes with compare-and-swap, and only notes
//   ever cross;
// - out of reach, the last listing and the bodies read here answer from the
//   sealed stash (at most 200 notes or 8 MB, oldest read first out), the tree
//   is read-only, and a save to a kept note fails transient so the store's
//   pending queue keeps it with its base version; back in reach, that save
//   replays as ifMatch and a note changed meanwhile is a 409 with theirs;
// - each hub and each person on it has a stash and an index of their own;
// - it is registered, and probeReady('hub') is true only while paired;
// - the D2 rules: pairing repoints only an empty Local vault that nobody
//   placed, and unpairing returns to the previous storage;
// - leaving the Vault room keeps the personal index warm for the chats, and
//   never the team one;
// - the engine's saved index is the first open's head start.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  sealed: [] as string[],
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  storeGetJson: async (k: string) => {
    const v = h.store.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    h.sealed.push(k);
    h.store.set(k, JSON.stringify(v));
  },
  storeDelete: async (k: string) => {
    h.store.delete(k);
  },
  storeKeys: async (prefix: string) => [...h.store.keys()].filter((k) => k.startsWith(prefix)),
  sealBlob: async (t: string) => `sealed:${t}`,
  openBlob: async (b: string) => (b.startsWith('sealed:') ? b.slice(7) : null),
}));
vi.mock('../src/lib/electronBridge.js', () => ({ bridge: () => undefined }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async () => {
      throw new Error('File does not exist');
    },
    writeFile: async () => ({ uri: '' }),
    rename: async () => {},
    deleteFile: async () => {},
  },
}));

const hub = await import('../src/lib/gitos/hub.js');
const gitos = await import('../src/lib/gitos/index.js');
const indexHost = await import('../src/lib/vaultIndexHost.js');
const { fakeHubDaemon } = await import('./support/fakeHubDaemon.js');
const {
  HUB_AWAY_NOT_KEPT,
  HUB_AWAY_READ_ONLY,
  HUB_PAIR_LINE,
  HUB_PAIRING_REFUSED,
  HUB_UPDATE_LINE,
} = await import('../src/lib/vaultCopy.js');
const { serializeIndex } = await import('os-code/protocol');

const BASE = 'http://mac.tail1234.ts.net:4816';
const R = 'vault.personal';

function make(d = fakeHubDaemon(BASE), hubUserId = 'owner') {
  const p = hub.createHubProvider({
    baseUrl: BASE,
    token: async () => d.token,
    hubUserId,
    fetch: d.fetch,
  });
  return { d, p };
}

beforeEach(async () => {
  h.store.clear();
  h.sealed.length = 0;
  hub.setHubVaultLink(undefined);
  await indexHost.shutVaultIndex();
});

describe('online', () => {
  it('lists only notes, reads, and writes with the version the computer returns', async () => {
    const { d, p } = make();
    d.replace('Plan.md', '# Plan');
    d.replace('.obsidian/workspace.md', 'nope');
    d.replace('Img.png', 'nope');
    const listed = await p.list(R);
    expect(listed.map((f) => f.path)).toEqual(['Plan.md']);
    const file = await p.read(R, 'Plan.md');
    expect(file).toMatchObject({ path: 'Plan.md', text: '# Plan', version: listed[0]!.version });
    const w = await p.write(R, 'Plan.md', '# Plan 2', { ifMatch: file!.version! });
    expect(w).toMatchObject({ ok: true, file: { text: '# Plan 2' } });
    expect(d.bytes('Plan.md')).toBe('# Plan 2');
    expect(p.reach()).toBe('reachable');
  });

  it('never sends a path that is not a note', async () => {
    const { d, p } = make();
    await expect(p.write(R, '.obsidian/app.json', '{}')).rejects.toThrow(/not a note/);
    expect(await p.read(R, '../secret.md')).toBeUndefined();
    expect(d.calls.filter((c) => c.includes('obsidian') || c.includes('secret'))).toEqual([]);
  });

  it('a turned-down pairing and an old computer are refusals retrying cannot fix', async () => {
    const d = fakeHubDaemon(BASE);
    const p = hub.createHubProvider({
      baseUrl: BASE,
      token: async () => 'pair-token',
      hubUserId: 'o',
      fetch: d.fetch,
    });
    d.token = 'rotated';
    await expect(p.list(R)).rejects.toMatchObject({
      permanent: true,
      message: HUB_PAIRING_REFUSED,
    });
    const old = make();
    old.d.old = true;
    await expect(old.p.list(R)).rejects.toMatchObject({
      permanent: true,
      message: HUB_UPDATE_LINE,
    });
  });

  it('reads config through the allow-list, and away it reads as the defaults', async () => {
    const { d, p } = make();
    d.config.set('obsidian/daily-notes', '{"folder":"Daily"}');
    expect(await p.readConfig!(R, 'obsidian/daily-notes')).toMatchObject({
      ok: true,
      text: '{"folder":"Daily"}',
    });
    expect(await p.readConfig!(R, 'obsidian/app')).toEqual({ ok: false, reason: 'absent' });
    const before = d.calls.length;
    expect(await p.readConfig!(R, 'plugins/secret' as never)).toEqual({
      ok: false,
      reason: 'refused',
    });
    expect(d.calls.length).toBe(before);
    d.up = false;
    expect(await p.readConfig!(R, 'obsidian/daily-notes')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('fetches the privacy rules, and the index with its ETag', async () => {
    const { d, p } = make();
    expect(await p.fetchPrivacy()).toEqual(d.privacy);
    d.index = { text: '{"x":1}', etag: '"e1"' };
    expect(await p.fetchIndex()).toBe('{"x":1}');
    // Unchanged since: 304, nothing to load again.
    expect(await p.fetchIndex()).toBeNull();
    d.up = false;
    expect(await p.fetchIndex()).toBeNull();
    await expect(p.fetchPrivacy()).rejects.toBeInstanceOf(hub.HubAwayError);
  });
});

describe('out of reach', () => {
  it('lists and reads what was kept, and never calls an unkept note missing', async () => {
    const { d, p } = make();
    d.replace('A.md', 'alpha');
    d.replace('B.md', 'beta');
    await p.list(R);
    await p.read(R, 'A.md');
    d.up = false;
    const seen: string[] = [];
    p.onReach((r) => seen.push(r));
    expect((await p.list(R)).map((f) => f.path)).toEqual(['A.md', 'B.md']);
    expect(seen).toEqual(['away']);
    expect(p.reach()).toBe('away');
    expect((await p.read(R, 'A.md'))?.text).toBe('alpha');
    expect((await p.stat(R, 'B.md'))?.path).toBe('B.md');
    await expect(p.read(R, 'B.md')).rejects.toMatchObject({ message: HUB_AWAY_NOT_KEPT });
    // With nothing kept at all, the list fails rather than showing an empty vault.
    const fresh = make(fakeHubDaemon(BASE), 'someone-else');
    fresh.d.up = false;
    await expect(fresh.p.list(R)).rejects.toBeInstanceOf(hub.HubAwayError);
  });

  it('keeps the tree read-only: no create, rename or delete', async () => {
    const { d, p } = make();
    d.replace('A.md', 'alpha');
    const a = await p.read(R, 'A.md');
    d.up = false;
    await expect(p.write(R, 'New.md', '', { ifAbsent: true })).rejects.toMatchObject({
      permanent: true,
      message: HUB_AWAY_READ_ONLY,
    });
    // A rename writes the new name first; that is a create.
    await expect(p.write(R, 'Renamed.md', 'alpha', { ifAbsent: true })).rejects.toMatchObject({
      message: HUB_AWAY_READ_ONLY,
    });
    await expect(p.remove(R, 'A.md', { ifMatch: a!.version! })).rejects.toMatchObject({
      permanent: true,
      message: HUB_AWAY_READ_ONLY,
    });
    // An edit to a note never kept here cannot wait either.
    await expect(p.write(R, 'Other.md', 'x', { ifMatch: 'v9' })).rejects.toMatchObject({
      permanent: true,
    });
  });

  it('a save to a kept note waits (transient) and lands as ifMatch when the computer is back', async () => {
    const { d, p } = make();
    d.replace('A.md', 'alpha');
    const a = await p.read(R, 'A.md');
    d.up = false;
    const err = await p.write(R, 'A.md', 'alpha edited', { ifMatch: a!.version! }).catch((e) => e);
    expect(err).toBeInstanceOf(hub.HubAwayError);
    expect((err as { permanent?: boolean }).permanent).toBeUndefined();
    expect(d.bytes('A.md')).toBe('alpha');
    // Back: the store's replay writes with the base it kept.
    d.up = true;
    const r = await p.write(R, 'A.md', 'alpha edited', { ifMatch: a!.version! });
    expect(r.ok).toBe(true);
    expect(d.bytes('A.md')).toBe('alpha edited');
    expect(p.reach()).toBe('reachable');
  });

  it('a note changed on the computer meanwhile is a 409 with theirs, and nothing is overwritten', async () => {
    const { d, p } = make();
    d.replace('A.md', 'alpha');
    const a = await p.read(R, 'A.md');
    d.up = false;
    await p.write(R, 'A.md', 'mine', { ifMatch: a!.version! }).catch(() => {});
    d.up = true;
    d.replace('A.md', 'the agent wrote this');
    const r = await p.write(R, 'A.md', 'mine', { ifMatch: a!.version! });
    expect(r).toMatchObject({
      ok: false,
      conflict: 'changed',
      theirs: { text: 'the agent wrote this' },
    });
    expect(d.bytes('A.md')).toBe('the agent wrote this');
  });

  it('forgets a kept body whose version moved on, so away never shows old text as current', async () => {
    const { d, p } = make();
    d.replace('A.md', 'alpha');
    await p.read(R, 'A.md');
    d.replace('A.md', 'newer');
    await p.list(R);
    d.up = false;
    await expect(p.read(R, 'A.md')).rejects.toMatchObject({ message: HUB_AWAY_NOT_KEPT });
  });
});

describe('the stash', () => {
  it('keeps at most 200 bodies, oldest read first out', async () => {
    const { d, p } = make();
    for (let i = 0; i < hub.HUB_STASH_MAX_NOTES + 5; i++) d.replace(`n${i}.md`, `body ${i}`);
    await p.list(R);
    for (let i = 0; i < hub.HUB_STASH_MAX_NOTES + 5; i++) await p.read(R, `n${i}.md`);
    d.up = false;
    await expect(p.read(R, 'n0.md')).rejects.toBeInstanceOf(hub.HubAwayError);
    await expect(p.read(R, 'n4.md')).rejects.toBeInstanceOf(hub.HubAwayError);
    expect((await p.read(R, 'n5.md'))?.text).toBe('body 5');
    expect((await p.read(R, `n${hub.HUB_STASH_MAX_NOTES + 4}.md`))?.text).toBe('body 204');
  });

  it('keeps at most 8 MB of bodies', async () => {
    const { d, p } = make();
    const big = 'x'.repeat(3 * 1024 * 1024);
    for (const n of ['a', 'b', 'c']) d.replace(`${n}.md`, big);
    for (const n of ['a', 'b', 'c']) await p.read(R, `${n}.md`);
    d.up = false;
    await expect(p.read(R, 'a.md')).rejects.toBeInstanceOf(hub.HubAwayError);
    expect((await p.read(R, 'b.md'))?.text.length).toBe(big.length);
    expect((await p.read(R, 'c.md'))?.text.length).toBe(big.length);
  });

  it('lives only in the sealed store, one per hub and person, and is forgotten on unpairing', async () => {
    const d = fakeHubDaemon(BASE);
    const owner = make(d, 'owner');
    const member = make(d, 'member-1');
    d.replace('A.md', 'alpha');
    await owner.p.read(R, 'A.md');
    expect(h.sealed.length).toBeGreaterThan(0);
    expect(h.sealed.every((k) => k.startsWith('oscode.hub.'))).toBe(true);
    // No key names the computer's address.
    expect(h.sealed.some((k) => k.includes('tail1234'))).toBe(false);
    d.up = false;
    expect((await owner.p.read(R, 'A.md'))?.text).toBe('alpha');
    await expect(member.p.read(R, 'A.md')).rejects.toBeInstanceOf(hub.HubAwayError);
    expect(owner.p.target.owner).not.toBe(member.p.target.owner);
    await hub.forgetHubStash(BASE, 'owner');
    const again = make(d, 'owner');
    await expect(again.p.read(R, 'A.md')).rejects.toBeInstanceOf(hub.HubAwayError);
  });
});

describe('registered, and ready only while paired', () => {
  it('providerFor has it, and probeReady follows the pairing', async () => {
    expect(gitos.providerFor('hub')?.compareAndSwap).toBe(true);
    expect(await gitos.probeReady('hub')).toBe(false);
    await expect(gitos.providerFor('hub')!.list(R)).rejects.toMatchObject({
      permanent: true,
      message: HUB_PAIR_LINE,
    });
    const d = fakeHubDaemon(BASE);
    d.replace('A.md', 'alpha');
    hub.setHubVaultLink({
      baseUrl: BASE,
      token: async () => d.token,
      hubUserId: 'owner',
      fetch: d.fetch,
    });
    expect(await gitos.probeReady('hub')).toBe(true);
    expect((await gitos.providerFor('hub')!.list(R)).map((f) => f.path)).toEqual(['A.md']);
    // Away is still paired: usable, read-only, from what was kept.
    d.up = false;
    await gitos.providerFor('hub')!.list(R);
    expect(hub.hubReach()).toBe('away');
    expect(await gitos.probeReady('hub')).toBe(true);
    hub.setHubVaultLink(undefined);
    expect(await gitos.probeReady('hub')).toBe(false);
    expect(hub.hubReach()).toBe('unknown');
  });
});

describe('D2: where the vault goes on pairing', () => {
  it('repoints only an empty Local vault nobody placed, and offers the move when it has notes', () => {
    expect(hub.hubPairPlan(undefined, 0)).toBe('repoint');
    expect(hub.hubPairPlan({ providerId: 'local' }, 0)).toBe('repoint');
    expect(hub.hubPairPlan({ providerId: 'local' }, 3)).toBe('offer-move');
    // A storage the person chose is never repointed or offered a move.
    expect(hub.hubPairPlan({ providerId: 'local', chosenAt: '2026-09-01' }, 0)).toBe('stay');
    expect(hub.hubPairPlan({ providerId: 'files' }, 0)).toBe('stay');
    expect(hub.hubPairPlan({ providerId: 'icloud', chosenAt: '2026-09-01' }, 0)).toBe('stay');
    expect(hub.hubPairPlan({ providerId: 'hub' }, 0)).toBe('stay');
  });

  it('unpairing returns to the previous storage and moves nothing back', () => {
    expect(hub.hubUnpairTarget({ providerId: 'hub' }, 'icloud')).toBe('icloud');
    expect(hub.hubUnpairTarget({ providerId: 'hub' }, undefined)).toBe('local');
    expect(hub.hubUnpairTarget({ providerId: 'hub' }, 'hub')).toBe('local');
    expect(hub.hubUnpairTarget({ providerId: 'local' }, 'icloud')).toBeUndefined();
  });
});

describe('the index', () => {
  const reader = {
    read: async (_r: string, path: string) => ({
      path,
      text: `# ${path}`,
      updatedAt: 'x',
      version: `v-${path}`,
    }),
  };
  const fast = () => ({
    yieldNow: async () => {},
    publish: false,
    store: indexHost.memoryIndexStore(),
  });

  it('leaving the Vault keeps the personal index warm for the chats, and it comes back the same', async () => {
    const target = { providerId: 'local' as const, resourceId: R };
    const host = indexHost.vaultIndexFor(target, reader, fast());
    await host.reconcile([{ path: 'A.md', updatedAt: 'x', size: 4, version: 'v-A.md' }]);
    expect(host.index.size).toBe(1);
    await indexHost.closeVaultIndex();
    expect(indexHost.currentVaultIndex()).toBeUndefined();
    expect(indexHost.warmVaultIndex()).toBe(host);
    expect(host.isClosed).toBe(false);
    const back = indexHost.vaultIndexFor(target, reader, fast());
    expect(back).toBe(host);
    expect(back.index.size).toBe(1);
  });

  it('the team index closes for real when the room is left, and is never warm', async () => {
    const team = { providerId: 'org' as const, resourceId: 'org-1', owner: 'u1' };
    const host = indexHost.vaultIndexFor(team, reader, fast());
    expect(indexHost.warmVaultIndex()).toBeUndefined();
    await indexHost.closeVaultIndex();
    expect(host.isClosed).toBe(true);
    expect(indexHost.warmVaultIndex()).toBeUndefined();
  });

  it('a storage move or a pairing change closes the warm one too', async () => {
    const host = indexHost.vaultIndexFor({ providerId: 'local', resourceId: R }, reader, fast());
    await indexHost.closeVaultIndex();
    const other = indexHost.vaultIndexFor(hub.hubIndexTarget(BASE, 'owner'), reader, fast());
    expect(host.isClosed).toBe(true);
    expect(indexHost.warmVaultIndex()).toBe(other);
    await indexHost.shutVaultIndex();
    expect(other.isClosed).toBe(true);
    expect(indexHost.warmVaultIndex()).toBeUndefined();
  });

  it("a hub vault's first open loads the engine's saved index from the computer", async () => {
    // What the engine saved: an index of one note, built here the same way.
    const seedHost = new indexHost.VaultIndexHost(
      { providerId: 'files', resourceId: R },
      reader,
      fast(),
    );
    await seedHost.reconcile([{ path: 'Seed.md', updatedAt: 'x', size: 9, version: 'v-Seed.md' }]);
    const d = fakeHubDaemon(BASE);
    d.index = { text: serializeIndex(seedHost.index).json, etag: '"s1"' };
    hub.setHubVaultLink({
      baseUrl: BASE,
      token: async () => d.token,
      hubUserId: 'owner',
      fetch: d.fetch,
    });
    const host = new indexHost.VaultIndexHost(hub.hubIndexTarget(BASE, 'owner'), reader, fast());
    await host.open();
    expect(host.index.has('Seed.md')).toBe(true);
    expect(d.calls).toContain('GET /vault/index');
    // Another hub's target never takes this computer's index.
    const elsewhere = new indexHost.VaultIndexHost(
      hub.hubIndexTarget('http://other.tail9.ts.net:4816', 'owner'),
      reader,
      fast(),
    );
    await elsewhere.open();
    expect(elsewhere.index.size).toBe(0);
  });
});
