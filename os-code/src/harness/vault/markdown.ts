// Obsidian markdown helpers for the reading view and the editor (Vault M6,
// CTO K10, K11, K15): callout heads, `==highlight==` spans, hidden
// `%%comments%%` (masked with spaces, every line break kept, so offsets and
// line numbers hold), a heading's section and a block anchor's range for
// embeds and scroll-to, GFM tasks and their write-back toggle (skipped ranges
// respected), unlinked mentions, and the outline. All on text, so code is
// never touched: every helper that reads a whole note takes its skipped
// ranges (code, math, comments) from `scanNote`.
//
// Pure and import-free past the vault core.

import { scanNote } from './scan.js';
import type {
  CalloutFamily,
  CalloutHead,
  SkippedRange,
  TaskToggleResult,
  TextRange,
  UnlinkedMention,
  VaultTask,
} from './types.js';

// ---------------------------------------------------------------------------
// Shared line helpers

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

function lineOf(starts: readonly number[], at: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The end of the line's content starting at `i` (before "\n" or "\r\n"). */
function contentEndOf(text: string, i: number): number {
  const nl = text.indexOf('\n', i);
  if (nl === -1) return text.length;
  return nl > i && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
}

/** Is `at` inside one of `ranges` (sorted by start, non-overlapping)? */
function inRanges(ranges: readonly TextRange[], at: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (at < r.start) hi = mid - 1;
    else if (at >= r.end) lo = mid + 1;
    else return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Callouts (K10, CX X12)

const FAMILIES: Readonly<Record<string, CalloutFamily>> = {
  note: 'neutral',
  info: 'neutral',
  todo: 'neutral',
  abstract: 'neutral',
  summary: 'neutral',
  tldr: 'neutral',
  example: 'neutral',
  quote: 'neutral',
  cite: 'neutral',
  tip: 'positive',
  hint: 'positive',
  important: 'positive',
  success: 'positive',
  check: 'positive',
  done: 'positive',
  question: 'caution',
  help: 'caution',
  faq: 'caution',
  warning: 'caution',
  caution: 'caution',
  attention: 'caution',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',
};

/** The callout head on a blockquote's first line, or null. The line may carry
 *  its `>` markers (`> [!tip]- Title`) or be the quote's first text as the
 *  renderer sees it (`[!tip]- Title`). The type is folded and must match
 *  `[a-z-]{1,24}`; an unknown type is neutral and keeps its own title. */
export function parseCallout(line: string): CalloutHead | null {
  const m = /^[ \t]{0,3}(?:>[ \t]?)*\[!([^\]]*)\]([+-])?[ \t]*(.*?)[ \t]*$/.exec(
    line.replace(/\r?\n[\s\S]*$/, ''),
  );
  if (!m) return null;
  const type = m[1]!.trim().toLowerCase();
  if (!/^[a-z-]{1,24}$/.test(type)) return null;
  const head: CalloutHead = { type, family: FAMILIES[type] ?? 'neutral' };
  if (m[2]) head.fold = m[2] as '+' | '-';
  if (m[3]) head.title = m[3];
  return head;
}

// ---------------------------------------------------------------------------
// Highlights (K10)

/** `==highlight==` spans inside one text node (the renderer's mdast text, or
 *  a line): each range covers both `==` pairs. The inside is not empty,
 *  neither starts nor ends with whitespace, and holds no blank line. A span
 *  across emphasis is a documented divergence (it splits the text node). */
export function findHighlights(text: string): TextRange[] {
  const out: TextRange[] = [];
  let i = text.indexOf('==');
  while (i !== -1) {
    const open = i;
    // A run of three or more `=` is a rule or plain text, never an opener.
    let run = 0;
    while (text[open + run] === '=') run++;
    const first = text[open + run];
    if (run !== 2 || first === undefined || /\s/.test(first)) {
      i = text.indexOf('==', open + run);
      continue;
    }
    let close = text.indexOf('==', open + 2);
    let found = -1;
    while (close !== -1) {
      const inner = text.slice(open + 2, close);
      if (/\n[ \t]*\r?\n/.test(inner)) break;
      if (!/\s/.test(text[close - 1]!) && text[close + 2] !== '=') {
        found = close;
        break;
      }
      close = text.indexOf('==', close + 1);
    }
    if (found === -1) {
      i = text.indexOf('==', open + 2);
      continue;
    }
    out.push({ start: open, end: found + 2 });
    i = text.indexOf('==', found + 2);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comments (K10)

/** `text` with every `%%comment%%` replaced by spaces, line breaks kept, so
 *  the result is the same length. Only `%%` comments, found by the scanner
 *  (so `%%` inside code stays). An unclosed `%%` hides the rest of the note,
 *  as Obsidian renders it. */
export function maskComments(text: string): string {
  const comments = scanNote(text).skipped.filter((r) => r.kind === 'comment');
  if (!comments.length) return text;
  let out = '';
  let at = 0;
  for (const r of comments) {
    out += text.slice(at, r.start);
    out += text.slice(r.start, r.end).replace(/[^\r\n]/g, ' ');
    at = r.end;
  }
  return out + text.slice(at);
}

// ---------------------------------------------------------------------------
// Sections and block anchors (K10, K11)

function sameHeading(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

/** The range of the section under the first heading whose text is `heading`
 *  (to the next heading of the same or a higher level, else the end), or
 *  null. The range starts at the heading line itself. The match is exact
 *  first, then case- and space-insensitive. A nested path (`A#B`, as
 *  `[[Note#A#B]]` writes it) finds `B` inside `A`'s section. */
export function sectionOf(text: string, heading: string): TextRange | null {
  const path = heading
    .split('#')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!path.length) return null;
  const headings = scanNote(text).headings;
  let lo = 0;
  let hi = text.length;
  let found: TextRange | null = null;
  for (const want of path) {
    const inside = headings.filter((h) => h.start >= lo && h.start < hi);
    const hit =
      inside.find((h) => h.text === want) ?? inside.find((h) => sameHeading(h.text, want));
    if (!hit) return null;
    const next = headings.find((h) => h.start > hit.start && h.level <= hit.level);
    found = { start: hit.start, end: Math.min(next ? next.start : text.length, hi) };
    lo = found.start + 1;
    hi = found.end;
  }
  return found;
}

/** An anchor alone on its line (`^id`, after a table or a quote), which the
 *  scanner's end-of-line rule does not see. */
function standaloneAnchor(
  text: string,
  starts: readonly number[],
  skipped: readonly SkippedRange[],
  want: string,
): { line: number; start: number } | undefined {
  const re = new RegExp(`^[ \\t]*\\^(${escapeRegExp(want)})[ \\t]*$`, 'i');
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k]!;
    const m = re.exec(text.slice(s, contentEndOf(text, s)));
    if (!m) continue;
    const at = s + m[0].indexOf('^');
    if (!inRanges(skipped, at)) return { line: k, start: at };
  }
  return undefined;
}

const LIST_ITEM = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** The range of the block that carries `^id`, or null: the list item's line
 *  when the anchor ends one, else the paragraph up to and including the
 *  anchor's line. An anchor alone on its line names the block just above it
 *  (a table, a quote, a list), to the blank line before that block. The
 *  range includes the `^id` itself; the reader hides it. */
export function blockAnchorAt(text: string, id: string): TextRange | null {
  const want = id.replace(/^\^/, '');
  if (!want) return null;
  const scan = scanNote(text);
  const starts = lineStarts(text);
  const anchor =
    scan.blockIds.find((b) => b.id === want) ??
    scan.blockIds.find((b) => b.id.toLowerCase() === want.toLowerCase()) ??
    standaloneAnchor(text, starts, scan.skipped, want);
  if (!anchor) return null;
  const floor = scan.frontmatter ? scan.frontmatter.end : 0;
  const lineStart = starts[anchor.line]!;
  const lineEnd = contentEndOf(text, lineStart);
  const lineText = (k: number) => text.slice(starts[k]!, contentEndOf(text, starts[k]!));
  const blank = (k: number) => /^[ \t]*$/.test(lineText(k));
  const own = text.slice(lineStart, anchor.start);
  if (/^[ \t]*$/.test(own)) {
    // The anchor stands alone: the block above it.
    let k = anchor.line - 1;
    while (k >= 0 && starts[k]! >= floor && blank(k)) k--;
    if (k < 0 || starts[k]! < floor) return { start: lineStart, end: lineEnd };
    const end = contentEndOf(text, starts[k]!);
    while (k - 1 >= 0 && starts[k - 1]! >= floor && !blank(k - 1)) k--;
    return { start: starts[k]!, end: lineEnd > end ? lineEnd : end };
  }
  if (LIST_ITEM.test(own)) return { start: lineStart, end: lineEnd };
  let k = anchor.line;
  while (k - 1 >= 0 && starts[k - 1]! >= floor && !blank(k - 1)) {
    const above = lineText(k - 1);
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(above) || LIST_ITEM.test(above)) break;
    k--;
  }
  return { start: starts[k]!, end: lineEnd };
}

