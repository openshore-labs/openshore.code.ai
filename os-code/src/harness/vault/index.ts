// The Vault index (Vault M3, CTO H3): one entry per note, the links between
// notes, and BM25 search, kept current one write at a time. Pure: hosts own
// every read, write, listing and file, and feed the index text they already
// hold. The phone runs this same file, so it imports no Node (harnessPurity).
//
// What is persisted is the entry list (serializeIndex / loadIndex). What is
// derived is rebuilt in memory on load and never written: each note's resolved
// links, the reverse-link map, the folded-basename map, document frequencies
// and the average document length.
//
// The note grammar (scanNote, readFrontmatter) and link resolution
// (buildPathIndex, resolveWikilink, resolveMarkdownLink) live in the shared
// core beside this file. The index takes them as one injected `VaultIndexCore`
// rather than importing them, so a host can hand in the same functions it
// already uses and a test can hand in a small stand-in.
//
// Resolution is incremental by folded basename. Every resolution rule (exact
// path, relative, whole-segment suffix, the cleaned-name fallback) only ever
// lands on a path whose last segment matches the link's, so adding or removing
// a path whose folded basename is `b` re-resolves only the sources in
// `linksByTargetBase.get(b)`. Resolution is lazy: writes mark sources dirty and
// the first query after them resolves the dirty set once, which is what makes
// a cold build of 5,000 notes one pass instead of 5,000.
import type {
  Frontmatter,
  FmState,
  IndexHeading,
  IndexLink,
  LinkToken,
  NoteScan,
  OscodeMark,
  ReconcilePlan,
  VaultBacklink,
  VaultIndexEntry,
  VaultIndexFile,
  VaultIndexState,
  VaultListedNote,
  VaultPathIndex,
  VaultSearchHit,
} from './types.js';
import { oscodeMarks } from './privacy.js';
import { BODY_STOPWORDS, eachTerm, queryTerms } from './tokenize.js';

// ---------------------------------------------------------------------------
// Constants

/** Bump on any change to what an entry holds or how it is derived (the index,
 *  the tokenizer, or the scanner it is fed). A persisted file with another
 *  version is thrown away and the vault is rebuilt. 2: entries carry the
 *  note's `oscode` marks (Vault M4, CTO I4). */
export const CORE_VERSION = 2;

/** Notes indexed at most; above it the first ones in path order are indexed
 *  and the state is `partial` (the same cap as the M1 walk). */
export const INDEX_MAX_NOTES = 10_000;
/** A body over this many UTF-8 bytes is indexed for metadata only. */
export const INDEX_BODY_MAX_BYTES = 2 * 1024 * 1024;
/** Distinct body terms kept per note. */
export const INDEX_MAX_BODY_TERMS = 20_000;
/** The persisted index's cap per host. Over it, the file is saved without
 *  term vectors (`terms: 'memory'`). */
export const INDEX_FILE_MAX_BYTES = { desktop: 32 * 1024 * 1024, phone: 16 * 1024 * 1024 };

/** BM25 parameters and the field weights of a note's term counts. */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const TERM_WEIGHTS = { title: 3, alias: 3, heading: 2, tag: 2, body: 1 } as const;

/** Cold build pacing, shared by every host (H3 "Cold build"). */
export const INDEX_READ_CONCURRENCY = { folder: 8, local: 4, team: 4, icloud: 2, drive: 2 };
export const INDEX_SLICE_MS = 8;
export const INDEX_PROGRESS_EVERY_MS = 250;
export const INDEX_CHECKPOINT_NOTES = 1000;
export const INDEX_CHECKPOINT_MS = 10_000;
/** The Vault shows "Indexing N of M notes" only after this long. */
export const INDEX_PROGRESS_SHOW_AFTER_MS = 1500;

// ---------------------------------------------------------------------------
// The injected core

/** The shared core's grammar and resolution, as the index needs them. The
 *  functions in `scan.ts`, `frontmatter.ts`, `resolve.ts` and `paths.ts`
 *  satisfy it as they are. */
export interface VaultIndexCore {
  scanNote(text: string): NoteScan;
  readFrontmatter(text: string): Frontmatter;
  buildPathIndex(paths: readonly string[]): VaultPathIndex;
  resolveWikilink(
    target: string,
    index: VaultPathIndex,
    sourcePath?: string,
  ): string | null | undefined;
  resolveMarkdownLink(
    href: string,
    sourcePath: string,
    index: VaultPathIndex,
  ): string | null | undefined;
  /** The cleaned-name rule, used only to register a link under the basename
   *  its last-resort fallback would reach. Optional. */
  normalizeNotePath?(raw: string): string | null | undefined;
}

