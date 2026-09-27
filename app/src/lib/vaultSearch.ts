// Vault search, the app side (Vault M6 6.1; CTO K8, K9, K16; CX X1 to X4).
// The grammar and the ranking are the pure core's (`parseVaultQuery`,
// `highlightRanges`, and the index's `titleMatches` and `search`, stream A1);
// this module only runs them in the order a person reads them: title hits at
// once with zero reads, then body hits, then their excerpts, a page at a time,
// every step cancelled by the next keystroke.
//
// Everything here takes its dependencies as arguments, so a test runs the
// whole pipeline over a synthetic vault and counts the reads (K16):
// - titles: synchronous, no provider read, under 16 ms a keystroke;
// - body BM25 with filters: in memory, under 50 ms warm;
// - the first page of excerpts: at most 20 reads;
// - phrase checks: at most 200 reads, progressive, cancellable.
// The Recent list (X4) is pure too: the notes this device opened, a ring of
// 20 per vault in device settings, merged with the agent's own ring.
import {
  excerptAt,
  highlightRanges,
  noteFolder,
  noteTitle,
  parseVaultQuery,
  phrasesMatch,
  type TextRange,
  type VaultQuery,
  type VaultQueryClause,
  type VaultSearchHit,
  type VaultSearchOptions,
  type VaultTitleHit,
} from 'os-code/protocol';

/** The most rows a search shows, titles and text together (X2). */
export const VAULT_SEARCH_ROWS = 50;
/** Body search waits this long after the last keystroke (K16). */
export const VAULT_SEARCH_DEBOUNCE_MS = 120;
/** Reads for the first page of excerpts (K16). */
export const VAULT_SEARCH_EXCERPT_READS = 20;
/** Bodies read to verify a phrase, at most (K8, K16). */
export const VAULT_SEARCH_PHRASE_READS = 200;
/** Excerpt and phrase reads in flight at once. */
export const VAULT_SEARCH_READ_CONCURRENCY = 4;
/** The per-vault ring of notes this device opened (K9). */
export const VAULT_RECENT_RING = 20;
/** Recent rows shown in the switcher and the empty search (X4). */
export const VAULT_RECENT_ROWS = 8;

/** The pure query core, injected so a test (or a host before stream A1
 *  lands) can supply its own. Defaults to the protocol's. */
export interface VaultQueryCore {
  parseVaultQuery(q: string): VaultQuery;
  highlightRanges(text: string, query: VaultQuery): TextRange[];
}

export const VAULT_QUERY_CORE: VaultQueryCore = { parseVaultQuery, highlightRanges };

/** What a search reads from. The index members are stream A1's
 *  (`VaultIndex.titleMatches` and `VaultIndex.search(q, { limit, filter })`,
 *  or the host's async `search` that first rebuilds vectors kept in memory
 *  only); `readBody` is the store's body cache first, then the provider. */
export interface VaultSearchSource {
  titleMatches(q: string, limit: number): VaultTitleHit[];
  search(q: string, opts: VaultSearchOptions): VaultSearchHit[] | Promise<VaultSearchHit[]>;
  /** The index's facts for a path, or undefined when it is not indexed. */
  note(path: string): { title: string; updatedAt: string } | undefined;
  readBody(path: string): Promise<string | undefined>;
}

/** A passage and where the query matched in it. */
export interface VaultMarkedText {
  text: string;
  ranges: TextRange[];
}

export interface VaultResultRow {
  path: string;
  /** The note's title, with the marks when the title itself matched. */
  title: VaultMarkedText;
  /** The note's folder, '' at the root. */
  folder: string;
  group: 'title' | 'text';
  /** An alias hit shows the alias under the title; a text hit its excerpt. */
  excerpt?: VaultMarkedText;
  updatedAt?: string;
}

// ---- ranges ----------------------------------------------------------------

/** Ranges clamped to the text, sorted, merged where they touch, empty ones
 *  dropped. What the renderer draws as `<mark>` elements. */
export function cleanRanges(text: string, ranges: readonly TextRange[]): TextRange[] {
  const sorted = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(text.length, r.start)),
      end: Math.max(0, Math.min(text.length, r.end)),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TextRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** The text cut at its ranges: plain pieces and marked pieces, in order. */
