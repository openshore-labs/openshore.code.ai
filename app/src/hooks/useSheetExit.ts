import { useCallback, useEffect, useRef, useState } from 'react';

// Play a sheet's exit (scrim fade + slide down) before it unmounts, so no
// surface snap-unmounts. Generalized from ProfileStatus's inline pattern. The
// parent keeps the sheet mounted (its open flag stays true) until dismiss()
// finishes the exit and calls onClosed, which is where the parent flips the
// flag. A fixed timer drives the unmount so it also lands under
// prefers-reduced-motion, where no transitionend would ever fire.
const EXIT_MS = 340;

export function useSheetExit(
  onClosed: () => void,
  exitMs: number = EXIT_MS,
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

  return { closing, dismiss };
}