// ---------------------------------------------------------------------------
// Small pure helpers

/** The version a listing carries: the provider's own, else its updatedAt
 *  (the app's `versionOf`). */
export function listedVersion(meta: { version?: string; updatedAt: string }): string {
  return meta.version ?? meta.updatedAt;
}

/** Code-point order, the tie-break every list here uses. */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // Surrogates (astral code points) sort after every BMP character.
    const xs = x >= 0xd800 && x <= 0xdfff;
    const ys = y >= 0xd800 && y <= 0xdfff;
    if (xs !== ys) return xs ? 1 : -1;
    return x - y;
  }
  return a.length - b.length;
}

/** UTF-8 byte length without an encoder. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

const MD = /\.md$/i;

function isIndexable(path: string): boolean {
  return MD.test(path);
}

function fold(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

function lastSegment(s: string): string {
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
}

function stripMd(s: string): string {
  return s.replace(/\.md$/, '');
}

/** The key a path is filed under: its folded basename without `.md`. */
export function pathBaseKey(path: string): string {
  return stripMd(fold(lastSegment(path)));
}

/** The keys a link target is filed under. `[[x.md]]` may reach `x.md` or
 *  `x.md.md`, so it is filed under both `x` and `x.md`; the cleaned-name
 *  fallback's basename is filed too when the core offers the rule. */
function linkBaseKeys(link: IndexLink, core: VaultIndexCore): string[] {
  const keys = new Set<string>();
  const add = (target: string) => {
    const last = fold(lastSegment(target.replace(/\\/g, '/')));
    if (!last) return;
    keys.add(stripMd(last));
    if (last.endsWith('.md')) keys.add(last);
  };
  add(link.target);
  const cleaned = core.normalizeNotePath?.(link.target);
  if (cleaned) add(cleaned);
  return [...keys];
}

/** The note's title: its file name without `.md`. */
function titleOf(path: string): string {
  return lastSegment(path).replace(MD, '');
}

// ---------------------------------------------------------------------------
// Reconcile

/** `planReconcile` with the two extras a host needs: evicted files with no
 *  entry yet (index them title-only, never download), and whether the listing
 *  went over the note cap. */
export interface VaultReconcilePlan extends ReconcilePlan {
  placeholder: string[];
  partial: boolean;
}

/** Compare the index against a listing. Only `listedVersion(meta)` against
 *  `entry.version` decides: never mtime, size or updatedAt on their own.
 *  Non-notes are ignored; over `maxNotes`, the first ones in path order are
 *  kept. An evicted file keeps its old entry, or becomes a placeholder. */
export function planReconcile(
  entries: Iterable<Pick<VaultIndexEntry, 'path' | 'version'>>,
  listed: readonly VaultListedNote[],
  opts: { maxNotes?: number } = {},
): VaultReconcilePlan {
  const max = opts.maxNotes ?? INDEX_MAX_NOTES;
  const seen = new Map<string, VaultListedNote>();
  for (const n of listed) if (isIndexable(n.path) && !seen.has(n.path)) seen.set(n.path, n);
  const notes = [...seen.values()].sort((a, b) => compareCodePoints(a.path, b.path));
  const partial = notes.length > max;
  const taken = partial ? notes.slice(0, max) : notes;

  const byPath = new Map<string, Pick<VaultIndexEntry, 'path' | 'version'>>();
  for (const e of entries) byPath.set(e.path, e);

  const read: string[] = [];
  const keep: string[] = [];
  const placeholder: string[] = [];
  const takenPaths = new Set<string>();
  for (const n of taken) {
    takenPaths.add(n.path);
    const e = byPath.get(n.path);
    if (n.evicted) {
      if (e) keep.push(n.path);
      else placeholder.push(n.path);
    } else if (e && e.version === listedVersion(n)) keep.push(n.path);
    else read.push(n.path);
  }
  const drop: string[] = [];
  for (const path of byPath.keys()) if (!takenPaths.has(path)) drop.push(path);
  drop.sort(compareCodePoints);
  return { read, drop, keep, placeholder, partial };
}

// ---------------------------------------------------------------------------
// The index

/** A note as the index holds it in memory: the persisted entry minus its
 *  encoded term string. */
export type IndexedNote = Omit<VaultIndexEntry, 'terms'>;