// ---------------------------------------------------------------------------
// Tasks (K11)

const TASK = /^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([^\]\r\n])\](?=[ \t]|$)/;

function tasksOf(text: string, skipped: readonly SkippedRange[], bodyStart: number): VaultTask[] {
  const out: VaultTask[] = [];
  let line = 0;
  let i = 0;
  while (i <= text.length) {
    const end = contentEndOf(text, i);
    if (i >= bodyStart) {
      const m = TASK.exec(text.slice(i, end));
      if (m) {
        const at = i + m[1]!.length + 1;
        if (!inRanges(skipped, at)) {
          const status = m[2]!;
          out.push({
            at,
            line,
            status,
            checked: status !== ' ',
            custom: status !== ' ' && status !== 'x' && status !== 'X',
          });
        }
      }
    }
    const nl = text.indexOf('\n', i);
    if (nl === -1) break;
    i = nl + 1;
    line++;
  }
  return out;
}

/** Every GFM task in the note, frontmatter lines counted, skipped ranges
 *  (code, math, comments) left out. */
export function listTasks(text: string): VaultTask[] {
  const scan = scanNote(text);
  return tasksOf(text, scan.skipped, scan.frontmatter ? scan.frontmatter.end : 0);
}

/** Tick or untick the task whose status sits at `at`, only while it is still
 *  `expected`: `[ ]` to `[x]`, `[x]` or `[X]` to `[ ]`. A custom status never
 *  toggles. Every other byte stays. */
