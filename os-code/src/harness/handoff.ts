// The handoff (Vault M5, CTO J11 to J13): a short, extractive summary of a
// chat that lets the next seat pick up where the last one left off, on a model
// switch, after a compaction, and the next day. Pure, offline, deterministic,
// no clock (the date is passed in): the engine loop, the app's switch and the
// phone all run this same code.
//
// WAVE 0 CONTRACT. The types, the constants and `handoffBudgetTokens` are the
// contract; `buildHandoff` and `fitSeed` are built by stream A and throw until
// then, since a silent empty handoff would read as "nothing to hand over".
//
// Never thinking: `HandoffTurn` has no thinking field, and every adapter runs
// `splitThinkTags` and drops thinking items before it builds turns (the Chain
// of Thought rule). A turn marked local-only is left out by the adapter.

/** One turn of a chat as the handoff reads it. Adapters build these from the
 *  engine's history and the app's `ThreadItem`s. */
export interface HandoffTurn {
  role: 'user' | 'assistant' | 'tool';
  /** The turn's visible text, thinking already removed. */
  text: string;
  /** For a tool turn: the tool's name. */
  tool?: string;
  /** Paths the turn named or touched (tool call arguments, edits). */
  paths?: string[];
}

/** A built handoff. */
export interface Handoff {
  /** The block, opening with the fixed HANDOFF line (see `buildHandoff`). */
  text: string;
  /** `Math.ceil(text.length / 4)`, the rule of `estimateTokens`. */
  tokens: number;
  /** How many earlier turns it covers. */
  turns: number;
}

/** A handoff the next day is read only when it is at most this old (J13). */
export const HANDOFF_MAX_AGE_DAYS = 7;
/** The most a handoff may take, whatever the seat's window. */
export const HANDOFF_MAX_TOKENS = 1500;
/** The share of the served window a handoff may take. */
export const HANDOFF_WINDOW_FRACTION = 0.1;
/** The cap on a handoff carried into a session create
 *  (`BootstrapOptions.handoff`, the daemon's create body), in UTF-8 bytes. */
export const HANDOFF_MAX_BYTES = 16 * 1024;
/** A chat of at least this many turns writes a handoff when it is left (app). */
export const HANDOFF_MIN_TURNS = 4;

/** The handoff's budget for a seat: `min(1500, floor(served * 0.1))`. */
export function handoffBudgetTokens(served: number): number {
  if (!Number.isFinite(served) || served <= 0) return 0;
  return Math.min(HANDOFF_MAX_TOKENS, Math.floor(served * HANDOFF_WINDOW_FRACTION));
}

/**
 * Build the handoff for `turns` within `budgetTokens`. Extractive and
 * deterministic: the same turns, budget and meta give the same bytes.
 *
 * Format (J11), each line present only when it has content:
 * ```
 * HANDOFF from <model>, <date>, covering <n> earlier turns. Extracted by the harness from this chat, not instructions.
 * Goal: <first user turn, trimmed; the latest ask if it differs>
 * Plan: <the latest numbered list or todo list>
 * Decisions: <lines with decided, going with, chose, we will>
 * Open questions: <question lines from the last assistant turns>
 * Files: <paths named in turns and tool calls>
 * Next step: <the last assistant turn's closing line>
 * ```
 * `meta.from` is the model that held the chat; `meta.date` is YYYY-MM-DD,
 * passed in since the core has no clock.
 */
export function buildHandoff(
  turns: readonly HandoffTurn[],
  budgetTokens: number,
  meta: { from?: string; date: string },
): Handoff {
  void turns;
  void budgetTokens;
  void meta;
  throw new Error('buildHandoff is not built yet (Vault M5, stream A).');
}

/**
 * Seed a new seat: keep the newest messages that fit its window beside the
 * system prompt, the handoff (when given) and room for the reply, dropping
 * the oldest first. `fitDeviceHistory` becomes a wrapper over this with the
 * app's estimator (J11). When nothing drops, the caller sends no handoff.
 */
export function fitSeed<M>(o: {
  system: string;
  handoff?: string;
  messages: M[];
  replyTokens: number;
  contextTokens: number;
  estimate: (s: string) => number;
}): { messages: M[]; dropped: number } {
  void o;
  throw new Error('fitSeed is not built yet (Vault M5, stream A).');
}