/** One outgoing link with where it resolved (null: unresolved). */
export interface ResolvedLink {
  link: IndexLink;
  resolved: string | null;
}

interface TermVec {
  /** Term ids, ascending. */
  ids: Int32Array;
  tfs: Int32Array;
  /** Weighted length (the sum of tfs). */
  len: number;
}

interface Doc {
  note: IndexedNote;
  /** Null when the vectors were not persisted (`terms: 'memory'`) and the
   *  note has not been fed again since. */
  vec: TermVec | null;
  /** Aligned with note.links; empty until the first resolve. */
  resolved: (string | null)[];
  /** The basename keys this note's links are filed under. */
  bases: string[];
}

export interface VaultIndexOptions {
  maxNotes?: number;
}

/** Counters a test reads to prove an update stayed local. */
export interface VaultIndexCounters {
  /** Entries built from text (applyWrite) or as placeholders. */
  entriesBuilt: number;
  /** Sources whose links were resolved. */
  sourcesResolved: number;
  /** Times the path index was rebuilt. */
  pathIndexBuilds: number;
}

export class VaultIndex {
  readonly core: VaultIndexCore;
  readonly maxNotes: number;
  readonly counters: VaultIndexCounters = {
    entriesBuilt: 0,
    sourcesResolved: 0,
    pathIndexBuilds: 0,
  };

  private readonly docs = new Map<string, Doc>();
  private readonly dict: string[] = [];
  private readonly dictIds = new Map<string, number>();
  private df: Int32Array = new Int32Array(1024);
  private totalLen = 0;
  private vecCount = 0;
  private readonly reverse = new Map<string, Map<string, number[]>>();
  private readonly linksByTargetBase = new Map<string, Set<string>>();
  private pathIndex: VaultPathIndex | null = null;
  private readonly dirty = new Set<string>();
  private building = false;
  private partial = false;

  constructor(core: VaultIndexCore, opts: VaultIndexOptions = {}) {
    this.core = core;
    this.maxNotes = opts.maxNotes ?? INDEX_MAX_NOTES;
  }

  // ---- state -------------------------------------------------------------

  get state(): VaultIndexState {
    if (this.building) return 'building';
    if (this.partial) return 'partial';
    return this.docs.size === 0 ? 'empty' : 'ready';
  }

  /** A cold build or a reconcile is under way. */
  beginBuild(): void {
    this.building = true;
  }

  endBuild(): void {
    this.building = false;
  }

  get size(): number {
    return this.docs.size;
  }

  has(path: string): boolean {
    return this.docs.has(path);
  }

  /** Every indexed path, in code-point order. */
  paths(): string[] {
    return [...this.docs.keys()].sort(compareCodePoints);
  }

  entry(path: string): IndexedNote | undefined {
    return this.docs.get(path)?.note;
  }

  /** Every entry, in no set order (what planReconcile takes). */
  entries(): IndexedNote[] {
    return [...this.docs.values()].map((d) => d.note);
  }

  /** Notes whose term vectors were not persisted and must be fed again
   *  (applyWrite) before search sees their bodies. */
  missingTerms(): string[] {
    const out: string[] = [];
    for (const [path, d] of this.docs) if (!d.vec && !d.note.evicted) out.push(path);
    return out.sort(compareCodePoints);
  }

  // ---- updates -----------------------------------------------------------

  /** Compare against a listing and apply what needs no read: drops, and
   *  placeholders for evicted files. Returns the plan; the host reads
   *  `plan.read` and feeds each through applyWrite. */
  applyListing(listed: readonly VaultListedNote[]): VaultReconcilePlan {
    const plan = planReconcile(this.entries(), listed, { maxNotes: this.maxNotes });
    for (const path of plan.drop) this.applyRemove(path);
    const byPath = new Map(listed.map((n) => [n.path, n]));
    for (const path of plan.placeholder) this.applyPlaceholder(byPath.get(path)!);
    this.partial = plan.partial;
    return plan;
  }

  /** Index a note's text (a write, or a read after a version change). The
   *  text is already in hand, so the index never reads. Touches this entry,
   *  and resolution touches only sources that link to its basename. */
  applyWrite(meta: VaultListedNote, text: string): IndexedNote | undefined {
    if (!isIndexable(meta.path)) return undefined;
    const isNew = !this.docs.has(meta.path);
    if (isNew && this.docs.size >= this.maxNotes) {
      this.partial = true;
      return undefined;
    }
    const built = this.build(meta, text);
    this.put(meta.path, built.note, built.vec, isNew);
    return built.note;
  }

