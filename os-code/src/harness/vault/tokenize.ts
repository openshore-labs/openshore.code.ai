// The Vault index's tokenizer (Vault M3, tech review H3). One function turns text into
// search terms, the same way for a note and for a query, so BM25 compares like
// with like. Pure, with no imports, so the phone can run it.
//
// The rule: NFKC, lowercase, runs of letters and digits (\p{L}\p{N}), 2 to 32
// characters (counted in code points). A run of Han, Kana or Hangul becomes
// overlapping bigrams, since those scripts do not separate words with spaces.
// No stemming. About 30 English stopwords are dropped from a note's body only
// (a title or a heading keeps them, and a query made only of stopwords keeps
// them too, so "the who" still finds something).

/** The shortest and longest term kept, in code points. */
export const TERM_MIN = 2;
export const TERM_MAX = 32;

/** Dropped from a note's body only. */
export const BODY_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'not',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
]);

const RUN = /[\p{L}\p{N}]+/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_SPLIT = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+)/u;

/** Call `emit` for every term in `text`, in order. The text is NFKC-folded
 *  and lowercased first. */
export function eachTerm(text: string, emit: (term: string) => void): void {
  const folded = text.normalize('NFKC').toLowerCase();
  RUN.lastIndex = 0;
  for (let m = RUN.exec(folded); m; m = RUN.exec(folded)) {
    const run = m[0];
    if (!CJK.test(run)) {
      emitWord(run, emit);
      continue;
    }
    // A mixed run ("iphone15的设计"): the CJK stretches become bigrams, the
    // rest stay words.
    const parts = run.split(CJK_SPLIT);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!part) continue;
      if (i % 2 === 1) emitBigrams(part, emit);
      else emitWord(part, emit);
    }
  }
}

function emitWord(word: string, emit: (term: string) => void): void {
  // Code-point length; a surrogate pair counts once.
  let n = word.length;
  if (n >= TERM_MIN && n <= TERM_MAX * 2) {
    n = 0;
    for (const _ of word) n++;
  }
  if (n >= TERM_MIN && n <= TERM_MAX) emit(word);
}

function emitBigrams(run: string, emit: (term: string) => void): void {
  const cps = Array.from(run);
  for (let i = 0; i + 1 < cps.length; i++) emit(cps[i]! + cps[i + 1]!);
}

/** Every term in `text`, in order, repeats kept. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  eachTerm(text, (t) => out.push(t));
  return out;
}

/** The distinct terms of a search query. Stopwords are dropped unless the
 *  query is nothing but stopwords. */
export function queryTerms(query: string): string[] {
  const all = [...new Set(tokenize(query))];
  const kept = all.filter((t) => !BODY_STOPWORDS.has(t));
  return kept.length > 0 ? kept : all;
}
