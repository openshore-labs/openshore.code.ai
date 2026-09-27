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
  /** The note's own `oscode:` frontmatter marks (`oscodeMarks`, Vault M4, CTO
   *  I4), set only when it carries at least one. */
  oscode?: OscodeMark[];
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

// ---------------------------------------------------------------------------
// privacy.ts (Vault M4, CTO I3 to I5)

/** A note's own say over how OpenShore treats it, from frontmatter
 *  `oscode: pin | exclude | local-only` (a string or a list, any case). */
export type OscodeMark = 'pin' | 'exclude' | 'local-only';

/** `hidden`: absent for every vault tool and the pack. `local-only`: its text
 *  reaches only a seat whose requests stay on this network. `open`: no rule
 *  applies. A pin never lifts either restriction. */
export type VaultVisibility = 'hidden' | 'local-only' | 'open';

/** The machine's vault privacy config, as `vault.exclude` and
 *  `vault.localOnly` in the config schema hold it. */
export interface VaultPrivacyConfig {
  exclude: readonly string[];
  localOnly: { paths: readonly string[]; tags: readonly string[] };
}

/** In-vault narrowing (D8, M7): union only, so it can hide more or keep more
 *  on this computer, never less. Optional now so the compiler's shape is set. */
export interface VaultPrivacyNarrowing {
  exclude?: readonly string[];
  localOnly?: { paths?: readonly string[]; tags?: readonly string[] };
}

/** What `visibility` is asked about: a note path (vault-relative, `/`
 *  separated), its tags, and its marks. Tags and marks are unknown for a note
 *  the index has not seen, so `vaultList` can judge by glob alone. */
export interface VaultVisibilityInput {
  path: string;
  tags?: readonly string[];
  oscode?: readonly OscodeMark[];
}

/** The compiled rules, from `compileVaultPrivacy(cfg, narrowing?)`. */
export interface VaultPrivacy {
  visibility(note: VaultVisibilityInput): VaultVisibility;
}

// ===========================================================================
// Vault M6, "Obsidian day one" (CTO K2, K4, K7, K8, K10, K11, K15). Wave 0
// contracts: the shapes the M6 streams code against. The functions that
// produce them live in attachments.ts, move.ts, query.ts, dates.ts and
// markdown.ts (stubs until their stream lands).

// ---------------------------------------------------------------------------
// attachments.ts, readBytes (K2, K11; stream A2 for the core, B and C for the
// hosts)

/** The attachment types the Vault reads in M6: the rasters, SVG (shown only
 *  inside `<img>`), and PDF (a chip that opens). Nothing else crosses. */
export type AttachmentMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/avif'
  | 'image/svg+xml'
  | 'application/pdf';

/** One attachment in a listing (`listAttachments`). `version` is the
 *  provider's own opaque token, compared with `===` only. */
export interface AttachmentMeta {
  path: string;
  size: number;
  updatedAt: string;
  version: string;
  mime: AttachmentMime;
}

/** Why `readBytes` read nothing: the same set `readConfig` answers with. */
export type BytesReadRefusal = ConfigReadRefusal;

/** `readBytes(resourceId, path, opts)`, in the `ConfigRead` style (K2). Images
 *  are capped at `VAULT_ATTACHMENT_MAX_BYTES` (20 MB). */
export type BytesRead =
  | { ok: true; bytes: Uint8Array; mime: AttachmentMime; version: string }
  | { ok: false; reason: BytesReadRefusal };

/** `readBytes` options: `max` lowers the cap, never raises it. */
export interface ReadBytesOptions {
  max?: number;
}

/** Obsidian's `attachmentFolderPath` from `obsidian/app`: `/` is the vault
 *  root, `./` the note's own folder, `./sub` a folder under it, anything else
 *  a vault folder. Absent means the root. */
export type AttachmentFolderSetting = string;

// ---------------------------------------------------------------------------
// Trash (K2, K6; the entry shape the seam and the daemon wire share)

/** One thing in Trash. `id` is opaque to everyone but its provider. `path`
 *  is where it came from, so Restore knows where to go. `trashedAt` is
 *  absent where the storage cannot say, and then it is not shown. */
export interface VaultTrashEntry {
  id: string;
  path: string;
  kind: 'note' | 'folder';
  size: number;
  trashedAt?: string;
}

// ---------------------------------------------------------------------------
// move.ts (K4, reconciled by R1; stream A2)

/** A moved note's own path either side of the move, for its relative links. */
export interface MoveSourcePaths {
  before: string;
  after: string;
}

/** A note the host read for a rewrite plan, with the version it read. */
export interface LinkRewriteSource {
  path: string;
  text: string;
  version: string;
}

/** One planned write: the note's path AFTER the moves (a moved note is at its
 *  new path), `base` the version it was read at (the host re-bases a moved
 *  note on the rename's version), the whole new text, and how many links in
 *  it changed. */