  /** An evicted file with no entry: title only, never downloaded. Its
   *  version is empty, so the listing that shows it downloaded reads it. */
  applyPlaceholder(meta: VaultListedNote): IndexedNote | undefined {
    if (!isIndexable(meta.path)) return undefined;
    const isNew = !this.docs.has(meta.path);
    if (isNew && this.docs.size >= this.maxNotes) {
      this.partial = true;
      return undefined;
    }
    const note: IndexedNote = {
      ...emptyNote(meta.path),
      size: meta.size,
      updatedAt: meta.updatedAt,
      evicted: true,
    };
    const counts = new Map<number, number>();
    this.addTerms(counts, note.title, TERM_WEIGHTS.title, false);
    this.counters.entriesBuilt++;
    this.put(meta.path, note, this.vectorOf(counts), isNew);
    return note;
  }

  applyRemove(path: string): boolean {
    const doc = this.docs.get(path);
    if (!doc) return false;
    this.detach(path, doc);
    this.docs.delete(path);
    this.dirty.delete(path);
    this.pathIndex = null;
    this.dirtyBase(pathBaseKey(path));
    // Belt and braces: anything that resolved here re-resolves.
    const into = this.reverse.get(path);
    if (into) for (const src of into.keys()) if (this.docs.has(src)) this.dirty.add(src);
    return true;
  }

  // ---- queries -----------------------------------------------------------

  /** The notes that link to `path`, each with its links' offsets, sorted by
   *  source. A note's links to itself are left out. */
  backlinks(path: string): VaultBacklink[] {
    this.resolve();
    const into = this.reverse.get(path);
    if (!into) return [];
    const out: VaultBacklink[] = [];
    for (const [source, at] of into) if (source !== path) out.push({ source, at: [...at] });
    return out.sort((a, b) => compareCodePoints(a.source, b.source));
  }

  /** A note's own links, each with where it resolved. */
  outlinks(path: string): ResolvedLink[] {
    this.resolve();
    const doc = this.docs.get(path);
    if (!doc) return [];
    return doc.note.links.map((link, i) => ({ link, resolved: doc.resolved[i] ?? null }));
  }

  /** BM25 over the weighted term counts. Ties break by path. */
  search(query: string, limit = 50): VaultSearchHit[] {
    if (this.vecCount === 0) return [];
    const ids: number[] = [];
    for (const t of queryTerms(query)) {
      const id = this.dictIds.get(t);
      if (id !== undefined && this.df[id]! > 0) ids.push(id);
    }
    if (ids.length === 0) return [];
    const n = this.vecCount;
    const avgdl = this.totalLen / n || 1;
    const idf = ids.map((id) => {
      const df = this.df[id]!;
      return Math.log(1 + (n - df + 0.5) / (df + 0.5));
    });
    const hits: VaultSearchHit[] = [];
    for (const [path, d] of this.docs) {
      const v = d.vec;
      if (!v) continue;
      let score = 0;
      const norm = BM25_K1 * (1 - BM25_B + (BM25_B * v.len) / avgdl);
      for (let q = 0; q < ids.length; q++) {
        const tf = tfOf(v, ids[q]!);
        if (tf > 0) score += (idf[q]! * (tf * (BM25_K1 + 1))) / (tf + norm);
      }
      if (score > 0) hits.push({ path, score });
    }
    hits.sort((a, b) => b.score - a.score || compareCodePoints(a.path, b.path));
    return hits.slice(0, limit);
  }

  /** Resolve every dirty source now. Queries call it; a host may call it
   *  after a cold build to pay the cost up front. */
  resolve(): void {
    if (this.dirty.size === 0) return;
    if (!this.pathIndex) {
      this.pathIndex = this.core.buildPathIndex(this.paths());
      this.counters.pathIndexBuilds++;
    }
    const idx = this.pathIndex;
    for (const src of this.dirty) {
      const doc = this.docs.get(src);
      if (!doc) continue;
      this.unlinkReverse(src, doc);
      doc.resolved = doc.note.links.map((l) => this.resolveOne(l, src, idx));
      this.linkReverse(src, doc);
      this.counters.sourcesResolved++;
    }
    this.dirty.clear();
  }

  // ---- persistence -------------------------------------------------------

