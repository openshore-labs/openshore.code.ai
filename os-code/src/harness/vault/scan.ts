// The Vault's note scanner (Vault M3, CTO H1): one hand-rolled, flat pass over
// a note that finds the frontmatter block, links, tags, headings and block ids,
// and the ranges it skipped (code, math, comments). Not remark: remark builds a
// full tree (too slow for a 5,000-note vault on the reference box), has no
// wikilink grammar, and weighs about 40 packages; a flat scanner also gives the
// exact offsets `rewriteLinks` splices. The renderer keeps remark for display
// and runs `scanInlineLinks` on its text nodes only.
//
// All offsets are JS string indices into the full text.
//
// Documented divergences from Obsidian (each has a row in the tests):
//   - indented code is NOT skipped: getting list context wrong would drop real
//     backlinks, which is worse than indexing a link inside an indented block;
//   - a `---` setext underline is ignored (only `===` makes a heading);
//   - an unclosed `$$` is literal text (money, not math); an unclosed `%%` or
//     `<!--` hides the rest of the note, as Obsidian renders it;
//   - markdown link text stays on one line.
//
// Pure and import-free past the shared types.

import type {
  BlockIdToken,
  FrontmatterRange,
  HeadingToken,
  LinkToken,
  LinkWhere,
  NoteScan,
  SkippedRange,
  TagToken,
} from './types.js';

export const SCAN_CAPS = { links: 2000, tags: 500, headings: 1000 } as const;

/** Is `line` (no line break) a frontmatter delimiter: `---` and trailing
 *  spaces or tabs? */
function isDelimiter(line: string): boolean {
  return /^---[ \t]*$/.test(line);
}

/** The end of the line starting at `i` (the index of its "\n", or the text
 *  length), and the end of its content (before a "\r\n"). */
function lineBounds(text: string, i: number): { contentEnd: number; next: number } {
  const nl = text.indexOf('\n', i);
  if (nl === -1) return { contentEnd: text.length, next: text.length };
  const contentEnd = nl > i && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
  return { contentEnd, next: nl + 1 };
}

/** The frontmatter block: only at index 0 (after an optional U+FEFF), opened
 *  by a `---` line, closed by the next `---` line. Unclosed means none. CRLF
 *  is accepted. `end` is past the closing line's break, so `text.slice(end)`
 *  is the body. */
export function findFrontmatter(text: string): FrontmatterRange | null {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const first = lineBounds(text, start);
  if (first.next === first.contentEnd) return null; // no line break after it
  if (!isDelimiter(text.slice(start, first.contentEnd))) return null;
  let i = first.next;
  while (i < text.length) {
    const { contentEnd, next } = lineBounds(text, i);
    if (isDelimiter(text.slice(i, contentEnd))) {
      return { start, end: next, raw: text.slice(first.next, i) };
    }
    if (next === i) break;
    i = next;
  }
  return null;
}

/** A fence opener: after any leading whitespace and any `>` quote markers, 3
 *  or more backticks or tildes. A backtick fence's info string holds no
 *  backtick. */
function fenceOpen(line: string): { ch: string; len: number } | null {
  const m = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const run = m[1]!;
  if (run[0] === '`' && m[2]!.includes('`')) return null;
  return { ch: run[0]!, len: run.length };
}

function fenceCloses(line: string, fence: { ch: string; len: number }): boolean {
  const m = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m && m[1]![0] === fence.ch && m[1]!.length >= fence.len;
}

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const TAG_BODY = /^[\p{L}\p{N}_\-/]+/u;
const BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/;

/** A markdown link destination names a note when it ends in `.md` or has no
 *  extension; anything else (`pic.png`, `notes.txt`) is an attachment. */
