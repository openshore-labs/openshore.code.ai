// Reveals `target` at a calm typing pace instead of painting every delta
// verbatim. `active` is the item's own streaming flag: a fresh component mount
// (new item.id, per MessageList's key) starts at 0 and types up; a bubble that
// mounts already settled (a replayed history) shows whole at once. When the
// stream ends with text still unrevealed, the reveal keeps ticking at the same
// pace until it is caught up, so the tail of a reply settles instead of
// snapping in. `settling` is true while any text is still on its way.
import { useEffect, useState } from 'react';
import { TICK_MS, nextRevealLength } from '../lib/streamSmoothing.js';

export function useSmoothedReveal(
  target: string,
  active: boolean,
): { text: string; settling: boolean } {
  const [shownLen, setShownLen] = useState(() => (active ? 0 : target.length));
  const settling = shownLen < target.length;

  useEffect(() => {
    if (!settling) return;
    const id = window.setInterval(() => {
      setShownLen((len) => nextRevealLength(len, target.length));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [settling, target.length]);

  // The final text may be shorter than what streamed (the engine cleans tool
  // JSON out of it); slice never reads past the end.
  return { text: settling ? target.slice(0, shownLen) : target, settling };
}
