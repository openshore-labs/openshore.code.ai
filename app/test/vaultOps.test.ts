// The Vault's M6 operations (state/vaultOps.ts; CTO K3 to K7, K11 with R1 to
// R3; CX X5 to X10, X13), run against an in-memory compare-and-swap storage
// and a small index, with no store. The pure plan (move.ts) and the task
// toggle (markdown.ts) belong to stream A2, so this file stands in for them
// with small fakes that keep their contracts: a plan edit per referring note,
// based on the version the plan read.
//
// What it pins:
// - a rename lands first, and a conflict there ends the flow with nothing
//   else written;
// - a referring note that changed is re-read and re-planned once, then
//   skipped and named, and the pass goes on to the notes after it (R1, the
//   plan's "a rename stops and reports", read as "stops writing that note");
// - only a storage-level failure stops the pass, and the rest are listed;
// - Update the rest re-plans from fresh reads;
// - delete then Undo restores the bytes, from Trash and, where there is no
//   Trash, from memory beside a taken name as "(restored)";
// - Today opens an existing note unchanged, with no write;
// - a task toggle is one guarded write on the open note's version.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkRewritePlan, LinkRewriteSource } from 'os-code/protocol';

vi.mock('os-code/protocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os-code/protocol')>();
  const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
  // A stand-in for stream A2's planner: every `[[Old]]` for a moved note
  // becomes `[[New]]`, one edit per source that changes, based on the
  // version the plan read, at the source's path after the moves.
  const planLinkRewrites = (
    moves: ReadonlyMap<string, string>,
    _before: unknown,
    _after: unknown,
    sources: ReadonlyArray<LinkRewriteSource>,
  ): LinkRewritePlan => {
    const edits: LinkRewritePlan['edits'] = [];
    let links = 0;
    for (const s of sources) {
      let text = s.text;
      let n = 0;
      for (const [from, to] of moves) {
        if (!/\.md$/i.test(from)) continue;
        const a = `[[${titleOf(from)}]]`;
        const b = `[[${titleOf(to)}]]`;
        if (a === b) continue;
        n += text.split(a).length - 1;
        text = text.split(a).join(b);
      }
      if (!n) continue;
      links += n;
      edits.push({ path: moves.get(s.path) ?? s.path, base: s.version, text, count: n });
    }
    return { edits, links, notes: edits.length, left: [] };
  };
  const toggleTaskAt = (text: string, at: number, expected: string) => {
    if (text[at] !== expected) return { ok: false as const, reason: 'moved' as const };
    const status = expected === ' ' ? 'x' : ' ';
    return { ok: true as const, text: text.slice(0, at) + status + text.slice(at + 1), status };
  };
  return { ...actual, planLinkRewrites, toggleTaskAt };
});

import type {
  StorageProvider,
  StoredFile,
  StoredFileMeta,
  TrashEntry,
  WriteGuard,
  WriteResult,
} from '../src/lib/gitos/providers.js';
import type { VaultIndexHost } from '../src/lib/vaultIndexHost.js';
import {
  applyMove,
  checkRenameTarget,
  createFolder,
  deleteFolder,
  deleteNote,
  emptyTrash,
  folderCounts,
  hasRealTrash,
  listTrash,
  openToday,
  prepareFolderMove,
  prepareNoteMove,
  refusalOf,
  restoreEntry,
  restoredPath,
  toggleTask,
  undoDelete,
  updateTheRest,
  type VaultOpsDeps,
  type VaultOpsOpenNote,
} from '../src/state/vaultOps.js';
import { vaultRenameToast } from '../src/lib/vaultCopy.js';

// ---- an in-memory compare-and-swap storage ---------------------------------

interface Mem {
  provider: StorageProvider;
  files: Map<string, { text: string; v: number }>;
  trash: Map<string, { path: string; files: Array<[string, { text: string; v: number }]> }>;
  writes: Array<{ path: string; guard?: WriteGuard }>;
  /** Runs before a write compares its guard: a test's "somebody else". */
  beforeWrite?: (path: string) => void;
  /** A write to this path throws: the storage is gone. */
  failOn?: string;
}