  /** The persisted shape. With `withTerms: false`, every entry's vectors are
   *  left in memory (`terms: 'memory'`). */
  toFile(opts: { withTerms?: boolean } = {}): VaultIndexFile {
    const withTerms = opts.withTerms ?? true;
    // The file's dictionary keeps the live terms in id order, so every
    // vector's ids stay ascending and a load never has to sort them.
    const dict: string[] = [];
    const remap = new Int32Array(this.dict.length).fill(-1);
    if (withTerms) {
      for (let id = 0; id < this.dict.length; id++) {
        if (this.df[id]! > 0) {
          remap[id] = dict.length;
          dict.push(this.dict[id]!);
        }
      }
    }
    const entries: VaultIndexEntry[] = [];
    for (const path of this.paths()) {
      const d = this.docs.get(path)!;
      let terms = 'memory';
      if (withTerms && d.vec) {
        const parts: string[] = new Array(d.vec.ids.length);
        for (let i = 0; i < d.vec.ids.length; i++) {
          parts[i] = `${remap[d.vec.ids[i]!]!.toString(36)}:${d.vec.tfs[i]!.toString(36)}`;
        }
        terms = parts.join(',');
      }
      entries.push({ ...d.note, terms });
    }
    return { coreVersion: CORE_VERSION, state: this.state, dict, entries };
  }

  /** Load a persisted file's entries into this (empty) index. Used by
   *  loadIndex; entries are already validated. */
  restore(file: VaultIndexFile): void {
    // The file's dictionary maps once; each entry's pairs then map by array.
    const local = file.dict.map((t) => (t ? this.intern(t) : -1));
    for (const e of file.entries) {
      if (this.docs.size >= this.maxNotes) {
        this.partial = true;
        break;
      }
      const { terms, ...note } = e;
      const vec = terms === 'memory' ? null : decodeTerms(terms, local);
      this.put(e.path, note, vec, !this.docs.has(e.path));
    }
    if (file.state === 'partial') this.partial = true;
  }

  // ---- internals ---------------------------------------------------------

  private build(meta: VaultListedNote, text: string): { note: IndexedNote; vec: TermVec } {
    const scan = this.core.scanNote(text);
    const fm = this.core.readFrontmatter(text);
    const note: IndexedNote = {
      path: meta.path,
      version: listedVersion(meta),
      size: meta.size,
      updatedAt: meta.updatedAt,
      title: titleOf(meta.path),
      aliases: uniqueStrings(fm.aliases, false),
      tags: uniqueStrings([...fm.tags, ...scan.tags.map((t) => t.tag)], true),
      headings: scan.headings.map((h): IndexHeading => ({
        level: h.level,
        text: h.text,
        line: h.line,
      })),
      blockIds: scan.blockIds.map((b) => b.id),
      links: indexLinks(scan.links, fm.links),
      fmKeys: [...fm.keys],
      fmState: fm.state,
      tokens: Math.ceil(utf8Bytes(text) / 4),
    };
    const marks = oscodeMarks(fm);
    if (marks.length) note.oscode = marks;

    const counts = new Map<number, number>();
    this.addTerms(counts, note.title, TERM_WEIGHTS.title, false);
    for (const a of note.aliases) this.addTerms(counts, a, TERM_WEIGHTS.alias, false);
    for (const h of note.headings) this.addTerms(counts, h.text, TERM_WEIGHTS.heading, false);
    for (const t of note.tags) this.addTerms(counts, t, TERM_WEIGHTS.tag, false);
    const bodyStart = Math.max(fm.state === 'none' ? 0 : fm.end, scan.frontmatter?.end ?? 0);
    const body = bodyText(text, bodyStart, scan);
    if (utf8Bytes(body) <= INDEX_BODY_MAX_BYTES) {
      this.addTerms(counts, body, TERM_WEIGHTS.body, true, INDEX_MAX_BODY_TERMS);
    }
    this.counters.entriesBuilt++;
    return { note, vec: this.vectorOf(counts) };
  }

  /** Term counts to a vector sorted by id. Each (id, tf) is packed into one
   *  float so a native numeric sort does the work. */
  private vectorOf(counts: Map<number, number>): TermVec {
    const packed = new Float64Array(counts.size);
    let i = 0;
    for (const [id, tf] of counts) packed[i++] = id * TF_SPAN + Math.min(tf, TF_SPAN - 1);
    return unpack(packed);
  }

  private addTerms(
    counts: Map<number, number>,
    text: string,
    weight: number,
    dropStopwords: boolean,
    maxNew = Infinity,
  ): void {
    let added = 0;
    eachTerm(text, (t) => {
      if (dropStopwords && BODY_STOPWORDS.has(t)) return;
      const id = this.intern(t);
      const had = counts.get(id);
      if (had === undefined) {
        if (added >= maxNew) return;
        added++;
        counts.set(id, weight);
      } else counts.set(id, had + weight);
    });
  }

