// Streaming reveal for the transcript, paced from the stream itself
// (2026-10-18, docs/design/flowing-reveal.md). A model's text rarely arrives
// evenly: a local model on a busy phone sends a burst, then pauses for
// seconds; a fast cloud model lands a paragraph in one tick. Painting either
// as it comes reads as a jolt, and so did the fixed typing clock before this
// one, which raced each burst out in a second and then sat frozen through
// the pause. The reveal works like a video player's playout buffer instead:
// it measures how fast text is arriving and plays words out at that rate,
// so a burst flows into the pause after it, and it never trails the stream
// by more than a couple of seconds. Words land whole, one after another, and
// each fades up from nothing (`.md-live .w`), so several are mid-fade at once
// and the edge of the reply reads as one soft wave rather than typing.

/** How quickly the measured arrival rate follows the stream, in ms: the time
 *  constant of its moving average. Long enough to carry a burst across the
 *  pause that follows it, short enough to notice a model speeding up. */
export const ARRIVAL_TAU_MS = 1600;

/** The calmest the reveal plays out while text is waiting, in characters a
 *  second: about seven words, a brisk reading pace. */
export const FLOOR_CPS = 40;

/** How far behind a live stream the reveal may drift, in seconds: the
 *  backlog always shrinks by at least this fraction of itself each second, so
 *  a burst eases out over a few seconds and a long answer never lags far. */
export const MAX_LAG_S = 2;

/** Once the stream has ended, whatever is left plays out within this. */
export const DRAIN_S = 1.2;

/** One step of the reveal: how far it has played (a fractional length, so
 *  slow rates still advance) and the measured arrival rate. */
export interface RevealPace {
  /** Characters played out, fractional. The visible text is whole words up
   *  to here. */
  played: number;
  /** The arrival rate's moving average, in characters a second. */
  rate: number;
  /** How much of the target had arrived at the last step. */
  seen: number;
  /** Once the stream has ended: the ms left to finish playing out. */
  left?: number;
}

export function startPace(shown = 0, seen = shown): RevealPace {
  return { played: shown, rate: 0, seen };
}

/**
 * Advance the reveal by `dtMs`. `limit` is how far it may go (revealLimit),
 * `arrived` how much text has come in so far. The play rate is the arrival
 * rate, never below FLOOR_CPS while text waits, and never slower than the
 * backlog over MAX_LAG_S while live. Once the stream ends, what is left is
 * spread evenly over what remains of DRAIN_S, so it lands on time.
 */
export function stepPace(
  pace: RevealPace,
  opts: { arrived: number; limit: number; dtMs: number; live: boolean },
): RevealPace {
  const dt = Math.max(0, Math.min(opts.dtMs, 250)) / 1000;
  const fresh = Math.max(0, opts.arrived - pace.seen);
  const instant = dt > 0 ? fresh / dt : 0;
  const k = dt > 0 ? 1 - Math.exp(-(dt * 1000) / ARRIVAL_TAU_MS) : 0;
  const rate = pace.rate + (instant - pace.rate) * k;
  const backlog = opts.limit - pace.played;
  const left = opts.live ? undefined : (pace.left ?? DRAIN_S * 1000) - dt * 1000;
  if (backlog <= 0) {
    return { played: Math.min(pace.played, opts.limit), rate, seen: opts.arrived, left };
  }
  if (left !== undefined && left <= 0) {
    return { played: opts.limit, rate, seen: opts.arrived, left: 0 };
  }
  const due = left === undefined ? backlog / MAX_LAG_S : backlog / ((left + dt * 1000) / 1000);
  const speed = Math.max(FLOOR_CPS, rate, due);
  return {
    played: Math.min(opts.limit, pace.played + speed * dt),
    rate,
    seen: opts.arrived,
    left,
  };
}

/** While a stream is live, the reveal stops at the last complete word, so a
 *  word still arriving is held back rather than shown and then grown. */
export function revealLimit(text: string, streaming: boolean): number {
  if (!streaming) return text.length;
  const m = /\s\S*$/.exec(text);
  return m ? m.index : 0;
}

/** The visible length for a played length: whole words only, so a word
 *  appears all at once when the pace reaches its end. */
export function wholeWordsUpTo(text: string, played: number, limit: number): number {
  const at = Math.min(Math.floor(played), limit);
  if (at >= limit) return limit;
  // Inside a word, or just past one: back up to the end of the last whole word.
  if (/\s/.test(text[at] ?? ' ')) return at;
  const before = text.slice(0, at);
  const m = /\s\S*$/.exec(before);
  return m ? m.index : 0;
}

/** How long one word takes to fade up to full ink. Mirrors `--dur-swell`, the
 *  token the `.md-live .w` animation rides; the bubble keeps its words split
 *  this long after the last one lands so the tail finishes its fade. */
export const WORD_FADE_MS = 600;

/** The display's frame clock, or a 16ms timer where there is none (a test
 *  renderer, a page in the background on some engines). */
export function onNextFrame(fn: (now: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return setTimeout(() => fn(Date.now()), 16) as unknown as number;
}

export function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
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