export function toggleTaskAt(text: string, at: number, expected: string): TaskToggleResult {
  const task = listTasks(text).find((t) => t.at === at);
  if (!task) return { ok: false, reason: 'none' };
  if (task.status !== expected) return { ok: false, reason: 'moved' };
  if (task.custom) return { ok: false, reason: 'custom' };
  const status = task.status === ' ' ? 'x' : ' ';
  return { ok: true, text: text.slice(0, at) + status + text.slice(at + 1), status };
}

// ---------------------------------------------------------------------------
// Unlinked mentions (K15)

/** At most this many mentions per note: the card lists, it does not count. */
export const UNLINKED_MENTION_CAP = 200;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive matches of `names` outside links, code,
 *  math, comments, tags, bare URLs and frontmatter. A space in a name matches
 *  any run of spaces or tabs. Where two names overlap, the earlier match
 *  wins, then the longer one. At most `UNLINKED_MENTION_CAP`. */
export function findUnlinkedMentions(text: string, names: readonly string[]): UnlinkedMention[] {
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const n = raw.trim();
    const key = n.toLowerCase();
    if (!n || seen.has(key)) continue;
    seen.add(key);
    wanted.push(n);
  }
  if (!wanted.length) return [];
  const scan = scanNote(text);
  const blocked: TextRange[] = [
    ...scan.skipped,
    ...scan.links,
    ...scan.tags,
    ...(scan.frontmatter ? [scan.frontmatter] : []),
  ];
  for (const m of text.matchAll(/\b(?:https?|ftp|mailto|file|obsidian):[^\s<>)\]]+/gi)) {
    blocked.push({ start: m.index, end: m.index + m[0].length });
  }
  blocked.sort((a, b) => a.start - b.start);
  // Merge overlaps so the binary search holds.
  const merged: TextRange[] = [];
  for (const r of blocked) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  }
  const blockedAt = (start: number, end: number) => {
    for (let k = start; k < end; k++) if (inRanges(merged, k)) return true;
    return false;
  };
  const found: Array<{ start: number; end: number; name: string }> = [];
  for (const name of wanted) {
    const body = name
      .split(/[ \t]+/)
      .map(escapeRegExp)
      .join('[ \\t]+');
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu');
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (!blockedAt(start, end)) found.push({ start, end, name });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const starts = lineStarts(text);
  const out: UnlinkedMention[] = [];
  let reach = -1;
  for (const f of found) {
    if (f.start < reach) continue;
    out.push({ start: f.start, end: f.end, name: f.name, line: lineOf(starts, f.start) });
    reach = f.end;
    if (out.length >= UNLINKED_MENTION_CAP) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outline (K15, CX X16)

/** One outline row: the heading, and the indent the sheet draws (H1 is 0;
 *  H4 and below align with H3, so the deepest indent is 2). */
export interface VaultOutlineItem extends TextRange {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  line: number;
  depth: 0 | 1 | 2;
  /** The heading's zero-based position among the note's headings, the value
   *  the reader writes as `data-heading-index`. */
  index: number;
}

/** The note's headings as an outline, frontmatter and code excluded. */
export function outlineOf(text: string): VaultOutlineItem[] {
  return scanNote(text).headings.map((h, index) => ({
    start: h.start,
    end: h.end,
    level: h.level,
    text: h.text,
    line: h.line,
    depth: Math.min(h.level - 1, 2) as 0 | 1 | 2,
    index,
  }));
}