  private intern(term: string): number {
    let id = this.dictIds.get(term);
    if (id === undefined) {
      id = this.dict.length;
      this.dict.push(term);
      this.dictIds.set(term, id);
      if (id >= this.df.length) {
        const grown = new Int32Array(this.df.length * 2);
        grown.set(this.df);
        this.df = grown;
      }
    }
    return id;
  }

  private put(path: string, note: IndexedNote, vec: TermVec | null, isNew: boolean): void {
    const old = this.docs.get(path);
    if (old) this.detach(path, old);
    const doc: Doc = { note, vec, resolved: [], bases: [] };
    if (vec) {
      for (let i = 0; i < vec.ids.length; i++) this.df[vec.ids[i]!]!++;
      this.totalLen += vec.len;
      this.vecCount++;
    }
    const bases = new Set<string>();
    for (const l of note.links) for (const k of linkBaseKeys(l, this.core)) bases.add(k);
    doc.bases = [...bases];
    for (const b of doc.bases) {
      let set = this.linksByTargetBase.get(b);
      if (!set) this.linksByTargetBase.set(b, (set = new Set()));
      set.add(path);
    }
    this.docs.set(path, doc);
    this.dirty.add(path);
    if (isNew) {
      this.pathIndex = null;
      this.dirtyBase(pathBaseKey(path));
    }
  }

  /** Take a doc's contributions out of df, the basename map and the
   *  reverse map. */
  private detach(path: string, doc: Doc): void {
    if (doc.vec) {
      for (let i = 0; i < doc.vec.ids.length; i++) this.df[doc.vec.ids[i]!]!--;
      this.totalLen -= doc.vec.len;
      this.vecCount--;
    }
    for (const b of doc.bases) {
      const set = this.linksByTargetBase.get(b);
      if (!set) continue;
      set.delete(path);
      if (set.size === 0) this.linksByTargetBase.delete(b);
    }
    this.unlinkReverse(path, doc);
    doc.resolved = [];
  }

  private dirtyBase(base: string): void {
    const set = this.linksByTargetBase.get(base);
    if (set) for (const src of set) this.dirty.add(src);
  }

  private resolveOne(link: IndexLink, source: string, idx: VaultPathIndex): string | null {
    if (link.target === '') return source;
    const hit =
      link.kind === 'wiki'
        ? this.core.resolveWikilink(link.target, idx, source)
        : this.core.resolveMarkdownLink(link.target, source, idx);
    return hit ?? null;
  }

  private linkReverse(src: string, doc: Doc): void {
    doc.resolved.forEach((target, i) => {
      if (target === null) return;
      let into = this.reverse.get(target);
      if (!into) this.reverse.set(target, (into = new Map()));
      const at = into.get(src);
      if (at) at.push(doc.note.links[i]!.at);
      else into.set(src, [doc.note.links[i]!.at]);
    });
  }

  private unlinkReverse(src: string, doc: Doc): void {
    for (const target of new Set(doc.resolved)) {
      if (target === null) continue;
      const into = this.reverse.get(target);
      if (!into) continue;
      into.delete(src);
      if (into.size === 0) this.reverse.delete(target);
    }
  }
}

/** A tf is packed below this in a (id, tf) float. */
const TF_SPAN = 2 ** 24;

/** Packed (id, tf) floats, sorted, to a vector; a repeated id sums. */
function unpack(packed: Float64Array): TermVec {
  let sorted = true;
  for (let i = 1; i < packed.length && sorted; i++) sorted = packed[i - 1]! <= packed[i]!;
  if (!sorted) packed.sort();
  const ids = new Int32Array(packed.length);
  const tfs = new Int32Array(packed.length);
  let n = 0;
  let len = 0;
  for (let i = 0; i < packed.length; i++) {
    const id = Math.floor(packed[i]! / TF_SPAN);
    const tf = packed[i]! - id * TF_SPAN;
    if (n > 0 && ids[n - 1] === id) tfs[n - 1]! += tf;
    else {
      ids[n] = id;
      tfs[n] = tf;
      n++;
    }
    len += tf;
  }
  return { ids: ids.subarray(0, n), tfs: tfs.subarray(0, n), len };
}

