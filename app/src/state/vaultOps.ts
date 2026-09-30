// The Vault's M6 operations (CTO K3 to K7, K11, reconciled R1 to R3): rename
// and move with links following, folders, Trash, restore, Undo, Today, and the
// checkbox write-back. They live here, apart from the store, so the
// orchestration is testable with a fake provider and a fake index and without
// the store: the store builds a `VaultOpsDeps` for the vault on screen and
// delegates (wave 2 integrator, call sites only).
//
// Every operation answers with a result, never a throw: a thrown provider call
// is a storage-level failure (offline, Your computer away, signed out), and
// the result says so. Nothing here shows a toast; the copy for each result is
// in lib/vaultCopy.ts (stream G's fence). Test: app/test/vaultOps.test.ts.
import {
  buildPathIndex,
  checkNewNoteName,
  foldPath,
  noteFolder,
  noteTitle,
  planLinkRewrites,
  toggleTaskAt,
  type LinkRewriteEdit,
  type LinkRewritePlan,
  type LinkRewriteSource,
} from 'os-code/protocol';
import type { VaultIndexHost } from '../lib/vaultIndexHost.js';
import {
  versionOf,
  type RestorePartial,
  type RestoreReport,
  type TrashPartial,
  type TrashReport,
  type StorageProvider,
  type StoredFile,
  type StoredFileMeta,
  type TrashEntry,
  type WriteGuard,
  type WriteResult,
} from '../lib/gitos/providers.js';
import type { VaultTargetRef } from './store.js';

/** The note open on screen, as an operation needs to see it: a note with
 *  unsaved edits or an open resolve choice is never rewritten under the
 *  person (R1). */
export interface VaultOpsOpenNote {
  path: string;
  /** The version the editor's text is based on (`versionOf`). */
  version: string;
  /** Typed text not yet saved. */
  dirty: boolean;
  /** A resolve choice is open on it. */
  choiceOpen: boolean;
}

/** Everything an M6 operation reaches, fixed for one vault when the
 *  operation starts, so a scope flip or a sign-out mid-flight can never send
 *  one vault's change to the other (the 0.7 rule). */
export interface VaultOpsDeps {
  /** The vault this operation acts on. */
  target: VaultTargetRef;
  /** Its storage. What it may do is `vaultCaps(provider, ...)`
   *  (lib/vaultCaps.ts, stream C); nothing falls back on a provider without
   *  `compareAndSwap` (K3). */
  provider: StorageProvider;
  /** The vault's index host, when one is open. A rewrite plan picks its
   *  sources from the index only, never a whole-vault read (K4). */
  index: () => VaultIndexHost | undefined;
  /** The store's one write path: the provider's write, then the list, the
   *  body cache and the index patched from the result. Every rewrite, Today
   *  and every tick go through it. */
  putVaultNote: (path: string, text: string, guard: WriteGuard) => Promise<WriteResult>;
  /** A note's text through the store's body cache, or undefined. */
  readBody: (path: string) => Promise<string | undefined>;
  /** Patch callbacks for a change the operation made itself that is not a
   *  plain write: the list, the body cache and the index, without a re-list. */
  patch: {
    /** A note written or restored. */
    saved: (file: StoredFile) => void;
    /** A note gone (trashed, deleted, or moved away from `path`). */
    removed: (path: string) => void;
    /** A note renamed: `to` carries its version at the new path. */
    renamed: (from: string, to: StoredFileMeta) => void;
  };
  /** Re-key everything a path owns on this device after a rename: project
   *  pins (`vaultRenamePins`), stash entries, the recent ring, and the open
   *  note. */
  rekey: (from: string, to: string) => Promise<void>;
  /** Write the open note's pending save now, before an operation reads it. */
  flushOpenSave: () => Promise<void>;
  /** The note open on screen, or undefined. */
  openNote: () => VaultOpsOpenNote | undefined;
  /** The clock (tests pass their own). */
  now?: () => number;
}

// ---- stream G: the operations -----------------------------------------------

/** Why a whole operation could not run. `storage` is a storage-level failure
 *  (a thrown call: offline, Your computer away, signed out); `unsupported` is
 *  a storage without the member or without compare-and-swap (K1: nothing in
 *  M6 falls back on a provider without it). */
export type VaultOpFailure = 'storage' | 'unsupported';

/** A storage's refusal that trying again cannot fix (`permanent`: the team
 *  vault out of free space, migration 0023, or its plan not active, 0025), as
 *  a result carries it: the storage's line, and `whole` when that line
 *  already names what did not happen (the admins-only delete, CX Y14). The
 *  store says it with the verb first (vaultRefusedLine), never as "try
 *  again". */
export interface VaultRefusal {
  line: string;
  whole?: true;
}

/** Did a provider call throw? Then the storage itself failed, and every later
 *  call would fail the same way (R1). */
async function attempt<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; refusal?: VaultRefusal }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    // A refusal for good is carried, so the result can say it.
    const refusal = refusalOfError(err);
    if (refusal) return { ok: false, refusal };
    return { ok: false };
  }
}

/** The refusal a thrown storage error is, or undefined for a failure that
 *  may pass (offline, a timeout, anything unclassified). */
function refusalOfError(err: unknown): VaultRefusal | undefined {
  const e = err as { permanent?: unknown; whole?: unknown; message?: unknown } | undefined;
  if (e?.permanent !== true || typeof e.message !== 'string' || !e.message) return undefined;
  return e.whole === true ? { line: e.message, whole: true } : { line: e.message };
}

/** The refusal any result of this module carries (its `line` and `whole`),
 *  or undefined, so the store and the room read it without a cast. */
export function refusalOf(r: object): VaultRefusal | undefined {
  const { line, whole } = r as { line?: unknown; whole?: unknown };
  if (typeof line !== 'string' || !line) return undefined;
  return whole === true ? { line, whole: true } : { line };
}

