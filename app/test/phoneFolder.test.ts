// The phone's OpenShore folder (folder and sync plan, M2). The contract suite
// (providerContract.test.ts) holds This device on the phone to every folder's
// rules; this file holds what is the phone's own: the version token across
// two same-size writes in one millisecond, one chain for every write, the
// layout and its README, the one-time move from the sealed store (once, safe
// to cut off, never over a note the folder already has), the gate that keeps
// a half-moved vault from listing, and the registry answering the folder only
// on iOS.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform } from '../src/lib/platform.js';

const h = vi.hoisted(() => ({
  on: 'ios' as Platform,
  store: new Map<string, string>(),
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => h.on,
  isPhone: () => h.on === 'ios',
  isDesktop: () => h.on === 'electron',
  storeGetJson: async (k: string) => {
    const v = h.store.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    h.store.set(k, JSON.stringify(v));
  },
  storeDelete: async (k: string) => {
    h.store.delete(k);
  },
  storeKeys: async () => [...h.store.keys()],
}));

const { createPhoneFolderTransport, createPhoneVaultProvider, PHONE_VAULT_DIR } =
  await import('../src/lib/gitos/phoneFolder.js');
const { moveSealedVaultToFolder, PHONE_VAULT_MOVE_KEY, PHONE_VAULT_RESOURCE_ID } =
  await import('../src/lib/gitos/phoneVault.js');
const { localProvider } = await import('../src/lib/gitos/local.js');
const { ensurePhoneFolder, PHONE_README, PHONE_SECTIONS } =
  await import('../src/lib/phoneFolder.js');
const { createFakePhoneFs } = await import('./support/fakePhoneFs.js');

const R = PHONE_VAULT_RESOURCE_ID;
const fs = createFakePhoneFs();
const inVault = (p: string) => `${PHONE_VAULT_DIR}/${p}`;

beforeEach(() => {
  h.on = 'ios';
  h.store.clear();
  fs.reset();
});

describe('the version token', () => {
  it('tells two same-size writes in one millisecond apart, so a stale ifMatch conflicts', async () => {
    const t = createPhoneFolderTransport(fs);
    fs.clock.frozen = true;
    const first = await t.write('a.md', 'one', { ifAbsent: true });
    const base = first.ok ? first.file.version! : '';
    // Our own second write, same size, same millisecond: a new version.
    const second = await t.write('a.md', 'two', { ifMatch: base });
    expect(second.ok).toBe(true);
    const v2 = second.ok ? second.file.version! : '';
    expect(v2).not.toBe(base);
    expect(await t.write('a.md', 'six', { ifMatch: base })).toMatchObject({
      ok: false,
      conflict: 'changed',
      theirs: { text: 'two' },
    });
    // Another app's edit, same size, same millisecond: still caught.
    fs.put(inVault('a.md'), 'ten');
    const r = await t.write('a.md', 'mine', { ifMatch: v2 });
    expect(r).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'ten' } });
    expect(fs.text(inVault('a.md'))).toBe('ten');
  });

  it('list reads a note again when it changed behind the cache', async () => {
    const t = createPhoneFolderTransport(fs);
    const w = await t.write('a.md', 'one', { ifAbsent: true });
    expect((await t.list())[0]?.version).toBe(w.ok ? w.file.version : 'no');
    fs.put(inVault('a.md'), 'something longer');
    const now = await t.read('a.md');
    expect((await t.list())[0]?.version).toBe(now?.version);
    expect(now?.version).not.toBe(w.ok ? w.file.version : '');
  });
});

describe('one chain for every write', () => {
  it('two creates at once: one lands, the other is told the name is taken', async () => {
    const t = createPhoneFolderTransport(fs);
    const [a, b] = await Promise.all([
      t.write('n.md', 'first', { ifAbsent: true }),
      t.write('n.md', 'second', { ifAbsent: true }),
    ]);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, conflict: 'exists', theirs: { text: 'first' } });
    expect(fs.text(inVault('n.md'))).toBe('first');
  });

  it('a create never writes over a name another case already has', async () => {
    const t = createPhoneFolderTransport(fs);
    fs.put(inVault('Plan.md'), 'theirs');
    const r = await t.write('plan.md', 'mine', { ifAbsent: true });
    expect(r).toMatchObject({ ok: false, conflict: 'exists', theirs: { path: 'Plan.md' } });
  });
});