/** Parse "id:tf,..." (base36) against the file dictionary's local ids. A
 *  pair that does not parse, or names no term, is skipped. */
function decodeTerms(terms: string, local: readonly number[]): TermVec {
  const out: number[] = [];
  let id = 0;
  let tf = 0;
  let inTf = false;
  let digits = 0;
  const flush = () => {
    const mapped = local[id];
    if (inTf && digits > 0 && tf > 0 && mapped !== undefined && mapped >= 0) {
      out.push(mapped * TF_SPAN + Math.min(tf, TF_SPAN - 1));
    }
    id = 0;
    tf = 0;
    inTf = false;
    digits = 0;
  };
  for (let i = 0; i < terms.length; i++) {
    const c = terms.charCodeAt(i);
    if (c === 44 /* , */) {
      flush();
      continue;
    }
    if (c === 58 /* : */) {
      inTf = true;
      digits = 0;
      continue;
    }
    const d = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 122 ? c - 87 : -1;
    if (d < 0) {
      // Junk poisons the pair; skip to the next comma.
      id = -1;
      continue;
    }
    if (inTf) tf = tf * 36 + d;
    else if (id >= 0) id = id * 36 + d;
    digits++;
  }
  if (terms.length > 0) flush();
  return unpack(Float64Array.from(out));
}

