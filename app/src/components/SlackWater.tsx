// Slack Water (Creative Studio, 2026-10-01; docs/slack-water.md): the
// one-time transition from the setup walk's chat to the main chat page when
// the person chooses to just chat. From the point they tapped, a hairline
// ripple leads, the paper wells up behind it, and a second ripple follows.
// Once the paper covers the screen the main chat page goes in underneath
// (with one soft tick), the paper holds still a beat, then clears, and the
// greeting lands.
//
// Transform and opacity only, on the tokens (theme.css .slack-water). The
// overlay takes taps while it rises, so the chat being covered cannot take
// one, and lets them through while it clears. Reduced motion never mounts it
// (the store lands on the greeting directly).
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useApp } from '../state/store.js';
import { hapticTick } from '../lib/haptics.js';
import { CLEAR_BACKSTOP_MS, SWAP_BACKSTOP_MS, slackWaterGeometry } from '../lib/slackWater.js';

export function SlackWater() {
  const water = useApp((s) => s.slackWater);
  const covered = useApp((s) => s.slackWaterCovered);
  const end = useApp((s) => s.endSlackWater);
  const ticked = useRef(0);
  const seq = water?.seq;
  const phase = water?.phase;

  // The swap waits on the disc's own animationend; these backstops only make
  // sure a missed event (a WebView in the background) never strands the
  // person under the water.
  useEffect(() => {
    if (seq === undefined || phase !== 'rising') return;
    const t = window.setTimeout(covered, SWAP_BACKSTOP_MS);
    return () => window.clearTimeout(t);
  }, [seq, phase, covered]);
  useEffect(() => {
    if (seq === undefined || phase !== 'clearing') return;
    if (ticked.current !== seq) {
      ticked.current = seq;
      hapticTick();
    }
    const t = window.setTimeout(end, CLEAR_BACKSTOP_MS);
    return () => window.clearTimeout(t);
  }, [seq, phase, end]);

  const style = useMemo(() => {
    if (!water) return undefined;
    const g = slackWaterGeometry(water.x, water.y, window.innerWidth, window.innerHeight);
    return {
      '--slack-x': `${water.x}px`,
      '--slack-y': `${water.y}px`,
      '--slack-ring': `${g.ring}px`,
      '--slack-disc': `${g.disc}px`,
    } as CSSProperties;
    // The geometry is fixed for one play: its origin and the window it began in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  if (!water) return null;
  return (
    <div
      key={water.seq}
      className={`slack-water${water.phase === 'clearing' ? ' clearing' : ''}`}
      style={style}
      aria-hidden="true"
      onAnimationEnd={(e) => {
        if (e.animationName === 'slack-clear') end();
      }}
    >
      <span className="slack-ring a" />
      <span
        className="slack-disc"
        onAnimationEnd={(e) => {
          e.stopPropagation();
          if (e.animationName === 'slack-flood') covered();
        }}
      />
      <span className="slack-ring b" />
    </div>
  );
}
