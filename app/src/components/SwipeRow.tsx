// A single model row that answers two gestures. A tap picks the model (the
// normal path). A swipe left reveals a Pin (or Unpin) action behind the row and,
// past a short commit distance or on a quick flick, fires it. The foreground
// tracks the finger 1:1 and springs back on release. Three details make it read
// as native: the gesture locks to an axis on first move, so a vertical scroll is
// never stolen; a light haptic ticks the instant the action is fully revealed
// (armed), the way iOS marks a swipe edge; and a fast flick commits even short of
// the distance threshold. Pointer events, so touch and mouse behave the same.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { hapticSuccess, hapticTick } from '../lib/haptics.js';

const ACTION_WIDTH = 96;
const COMMIT = 64;
const TAP_SLOP = 8;
const HOLD_MS = 480; // a still finger this long is a hold, not a tap
const INTENT = 8; // px of travel before the gesture's axis is decided
const FLICK = 0.45; // leftward px/ms that commits regardless of distance
const FLICK_MIN = 28; // but only once the row has actually opened this far

type Axis = 'none' | 'h' | 'v';

export function SwipeRow({
  pinned = false,
  onTap,
  onToggle,
  onLongPress,
  children,
  label,
  variant = 'pin',
  style,
  className,
}: {
  /** Pin variant only: whether the row is currently pinned (flips the label). */
  pinned?: boolean;
  onTap: () => void;
  onToggle: () => void;
  /** A hold (no movement) fires this instead of the tap. */
  onLongPress?: () => void;
  children: ReactNode;
  /** Override the revealed action's text. Defaults to Pin/Unpin. */
  label?: string;
  /** 'pin' keeps the teal/pin styling; 'danger' paints the action red. */
  variant?: 'pin' | 'danger';
  /** Applied to the row root, e.g. a per-row entrance-stagger custom property. */
  style?: CSSProperties;
  className?: string;
}) {
  const actionLabel = label ?? (pinned ? 'Unpin' : 'Pin');
  const actionClass =
    variant === 'danger' ? ' swipe-action-danger' : pinned ? ' swipe-action-unpin' : '';
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const lastX = useRef(0);
  const lastT = useRef(0);
  const vel = useRef(0);
  const axis = useRef<Axis>('none');
  const armed = useRef(false);
  const pointerId = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  const clearHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  useEffect(() => clearHold, []);

  const onDown = (e: React.PointerEvent) => {
    startX.current = lastX.current = e.clientX;
    startY.current = e.clientY;
    lastT.current = e.timeStamp;
    axis.current = 'none';
    armed.current = false;
    vel.current = 0;
    pointerId.current = e.pointerId;
    setDragging(true);
    held.current = false;
    if (onLongPress) {
      clearHold();
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        if (pointerId.current !== e.pointerId || axis.current !== 'none') return;
        held.current = true;
        onLongPress();
      }, HOLD_MS);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    const rawX = e.clientX - startX.current;
    const rawY = e.clientY - startY.current;

    if (axis.current === 'none') {
      // Any real movement is not a hold.
      if (Math.abs(rawX) > TAP_SLOP || Math.abs(rawY) > TAP_SLOP) clearHold();
      if (Math.abs(rawX) > INTENT && Math.abs(rawX) > Math.abs(rawY)) {
        axis.current = 'h';
        // Claim the pointer only now, so a vertical scroll start is left alone.
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (Math.abs(rawY) > INTENT) {
        axis.current = 'v'; // the list scrolls; stay out of its way
      }
    }
    if (axis.current !== 'h') return;

    const dt = e.timeStamp - lastT.current;
    if (dt > 0) vel.current = (e.clientX - lastX.current) / dt;
    lastX.current = e.clientX;
    lastT.current = e.timeStamp;

    // Left-only reveal, with a little rubber-band past the action width.
    let next = Math.min(0, rawX);
    if (next < -ACTION_WIDTH) next = -ACTION_WIDTH + (next + ACTION_WIDTH) * 0.3;

    // Tick once, the instant the action is fully revealed, then again if the
    // finger backs off and re-opens.
    if (!armed.current && next <= -ACTION_WIDTH) {
      armed.current = true;
      hapticTick();
    } else if (armed.current && next > -ACTION_WIDTH) {
      armed.current = false;
    }
    setDx(next);
  };

  const onUp = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    const wasHorizontal = axis.current === 'h';
    const flick = vel.current <= -FLICK && dx <= -FLICK_MIN;
    const commit = dx <= -COMMIT || flick;
    clearHold();
    const tap =
      !held.current &&
      !wasHorizontal &&
      Math.abs(e.clientX - startX.current) <= TAP_SLOP &&
      Math.abs(e.clientY - startY.current) <= TAP_SLOP;
    pointerId.current = null;
    axis.current = 'none';
    armed.current = false;
    setDragging(false);
    setDx(0);
    if (tap) {
      onTap();
    } else if (wasHorizontal && commit) {
      hapticSuccess();
      onToggle();
    }
  };

  return (
    <div className={`swipe-row${className ? ` ${className}` : ''}`} style={style}>
      <div className={`swipe-action${actionClass}`} aria-hidden="true">
        {actionLabel}
      </div>
      <div
        className={`swipe-fore${dragging ? ' dragging' : ''}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {children}
      </div>
    </div>
  );
}
