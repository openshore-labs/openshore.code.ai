// The arrival and the persistent ring: how an Agentic Current is felt.
//
// A replica of the iOS Siri glow in the brand's own water (founder,
// 2026-09-14, from a screen recording read frame by frame): flip a current on
// and a soft bloom rises from where the switch sits, then a thick multi-hue
// ring lights the whole border with a glow bleeding inward, and settles into
// a thin ring whose hues keep drifting around the perimeter for as long as the
// current is on. Flip it off and the ring brightens once, drains, and the
// bloom sinks back into the switch. The palette is OpenShore's water family
// with the amber counterpoint (theme.css --current-1..5), never pink and
// purple. Everything is transform and opacity; the drift is an infinite loop
// the reduced-motion reset stops; one decisive haptic when the ring is lit.
//
// Honesty: the arrival is a gesture, about three door clocks, not a progress
// bar. Whether the box answered is the row's own state line.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { agenticView, harnessView, useApp } from '../state/store.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { durationMs } from '../lib/motion.js';
import { hapticApproval } from '../lib/haptics.js';
import { activeContribution } from '../lib/currents.js';
import { activeHarnessContribution } from '../lib/harnessCurrents.js';

/** The door clock, read from the tokens at play time. */
function doorMs(): number {
  return durationMs('--dur-7', 520);
}

/** How long the flourish plays before the persistent ring carries on alone:
 *  the ring's own 1.6s settle plus a beat, matched to theme.css. */
const FLOURISH_MS = 1700;
const EBB_MS = 1300;

export function CurrentArrival() {
  const { currentArrival, clearCurrentArrival } = useApp();
  const [playing, setPlaying] = useState<typeof currentArrival>();
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!currentArrival) return;
    setPlaying(currentArrival);
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    // The commit: the ring is fully lit (or, on an ebb, the drain has begun).
    timers.current.push(window.setTimeout(() => hapticApproval(), doorMs()));
    // Then the overlay leaves; the persistent ring has taken over.
    timers.current.push(
      window.setTimeout(
        () => {
          setPlaying(undefined);
          clearCurrentArrival();
        },
        currentArrival.ebb ? EBB_MS : FLOURISH_MS,
      ),
    );
    return () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
  }, [currentArrival, clearCurrentArrival]);

  if (!playing) return null;
  const style = {
    '--wave-x': `${playing.x}px`,
    '--wave-y': `${playing.y}px`,
  } as CSSProperties;
  return (
    <div
      key={playing.seq}
      className={`current-arrival${playing.ebb ? ' ebb' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <span className="current-bloom" />
      <span className="current-glow" />
      <span className="current-ring" />
    </div>
  );
}

/** The thin drifting ring that says a current is on, everywhere, all the time
 *  it is. Mounted through an exit presence so it fades rather than snapping
 *  off. */
export function CurrentWaterline() {
  const { settings } = useApp();
  // The single ring frames the screen when the ACTIVE project has EITHER group
  // on (currents are a per-project choice). One ring stands for whichever is on.
  const on =
    Boolean(activeContribution(agenticView(settings))) ||
    Boolean(activeHarnessContribution(harnessView(settings)));
  const presence = useExitPresence(on, durationMs('--dur-6', 420));
  if (!presence.mounted) return null;
  return (
    <div className={`current-waterline${presence.closing ? ' closing' : ''}`} aria-hidden="true">
      <span className="current-ring" />
    </div>
  );
}
