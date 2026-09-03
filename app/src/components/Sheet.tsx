// A bottom sheet (or a centered confirm card) that owns its own presence: it
// stays mounted through the exit animation after `open` drops, so a parent
// can drive it from plain state (`open={Boolean(editing)}`) and still never
// snap-unmount it. While closing it re-renders the last open children, so the
// parent's body may guard on its own state (`{editing ? ... : null}`).
//
// Tapping the scrim, pressing Escape, or dragging the sheet down past the
// threshold (or flicking it, whatever the distance) calls onClose; the parent
// flips its flag; the exit plays from wherever the finger left the sheet;
// then the sheet is gone. The drag tracks the finger 1:1, rubber-bands past
// the top with asymptotic damping, and springs back on a short release.
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { durationMs, sheetExitMs } from '../lib/motion.js';
import { hapticTick } from '../lib/haptics.js';

/** Drag further than this and the release dismisses. */
const DISMISS_THRESHOLD = 90;
/** A downward flick faster than this (px per ms) dismisses at any distance. */
const COMMIT_VELOCITY = 0.35;
/** How far the sheet may rubber-band above its rest position. */
const OVERSHOOT_MAX = 14;

type Sample = { t: number; y: number };

export function Sheet({
  open,
  onClose,
  children,
  variant = 'sheet',
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** `sheet` rises from the bottom; `confirm` pops in the center; `top` lowers
   *  from the top edge (and drags up to dismiss). */
  variant?: 'sheet' | 'confirm' | 'top';
  className?: string;
}) {
  // Which way a dismissing drag travels: down for a bottom sheet, up for a top
  // sheet. The math below runs in dismiss-positive "travel" space so one code
  // path serves both; `dir` maps travel back to a screen-space translate.
  const dir = variant === 'top' ? -1 : 1;
  // Held for the door clock the sheet slides on, so the glide's tail is never
  // clipped by the unmount.
  const { mounted, closing } = useExitPresence(open, sheetExitMs());
  const last = useRef<ReactNode>(children);
  if (open) last.current = children;

  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  // True while the sheet springs back after a short release, so the return
  // rides the spring rather than the door's glide.
  const [settling, setSettling] = useState(false);
  const startY = useRef(0);
  const dragYRef = useRef(0);
  const pointerId = useRef<number | null>(null);
  const samples = useRef<Sample[]>([]);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The card's height, captured at grab start, so the scrim dims in proportion
  // to how far down the sheet has been pulled (the room comes back as the sheet
  // leaves, the same seam the drawer's scrim keeps).
  const cardH = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // Pulled the wrong way (past its rest edge), the sheet gives a little and no
  // more. Runs in travel space, so the same asymptotic damping serves both a
  // bottom sheet pulled up and a top sheet pulled down.
  const rubber = (travel: number): number =>
    travel >= 0 ? travel : -OVERSHOOT_MAX * (1 - Math.exp(travel / (OVERSHOOT_MAX * 3)));

  const velocity = (): number => {
    const s = samples.current;
    if (s.length < 2) return 0;
    const end = s[s.length - 1]!;
    // Read over the last ~80ms so a pause before lifting reads as a slow drop.
    let i = s.length - 2;
    while (i > 0 && end.t - s[i]!.t < 80) i -= 1;
    const first = s[i]!;
    return (end.y - first.y) / Math.max(1, end.t - first.t);
  };

  const onGrabStart = (e: ReactPointerEvent) => {
    if (closing) return;
    startY.current = e.clientY;
    dragYRef.current = 0;
    cardH.current = cardRef.current?.offsetHeight ?? 0;
    samples.current = [{ t: performance.now(), y: 0 }];
    pointerId.current = e.pointerId;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setSettling(false);
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    hapticTick(); // the lift
  };
  const onGrabMove = (e: ReactPointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    // Travel is dismiss-positive (down for a bottom sheet, up for a top one);
    // rubber-band the wrong-way pull, then map back to a screen-space translate.
    const travel = dir * (e.clientY - startY.current);
    const y = dir * rubber(travel);
    dragYRef.current = y;
    samples.current.push({ t: performance.now(), y: rubber(travel) });
    if (samples.current.length > 12) samples.current.shift();
    setDragY(y);
  };
  // Lost capture is a release too (the platform can take the pointer away);
  // the echo after a normal pointerup is a no-op because pointerId clears.
  const onGrabEnd = () => {
    if (pointerId.current === null) return;
    pointerId.current = null;
    setDragging(false);
    const travel = dir * dragYRef.current; // dismiss-positive distance moved
    const v = velocity();
    if (travel > 0 && (travel > DISMISS_THRESHOLD || v > COMMIT_VELOCITY)) {
      hapticTick(); // the drop
      // The inline transform stays until `closing` lands, so the exit
      // transition continues from where the hand left the sheet.
      onClose();
      return;
    }
    setSettling(true);
    setDragY(0);
    dragYRef.current = 0;
    settleTimer.current = setTimeout(
      () => {
        settleTimer.current = null;
        setSettling(false);
      },
      durationMs('--dur-5', 320),
    );
  };

  if (!mounted) return null;
  const scrim =
    variant === 'confirm' ? 'confirm-scrim' : `sheet-scrim${variant === 'top' ? ' top' : ''}`;
  const card = variant === 'confirm' ? 'confirm-card' : `sheet${variant === 'top' ? ' top' : ''}`;
  const draggable = variant === 'sheet' || variant === 'top';
  // While a dismissing drag is in flight, the scrim tracks it 1:1 (no
  // transition) and lightens toward clear as the sheet nears fully gone.
  // `travel` is the dismiss-positive distance, so this reads the same for a
  // bottom sheet pulled down and a top sheet pulled up.
  const travel = dir * dragY;
  const dragScrim =
    dragging && travel > 0 && cardH.current
      ? { opacity: Math.max(0, 1 - travel / cardH.current) }
      : undefined;
  const grabber = draggable ? (
    <div
      className="sheet-grabber"
      onPointerDown={onGrabStart}
      onPointerMove={onGrabMove}
      onPointerUp={onGrabEnd}
      onPointerCancel={onGrabEnd}
      onLostPointerCapture={onGrabEnd}
    >
      <span className="sheet-grabber-bar" aria-hidden="true" />
    </div>
  ) : null;
  return (
    <div
      className={`${scrim}${closing ? ' closing' : ''}${dragScrim ? ' dragging' : ''}`}
      style={dragScrim}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        className={`${card}${className ? ` ${className}` : ''}${closing ? ' closing' : ''}${dragging ? ' dragging' : ''}${settling ? ' settling' : ''}`}
        style={!closing && dragY !== 0 ? { transform: `translateY(${dragY}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* A top sheet's handle sits under its content, at the edge it drags
            toward; a bottom sheet's rides above, the edge it rises from. */}
        {variant === 'top' ? null : grabber}
        {open ? children : last.current}
        {variant === 'top' ? grabber : null}
      </div>
    </div>
  );
}
