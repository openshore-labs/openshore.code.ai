// The first open's "Tide Letter" (Creative Studio, founder direction
// 2026-09-24): Harbor Lite writes to a new person instead of the walk landing
// finished. The greeting arrives in unhurried word groups, the screen then
// gives the reader a few seconds, the setup message picks up at a brisker
// pace, and the step's buttons settle last, when it is the person's turn.
//
// This module is the pure timing: the paces, the pauses, and the plan of word
// groups a paced message reveals in. The same plan drives the bubble's reveal
// (hooks/useSmoothedReveal.ts) and the walk's sequencing (store.ts
// beginGuidedSetup), so a beat starts exactly when the previous one finishes,
// never on a guessed timeout. A tap or a keystroke skips to the end
// (lib/streamSmoothing.ts skipReveals); reduced motion shows it all at once.
import { WORD_FADE_MS } from './streamSmoothing.js';

export interface RevealPace {
  /** Whole words shown together, each group fading in as one. */
  wordsPerGroup: number;
  /** The beat between groups. */
  groupMs: number;
}

/** The greeting: two words every 190 ms, about ten words a second, written
 *  rather than typed. */
export const GREETING_PACE: RevealPace = { wordsPerGroup: 2, groupMs: 190 };
/** The walk's messages: three words every 170 ms, so the walk keeps moving. */
export const WALK_PACE: RevealPace = { wordsPerGroup: 3, groupMs: 170 };

export type PacedKind = 'greeting' | 'walk';
export const PACES: Record<PacedKind, RevealPace> = {
  greeting: GREETING_PACE,
  walk: WALK_PACE,
};

/** Stillness before the first word, once the chat is on screen. */
export const INTRO_START_MS = 600;
/** The reader's pause after the greeting has fully inked. */
export const READ_PAUSE_MS = 3000;
/** The one pause inside a message: the breath before a step's heading. */
export const HEADING_PAUSE_MS = 600;

export interface RevealStep {
  /** Show the text up to this index. */
  end: number;
  /** Wait this long (after the previous step) before showing it. */
  delayMs: number;
}

const PARAGRAPH_BREAK = /\n\s*\n/;

/** The groups a paced message reveals in. Whole words only; a paragraph break
 *  always starts a new group; a group never ends inside an open `**` span, so
 *  a bold heading ("Step 1 of 4: Get Harbor.") arrives as one piece and the
 *  markdown is never half-drawn; a paragraph that opens in bold (a heading or
 *  a "Why:" label) starts its own group; and a step heading gets its breath. */
export function pacedSteps(
  text: string,
  pace: RevealPace,
  headingPauseMs = HEADING_PAUSE_MS,
): RevealStep[] {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  const boldOpenAt = (end: number) => ((text.slice(0, end).match(/\*\*/g) ?? []).length & 1) === 1;
  const steps: RevealStep[] = [];
  let i = 0;
  while (i < words.length) {
    const start = words[i]!.start;
    const paraStart = i === 0 || PARAGRAPH_BREAK.test(text.slice(words[i - 1]!.end, start));
    const bold = paraStart && text.startsWith('**', start);
    let j = i;
    for (;;) {
      j += 1;
      const end = words[j - 1]!.end;
      if (j >= words.length) break;
      if (boldOpenAt(end)) continue;
      if (bold) break;
      if (j - i >= pace.wordsPerGroup) break;
      if (PARAGRAPH_BREAK.test(text.slice(end, words[j]!.start))) break;
      if (text.startsWith('**', words[j]!.start)) break;
    }
    const heading = bold && text.startsWith('**Step', start);
    steps.push({
      end: words[j - 1]!.end,
      delayMs: steps.length === 0 ? 0 : pace.groupMs + (heading ? headingPauseMs : 0),
    });
    i = j;
  }
  // Trailing whitespace or punctuation-only tails still land.
  if (steps.length && steps[steps.length - 1]!.end < text.length) {
    steps[steps.length - 1]!.end = text.length;
  }
  return steps;
}

/** How long a paced message takes from its first group to full ink. */
export function pacedDurationMs(text: string, pace: RevealPace): number {
  return pacedSteps(text, pace).reduce((sum, s) => sum + s.delayMs, 0) + WORD_FADE_MS;
}

// ------------------------------------------------------------- playing

// Whether the first-open walk is still writing itself, so a keystroke in the
// composer can skip it (and only it; a live model reply is never hurried). One
// walk at a time, on one device, so module state is enough.
let playing = false;
let buttonsHaptic = false;

export function setIntroPlaying(on: boolean): void {
  playing = on;
  buttonsHaptic = on;
}

export function isIntroPlaying(): boolean {
  return playing;
}

/** The single soft tick when the first step's buttons land, once, and only
 *  when the walk played through (never after a skip, never on a return). */
export function takeButtonsHaptic(): boolean {
  const take = buttonsHaptic;
  buttonsHaptic = false;
  return take;
}

/** The letter wrote itself through: typing no longer skips anything, and the
 *  buttons' tick is still owed. */
export function introFinished(): void {
  playing = false;
}

/** A skip ends the letter: no tick, no more paced beats. */
export function introSkipped(): void {
  playing = false;
  buttonsHaptic = false;
}
