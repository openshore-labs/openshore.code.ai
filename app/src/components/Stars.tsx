// Star rendering with true half-steps. Two stacked rows: an empty track and a
// filled overlay clipped to (value / 5) of the width, so a 4.5 reads as four
// full stars and one exact half, never a rounded full star. On first paint the
// fill wipes left to right; prefers-reduced-motion paints it instantly. The
// wipe moves the clip window with transforms only (UI-8): the fill slides left
// by the unfilled share and the row inside slides right by the same share, so
// the stars never stretch or reflow, and both ride the house tokens.
import { useEffect, useRef, useState } from 'react';
import { ranItLabel, type CommunityScore } from '../lib/reviewsMath.js';

const STAR_PATH =
  'M12 2.2l2.9 6.26 6.85.72-5.1 4.62 1.42 6.74L12 17.6l-6.08 3.94 1.42-6.74-5.1-4.62 6.85-.72z';

const WIPE = 'transform var(--dur-4) var(--ease-arrive)';

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
  const target = Math.max(0, Math.min(1, value / 5));
  const reduced = prefersReducedMotion();
  const [fraction, setFraction] = useState(reduced ? target : 0);
  const painted = useRef(false);

  useEffect(() => {
    if (painted.current || reduced) {
      setFraction(target);
      return;
    }
    painted.current = true;
    const raf = requestAnimationFrame(() => setFraction(target));
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  // The unfilled share, as the distance the clip window slides.
  const hidden = (1 - fraction) * 100;
  const motion = reduced ? 'none' : WIPE;

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
        style={{ transform: `translateX(${-hidden}%)`, transition: motion }}
      >
        <span
          className="stars-fill-inner"
          style={{ transform: `translateX(${hidden}%)`, transition: motion }}
        >
          <Row color={fill} size={size} />
        </span>
      </span>
    </span>
  );
}

/** The honest stand-in for a model that has no ratings block yet (the broadened
 *  landscape roster). It is deliberately NOT a star row: a zero-star or greyed
 *  track would read as "rated badly," so absent quality shows as absent, plain
 *  words, never a fabricated score. */
export function NotRated({ label = 'Not yet rated' }: { label?: string }) {
  return (
    <span className="not-rated" role="note">
      {label}
    </span>
  );
}

/** The community score: a SINGLE warm star plus a numeral and a count. Its
 *  silhouette differs from the benchmark 5-star track on purpose, and it always
 *  carries a count, so a crowd score can never be misread as the measured
 *  "OpenShore fit." Renders nothing when there are no reports unless `invite` is
 *  set, in which case it shows the cold-start line that opens the door. */
export function CommunityStars({
  score,
  size = 14,
  invite = false,
}: {
  score: CommunityScore;
  size?: number;
  invite?: boolean;
}) {
  if (score.count === 0) {
    if (!invite) return null;
    return (
      <span className="community-line cold">
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={STAR_PATH}
            fill="none"
            stroke="var(--voice)"
            strokeWidth="1.6"
            strokeDasharray="3 2"
          />
        </svg>
        <span className="community-count">No run reports yet</span>
      </span>
    );
  }
  const aria = score.hasAverage
    ? `Community ${score.average} out of 5, ${ranItLabel(score.count)}`
    : `${ranItLabel(score.count)}, not enough for an average yet`;
  return (
    <span className="community-line" role="img" aria-label={aria}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d={STAR_PATH} fill="var(--voice)" />
      </svg>
      {score.hasAverage ? <b className="community-avg">{score.average.toFixed(1)}</b> : null}
      <span className="community-count">{ranItLabel(score.count)}</span>
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
