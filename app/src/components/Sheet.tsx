// A bottom sheet (or a centered confirm card) that owns its own presence: it
// stays mounted through the exit animation after `open` drops, so a parent
// can drive it from plain state (`open={Boolean(editing)}`) and still never
// snap-unmount it. While closing it re-renders the last open children, so the
// parent's body may guard on its own state (`{editing ? ... : null}`).
//
// Tapping the scrim or pressing Escape calls onClose; the parent flips its
// flag; the exit plays; then the sheet is gone.
import { useEffect, useRef, type ReactNode } from 'react';
import { useExitPresence } from '../hooks/useExitPresence.js';

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
  /** `sheet` rises from the bottom; `confirm` pops in the center. */
  variant?: 'sheet' | 'confirm';
  className?: string;
}) {
  const { mounted, closing } = useExitPresence(open);
  const last = useRef<ReactNode>(children);
  if (open) last.current = children;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  const scrim = variant === 'confirm' ? 'confirm-scrim' : 'sheet-scrim';
  const card = variant === 'confirm' ? 'confirm-card' : 'sheet';
  return (
    <div className={`${scrim}${closing ? ' closing' : ''}`} onClick={onClose}>
      <div
        className={`${card}${className ? ` ${className}` : ''}${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {open ? children : last.current}
      </div>
    </div>
  );
}