function memStorage(
  seed: Record<string, string>,
  opts: { trash?: boolean; rename?: boolean; renameFolder?: boolean } = {},
): Mem {
  let clock = 0;
  const files = new Map<string, { text: string; v: number }>();
  for (const [p, t] of Object.entries(seed)) files.set(p, { text: t, v: ++clock });
  const trash: Mem['trash'] = new Map();
  const at = '2026-09-27T12:00:00.000Z';
  const file = (path: string): StoredFile | undefined => {
    const f = files.get(path);
    return f ? { path, text: f.text, updatedAt: at, version: `v${f.v}` } : undefined;
  };
  const meta = (path: string): StoredFileMeta | undefined => {
    const f = files.get(path);
    return f ? { path, updatedAt: at, size: f.text.length, version: `v${f.v}` } : undefined;
  };
  const taken = (path: string) =>
    [...files.keys()].some((p) => p.toLowerCase() === path.toLowerCase());
  const mem: Mem = {
    files,
    trash,
    writes: [],
    provider: {
      id: 'files',
      label: 'This folder',
      blurb: '',
      ready: true,
      compareAndSwap: true,
      async list() {
        return [...files.keys()].map((p) => meta(p)!);
      },
      async stat(_r, path) {
        return meta(path);
      },
      async read(_r, path) {
        return file(path);
      },
      async write(_r, path, text, guard): Promise<WriteResult> {
        mem.writes.push({ path, guard });
        if (mem.failOn === path) throw new Error('offline');
        mem.beforeWrite?.(path);
        const cur = files.get(path);
        if (guard && 'ifAbsent' in guard && taken(path)) {
          return { ok: false, conflict: 'exists', theirs: file(path) };
        }
        if (guard && 'ifMatch' in guard) {
          if (!cur) return { ok: false, conflict: 'missing' };
          if (`v${cur.v}` !== guard.ifMatch) {
            return { ok: false, conflict: 'changed', theirs: file(path) };
          }
        }
        files.set(path, { text, v: ++clock });
        return { ok: true, file: file(path)! };
      },
      async remove(_r, path, guard) {
        const cur = files.get(path);
        if (!cur) return { ok: true };
        if (guard && `v${cur.v}` !== guard.ifMatch) {
          return { ok: false, conflict: 'changed', theirs: file(path) };
        }
        files.delete(path);
        return { ok: true };
      },
      async acquireLease(_r, holder) {
        return { holder, expiresAt: at };
      },
      async releaseLease() {},
    },
  };
  const p = mem.provider;
  if (opts.rename !== false) {
    p.rename = async (_r, from, to, guard) => {
      const cur = files.get(from);
      if (!cur) return { ok: false, conflict: 'missing' };
      if (`v${cur.v}` !== guard.ifMatch)
        return { ok: false, conflict: 'changed', theirs: file(from) };
      if (taken(to) && to.toLowerCase() !== from.toLowerCase()) {
        return { ok: false, conflict: 'exists', theirs: file(to) };
      }
      files.delete(from);
      // The version at the new path is its own (K3): never assumed equal.
      files.set(to, { text: cur.text, v: ++clock });
      return { ok: true, file: meta(to)! };
    };
  }
  if (opts.renameFolder) {
    p.renameFolder = async (_r, from, to) => {
      const moved: Array<{ from: string; to: string; version: string }> = [];
      for (const [path, f] of [...files]) {
        if (!path.startsWith(`${from}/`)) continue;
        const next = `${to}${path.slice(from.length)}`;
        files.delete(path);
        files.set(next, { text: f.text, v: ++clock });
        moved.push({ from: path, to: next, version: `v${clock}` });
      }
      return moved.length
        ? { ok: true, moved, attachments: 0 }
        : { ok: false, conflict: 'missing' };
    };
  }
  if (opts.trash) {
    let ids = 0;
    p.trash = async (_r, target) => {
      const id = `t${++ids}`;
      if (target.kind === 'note') {
        const cur = files.get(target.path);
        if (!cur) return { ok: false, conflict: 'changed' };
        if (`v${cur.v}` !== target.ifMatch) {
          return { ok: false, conflict: 'changed', theirs: file(target.path) };
        }
        files.delete(target.path);
        trash.set(id, { path: target.path, files: [[target.path, cur]] });
        return {
          ok: true,
          entry: { id, path: target.path, kind: 'note', size: cur.text.length, trashedAt: at },
          notes: 1,
          attachments: 0,
        };
      }
      const inside = [...files].filter(([path]) => path.startsWith(`${target.path}/`));
      for (const [path] of inside) files.delete(path);
      trash.set(id, { path: target.path, files: inside });
      return {
        ok: true,
        entry: { id, path: target.path, kind: 'folder', size: 0, trashedAt: at },
        notes: inside.length,
        attachments: 0,
      };
    };
    p.listTrash = async () =>
      [...trash].map(([id, t]): TrashEntry => ({
        id,
        path: t.path,
        kind: t.files.length === 1 && t.files[0]![0] === t.path ? 'note' : 'folder',
        size: 0,
        trashedAt: at,
      }));
    p.restore = async (_r, id) => {
      const t = trash.get(id);
      if (!t) return { ok: false, conflict: 'missing' };
      trash.delete(id);
      let renamed = false;
      let first: string | undefined;
      for (const [path, f] of t.files) {
        let dest = path;
        if (taken(dest)) {
          dest = restoredPath(path);
          renamed = true;
        }
        files.set(dest, f);
        first ??= dest;
      }
      return { ok: true, file: meta(first!)!, renamed };
    };
    p.emptyTrash = async (_r, list) => {
      const gone = list ?? [...trash.keys()];
      let removed = 0;
      for (const id of gone) if (trash.delete(id)) removed++;
      return { removed };
    };
  }
  return mem;
}