export function isNoteDestination(path: string): boolean {
  if (/\.md$/i.test(path)) return true;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return !/\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(last);
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Parse a wikilink whose `[[` starts at `open` (the `!` of an embed sits at
 *  `open - 1`). One line only. Undefined when the grammar does not match. */
function parseWikilink(
  text: string,
  open: number,
  limit: number,
  embed: boolean,
  where: LinkWhere,
): LinkToken | undefined {
  let i = open + 2;
  const tStart = i;
  while (i < limit) {
    const c = text[i]!;
    if (c === '[' || c === ']' || c === '|' || c === '#' || c === '^' || c === '\n' || c === '\r') {
      break;
    }
    i++;
  }
  let tEnd = i;
  let subpath: string | undefined;
  let alias: string | undefined;
  if (text[i] === '#') {
    const sStart = ++i;
    while (i < limit && !/[[\]|\n\r]/.test(text[i]!)) i++;
    subpath = text.slice(sStart, i).trim();
    if (text[i] === '|' && subpath.endsWith('\\')) subpath = subpath.slice(0, -1).trim();
  }
  if (text[i] === '|') {
    // A table cell writes the pipe escaped: [[Note\|alias]].
    if (tEnd > tStart && text[tEnd - 1] === '\\' && subpath === undefined) tEnd--;
    const aStart = ++i;
    while (i < limit && !/[[\]\n\r]/.test(text[i]!)) i++;
    alias = text.slice(aStart, i).trim() || undefined;
  }
  if (text[i] !== ']' || text[i + 1] !== ']') return undefined;
  // Trim the target's own range.
  while (tStart < tEnd && /\s/.test(text[tEnd - 1]!)) tEnd--;
  let ts = tStart;
  while (ts < tEnd && /\s/.test(text[ts]!)) ts++;
  const target = text.slice(ts, tEnd);
  if (!target && subpath === undefined) return undefined;
  const token: LinkToken = {
    kind: 'wiki',
    start: embed ? open - 1 : open,
    end: i + 2,
    target,
    targetStart: ts,
    targetEnd: ts + target.length,
    embed,
    where,
  };
  if (subpath) token.subpath = subpath;
  if (alias !== undefined) token.alias = alias;
  return token;
}

/** Parse a markdown link whose `[` starts at `open`. The text stays on one
 *  line; the destination is `(dest)` or `(<dest>)`, then an optional title.
 *  Returns the token (undefined for a skipped destination) and the end of the
 *  whole construct, or null when the grammar does not match. */
function parseMarkdownLink(
  text: string,
  open: number,
  limit: number,
  embed: boolean,
): { token?: LinkToken; end: number } | null {
  let i = open + 1;
  let depth = 1;
  while (i < limit) {
    const c = text[i]!;
    if (c === '\n' || c === '\r') return null;
    if (c === '\\' && i + 1 < limit) {
      i += 2;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
    i++;
  }
  if (depth !== 0 || text[i + 1] !== '(') return null;
  const label = text.slice(open + 1, i);
  i += 2;
  while (i < limit && (text[i] === ' ' || text[i] === '\t')) i++;
  let dStart: number;
  let dEnd: number;
  if (text[i] === '<') {
    dStart = i + 1;
    const close = text.indexOf('>', dStart);
    if (close === -1 || close >= limit) return null;
    const inner = text.slice(dStart, close);
    if (/[<\n\r]/.test(inner)) return null;
    dEnd = close;
    i = close + 1;
  } else {
    dStart = i;
    let parens = 0;
    while (i < limit) {
      const c = text[i]!;
      if (c === '\\' && i + 1 < limit) {
        i += 2;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
      if (c === '(') parens++;
      else if (c === ')') {
        if (parens === 0) break;
        parens--;
      }
      i++;
    }
    dEnd = i;
  }
  while (i < limit && (text[i] === ' ' || text[i] === '\t')) i++;
  const q = text[i];
  if (q === '"' || q === "'" || q === '(') {
    const closeCh = q === '(' ? ')' : q;
    const close = text.indexOf(closeCh, i + 1);
    if (close === -1 || close >= limit) return null;
    if (/[\n\r]/.test(text.slice(i, close))) return null;
    i = close + 1;
    while (i < limit && (text[i] === ' ' || text[i] === '\t')) i++;
  }
  if (text[i] !== ')') return null;
  const end = i + 1;
  const dest = text.slice(dStart, dEnd);
  if (
    !dest ||
    dest.startsWith('#') ||
    dest.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(dest)
  ) {
    return { end };
  }
  const hash = dest.indexOf('#');
  const rawTarget = hash === -1 ? dest : dest.slice(0, hash);
  const target = decode(rawTarget);
  if (!target) return { end };
  const token: LinkToken = {
    kind: 'md',
    start: embed ? open - 1 : open,
    end,
    target,
    targetStart: dStart,
    targetEnd: dStart + rawTarget.length,
    embed,
    where: 'body',
  };
  const subpath = hash === -1 ? '' : decode(dest.slice(hash + 1));
  if (subpath) token.subpath = subpath;
  if (label.trim()) token.alias = label.trim();
  if (!isNoteDestination(target)) token.attachment = true;
  return { token, end };
}

interface Sink {
  links: LinkToken[];
  tags: TagToken[];
  skipped: SkippedRange[];
  capped: NoteScan['capped'];
  /** Skip tags (the renderer's inline pass does not want them). */
  noTags?: boolean;
}

function pushLink(sink: Sink, token: LinkToken): void {
  if (sink.links.length >= SCAN_CAPS.links) sink.capped.links = true;
  else sink.links.push(token);
}

/** Where the paragraph holding `from` ends: the first line break followed by
 *  a blank line or a fence opener (a code span never crosses either), or the
 *  end of the text. */
function paragraphEnd(text: string, from: number): number {
  let nl = text.indexOf('\n', from);
  while (nl !== -1) {
    const { contentEnd } = lineBounds(text, nl + 1);
    const line = text.slice(nl + 1, contentEnd);
    if (/^[ \t]*$/.test(line) || fenceOpen(line)) return nl;
    nl = text.indexOf('\n', nl + 1);
  }
  return text.length;
}

/** The inline scanner over `[from, lineEnd)`. It may run past `lineEnd` when a
 *  code span, a comment or math closes on a later line, and returns where it
 *  stopped (at or past `lineEnd`). `noClose` remembers delimiters known to
 *  have no closer past a point, so a note full of stray backticks stays
 *  linear. */
function scanInline(
  text: string,
  from: number,
  lineEnd: number,
  sink: Sink,
  noClose: Map<string, number>,
): number {
  let i = from;
  const n = text.length;
  while (i < lineEnd) {
    const c = text[i]!;
    if (c === '\\') {
      i += i + 1 < lineEnd && ASCII_PUNCT.test(text[i + 1]!) ? 2 : 1;
      continue;
    }
    if (c === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      // The paragraph's end, cached while the scan stays inside it.
      let paraEnd = noClose.get('para');
      if (paraEnd === undefined || i >= paraEnd || i < (noClose.get('paraFrom') ?? 0)) {
        paraEnd = paragraphEnd(text, i);
        noClose.set('para', paraEnd);
        noClose.set('paraFrom', i);
      }
      const key = `\`${run}`;
      const known = noClose.get(key);
      let close = -1;
      if (known === undefined || i >= known) {
        let j = i + run;
        for (;;) {
          const k = text.indexOf('`', j);
          if (k === -1 || k >= paraEnd) break;
          let r = 1;
          while (text[k + r] === '`') r++;
          if (r === run) {
            close = k;
            break;
          }
          j = k + r;
        }
        // No closer before the paragraph ends: none for any later opener of
        // this length in the same paragraph either.
        if (close === -1) noClose.set(key, paraEnd);
      }
      if (close === -1) {
        i += run;
        continue;
      }
      sink.skipped.push({ kind: 'code-span', start: i, end: close + run });
      i = close + run;
      continue;
    }
    if (c === '<' && text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      const end = close === -1 ? n : close + 3;
      sink.skipped.push({ kind: 'html-comment', start: i, end });
      i = end;
      continue;
    }
    if (c === '%' && text[i + 1] === '%') {
      const close = text.indexOf('%%', i + 2);
      const end = close === -1 ? n : close + 2;
      sink.skipped.push({ kind: 'comment', start: i, end });
      i = end;
      continue;
    }
    if (c === '$' && text[i + 1] === '$') {
      const known = noClose.get('$$');
      const close = known !== undefined && i >= known ? -1 : text.indexOf('$$', i + 2);
      if (close === -1) {
        noClose.set('$$', -1);
        i += 2;
        continue;
      }
      sink.skipped.push({ kind: 'math', start: i, end: close + 2 });
      i = close + 2;
      continue;
    }
    const embed = c === '!' && text[i + 1] === '[';
    const open = embed ? i + 1 : i;
    if (text[open] === '[') {
      if (text[open + 1] === '[') {
        const token = parseWikilink(text, open, lineEnd, embed, 'body');
        if (token) {
          pushLink(sink, token);
          i = token.end;
          continue;
        }
      } else {
        const md = parseMarkdownLink(text, open, lineEnd, embed);
        if (md) {
          if (md.token) pushLink(sink, md.token);
          i = md.end;
          continue;
        }
      }
      i = open + 1;
      continue;
    }
    if (c === '#' && !sink.noTags) {
      const prev = i === 0 ? '\n' : text[i - 1]!;
      if (/[\s(,]/.test(prev)) {
        const m = TAG_BODY.exec(text.slice(i + 1, Math.min(lineEnd, i + 1 + 256)));
        if (m && /\D/.test(m[0])) {
          if (sink.tags.length >= SCAN_CAPS.tags) sink.capped.tags = true;
          else sink.tags.push({ start: i, end: i + 1 + m[0].length, tag: m[0] });
          i += 1 + m[0].length;
          continue;
        }
      }
    }
    i++;
  }
  return Math.max(i, lineEnd);
}

/** Wikilinks inside the frontmatter block (Obsidian reads links in string
 *  values). YAML comment lines are passed over. */
function scanFrontmatterLinks(text: string, fm: FrontmatterRange, sink: Sink): void {
  let i = fm.start;
  while (i < fm.end) {
    const { contentEnd, next } = lineBounds(text, i);
    if (!/^\s*#/.test(text.slice(i, contentEnd))) {
      let j = text.indexOf('[[', i);
      while (j !== -1 && j < contentEnd) {
        const embed = j > i && text[j - 1] === '!';
        const token = parseWikilink(text, j, contentEnd, embed, 'frontmatter');
        if (token) {
          pushLink(sink, token);
          j = text.indexOf('[[', token.end);
        } else j = text.indexOf('[[', j + 1);
      }
    }
    if (next === i) break;
    i = next;
  }
}

/** Every line start, for line numbers by binary search. */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

function lineOf(starts: number[], at: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function inSkipped(skipped: SkippedRange[], at: number): boolean {
  for (let k = skipped.length - 1; k >= 0; k--) {
    const r = skipped[k]!;
    if (at >= r.start && at < r.end) return true;
    // Ranges are pushed in text order and never overlap.
    if (r.end <= at) return false;
  }
  return false;
}

/** Scan one note: frontmatter, links (body and frontmatter), tags, headings,
 *  block ids, and the ranges skipped as code, math or comments. */
export function scanNote(text: string): NoteScan {
  const frontmatter = findFrontmatter(text);
  const sink: Sink = {
    links: [],
    tags: [],
    skipped: [],
    capped: { links: false, tags: false, headings: false },
  };
  const headings: HeadingToken[] = [];
  const blockIds: BlockIdToken[] = [];
  if (frontmatter) scanFrontmatterLinks(text, frontmatter, sink);
  const starts = lineStarts(text);
  const noClose = new Map<string, number>();
  const pushHeading = (h: HeadingToken) => {
    if (headings.length >= SCAN_CAPS.headings) sink.capped.headings = true;
    else headings.push(h);
  };

  let i = frontmatter ? frontmatter.end : text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let fence: { ch: string; len: number; start: number } | null = null;
  // The open paragraph, for a setext underline: its first line's start.
  let para: { start: number; end: number } | null = null;
  // Where inline scanning resumes when a span ran past a line end.
  let resume = -1;
  while (i < text.length) {
    const { contentEnd, next } = lineBounds(text, i);
    const line = text.slice(i, contentEnd);
    if (fence) {
      if (fenceCloses(line, fence)) {
        sink.skipped.push({ kind: 'fence', start: fence.start, end: contentEnd });
        fence = null;
      }
    } else if (resume > i) {
      // The line starts inside a span that closed on it (or later): no block
      // syntax here, only the rest of the line.
      if (resume < contentEnd) resume = scanInline(text, resume, contentEnd, sink, noClose);
      para = null;
    } else {
      const open = fenceOpen(line);
      if (open) {
        fence = { ...open, start: i };
        para = null;
      } else if (/^[ \t]*$/.test(line)) {
        para = null;
      } else if (para && /^ {0,3}=+[ \t]*$/.test(line)) {
        const raw = text.slice(para.start, para.end);
        pushHeading({
          level: 1,
          text: raw.replace(/\s*\n\s*/g, ' ').trim(),
          line: lineOf(starts, para.start),
          start: para.start,
          end: contentEnd,
        });
        para = null;
      } else {
        const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(line);
        if (atx) {
          const body = line
            .slice(atx[0].length)
            .replace(/(?:^|[ \t]+)#+[ \t]*$/, '')
            .trim();
          pushHeading({
            level: atx[1]!.length as HeadingToken['level'],
            text: body,
            line: lineOf(starts, i),
            start: i,
            end: contentEnd,
          });
          para = null;
        } else {
          para = para ? { start: para.start, end: contentEnd } : { start: i, end: contentEnd };
        }
        resume = scanInline(text, i, contentEnd, sink, noClose);
        const bid = BLOCK_ID.exec(line);
        if (bid) {
          const at = i + bid.index + bid[0].indexOf('^');
          if (!inSkipped(sink.skipped, at)) {
            blockIds.push({
              id: bid[1]!,
              line: lineOf(starts, i),
              start: at,
              end: at + 1 + bid[1]!.length,
            });
          }
        }
        if (resume > contentEnd) para = null;
      }
    }
    if (next === i) break;
    i = next;
  }
  if (fence) sink.skipped.push({ kind: 'fence', start: fence.start, end: text.length });
  sink.skipped.sort((a, b) => a.start - b.start);
  sink.links.sort((a, b) => a.start - b.start);
  return {
    frontmatter,
    links: sink.links,
    tags: sink.tags,
    headings,
    blockIds,
    skipped: sink.skipped,
    capped: sink.capped,
  };
}

/** The inline grammar over one string, for the renderer's text nodes: code
 *  spans, comments, math and escapes are skipped, and wikilinks and markdown
 *  links are returned with offsets into `text`. No block syntax, no tags. */
export function scanInlineLinks(text: string): LinkToken[] {
  const sink: Sink = {
    links: [],
    tags: [],
    skipped: [],
    capped: { links: false, tags: false, headings: false },
    noTags: true,
  };
  const noClose = new Map<string, number>();
  let i = 0;
  while (i < text.length) i = scanInline(text, i, text.length, sink, noClose);
  return sink.links;
}
