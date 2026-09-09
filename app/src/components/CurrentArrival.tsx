// The arrival and the water-line: how an Agentic Current is felt.
//
// Flip a current on and a current leaves the switch, travels to the edges of
// the screen, and settles as a faint water-line framing every room while it is
// on. Flip it off and the line ebbs back to the switch. Creative Studio
// direction (2026-09-09): the same water, moving. It rides the flow tokens
// (no third blue), moves on the door clock and the glide curve like the
// drawer, animates transform and opacity only, and dies under reduced motion
// (the global reset zeroes it to a crossfade). One decisive haptic when the
// current reaches the border, never a run of ticks.
//
// Honesty: the arrival is a gesture, a few hundred milliseconds, not a
// progress bar. Whether the box answered is the row's own state line.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../state/store.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { durationMs } from '../lib/motion.js';
import { hapticApproval } from '../lib/haptics.js';
import { activeContribution } from '../lib/currents.js';

/** The door clock, read from the tokens at play time. */
function doorMs(): number {
  return durationMs('--dur-7', 520);
}

export function CurrentArrival() {
  const { currentArrival, clearCurrentArrival } = useApp();
  const [playing, setPlaying] = useState<typeof currentArrival>();
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!currentArrival) return;
    setPlaying(currentArrival);
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    const clock = doorMs();
    // The commit: the current reaches the border (or the line has drained).
    timers.current.push(window.setTimeout(() => hapticApproval(), clock));
    // Then the overlay leaves; the persistent water-line has taken over.
    timers.current.push(
      window.setTimeout(
        () => {
          setPlaying(undefined);
          clearCurrentArrival();
        },
        clock + durationMs('--dur-4', 280),
      ),
    );
    return () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
  }, [currentArrival, clearCurrentArrival]);

  if (!playing) return null;
  // The wave is a circle centered on the switch, scaled out until it covers
  // the far corner of the viewport (transform only, never layout). Its size
  // is the viewport diagonal so one scale reaches every edge.
  const w = typeof window !== 'undefined' ? window.innerWidth : 400;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  const diagonal = Math.ceil(Math.hypot(w, h)) * 2;
  const style = {
    '--wave-x': `${playing.x}px`,
    '--wave-y': `${playing.y}px`,
    '--wave-size': `${diagonal}px`,
  } as CSSProperties;
  return (
    <div
      key={playing.seq}
      className={`current-arrival${playing.ebb ? ' ebb' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <span className="current-wave" />
      <span className="current-arrival-edge" />
    </div>
  );
}

/** The faint frame that says a current is on, everywhere, all the time it is.
 *  Mounted through an exit presence so it fades rather than snapping off. */
export function CurrentWaterline() {
  const { settings } = useApp();
  const on = Boolean(activeContribution(settings));
  const presence = useExitPresence(on, durationMs('--dur-6', 420));
  if (!presence.mounted) return null;
  return (
    <div className={`current-waterline${presence.closing ? ' closing' : ''}`} aria-hidden="true" />
  );
}
