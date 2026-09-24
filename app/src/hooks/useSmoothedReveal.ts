// Reveals `target` at a calm pace, a few whole words at a time, instead of
// painting every delta verbatim (the Claude-style arrival: each new group of
// words then fades in, see lib/fadeWords.ts). `active` is the item's own
// streaming flag: a fresh component mount (new item.id, per MessageList's key)
// starts at 0 and reveals up; a bubble that mounts already settled (a replayed
// history) shows whole at once. While the stream is live the reveal stops at
// the last complete word, so a word still arriving is never shown half-made.
// When the stream ends with text still unrevealed, the reveal keeps ticking at
// the same pace until it is caught up, so the tail settles instead of snapping
// in. `settling` is true while any text is still on its way.
import { useEffect, useRef, useState } from 'react';
import {
  REVEAL_SKIP_EVENT,
  TICK_MS,
  nextRevealLength,
  prefersReducedMotion,
  revealLimit,
  toWordEnd,
} from '../lib/streamSmoothing.js';
import { pacedSteps, type RevealPace } from '../lib/introWalk.js';

export function useSmoothedReveal(
  target: string,
  active: boolean,
  /** A scripted message's pace (lib/introWalk.ts): whole-word groups on their
   *  own beat instead of the stream smoother. Only the first mount plays it. */
  pace?: RevealPace,
): { text: string; settling: boolean } {
  // Reduced motion shows the text whole; the words still arrive as they stream.
  const [shownLen, setShownLen] = useState(() =>
    active && !prefersReducedMotion() ? 0 : target.length,
  );
  const settling = shownLen < target.length;
  const latest = useRef({ target, active });
  latest.current = { target, active };

  // The paced letter: step through the planned groups, each on its beat.
  useEffect(() => {
    if (!pace || !settling) return;
    const steps = pacedSteps(latest.current.target, pace);
    let k = steps.findIndex((st) => st.end > shownLen);
    if (k < 0) return;
    let timer = 0;
    const next = () => {
      const st = steps[k];
      if (!st) return;
      timer = window.setTimeout(() => {
        setShownLen((len) => Math.max(len, st.end));
        k += 1;
        next();
      }, st.delayMs);
    };
    next();
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pace, settling]);

  useEffect(() => {
    if (pace || !settling) return;
    const id = window.setInterval(() => {
      const { target: text, active: live } = latest.current;
      const limit = revealLimit(text, live);
      setShownLen((len) =>
        len >= limit ? len : toWordEnd(text, nextRevealLength(len, limit), limit),
      );
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [pace, settling]);

  // A tap on the transcript finishes the reveal: never hold a reader to the
  // typing pace. A live stream still stops at its last complete word.
  useEffect(() => {
    if (!settling) return;
    const skip = () => {
      const { target: text, active: live } = latest.current;
      setShownLen(revealLimit(text, live));
    };
    window.addEventListener(REVEAL_SKIP_EVENT, skip);
    return () => window.removeEventListener(REVEAL_SKIP_EVENT, skip);
  }, [settling]);

  // The final text may be shorter than what streamed (the engine cleans tool
  // JSON out of it); slice never reads past the end.
  return { text: settling ? target.slice(0, shownLen) : target, settling };
}
