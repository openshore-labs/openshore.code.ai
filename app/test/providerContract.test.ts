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
// Remove joined the contract in Vault M2 wave 0 (CTO G7): it answers with a
// RemoveResult, a stale ifMatch is 'changed' and leaves the file, and a file
// already gone is ok.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StorageProvider } from '../src/lib/gitos/providers.js';

const h = vi.hoisted(() => ({
  root: '',
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
  };
  return { bridge: () => b };
});

const { deviceFolderProvider } = await import('../src/lib/gitos/deviceFolder.js');
const { localProvider } = await import('../src/lib/gitos/local.js');
const { icloudProvider } = await import('../src/lib/gitos/icloud.js');

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
