// Reveals `target` at the TUI's ~40fps cadence instead of painting every
// delta verbatim. `active` is the item's own streaming flag: a fresh
// component mount (new item.id, per MessageList's key) starts at 0 and
// catches up; once streaming ends the full (possibly cleaned-up) final text
// shows immediately, no lag.
import { useEffect, useState } from 'react';
import { nextRevealLength } from '../lib/streamSmoothing.js';

const TICK_MS = 24;

export function useSmoothedReveal(target: string, active: boolean): string {
  const [shownLen, setShownLen] = useState(() => (active ? 0 : target.length));

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setShownLen((len) => nextRevealLength(len, target.length));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, target.length]);

  return active ? target.slice(0, shownLen) : target;
}
