// The storage seam's write contract (Vault M1, 1.1; CTO F4). Every provider's
// write takes an optional guard and answers with a WriteResult; a conflict is
// a result, never a throw. A provider that declares `compareAndSwap` enforces
// the guard, and every such provider must pass the cases below: a stale
// ifMatch conflicts and leaves the bytes alone, an ifMatch on a deleted note
// never recreates it, an ifAbsent never replaces, and a fresh write's version
// is the one the next ifMatch accepts.
//
// Enrolled now: the desktop folder, through its real client and its real
// Electron transport, with the bridge routed straight to main's handlers
// (electron/vaultFs.ts) over a temp folder, so the engine's writeNote does the
// file work exactly as it does in the app; and This device (Vault M2 2.1, CTO
// G1), over the mocked sealed store, where another writer is a body stored
// with a fresh version token. The providers not yet enrolled accept the guard
// and ignore it until their M2 stream lands; they are held to the result
// shape here and must not claim compareAndSwap.
//
// The team vault (Vault M2 2.1 and 2.3, CTO G3) is enrolled through a fake of
// its server half (test/fixtures/fakeOrgVaultServer.ts), which answers the
// two guarded RPCs of migration 0019 by their decision table; another writer
// is a teammate's save with a fresh rev.
//
// Your computer (Vault M5, CTO J9) is enrolled too, through its real provider
// against a fake of the daemon's /vault routes (test/support/fakeHubDaemon.ts),
// where another writer is a note replaced on the computer with a fresh
// version.
//
// Remove joined the contract in Vault M2 wave 0 (CTO G7): it answers with a
// RemoveResult, a stale ifMatch is 'changed' and leaves the file, and a file
// already gone is ok.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageProvider } from '../src/lib/gitos/providers.js';
import type { FakeOrgVaultServer } from './fixtures/fakeOrgVaultServer.js';

