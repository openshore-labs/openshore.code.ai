// The Vault's shared core contract (Vault M3, CTO H1 to H5). Every type the M3
// streams code against lives here, so the core (paths, scan, frontmatter,
// resolve, rewrite, excerpt, the index), the engine, the desktop's main process
// and the app all agree on one shape. Types only: no value, no import, so it
// can never pull anything into a bundle. Exported through `os-code/protocol`.
//
// Offsets are JS string indices (UTF-16 code units) into the note's full text,
// never byte offsets, unless a field says otherwise.

/** A half-open range `[start, end)` of JS string indices. */
export interface TextRange {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// paths.ts (H4)

/** `isNotePath(path, options)`: `windows` also refuses what a Windows file
 *  system cannot hold (a colon, a reserved name). */
export interface IsNotePathOptions {
  windows?: boolean;
}

/** The answer of `checkNewNoteName(raw)`, the one new-name rule the engine and
 *  the app share. On a refusal, `suggestion` is the cleaned name
 *  (`normalizeNotePath`) to offer instead, when one exists. */
export type NewNoteNameCheck =
  { ok: true; path: string } | { ok: false; error: string; suggestion?: string };

/** The line endings of a note, from `eolOf(text)`. A note with no line break
 *  answers `lf`. Only an all-CRLF note has its CRLF put back on save (H2). */
export type Eol = 'lf' | 'crlf' | 'mixed';

// ---------------------------------------------------------------------------
// scan.ts (H1)

/** Where a link sits: in the body, or inside a frontmatter string value
 *  (scanned for wikilinks too, as Obsidian does). */
export type LinkWhere = 'body' | 'frontmatter';

/** `[[wikilink]]` or `[text](markdown-link)`. */
export type LinkKind = 'wiki' | 'md';

/** One link the scanner found. */
export interface LinkToken extends TextRange {
  kind: LinkKind;
  /** The target as written, without the subpath or alias. For a markdown link
   *  it is the percent-decoded destination. Empty for a link to the note
   *  itself (`[[#Heading]]`). */
  target: string;
  /** The target portion's own range, the only span `rewriteLinks` splices. */
  targetStart: number;
  targetEnd: number;
  /** The text after `#`, without it: a heading, or a block reference when it
   *  starts with `^`. */
  subpath?: string;
  /** The display text: a wikilink's `|alias`, or a markdown link's text. */
  alias?: string;
  /** Written with a leading `!`. */
  embed: boolean;
  where: LinkWhere;
  /** Markdown links only: the destination is not a note (neither `.md` nor
   *  extensionless), so it is an attachment, kept for M6. */
  attachment?: boolean;
}

/** A `#tag` in the body. */
export interface TagToken extends TextRange {
  /** Without the leading `#`, as written (compare in lowercase). */
  tag: string;
}

/** An ATX heading, or a setext heading underlined with `===`. */
export interface HeadingToken extends TextRange {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** Zero-based line number. */
  line: number;
}

/** A block id (`^id` at the end of a line). */
export interface BlockIdToken extends TextRange {
  id: string;
  /** Zero-based line number. */
  line: number;
}

/** A range the scanner never reads links or tags in. Indented code is NOT one
 *  (a documented divergence, H1). */
export type SkippedKind = 'fence' | 'math' | 'html-comment' | 'comment' | 'code-span';

export interface SkippedRange extends TextRange {
  kind: SkippedKind;
}

/** The frontmatter block. `start` to `end` covers the whole block, both `---`
 *  lines and the closing line break, so `text.slice(end)` is the body the
 *  renderer shows. `raw` is the YAML between the delimiters. */
export interface FrontmatterRange extends TextRange {
  raw: string;
}

/** Everything `scanNote(text)` finds in one note. */
export interface NoteScan {
  frontmatter: FrontmatterRange | null;
  links: LinkToken[];
  tags: TagToken[];
  headings: HeadingToken[];
  blockIds: BlockIdToken[];
  skipped: SkippedRange[];
  /** True where a per-note cap (2,000 links, 500 tags, 1,000 headings) cut
   *  the list short. */
  capped: { links: boolean; tags: boolean; headings: boolean };
}

// ---------------------------------------------------------------------------
// frontmatter.ts (H2)

/** A frontmatter value after the safe copy (null-prototype objects, depth 8,
 *  1,000 values at most). Dates stay the strings the person typed
 *  (CORE_SCHEMA). */
export type FmValue = string | number | boolean | null | FmValue[] | { [key: string]: FmValue };

/** `none`: no block. `invalid`: a parse error or a duplicate key, with no
 *  props, as in Obsidian. `too-large`: a block over 64 KB, never parsed. */
export type FmState = 'none' | 'ok' | 'invalid' | 'too-large';

export interface FmProp {
  key: string;
  value: FmValue;
}

/** What `readFrontmatter(text)` reads. Read-only: nothing serializes YAML.
 *  With `state: 'none'`, `start` and `end` are 0 and `raw` is empty. */
export interface Frontmatter extends TextRange {
  state: FmState;
  raw: string;
  props: FmProp[];
  /** From `tags`/`tag`, a list or a comma string, leading `#` stripped. */
  tags: string[];
  /** From `aliases`/`alias`, a list or a comma string. */
  aliases: string[];
  /** Wikilinks inside string values, `where: 'frontmatter'`. */
  links: LinkToken[];
  keys: string[];
}

// ---------------------------------------------------------------------------
// resolve.ts, rewrite.ts, excerpt.ts (H4)

/** What `buildPathIndex(paths)` builds for `resolveWikilink` and friends.
 *  Opaque past `paths`: only the core reads its inside. */
export interface VaultPathIndex {
  readonly kind: 'vault-path-index';
  readonly paths: readonly string[];
}

/** The open wikilink under the caret, for the editor's link picker:
 *  `[[query` from `start` (the first `[`) to `end` (the caret). */
export interface WikilinkContext extends TextRange {
  query: string;
  embed: boolean;
}

/** `rewriteLinks(...)`: the new text and how many links it changed. */
export interface RewriteResult {
  text: string;
  count: number;
}

/** `excerptAt(text, at)`: a short passage around an offset, frontmatter
 *  skipped. `start` and `end` locate it in the note. */
export interface VaultExcerpt extends TextRange {
  text: string;
  /** Zero-based line number of `at`. */
  line: number;
}

// ---------------------------------------------------------------------------
// index.ts, tokenize.ts (H3)

/** A link as the index keeps it. `at` is the token's start offset; the index
 *  stores offsets, never excerpts. */
export interface IndexLink {
  target: string;
  subpath?: string;
  alias?: string;
  embed: boolean;
  kind: LinkKind;
  where: LinkWhere;
  at: number;
}

export interface IndexHeading {
  level: number;
  text: string;
  line: number;
}

/** One note's persisted index entry. Resolved links, the reverse-link map,
 *  the basename map, document frequencies and the average length are derived
 *  in memory on load and never persisted. */
export interface VaultIndexEntry {
  path: string;
  /** `versionOf(meta)` when indexed; the only field reconcile compares. */
  version: string;
  size: number;
  updatedAt: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: IndexHeading[];
  blockIds: string[];
  links: IndexLink[];
  fmKeys: string[];
  fmState: FmState;
  /** Estimate: ceil(UTF-8 bytes / 4). */
  tokens: number;
  /** Weighted term counts as "id:tf,..." in base36 against the file's shared
   *  dictionary, or `'memory'` when the file went over its size cap and the
   *  vectors are rebuilt in memory on the first search. */
  terms: string;
  /** An evicted placeholder: old entry kept, or title only. Never downloaded
   *  for indexing. */
  evicted?: true;
}

/** `partial`: over 10,000 notes, so the first 10,000 in path order are
 *  indexed. */
export type VaultIndexState = 'empty' | 'building' | 'ready' | 'partial';

/** The persisted index, as `serializeIndex` writes it and `loadIndex` reads
 *  it. A `coreVersion` other than the core's `CORE_VERSION` forces a full
 *  rebuild. */
export interface VaultIndexFile {
  coreVersion: number;
  state: VaultIndexState;
  /** The shared term dictionary `terms` ids point into. */
  dict: string[];
  entries: VaultIndexEntry[];
}

/** The listing `planReconcile` compares against. The app's `StoredFileMeta`
 *  satisfies it. */
export interface VaultListedNote {
  path: string;
  updatedAt: string;
  size: number;
  version?: string;
  evicted?: boolean;
}

/** `planReconcile(entries, listed)`: paths to read, drop, and keep. */
export interface ReconcilePlan {
  read: string[];
  drop: string[];
  keep: string[];
}

export type IndexPhase = 'load' | 'list' | 'read' | 'index' | 'save';

/** Cold-build progress, emitted at most every 250 ms. */
export interface IndexProgress {
  phase: IndexPhase;
  done: number;
  total: number;
  failed: number;
}

/** One BM25 result. Ties break by path. */
export interface VaultSearchHit {
  path: string;
  score: number;
}

/** A note that links to the one asked about, with each link's offset. */
export interface VaultBacklink {
  source: string;
  at: number[];
}

// ---------------------------------------------------------------------------
// readConfig (H5)

/** The logical config names a provider may read. No path ever crosses the
 *  seam; each host maps a name through its own allow-list. */
export type VaultConfigName =
  'obsidian/app' | 'obsidian/daily-notes' | 'obsidian/templates' | 'oscode/vault';

export type ConfigReadRefusal = 'absent' | 'too-large' | 'downloading' | 'unsupported' | 'refused';

/** `readConfig(resourceId, name)`, capped at 256 KB of UTF-8. */
export type ConfigRead =
  { ok: true; text: string; version: string } | { ok: false; reason: ConfigReadRefusal };