function tfOf(v: TermVec, id: number): number {
  let lo = 0;
  let hi = v.ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x = v.ids[mid]!;
    if (x === id) return v.tfs[mid]!;
    if (x < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0;
}

/** The body the index reads: after the frontmatter, `%%comments%%` cut.
 *  Code is indexed. */
function bodyText(text: string, from: number, scan: NoteScan): string {
  const cuts = scan.skipped
    .filter((s) => s.kind === 'comment' && s.end > from)
    .sort((a, b) => a.start - b.start);
  if (cuts.length === 0) return from > 0 ? text.slice(from) : text;
  const parts: string[] = [];
  let at = from;
  for (const c of cuts) {
    if (c.start > at) parts.push(text.slice(at, c.start));
    at = Math.max(at, c.end);
  }
  parts.push(text.slice(at));
  return parts.join(' ');
}

/** Dedupe, first spelling kept; `caseless` compares in lowercase (tags). */
function uniqueStrings(values: readonly string[], caseless: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const k = caseless ? v.toLowerCase() : v;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** The scanner's links (body and frontmatter) plus the frontmatter reader's,
 *  deduplicated by position, attachments left out (kept for M6). */
function indexLinks(scanned: readonly LinkToken[], fromFm: readonly LinkToken[]): IndexLink[] {
  const seen = new Set<string>();
  const out: IndexLink[] = [];
  for (const l of [...scanned, ...fromFm]) {
    if (l.attachment) continue;
    const key = `${l.where}:${l.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const link: IndexLink = {
      target: l.target,
      embed: l.embed,
      kind: l.kind,
      where: l.where,
      at: l.start,
    };
    if (l.subpath !== undefined) link.subpath = l.subpath;
    if (l.alias !== undefined) link.alias = l.alias;
    out.push(link);
  }
  return out.sort((a, b) => a.at - b.at);
}

function emptyNote(path: string): IndexedNote {
  return {
    path,
    version: '',
    size: 0,
    updatedAt: '',
    title: titleOf(path),
    aliases: [],
    tags: [],
    headings: [],
    blockIds: [],
    links: [],
    fmKeys: [],
    fmState: 'none',
    tokens: 0,
  };
}

// ---------------------------------------------------------------------------
// Serialize and load

export interface SerializedIndex {
  json: string;
  /** UTF-8 bytes of `json`. */
  bytes: number;
  /** False when the file went over `maxBytes` with vectors and was saved
   *  with `terms: 'memory'` instead. */
  withTerms: boolean;
  /** False when even the vector-free file is over `maxBytes`: do not save. */
  fits: boolean;
}

/** The index as its host saves it. Over `maxBytes` (default: the desktop
 *  cap), the vectors stay in memory and are rebuilt on the first search. */
export function serializeIndex(
  index: VaultIndex,
  opts: { maxBytes?: number } = {},
): SerializedIndex {
  const max = opts.maxBytes ?? INDEX_FILE_MAX_BYTES.desktop;
  let json = JSON.stringify(index.toFile({ withTerms: true }));
  let bytes = utf8Bytes(json);
  if (bytes <= max) return { json, bytes, withTerms: true, fits: true };
  json = JSON.stringify(index.toFile({ withTerms: false }));
  bytes = utf8Bytes(json);
  return { json, bytes, withTerms: false, fits: bytes <= max };
}

export interface LoadedIndex {
  index: VaultIndex;
  /** `rebuild`: nothing usable (absent, unreadable, or another CORE_VERSION),
   *  so the host runs a cold build. */
  status: 'loaded' | 'rebuild';
  /** Entries thrown away as malformed. */
  dropped: number;
}

/** Read a persisted index. Anything malformed is dropped entry by entry; a
 *  file from another CORE_VERSION is thrown away whole. Loads always go on to
 *  reconcile, so a stale entry costs one read, never a wrong answer. */
export function loadIndex(
  input: string | unknown,
  core: VaultIndexCore,
  opts: VaultIndexOptions = {},
): LoadedIndex {
  const index = new VaultIndex(core, opts);
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return { index, status: 'rebuild', dropped: 0 };
    }
  }
  if (!isRecord(raw) || raw.coreVersion !== CORE_VERSION || !Array.isArray(raw.entries)) {
    return { index, status: 'rebuild', dropped: 0 };
  }
  const dict = Array.isArray(raw.dict) ? raw.dict.map((t) => (typeof t === 'string' ? t : '')) : [];
  const state = raw.state === 'partial' ? 'partial' : 'ready';
  const entries: VaultIndexEntry[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const e of raw.entries) {
    const clean = cleanEntry(e);
    if (!clean || seen.has(clean.path)) dropped++;
    else {
      seen.add(clean.path);
      entries.push(clean);
    }
  }
  index.restore({ coreVersion: CORE_VERSION, state, dict, entries });
  return { index, status: 'loaded', dropped };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strArr(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === 'string') ? [...(v as string[])] : null;
}

const FM_STATES: ReadonlySet<string> = new Set(['none', 'ok', 'invalid', 'too-large']);
const OSCODE_MARKS: ReadonlySet<string> = new Set(['pin', 'exclude', 'local-only']);

/** Copy an untrusted entry into a fresh object, or refuse it. */
function cleanEntry(e: unknown): VaultIndexEntry | null {
  if (!isRecord(e)) return null;
  const { path, version, size, updatedAt, title, fmState, tokens, terms } = e;
  if (typeof path !== 'string' || !isIndexable(path)) return null;
  if (typeof version !== 'string' || typeof updatedAt !== 'string') return null;
  if (typeof title !== 'string' || typeof terms !== 'string') return null;
  if (typeof size !== 'number' || typeof tokens !== 'number') return null;
  if (typeof fmState !== 'string' || !FM_STATES.has(fmState)) return null;
  const aliases = strArr(e.aliases);
  const tags = strArr(e.tags);
  const blockIds = strArr(e.blockIds);
  const fmKeys = strArr(e.fmKeys);
  if (!aliases || !tags || !blockIds || !fmKeys) return null;
  if (!Array.isArray(e.headings) || !Array.isArray(e.links)) return null;
  const headings: IndexHeading[] = [];
  for (const h of e.headings) {
    if (!isRecord(h) || typeof h.level !== 'number' || typeof h.text !== 'string') return null;
    if (typeof h.line !== 'number') return null;
    headings.push({ level: h.level, text: h.text, line: h.line });
  }
  const links: IndexLink[] = [];
  for (const l of e.links) {
    if (!isRecord(l) || typeof l.target !== 'string' || typeof l.at !== 'number') return null;
    if (l.kind !== 'wiki' && l.kind !== 'md') return null;
    if (l.where !== 'body' && l.where !== 'frontmatter') return null;
    const link: IndexLink = {
      target: l.target,
      embed: l.embed === true,
      kind: l.kind,
      where: l.where,
      at: l.at,
    };
    if (typeof l.subpath === 'string') link.subpath = l.subpath;
    if (typeof l.alias === 'string') link.alias = l.alias;
    links.push(link);
  }
  const out: VaultIndexEntry = {
    path,
    version,
    size,
    updatedAt,
    title,
    aliases,
    tags,
    headings,
    blockIds,
    links,
    fmKeys,
    fmState: fmState as FmState,
    tokens,
    terms,
  };
  if (e.evicted === true) out.evicted = true;
  if (e.oscode !== undefined) {
    const marks = strArr(e.oscode);
    if (!marks) return null;
    const known = marks.filter((m): m is OscodeMark => OSCODE_MARKS.has(m));
    if (known.length) out.oscode = [...new Set(known)];
  }
  return out;
}
