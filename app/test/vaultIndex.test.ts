// The app's Vault index host (Vault M3, tech review H3 and H6): the pure core's index,
// fed by provider reads the host schedules. What these rows hold: a 5,000-note
// vault answers warm backlinks in under 100 ms; updating one note touches one
// entry; opening a note reads no other note; Linked mentions read only the
// linking notes (the first 50, four at a time, through the caller's body
// cache when there is one); a reconcile reads only what changed; and the
// index is kept where the ruling says (the desktop folder's file through
// main, every iPhone vault sealed in Caches, the rest in memory), keyed so no
// two vaults, roots or accounts share one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vaultCorpus } from '../../os-code/test/fixtures/vaultCorpus.js';

const h = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    where: { current: 'web' as 'web' | 'electron' | 'ios' },
    bridge: { current: undefined as Record<string, unknown> | undefined },
    files,
    sealable: { current: true },
  };
});

vi.mock('../src/lib/platform.js', () => ({
  platform: () => h.where.current,
  sealBlob: async (text: string) => (h.sealable.current ? `sealed:${text}` : null),
  openBlob: async (blob: string) =>
    h.sealable.current && blob.startsWith('sealed:') ? blob.slice('sealed:'.length) : null,
}));
vi.mock('../src/lib/electronBridge.js', () => ({ bridge: () => h.bridge.current }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }: { path: string }) => {
      const data = h.files.get(path);
      if (data === undefined) throw new Error('File does not exist');
      return { data };
    },
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      h.files.set(path, data);
      return { uri: path };
    },
    rename: async ({ from, to }: { from: string; to: string }) => {
      const data = h.files.get(from);
      if (data === undefined) throw new Error('File does not exist');
      h.files.delete(from);
      h.files.set(to, data);
    },
    deleteFile: async ({ path }: { path: string }) => {
      h.files.delete(path);
    },
  },
}));

import { INDEX_PROGRESS_SHOW_AFTER_MS } from 'os-code/protocol';
import {
  MENTIONS_MAX,
  PHONE_INDEX_DIR,
  VaultIndexHost,
  closeVaultIndex,
  dropVaultIndex,
  indexStoreFor,
  memoryIndexStore,
  setVaultIndexRootKey,
  vaultIndexFor,
  vaultIndexKey,
  vaultIndexLine,
  vaultIndexStatus,
  type VaultIndexStore,
} from '../src/lib/vaultIndexHost.js';
import type { StoredFile, StoredFileMeta } from '../src/lib/gitos/providers.js';

/** A vault in memory whose reads are counted, with how many ran at once. */
function fakeVault(notes: Array<{ path: string; text: string; version?: string }>) {
  const byPath = new Map<string, { text: string; version: string; evicted?: boolean }>();
  let v = 0;
  for (const n of notes) byPath.set(n.path, { text: n.text, version: n.version ?? `v${++v}` });
  const reads: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const reader = {
    async read(_r: string, path: string): Promise<StoredFile | undefined> {
      reads.push(path);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      const f = byPath.get(path);
      if (!f || f.evicted) return undefined;
      return { path, text: f.text, updatedAt: '2026-09-27T00:00:00.000Z', version: f.version };
    },
    async stat(_r: string, path: string): Promise<StoredFileMeta | undefined> {
      const f = byPath.get(path);
      return f ? metaOf(path, f) : undefined;
    },
  };
  function metaOf(path: string, f: { text: string; version: string; evicted?: boolean }) {
    return {
      path,
      updatedAt: '2026-09-27T00:00:00.000Z',
      size: f.text.length,
      version: f.version,
      ...(f.evicted ? { evicted: true } : {}),
    };
  }
  return {
    byPath,
    reader,
    reads,
    get maxInFlight() {
      return maxInFlight;
    },
    listing(): StoredFileMeta[] {
      return [...byPath].map(([path, f]) => metaOf(path, f));
    },
    set(path: string, text: string) {
      byPath.set(path, { text, version: `v${++v}` });
    },
    file(path: string): StoredFile {
      const f = byPath.get(path)!;
      return { path, text: f.text, updatedAt: '2026-09-27T00:00:00.000Z', version: f.version };
    },
  };
}

