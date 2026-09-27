// A note taken to a model from the composer (Vault M5, CTO J15): the `[[`
// picker and "Ask about this note" insert a trimmed excerpt with a cost line.
// Pure.
//
// WAVE 0 CONTRACT. The budget is the contract and is real; `composerExcerpt`
// and `excerptCostLine` are built by stream H and throw until then.

/** The note the excerpt is taken from. */
export interface ExcerptNote {
  path: string;
  title: string;
  text: string;
  /** ISO 8601, for "(updated <date>)". */
  updatedAt: string;
}

/** A rendered excerpt. */
export interface ComposerExcerpt {
  /** `From my note [[Title]] (updated <date>):` then the quoted excerpt. */
  text: string;
  /** `Math.ceil(text.length / 4)`. */
  tokens: number;
  /** True when the note was cut to fit. */
  trimmed: boolean;
}

/** The most an excerpt may take, whatever the seat. */
export const EXCERPT_MAX_TOKENS = 2000;
/** The share of the served window an excerpt may take. */
export const EXCERPT_WINDOW_FRACTION = 0.25;
/** The cap on a device seat. */
export const EXCERPT_DEVICE_TOKENS = 1024;

/** The excerpt's budget: `min(2000, floor(served * 0.25))`, 1024 on a device
 *  seat. */
export function composerExcerptBudget(served: number, device: boolean): number {
  if (device) return EXCERPT_DEVICE_TOKENS;
  if (!Number.isFinite(served) || served <= 0) return 0;
  return Math.min(EXCERPT_MAX_TOKENS, Math.floor(served * EXCERPT_WINDOW_FRACTION));
}

/** The excerpt for a note within `budgetTokens`. Frontmatter is dropped;
 *  the cut falls on a paragraph or line where it can. */
export function composerExcerpt(note: ExcerptNote, budgetTokens: number): ComposerExcerpt {
  void note;
  void budgetTokens;
  throw new Error('composerExcerpt is not built yet (Vault M5, stream H).');
}

/** The cost line under an excerpt: "About 380 tokens of this model's 4,096". */
export function excerptCostLine(tokens: number, served: number): string {
  void tokens;
  void served;
  throw new Error('excerptCostLine is not built yet (Vault M5, stream H).');
}
