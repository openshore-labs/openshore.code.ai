// Streaming smoother. Local model token streams arrive in bursts: three
// tokens at once, then a stall, then a burst. Painted verbatim that reads as
// jitter. The smoother reveals the streamed text at a steady cadence so it
// flows like calm typing, while never falling far behind a fast producer (a
// cloud burst catches up in a few hundred milliseconds).
//
// Pure and tiny on purpose, so the feel logic is unit-tested rather than
// eyeballed. The TUI calls nextRevealLength on a fixed interval and slices the
// target text to that length.

/**
 * Given how much of `target` is already shown and its full length, return the
 * next reveal length for this tick. Reveals a chunk proportional to the
 * backlog (min a couple of characters), so a small trickle keeps pace and a
 * large backlog drains smoothly instead of dumping all at once.
 */
export function nextRevealLength(shownLen: number, targetLen: number): number {
  if (shownLen >= targetLen) return targetLen;
  const backlog = targetLen - shownLen;
  const chunk = Math.max(2, Math.ceil(backlog / 6));
  return Math.min(targetLen, shownLen + chunk);
}

/**
 * How many ticks (at `tickMs`) it takes to fully reveal a backlog, for tests
 * and for reasoning about worst-case latency. Not on any hot path.
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
