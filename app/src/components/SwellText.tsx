// A short line that rolls in on the swell (Creative Studio, "Swell Line"):
// each word a nowrap span, each character rising a hair, cresting, and
// settling on its step, so a line of plain text reads as one low wave. Used
// where a scripted moment is a single line rather than markdown (the empty
// chat's landing greeting). Renders plain once the wave has passed, and plain
// from the start under reduced motion.
import { useEffect, useState } from 'react';
import { inkPlan, type InkPace } from '../lib/introWalk.js';
import { prefersReducedMotion } from '../lib/streamSmoothing.js';

export function SwellText({ text, pace }: { text: string; pace: InkPace }) {
  const [plan] = useState(() => (prefersReducedMotion() ? null : inkPlan(text, pace)));
  const [rolling, setRolling] = useState(plan !== null);
  useEffect(() => {
    if (!plan) return;
    const t = window.setTimeout(() => setRolling(false), plan.totalMs);
    return () => window.clearTimeout(t);
  }, [plan]);
  if (!rolling || !plan) return <>{text}</>;
  let n = 0;
  return (
    <span className="ink-swell" aria-label={text}>
      {text.split(/(\s+)/).map((part, i) =>
        /^\s+$/.test(part) || !part ? (
          part
        ) : (
          <span className="iw" key={i} aria-hidden="true">
            {[...part].map((ch, j) => {
              const d = plan.delays[n++] ?? 0;
              return (
                <span className="ic" key={j} style={{ '--d': `${d}ms` } as React.CSSProperties}>
                  {ch}
                </span>
              );
            })}
          </span>
        ),
      )}
    </span>
  );
}
