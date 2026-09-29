// The premium harness, CTO 6: retrieval before turn one, off until the eval.
//
// A small seat spends its first turns finding the code: a grep, a glob, a
// read of the wrong file. With `harness.retrieval.firstTurn: 'on'` the
// harness searches the workspace for the task's own words before the first
// turn and puts the best excerpts, each named by file and first line, at the
// head of the task, so the model starts where the code is. It adds prefill,
// which is slow on the CPU-only reference box, so it stays off until
// `osc eval --deep --retrieval on|off` shows a lift (tenet 2).
//
// This half is pure (tenet 5): the budget, the task's search words, and the
// block the excerpts become. The search itself reads files, so it lives on
// the engine's side (`keywordHits` in context/index.ts, wired by
// core/agent/lifts.ts), which also decides what is never read: a
// secret-shaped file, a local-only path, a path the policy denies.

/** The most tokens the excerpts may take, however large the window. */
export const RETRIEVAL_MAX_TOKENS = 1_500;

/** The share of the served window the excerpts may take, when that is less. */
export const RETRIEVAL_WINDOW_FRACTION = 0.1;

/** Below this there is no room for an excerpt worth reading. */
const RETRIEVAL_MIN_TOKENS = 80;

/** The most search words taken from one task. */
const MAX_TERMS = 12;

/** The most characters one excerpt line carries (a minified line would eat
 *  the whole budget). */
const MAX_LINE_CHARS = 240;

/** Tokens for a stretch of text, at the estimator's rate of four characters
 *  a token (context/compaction.ts). */
function tokensOf(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The budget for the excerpts on a seat served `servedWindow` tokens: the
 *  lesser of `RETRIEVAL_MAX_TOKENS` and `RETRIEVAL_WINDOW_FRACTION` of the
 *  window, and 0 when that leaves no room for an excerpt. */
export function retrievalBudgetTokens(servedWindow: number): number {
  if (!Number.isFinite(servedWindow) || servedWindow <= 0) return 0;
  const budget = Math.min(
    RETRIEVAL_MAX_TOKENS,
    Math.floor(servedWindow * RETRIEVAL_WINDOW_FRACTION),
  );
  return budget >= RETRIEVAL_MIN_TOKENS ? budget : 0;
}

// Words that say nothing about where the code is: English glue, the verbs a
// task opens with, and path noise.
const STOP_WORDS = new Set(
  (
    'the and for that this with from into your you are was were have has had not but can ' +
    'will would should could what when where which who how why all any each make made ' +
    'add fix change update please use using let get set put see show tell give take want ' +
    'need does did done new one two some more most other same sure just only then than ' +
    'there their them they its also like about after before again here our out off now ' +
    'file files code reply answer number value way thing things work works working ' +
    'src lib mjs cjs tsx jsx'
  ).split(' '),
);

/**
 * The task's search words: identifiers and words of three or more
 * characters, less the stop words, in the order they first appear, at most
 * `MAX_TERMS`. Lowercased, since the search folds case.
 */
export function taskTerms(task: string): string[] {
  const out: string[] = [];
  for (const raw of task.split(/[^A-Za-z0-9_$]+/)) {
    const word = raw.toLowerCase();
    if (word.length < 3 || /^\d+$/.test(word) || STOP_WORDS.has(word)) continue;
    if (out.includes(word)) continue;
    out.push(word);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/** One excerpt the search found: a file, the line it starts at, its lines. */
export interface RetrievalHit {
  path: string;
  startLine: number;
  lines: string[];
}

/** Where an excerpt the block used came from, for the card. */
export interface RetrievalSource {
  path: string;
  line: number;
}

export interface RetrievalBlock {
  /** The block that heads the task's first message. */
  text: string;
  /** Each excerpt the block carries, in order. */
  sources: RetrievalSource[];
  /** What the block costs, at the estimator's rate. */
  tokens: number;
}

/** The line that opens the block: what it is and how to use it, short
 *  enough for a lean seat. */
export const RETRIEVAL_HEAD =
  "Code in this workspace that matches the task's words, found before your first turn. Each excerpt names its file and first line; read the file for the rest.";

function excerpt(hit: RetrievalHit, lines: string[]): string {
  const end = hit.startLine + Math.max(0, lines.length - 1);
  const where =
    lines.length > 1 ? `${hit.path}:${hit.startLine}-${end}` : `${hit.path}:${hit.startLine}`;
  return `${where}\n${lines.join('\n')}`;
}

/**
 * The excerpts as one block within `budgetTokens`, best first: each whole
 * while it fits, the first cut at a line when even it does not, and nothing
 * past the budget. Undefined when no excerpt fits, so a task with nothing to
 * show carries nothing.
 */
export function formatRetrieval(
  hits: readonly RetrievalHit[],
  budgetTokens: number,
): RetrievalBlock | undefined {
  if (budgetTokens <= 0) return undefined;
  const parts: string[] = [RETRIEVAL_HEAD];
  const sources: RetrievalSource[] = [];
  let used = tokensOf(RETRIEVAL_HEAD);
  for (const hit of hits) {
    const lines = hit.lines.map((l) =>
      l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}...` : l,
    );
    let block = excerpt(hit, lines);
    // Two newlines join each block to the one before.
    if (used + tokensOf(block) + 1 > budgetTokens) {
      if (sources.length) break;
      // The best excerpt alone is too long: keep as many whole lines as fit.
      let keep = lines.length;
      while (keep > 1 && used + tokensOf(excerpt(hit, lines.slice(0, keep))) + 1 > budgetTokens) {
        keep -= 1;
      }
      block = excerpt(hit, lines.slice(0, keep));
      if (used + tokensOf(block) + 1 > budgetTokens) break;
    }
    parts.push(block);
    used += tokensOf(block) + 1;
    sources.push({ path: hit.path, line: hit.startLine });
  }
  if (!sources.length) return undefined;
  const text = parts.join('\n\n');
  return { text, sources, tokens: tokensOf(text) };
}
