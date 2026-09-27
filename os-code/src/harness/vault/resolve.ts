// Link resolution (Vault M3, CTO H4): wikilinks and markdown links to vault
// paths, the shortest unambiguous link text for a note, and the editor's open
// `[[` context. One order, pinned row by row in test/vaultCore.test.ts:
//
//   1. Split off the subpath. The candidates are `target.md`, and also
//      `target` itself when it already ends in `.md` (tried first), so
//      `[[package.json]]` still finds `package.json.md`.
//   2. Exact vault path, compared with `foldPath`. On a case collision the
//      exact-case match wins, then code-point order.
//   3. Relative to the source's folder, with `..` resolved. Climbing above
//      the vault root never matches.
//   4. Suffix match on whole segments. Tie-breaks: the source's own folder,
//      then fewest segments, then shortest string, then code-point order. So
//      `[[Ideas/Plan]]` stays unresolved when only `Archive/Plan.md` exists.
//   5. The cleaned name (`normalizeNotePath`), last. This keeps the invariant
//      that a dashed link, once its note is created, reaches that note.
//
// Pure and import-free past the vault core.

import { foldPath, normalizeNotePath, noteFolder } from './paths.js';
import { isNoteDestination } from './scan.js';
import type { VaultPathIndex, WikilinkContext } from './types.js';

interface IndexData {
  /** Folded path to every path with that fold, in code-point order. */
  byFold: Map<string, string[]>;
  /** Folded basename to every path with that basename. */
  byBase: Map<string, string[]>;
}

const INDEX_DATA = new WeakMap<VaultPathIndex, IndexData>();

/** Compare by code point, not UTF-16 unit. */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx - cy;
  }
}

function push(map: Map<string, string[]>, key: string, path: string): void {
  const list = map.get(key);
  if (list) list.push(path);
  else map.set(key, [path]);
}

/** Build the lookup `resolveWikilink` and friends use. Build it once per
 *  path list and reuse it; resolving against a bare array builds one per
 *  call. */
export function buildPathIndex(paths: readonly string[]): VaultPathIndex {
  const index: VaultPathIndex = { kind: 'vault-path-index', paths: [...paths] };
  const byFold = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const folded = foldPath(p);
    push(byFold, folded, p);
    push(byBase, folded.slice(folded.lastIndexOf('/') + 1), p);
  }
  for (const list of byFold.values()) list.sort(compareCodePoints);
  INDEX_DATA.set(index, { byFold, byBase });
  return index;
}

function dataOf(pathsOrIndex: readonly string[] | VaultPathIndex): IndexData {
  const index = Array.isArray(pathsOrIndex)
    ? buildPathIndex(pathsOrIndex as readonly string[])
    : (pathsOrIndex as VaultPathIndex);
  return INDEX_DATA.get(index) ?? INDEX_DATA.get(buildPathIndex(index.paths))!;
}

/** Among paths that fold the same, the exact-case one, else the first in
 *  code-point order. */
function pickFold(list: string[] | undefined, want: string): string | undefined {
  if (!list?.length) return undefined;
  const nfc = want.normalize('NFC');
  return list.find((p) => p.normalize('NFC') === nfc) ?? list[0];
}

function candidatesOf(target: string): string[] {
  return /\.md$/i.test(target) ? [target, `${target}.md`] : [`${target}.md`];
}

/** `folder` joined with `rel`, with `.` and `..` resolved; undefined when it
 *  climbs above the vault root. */
function joinRelative(folder: string, rel: string): string | undefined {
  const out = folder ? folder.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return undefined;
      out.pop();
    } else out.push(seg);
  }
  return out.length ? out.join('/') : undefined;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/** The paths whose trailing whole segments are `candidate`'s. */
function suffixHits(data: IndexData, candidate: string): string[] {
  const want = segmentsOf(foldPath(candidate));
  if (!want.length || want.some((s) => s === '.' || s === '..')) return [];
  const list = data.byBase.get(want[want.length - 1]!);
  if (!list) return [];
  return list.filter((p) => {
    const segs = foldPath(p).split('/');
    if (segs.length < want.length) return false;
    const off = segs.length - want.length;
    return want.every((s, k) => segs[off + k] === s);
  });
}

/** Step 4: the best suffix match, by the pinned tie-breaks. */
function suffixMatch(data: IndexData, candidate: string, sourcePath?: string): string | undefined {
  const hits = suffixHits(data, candidate);
  if (!hits.length) return undefined;
  const home = sourcePath === undefined ? undefined : foldPath(noteFolder(sourcePath));
  const rank = (p: string) => (home !== undefined && foldPath(noteFolder(p)) === home ? 0 : 1);
  hits.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.split('/').length - b.split('/').length ||
      a.length - b.length ||
      compareCodePoints(a, b),
  );
  return hits[0];
}

/** Resolve a wikilink target (a subpath after `#` is ignored) to a vault
 *  path, in the pinned order above. `[[#Heading]]` resolves to the source
 *  itself. Undefined when no note matches: an unresolved link, shown dashed
 *  and created on tap. */