export interface LinkRewriteEdit {
  path: string;
  base: string;
  text: string;
  count: number;
}

/** Why a link was left as written: a new target would break a quoted
 *  frontmatter value, or the resolution is ambiguous. */
export type LinkRewriteLeftReason = 'frontmatter-quote' | 'ambiguous';

/** `planLinkRewrites(...)`: every edit, the totals the "Update N links in M
 *  notes?" sheet counts (`links`, `notes`), and what was left alone. */
export interface LinkRewritePlan {
  edits: LinkRewriteEdit[];
  links: number;
  notes: number;
  left: Array<{ path: string; reason: LinkRewriteLeftReason }>;
}

// ---------------------------------------------------------------------------
// query.ts (K8; stream A1)

/** A search clause's kind: a bare term, a quoted phrase, or an operator. */
export type VaultQueryClauseKind = 'term' | 'phrase' | 'tag' | 'path' | 'file';

/** One clause of a parsed query. `value` is folded (lowercase) and without
 *  its operator or quotes; `tag` values carry no leading `#`. */
export interface VaultQueryClause {
  kind: VaultQueryClauseKind;
  value: string;
  negated: boolean;
}

/** `parseVaultQuery(q)`. Clauses AND together. `prefix` is the last bare
 *  term when the query does not end in whitespace (matched as a prefix while
 *  typing). `filtersOnly`: no positive term or phrase, so matches list newest
 *  first. */
export interface VaultQuery {
  clauses: VaultQueryClause[];
  prefix?: string;
  filtersOnly: boolean;
}

/** The index's `search(q, opts)` options (K8): `filter` holds the clauses
 *  (tag, path, file, negated terms) every hit must pass. */
export interface VaultSearchOptions {
  limit?: number;
  filter?: readonly VaultQueryClause[];
}

/** One `titleMatches(q, limit)` hit: the title or alias that matched, and
 *  where in that text, for `<mark>`. */
export interface VaultTitleHit {
  path: string;
  score: number;
  field: 'title' | 'alias';
  text: string;
  ranges: TextRange[];
}

// ---------------------------------------------------------------------------
// dates.ts (K7; stream A2)

/** A moment on the host's local clock, split for formatting. `month` is 1
 *  to 12; `weekday` is 0 (Sunday) to 6; `offsetMinutes` is the local offset
 *  east of UTC. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  epochMs: number;
  offsetMinutes: number;
}

/** `formatVaultDate(parts, fmt)`: the text, or the first token it does not
 *  support (Today then says so rather than guess a name). */
export type VaultDateFormatResult = { ok: true; text: string } | { ok: false; token: string };

/** The daily note settings, from `obsidian/daily-notes`, else the defaults
 *  (root, `YYYY-MM-DD`, no template). `template` is a note path. */
export interface DailyNoteConfig {
  folder: string;
  format: string;
  template?: string;
}

/** `fillTemplate(text, fill)`: `{{date}}`, `{{time}}`, `{{title}}`,
 *  `{{date:FMT}}`, `{{time:FMT}}`. */
export interface TemplateFill {
  parts: DateParts;
  title: string;
  dateFormat: string;
  timeFormat: string;
}

// ---------------------------------------------------------------------------
// markdown.ts (K10, K11, K15; stream A2)

/** The four callout families (CX X12), each drawn from existing tokens and
 *  never from `--local`, `--cloud` or `--accent`. Unknown types are neutral. */
export type CalloutFamily = 'neutral' | 'positive' | 'caution' | 'danger';

/** `parseCallout(line)`: a `> [!type][+-] Title` head. `type` is checked
 *  against `[a-z-]{1,24}` (folded); `fold` is set only for a foldable one
 *  (`-` starts closed). */
export interface CalloutHead {
  type: string;
  family: CalloutFamily;
  fold?: '+' | '-';
  title?: string;
}

/** One GFM task. `at` is the offset of its status character (inside `[ ]`),
 *  `line` its zero-based line in the full text. A status other than space,
 *  `x` or `X` is custom: shown checked and never toggled. */
export interface VaultTask {
  at: number;
  line: number;
  status: string;
  checked: boolean;
  custom: boolean;
}

/** `toggleTaskAt(text, at, expected)`: the new text, or why nothing changed
 *  (`moved`: the status at `at` is not `expected`; `custom`: not a box that
 *  ticks; `none`: no task there). */
export type TaskToggleResult =
  { ok: true; text: string; status: string } | { ok: false; reason: 'moved' | 'custom' | 'none' };

/** An unlinked mention (K15): a whole-word, case-insensitive match of one of
 *  `names` outside links, code and frontmatter. */
export interface UnlinkedMention extends TextRange {
  name: string;
  line: number;
}