export function markedPieces(
  text: string,
  ranges: readonly TextRange[],
): Array<{ text: string; mark: boolean }> {
  const out: Array<{ text: string; mark: boolean }> = [];
  let at = 0;
  for (const r of cleanRanges(text, ranges)) {
    if (r.start > at) out.push({ text: text.slice(at, r.start), mark: false });
    out.push({ text: text.slice(r.start, r.end), mark: true });
    at = r.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out;
}

// ---- the query -------------------------------------------------------------

/** Nothing to search for: blank, or only whitespace. */
export function isBlankQuery(q: string): boolean {
  return q.trim() === '';
}

function safeParse(core: VaultQueryCore, q: string): VaultQuery {
  try {
    return core.parseVaultQuery(q);
  } catch {
    return { clauses: [], filtersOnly: false };
  }
}

function safeRanges(core: VaultQueryCore, text: string, query: VaultQuery): TextRange[] {
  try {
    return cleanRanges(text, core.highlightRanges(text, query));
  } catch {
    return [];
  }
}

/** The filter clauses handed to the index with the query (tag, path, file). */
export function filterClauses(query: VaultQuery): VaultQueryClause[] {
  return query.clauses.filter((c) => c.kind === 'tag' || c.kind === 'path' || c.kind === 'file');
}

function phraseClauses(query: VaultQuery): VaultQueryClause[] {
  return query.clauses.filter((c) => c.kind === 'phrase');
}

/** Case-folded the way the index folds a term, so a phrase check agrees with
 *  the grammar: NFC, lower case, runs of whitespace as one space. */
export function foldForPhrase(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

/** Does a body hold every positive phrase and none of the negated ones? The
 *  core's own check (`phrasesMatch`), so the app and the grammar agree. */
export function phrasesHold(body: string, phrases: readonly VaultQueryClause[]): boolean {
  return phrasesMatch(body, { clauses: [...phrases], filtersOnly: false });
}

// ---- titles, synchronous ---------------------------------------------------

function titleOf(src: VaultSearchSource, path: string): string {
  return src.note(path)?.title?.trim() || noteTitle(path);
}

/** Title and alias hits, at once and with zero reads (K16). One row per
 *  note; an alias hit shows the alias, marked, under the title. */
export function vaultTitleRows(
  src: VaultSearchSource,
  core: VaultQueryCore,
  q: string,
  limit = VAULT_SEARCH_ROWS,
): VaultResultRow[] {
  if (isBlankQuery(q) || limit <= 0) return [];
  let hits: VaultTitleHit[];
  try {
    hits = src.titleMatches(q, limit);
  } catch {
    return [];
  }
  const query = safeParse(core, q);
  const seen = new Set<string>();
  const rows: VaultResultRow[] = [];
  for (const hit of hits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    const title = titleOf(src, hit.path);
    const row: VaultResultRow = {
      path: hit.path,
      title:
        hit.field === 'title'
          ? { text: hit.text || title, ranges: cleanRanges(hit.text || title, hit.ranges) }
          : { text: title, ranges: safeRanges(core, title, query) },
      folder: noteFolder(hit.path),
      group: 'title',
      updatedAt: src.note(hit.path)?.updatedAt,
    };
    if (hit.field === 'alias') {
      row.excerpt = { text: hit.text, ranges: cleanRanges(hit.text, hit.ranges) };
    }
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

/** Is there a note whose title is exactly what was typed (folded)? The
 *  switcher offers `New note "{q}"` only when there is not. */
export function hasExactTitle(rows: readonly VaultResultRow[], q: string): boolean {
  const want = foldForPhrase(q.trim());
  if (!want) return true;
  return rows.some((r) => foldForPhrase(r.title.text) === want);
}

// ---- bodies, asynchronous --------------------------------------------------

/** A search's cancel token: the next keystroke flips it. */
export interface VaultSearchSignal {
  readonly aborted: boolean;
}

export interface VaultBodySearchOptions {
  /** Paths already shown as title rows; left out of the text group. */
  exclude?: ReadonlySet<string>;
  /** Rows to fill, at most (the cap minus the title rows). */
  limit?: number;
  signal?: VaultSearchSignal;
  /** Called each time rows arrive or an excerpt fills in, with every text
   *  row so far, so the list grows progressively. */
  onRows?: (rows: VaultResultRow[], state: { done: boolean; capped: boolean }) => void;
  /** Counts reads, for the budget test. */
  counters?: { reads: number };
}

export interface VaultBodySearchResult {
  rows: VaultResultRow[];
  /** More notes matched than the rows shown. */
  capped: boolean;
  /** Cancelled by a later keystroke before it finished. */
  cancelled: boolean;
}

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T, i: number) => Promise<void>,
  live: () => boolean,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && live()) {
      const i = next++;
      await run(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Body hits (BM25 over the index, filters applied there), phrases verified
 *  on bodies, and one excerpt for each of the first page. Reads stay inside
 *  the K16 budget; every step stops when `signal` is aborted. */
export async function vaultBodyRows(
  src: VaultSearchSource,
  core: VaultQueryCore,
  q: string,
  opts: VaultBodySearchOptions = {},
): Promise<VaultBodySearchResult> {
  const signal = opts.signal ?? { aborted: false };
  const live = () => !signal.aborted;
  const limit = Math.max(0, opts.limit ?? VAULT_SEARCH_ROWS);
  const exclude = opts.exclude ?? new Set<string>();
  const counters = opts.counters ?? { reads: 0 };
  const none: VaultBodySearchResult = { rows: [], capped: false, cancelled: false };
  if (isBlankQuery(q) || limit === 0) return none;
  const query = safeParse(core, q);
  if (query.clauses.length === 0 && !query.prefix) return none;
  const phrases = phraseClauses(query);

  // Bodies read in this run, so a phrase check and an excerpt share a read.
  const bodies = new Map<string, string | undefined>();
  const read = async (path: string): Promise<string | undefined> => {
    if (bodies.has(path)) return bodies.get(path);
    counters.reads++;
    let text: string | undefined;
    try {
      text = await src.readBody(path);
    } catch {
      text = undefined;
    }
    bodies.set(path, text);
    return text;
  };

  const want = phrases.length ? VAULT_SEARCH_PHRASE_READS : limit + exclude.size + 1;
  let hits: VaultSearchHit[];
  try {
    hits = await src.search(q, { limit: want, filter: filterClauses(query) });
  } catch {
    return none;
  }
  if (!live()) return { ...none, cancelled: true };
  let paths = hits.map((h) => h.path).filter((p) => !exclude.has(p));
  if (query.filtersOnly) {
    // A filters-only query lists its matches newest first (K8).
    const at = (p: string) => src.note(p)?.updatedAt ?? '';
    paths = [...paths].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));
  }

  const rowOf = (path: string): VaultResultRow => {
    const title = titleOf(src, path);
    return {
      path,
      title: { text: title, ranges: safeRanges(core, title, query) },
      folder: noteFolder(path),
      group: 'text',
      updatedAt: src.note(path)?.updatedAt,
    };
  };

  let rows: VaultResultRow[] = [];
  let capped = false;
  const emit = (done: boolean) =>
    opts.onRows?.(
      rows.map((r) => ({ ...r })),
      { done, capped },
    );

  if (phrases.length) {
    // Verify candidates on their bodies, at most 200, in rank order, and show
    // each as it passes. Order is kept by collecting into rank slots.
    const candidates = paths.slice(0, VAULT_SEARCH_PHRASE_READS);
    const passed: Array<VaultResultRow | undefined> = new Array(candidates.length);
    let passedN = 0;
    await eachLimited(
      candidates,
      VAULT_SEARCH_READ_CONCURRENCY,
      async (path, i) => {
        // One past the cap is enough to say "Showing the first 50".
        if (passedN > limit) return;
        const body = await read(path);
        if (!live() || body === undefined || !phrasesHold(body, phrases)) return;
        passedN++;
        passed[i] = rowOf(path);
        const all = passed.filter((r): r is VaultResultRow => r !== undefined);
        capped = all.length > limit;
        rows = all.slice(0, limit);
        emit(false);
      },
      live,
    );
    if (!live()) return { rows, capped, cancelled: true };
  } else {
    capped = paths.length > limit;
    rows = paths.slice(0, limit).map(rowOf);
    emit(false);
  }

  // The first page of excerpts: at most 20 reads (bodies a phrase check
  // already read cost nothing).
  const page = rows.slice(0, VAULT_SEARCH_EXCERPT_READS);
  await eachLimited(
    page,
    VAULT_SEARCH_READ_CONCURRENCY,
    async (row) => {
      const body = await read(row.path);
      if (!live() || body === undefined) return;
      const at = safeRanges(core, body, query)[0];
      if (!at) return;
      const cut = excerptAt(body, at.start);
      if (!cut.text) return;
      row.excerpt = { text: cut.text, ranges: safeRanges(core, cut.text, query) };
      emit(false);
    },
    live,
  );
  if (!live()) return { rows, capped, cancelled: true };
  emit(true);
  return { rows, capped, cancelled: false };
}

// ---- honest states ---------------------------------------------------------

/** What the search can promise about bodies right now (X2). The screen maps
 *  the index host's status to this (`vaultSearchIndexState`). */
export type VaultSearchIndex =
  { kind: 'ready' } | { kind: 'loading'; done: number; total: number } | { kind: 'failed' };

/** The index host's published status, as far as search reads it. */
export interface VaultSearchIndexStatus {
  state: 'empty' | 'building' | 'ready' | 'partial';
  progress: { done: number; total: number; failed: number } | null;
}

/** Map the host's status (`useVaultIndexStatus()`) to what search says. A
 *  build under way is loading; `failed` is the host's own verdict (a build
 *  that could not read bodies), passed in by the screen. */
export function vaultSearchIndexState(
  status: VaultSearchIndexStatus,
  failed = false,
): VaultSearchIndex {
  if (failed) return { kind: 'failed' };
  if (status.state === 'building') {
    const p = status.progress;
    return { kind: 'loading', done: p?.done ?? 0, total: p?.total ?? 0 };
  }
  return { kind: 'ready' };
}

// ---- Recent (X4) -----------------------------------------------------------

/** One note this device opened or edited, and when. */
export interface VaultRecentEntry {
  path: string;
  /** ISO 8601. */
  at: string;
}

/** Record an open or an edit: newest first, each path once, 20 kept. */
export function pushVaultRecent(
  ring: readonly VaultRecentEntry[],
  path: string,
  at: string,
): VaultRecentEntry[] {
  return [{ path, at }, ...ring.filter((e) => e.path !== path)].slice(0, VAULT_RECENT_RING);
}

/** A rename re-keys the entry; a delete drops it. */
export function renameVaultRecent(
  ring: readonly VaultRecentEntry[],
  from: string,
  to: string,
): VaultRecentEntry[] {
  const out: VaultRecentEntry[] = [];
  for (const e of ring) {
    if (e.path === to) continue;
    out.push(e.path === from ? { ...e, path: to } : e);
  }
  return out;
}

export function dropVaultRecent(
  ring: readonly VaultRecentEntry[],
  path: string,
): VaultRecentEntry[] {
  return ring.filter((e) => e.path !== path);
}

export interface VaultRecentRow {
  path: string;
  title: string;
  folder: string;
  /** ISO 8601, the newer of the open and the agent's write. */
  at: string;
  /** The agent wrote it (`vaultAgentRecent`). The label shows only where
   *  `vaultRecentAgentLabel` answers one. */
  agent: boolean;
}

/** The Recent list: what this device opened, merged with the agent's notes
 *  (the store's `vaultAgentRecent`, hidden notes already left out), newest
 *  first, each once, eight rows. `exists` drops a note the vault no longer
 *  holds and names it by its current title. */
export function vaultRecentRows(
  opened: readonly VaultRecentEntry[],
  agent: ReadonlyArray<{ path: string; title?: string; updatedAt: string }>,
  exists?: (path: string) => { title?: string } | undefined,
  limit = VAULT_RECENT_ROWS,
): VaultRecentRow[] {
  const byPath = new Map<string, VaultRecentRow>();
  const put = (path: string, at: string, isAgent: boolean, title?: string) => {
    const known = exists ? exists(path) : {};
    if (!known) return;
    const prev = byPath.get(path);
    const name = known.title?.trim() || title?.trim() || noteTitle(path);
    if (!prev) {
      byPath.set(path, { path, title: name, folder: noteFolder(path), at, agent: isAgent });
      return;
    }
    if (at > prev.at) prev.at = at;
    prev.agent ||= isAgent;
  };
  for (const e of opened) put(e.path, e.at, false);
  for (const n of agent) put(n.path, n.updatedAt, true, n.title);
  return [...byPath.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.path < b.path ? -1 : 1))
    .slice(0, limit);
}