const h = vi.hoisted(() => ({
  root: '',
  team: undefined as FakeOrgVaultServer | undefined,
  store: new Map<string, string>(),
  Icloud: {
    available: async () => true,
    list: async () => ({ files: [] }),
    read: async () => ({ text: null }),
    write: async () => ({ updatedAt: '2026-09-27T00:00:00.000Z' }),
    remove: async () => {},
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'electron',
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
vi.mock('../src/lib/gitos/icloudPlugin.js', () => ({ Icloud: h.Icloud }));
// The team vault's Supabase seam, answered by the fake server.
vi.mock('../src/lib/supabase.js', () => ({
  isConfigured: () => true,
  select: (table: string, token: string, query: string) => h.team!.select(table, token, query),
  rpc: (fn: string, token: string, args: Record<string, unknown>) => h.team!.rpc(fn, token, args),
}));
// The Electron bridge, answered by main's own handlers over the temp folder.
vi.mock('../src/lib/electronBridge.js', async () => {
  const fs = await import('../electron/vaultFs.js');
  const b = {
    vaultList: async () => fs.listVaultFolder(h.root),
    vaultStat: (p: string) => fs.statVaultFile(h.root, p),
    vaultRead: (p: string) => fs.readVaultFile(h.root, p),
    vaultWrite: (p: string, t: string, g?: unknown) =>
      fs.writeVaultFile(h.root, p, t, fs.parseVaultGuard(g)),
    vaultRemove: (p: string, g?: unknown) =>
      fs.removeVaultFile(h.root, p, fs.parseVaultRemoveGuard(g)),
    // Vault M6 (CTO K13): main's handlers over the same folderFs code, each
    // wired only once stream B's function exists, as `(root, ...args)`.
    ...m6Bridge(fs as unknown as Record<string, unknown>),
    // Vault M3 and M7 (CTO H5, L7): main's config read, and its one config
    // write, the real writer through main's own handler code.
    ...(await configBridge()),
  };
  return { bridge: () => b };
});

/** osc:vaultReadConfig and osc:vaultWriteConfig over the temp folder, as
 *  main answers them: its read, and its one write, `putVaultSettingsFile`
 *  over the guard main parses, so the real engine writer (Vault M7, CTO L7)
 *  runs end to end with no stand-in. */
async function configBridge(): Promise<Record<string, unknown>> {
  const { readVaultConfigFile } = await import('os-code/dist/src/core/vault/configFile.js');
  const { putVaultSettingsFile, parseConfigWriteGuard } =
    await import('os-code/dist/src/daemon/vaultRoutes.js');
  return {
    vaultReadConfig: (name: unknown) =>
      readVaultConfigFile(h.root, name as Parameters<typeof readVaultConfigFile>[1]),
    vaultWriteConfig: (name: unknown, text: string, guard: unknown) =>
      putVaultSettingsFile(h.root, name, text, parseConfigWriteGuard(guard)),
  };
}

/** The M6 bridge calls, routed to folderFs by the K13 names. A call whose
 *  function is not built in this tree is left out, as an old main would. */
function m6Bridge(fs: Record<string, unknown>): Record<string, unknown> {
  const pairs: Array<[string, string]> = [
    ['vaultRename', 'renameVaultFile'],
    ['vaultFolders', 'listVaultFolders'],
    ['vaultFolderCreate', 'createVaultFolder'],
    ['vaultFolderRename', 'renameVaultFolder'],
    ['vaultTrash', 'trashVaultPath'],
    ['vaultTrashList', 'listVaultTrash'],
    ['vaultTrashRestore', 'restoreVaultTrash'],
    ['vaultTrashEmpty', 'emptyVaultTrash'],
    ['vaultAttachments', 'listVaultAttachments'],
    ['vaultReadBytes', 'readVaultBytes'],
  ];
  const out: Record<string, unknown> = {};
  for (const [call, fn] of pairs) {
    const f = fs[fn];
    if (typeof f === 'function') {
      out[call] = (...args: unknown[]) => (f as (...a: unknown[]) => unknown)(h.root, ...args);
    }
  }
  return out;
}

const { deviceFolderProvider } = await import('../src/lib/gitos/deviceFolder.js');
const { localProvider } = await import('../src/lib/gitos/local.js');
const { icloudProvider } = await import('../src/lib/gitos/icloud.js');
const { orgVaultProvider, setOrgVaultAuth, resetOrgVault } =
  await import('../src/lib/gitos/orgVault.js');
const { createFakeOrgVaultServer } = await import('./fixtures/fakeOrgVaultServer.js');
setOrgVaultAuth(
  async () => 'tok',
  () => true,
);
const { createHubProvider } = await import('../src/lib/gitos/hub.js');
const { fakeHubDaemon } = await import('./support/fakeHubDaemon.js');

const hub = fakeHubDaemon();
const hubProvider = createHubProvider({
  baseUrl: 'http://mac.tail1234.ts.net:4816',
  token: async () => hub.token,
  hubUserId: 'owner',
  fetch: hub.fetch,
});

/** Providers that enforce the guard, and how to reach their bytes directly. */
const enforcing: Array<{
  name: string;
  provider: StorageProvider;
  bytes: (path: string) => string | undefined;
  replace: (path: string, text: string) => void;
  remove: (path: string) => void;
}> = [
  {
    name: 'This folder (desktop)',
    provider: deviceFolderProvider,
    bytes: (p) => {
      try {
        return readFileSync(join(h.root, p), 'utf8');
      } catch {
        return undefined;
      }
    },
    // Another writer (the agent, Obsidian): a plain in-place write.
    replace: (p, t) => writeFileSync(join(h.root, p), t),
    remove: (p) => rmSync(join(h.root, p)),
  },
  {
    name: 'This device',
    provider: localProvider,
    bytes: (p) => {
      const raw = h.store.get(`oscode.gitos.file.${R}.${p}`);
      return raw ? (JSON.parse(raw) as { text: string }).text : undefined;
    },
    // Another writer: a body stored under the key with its own fresh token,
    // the way a second write through the provider would leave it.
    replace: (p, t) =>
      h.store.set(
        `oscode.gitos.file.${R}.${p}`,
        JSON.stringify({ text: t, updatedAt: new Date().toISOString(), v: `other-${t}` }),
      ),
    remove: (p) => h.store.delete(`oscode.gitos.file.${R}.${p}`),
  },
  {
    name: 'Team vault',
    provider: orgVaultProvider,
    bytes: (p) => h.team!.bytes(p),
    // Another writer: a teammate's save, with a fresh rev from the sequence.
    replace: (p, t) => {
      h.team!.put(p, t);
    },
    remove: (p) => h.team!.drop(p),
  },
  {
    name: 'Your computer (the hub)',
    provider: hubProvider,
    bytes: (p) => hub.bytes(p),
    replace: (p, t) => hub.replace(p, t),
    remove: (p) => hub.remove(p),
  },
];

beforeAll(() => {
  h.root = mkdtempSync(join(tmpdir(), 'osc-contract-'));
});
afterAll(() => {
  rmSync(h.root, { recursive: true, force: true });
});
beforeEach(() => {
  for (const name of readdirSync(h.root)) rmSync(join(h.root, name), { recursive: true });
  h.store.clear();
  // The resource id is the org's id for the team vault.
  h.team = createFakeOrgVaultServer(R);
  resetOrgVault();
  hub.reset();
});

const R = 'vault.personal';

for (const p of enforcing) {
  describe(`compare-and-swap contract: ${p.name}`, () => {
    it('declares compareAndSwap', () => {
      expect(p.provider.compareAndSwap).toBe(true);
    });

    it('a stale ifMatch returns changed with theirs, and leaves the bytes unchanged', async () => {
      const first = await p.provider.write(R, 'a.md', 'one', { ifAbsent: true });
      expect(first.ok).toBe(true);
      const base = first.ok ? first.file.version! : '';
      p.replace('a.md', 'someone else wrote this');
      const r = await p.provider.write(R, 'a.md', 'mine', { ifMatch: base });
      expect(r).toMatchObject({ ok: false, conflict: 'changed' });
      expect(!r.ok && r.theirs?.text).toBe('someone else wrote this');
      expect(p.bytes('a.md')).toBe('someone else wrote this');
    });

    it('ifMatch on a deleted file returns missing and does not recreate it', async () => {
      const first = await p.provider.write(R, 'gone.md', 'here', { ifAbsent: true });
      const base = first.ok ? first.file.version! : '';
      p.remove('gone.md');
      const r = await p.provider.write(R, 'gone.md', 'mine', { ifMatch: base });
      expect(r).toEqual({ ok: false, conflict: 'missing' });
      expect(p.bytes('gone.md')).toBeUndefined();
    });

    it('ifAbsent on an existing file returns exists with theirs, and never replaces', async () => {
      p.replace('taken.md', 'already here');
      const r = await p.provider.write(R, 'taken.md', 'mine', { ifAbsent: true });
      expect(r).toMatchObject({ ok: false, conflict: 'exists' });
      expect(!r.ok && r.theirs?.text).toBe('already here');
      expect(p.bytes('taken.md')).toBe('already here');
    });

    it("a fresh write's version is accepted by the next ifMatch", async () => {
      const first = await p.provider.write(R, 'n.md', 'one', { ifAbsent: true });
      expect(first.ok).toBe(true);
      const second = await p.provider.write(R, 'n.md', 'two', {
        ifMatch: first.ok ? first.file.version! : '',
      });
      expect(second).toMatchObject({ ok: true, file: { path: 'n.md', text: 'two' } });
      const third = await p.provider.write(R, 'n.md', 'three', {
        ifMatch: second.ok ? second.file.version! : '',
      });
      expect(third.ok).toBe(true);
      expect(p.bytes('n.md')).toBe('three');
    });

    it('list, stat, and read agree on the version a write returned', async () => {
      const w = await p.provider.write(R, 'v.md', 'body', { ifAbsent: true });
      const version = w.ok ? w.file.version : undefined;
      expect(version).toBeTruthy();
      expect((await p.provider.list(R)).find((f) => f.path === 'v.md')?.version).toBe(version);
      expect((await p.provider.stat(R, 'v.md'))?.version).toBe(version);
      expect((await p.provider.read(R, 'v.md'))?.version).toBe(version);
    });

    it('a stale ifMatch remove returns changed with theirs, and leaves the file', async () => {
      const first = await p.provider.write(R, 'r.md', 'one', { ifAbsent: true });
      const base = first.ok ? first.file.version! : '';
      p.replace('r.md', 'someone else wrote this');
      const r = await p.provider.remove(R, 'r.md', { ifMatch: base });
      expect(r).toMatchObject({ ok: false, conflict: 'changed' });
      expect(!r.ok && r.theirs?.text).toBe('someone else wrote this');
      expect(p.bytes('r.md')).toBe('someone else wrote this');
    });

    it('a current ifMatch remove removes the file', async () => {
      const first = await p.provider.write(R, 'r.md', 'one', { ifAbsent: true });
      const r = await p.provider.remove(R, 'r.md', {
        ifMatch: first.ok ? first.file.version! : '',
      });
      expect(r).toEqual({ ok: true });
      expect(p.bytes('r.md')).toBeUndefined();
      expect((await p.provider.list(R)).map((f) => f.path)).not.toContain('r.md');
    });

    it('removing a file already gone is ok, with or without a guard', async () => {
      expect(await p.provider.remove(R, 'never.md', { ifMatch: 'anything' })).toEqual({
        ok: true,
      });
      expect(await p.provider.remove(R, 'never.md')).toEqual({ ok: true });
    });

    it('a conflict leaves no temp file behind in the folder', async () => {
      const first = await p.provider.write(R, 't.md', 'one', { ifAbsent: true });
      p.replace('t.md', 'other');
      await p.provider.write(R, 't.md', 'mine', {
        ifMatch: first.ok ? first.file.version! : '',
      });
      expect(readdirSync(h.root).filter((n) => n.startsWith('.'))).toEqual([]);
    });
  });
}

// ---- Vault M6 (CTO K2, K3, K6; R3) -----------------------------------------
// Rows run for every enrolled provider that declares the member, so a held
// branch enrolls itself by adding it. The desktop folder declares them all
// through its transport; its rows run once main's folderFs functions exist
// (stream B), and are skipped in a tree without them, never loosened.
const { bridge: testBridge } = await import('../src/lib/electronBridge.js');
const mainHas = (call: string) =>
  typeof (testBridge() as unknown as Record<string, unknown>)?.[call] === 'function';
const m6Ready = (name: string, calls: string[]) =>
  name !== 'This folder (desktop)' || calls.every(mainHas);

const listedPaths = async (p: StorageProvider) => (await p.list(R)).map((f) => f.path).sort();
const versionOfWrite = (r: { ok: boolean; file?: { version?: string } }) =>
  r.ok ? r.file!.version! : '';

for (const p of enforcing) {
  const renames = typeof p.provider.rename === 'function' && m6Ready(p.name, ['vaultRename']);
  describe.skipIf(!renames)(`rename contract (M6): ${p.name}`, () => {
    it('moves the note, never the text, and answers the version at the new name', async () => {
      const w = await p.provider.write(R, 'Plans.md', 'the plan', { ifAbsent: true });
      const r = await p.provider.rename!(R, 'Plans.md', 'Work/Q4/Plans.md', {
        ifMatch: versionOfWrite(w),
      });
      expect(r).toMatchObject({ ok: true, file: { path: 'Work/Q4/Plans.md' } });
      expect(p.bytes('Work/Q4/Plans.md')).toBe('the plan');
      expect(p.bytes('Plans.md')).toBeUndefined();
      expect(await listedPaths(p.provider)).toEqual(['Work/Q4/Plans.md']);
      // The store adopts the version the rename answered; stat agrees on it.
      const at = await p.provider.stat(R, 'Work/Q4/Plans.md');
      expect(r.ok && r.file.version).toBe(at?.version);
      const next = await p.provider.write(R, 'Work/Q4/Plans.md', 'more', {
        ifMatch: r.ok ? r.file.version! : '',
      });
      expect(next.ok).toBe(true);
    });

    it('a stale ifMatch is changed with theirs, and nothing moves', async () => {
      const w = await p.provider.write(R, 'a.md', 'one', { ifAbsent: true });
      p.replace('a.md', 'someone else wrote this');
      const r = await p.provider.rename!(R, 'a.md', 'b.md', { ifMatch: versionOfWrite(w) });
      expect(r).toMatchObject({ ok: false, conflict: 'changed' });
      expect(!r.ok && r.theirs?.text).toBe('someone else wrote this');
      expect(p.bytes('a.md')).toBe('someone else wrote this');
      expect(p.bytes('b.md')).toBeUndefined();
    });

    it('a source that is gone is missing, and nothing is made', async () => {
      const w = await p.provider.write(R, 'gone.md', 'here', { ifAbsent: true });
      p.remove('gone.md');
      const r = await p.provider.rename!(R, 'gone.md', 'new.md', { ifMatch: versionOfWrite(w) });
      expect(r).toMatchObject({ ok: false, conflict: 'missing' });
      expect(p.bytes('new.md')).toBeUndefined();
    });

    it('never replaces: a taken name is exists with theirs, and both stay', async () => {
      const w = await p.provider.write(R, 'mine.md', 'mine', { ifAbsent: true });
      p.replace('taken.md', 'already here');
      const r = await p.provider.rename!(R, 'mine.md', 'taken.md', {
        ifMatch: versionOfWrite(w),
      });
      expect(r).toMatchObject({ ok: false, conflict: 'exists' });
      expect(!r.ok && r.theirs?.text).toBe('already here');
      expect(p.bytes('mine.md')).toBe('mine');
      expect(p.bytes('taken.md')).toBe('already here');
    });

    it('a name taken in another case is taken too (folded)', async () => {
      const w = await p.provider.write(R, 'mine.md', 'mine', { ifAbsent: true });
      p.replace('Taken.md', 'already here');
      const r = await p.provider.rename!(R, 'mine.md', 'taken.md', {
        ifMatch: versionOfWrite(w),
      });
      expect(r).toMatchObject({ ok: false, conflict: 'exists' });
      expect(p.bytes('mine.md')).toBe('mine');
    });

    it('folds Unicode normalization like case, and keeps accents distinct (one foldPath)', async () => {
      const w = await p.provider.write(R, 'mine.md', 'mine', { ifAbsent: true });
      // A name another app wrote decomposed (the macOS habit) is the same
      // name as its composed spelling.
      p.replace('cafe\u0301.md', 'accented');
      const nfc = await p.provider.rename!(R, 'mine.md', 'caf\u00e9.md', {
        ifMatch: versionOfWrite(w),
      });
      expect(nfc).toMatchObject({ ok: false, conflict: 'exists' });
      // The same letters without the accent are another name.
      const plain = await p.provider.rename!(R, 'mine.md', 'cafe.md', {
        ifMatch: versionOfWrite(w),
      });
      expect(plain).toMatchObject({ ok: true, file: { path: 'cafe.md' } });
      expect(p.bytes('cafe\u0301.md')).toBe('accented');
    });

    it('a case-only rename of the same note is allowed', async () => {
      const w = await p.provider.write(R, 'plans.md', 'body', { ifAbsent: true });
      const r = await p.provider.rename!(R, 'plans.md', 'Plans.md', {
        ifMatch: versionOfWrite(w),
      });
      expect(r).toMatchObject({ ok: true, file: { path: 'Plans.md' } });
      expect(await listedPaths(p.provider)).toEqual(['Plans.md']);
      expect((await p.provider.read(R, 'Plans.md'))?.text).toBe('body');
    });

    it('refuses a name that is not a note, before the storage sees it', async () => {
      const w = await p.provider.write(R, 'n.md', 'body', { ifAbsent: true });
      await expect(
        p.provider.rename!(R, 'n.md', '.trash/n.md', { ifMatch: versionOfWrite(w) }),
      ).rejects.toThrow();
      expect(p.bytes('n.md')).toBe('body');
    });
  });

  const trashes =
    typeof p.provider.trash === 'function' &&
    typeof p.provider.listTrash === 'function' &&
    typeof p.provider.restore === 'function' &&
    m6Ready(p.name, ['vaultTrash', 'vaultTrashList', 'vaultTrashRestore', 'vaultTrashEmpty']);
  describe.skipIf(!trashes)(`Trash contract (M6): ${p.name}`, () => {
    it('a note goes to Trash under its guard, out of the list, and back the same', async () => {
      const w = await p.provider.write(R, 'Ideas/x.md', 'body', { ifAbsent: true });
      const t = await p.provider.trash!(R, {
        kind: 'note',
        path: 'Ideas/x.md',
        ifMatch: versionOfWrite(w),
      });
      expect(t).toMatchObject({
        ok: true,
        notes: 1,
        entry: { kind: 'note', path: 'Ideas/x.md' },
      });
      expect(p.bytes('Ideas/x.md')).toBeUndefined();
      expect(await listedPaths(p.provider)).toEqual([]);
      const entries = await p.provider.listTrash!(R);
      expect(entries.map((e) => e.path)).toEqual(['Ideas/x.md']);
      const back = await p.provider.restore!(R, entries[0]!.id);
      expect(back).toMatchObject({ ok: true, renamed: false, file: { path: 'Ideas/x.md' } });
      expect(p.bytes('Ideas/x.md')).toBe('body');
      expect(back.ok && back.file.version).toBe((await p.provider.stat(R, 'Ideas/x.md'))?.version);
      expect(await p.provider.listTrash!(R)).toEqual([]);
    });

    it('a stale ifMatch is changed with theirs, and the note stays', async () => {
      const w = await p.provider.write(R, 'r.md', 'one', { ifAbsent: true });
      p.replace('r.md', 'someone else wrote this');
      const t = await p.provider.trash!(R, {
        kind: 'note',
        path: 'r.md',
        ifMatch: versionOfWrite(w),
      });
      expect(t).toMatchObject({ ok: false, conflict: 'changed' });
      expect(!t.ok && t.theirs?.text).toBe('someone else wrote this');
      expect(p.bytes('r.md')).toBe('someone else wrote this');
      expect(await p.provider.listTrash!(R)).toEqual([]);
    });

    it('restore never overwrites: a taken name comes back as "{title} (restored)"', async () => {
      const w = await p.provider.write(R, 'Plans.md', 'old plans', { ifAbsent: true });
      const t = await p.provider.trash!(R, {
        kind: 'note',
        path: 'Plans.md',
        ifMatch: versionOfWrite(w),
      });
      await p.provider.write(R, 'Plans.md', 'new plans', { ifAbsent: true });
      const back = await p.provider.restore!(R, t.ok ? t.entry.id : '');
      expect(back).toMatchObject({
        ok: true,
        renamed: true,
        file: { path: 'Plans (restored).md' },
      });
      expect(p.bytes('Plans.md')).toBe('new plans');
      expect(p.bytes('Plans (restored).md')).toBe('old plans');
    });

    it('a folder goes to Trash as it is, with its count, and comes back', async () => {
      await p.provider.write(R, 'Work/a.md', 'a', { ifAbsent: true });
      await p.provider.write(R, 'Work/Deep/b.md', 'b', { ifAbsent: true });
      await p.provider.write(R, 'Other.md', 'o', { ifAbsent: true });
      const t = await p.provider.trash!(R, { kind: 'folder', path: 'Work' });
      expect(t).toMatchObject({ ok: true, notes: 2, entry: { kind: 'folder', path: 'Work' } });
      expect(await listedPaths(p.provider)).toEqual(['Other.md']);
      const back = await p.provider.restore!(R, t.ok ? t.entry.id : '');
      expect(back).toMatchObject({ ok: true, renamed: false });
      expect(await listedPaths(p.provider)).toEqual(['Other.md', 'Work/Deep/b.md', 'Work/a.md']);
    });

    it('an unknown entry is missing', async () => {
      expect(await p.provider.restore!(R, 'no-such-entry')).toEqual({
        ok: false,
        conflict: 'missing',
      });
    });

    it('Trash never lists as notes, and Empty Trash deletes for good', async () => {
      const ids: string[] = [];
      for (const path of ['a.md', 'b.md']) {
        const w = await p.provider.write(R, path, path, { ifAbsent: true });
        const t = await p.provider.trash!(R, { kind: 'note', path, ifMatch: versionOfWrite(w) });
        ids.push(t.ok ? t.entry.id : '');
      }
      expect(await listedPaths(p.provider)).toEqual([]);
      if (!p.provider.emptyTrash) return;
      expect(await p.provider.emptyTrash(R, [ids[0]!])).toEqual({ removed: 1 });
      expect((await p.provider.listTrash!(R)).map((e) => e.id)).toEqual([ids[1]]);
      expect(await p.provider.emptyTrash(R)).toEqual({ removed: 1 });
      expect(await p.provider.listTrash!(R)).toEqual([]);
      expect(await p.provider.restore!(R, ids[1]!)).toEqual({ ok: false, conflict: 'missing' });
    });
  });
}

// ---- Vault M7 (CTO L7, L16): writeConfig, the settings sheet's write ------
// Every provider with writeConfig holds the note write's contract on the
// vault's own settings file: ifAbsent never replaces, a stale ifMatch is
// `changed` with theirs (the file there now, as readConfig reads it) and
// leaves the bytes, an ifMatch on a file gone is `missing` and makes nothing,
// and a write's version is the one readConfig and the next ifMatch accept.
// Every `obsidian/*` name is refused before anything is written.

const settingsRows: Array<{
  name: string;
  provider: StorageProvider;
  bytes: () => string | undefined;
  replace: (text: string) => void;
  remove: () => void;
  obsidianUntouched: () => boolean;
}> = [
  {
    name: 'This folder (desktop)',
    provider: deviceFolderProvider,
    bytes: () => {
      try {
        return readFileSync(join(h.root, '.oscode', 'vault.json'), 'utf8');
      } catch {
        return undefined;
      }
    },
    // Another writer (a hand edit, a sync): a temp file renamed over it.
    replace: (t) => {
      mkdirSync(join(h.root, '.oscode'), { recursive: true });
      const tmp = join(h.root, '.oscode', '.other');
      writeFileSync(tmp, t);
      renameSync(tmp, join(h.root, '.oscode', 'vault.json'));
    },
    remove: () => rmSync(join(h.root, '.oscode', 'vault.json')),
    obsidianUntouched: () => !existsSync(join(h.root, '.obsidian')),
  },
  {
    name: 'This device',
    provider: localProvider,
    bytes: () => {
      const raw = h.store.get(`oscode.gitos.config.${R}.vault`);
      return raw ? (JSON.parse(raw) as { text: string }).text : undefined;
    },
    replace: (t) =>
      h.store.set(
        `oscode.gitos.config.${R}.vault`,
        JSON.stringify({ text: t, updatedAt: new Date().toISOString(), v: `other-${t}` }),
      ),
    remove: () => h.store.delete(`oscode.gitos.config.${R}.vault`),
    obsidianUntouched: () => [...h.store.keys()].every((k) => !/obsidian/.test(k)),
  },
  {
    name: 'Your computer (the hub)',
    provider: hubProvider,
    bytes: () => hub.config.get('oscode/vault'),
    replace: (t) => hub.replaceConfig('oscode/vault', t),
    remove: () => {
      hub.config.delete('oscode/vault');
      hub.configVersions.delete('oscode/vault');
    },
    obsidianUntouched: () => [...hub.config.keys()].every((k) => !k.startsWith('obsidian/')),
  },
];

const V1 = '{\n  "version": 1\n}\n';
const V2 = '{\n  "version": 1,\n  "delete": "permanent"\n}\n';

for (const p of settingsRows) {
  describe(`writeConfig contract: ${p.name}`, () => {
    const write = (text: string, guard: { ifMatch: string } | { ifAbsent: true }) =>
      p.provider.writeConfig!(R, 'oscode/vault', text, guard);

    it('declares writeConfig beside compareAndSwap', () => {
      expect(typeof p.provider.writeConfig).toBe('function');
      expect(p.provider.compareAndSwap).toBe(true);
    });

    it('ifAbsent makes the file, and readConfig reads the same text and version', async () => {
      const r = await write(V1, { ifAbsent: true });
      expect(r).toMatchObject({ ok: true, file: { path: '.oscode/vault.json', text: V1 } });
      expect(p.bytes()).toBe(V1);
      const read = await p.provider.readConfig!(R, 'oscode/vault');
      expect(read).toEqual({ ok: true, text: V1, version: r.ok ? r.file.version : '' });
    });

    it("a write's version is accepted by the next ifMatch, and each write is a new one", async () => {
      const first = await write(V1, { ifAbsent: true });
      const v1 = first.ok ? first.file.version! : '';
      const second = await write(V2, { ifMatch: v1 });
      expect(second).toMatchObject({ ok: true, file: { text: V2 } });
      const v2 = second.ok ? second.file.version! : '';
      expect(v2).toBeTruthy();
      expect(v2).not.toBe(v1);
      expect((await write(V1, { ifMatch: v2 })).ok).toBe(true);
      expect(p.bytes()).toBe(V1);
    });

    it('a stale ifMatch is changed with theirs, and leaves their bytes', async () => {
      const first = await write(V1, { ifAbsent: true });
      p.replace('{"version":1,"tree":{"sort":"modified"}}');
      const r = await write(V2, { ifMatch: first.ok ? first.file.version! : '' });
      expect(r).toMatchObject({ ok: false, conflict: 'changed' });
      expect(!r.ok && r.theirs?.text).toBe('{"version":1,"tree":{"sort":"modified"}}');
      // Theirs carries the version the re-read gives, so one re-apply lands.
      const now = await p.provider.readConfig!(R, 'oscode/vault');
      expect(!r.ok && r.theirs?.version).toBe(now.ok ? now.version : 'no');
      expect(p.bytes()).toBe('{"version":1,"tree":{"sort":"modified"}}');
      const again = await write(V2, { ifMatch: !r.ok ? r.theirs!.version! : '' });
      expect(again.ok).toBe(true);
    });

    it('ifAbsent on a file there is exists with theirs, and never replaces', async () => {
      p.replace('{"version":1}');
      const r = await write(V1, { ifAbsent: true });
      expect(r).toMatchObject({ ok: false, conflict: 'exists' });
      expect(!r.ok && r.theirs?.text).toBe('{"version":1}');
      expect(p.bytes()).toBe('{"version":1}');
    });

    it('ifMatch on a file gone is missing, and makes nothing', async () => {
      const first = await write(V1, { ifAbsent: true });
      p.remove();
      const r = await write(V2, { ifMatch: first.ok ? first.file.version! : '' });
      expect(r).toEqual({ ok: false, conflict: 'missing' });
      expect(p.bytes()).toBeUndefined();
    });

    it('refuses every obsidian/* name before anything is written', async () => {
      for (const name of ['obsidian/app', 'obsidian/daily-notes', 'obsidian/templates']) {
        await expect(
          p.provider.writeConfig!(R, name as 'oscode/vault', '{}', { ifAbsent: true }),
        ).rejects.toThrow();
      }
      expect(p.obsidianUntouched()).toBe(true);
      expect(p.bytes()).toBeUndefined();
    });

    it('refuses a file over 256 KB before anything is written', async () => {
      await expect(write('x'.repeat(256 * 1024 + 1), { ifAbsent: true })).rejects.toThrow(
        /over 256 KB/,
      );
      expect(p.bytes()).toBeUndefined();
    });
  });
}

describe('providers that do not enforce the guard yet (M2) return the new shape', () => {
  const shaped: Array<[string, StorageProvider]> = [['iCloud Drive', icloudProvider]];
  for (const [name, provider] of shaped) {
    it(`${name}: accepts a guard, answers { ok: true, file }, and does not claim compareAndSwap`, async () => {
      expect(provider.compareAndSwap).toBeUndefined();
      const r = await provider.write(R, 'a.md', 'body', { ifMatch: 'anything' });
      expect(r).toMatchObject({ ok: true, file: { path: 'a.md', text: 'body' } });
    });

    it(`${name}: accepts a remove guard and answers { ok: true }`, async () => {
      await provider.write(R, 'b.md', 'body');
      expect(await provider.remove(R, 'b.md', { ifMatch: 'anything' })).toEqual({ ok: true });
      expect(await provider.remove(R, 'b.md')).toEqual({ ok: true });
    });
  }
});

// The folder client's M6 half (CTO K2, K19): it declares a seam member only
// when its transport has it, so the iPhone folder lights the same rows by
// adding transport members; it checks every path on this side first; and it
// holds a transport's answer to the seam's shapes (the byte cap, the allowed
// types, well-formed listings).
describe('folder client (M6)', async () => {
  const { makeFolderProvider } = await import('../src/lib/gitos/folderClient.js');
  const { VAULT_ATTACHMENT_MAX_BYTES } = await import('os-code/protocol');
  const meta = { id: 'files' as const, label: 'Test folder', blurb: '', ready: true };
  const base = {
    list: async () => [],
    stat: async () => null,
    read: async () => null,
    write: async () => ({ ok: false as const, conflict: 'missing' as const }),
    remove: async () => ({ ok: true as const }),
  };
  const M6 = [
    'rename',
    'listFolders',
    'createFolder',
    'renameFolder',
    'trash',
    'listTrash',
    'restore',
    'emptyTrash',
    'listAttachments',
    'readBytes',
  ] as const;

  it('a transport without the M6 members declares none of them', () => {
    const p = makeFolderProvider(base, meta);
    for (const m of M6) expect(p[m], m).toBeUndefined();
  });

  it('a transport with them declares each one', () => {
    const t = Object.fromEntries(M6.map((m) => [m, async () => undefined]));
    const p = makeFolderProvider({ ...base, ...t }, meta);
    for (const m of M6) expect(typeof p[m], m).toBe('function');
  });

  it('checks paths before the transport sees them', async () => {
    const seen: string[] = [];
    const spy =
      (name: string) =>
      async (...args: unknown[]) => {
        seen.push(`${name} ${JSON.stringify(args)}`);
        return undefined as never;
      };
    const p = makeFolderProvider(
      {
        ...base,
        rename: spy('rename'),
        createFolder: spy('createFolder'),
        renameFolder: spy('renameFolder'),
        trash: spy('trash'),
        readBytes: spy('readBytes'),
      },
      meta,
    );
    await expect(p.rename!(R, 'a.md', '.trash/a.md', { ifMatch: 'v' })).rejects.toThrow();
    await expect(p.rename!(R, 'img.png', 'b.md', { ifMatch: 'v' })).rejects.toThrow();
    await expect(p.createFolder!(R, '.obsidian')).rejects.toThrow(/not a folder/);
    await expect(p.createFolder!(R, '/abs')).rejects.toThrow(/not a folder/);
    await expect(p.renameFolder!(R, 'Work', 'Work/Sub')).rejects.toThrow(/inside itself/);
    await expect(p.renameFolder!(R, 'Work', 'Work')).rejects.toThrow(/inside itself/);
    await expect(p.trash!(R, { kind: 'folder', path: '' })).rejects.toThrow(/not a folder/);
    await expect(p.trash!(R, { kind: 'note', path: 'x.png', ifMatch: 'v' })).rejects.toThrow();
    await expect(p.readBytes!(R, 'notes.md')).rejects.toThrow(/not an image/);
    await expect(p.readBytes!(R, '.trash/x.png')).rejects.toThrow(/not an image/);
    expect(seen).toEqual([]);
    // A folder rename whose name only starts the same is not into itself.
    await p.renameFolder!(R, 'Work', 'Workshop');
    expect(seen).toEqual(['renameFolder ["Work","Workshop"]']);
  });

  it('holds bytes to the cap, the allowed types, and a plain view', async () => {
    const asked: Array<number | undefined> = [];
    let answer: unknown;
    const p = makeFolderProvider(
      {
        ...base,
        readBytes: async (_path, opts) => {
          asked.push(opts?.max);
          return answer as never;
        },
      },
      meta,
    );
    answer = { ok: true, bytes: Buffer.from([1, 2, 3]), mime: 'image/png', version: 'v1' };
    const r = await p.readBytes!(R, 'a.png', { max: 10 ** 12 });
    expect(asked).toEqual([VAULT_ATTACHMENT_MAX_BYTES]);
    expect(r.ok && Object.getPrototypeOf(r.bytes)).toBe(Uint8Array.prototype);
    expect(await p.readBytes!(R, 'a.png', { max: 2 })).toEqual({ ok: false, reason: 'too-large' });
    answer = { ok: true, bytes: new Uint8Array([1]), mime: 'text/html', version: 'v1' };
    expect(await p.readBytes!(R, 'a.png')).toEqual({ ok: false, reason: 'unsupported' });
    answer = { ok: false, reason: 'downloading' };
    expect(await p.readBytes!(R, 'a.png')).toEqual({ ok: false, reason: 'downloading' });
    answer = { ok: false, reason: 'something else' };
    expect(await p.readBytes!(R, 'a.png')).toEqual({ ok: false, reason: 'refused' });
  });

  it('keeps only well-formed rows in the listings', async () => {
    const good = {
      path: 'Media/a.png',
      size: 3,
      updatedAt: '2026-09-27T00:00:00.000Z',
      version: 'v',
      mime: 'image/png',
    };
    const p = makeFolderProvider(
      {
        ...base,
        listAttachments: async () =>
          [
            good,
            { ...good, path: '.trash/a.png' },
            { ...good, path: 'Notes.md' },
            { ...good, mime: 'text/html' },
            { ...good, size: '3' },
          ] as never,
        listFolders: async () => ['Work', '.trash', 'Work/.git', 'Work/Deep', ''],
      },
      meta,
    );
    expect(await p.listAttachments!(R)).toEqual([good]);
    expect(await p.listFolders!(R)).toEqual(['Work', 'Work/Deep']);
  });
});

describe('the desktop folder without main M6 calls', () => {
  // Only in a tree whose main does not answer them yet (stream B lands them).
  it.skipIf(mainHas('vaultRename'))('says to update rather than failing silently', async () => {
    const { VAULT_CAP_UPDATE_LINE } = await import('../src/lib/vaultCopy.js');
    writeFileSync(join(h.root, 'a.md'), 'a');
    await expect(deviceFolderProvider.rename!(R, 'a.md', 'b.md', { ifMatch: 'v' })).rejects.toThrow(
      VAULT_CAP_UPDATE_LINE,
    );
    expect(readFileSync(join(h.root, 'a.md'), 'utf8')).toBe('a');
  });
});