const MD_END = /\.md$/i;

/** A folder path joined with a note's file name. */
function joinPath(folder: string, file: string): string {
  return folder ? `${folder}/${file}` : file;
}

/** Is `path` inside `folder` (at any depth)? */
function inFolder(path: string, folder: string): boolean {
  return foldPath(path).startsWith(`${foldPath(folder)}/`);
}

/** The guard for a note: the open note's version when it is the one on
 *  screen (after its save was flushed), else what the storage says now. */
async function guardFor(deps: VaultOpsDeps, path: string): Promise<string | undefined> {
  const open = deps.openNote();
  if (open && open.path === path) return open.version;
  const meta = await deps.provider.stat(deps.target.resourceId, path);
  return meta ? versionOf(meta) : undefined;
}

/** Every note path the index knows, or none. */
function indexedPaths(deps: VaultOpsDeps): string[] {
  return deps.index()?.index.paths() ?? [];
}

/** Where a restored note lands when its name is taken: "{title} (restored)"
 *  beside it (R3, CX X10). */
export function restoredPath(path: string): string {
  return joinPath(noteFolder(path), `${noteTitle(path)} (restored).md`);
}

// ---- names (CX X5) ----------------------------------------------------------

/** Why a new name or place for a note cannot be used. */
export type VaultRenameRefusal =
  | { reason: 'bad-name'; error: string }
  | { reason: 'bad-chars' }
  | { reason: 'taken'; name: string; folder: string }
  | { reason: 'same' };

/** The note path for a name typed into the rename sheet and a folder picked
 *  beside it, checked by the one new-name rule and against the notes the
 *  index knows (by the folded path, so case and NFC count). A case-only
 *  rename of the same note is allowed (K3). */
