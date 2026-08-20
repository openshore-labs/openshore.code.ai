// Star rendering with true half-steps. Two stacked rows: an empty track and a
// filled overlay clipped to (value / 5) of the width, so a 4.5 reads as four
// full stars and one exact half, never a rounded full star. On first paint the
// fill wipes left to right; prefers-reduced-motion paints it instantly.
import { useEffect, useRef, useState } from 'react';

const STAR_PATH =
  'M12 2.2l2.9 6.26 6.85.72-5.1 4.62 1.42 6.74L12 17.6l-6.08 3.94 1.42-6.74-5.1-4.62 6.85-.72z';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function Row({ color, size }: { color: string; size: number }) {
  return (
    <div className="stars-row" style={{ height: size }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d={STAR_PATH} fill={color} />
        </svg>
      ))}
    </div>
  );
}

export function Stars({
  value,
  size = 13,
  fill = 'var(--local)',
  empty = 'var(--border-strong)',
  label,
}: {
  value: number;
  size?: number;
  fill?: string;
  empty?: string;
  label?: string;
}) {
  const target = Math.max(0, Math.min(100, (value / 5) * 100));
  const reduced = prefersReducedMotion();
  const [width, setWidth] = useState(reduced ? target : 0);
  const painted = useRef(false);

  useEffect(() => {
    if (painted.current || reduced) {
      setWidth(target);
      return;
    }
    painted.current = true;
    const raf = requestAnimationFrame(() => setWidth(target));
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  return (
    <span
      className="stars"
      role="img"
      aria-label={label ?? `${value} out of 5 stars`}
      style={{ height: size }}
    >
      <Row color={empty} size={size} />
      <span
        className="stars-fill"
        style={{
          width: `${width}%`,
          transition: reduced ? 'none' : 'width 260ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <Row color={fill} size={size} />
      </span>
    </span>
  );
}

/** One capability lane: a small-caps label on the left, a 5-star track on the
 *  right. Tapping toggles the provenance chips (which benchmarks earned it). */
export function CapabilityLane({
  label,
  value,
  provenance,
  expanded,
  onToggle,
}: {
  label: string;
  value: number;
  provenance?: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasProvenance = Boolean(provenance && provenance.length);
  return (
    <div className="lane-wrap">
      <button
        type="button"
        className="lane"
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={!hasProvenance}
      >
        <span className="lane-label">{label}</span>
        <Stars value={value} size={13} label={`${label}: ${value} out of 5 stars`} />
      </button>
      {expanded && hasProvenance ? (
        <div className="lane-provenance">
          {provenance!.map((b) => (
            <span key={b} className="prov-chip">
              {b}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
