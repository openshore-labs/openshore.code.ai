// The drawer as a physical object (motion standard, rule 7): an edge swipe
// from the left pulls it in 1:1 with the finger, a leftward drag on the open
// panel pushes it back, and release decides on VELOCITY as well as distance,
// so a quick flick under the distance threshold still commits. Past the rest
// position the panel rubber-bands with asymptotic damping rather than
// hard-clamping. Two haptic marks: the arm (crossing the commit threshold)
// and the drop (the commit itself).
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { hapticTick } from '../lib/haptics.js';
import { EXIT_MS } from './useExitPresence.js';

/** A flick faster than this (px per ms) commits regardless of distance. */
const COMMIT_VELOCITY = 0.35;
/** Fraction of the drawer width a slow drag must cover to commit. */
const COMMIT_FRACTION = 0.4;
/** Movement before a touch on the open drawer counts as a drag (so taps and
 *  vertical scrolls inside the panel are untouched). */
const DRAG_SLOP = 8;
/** How far the panel may rubber-band past its rest position. */
const OVERSHOOT_MAX = 14;
/** Settle time after release: the spring back to rest. Matches --dur-4. */
const SETTLE_MS = 280;

type Sample = { t: number; x: number };

export interface DrawerGesture {
  /** Inline translateX for the panel while dragging or settling; null at rest. */
  dragX: number | null;
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
  drawerProps: GestureProps;
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
  const [dragging, setDragging] = useState(false);
  const [peek, setPeek] = useState(false);
  const [viaGesture, setViaGesture] = useState(false);

  const startX = useRef(0);
  const pointerId = useRef<number | null>(null);
  const captured = useRef(false);
  const armed = useRef(false);
  const samples = useRef<Sample[]>([]);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mode = useRef<'open' | 'close' | null>(null);

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

  const settle = useCallback((to: number, then?: () => void, ms: number = SETTLE_MS) => {
    setDragging(false);
    setDragX(to);
    clearSettle();
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      setDragX(null);
      then?.();
    }, ms);
  }, []);

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
      setDragX(-width);
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
      setDragX(rubber(Math.max(-width, x)));
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

  // ---- from open: a leftward drag on the panel itself
  const drawerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled || !open || mode.current) return;
      pointerId.current = e.pointerId;
      startX.current = e.clientX;
      samples.current = [];
      captured.current = false;
      armed.current = false;
      mode.current = 'close';
      sample(e.clientX);
    },
    [enabled, open],
  );

  const drawerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (pointerId.current !== e.pointerId || mode.current !== 'close') return;
      const dx = e.clientX - startX.current;
      sample(e.clientX);
      if (!captured.current) {
        // Only a clearly horizontal, leftward move becomes a drag.
        if (dx > -DRAG_SLOP) return;
        captured.current = true;
        clearSettle();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }
      setDragX(rubber(Math.max(-width, dx)));
      const nowArmed = -dx > width * COMMIT_FRACTION;
      if (nowArmed !== armed.current) {
        armed.current = nowArmed;
        hapticTick();
      }
    },
    [width],
  );

  const drawerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (pointerId.current !== e.pointerId || mode.current !== 'close') return;
      pointerId.current = null;
      mode.current = null;
      if (!captured.current) return; // a tap or a scroll, not a drag
      const dx = e.clientX - startX.current;
      const v = velocity();
      const commit = v < -COMMIT_VELOCITY || (-dx > width * COMMIT_FRACTION && v < COMMIT_VELOCITY);
      if (commit) {
        hapticTick();
        setOpen(false);
        // Hold the finger's position through the exit: the panel's closing
        // keyframe starts from it (--drawer-x, see Sidebar), so the door keeps
        // sliding out from where the hand left it rather than jumping back to
        // open first. Cleared once the exit has unmounted.
        settle(rubber(Math.max(-width, dx)), undefined, EXIT_MS);
      } else {
        settle(0);
      }
    },
    [setOpen, width, settle],
  );

  const progress = dragX === null ? null : Math.max(0, Math.min(1, 1 + dragX / width));

  return {
    dragX,
    dragging,
    peek,
    // Stays on through a drag-to-close (dragX is held for the exit), so the
    // CSS entrance cannot replay in the render before the closing class lands.
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
    drawerProps: {
      onPointerDown: drawerDown,
      onPointerMove: drawerMove,
      onPointerUp: drawerUp,
      onPointerCancel: drawerUp,
      onLostPointerCapture: drawerUp,
    },
  };
}