// ---- a small index over the same files --------------------------------------

function memIndex(mem: Mem): VaultIndexHost {
  const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
  const notes = () => [...mem.files.keys()].filter((p) => /\.md$/i.test(p));
  const index = {
    paths: () => notes(),
    has: (p: string) => mem.files.has(p),
    backlinks: (target: string) =>
      notes()
        .filter((p) => p !== target && mem.files.get(p)!.text.includes(`[[${titleOf(target)}]]`))
        .map((source) => ({ source, at: [0] })),
  };
  return { index } as unknown as VaultIndexHost;
}

// ---- deps -------------------------------------------------------------------

interface Harness {
  mem: Mem;
  deps: VaultOpsDeps;
  open: { note?: VaultOpsOpenNote };
  saved: string[];
  removed: string[];
  renamed: Array<[string, string]>;
  rekeyed: Array<[string, string]>;
  flushes: number;
}

function harness(mem: Mem, withIndex = true): Harness {
  const h: Harness = {
    mem,
    open: {},
    saved: [],
    removed: [],
    renamed: [],
    rekeyed: [],
    flushes: 0,
    deps: undefined as unknown as VaultOpsDeps,
  };
  const idx = memIndex(mem);
  h.deps = {
    target: { providerId: mem.provider.id, resourceId: 'vault' },
    provider: mem.provider,
    index: () => (withIndex ? idx : undefined),
    putVaultNote: (path, text, guard) => mem.provider.write('vault', path, text, guard),
    readBody: async (path) => (await mem.provider.read('vault', path))?.text,
    patch: {
      saved: (f) => h.saved.push(f.path),
      removed: (p) => h.removed.push(p),
      renamed: (from, to) => h.renamed.push([from, to.path]),
    },
    rekey: async (from, to) => {
      h.rekeyed.push([from, to]);
    },
    flushOpenSave: async () => {
      h.flushes++;
    },
    openNote: () => h.open.note,
  };
  return h;
}

const text = (h: Harness, p: string) => h.mem.files.get(p)?.text;

// ---- rename and move --------------------------------------------------------

