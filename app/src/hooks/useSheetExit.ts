import { useCallback, useEffect, useRef, useState } from 'react';
import { sheetExitMs } from '../lib/motion.js';

// Play a sheet's exit (scrim fade + slide down) before it unmounts, so no
// surface snap-unmounts. Generalized from ProfileStatus's inline pattern. The
// parent keeps the sheet mounted (its open flag stays true) until dismiss()
// finishes the exit and calls onClosed, which is where the parent flips the
// flag. A fixed timer drives the unmount so it also lands under
// prefers-reduced-motion, where no transitionend would ever fire. The default
// hold is the door clock the sheet slides on (lib/motion.ts), plus a hair.

export function useSheetExit(
  onClosed: () => void,
  exitMs: number = sheetExitMs(),
): { closing: boolean; dismiss: () => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const dismiss = useCallback(() => {
    setClosing((already) => {
      if (already) return already;
      timer.current = setTimeout(() => {
        setClosing(false);
        onClosedRef.current();
      }, exitMs);
      return true;
    });
  }, [exitMs]);

  // Escape closes the sheet (desktop keyboard users), the way a dialog should.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss]);

  return { closing, dismiss };
}
