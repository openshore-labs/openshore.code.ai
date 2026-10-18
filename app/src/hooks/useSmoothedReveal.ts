// Reveals `target` a whole word at a time, paced from the stream itself
// (lib/streamSmoothing.ts): words play out at the rate text is arriving, so a
// burst flows into the pause after it instead of racing out and freezing, and
// each new word then fades in (lib/fadeWords.ts). The pace steps on the
// display's own frame clock (requestAnimationFrame), so words land on frames
// the screen actually paints. `active` is the item's own streaming flag: a
// fresh component mount (new item.id, per MessageList's key) starts at 0 and
// reveals up; a bubble that mounts already settled (a replayed history) shows
// whole at once. While the stream is live the reveal stops at the last
// complete word. When the stream ends with text still unrevealed, the reveal
// keeps playing until it is caught up, so the tail settles instead of
// snapping in. `settling` is true while any text is still on its way.
import { useEffect, useRef, useState } from 'react';
import {
  REVEAL_SKIP_EVENT,
  cancelFrame,
  onNextFrame,
  prefersReducedMotion,
  revealLimit,
  startPace,
  stepPace,
  wholeWordsUpTo,
} from '../lib/streamSmoothing.js';

export function useSmoothedReveal(
  target: string,
  active: boolean,
): { text: string; settling: boolean } {
  // Reduced motion shows the text whole; the words still arrive as they stream.
  const [shownLen, setShownLen] = useState(() =>
    active && !prefersReducedMotion() ? 0 : target.length,
  );
  const settling = shownLen < target.length;
  const latest = useRef({ target, active });
  latest.current = { target, active };
  const pace = useRef(startPace(shownLen));

  useEffect(() => {
    if (!settling) return;
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      const dtMs = last ? now - last : 16;
      last = now;
      const { target: text, active: live } = latest.current;
      const limit = revealLimit(text, live);
      pace.current = stepPace(pace.current, { arrived: text.length, limit, dtMs, live });
      const next = wholeWordsUpTo(text, pace.current.played, limit);
      setShownLen((len) => (next > len ? next : len));
      raf = onNextFrame(frame);
    };
    raf = onNextFrame(frame);
    return () => cancelFrame(raf);
  }, [settling]);

  // A tap on the transcript finishes the reveal: never hold a reader to the
  // pace. A live stream still stops at its last complete word.
  useEffect(() => {
    if (!settling) return;
    const skip = () => {
      const { target: text, active: live } = latest.current;
      const limit = revealLimit(text, live);
      pace.current = { ...pace.current, played: limit };
      setShownLen(limit);
    };
    window.addEventListener(REVEAL_SKIP_EVENT, skip);
    return () => window.removeEventListener(REVEAL_SKIP_EVENT, skip);
  }, [settling]);

  // The final text may be shorter than what streamed (the engine cleans tool
  // JSON out of it); slice never reads past the end.
  return { text: settling ? target.slice(0, shownLen) : target, settling };
}