const target = { providerId: 'local' as const, resourceId: 'vault' };
const fast = { yieldNow: async () => {}, publish: false, store: memoryIndexStore() };

beforeEach(() => {
  h.where.current = 'web';
  h.bridge.current = undefined;
  h.files.clear();
  h.sealable.current = true;
  setVaultIndexRootKey(undefined);
});
afterEach(async () => {
  await closeVaultIndex();
});

describe('a 5,000-note vault (the seeded corpus)', () => {
  it('builds once, reads each note once, and answers warm backlinks in under 100 ms', async () => {
    const corpus = vaultCorpus();
    expect(corpus.length).toBe(5000);
    const vault = fakeVault(corpus);
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    expect(host.index.size).toBe(5000);
    expect(vault.reads.length).toBe(5000);

    // Warm: every query after the build is a lookup, not a scan.
    const probe = corpus.slice(0, 50).map((n) => n.path);
    const times: number[] = [];
    let linked = 0;
    for (const p of probe) {
      const t0 = performance.now();
      linked += host.backlinks(p).length;
      times.push(performance.now() - t0);
    }
    expect(linked).toBeGreaterThan(0);
    expect(Math.max(...times)).toBeLessThan(100);

    // A second reconcile against the same listing reads nothing.
    await host.reconcile(vault.listing());
    expect(vault.reads.length).toBe(5000);
  }, 60_000);
});

describe('updates stay local', () => {
  const small = () =>
    fakeVault([
      { path: 'Hub.md', text: '# Hub' },
      { path: 'A.md', text: 'see [[Hub]]' },
      { path: 'B.md', text: 'see [[Hub]] and [[A]]' },
      { path: 'C.md', text: 'nothing here' },
    ]);

  it('updating one note touches one entry, and reads nothing', async () => {
    const vault = small();
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    host.backlinks('Hub.md');
    const before = { ...host.index.counters };
    const reads = vault.reads.length;
    vault.set('C.md', 'now links [[Hub]]');
    host.applyWrite(vault.file('C.md'));
    expect(host.backlinks('Hub.md').map((b) => b.source)).toEqual(['A.md', 'B.md', 'C.md']);
    expect(host.index.counters.entriesBuilt - before.entriesBuilt).toBe(1);
    expect(host.index.counters.sourcesResolved - before.sourcesResolved).toBe(1);
    expect(host.index.counters.pathIndexBuilds - before.pathIndexBuilds).toBe(0);
    expect(vault.reads.length).toBe(reads);
  });

  it('opening a note reads no other note, and an unchanged one is not rebuilt', async () => {
    const vault = small();
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    const reads = vault.reads.length;
    const built = host.index.counters.entriesBuilt;
    // The open read the note itself (the store's read); the index takes it.
    host.noteRead(vault.file('A.md'));
    expect(host.index.counters.entriesBuilt).toBe(built);
    vault.set('A.md', 'see [[Hub]] again');
    host.noteRead(vault.file('A.md'));
    expect(host.index.counters.entriesBuilt).toBe(built + 1);
    host.backlinks('A.md');
    expect(vault.reads.length).toBe(reads);
  });

  it('a remove drops the note and its links', async () => {
    const vault = small();
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    host.applyRemove('A.md');
    expect(host.backlinks('Hub.md').map((b) => b.source)).toEqual(['B.md']);
    expect(host.index.has('A.md')).toBe(false);
  });

  it('a reconcile reads only notes whose version moved, drops what is gone, and never reads a placeholder', async () => {
    const vault = small();
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    vault.reads.length = 0;
    vault.set('B.md', 'see [[C]]');
    vault.byPath.delete('A.md');
    vault.byPath.set('Far.md', { text: 'not here yet', version: '', evicted: true });
    await host.reconcile(vault.listing());
    expect(vault.reads).toEqual(['B.md']);
    expect(host.index.has('A.md')).toBe(false);
    expect(host.index.entry('Far.md')?.evicted).toBe(true);
    expect(host.backlinks('Hub.md')).toEqual([]);
    expect(host.backlinks('C.md').map((b) => b.source)).toEqual(['B.md']);
  });

  it('a write during a reconcile is never overwritten by an older read', async () => {
    const vault = small();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = {
      ...vault.reader,
      async read(r: string, path: string) {
        const f = await vault.reader.read(r, path);
        if (path === 'C.md') await gate;
        return f;
      },
    };
    const host = new VaultIndexHost(target, slow, fast);
    const pass = host.reconcile(vault.listing());
    await new Promise((r) => setTimeout(r, 0));
    vault.set('C.md', 'typed here: [[Hub]]');
    host.applyWrite(vault.file('C.md'));
    release();
    await pass;
    expect(host.index.entry('C.md')?.version).toBe(vault.file('C.md').version);
    expect(host.backlinks('Hub.md').map((b) => b.source)).toContain('C.md');
  });

  it('the watcher stats each path and reads only on a change', async () => {
    const vault = small();
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    vault.reads.length = 0;
    vault.set('C.md', '[[A]]');
    await host.watched({ paths: ['A.md', 'C.md', 'Gone.md'], tree: false }, async () =>
      vault.listing(),
    );
    expect(vault.reads).toEqual(['C.md']);
    expect(host.backlinks('A.md').map((b) => b.source)).toEqual(['B.md', 'C.md']);
  });
});

