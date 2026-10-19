// The drawer as a physical object (motion standard, rule 7): an edge swipe
// from the left pulls it in 1:1 with the finger, and release decides on
// VELOCITY as well as distance, so a quick flick under the distance threshold
// still commits. The open drawer does not drag shut: a swipe on it closed it
// too easily (founder, 2026-10-19), so it closes only on a tap, a row or the
// scrim beside it. Past the rest
// position the panel rubber-bands with asymptotic damping rather than
// hard-clamping. Two haptic marks: the arm (crossing the commit threshold)
// and the drop (the commit itself).
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { hapticTick } from '../lib/haptics.js';
import { durationMs } from '../lib/motion.js';

/** A flick faster than this (px per ms) commits regardless of distance. */
const COMMIT_VELOCITY = 0.35;
/** Fraction of the drawer width a slow drag must cover to commit. */
const COMMIT_FRACTION = 0.4;
/** How far the panel may rubber-band past its rest position. */
const OVERSHOOT_MAX = 14;
/** Settle time after release, read from the stylesheet's tokens: a return
 *  over the full width takes --dur-5, a nudge back takes --dur-3, anything
 *  between scales with the distance left. The literals are only the test
 *  runner's fallback (no document there). */
function settleRange(): [short: number, long: number] {
  return [durationMs('--dur-3', 220), durationMs('--dur-5', 320)];
}

type Sample = { t: number; x: number };

export interface DrawerGesture {
  /** Inline translateX for the panel while dragging or settling; null at rest. */
  dragX: number | null;
  /** The spring's duration for the settle in flight (--drawer-settle); null
   *  while the finger holds the panel or at rest. */
  settleMs: number | null;
  /** True while the finger is down and moving the panel. */
  dragging: boolean;
  /** The panel is mounted only because a from-closed drag is in progress. */
  peek: boolean;
  /** The current mount was opened by the gesture, so its CSS entrance must
   *  not replay when the dragging class comes off. */
  viaGesture: boolean;
  /** 0 (closed) to 1 (open), for the scrim. Null when not dragging. */
  progress: number | null;
  edgeProps: GestureProps;
}

/** The handlers a gesture surface binds. Lost capture is a release too: the
 *  platform can take the pointer away (a system gesture, an interruption) and
 *  a gesture that never releases leaves the drawer wedged. */
export interface GestureProps {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
  onLostPointerCapture: (e: ReactPointerEvent) => void;
}

export function useDrawerGesture({
  enabled,
  open,
  setOpen,
  width,
}: {
  enabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  width: number;
}): DrawerGesture {
  const [dragX, setDragX] = useState<number | null>(null);
  const [settleMs, setSettleMs] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [peek, setPeek] = useState(false);
  const [viaGesture, setViaGesture] = useState(false);

  const startX = useRef(0);
  const pointerId = useRef<number | null>(null);
  const armed = useRef(false);
  const samples = useRef<Sample[]>([]);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mode = useRef<'open' | null>(null);
  /** The panel's current x, readable inside stable callbacks. */
  const xRef = useRef<number | null>(null);
  const place = (x: number | null) => {
    xRef.current = x;
    setDragX(x);
  };

  const rubber = (x: number): number =>
    x <= 0 ? x : OVERSHOOT_MAX * (1 - Math.exp(-x / (OVERSHOOT_MAX * 3)));

  const velocity = (): number => {
    const s = samples.current;
    if (s.length < 2) return 0;
    const last = s[s.length - 1]!;
    // Read over the last ~80ms so a pause before lifting reads as a slow drop.
    let i = s.length - 2;
    while (i > 0 && last.t - s[i]!.t < 80) i -= 1;
    const first = s[i]!;
    const dt = Math.max(1, last.t - first.t);
    return (last.x - first.x) / dt;
  };

  const sample = (x: number) => {
    const s = samples.current;
    s.push({ t: performance.now(), x });
    if (s.length > 12) s.shift();
  };

  const clearSettle = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  };

  // Springs the panel to `to` and clears the inline position once it has
  // landed.
  const settle = useCallback(
    (to: number, then?: () => void) => {
      const from = xRef.current ?? to;
      const fraction = Math.min(1, Math.abs(to - from) / Math.max(1, width));
      const [short, long] = settleRange();
      const ms = Math.round(short + (long - short) * fraction);
      setDragging(false);
      setSettleMs(ms);
      place(to);
      clearSettle();
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        place(null);
        setSettleMs(null);
        then?.();
      }, ms);
    },
    [width],
  );

  // ---- from closed: the edge zone
  const edgeDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled || open) return;
      pointerId.current = e.pointerId;
      startX.current = e.clientX;
      samples.current = [];
      armed.current = false;
      mode.current = 'open';
      clearSettle();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPeek(true);
      setViaGesture(true);
      setDragging(true);
      place(-width);
      sample(e.clientX);
    },
    [enabled, open, width],
  );

  const edgeMove = useCallback(
    (e: ReactPointerEvent) => {
      if (pointerId.current !== e.pointerId || mode.current !== 'open') return;
      const dx = Math.max(0, e.clientX - startX.current);
      sample(e.clientX);
      const x = -width + dx;
      place(rubber(Math.max(-width, x)));
      const nowArmed = dx > width * COMMIT_FRACTION;
      if (nowArmed !== armed.current) {
        armed.current = nowArmed;
        hapticTick(); // the arm (or the disarm)
      }
    },
    [width],
  );

  const edgeUp = useCallback(
    (e: ReactPointerEvent) => {
      if (pointerId.current !== e.pointerId || mode.current !== 'open') return;
      pointerId.current = null;
      mode.current = null;
      const dx = Math.max(0, e.clientX - startX.current);
      const v = velocity();
      const commit = v > COMMIT_VELOCITY || (dx > width * COMMIT_FRACTION && v > -COMMIT_VELOCITY);
      if (commit) {
        hapticTick(); // the drop
        setOpen(true);
        settle(0, () => setPeek(false));
      } else {
        settle(-width, () => {
          setPeek(false);
          setViaGesture(false);
        });
      }
    },
    [setOpen, width, settle],
  );

  const progress = dragX === null ? null : Math.max(0, Math.min(1, 1 + dragX / width));

  return {
    dragX,
    settleMs,
    dragging,
    peek,
    viaGesture: viaGesture && (open || peek || dragX !== null),
    progress,
    // A release handler is idempotent (pointerId clears on the first call), so
    // the lostpointercapture that follows every pointerup is a harmless echo.
    edgeProps: {
      onPointerDown: edgeDown,
      onPointerMove: edgeMove,
      onPointerUp: edgeUp,
      onPointerCancel: edgeUp,
      onLostPointerCapture: edgeUp,
    },
  };
}
