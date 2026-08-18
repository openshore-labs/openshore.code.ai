// Streaming smoother, ported from os-code/src/tui/smoothing.ts (same
// algorithm, kept in step by hand since the engine's browser-safe surface is
// types only). Local model token streams arrive in bursts; revealing a chunk
// proportional to the backlog each tick makes it read as calm typing instead
// of jitter, while a fast cloud burst still catches up in a few hundred ms.
export function nextRevealLength(shownLen: number, targetLen: number): number {
  if (shownLen >= targetLen) return targetLen;
  const backlog = targetLen - shownLen;
  const chunk = Math.max(2, Math.ceil(backlog / 6));
  return Math.min(targetLen, shownLen + chunk);
}
