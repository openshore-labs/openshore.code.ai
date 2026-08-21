// A settings block collapsed to its title: tap to read the full explanation
// in a sheet, drag the sheet down (or tap the scrim) to put it away. Keeps
// the settings page scannable without cutting any of the honest copy.
import { useRef, useState, type ReactNode } from 'react';

const DISMISS_THRESHOLD = 90;

export function InfoSheet({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const pointerId = useRef<number | null>(null);

  const close = () => {
    setOpen(false);
    setDragging(false);
    setDragY(0);
  };

  const onGrabStart = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    pointerId.current = e.pointerId;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGrabMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    setDragY(Math.max(0, e.clientY - startY.current));
  };
  const onGrabEnd = () => {
    if (pointerId.current === null) return;
    pointerId.current = null;
    setDragging(false);
    setDragY((y) => {
      if (y > DISMISS_THRESHOLD) {
        setOpen(false);
        return 0;
      }
      return 0;
    });
  };

  return (
    <>
      <button type="button" className="card card-disclosure" onClick={() => setOpen(true)}>
        <h3>{title}</h3>
        <span className="disclosure-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="sheet-scrim" onClick={close}>
          <div
            className={`sheet info-sheet${dragging ? ' dragging' : ''}`}
            style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
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
