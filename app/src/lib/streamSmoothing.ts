// Streaming smoother for the transcript. Cousin of os-code/src/tui/smoothing.ts
// (the terminal keeps its brisker cadence; this one is tuned for the phone).
// Local model token streams arrive in bursts, and a fast cloud model can land a
// whole paragraph inside one tick. Painted verbatim, either reads as a jolt.
// The smoother reveals text at a calm, steady typing pace and lets the backlog
// grow only so far: past a bounded lag it catches up proportionally, so a long
// code answer never trails by ten seconds, and the reveal keeps going after the
// stream itself has ended, so the tail settles at the same pace instead of
// snapping in (founder, 2026-09-03: "a more graceful typing of the response").

/** The reveal interval. About 40 frames a second, the TUI's cadence. */
export const TICK_MS = 24;

/** The calm pace: characters per tick while the backlog is within reach.
 *  4 per 24ms tick is about 165 characters a second, brisk enough that a
 *  short answer lands in a couple of seconds, slow enough to read as typing. */
export const PACE_CHARS = 4;

/** How far the reveal may trail the stream, in ticks, before it speeds up.
 *  50 ticks is 1.2 seconds; beyond that the chunk grows with the backlog. */
export const LAG_TICKS = 50;

/**
 * Given how much of the target is already shown and its full length, return
 * the next reveal length for this tick: the calm pace, or one fiftieth of the
 * backlog when that is larger, never past the target.
 */
export function nextRevealLength(shownLen: number, targetLen: number): number {
  if (shownLen >= targetLen) return targetLen;
  const backlog = targetLen - shownLen;
  const chunk = Math.max(PACE_CHARS, Math.ceil(backlog / LAG_TICKS));
  return Math.min(targetLen, shownLen + chunk);
}

/**
 * How many ticks it takes to fully reveal a backlog. For tests and for
 * reasoning about worst-case latency; not on any hot path.
 */
export function ticksToDrain(backlog: number): number {
  let shown = 0;
  let ticks = 0;
  while (shown < backlog && ticks < 10_000) {
    shown = nextRevealLength(shown, backlog);
    ticks += 1;
  }
  return ticks;
}

/**
 * Word pacing (founder, 2026-09-23: "like in Claude"). A reply arrives in whole
 * words, never a half-typed one, and each new group fades in. Two helpers:
 * `revealLimit` is how far the reveal may go right now (while the stream is
 * live, only up to the last complete word, so a word still arriving is held
 * back rather than shown and then grown), and `toWordEnd` rounds a paced
 * length forward to the end of the word it lands in.
 */
/** How long one word takes to fade up to full ink. Mirrors `--dur-6`, the
 *  token the `.md-live .w` animation rides; the bubble keeps its words split
 *  this long after the last one lands so the tail finishes its fade. */
export const WORD_FADE_MS = 420;

export function revealLimit(text: string, streaming: boolean): number {
  if (!streaming) return text.length;
  const m = /\s\S*$/.exec(text);
  return m ? m.index : 0;
}

export function toWordEnd(text: string, len: number, limit: number): number {
  if (len >= limit) return limit;
  const rest = text.slice(len, limit).search(/\s/);
  return rest === -1 ? limit : len + rest;
}

/** How long a settled text takes to reveal from nothing and finish its last
 *  word's fade: the paced ticks plus one fade. The guided walk waits this long
 *  (plus a reading pause) before its next line, so lines never overlap. */
export function revealDurationMs(text: string): number {
  return ticksToDrain(text.length) * TICK_MS + WORD_FADE_MS;
}

/** The event a tap on the transcript sends to finish every reveal at once:
 *  a reader is never held to the typing pace. */
export const REVEAL_SKIP_EVENT = 'oscode:reveal-skip';

export function skipReveals(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REVEAL_SKIP_EVENT));
}

/** Reduced motion shows text whole, with no typing. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