describe('rename with links following (6.2, R1)', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness(
      memStorage({
        'Ideas.md': 'my ideas',
        'B.md': 'see [[Ideas]]',
        'C.md': 'also [[Ideas]] and [[Ideas]]',
        'D.md': 'last [[Ideas]]',
        'E.md': 'no links here',
      }),
    );
  });

  it('counts the links before anything is written, reading only the referring notes', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.preview.links).toBe(4);
    expect(p.preview.linkNotes).toBe(3);
    expect(p.preview.sources.map((s) => s.before).sort()).toEqual([
      'B.md',
      'C.md',
      'D.md',
      'Ideas.md',
    ]);
    expect(h.mem.writes).toEqual([]);
    expect(h.flushes).toBe(1);
  });

  it('renames, then rewrites every referring note, patching and re-keying the move', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    const r = await applyMove(h.deps, p.preview, { updateLinks: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(text(h, 'Plans.md')).toBe('my ideas');
    expect(h.mem.files.has('Ideas.md')).toBe(false);
    expect(text(h, 'B.md')).toBe('see [[Plans]]');
    expect(text(h, 'C.md')).toBe('also [[Plans]] and [[Plans]]');
    expect(r.rewrite).toMatchObject({
      updated: 4,
      total: 4,
      notesUpdated: 3,
      skipped: [],
      stopped: false,
    });
    expect(h.renamed).toEqual([['Ideas.md', 'Plans.md']]);
    expect(h.rekeyed).toEqual([['Ideas.md', 'Plans.md']]);
    // Every rewrite is its own compare-and-swap write.
    for (const w of h.mem.writes) expect(w.guard).toHaveProperty('ifMatch');
    expect(
      vaultRenameToast({ old: 'Ideas', next: 'Plans', rewrite: { ...r.rewrite!, skipped: [] } }),
    ).toBe('Renamed to "Plans". 4 links updated.');
  });

  it('a rename skips a referring note that changed, reports it, and writes the notes after it', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    // Somebody keeps typing in C: every write to it finds a newer version.
    h.mem.beforeWrite = (path) => {
      if (path !== 'C.md') return;
      const cur = h.mem.files.get('C.md')!;
      h.mem.files.set('C.md', { text: `${cur.text}!`, v: cur.v + 1000 });
    };
    const r = await applyMove(h.deps, p.preview, { updateLinks: true });
    if (!r.ok || !r.rewrite) throw new Error('no rewrite');
    // Re-read and re-planned once, then skipped: two writes to C, no more.
    expect(h.mem.writes.filter((w) => w.path === 'C.md')).toHaveLength(2);
    expect(r.rewrite.skipped).toEqual([{ path: 'C.md', reason: 'changed' }]);
    expect(r.rewrite.stopped).toBe(false);
    // The pass went on past it.
    expect(text(h, 'D.md')).toBe('last [[Plans]]');
    expect(text(h, 'B.md')).toBe('see [[Plans]]');
    expect(text(h, 'C.md')).toContain('[[Ideas]]');
    expect(r.rewrite.updated).toBe(2);
    // The toast names the skipped note and never reads as a plain success.
    const said = vaultRenameToast({
      old: 'Ideas',
      next: 'Plans',
      rewrite: { ...r.rewrite, skipped: ['C'] },
    });
    expect(said).toBe(
      'Renamed to "Plans". "C" changed while this ran, so its link still points to "Ideas".',
    );
    expect(said).not.toMatch(/links updated\.$/);
  });

  it('a note that changed once is re-read, re-planned, and written', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    let once = false;
    h.mem.beforeWrite = (path) => {
      if (path !== 'B.md' || once) return;
      once = true;
      h.mem.files.set('B.md', { text: 'see [[Ideas]], edited', v: 999 });
    };
    const r = await applyMove(h.deps, p.preview, { updateLinks: true });
    if (!r.ok || !r.rewrite) throw new Error('no rewrite');
    expect(text(h, 'B.md')).toBe('see [[Plans]], edited');
    expect(r.rewrite.skipped).toEqual([]);
  });

  it('skips the note open here with unsaved edits, and never writes under it', async () => {
    h.open.note = { path: 'B.md', version: 'v2', dirty: true, choiceOpen: false };
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    const r = await applyMove(h.deps, p.preview, { updateLinks: true });
    if (!r.ok || !r.rewrite) throw new Error('no rewrite');
    expect(r.rewrite.skipped).toEqual([{ path: 'B.md', reason: 'open' }]);
    expect(h.mem.writes.some((w) => w.path === 'B.md')).toBe(false);
  });

  it('only a storage-level failure stops the pass, and the rest are listed as not updated', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    h.mem.failOn = 'C.md';
    const r = await applyMove(h.deps, p.preview, { updateLinks: true });
    if (!r.ok || !r.rewrite) throw new Error('no rewrite');
    expect(r.rewrite.stopped).toBe(true);
    expect(text(h, 'B.md')).toBe('see [[Plans]]');
    expect(r.rewrite.notUpdated).toEqual(['C.md', 'D.md']);
    expect(text(h, 'D.md')).toBe('last [[Ideas]]');
    // Update the rest re-plans from fresh reads and finishes the job.
    h.mem.failOn = undefined;
    const rest = await updateTheRest(h.deps, p.preview, r.rewrite);
    expect(rest).toMatchObject({ stopped: false, skipped: [], notUpdated: [] });
    expect(text(h, 'C.md')).toBe('also [[Plans]] and [[Plans]]');
    expect(text(h, 'D.md')).toBe('last [[Plans]]');
  });

  it('a rename that meets a changed note ends the flow with nothing written', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    h.mem.files.set('Ideas.md', { text: 'changed elsewhere', v: 500 });
    const r = await applyMove(h.deps, p.preview, { updateLinks: true });
    expect(r).toMatchObject({ ok: false, reason: 'changed' });
    expect(h.mem.writes).toEqual([]);
    expect(h.mem.files.has('Plans.md')).toBe(false);
    expect(h.renamed).toEqual([]);
  });

  it('refuses while a choice is open on the note', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    h.open.note = { path: 'Ideas.md', version: 'v1', dirty: true, choiceOpen: true };
    expect(await applyMove(h.deps, p.preview, { updateLinks: true })).toMatchObject({
      ok: false,
      reason: 'choice-open',
    });
  });

  it('Rename only moves the note and leaves every other note alone', async () => {
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    const r = await applyMove(h.deps, p.preview, { updateLinks: false });
    expect(r).toMatchObject({ ok: true });
    expect(text(h, 'B.md')).toBe('see [[Ideas]]');
    expect(h.mem.writes).toEqual([]);
  });

  it('falls back to create-if-absent then guarded remove on a compare-and-swap storage with no rename', async () => {
    const g = harness(memStorage({ 'Ideas.md': 'x', 'B.md': '[[Ideas]]' }, { rename: false }));
    const p = await prepareNoteMove(g.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    const r = await applyMove(g.deps, p.preview, { updateLinks: true });
    expect(r.ok).toBe(true);
    expect(g.mem.files.has('Ideas.md')).toBe(false);
    expect(text(g, 'Plans.md')).toBe('x');
    expect(text(g, 'B.md')).toBe('[[Plans]]');
    expect(g.mem.writes[0]).toEqual({ path: 'Plans.md', guard: { ifAbsent: true } });
  });

  it('does nothing on a storage without compare-and-swap (K1)', async () => {
    const mem = memStorage({ 'Ideas.md': 'x' });
    (mem.provider as { compareAndSwap?: true }).compareAndSwap = undefined;
    const g = harness(mem);
    expect(await prepareNoteMove(g.deps, 'Ideas.md', 'Plans.md')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
});

describe('the rename name check (CX X5)', () => {
  const known = ['Ideas.md', 'Work/Plans.md'];
  it('builds the path from a name and a folder', () => {
    expect(checkRenameTarget('Ideas.md', 'Notes', 'Work', known)).toEqual({
      ok: true,
      to: 'Work/Notes.md',
    });
    expect(checkRenameTarget('Ideas.md', 'Notes.md', '', known)).toEqual({
      ok: true,
      to: 'Notes.md',
    });
  });
  it('refuses Obsidian’s characters, a taken name by its folded path, and allows a case-only rename', () => {
    expect(checkRenameTarget('Ideas.md', 'a#b', '', known)).toMatchObject({ reason: 'bad-chars' });
    expect(checkRenameTarget('Ideas.md', 'plans', 'work', known)).toMatchObject({
      reason: 'taken',
    });
    expect(checkRenameTarget('Ideas.md', 'ideas', '', known)).toEqual({ ok: true, to: 'ideas.md' });
    expect(checkRenameTarget('Ideas.md', 'Ideas', '', known)).toMatchObject({ reason: 'same' });
  });
});

describe('folders (K5)', () => {
  it('moves a folder in one rename where the storage can, re-basing each note', async () => {
    const h = harness(
      memStorage(
        { 'Work/A.md': 'a', 'Work/B.md': '[[A]]', 'Home.md': 'see [[A]]' },
        { renameFolder: true },
      ),
    );
    expect(await folderCounts(h.deps, 'Work')).toEqual({ notes: 2, attachments: 0 });
    const p = await prepareFolderMove(h.deps, 'Work', 'Jobs');
    if (!p.ok) throw new Error('no plan');
    expect(p.preview.notes).toBe(2);
    const r = await applyMove(h.deps, p.preview, { updateLinks: true });
    expect(r.ok).toBe(true);
    expect(h.mem.files.has('Jobs/A.md')).toBe(true);
    expect(h.renamed.map(([f]) => f).sort()).toEqual(['Work/A.md', 'Work/B.md']);
  });

  it('moves note by note where it cannot, and says which moved when one fails', async () => {
    const mem = memStorage({ 'Work/A.md': 'a', 'Work/B.md': 'b' });
    const h = harness(mem);
    const p = await prepareFolderMove(h.deps, 'Work', 'Jobs');
    if (!p.ok) throw new Error('no plan');
    const rename = mem.provider.rename!;
    mem.provider.rename = async (r, from, to, g) =>
      from === 'Work/B.md' ? { ok: false, conflict: 'changed' } : rename(r, from, to, g);
    const r = await applyMove(h.deps, p.preview, { updateLinks: false });
    expect(r).toMatchObject({ ok: false, reason: 'partial' });
    if (r.ok) return;
    expect(r.moved?.map((m) => m.path)).toEqual(['Jobs/A.md']);
    expect(h.renamed).toEqual([['Work/A.md', 'Jobs/A.md']]);
  });

  it('creates a real folder where there is one, and remembers one where there is not', async () => {
    const mem = memStorage({});
    const made: string[] = [];
    const h = harness(mem);
    expect(await createFolder(h.deps, 'Inbox')).toEqual({ ok: true, remembered: true });
    mem.provider.createFolder = async (_r, path) => {
      made.push(path);
      return { ok: true };
    };
    expect(await createFolder(h.deps, 'Inbox/')).toEqual({ ok: true, remembered: false });
    expect(made).toEqual(['Inbox']);
    expect(await createFolder(h.deps, '.hidden')).toEqual({ ok: false, reason: 'bad-name' });
  });
});

// ---- delete, Trash, Undo ----------------------------------------------------

describe('delete then Undo (6.3, R2, R3)', () => {
  it('moves to Trash where it is real, and Undo restores the bytes where they were', async () => {
    const h = harness(
      memStorage({ 'Ideas.md': 'the exact bytes\r\n', 'B.md': 'b' }, { trash: true }),
    );
    expect(hasRealTrash(h.deps.provider)).toBe(true);
    const d = await deleteNote(h.deps, 'Ideas.md');
    expect(d).toMatchObject({ ok: true, trashed: true, notes: 1 });
    if (!d.ok) return;
    expect(h.mem.files.has('Ideas.md')).toBe(false);
    expect(h.removed).toEqual(['Ideas.md']);
    // The pending save goes first, so Trash holds what was last typed.
    expect(h.flushes).toBe(1);
    const t = await listTrash(h.deps);
    expect(t.ok && t.entries.map((e) => e.path)).toEqual(['Ideas.md']);
    const u = await undoDelete(h.deps, d.undo);
    expect(u).toEqual({ ok: true, path: 'Ideas.md', renamed: false });
    expect(text(h, 'Ideas.md')).toBe('the exact bytes\r\n');
    expect(h.saved).toEqual(['Ideas.md']);
  });

  it('never overwrites: a restore beside a taken name lands as "(restored)"', async () => {
    const h = harness(memStorage({ 'Ideas.md': 'old' }, { trash: true }));
    const d = await deleteNote(h.deps, 'Ideas.md');
    if (!d.ok) throw new Error('not deleted');
    h.mem.files.set('Ideas.md', { text: 'a new one', v: 77 });
    const u = await undoDelete(h.deps, d.undo);
    expect(u).toEqual({ ok: true, path: 'Ideas (restored).md', renamed: true });
    expect(text(h, 'Ideas.md')).toBe('a new one');
    expect(text(h, 'Ideas (restored).md')).toBe('old');
  });

  it('without Trash, deletes for good and keeps the bytes in memory for the courtesy Undo', async () => {
    const h = harness(memStorage({ 'Ideas.md': 'kept in memory' }));
    expect(hasRealTrash(h.deps.provider)).toBe(false);
    const d = await deleteNote(h.deps, 'Ideas.md');
    expect(d).toMatchObject({ ok: true, trashed: false });
    if (!d.ok) return;
    h.mem.files.set('Ideas.md', { text: 'somebody made a new one', v: 70 });
    const u = await undoDelete(h.deps, d.undo);
    expect(u).toEqual({ ok: true, path: 'Ideas (restored).md', renamed: true });
    expect(text(h, 'Ideas (restored).md')).toBe('kept in memory');
    expect(text(h, 'Ideas.md')).toBe('somebody made a new one');
  });

  it('a delete guarded by a version this device has not seen is refused', async () => {
    const h = harness(memStorage({ 'Ideas.md': 'x' }, { trash: true }));
    h.open.note = { path: 'Ideas.md', version: 'v0', dirty: false, choiceOpen: false };
    expect(await deleteNote(h.deps, 'Ideas.md')).toMatchObject({ ok: false, reason: 'changed' });
    expect(h.mem.files.has('Ideas.md')).toBe(true);
  });

  it('a folder goes to Trash whole, and comes back whole', async () => {
    const h = harness(
      memStorage({ 'Work/A.md': 'a', 'Work/B.md': 'b', 'C.md': 'c' }, { trash: true }),
    );
    const d = await deleteFolder(h.deps, 'Work');
    expect(d).toMatchObject({ ok: true, notes: 2 });
    if (!d.ok) return;
    expect(h.removed.sort()).toEqual(['Work/A.md', 'Work/B.md']);
    expect(await undoDelete(h.deps, d.undo)).toMatchObject({ ok: true });
    expect(text(h, 'Work/B.md')).toBe('b');
  });

  it('a folder is never deleted for good in one step without Trash', async () => {
    const h = harness(memStorage({ 'Work/A.md': 'a' }));
    expect(await deleteFolder(h.deps, 'Work')).toEqual({ ok: false, reason: 'unsupported' });
    expect(h.mem.files.has('Work/A.md')).toBe(true);
  });

  it('Empty Trash says how many went and how many stayed', async () => {
    const h = harness(memStorage({ 'A.md': 'a', 'B.md': 'b' }, { trash: true }));
    await deleteNote(h.deps, 'A.md');
    await deleteNote(h.deps, 'B.md');
    const e = await emptyTrash(h.deps);
    expect(e).toEqual({ ok: true, removed: 2, asked: 2 });
  });
});

// ---- Today ------------------------------------------------------------------

describe('Today (6.4)', () => {
  it('opens an existing note unchanged, with no write', async () => {
    const h = harness(memStorage({ '2026-09-27.md': 'what I wrote this morning' }));
    const r = await openToday(h.deps, { path: '2026-09-27.md', text: '# template' });
    expect(r).toEqual({ ok: true, created: false, path: '2026-09-27.md' });
    expect(h.mem.writes).toEqual([]);
    expect(text(h, '2026-09-27.md')).toBe('what I wrote this morning');
  });

  it('a create that finds the name taken opens what is there, byte for byte', async () => {
    const h = harness(memStorage({ '2026-09-27.md': 'already here' }), false);
    const r = await openToday(h.deps, { path: '2026-09-27.md', text: '# template' });
    expect(r).toEqual({ ok: true, created: false, path: '2026-09-27.md' });
    expect(h.mem.writes).toEqual([{ path: '2026-09-27.md', guard: { ifAbsent: true } }]);
    expect(text(h, '2026-09-27.md')).toBe('already here');
  });

  it('creates it only while nothing has the name', async () => {
    const h = harness(memStorage({}));
    const r = await openToday(h.deps, { path: 'Daily/2026-09-27.md', text: '# Sunday' });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(text(h, 'Daily/2026-09-27.md')).toBe('# Sunday');
  });
});

// ---- a refusal for good (the 2026-09-30 review, finding 1) ----------------

// A storage that refuses for good (the team vault out of free space, 0023:
// OrgVaultFull, `permanent`) is not a failure worth trying again, so every
// operation that writes carries the storage's line in its result, and the
// store says it after the verb. Anything unclassified stays a plain
// `storage` failure with no line.
describe('a refusal for good is carried, never "try again" (0023)', () => {
  // The provider's own line, as OrgVaultFull carries it.
  const FULL = 'This team has used its 25 MiB of free space.';
  const full = () => Object.assign(new Error(FULL), { permanent: true });
  const offline = () => new TypeError('Failed to fetch');
  const refusing = (h: Harness, err: () => Error) => {
    const write = h.mem.provider.write.bind(h.mem.provider);
    h.mem.provider.write = async (r, path, t, guard) => {
      if (h.mem.failOn === path) throw err();
      return write(r, path, t, guard);
    };
  };

  it('Restore carries the line; a failure that may pass carries none', async () => {
    const h = harness(memStorage({ 'Old.md': 'old' }, { trash: true }));
    const d = await deleteNote(h.deps, 'Old.md');
    if (!d.ok || d.undo.kind !== 'trash') throw new Error('not trashed');
    h.mem.provider.restore = async () => {
      throw full();
    };
    const refused = await restoreEntry(h.deps, d.undo.id);
    expect(refused).toEqual({ ok: false, reason: 'storage', line: FULL });
    expect(refusalOf(refused)).toEqual({ line: FULL });
    h.mem.provider.restore = async () => {
      throw offline();
    };
    const failed = await restoreEntry(h.deps, d.undo.id);
    expect(failed).toEqual({ ok: false, reason: 'storage' });
    expect(refusalOf(failed)).toBeUndefined();
  });

  it('a folder that came back in part says how many and which stayed', async () => {
    const h = harness(memStorage({ 'Work/a.md': 'a', 'Work/b.md': 'b' }, { trash: true }));
    const d = await deleteFolder(h.deps, 'Work');
    if (!d.ok || d.undo.kind !== 'trash') throw new Error('not trashed');
    h.mem.provider.restore = async () => {
      h.mem.files.set('Work/a.md', { text: 'a', v: 90 });
      return {
        ok: true,
        file: { path: 'Work/a.md', updatedAt: 't', size: 1, version: 'v90' },
        renamed: false,
        partial: { restored: 1, left: ['Work/b.md'], line: FULL },
      };
    };
    expect(await undoDelete(h.deps, d.undo)).toEqual({
      ok: true,
      path: 'Work/a.md',
      renamed: false,
      partial: { restored: 1, left: ['Work/b.md'], line: FULL },
    });
  });

  it('Undo from Trash and Undo from memory both carry the line', async () => {
    const h = harness(memStorage({ 'Old.md': 'old' }, { trash: true }));
    const d = await deleteNote(h.deps, 'Old.md');
    if (!d.ok) throw new Error('not trashed');
    h.mem.provider.restore = async () => {
      throw full();
    };
    expect(await undoDelete(h.deps, d.undo)).toEqual({
      ok: false,
      reason: 'storage',
      line: FULL,
    });
    const m = harness(memStorage({ 'Mine.md': 'kept in memory' }));
    const gone = await deleteNote(m.deps, 'Mine.md');
    if (!gone.ok) throw new Error('not deleted');
    refusing(m, full);
    m.mem.failOn = 'Mine.md';
    expect(await undoDelete(m.deps, gone.undo)).toEqual({
      ok: false,
      reason: 'storage',
      line: FULL,
    });
  });

  it("Today's start carries the line", async () => {
    const h = harness(memStorage({}));
    refusing(h, full);
    h.mem.failOn = 'Daily/2026-09-30.md';
    expect(await openToday(h.deps, { path: 'Daily/2026-09-30.md', text: '# Wednesday' })).toEqual({
      ok: false,
      reason: 'storage',
      line: FULL,
    });
    h.mem.failOn = undefined;
    refusing(h, offline);
    h.mem.failOn = 'Daily/2026-09-30.md';
    expect(await openToday(h.deps, { path: 'Daily/2026-09-30.md', text: '# Wednesday' })).toEqual({
      ok: false,
      reason: 'storage',
    });
  });

  it('a rename carries the line, and a folder moved note by note says what moved first', async () => {
    const h = harness(memStorage({ 'Ideas.md': 'my ideas' }));
    h.mem.provider.rename = async () => {
      throw full();
    };
    const p = await prepareNoteMove(h.deps, 'Ideas.md', 'Plans.md');
    if (!p.ok) throw new Error('no plan');
    expect(await applyMove(h.deps, p.preview, { updateLinks: false })).toEqual({
      ok: false,
      reason: 'storage',
      line: FULL,
    });
    const f = harness(memStorage({ 'Work/a.md': 'a', 'Work/b.md': 'b' }));
    const rename = f.mem.provider.rename!.bind(f.mem.provider);
    f.mem.provider.rename = async (r, from, to, guard) => {
      if (from === 'Work/b.md') throw full();
      return rename(r, from, to, guard);
    };
    const fp = await prepareFolderMove(f.deps, 'Work', 'Done');
    if (!fp.ok) throw new Error('no plan');
    expect(await applyMove(f.deps, fp.preview, { updateLinks: false })).toMatchObject({
      ok: false,
      reason: 'partial',
      moved: [expect.objectContaining({ path: 'Done/a.md' })],
      line: FULL,
    });
  });

  it('a delete carries a whole line as whole, and any other line as the reason', async () => {
    const h = harness(memStorage({ 'A.md': 'a', 'B.md': 'b' }, { trash: true }));
    const whole = 'Not deleted. Only admins can delete team notes.';
    h.mem.provider.trash = async () => {
      throw Object.assign(new Error(whole), { permanent: true, whole: true });
    };
    expect(await deleteNote(h.deps, 'A.md')).toEqual({
      ok: false,
      reason: 'storage',
      line: whole,
      whole: true,
    });
    h.mem.provider.trash = async () => {
      throw Object.assign(new Error('not a member of this org'), { permanent: true });
    };
    expect(await deleteNote(h.deps, 'B.md')).toEqual({
      ok: false,
      reason: 'storage',
      line: 'not a member of this org',
    });
  });
});

// ---- the checkbox write-back ------------------------------------------------

describe('a task toggle (K11, CX X13)', () => {
  it('is one guarded write on the open note’s version', async () => {
    const h = harness(memStorage({ 'T.md': '- [ ] one\n- [ ] two' }));
    h.open.note = { path: 'T.md', version: 'v1', dirty: false, choiceOpen: false };
    const r = await toggleTask(h.deps, 'T.md', 3, ' ');
    expect(r).toMatchObject({ ok: true, status: 'x' });
    expect(text(h, 'T.md')).toBe('- [x] one\n- [ ] two');
    expect(h.mem.writes).toEqual([{ path: 'T.md', guard: { ifMatch: 'v1' } }]);
    expect(h.flushes).toBe(1);
  });

  it('a note that changed somewhere else is a result for the resolve path, never a write', async () => {
    const h = harness(memStorage({ 'T.md': '- [ ] one' }));
    h.open.note = { path: 'T.md', version: 'v0', dirty: false, choiceOpen: false };
    const r = await toggleTask(h.deps, 'T.md', 3, ' ');
    expect(r).toMatchObject({ ok: false, reason: 'changed' });
    expect(text(h, 'T.md')).toBe('- [ ] one');
  });

  it('runs one tick at a time, each on the version the last returned', async () => {
    const h = harness(memStorage({ 'T.md': '- [ ] one\n- [ ] two' }));
    let version = 'v1';
    h.open.note = { path: 'T.md', version, dirty: false, choiceOpen: false };
    h.deps.openNote = () => ({ path: 'T.md', version, dirty: false, choiceOpen: false });
    const put = h.deps.putVaultNote;
    h.deps.putVaultNote = async (p, t, g) => {
      const r = await put(p, t, g);
      if (r.ok) version = r.file.version!;
      return r;
    };
    const [a, b] = await Promise.all([
      toggleTask(h.deps, 'T.md', 3, ' '),
      toggleTask(h.deps, 'T.md', 13, ' '),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(text(h, 'T.md')).toBe('- [x] one\n- [x] two');
  });

  it('is refused on a storage without compare-and-swap', async () => {
    const mem = memStorage({ 'T.md': '- [ ] one' });
    (mem.provider as { compareAndSwap?: true }).compareAndSwap = undefined;
    const h = harness(mem);
    expect(await toggleTask(h.deps, 'T.md', 3, ' ')).toEqual({ ok: false, reason: 'unsupported' });
  });
});