export function checkRenameTarget(
  from: string,
  name: string,
  folder: string,
  known: readonly string[],
): { ok: true; to: string } | ({ ok: false } & VaultRenameRefusal) {
  const typed = name.trim().replace(MD_END, '');
  if (/[[\]#^|\\:*?"<>]/.test(typed)) return { ok: false, reason: 'bad-chars' };
  if (typed.includes('/')) return { ok: false, reason: 'bad-chars' };
  const check = checkNewNoteName(joinPath(folder, `${typed}.md`));
  if (!check.ok) return { ok: false, reason: 'bad-name', error: check.error };
  const to = check.path;
  if (to === from) return { ok: false, reason: 'same' };
  const folded = foldPath(to);
  if (folded !== foldPath(from) && known.some((p) => foldPath(p) === folded)) {
    return { ok: false, reason: 'taken', name: noteTitle(to), folder: noteFolder(to) };
  }
  return { ok: true, to };
}

// ---- rename and move (K3, K4 with R1; CX X5 to X7) --------------------------

/** One source the rewrite pass writes: where it was before the moves, where
 *  it is after, and what the plan read. */
interface RewriteSource {
  before: string;
  after: string;
}

/** A rename or move, planned but not yet run. The sheet asks "Update links?"
 *  only when `links` is above zero (CX X6). */
export interface VaultMovePreview {
  kind: 'note' | 'folder';
  /** The note or folder as it is now, and where it goes. */
  from: string;
  to: string;
  /** Every path that moves (notes, and attachments for a folder). */
  moves: ReadonlyMap<string, string>;
  /** Notes moved (1 for a note). */
  notes: number;
  /** Attachments moved with a folder. */
  attachments: number;
  /** Links the plan would update, and in how many notes. */
  links: number;
  linkNotes: number;
  /** The plan, from the reads it made. */
  plan: LinkRewritePlan;
  sources: RewriteSource[];
  /** The rename's guard: the source's version as last seen (a note only). */
  guard?: string;
}

/** What the rewrite pass did (R1). A skipped note is named, never hidden. */
export type VaultSkipReason = 'changed' | 'downloading' | 'open' | 'missing';

export interface VaultRewriteReport {
  /** Links updated and the links the plan found. */
  updated: number;
  total: number;
  /** Notes written. */
  notesUpdated: number;
  /** Notes left as they were, each with why. `missing` notes lost nothing. */
  skipped: Array<{ path: string; reason: VaultSkipReason }>;
  /** A storage-level failure stopped the pass: these were not tried. */
  notUpdated: string[];
  /** True when a storage-level failure stopped the pass. */
  stopped: boolean;
  /** A refusal for good stopped it (a team out of free space, 0023): the
   *  storage's line, so the room says why instead of "tries again" and
   *  offers no Update the rest that would be refused the same way. */
  refusal?: VaultRefusal;
}

/** What a rename or move did, from the first call to the last rewrite. */
export type VaultMoveResult =
  | {
      ok: true;
      preview: VaultMovePreview;
      /** Where each moved note is now, with its version there. */
      moved: StoredFileMeta[];
      /** The rewrite pass, or undefined for Rename only. */
      rewrite?: VaultRewriteReport;
      /** The generic fallback kept both copies (K3): the old one is still
       *  there beside the new one. */
      keptBoth?: boolean;
    }
  | {
      ok: false;
      /** Nothing changed. `partial` (a folder moved note by note) names the
       *  notes that did move before the first failure. */
      reason:
        | VaultOpFailure
        | 'changed'
        | 'missing'
        | 'exists'
        | 'downloading'
        | 'choice-open'
        | 'partial';
      moved?: StoredFileMeta[];
      theirs?: StoredFile;
      /** A refusal for good (VaultRefusal): its line, and `whole`. */
      line?: string;
      whole?: true;
      /** A folder moved note by note that stopped on a conflict: which one,
       *  the path it was going to, and, for a taken name, the note there, so
       *  the room names it instead of saying "try again" (round 5). */
      stoppedOn?: 'changed' | 'missing' | 'exists' | 'downloading';
      stoppedAt?: string;
    };

/** The sources for a rewrite plan, from the index only (K4): the backlinks of
 *  every moved note, the moved notes themselves (their own relative links),
 *  and the backlinks of every note whose basename matches a moved note's new
 *  one (collateral resolution changes). Never a whole-vault read. */
function sourcePaths(host: VaultIndexHost | undefined, moves: ReadonlyMap<string, string>) {
  const out = new Set<string>();
  if (!host) return out;
  const idx = host.index;
  const baseOf = (p: string) => {
    const f = foldPath(p);
    return f.slice(f.lastIndexOf('/') + 1);
  };
  const newBases = new Set<string>();
  for (const [from, to] of moves) {
    if (!MD_END.test(from)) continue;
    if (idx.has(from)) out.add(from);
    for (const b of idx.backlinks(from)) out.add(b.source);
    newBases.add(baseOf(to));
  }
  for (const p of idx.paths()) {
    if (moves.has(p) || !newBases.has(baseOf(p))) continue;
    for (const b of idx.backlinks(p)) out.add(b.source);
  }
  return out;
}

/** Read the sources and plan every rewrite the moves need. An unreadable or
 *  not-yet-local source is left out of the plan (it has nothing to lose). */
async function planMoves(
  deps: VaultOpsDeps,
  moves: ReadonlyMap<string, string>,
  known: readonly string[],
): Promise<{ plan: LinkRewritePlan; sources: RewriteSource[] }> {
  const before = buildPathIndex(known);
  const after = buildPathIndex(known.map((p) => moves.get(p) ?? p));
  const reads: LinkRewriteSource[] = [];
  const sources: RewriteSource[] = [];
  for (const path of sourcePaths(deps.index(), moves)) {
    const file = await deps.provider.read(deps.target.resourceId, path);
    if (!file) continue;
    reads.push({ path, text: file.text, version: versionOf(file) });
    sources.push({ before: path, after: moves.get(path) ?? path });
  }
  if (!reads.length) return { plan: { edits: [], links: 0, notes: 0, left: [] }, sources };
  return { plan: planLinkRewrites(moves, before, after, reads), sources };
}

/** The attachments inside a folder, where the storage lists them. */
async function folderAttachments(deps: VaultOpsDeps, folder: string): Promise<string[]> {
  if (!deps.provider.listAttachments) return [];
  const all = await deps.provider.listAttachments(deps.target.resourceId);
  return all.map((a) => a.path).filter((p) => inFolder(p, folder));
}

/** Plan a note's rename or move: the new path checked, the sources read, the
 *  links counted. Nothing is written. */
export async function prepareNoteMove(
  deps: VaultOpsDeps,
  from: string,
  to: string,
): Promise<{ ok: true; preview: VaultMovePreview } | { ok: false; reason: VaultOpFailure }> {
  if (!deps.provider.compareAndSwap) return { ok: false, reason: 'unsupported' };
  const run = await attempt(async () => {
    await deps.flushOpenSave();
    const guard = await guardFor(deps, from);
    const known = indexedPaths(deps);
    const all = known.includes(from) ? known : [...known, from];
    const moves = new Map([[from, to]]);
    const { plan, sources } = await planMoves(deps, moves, all);
    const preview: VaultMovePreview = {
      kind: 'note',
      from,
      to,
      moves,
      notes: 1,
      attachments: 0,
      links: plan.links,
      linkNotes: plan.notes,
      plan,
      sources,
      guard,
    };
    return preview;
  });
  return run.ok ? { ok: true, preview: run.value } : { ok: false, reason: 'storage' };
}

/** Plan a folder's rename or move: every note under it and every attachment
 *  the storage lists there move together, with the counts the sheet states
 *  before it acts (K5, "12 notes and 3 attachments"). */
export async function prepareFolderMove(
  deps: VaultOpsDeps,
  from: string,
  to: string,
): Promise<{ ok: true; preview: VaultMovePreview } | { ok: false; reason: VaultOpFailure }> {
  if (!deps.provider.compareAndSwap) return { ok: false, reason: 'unsupported' };
  const run = await attempt(async () => {
    await deps.flushOpenSave();
    const known = indexedPaths(deps);
    const notes = known.filter((p) => inFolder(p, from));
    const files = await folderAttachments(deps, from);
    const moves = new Map<string, string>();
    for (const p of [...notes, ...files]) moves.set(p, `${to}${p.slice(from.length)}`);
    const { plan, sources } = await planMoves(deps, moves, [...known, ...files]);
    const preview: VaultMovePreview = {
      kind: 'folder',
      from,
      to,
      moves,
      notes: notes.length,
      attachments: files.length,
      links: plan.links,
      linkNotes: plan.notes,
      plan,
      sources,
    };
    return preview;
  });
  return run.ok ? { ok: true, preview: run.value } : { ok: false, reason: 'storage' };
}

/** Rename one note on the storage, natively where it can (K3), else by the
 *  generic compare-and-swap fallback: read, create at `to` if absent, remove
 *  the source by its version, and on a moved source remove the new copy by
 *  its own version (both kept, and said, if that fails too). */
async function renameOne(
  deps: VaultOpsDeps,
  from: string,
  to: string,
  ifMatch: string,
): Promise<
  | { ok: true; file: StoredFileMeta; keptBoth?: boolean }
  | {
      ok: false;
      conflict: 'changed' | 'missing' | 'exists' | 'downloading';
      theirs?: StoredFile;
    }
> {
  const { provider, target } = deps;
  if (provider.rename) return provider.rename(target.resourceId, from, to, { ifMatch });
  const source = await provider.read(target.resourceId, from);
  if (!source) return { ok: false, conflict: 'missing' };
  if (versionOf(source) !== ifMatch) return { ok: false, conflict: 'changed', theirs: source };
  const made = await provider.write(target.resourceId, to, source.text, { ifAbsent: true });
  if (!made.ok) return made;
  const gone = await provider.remove(target.resourceId, from, { ifMatch });
  const meta: StoredFileMeta = {
    path: made.file.path,
    updatedAt: made.file.updatedAt,
    size: new TextEncoder().encode(made.file.text).length,
    ...(made.file.version ? { version: made.file.version } : {}),
  };
  if (gone.ok) return { ok: true, file: meta };
  const undo = await provider.remove(target.resourceId, to, { ifMatch: versionOf(made.file) });
  if (undo.ok) return { ok: false, conflict: 'changed', theirs: gone.theirs };
  return { ok: true, file: meta, keptBoth: true };
}

/** Run a planned rename or move (K3, K4 with R1): the move lands first, and a
 *  failure there ends the flow with nothing changed; then, with
 *  `updateLinks`, the rewrite pass. `onProgress(i, m)` reports each note the
 *  pass reaches (CX X6's "Updating links, {i} of {M}"). */
export async function applyMove(
  deps: VaultOpsDeps,
  preview: VaultMovePreview,
  opts: { updateLinks: boolean; onProgress?: (i: number, m: number) => void },
): Promise<VaultMoveResult> {
  const { provider, target } = deps;
  if (!provider.compareAndSwap) return { ok: false, reason: 'unsupported' };
  const flushed = await attempt(() => deps.flushOpenSave());
  if (!flushed.ok) return { ok: false, reason: 'storage' };
  const open = deps.openNote();
  if (open?.choiceOpen && (open.path === preview.from || preview.moves.has(open.path))) {
    return { ok: false, reason: 'choice-open' };
  }

  const moved: StoredFileMeta[] = [];
  let keptBoth = false;
  if (preview.kind === 'note') {
    // The guard is the version as last seen; a note the preview could not
    // stat has nothing to rename.
    const guard = open?.path === preview.from ? open.version : preview.guard;
    if (!guard) return { ok: false, reason: 'missing' };
    const r = await attempt(() => renameOne(deps, preview.from, preview.to, guard));
    if (!r.ok && r.refusal) return { ok: false, reason: 'storage', ...r.refusal };
    if (!r.ok) return { ok: false, reason: 'storage' };
    if (!r.value.ok) return { ok: false, reason: r.value.conflict, theirs: r.value.theirs };
    keptBoth = Boolean(r.value.keptBoth);
    moved.push(r.value.file);
  } else if (provider.renameFolder) {
    const r = await attempt(() =>
      provider.renameFolder!(target.resourceId, preview.from, preview.to),
    );
    if (!r.ok && r.refusal) return { ok: false, reason: 'storage', ...r.refusal };
    if (!r.ok) return { ok: false, reason: 'storage' };
    if (!r.value.ok) return { ok: false, reason: r.value.conflict };
    const at = new Date(deps.now?.() ?? Date.now()).toISOString();
    for (const m of r.value.moved) {
      if (!MD_END.test(m.to)) continue;
      moved.push({ path: m.to, updatedAt: at, size: 0, version: m.version });
    }
  } else {
    // No folder rename on this storage (Local): note by note, stopping on
    // the first failure and saying which moved (K5).
    for (const [from, to] of preview.moves) {
      if (!MD_END.test(from)) continue;
      const r = await attempt(async () => {
        const meta = await provider.stat(target.resourceId, from);
        if (!meta) return { ok: false as const, conflict: 'missing' as const };
        return renameOne(deps, from, to, versionOf(meta));
      });
      // Gone since the plan was made (a teammate deleted or moved it, and
      // the index had not caught up): nothing is left to move and nothing
      // is lost, so the rest still move (round 5 sweep).
      if (r.ok && !r.value.ok && r.value.conflict === 'missing') continue;
      const failed = !r.ok ? 'storage' : !r.value.ok ? r.value.conflict : undefined;
      if (failed || !r.ok || !r.value.ok) {
        await settleMoved(deps, preview, moved);
        if (!r.ok && r.refusal) {
          return { ok: false, reason: moved.length ? 'partial' : 'storage', moved, ...r.refusal };
        }
        // A conflict stopped it: carry which, where, and what is there.
        if (r.ok && !r.value.ok) {
          const { conflict, theirs } = r.value;
          return {
            ok: false,
            reason: moved.length ? 'partial' : conflict,
            moved,
            stoppedOn: conflict,
            stoppedAt: to,
            ...(theirs ? { theirs } : {}),
          };
        }
        return { ok: false, reason: moved.length ? 'partial' : (failed ?? 'storage'), moved };
      }
      moved.push(r.value.file);
    }
  }
  await settleMoved(deps, preview, moved);

  if (!opts.updateLinks || !preview.plan.edits.length) {
    return { ok: true, preview, moved, ...(keptBoth ? { keptBoth } : {}) };
  }
  const rewrite = await rewritePass(deps, preview, moved, opts.onProgress);
  return { ok: true, preview, moved, rewrite, ...(keptBoth ? { keptBoth } : {}) };
}

/** The vault's paths after the moves, attachments that moved included, for
 *  the path indexes a re-plan resolves against. */
function pathsAfter(deps: VaultOpsDeps, moves: ReadonlyMap<string, string>): string[] {
  const out = new Set(indexedPaths(deps).map((p) => moves.get(p) ?? p));
  // A moved path the index already holds (at the spelling the storage gave
  // it) is not added again under the spelling asked for.
  const folded = new Set([...out].map(foldPath));
  for (const to of moves.values()) if (!folded.has(foldPath(to))) out.add(to);
  return [...out];
}

/** Patch the list, the body cache and the index, and re-key what each moved
 *  path owns on this device (pins, stash, the recent ring, the open note). */
async function settleMoved(
  deps: VaultOpsDeps,
  preview: VaultMovePreview,
  moved: readonly StoredFileMeta[],
): Promise<void> {
  const back = new Map<string, string>();
  for (const [from, to] of preview.moves) back.set(foldPath(to), from);
  for (const file of moved) {
    const from = back.get(foldPath(file.path));
    if (from === undefined) continue;
    deps.patch.renamed(from, file);
    await deps.rekey(from, file.path).catch(() => {});
  }
}

/** The rewrite pass (R1). Each note is its own compare-and-swap write, one at
 *  a time. A note whose version moved is re-read and re-planned once (the
 *  rewrite is mechanical, so nobody's words are overridden); a second
 *  refusal, a `downloading` answer, or the note open here with unsaved edits
 *  or an open choice skips it, and the pass goes on. Only a storage-level
 *  failure stops it, and the rest are listed as not updated. */
async function rewritePass(
  deps: VaultOpsDeps,
  preview: VaultMovePreview,
  moved: readonly StoredFileMeta[],
  onProgress?: (i: number, m: number) => void,
  only?: ReadonlySet<string>,
): Promise<VaultRewriteReport> {
  const report: VaultRewriteReport = {
    updated: 0,
    total: 0,
    notesUpdated: 0,
    skipped: [],
    notUpdated: [],
    stopped: false,
  };
  // A moved note is re-based on the version the move answered with, never
  // assumed to equal the old one (K3).
  const movedVersion = new Map<string, string>();
  for (const m of moved) if (m.version) movedVersion.set(foldPath(m.path), m.version);
  // A moved note is written where the storage put it, which may differ from
  // the path asked for in case (a parent matched to its spelling on disk).
  const landedAt = new Map<string, string>();
  for (const m of moved) landedAt.set(foldPath(m.path), m.path);
  const at = (path: string) => landedAt.get(foldPath(path)) ?? path;
  const beforeOf = new Map<string, string>();
  for (const s of preview.sources) beforeOf.set(s.after, s.before);
  const known = pathsAfter(deps, preview.moves);
  const reverse = new Map<string, string>();
  for (const [from, to] of preview.moves) reverse.set(foldPath(to), from);
  const beforeIdx = buildPathIndex(known.map((p) => reverse.get(foldPath(p)) ?? p));
  const afterIdx = buildPathIndex(known);

  const edits = preview.plan.edits.filter((e) => !only || only.has(e.path));
  for (const e of edits) report.total += e.count;
  const replan = (edit: LinkRewriteEdit, fresh: StoredFile): LinkRewriteEdit | undefined => {
    const before = beforeOf.get(edit.path) ?? reverse.get(foldPath(edit.path)) ?? edit.path;
    const p = planLinkRewrites(preview.moves, beforeIdx, afterIdx, [
      { path: before, text: fresh.text, version: versionOf(fresh) },
    ]);
    return p.edits[0];
  };

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (report.stopped) {
      report.notUpdated.push(at(edit.path));
      continue;
    }
    onProgress?.(i + 1, edits.length);
    const path = at(edit.path);
    const open = deps.openNote();
    if (open && open.path === path && (open.dirty || open.choiceOpen)) {
      report.skipped.push({ path, reason: 'open' });
      continue;
    }
    const base = movedVersion.get(foldPath(edit.path)) ?? edit.base;
    const first = await attempt(() => deps.putVaultNote(path, edit.text, { ifMatch: base }));
    if (!first.ok) {
      report.stopped = true;
      if (first.refusal) report.refusal ??= first.refusal;
      report.notUpdated.push(path);
      continue;
    }
    let result: WriteResult = first.value;
    let count = edit.count;
    if (!result.ok && result.conflict === 'changed') {
      // Once, silently: read what is there now and plan against it.
      const again = await attempt(async () => {
        const fresh = await deps.provider.read(deps.target.resourceId, path);
        if (!fresh) return { kind: 'missing' as const };
        const next = replan(edit, fresh);
        if (!next) return { kind: 'nothing' as const };
        count = next.count;
        return {
          kind: 'wrote' as const,
          result: await deps.putVaultNote(path, next.text, { ifMatch: versionOf(fresh) }),
        };
      });
      if (!again.ok) {
        report.stopped = true;
        if (again.refusal) report.refusal ??= again.refusal;
        report.notUpdated.push(path);
        continue;
      }
      if (again.value.kind === 'missing') {
        report.skipped.push({ path, reason: 'missing' });
        continue;
      }
      // Someone else already fixed the links: nothing left to write.
      if (again.value.kind === 'nothing') {
        report.total -= edit.count;
        continue;
      }
      result = again.value.result;
    }
    if (result.ok) {
      report.updated += count;
      report.notesUpdated += 1;
      continue;
    }
    report.skipped.push({
      path,
      reason:
        result.conflict === 'missing'
          ? 'missing'
          : result.conflict === 'downloading'
            ? 'downloading'
            : 'changed',
    });
  }
  return report;
}

/** "Update the rest" on the standing card (CX X7): re-plan the notes the
 *  last pass skipped or never reached, from fresh reads, and run the pass
 *  over them again. */
export async function updateTheRest(
  deps: VaultOpsDeps,
  preview: VaultMovePreview,
  report: VaultRewriteReport,
  onProgress?: (i: number, m: number) => void,
): Promise<VaultRewriteReport> {
  const rest = new Set([
    ...report.skipped.filter((s) => s.reason !== 'missing').map((s) => s.path),
    ...report.notUpdated,
  ]);
  if (!rest.size) return { ...report, skipped: [], notUpdated: [], stopped: false };
  const reverse = new Map<string, string>();
  for (const [from, to] of preview.moves) reverse.set(foldPath(to), from);
  const known = pathsAfter(deps, preview.moves);
  const beforeIdx = buildPathIndex(known.map((p) => reverse.get(foldPath(p)) ?? p));
  const afterIdx = buildPathIndex(known);
  const reads: LinkRewriteSource[] = [];
  const sources: RewriteSource[] = [];
  const failed = await attempt(async () => {
    for (const after of rest) {
      const file = await deps.provider.read(deps.target.resourceId, after);
      if (!file) continue;
      const before = reverse.get(foldPath(after)) ?? after;
      reads.push({ path: before, text: file.text, version: versionOf(file) });
      sources.push({ before, after });
    }
  });
  if (!failed.ok) {
    return {
      updated: 0,
      total: 0,
      notesUpdated: 0,
      skipped: [],
      notUpdated: [...rest],
      stopped: true,
      ...(failed.refusal ? { refusal: failed.refusal } : {}),
    };
  }
  const plan = reads.length
    ? planLinkRewrites(preview.moves, beforeIdx, afterIdx, reads)
    : { edits: [], links: 0, notes: 0, left: [] };
  return rewritePass(deps, { ...preview, plan, sources }, [], onProgress);
}

// ---- folders (K5) -----------------------------------------------------------

/** How much a folder holds, for the sheet's counts before it acts. */
export async function folderCounts(
  deps: VaultOpsDeps,
  folder: string,
): Promise<{ notes: number; attachments: number }> {
  const notes = indexedPaths(deps).filter((p) => inFolder(p, folder)).length;
  const files = await attempt(() => folderAttachments(deps, folder));
  return { notes, attachments: files.ok ? files.value.length : 0 };
}

/** Check a folder name: every segment passes the one new-name rule. */
export function checkFolderName(path: string): boolean {
  const clean = path.trim().replace(/^\/+|\/+$/g, '');
  if (!clean) return false;
  if (/[[\]#^|\\:*?"<>]/.test(clean)) return false;
  const check = checkNewNoteName(`${clean}/n.md`);
  return check.ok && check.path === `${clean}/n.md`;
}

/** Make a folder. Where the storage has real folders it is made there; on a
 *  storage without them (Local) it is `remembered`: the store keeps it per
 *  vault in device settings until a note lands in it. */
export async function createFolder(
  deps: VaultOpsDeps,
  path: string,
): Promise<
  { ok: true; remembered: boolean } | { ok: false; reason: 'bad-name' | 'exists' | VaultOpFailure }
> {
  const clean = path.trim().replace(/^\/+|\/+$/g, '');
  if (!checkFolderName(clean)) return { ok: false, reason: 'bad-name' };
  if (indexedPaths(deps).some((p) => inFolder(p, clean))) return { ok: false, reason: 'exists' };
  if (!deps.provider.createFolder) return { ok: true, remembered: true };
  const r = await attempt(() => deps.provider.createFolder!(deps.target.resourceId, clean));
  if (!r.ok) return { ok: false, reason: 'storage' };
  return r.value.ok ? { ok: true, remembered: false } : { ok: false, reason: 'exists' };
}

// ---- delete, Trash and Undo (K6 with R2 and R3; CX X8 to X10) ---------------

/** What Undo puts back: a Trash entry where Trash is real, else the bytes
 *  held in memory (a courtesy only, never what makes one tap safe, R2). */
export type VaultUndo =
  | { kind: 'trash'; id: string; path: string; folder: boolean; notes: number }
  | { kind: 'bytes'; path: string; text: string };

export type VaultDeleteResult =
  | {
      ok: true;
      trashed: boolean;
      undo: VaultUndo;
      notes: number;
      attachments: number;
      /** A folder that went to Trash only in part (the team vault, round 7
       *  E20): the Undo brings back exactly what went. */
      partial?: TrashPartial;
    }
  | {
      ok: false;
      reason: 'changed' | 'downloading' | 'missing' | VaultOpFailure;
      theirs?: StoredFile;
      /** A refusal for good (VaultRefusal): its line, and `whole` when it is
       *  the whole line to say (the admins-only delete, CX Y14). */
      line?: string;
      whole?: true;
    };

/** Is Trash real on this storage? One tap deletes only where it is (R2). */
export function hasRealTrash(provider: StorageProvider): boolean {
  return Boolean(provider.compareAndSwap && provider.trash && provider.restore);
}

/** Delete one note. Where Trash is real it moves there, guarded by the
 *  version this device last saw; elsewhere it is removed for good by the same
 *  guard, and its bytes are kept in memory for the courtesy Undo. The open
 *  note's pending save is flushed first, so what goes to Trash is what the
 *  person last typed. */
export async function deleteNote(deps: VaultOpsDeps, path: string): Promise<VaultDeleteResult> {
  const { provider, target } = deps;
  const run = await attempt(async (): Promise<VaultDeleteResult> => {
    await deps.flushOpenSave();
    const ifMatch = await guardFor(deps, path);
    if (!ifMatch) return { ok: false, reason: 'missing' };
    if (hasRealTrash(provider)) {
      const r = await provider.trash!(target.resourceId, { kind: 'note', path, ifMatch });
      if (!r.ok) return { ok: false, reason: r.conflict, theirs: r.theirs };
      deps.patch.removed(path);
      return {
        ok: true,
        trashed: true,
        undo: { kind: 'trash', id: r.entry.id, path, folder: false, notes: 1 },
        notes: 1,
        attachments: 0,
      };
    }
    const text = await deps.readBody(path);
    if (text === undefined) return { ok: false, reason: 'missing' };
    const r = await provider.remove(target.resourceId, path, { ifMatch });
    if (!r.ok) return { ok: false, reason: r.conflict, theirs: r.theirs };
    deps.patch.removed(path);
    return {
      ok: true,
      trashed: false,
      undo: { kind: 'bytes', path, text },
      notes: 1,
      attachments: 0,
    };
  });
  if (!run.ok && run.refusal) return { ok: false, reason: 'storage', ...run.refusal };
  return run.ok ? run.value : { ok: false, reason: 'storage' };
}

/** Move a folder to Trash, whatever is in it (Trash is recoverable, so the
 *  move is unguarded, K6). Only where Trash is real: a folder is never
 *  deleted for good in one step. */
export async function deleteFolder(deps: VaultOpsDeps, folder: string): Promise<VaultDeleteResult> {
  const { provider, target } = deps;
  if (!hasRealTrash(provider)) return { ok: false, reason: 'unsupported' };
  const run = await attempt(async (): Promise<VaultDeleteResult> => {
    await deps.flushOpenSave();
    // The notes inside, as known before the move (the index follows after).
    const inside = indexedPaths(deps).filter((p) => inFolder(p, folder));
    const r: TrashReport = await provider.trash!(target.resourceId, {
      kind: 'folder',
      path: folder,
    });
    if (!r.ok) return { ok: false, reason: r.conflict, theirs: r.theirs };
    // Stopped part way: only what went leaves the list (E20).
    const left = new Set(r.partial?.left ?? []);
    for (const p of inside) if (!left.has(p)) deps.patch.removed(p);
    return {
      ok: true,
      trashed: true,
      undo: { kind: 'trash', id: r.entry.id, path: folder, folder: true, notes: r.notes },
      notes: r.notes,
      attachments: r.attachments,
      ...(r.partial ? { partial: r.partial } : {}),
    };
  });
  if (!run.ok && run.refusal) return { ok: false, reason: 'storage', ...run.refusal };
  return run.ok ? run.value : { ok: false, reason: 'storage' };
}

/** A restore or an Undo. Beside the plain answers: a folder that came back
 *  only in part (`partial`, a team near its free space, 0023), and a refusal
 *  for good (VaultRefusal: the storage's line, or the store's own whole line
 *  for a lapsed team plan, refused before the server is asked). */
export type VaultRestoreResult =
  | { ok: true; path: string; renamed: boolean; partial: RestorePartial }
  /** No longer in Trash (restored or cleared elsewhere): the store's line. */
  | { ok: false; reason: 'missing'; line: string; whole: true }
  | ({ ok: false; reason: VaultOpFailure } & VaultRefusal)
  | { ok: true; path: string; renamed: boolean }
  | { ok: false; reason: 'missing' | 'exists' | VaultOpFailure };

/** Put a restored or re-created note into the list, the body cache and the
 *  index. A read that fails leaves the next listing to find it. */
async function adopt(deps: VaultOpsDeps, meta: StoredFileMeta): Promise<void> {
  if (!MD_END.test(meta.path)) return;
  const file = await attempt(() => deps.provider.read(deps.target.resourceId, meta.path));
  if (file.ok && file.value) deps.patch.saved(file.value);
}

/** Undo a delete. From Trash it is a restore; from memory it re-creates the
 *  note only while the name is free, else beside it as "{title} (restored)"
 *  (never overwriting, R3). */
export async function undoDelete(deps: VaultOpsDeps, undo: VaultUndo): Promise<VaultRestoreResult> {
  if (undo.kind === 'trash') return restoreEntry(deps, undo.id);
  const first = await attempt(() => deps.putVaultNote(undo.path, undo.text, { ifAbsent: true }));
  if (!first.ok && first.refusal) return { ok: false, reason: 'storage', ...first.refusal };
  if (!first.ok) return { ok: false, reason: 'storage' };
  if (first.value.ok) return { ok: true, path: first.value.file.path, renamed: false };
  if (first.value.conflict !== 'exists') return { ok: false, reason: 'storage' };
  const beside = restoredPath(undo.path);
  const second = await attempt(() => deps.putVaultNote(beside, undo.text, { ifAbsent: true }));
  if (!second.ok && second.refusal) return { ok: false, reason: 'storage', ...second.refusal };
  if (!second.ok) return { ok: false, reason: 'storage' };
  if (second.value.ok) return { ok: true, path: second.value.file.path, renamed: true };
  return { ok: false, reason: 'exists' };
}

/** What is in Trash, newest first where the storage says when. */
export async function listTrash(
  deps: VaultOpsDeps,
): Promise<{ ok: true; entries: TrashEntry[] } | { ok: false; reason: VaultOpFailure }> {
  if (!deps.provider.listTrash) return { ok: false, reason: 'unsupported' };
  const r = await attempt(() => deps.provider.listTrash!(deps.target.resourceId));
  if (!r.ok) return { ok: false, reason: 'storage' };
  const entries = [...r.value].sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
  return { ok: true, entries };
}

/** Restore one Trash entry where it came from, never overwriting. */
export async function restoreEntry(deps: VaultOpsDeps, id: string): Promise<VaultRestoreResult> {
  if (!deps.provider.restore) return { ok: false, reason: 'unsupported' };
  const r = await attempt(() => deps.provider.restore!(deps.target.resourceId, id));
  if (!r.ok && r.refusal) return { ok: false, reason: 'storage', ...r.refusal };
  if (!r.ok) return { ok: false, reason: 'storage' };
  if (!r.value.ok) return { ok: false, reason: 'missing' };
  await adopt(deps, r.value.file);
  // A folder that came back only in part says how many, and which stayed.
  const report: RestoreReport = r.value;
  if (report.partial) {
    return {
      ok: true,
      path: r.value.file.path,
      renamed: r.value.renamed,
      partial: report.partial,
    };
  }
  return { ok: true, path: r.value.file.path, renamed: r.value.renamed };
}

/** Empty Trash, or delete the named entries for good. `asked` is how many
 *  were meant to go, so a partial result can say how many stayed. */
export async function emptyTrash(
  deps: VaultOpsDeps,
  ids?: string[],
): Promise<{ ok: true; removed: number; asked: number } | { ok: false; reason: VaultOpFailure }> {
  if (!deps.provider.emptyTrash || !deps.provider.listTrash) {
    return { ok: false, reason: 'unsupported' };
  }
  const r = await attempt(async () => {
    const asked = ids?.length ?? (await deps.provider.listTrash!(deps.target.resourceId)).length;
    const done = await deps.provider.emptyTrash!(deps.target.resourceId, ids);
    return { asked, removed: done.removed };
  });
  return r.ok ? { ok: true, ...r.value } : { ok: false, reason: 'storage' };
}

// ---- Today (K7; CX X11) -----------------------------------------------------

/** Today's note as lib/vaultToday.ts (stream H) works it out: the path from
 *  the daily-notes settings and the text a new one starts with. */
export interface VaultTodayPlan {
  path: string;
  text: string;
}

export type VaultTodayResult =
  | { ok: true; created: false; path: string }
  | { ok: true; created: true; file: StoredFile }
  | ({ ok: false; reason: 'storage' } & VaultRefusal)
  | { ok: false; reason: 'downloading' | VaultOpFailure };

/** Open today's note, creating it only while nothing has the name: a note the
 *  index already knows opens as it is, with no write at all, and a create
 *  that finds the name taken opens what is there, byte for byte. */
export async function openToday(
  deps: VaultOpsDeps,
  plan: VaultTodayPlan,
): Promise<VaultTodayResult> {
  const folded = foldPath(plan.path);
  const known = indexedPaths(deps).find((p) => foldPath(p) === folded);
  if (known !== undefined) return { ok: true, created: false, path: known };
  if (!deps.provider.compareAndSwap) return { ok: false, reason: 'unsupported' };
  const r = await attempt(() => deps.putVaultNote(plan.path, plan.text, { ifAbsent: true }));
  if (!r.ok && r.refusal) return { ok: false, reason: 'storage', ...r.refusal };
  if (!r.ok) return { ok: false, reason: 'storage' };
  if (r.value.ok) return { ok: true, created: true, file: r.value.file };
  if (r.value.conflict === 'exists') {
    return { ok: true, created: false, path: r.value.theirs?.path ?? plan.path };
  }
  if (r.value.conflict === 'downloading') return { ok: false, reason: 'downloading' };
  return { ok: false, reason: 'storage' };
}

// ---- checkbox write-back (K11; CX X13) --------------------------------------

export type VaultTickResult =
  | { ok: true; file: StoredFile; status: string }
  /** Refused for good (a team plan not active, OV402): the storage's line. */
  | ({ ok: false; reason: 'storage' } & VaultRefusal)
  | { ok: false; reason: 'moved' | 'custom' | 'none' | VaultOpFailure }
  | {
      ok: false;
      reason: 'changed' | 'missing' | 'downloading';
      /** What is there now, for the store's existing resolve path. */
      theirs?: StoredFile;
    };

/** One tick at a time per note: each toggle runs on the version the last one
 *  returned (K11). */
const tickChains = new Map<string, Promise<unknown>>();

/** Tick or untick one task box: flush any pending save, read the note once,
 *  toggle on that text and write it guarded by that same version, so the
 *  tick is made on the text it is guarded by (round 7 E2). The open note
 *  must still be the version read, and the text read must be `seen`, the
 *  text the box's offset was counted on, when given; otherwise nothing is
 *  written and the result is `changed` with what is there now. A refused
 *  write is a result for the store's resolve path; the box then shows the
 *  file's truth. */
export function toggleTask(
  deps: VaultOpsDeps,
  path: string,
  at: number,
  expected: string,
  seen?: string,
): Promise<VaultTickResult> {
  const key = JSON.stringify([deps.target.providerId, deps.target.resourceId, path]);
  const before = tickChains.get(key) ?? Promise.resolve();
  const run = before.then(() => tickOnce(deps, path, at, expected, seen));
  const link = run.catch(() => undefined);
  tickChains.set(key, link);
  void link.then(() => {
    if (tickChains.get(key) === link) tickChains.delete(key);
  });
  return run;
}

async function tickOnce(
  deps: VaultOpsDeps,
  path: string,
  at: number,
  expected: string,
  seen: string | undefined,
): Promise<VaultTickResult> {
  if (!deps.provider.compareAndSwap) return { ok: false, reason: 'unsupported' };
  const run = await attempt(async (): Promise<VaultTickResult> => {
    await deps.flushOpenSave();
    const open = deps.openNote();
    const file = await deps.provider.read(deps.target.resourceId, path);
    if (!file) return { ok: false, reason: 'missing' };
    const ifMatch = versionOf(file);
    if (!ifMatch) return { ok: false, reason: 'missing' };
    // Moved on since the person saw it: nothing is ticked on text they
    // have not seen, and the store opens the newer version.
    if (
      (open?.path === path && open.version !== ifMatch) ||
      (seen !== undefined && seen !== file.text)
    ) {
      return { ok: false, reason: 'changed', theirs: file };
    }
    const toggled = toggleTaskAt(file.text, at, expected);
    if (!toggled.ok) return { ok: false, reason: toggled.reason };
    const r = await deps.putVaultNote(path, toggled.text, { ifMatch });
    if (r.ok) return { ok: true, file: r.file, status: toggled.status };
    const reason = r.conflict === 'exists' ? 'changed' : r.conflict;
    return { ok: false, reason, theirs: r.theirs };
  });
  if (!run.ok && run.refusal) return { ok: false, reason: 'storage', ...run.refusal };
  return run.ok ? run.value : { ok: false, reason: 'storage' };
}

// ---- end stream G -----------------------------------------------------------