describe('Linked mentions', () => {
  const hub = () => {
    const notes = [{ path: 'Hub.md', text: '# Hub' }];
    for (let i = 0; i < 60; i++) {
      notes.push({
        path: `n/${String(i).padStart(2, '0')}.md`,
        text: `Line one\nnote ${i} points at [[Hub]] here`,
      });
    }
    for (let i = 0; i < 20; i++) notes.push({ path: `x/${i}.md`, text: 'unrelated' });
    return fakeVault(notes);
  };

  it('reads only the linking notes, the first 50, four at a time', async () => {
    const vault = hub();
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    vault.reads.length = 0;
    const r = await host.linkedMentions('Hub.md');
    expect(r.mentions.length).toBe(MENTIONS_MAX);
    expect(r.more).toBe(10);
    expect(vault.reads.length).toBe(MENTIONS_MAX);
    expect(vault.reads.every((p) => p.startsWith('n/'))).toBe(true);
    expect(vault.maxInFlight).toBeLessThanOrEqual(4);
    expect(r.mentions[0]!.path).toBe('n/00.md');
    expect(r.mentions[0]!.excerpt).toContain('[[Hub]]');
  });

  it('goes through the caller body cache, so a cached body is not read again', async () => {
    const vault = hub();
    const host = new VaultIndexHost(target, vault.reader, fast);
    await host.reconcile(vault.listing());
    vault.reads.length = 0;
    const cache = new Map(vault.listing().map((m) => [m.path, vault.file(m.path).text]));
    const asked: string[] = [];
    const r = await host.linkedMentions('Hub.md', async (p) => {
      asked.push(p);
      return cache.get(p);
    });
    expect(vault.reads).toEqual([]);
    expect(asked.length).toBe(MENTIONS_MAX);
    expect(r.failed).toEqual([]);
  });
});

