// The "agent is working" row: what it is doing right now and, once a couple
// of seconds have passed, how long it has been at it. This is what fills the
// ten to forty seconds a cold local model takes before its first token, so
// the screen never reads as dead. Sits at the tail of the transcript while
// the thread is busy and nothing is streaming.
import { useEffect, useState } from 'react';

/** Show the counter only after this long; a fast answer never needs one. */
const COUNTER_AFTER_MS = 2000;

export function WorkingRow({ since, note }: { since?: number; note?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = since ? now - since : 0;
  const seconds = Math.floor(elapsed / 1000);
  return (
    <div className="working-row" role="status" aria-live="polite">
      <span className="working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="working-note">{note ?? 'Thinking'}</span>
      {elapsed > COUNTER_AFTER_MS ? (
        <span className="working-elapsed">
          {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
        </span>
      ) : null}
    </div>
  );
}
