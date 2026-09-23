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
import { TICK_MS, nextRevealLength, revealLimit, toWordEnd } from '../lib/streamSmoothing.js';

export function useSmoothedReveal(
  target: string,
  active: boolean,
): { text: string; settling: boolean } {
  const [shownLen, setShownLen] = useState(() => (active ? 0 : target.length));
  const settling = shownLen < target.length;
  const latest = useRef({ target, active });
  latest.current = { target, active };

  useEffect(() => {
    if (!settling) return;
    const id = window.setInterval(() => {
      const { target: text, active: live } = latest.current;
      const limit = revealLimit(text, live);
      setShownLen((len) =>
        len >= limit ? len : toWordEnd(text, nextRevealLength(len, limit), limit),
      );
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [settling]);

  // The final text may be shorter than what streamed (the engine cleans tool
  // JSON out of it); slice never reads past the end.
  return { text: settling ? target.slice(0, shownLen) : target, settling };
}
