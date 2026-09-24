// The first open's "Tide Letter" (Creative Studio, founder direction
// 2026-09-24): Harbor Lite writes to a new person instead of the walk landing
// finished. The greeting arrives in unhurried word groups, the screen then
// gives the reader a few seconds, the setup message picks up at a brisker
// pace, and the step's buttons settle last, when it is the person's turn.
//
// This module is the pure timing: the paces, the pauses, and the plan of when
// each character of a scripted line starts its swell. The same plan drives the bubble's reveal
// (hooks/useSmoothedReveal.ts) and the walk's sequencing (store.ts
// beginGuidedSetup), so a beat starts exactly when the previous one finishes,
// never on a guessed timeout. A tap or a keystroke skips to the end
// (lib/streamSmoothing.ts skipReveals); reduced motion shows it all at once.

/** How a scripted line rolls in (Creative Studio, "Swell Line"): a low swell
 *  crosses each line, every character rising from a hair below its baseline,
 *  cresting, and settling as the wave passes. Characters start a fixed step
 *  apart and each takes far longer than a step, so many are mid-swell at once
 *  and the eye sees one feathered wave, never letters hopping. */
export interface InkPace {
  /** The beat between one character and the next (a space counts as one). */
  stepMs: number;
  /** How long one character's swell takes; mirrors its CSS token. */
  swellMs: number;
  /** Extra stillness after a sentence ends. */
  sentenceMs: number;
}

/** The greeting: 20 ms a character on the 600 ms swell (`--dur-swell`), a
 *  short wave about thirteen characters wide, unhurried. */
export const GREETING_PACE: InkPace = { stepMs: 20, swellMs: 600, sentenceMs: 90 };
/** The walk: 8 ms a character on `--dur-6`, a longer, flatter swell about a
 *  line wide, so the walk keeps moving. */
export const WALK_PACE: InkPace = { stepMs: 8, swellMs: 420, sentenceMs: 50 };

/** The empty chat's landing line: a short greeting, so a slower step on the
 *  long swell, a little over a second end to end. */
export const LANDING_PACE: InkPace = { stepMs: 30, swellMs: 600, sentenceMs: 0 };

export type PacedKind = 'greeting' | 'walk';
export const PACES: Record<PacedKind, InkPace> = {
  greeting: GREETING_PACE,
  walk: WALK_PACE,
};

/** Stillness before the first word, once the chat is on screen. */
export const INTRO_START_MS = 600;
/** The reader's pause after the greeting has fully inked. */
export const READ_PAUSE_MS = 3000;
/** The breath before a step heading, used instead of the paragraph pause. */
export const HEADING_PAUSE_MS = 600;
/** After a comma or a colon. */
export const COMMA_PAUSE_MS = 40;
/** A single line break inside a paragraph. */
export const LINE_PAUSE_MS = 120;
/** A paragraph break: the tail settles fully, each paragraph starts from still
 *  water. */
export const PARAGRAPH_PAUSE_MS = 280;

export interface InkPlan {
  /** When each visible, non-space character starts its swell, in reading
   *  order (markdown's bold markers are not characters). */
  delays: number[];
  /** From the first character starting to the last one settled. */
  totalMs: number;
}

/** The one plan: the bubble stamps these delays on its character spans and
 *  the walk waits `totalMs` before its next beat. */
export function inkPlan(text: string, pace: InkPace): InkPlan {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const delays: number[] = [];
  let clock = 0;
  paragraphs.forEach((para, index) => {
    if (index > 0) clock += para.startsWith('**Step') ? HEADING_PAUSE_MS : PARAGRAPH_PAUSE_MS;
    const visible = para.replace(/\*\*/g, '');
    for (let i = 0; i < visible.length; i += 1) {
      const ch = visible[i]!;
      if (ch === '\n') {
        clock += LINE_PAUSE_MS;
        continue;
      }
      if (!/\s/.test(ch)) delays.push(clock);
      clock += pace.stepMs;
      if (/[,:]/.test(ch)) clock += COMMA_PAUSE_MS;
      else if (/[.!?]/.test(ch) && (i + 1 >= visible.length || /\s/.test(visible[i + 1]!)))
        clock += pace.sentenceMs;
    }
  });
  const last = delays.length ? delays[delays.length - 1]! : 0;
  return { delays, totalMs: delays.length ? last + pace.swellMs : 0 };
}

/** How long a scripted line takes to roll in, start to settled. */
export function inkDurationMs(text: string, pace: InkPace): number {
  return inkPlan(text, pace).totalMs;
}

// ------------------------------------------------------------- playing

// Whether the first-open walk is still writing itself, so a keystroke in the
// composer can skip it (and only it; a live model reply is never hurried). One
// walk at a time, on one device, so module state is enough.
let playing = false;
let landingSwellPlayed = false;

/** The landing greeting rolls in on the swell once per session, on the first
 *  empty chat; after that it simply lands. */
export function takeLandingSwell(): boolean {
  const first = !landingSwellPlayed;
  landingSwellPlayed = true;
  return first;
}
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