describe('where the index is kept', () => {
  it('memory only off the desktop folder and the phone', async () => {
    expect(indexStoreFor(target, 'k').kind).toBe('memory');
    h.where.current = 'electron';
    h.bridge.current = { vaultList: async () => [] };
    expect(indexStoreFor(target, 'k').kind).toBe('memory');
    expect(indexStoreFor({ providerId: 'org', resourceId: 'o', owner: 'u' }, 'k').kind).toBe(
      'memory',
    );
    // The desktop folder, on a main without the index IPCs yet: memory.
    expect(indexStoreFor({ providerId: 'files', resourceId: 'vault' }, 'k').kind).toBe('memory');
  });

  it('the desktop folder saves through main, sending only the blob', async () => {
    h.where.current = 'electron';
    const saved: unknown[][] = [];
    let kept: string | null = null;
    h.bridge.current = {
      vaultList: async () => [],
      vaultIndexLoad: async (...args: unknown[]) => {
        expect(args).toEqual([]);
        return kept;
      },
      vaultIndexSave: async (...args: unknown[]) => {
        saved.push(args);
        kept = args[0] as string;
        return { ok: true, bytes: kept.length };
      },
    };
    const files = { providerId: 'files' as const, resourceId: 'vault' };
    expect(indexStoreFor(files, 'k').kind).toBe('desktop-file');
    const vault = fakeVault([
      { path: 'A.md', text: '[[B]]' },
      { path: 'B.md', text: 'b' },
    ]);
    const host = new VaultIndexHost(files, vault.reader, {
      yieldNow: async () => {},
      publish: false,
    });
    await host.reconcile(vault.listing());
    expect(saved.length).toBe(1);
    expect(saved[0]!.length).toBe(1);
    expect(typeof saved[0]![0]).toBe('string');
    await host.close();

    // The next launch loads it and reads nothing that did not change.
    vault.reads.length = 0;
    const again = new VaultIndexHost(files, vault.reader, {
      yieldNow: async () => {},
      publish: false,
    });
    await again.reconcile(vault.listing());
    expect(vault.reads).toEqual([]);
    expect(again.backlinks('B.md').map((b) => b.source)).toEqual(['A.md']);
  });

  it('every iPhone vault is sealed into Caches, never written in the clear', async () => {
    h.where.current = 'ios';
    const team = { providerId: 'org' as const, resourceId: 'org-1', owner: 'user-1' };
    const vault = fakeVault([{ path: 'A.md', text: 'secret words [[B]]' }]);
    const host = new VaultIndexHost(team, vault.reader, {
      yieldNow: async () => {},
      publish: false,
    });
    await host.reconcile(vault.listing());
    const key = await vaultIndexKey(team);
    const blob = h.files.get(`${PHONE_INDEX_DIR}/${key}`);
    expect(blob?.startsWith('sealed:')).toBe(true);
    expect([...h.files.keys()]).toEqual([`${PHONE_INDEX_DIR}/${key}`]);
    await host.close();

    // A key that cannot seal right now keeps the index in memory only.
    h.files.clear();
    h.sealable.current = false;
    const locked = new VaultIndexHost(team, vault.reader, {
      yieldNow: async () => {},
      publish: false,
    });
    await locked.reconcile(vault.listing());
    expect(h.files.size).toBe(0);
    await locked.close();
  });

  it('sign-out drops the team index where it was kept', async () => {
    h.where.current = 'ios';
    const team = { providerId: 'org' as const, resourceId: 'org-1', owner: 'user-1' };
    const vault = fakeVault([{ path: 'A.md', text: 'a' }]);
    const host = vaultIndexFor(team, vault.reader, { yieldNow: async () => {}, publish: false });
    await host.reconcile(vault.listing());
    expect(h.files.size).toBe(1);
    await dropVaultIndex(team);
    expect(h.files.size).toBe(0);
    // Not on screen: still forgotten.
    const other = new VaultIndexHost({ ...team, owner: 'user-2' }, vault.reader, {
      yieldNow: async () => {},
      publish: false,
    });
    await other.reconcile(vault.listing());
    await other.close();
    expect(h.files.size).toBe(1);
    await dropVaultIndex({ ...team, owner: 'user-2' });
    expect(h.files.size).toBe(0);
  });

  it('keys differ by storage, resource, owner and root, and name no path', async () => {
    const keys = new Set([
      await vaultIndexKey({ providerId: 'local', resourceId: 'vault' }),
      await vaultIndexKey({ providerId: 'icloud', resourceId: 'vault' }),
      await vaultIndexKey({ providerId: 'local', resourceId: 'other' }),
      await vaultIndexKey({ providerId: 'org', resourceId: 'o', owner: 'a' }),
      await vaultIndexKey({ providerId: 'org', resourceId: 'o', owner: 'b' }),
      await vaultIndexKey({ providerId: 'files', resourceId: 'vault' }, 'root-1'),
      await vaultIndexKey({ providerId: 'files', resourceId: 'vault' }, 'root-2'),
    ]);
    expect(keys.size).toBe(7);
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{64}$/);
    // The rootKey hook (2.10a) feeds the key and the on-screen identity.
    setVaultIndexRootKey(() => 'picked-1');
    const vault = fakeVault([]);
    const a = vaultIndexFor({ providerId: 'files', resourceId: 'vault' }, vault.reader, fast);
    setVaultIndexRootKey(() => 'picked-2');
    const b = vaultIndexFor({ providerId: 'files', resourceId: 'vault' }, vault.reader, fast);
    expect(b).not.toBe(a);
    expect(b.rootKey).toBe('picked-2');
  });

  it('a saved index over its cap is kept without term vectors, and search reads them back', async () => {
    let kept: string | null = null;
    const tiny: VaultIndexStore = {
      kind: 'desktop-file',
      maxBytes: 1200,
      load: async () => kept,
      save: async (json) => {
        kept = json;
        return true;
      },
      remove: async () => {},
    };
    // Many distinct words, so the term vectors alone push the file over.
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const vault = fakeVault([
      { path: 'A.md', text: `${words} unicorn` },
      { path: 'B.md', text: words },
    ]);
    const host = new VaultIndexHost(target, vault.reader, { ...fast, store: tiny });
    await host.reconcile(vault.listing());
    expect(kept).toContain('"terms":"memory"');
    await host.close();
    vault.reads.length = 0;
    const again = new VaultIndexHost(target, vault.reader, { ...fast, store: tiny });
    await again.reconcile(vault.listing());
    expect(vault.reads).toEqual([]);
    const hits = await again.search('unicorn');
    expect(hits.map((x) => x.path)).toEqual(['A.md']);
    expect(vault.reads.sort()).toEqual(['A.md', 'B.md']);
  });
});

