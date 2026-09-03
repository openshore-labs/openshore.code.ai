// The words the working row shows while the app waits on a model's first
// token. Claude Code rotates a verb ("Pondering", "Musing"); OpenShore's set is
// its own, in the house voice: coastal, calm, and honest. The app is waiting
// and nothing else, so no word claims work the model is not doing (no
// "Composing", no "Searching"), and the first word is always plain "Thinking"
// so the honest label is what a fast answer shows. Chosen with the Creative
// Studio, 2026-09-03. Pure and small so the lexicon and the draw are tested,
// not eyeballed.

/** Always the first word, held one full beat. */
export const FIRST_WORD = 'Thinking';

/** How long each word holds. Slower than Claude Code on purpose. */
export const WORD_SWAP_MS = 3600;

/** After this long the set turns to the honest long-wait words. */
export const LONG_WAIT_MS = 15_000;

/** The calm set, for the first stretch of a wait. */
export const CALM_WORDS: readonly string[] = [
  'Considering',
  'Weighing it',
  'Turning it over',
  'Sitting with it',
  'Letting it settle',
  'Gathering',
  'Listening',
  'Watching the horizon',
  'Reading the water',
  'Reading the tide',
  'Taking a sounding',
  'Looking out',
  'Holding the line',
  'Between sets',
];

/** The long-wait set: plain about the fact that this is taking a while. */
export const LONG_WAIT_WORDS: readonly string[] = [
  'Still thinking',
  'Taking its time',
  'Waiting on the model',
];

/**
 * The next word to show, `elapsedMs` into the wait, given the words already
 * shown this wait. Draws from the set for this stretch without repeating a
 * word until the set is used up, and never hands back the word on screen.
 */
export function nextThinkingWord(
  elapsedMs: number,
  shown: readonly string[],
  random: () => number = Math.random,
): string {
  const pool = elapsedMs >= LONG_WAIT_MS ? LONG_WAIT_WORDS : CALM_WORDS;
  const current = shown[shown.length - 1];
  let fresh = pool.filter((w) => !shown.includes(w));
  if (fresh.length === 0) fresh = pool.filter((w) => w !== current);
  const pick = fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
  return pick ?? FIRST_WORD;
}