describe('what lists', () => {
  it('notes only: no dot folder, no Trash, no settings, no attachment', async () => {
    const t = createPhoneFolderTransport(fs);
    fs.put(inVault('a.md'), 'a');
    fs.put(inVault('Work/b.md'), 'b');
    fs.put(inVault('.obsidian/app.json'), '{}');
    fs.put(inVault('.trash/old.md'), 'old');
    fs.put(inVault('.oscode/vault.json'), '{}');
    fs.put(inVault('.hidden.md'), 'x');
    fs.put(inVault('Work/picture.txt'), 'x');
    expect((await t.list()).map((f) => f.path).sort()).toEqual(['Work/b.md', 'a.md']);
    expect(await t.listFolders!()).toEqual(['Work']);
    expect(await t.stat('.hidden.md')).toBeNull();
    expect(await t.read('.trash/old.md')).toBeNull();
  });

  it('shows images and PDFs put there through Files, and checks the bytes', async () => {
    const t = createPhoneFolderTransport(fs);
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2));
    fs.putBase64(inVault('Media/a.png'), png);
    fs.putBase64(inVault('Media/fake.png'), btoa('not a png'));
    expect((await t.listAttachments!()).map((a) => [a.path, a.mime])).toEqual([
      ['Media/a.png', 'image/png'],
      ['Media/fake.png', 'image/png'],
    ]);
    const r = await t.readBytes!('Media/a.png');
    expect(r.ok && [...r.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(await t.readBytes!('Media/fake.png')).toEqual({ ok: false, reason: 'unsupported' });
    expect(await t.readBytes!('Media/a.png', { max: 2 })).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(await t.readBytes!('.trash/a.png')).toEqual({ ok: false, reason: 'refused' });
  });
});

describe('the layout', () => {
  it('makes OpenShore/Vault, Chats, Models and Exports, with no Projects, and the README once', async () => {
    await ensurePhoneFolder(fs);
    for (const name of Object.values(PHONE_SECTIONS)) {
      expect((await fs.stat(`OpenShore/${name}`))?.type).toBe('directory');
    }
    expect(await fs.stat('OpenShore/Projects')).toBeNull();
    expect(Object.values(PHONE_SECTIONS)).toEqual(['Vault', 'Chats', 'Models', 'Exports']);
    expect(fs.text('OpenShore/README.md')).toBe(PHONE_README);
    // The person's own edit stays.
    fs.put('OpenShore/README.md', 'my notes about this folder');
    await ensurePhoneFolder(fs);
    expect(fs.text('OpenShore/README.md')).toBe('my notes about this folder');
  });

  it('the README says only what this build does', () => {
    expect(PHONE_README).toMatch(/\*\*Vault\*\*/);
    expect(PHONE_README).toMatch(/left out of backups/);
    // Chats are not files until M3: the line says they stay in the app.
    expect(PHONE_README).toMatch(/chats stay inside the app/);
    expect(PHONE_README).not.toMatch(/\*\*Projects\*\*/);
  });
});

// ---- the one-time move -------------------------------------------------------

async function sealNote(path: string, text: string) {
  const w = await localProvider.write(R, path, text, { ifAbsent: true });
  if (!w.ok) throw new Error('seal failed');
  return w.file;
}