describe('progress (useSyncExternalStore, not AppState)', () => {
  it('stays hidden for the first 1.5 s of a build, then says how far it got', async () => {
    let clock = 0;
    const notes = Array.from({ length: 30 }, (_, i) => ({ path: `n${i}.md`, text: `note ${i}` }));
    const vault = fakeVault(notes);
    const seen: Array<{ visible: boolean; line?: string }> = [];
    const reader = {
      async read(r: string, path: string) {
        clock += 100;
        const s = vaultIndexStatus();
        seen.push({ visible: s.visible, line: vaultIndexLine(s) });
        return vault.reader.read(r, path);
      },
    };
    const host = new VaultIndexHost(target, reader, {
      yieldNow: async () => {},
      now: () => clock,
      concurrency: 1,
      store: memoryIndexStore(),
    });
    await host.reconcile(vault.listing());
    const firstShown = seen.findIndex((s) => s.visible);
    expect(firstShown).toBeGreaterThan(0);
    expect(seen.slice(0, firstShown).every((s) => s.line === undefined)).toBe(true);
    expect(firstShown * 100).toBeGreaterThanOrEqual(INDEX_PROGRESS_SHOW_AFTER_MS);
    expect(seen[firstShown]!.line).toMatch(/^Indexing \d+ of 30 notes$/);
    // Done: the line is gone.
    expect(vaultIndexStatus().visible).toBe(false);
    expect(vaultIndexStatus().state).toBe('ready');
  });
});
