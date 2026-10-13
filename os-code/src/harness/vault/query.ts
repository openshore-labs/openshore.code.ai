// The Vault's search grammar (Vault M6, tech review K8): whitespace-separated clauses;
// `"a phrase"`; `tag:x` or `tag:#x` (matches `x` and `x/...`); `path:x`;
// `file:x` (`.md` optional); a quoted value; a leading `-` negates any clause.
// Anything else, `foo:bar` included, is plain terms. `#idea` means `tag:idea`
// (UX review X1). No OR, parentheses, regex, `line:`, `section:` or `task:` in v1.
//
// The index (index.ts) runs the query: terms AND together and rank by BM25,
// the last bare term is a prefix while typing, filters narrow. Phrases are a
// candidate filter there (each of their words must be in the note) and are
// verified on bodies by the host with `phrasesMatch`, since the index keeps
// no bodies. Highlights come from `highlightRanges`, drawn as `<mark>`
// elements, never an HTML string.
//
// Pure and import-free past the vault core.

import { tokenize } from './tokenize.js';
import type { TextRange, VaultQuery, VaultQueryClause, VaultQueryClauseKind } from './types.js';

// ---------------------------------------------------------------------------
// Folding

/** The one fold every comparison here uses: NFKC, then lowercase. */
export function foldQueryText(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

const WS = /\s/u;

/** Text folded for matching, with each folded code unit's source span, so a
 *  match in the folded string maps back to the original offsets. Runs of
 *  whitespace fold to one space. */
export interface FoldedText {
  text: string;
  /** Source offset where the folded unit's code point starts. */
  from: Int32Array;
  /** Source offset where it ends. */
  to: Int32Array;
}

export function foldWithMap(source: string): FoldedText {
  const n = source.length;
  // NFKC can expand a code point (a ligature, a fraction), so size loosely
  // and grow on demand.
  let from = new Int32Array(n + 8);
  let to = new Int32Array(n + 8);
  const parts: string[] = [];
  let len = 0;
  let lastSpace = false;
  const push = (s: string, a: number, b: number) => {
    if (len + s.length > from.length) {
      const grow = Math.max(from.length * 2, len + s.length + 8);
      const f = new Int32Array(grow);
      const t = new Int32Array(grow);
      f.set(from);
      t.set(to);
      from = f;
      to = t;
    }
    for (let k = 0; k < s.length; k++) {
      from[len + k] = a;
      to[len + k] = b;
    }
    len += s.length;
    parts.push(s);
  };
  for (let i = 0; i < n;) {
    const c = source.charCodeAt(i);
    if (c < 0x80) {
      // ASCII fast path.
      if (c === 32 || (c >= 9 && c <= 13)) {
        if (!lastSpace) push(' ', i, i + 1);
        else to[len - 1] = i + 1;
        lastSpace = true;
      } else {
        push(c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : source[i]!, i, i + 1);
        lastSpace = false;
      }
      i++;
      continue;
    }
    const cp = source.codePointAt(i)!;
    const w = cp > 0xffff ? 2 : 1;
    const ch = source.slice(i, i + w);
    if (WS.test(ch)) {
      if (!lastSpace) push(' ', i, i + w);
      else to[len - 1] = i + w;
      lastSpace = true;
    } else {
      push(foldQueryText(ch), i, i + w);
      lastSpace = false;
    }
    i += w;
  }
  return { text: parts.join(''), from: from.subarray(0, len), to: to.subarray(0, len) };
}

/** A folded value with whitespace collapsed and trimmed. */
function foldValue(s: string): string {
  return foldQueryText(s).replace(/\s+/gu, ' ').trim();
}

// ---------------------------------------------------------------------------
// Parsing

const OPERATOR = /^(tag|path|file):/i;

/** Parse what the person typed into clauses. Never throws on any input.
 *
 *  `prefix` is the last clause when it is a positive bare term and the query
 *  does not end in whitespace; it is then left out of `clauses`.
 *  `filtersOnly` is true when there is at least one clause and no positive
 *  term, phrase or prefix, so matches list newest first. */
export function parseVaultQuery(q: string): VaultQuery {
  const input = typeof q === 'string' ? q : '';
  const clauses: VaultQueryClause[] = [];
  let lastBare = -1;
  let i = 0;
  const n = input.length;
  const add = (kind: VaultQueryClauseKind, raw: string, negated: boolean): boolean => {
    let value = kind === 'phrase' ? foldValue(raw) : foldQueryText(raw).trim();
    if (kind === 'tag') value = value.replace(/^#+/, '');
    if (kind === 'path' || kind === 'file') value = value.replace(/\s+/gu, ' ');
    if (!value) return false;
    clauses.push({ kind, value, negated });
    return true;
  };

  while (i < n) {
    while (i < n && WS.test(input[i]!)) i++;
    if (i >= n) break;
    let negated = false;
    if (input[i] === '-' && i + 1 < n && !WS.test(input[i + 1]!)) {
      negated = true;
      i++;
    }
    const op = OPERATOR.exec(input.slice(i, i + 5));
    if (op) {
      i += op[0].length;
      const kind = op[1]!.toLowerCase() as 'tag' | 'path' | 'file';
      const read = readValue(input, i);
      i = read.end;
      add(kind, read.value, negated);
      lastBare = -1;
      continue;
    }
    if (input[i] === '"') {
      const read = readValue(input, i);
      i = read.end;
      add('phrase', read.value, negated);
      lastBare = -1;
      continue;
    }
    const start = i;
    while (i < n && !WS.test(input[i]!)) i++;
    const word = input.slice(start, i);
    if (word.startsWith('#')) {
      add('tag', word, negated);
      lastBare = -1;
      continue;
    }
    lastBare = add('term', word, negated) && !negated ? clauses.length - 1 : -1;
  }

  let prefix: string | undefined;
  const endsOpen = n > 0 && !WS.test(input[n - 1]!);
  if (endsOpen && lastBare >= 0 && lastBare === clauses.length - 1) {
    prefix = clauses.pop()!.value;
  }
  const positive = clauses.some((c) => !c.negated && (c.kind === 'term' || c.kind === 'phrase'));
  const out: VaultQuery = {
    clauses,
    filtersOnly: clauses.length > 0 && !positive && prefix === undefined,
  };
  if (prefix !== undefined) out.prefix = prefix;
  return out;
}

/** A value at `i`: quoted (to the closing quote, or the end of input while
 *  typing) or bare (to the next whitespace). */
function readValue(input: string, i: number): { value: string; end: number } {
  if (input[i] === '"') {
    const close = input.indexOf('"', i + 1);
    if (close === -1) return { value: input.slice(i + 1), end: input.length };
    return { value: input.slice(i + 1, close), end: close + 1 };
  }
  let j = i;
  while (j < input.length && !WS.test(input[j]!)) j++;
  return { value: input.slice(i, j), end: j };
}

// ---------------------------------------------------------------------------
// Matching helpers shared with the index

const RUN = /[\p{L}\p{N}]+/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** The prefix as the index expands it: the last letter-and-digit run of the
 *  folded prefix (`stem`), and the whole terms before it (`terms`). A stem in
 *  Han, Kana or Hangul is not expanded (those index as bigrams), so it is
 *  returned as terms. */
export function prefixParts(prefix: string): { terms: string[]; stem: string } {
  const folded = foldQueryText(prefix);
  let stem = '';
  let stemStart = folded.length;
  RUN.lastIndex = 0;
  for (let m = RUN.exec(folded); m; m = RUN.exec(folded)) {
    stem = m[0];
    stemStart = m.index;
  }
  if (!stem || CJK.test(stem)) return { terms: tokenize(folded), stem: '' };
  return { terms: tokenize(folded.slice(0, stemStart)), stem };
}

/** Whether `text` holds `phrase` (both folded, whitespace runs as one
 *  space). */
function phraseAt(folded: string, phrase: string, from: number): number {
  return phrase ? folded.indexOf(phrase, from) : -1;
}

/** The phrase check the index cannot run (it keeps no bodies): every
 *  positive phrase is in `text` and no negated one is. Case and extra spaces
 *  are ignored. True for a query with no phrases. */
export function phrasesMatch(text: string, query: VaultQuery): boolean {
  const phrases = query.clauses.filter((c) => c.kind === 'phrase');
  if (phrases.length === 0) return true;
  const folded = foldWithMap(text).text;
  for (const c of phrases) {
    const hit = phraseAt(folded, c.value, 0) >= 0;
    if (hit === c.negated) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Highlights

/** Where the query's positive terms, prefix and phrases match in `text`, in
 *  order and never overlapping, for `<mark>` elements (never an HTML
 *  string). A term matches a whole word; the prefix matches a word's start;
 *  a phrase matches anywhere, case and extra spaces ignored. */
export function highlightRanges(text: string, query: VaultQuery): TextRange[] {
  if (!text) return [];
  const words = new Set<string>();
  const bigrams = new Set<string>();
  const phrases: string[] = [];
  for (const c of query.clauses) {
    if (c.negated) continue;
    if (c.kind === 'phrase') phrases.push(c.value);
    else if (c.kind === 'term') for (const t of tokenize(c.value)) addWord(t, words, bigrams);
  }
  let stem = '';
  if (query.prefix !== undefined) {
    const p = prefixParts(query.prefix);
    for (const t of p.terms) addWord(t, words, bigrams);
    stem = p.stem;
  }
  if (words.size === 0 && bigrams.size === 0 && phrases.length === 0 && !stem) return [];

  const f = foldWithMap(text);
  const raw: Array<[number, number]> = [];
  const mark = (a: number, b: number) => {
    if (b > a) raw.push([f.from[a]!, f.to[b - 1]!]);
  };

  if (words.size > 0 || stem) {
    RUN.lastIndex = 0;
    for (let m = RUN.exec(f.text); m; m = RUN.exec(f.text)) {
      const run = m[0];
      if (!CJK.test(run)) {
        if (words.has(run) || (stem && run.startsWith(stem))) mark(m.index, m.index + run.length);
        continue;
      }
      // A mixed run: its non-CJK stretches are words, as the tokenizer reads.
      const re = /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
      for (let w = re.exec(run); w; w = re.exec(run)) {
        const s = w[0];
        if (words.has(s) || (stem && s.startsWith(stem))) {
          mark(m.index + w.index, m.index + w.index + s.length);
        }
      }
    }
  }
  for (const b of bigrams) {
    for (let at = f.text.indexOf(b); at !== -1; at = f.text.indexOf(b, at + 1)) {
      mark(at, at + b.length);
    }
  }
  for (const p of phrases) {
    for (let at = phraseAt(f.text, p, 0); at !== -1; at = phraseAt(f.text, p, at + p.length)) {
      mark(at, at + p.length);
    }
  }
  return mergeRanges(raw);
}

function addWord(t: string, words: Set<string>, bigrams: Set<string>): void {
  if (CJK.test(t)) bigrams.add(t);
  else words.add(t);
}

/** Sorted, overlapping ranges merged into one. */
export function mergeRanges(raw: Array<[number, number]>): TextRange[] {
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: TextRange[] = [];
  for (const [start, end] of raw) {
    const last = out[out.length - 1];
    if (last && start < last.end) last.end = Math.max(last.end, end);
    else out.push({ start, end });
  }
  return out;
}