describe('the move from the sealed store', () => {
  it('moves every note, Trash and the settings, then records that it ran, once', async () => {
    const t = createPhoneFolderTransport(fs);
    await sealNote('a.md', 'alpha');
    await sealNote('Work/b.md', 'beta');
    const gone = await sealNote('old.md', 'old words');
    await localProvider.trash!(R, { kind: 'note', path: 'old.md', ifMatch: gone.version! });
    await localProvider.writeConfig!(R, 'oscode/vault', '{"version":1}', { ifAbsent: true });

    const r = await moveSealedVaultToFolder(t);
    expect(r).toMatchObject({ moved: 2, beside: [], trash: 1, settings: 'moved', done: true });
    expect(fs.text(inVault('a.md'))).toBe('alpha');
    expect(fs.text(inVault('Work/b.md'))).toBe('beta');
    expect(fs.text(inVault('.oscode/vault.json'))).toBe('{"version":1}');
    expect((await t.listTrash!()).map((e) => e.path)).toEqual(['old.md']);
    // The sealed copies are gone, and the sealed settings with them.
    expect(await localProvider.list(R)).toEqual([]);
    expect(await localProvider.listTrash!(R)).toEqual([]);
    expect(await localProvider.readConfig!(R, 'oscode/vault')).toEqual({
      ok: false,
      reason: 'absent',
    });
    expect(JSON.parse(h.store.get(PHONE_VAULT_MOVE_KEY)!)).toMatchObject({
      doneAt: expect.any(String),
    });
    // Restore from the moved Trash brings the note back.
    const id = (await t.listTrash!())[0]!.id;
    expect(await t.restore!(id)).toMatchObject({ ok: true, file: { path: 'old.md' } });
    expect(fs.text(inVault('old.md'))).toBe('old words');

    // Once done it never runs again, whatever the sealed store holds later.
    await sealNote('later.md', 'later');
    expect(await moveSealedVaultToFolder(t)).toMatchObject({ moved: 0, done: true });
    expect(fs.text(inVault('later.md'))).toBeUndefined();
  });

  it('never writes over a note the folder already has: the sealed one lands beside it', async () => {
    const t = createPhoneFolderTransport(fs);
    fs.put(inVault('Plan.md'), 'the folder copy');
    fs.put(inVault('Same.md'), 'same words');
    await sealNote('Plan.md', 'the sealed copy');
    await sealNote('Same.md', 'same words');
    const when = new Date(2026, 9, 16, 14, 5);
    const r = await moveSealedVaultToFolder(t, { now: () => when });
    expect(r.moved).toBe(2);
    expect(r.beside).toEqual(['Plan (conflict 2026-10-16 1405).md']);
    expect(fs.text(inVault('Plan.md'))).toBe('the folder copy');
    expect(fs.text(inVault('Plan (conflict 2026-10-16 1405).md'))).toBe('the sealed copy');
    // The same text already there is the same note, not a conflict.
    expect(fs.text(inVault('Same.md'))).toBe('same words');
    expect(fs.paths(PHONE_VAULT_DIR).filter((p) => p.includes('Same'))).toEqual([
      inVault('Same.md'),
    ]);
  });

  it('keeps the folder its own settings file, and the sealed one, when they differ', async () => {
    const t = createPhoneFolderTransport(fs);
    fs.put(inVault('.oscode/vault.json'), '{"version":1,"tree":{"sort":"modified"}}');
    await localProvider.writeConfig!(R, 'oscode/vault', '{"version":1}', { ifAbsent: true });
    const r = await moveSealedVaultToFolder(t);
    expect(r).toMatchObject({ settings: 'kept', done: true });
    expect(fs.text(inVault('.oscode/vault.json'))).toBe('{"version":1,"tree":{"sort":"modified"}}');
    expect((await localProvider.readConfig!(R, 'oscode/vault')).ok).toBe(true);
  });

  it('cut off midway, it keeps every sealed copy it has not verified and finishes next time, with no second copy', async () => {
    const t = createPhoneFolderTransport(fs);
    fs.put(inVault('Plan.md'), 'the folder copy');
    await sealNote('Plan.md', 'the sealed copy');
    await sealNote('a.md', 'alpha');
    const gone = await sealNote('old.md', 'old');
    await localProvider.trash!(R, { kind: 'note', path: 'old.md', ifMatch: gone.version! });
    // The first launch writes, then cannot read anything back (the app was
    // closed, the disk went away): nothing sealed is removed.
    const realRead = t.read.bind(t);
    t.read = async () => null;
    const realEmpty = localProvider.emptyTrash!;
    localProvider.emptyTrash = async () => {
      throw new Error('cut off');
    };
    const when = new Date(2026, 9, 16, 9, 30);
    let r: Awaited<ReturnType<typeof moveSealedVaultToFolder>>;
    try {
      r = await moveSealedVaultToFolder(t, { now: () => when });
    } finally {
      t.read = realRead;
      localProvider.emptyTrash = realEmpty;
    }
    expect(r).toMatchObject({ moved: 0, trash: 0, done: false });
    expect((await localProvider.list(R)).map((f) => f.path).sort()).toEqual(['Plan.md', 'a.md']);
    expect(await localProvider.listTrash!(R)).toHaveLength(1);
    expect(fs.text(inVault('a.md'))).toBe('alpha');

    // The next launch, an hour later: it finds what it wrote and finishes.
    const later = new Date(2026, 9, 16, 10, 31);
    const again = await moveSealedVaultToFolder(t, { now: () => later });
    expect(again).toMatchObject({ moved: 2, trash: 1, done: true });
    const plans = fs.paths(PHONE_VAULT_DIR).filter((p) => /\/Plan/.test(p));
    expect(plans).toEqual([inVault('Plan (conflict 2026-10-16 0930).md'), inVault('Plan.md')]);
    expect((await t.listTrash!()).map((e) => e.path)).toEqual(['old.md']);
    expect(await localProvider.list(R)).toEqual([]);
  });
});

describe('the provider on the phone', () => {
  it('holds every call until the move settles', async () => {
    const t = createPhoneFolderTransport(fs);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const p = createPhoneVaultProvider(t, () => gate);
    fs.put(inVault('a.md'), 'a');
    let listed: string[] | undefined;
    const pending = p.list(R).then((files) => (listed = files.map((f) => f.path)));
    await new Promise((r) => setTimeout(r, 5));
    expect(listed).toBeUndefined();
    open();
    await pending;
    expect(listed).toEqual(['a.md']);
  });

  it('keeps the id local, compare-and-swap, and the folder rows', () => {
    const p = createPhoneVaultProvider(createPhoneFolderTransport(fs));
    expect(p.id).toBe('local');
    expect(p.label).toBe('This device');
    expect(p.compareAndSwap).toBe(true);
    for (const m of ['rename', 'listFolders', 'trash', 'restore', 'writeConfig', 'readBytes']) {
      expect(typeof (p as unknown as Record<string, unknown>)[m], m).toBe('function');
    }
  });

  it('the registry answers the folder for This device on iOS only', async () => {
    const { providerFor } = await import('../src/lib/gitos/index.js');
    const { phoneVaultProvider } = await import('../src/lib/gitos/phoneVault.js');
    h.on = 'ios';
    expect(providerFor('local')).toBe(phoneVaultProvider());
    for (const on of ['web', 'electron'] as const) {
      h.on = on;
      expect(providerFor('local')).toBe(localProvider);
    }
  });
});