export function resolveWikilink(
  target: string,
  pathsOrIndex: readonly string[] | VaultPathIndex,
  sourcePath?: string,
): string | undefined {
  let t = target;
  const bar = t.indexOf('|');
  if (bar !== -1) t = t.slice(0, bar);
  const hash = t.indexOf('#');
  if (hash !== -1) t = t.slice(0, hash);
  t = t.trim();
  if (!t) return hash !== -1 ? sourcePath : undefined;
  const data = dataOf(pathsOrIndex);
  const joined = segmentsOf(t).join('/');
  if (!joined) return undefined;
  const cands = candidatesOf(joined);
  for (const c of cands) {
    const hit = pickFold(data.byFold.get(foldPath(c)), c);
    if (hit) return hit;
  }
  if (sourcePath !== undefined) {
    const folder = noteFolder(sourcePath);
    for (const c of cands) {
      const rel = joinRelative(folder, c);
      const hit = rel && pickFold(data.byFold.get(foldPath(rel)), rel);
      if (hit) return hit;
    }
  }
  for (const c of cands) {
    const hit = suffixMatch(data, c, sourcePath);
    if (hit) return hit;
  }
  const cleaned = normalizeNotePath(t);
  return cleaned ? pickFold(data.byFold.get(foldPath(cleaned)), cleaned) : undefined;
}

/** Resolve a decoded markdown-link path (no subpath). Relative to the
 *  source's folder first (markdown's own rule), then from the vault root,
 *  then, unless it is written as explicitly relative, the wikilink order. */
export function resolveMarkdownPath(
  path: string,
  sourcePath: string,
  pathsOrIndex: readonly string[] | VaultPathIndex,
): string | undefined {
  if (!path || !isNoteDestination(path)) return undefined;
  const data = dataOf(pathsOrIndex);
  const want = /\.md$/i.test(path) ? path : `${path}.md`;
  const rel = joinRelative(noteFolder(sourcePath), want);
  const relHit = rel && pickFold(data.byFold.get(foldPath(rel)), rel);
  if (relHit) return relHit;
  const abs = segmentsOf(want).join('/');
  const absHit = pickFold(data.byFold.get(foldPath(abs)), abs);
  if (absHit) return absHit;
  // An explicitly relative path, or a name holding a decoded "#" or "|", stops here.
  if (/^\.\.?\//.test(path) || /[#|]/.test(path)) return undefined;
  return resolveWikilink(path, pathsOrIndex, sourcePath);
}

/** Resolve a markdown link's href as written (`Plan.md`, `../Ideas/Plan%20B.md`,
 *  `<Plan B.md>`, with or without `#subpath`). A scheme, a `//` link, a
 *  `#`-only link and an attachment answer undefined. */
export function resolveMarkdownLink(
  href: string,
  sourcePath: string,
  pathsOrIndex: readonly string[] | VaultPathIndex,
): string | undefined {
  let h = href.trim();
  if (h.startsWith('<') && h.endsWith('>')) h = h.slice(1, -1);
  if (!h || h.startsWith('#') || h.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(h)) {
    return undefined;
  }
  const hash = h.indexOf('#');
  let path = hash === -1 ? h : h.slice(0, hash);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep it as written.
  }
  return resolveMarkdownPath(path, sourcePath, pathsOrIndex);
}

/** Characters no wikilink target can hold. */
const UNLINKABLE = /[[\]|#^]/;

/** The shortest link text that resolves from `sourcePath` to `targetPath`:
 *  the note's name when that is unambiguous, else a longer path suffix, else
 *  the full path. Undefined when no link can reach the note (a name holding
 *  `# ^ [ ] |`, like "C# notes.md"). */
export function linkTextFor(
  targetPath: string,
  sourcePath: string,
  pathsOrIndex: readonly string[] | VaultPathIndex,
): string | undefined {
  if (UNLINKABLE.test(targetPath)) return undefined;
  const index = Array.isArray(pathsOrIndex)
    ? buildPathIndex(pathsOrIndex as readonly string[])
    : (pathsOrIndex as VaultPathIndex);
  const data = dataOf(index);
  const segs = targetPath.split('/');
  const stemmed = [...segs.slice(0, -1), segs[segs.length - 1]!.replace(/\.md$/i, '')];
  for (let k = 1; k <= stemmed.length; k++) {
    const cand = stemmed.slice(-k).join('/');
    if (cand.trim() !== cand) continue;
    if (resolveWikilink(cand, index, sourcePath) !== targetPath) continue;
    // A shorter form must name only this note; the full path always does.
    if (k === stemmed.length || suffixHits(data, `${cand}.md`).length === 1) return cand;
  }
  return resolveWikilink(targetPath, index, sourcePath) === targetPath ? targetPath : undefined;
}

/** The open wikilink under the caret, for the editor's link picker: the
 *  `[[` (and whether a `!` makes it an embed) and the query typed since it.
 *  Null once the pair is closed (`]]`), a new line starts, or the alias half
 *  begins (`|`), as in Obsidian, which suggests the target and leaves the
 *  alias alone. */
export function wikilinkContext(text: string, caret: number): WikilinkContext | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, end);
  const open = before.lastIndexOf('[[');
  if (open === -1) return null;
  const query = before.slice(open + 2);
  if (/[\]\n|]/.test(query)) return null;
  return { start: open, end, query, embed: open > 0 && text[open - 1] === '!' };
}
