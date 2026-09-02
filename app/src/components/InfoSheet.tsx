// A settings block collapsed to its title: tap to read the full explanation
// in a sheet, drag the sheet down (or tap the scrim) to put it away. Keeps
// the settings page scannable without cutting any of the honest copy. The
// sheet tracks the finger 1:1 while dragging, then either springs back or,
// past the threshold, plays its exit before unmounting (never a hard cut).
import { useRef, useState, type ReactNode } from 'react';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { hapticTick } from '../lib/haptics.js';

const DISMISS_THRESHOLD = 90;

export function InfoSheet({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const dragYRef = useRef(0);
  const pointerId = useRef<number | null>(null);

  const { closing, dismiss } = useSheetExit(() => {
    setOpen(false);
    setDragging(false);
    setDragY(0);
    dragYRef.current = 0;
  });

  const onGrabStart = (e: React.PointerEvent) => {
    if (closing) return;
    startY.current = e.clientY;
    dragYRef.current = 0;
    pointerId.current = e.pointerId;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    hapticTick(); // the lift
  };
  const onGrabMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    const y = Math.max(0, e.clientY - startY.current);
    dragYRef.current = y;
    setDragY(y);
  };
  const onGrabEnd = () => {
    if (pointerId.current === null) return;
    pointerId.current = null;
    setDragging(false);
    if (dragYRef.current > DISMISS_THRESHOLD) {
      hapticTick(); // the drop
      dismiss();
    } else {
      setDragY(0);
      dragYRef.current = 0;
    }
  };

  return (
    <>
      <button
        type="button"
        className="card card-disclosure press-fb press-fb--row"
        onClick={() => setOpen(true)}
      >
        <h3>{title}</h3>
        <span className="disclosure-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
          <div
            className={`sheet info-sheet${dragging ? ' dragging' : ''}${closing ? ' closing' : ''}`}
            style={!closing && dragY ? { transform: `translateY(${dragY}px)` } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sheet-grabber"
              onPointerDown={onGrabStart}
              onPointerMove={onGrabMove}
              onPointerUp={onGrabEnd}
              onPointerCancel={onGrabEnd}
            >
              <span className="sheet-grabber-bar" aria-hidden="true" />
            </div>
            <h2>{title}</h2>
            <div className="sub">{children}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
