// Keep a surface mounted for the length of its exit animation after its open
// flag drops, so nothing snap-unmounts (the motion standard: everything that
// animates in animates out). Returns `mounted` (render it) and `closing` (add
// the exit class). The timer, not transitionend, drives the unmount, so the
// exit also lands under prefers-reduced-motion where no event would fire.
import { useEffect, useRef, useState } from 'react';

/** The default exit length: --dur-5 plus a hair so the decelerating tail is
 *  never clipped (unmounting early is exactly what reads as cheap). */
export const EXIT_MS = 340;

export function useExitPresence(
  open: boolean,
  exitMs: number = EXIT_MS,
): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // `mounted` is intentionally not a dependency: the exit is armed by the
    // open flag dropping, once, and must not re-arm when mounted changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs]);

  return { mounted, closing };
}
