// A single model row that answers two gestures. A tap picks the model (the
// normal path). A swipe left reveals a Pin (or Unpin) action behind the row and,
// past a short commit distance, fires it. The foreground tracks the finger 1:1
// and springs back on release; a tap never triggers the pin, and a swipe never
// triggers the pick. Pointer events so it works the same under touch and mouse.
import { useRef, useState, type ReactNode } from 'react';
import { hapticSuccess } from '../lib/haptics.js';

const ACTION_WIDTH = 96;
const COMMIT = 64;
const TAP_SLOP = 8;

export function SwipeRow({
  pinned,
  onTap,
  onToggle,
  children,
}: {
  pinned: boolean;
  onTap: () => void;
  onToggle: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const moved = useRef(0);
  const pointerId = useRef<number | null>(null);

  const onDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    moved.current = 0;
    pointerId.current = e.pointerId;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    const raw = e.clientX - startX.current;
    moved.current = Math.max(moved.current, Math.abs(raw));
    // Left-only reveal. A little rubber-band past the action width.
    let next = Math.min(0, raw);
    if (next < -ACTION_WIDTH) next = -ACTION_WIDTH + (next + ACTION_WIDTH) * 0.3;
    setDx(next);
  };

  const onUp = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    setDragging(false);
    const swiped = moved.current > TAP_SLOP;
    const commit = dx <= -COMMIT;
    setDx(0);
    if (!swiped) {
      onTap();
    } else if (commit) {
      hapticSuccess();
      onToggle();
    }
  };

  return (
    <div className="swipe-row">
      <div className={`swipe-action${pinned ? ' swipe-action-unpin' : ''}`} aria-hidden="true">
        {pinned ? 'Unpin' : 'Pin'}
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
