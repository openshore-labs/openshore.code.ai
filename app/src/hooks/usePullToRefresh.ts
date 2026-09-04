// Pull-to-refresh for a scroll container, built to the house gesture bar: it
// tracks the finger 1:1, rubber-bands with asymptotic damping past the arm
// point, releases on distance (not a timer), and settles back with physics.
// Safety first, because a stuck gesture has wedged this app before: it engages
// ONLY at the very top of the scroll and only on a real downward touch, a lost
// pointer capture counts as a release, and reduced-motion callers can pass it a
// zeroed spring. It never blocks normal scrolling: any move that is not a
// top-of-scroll downward pull is left entirely to the browser.
import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { hapticSuccess, hapticTick } from '../lib/haptics.js';

const ARM = 72; // px of pull that arms a refresh
const MAX = 128; // px ceiling, rubber-banded toward
const START = 6; // px of downward travel before we claim the gesture

/** Asymptotic damping: the first pixels track nearly 1:1, then the pull grows
 *  ever more slowly toward MAX, so it can never run off the screen. */
function damp(raw: number): number {
  return MAX * (1 - Math.exp(-raw / MAX));
}

export interface PullToRefresh {
  /** The visible pull distance in px, to translate the content and indicator. */
  pull: number;
  /** Past the arm point: the release will refresh. */
  armed: boolean;
  /** A refresh is running. */
  refreshing: boolean;
  /** Releasing: the content is springing back, so bind a transition. */
  settling: boolean;
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
    onLostPointerCapture: (e: ReactPointerEvent) => void;
  };
}

export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  opts?: { enabled?: boolean },
): PullToRefresh {
  const enabled = opts?.enabled ?? true;
  const [pull, setPull] = useState(0);
  const [armed, setArmed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settling, setSettling] = useState(false);

  // Gesture state lives in a ref: it changes every pointer event and must not
  // re-render. `phase` is 'idle' (nothing), 'watching' (touch down at the top,
  // not yet claimed), or 'active' (claimed, capturing the pointer).
  const g = useRef({
    phase: 'idle' as 'idle' | 'watching' | 'active',
    id: -1,
    startY: 0,
    armed: false,
    el: null as HTMLElement | null,
  });

  const reset = useCallback(() => {
    const st = g.current;
    if (st.el && st.id !== -1) {
      try {
        st.el.releasePointerCapture(st.id);
      } catch {
        // Capture may already be gone (that is exactly the release we want).
      }
    }
    st.phase = 'idle';
    st.id = -1;
    st.armed = false;
    st.el = null;
    setArmed(false);
  }, []);

  const release = useCallback(() => {
    const wasArmed = g.current.armed;
    reset();
    if (wasArmed && !refreshing) {
      hapticSuccess();
      setRefreshing(true);
      setSettling(true);
      setPull(ARM); // rest at the arm point while the work runs
      Promise.resolve(onRefresh()).finally(() => {
        setRefreshing(false);
        setSettling(true);
        setPull(0);
      });
    } else {
      setSettling(true);
      setPull(0);
    }
  }, [onRefresh, refreshing, reset]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled || refreshing) return;
      if (e.pointerType !== 'touch') return; // a finger gesture, not a mouse
      const el = e.currentTarget as HTMLElement;
      if (el.scrollTop > 0) return; // only at the very top of the scroll
      g.current.phase = 'watching';
      g.current.id = e.pointerId;
      g.current.startY = e.clientY;
      g.current.el = el;
    },
    [enabled, refreshing],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const st = g.current;
      if (st.phase === 'idle' || e.pointerId !== st.id) return;
      const dy = e.clientY - st.startY;

      if (st.phase === 'watching') {
        // Claim the gesture only for a clear downward pull from the top. An
        // upward move, or a container no longer at the top, hands it back to the
        // browser as an ordinary scroll.
        if (dy <= 0 || (st.el && st.el.scrollTop > 0)) {
          st.phase = 'idle';
          st.id = -1;
          return;
        }
        if (dy < START) return;
        st.phase = 'active';
        setSettling(false);
        try {
          st.el?.setPointerCapture(st.id);
        } catch {
          // If capture is refused, stand down rather than half-track.
          st.phase = 'idle';
          st.id = -1;
          return;
        }
      }

      // Active: track the finger through the damping curve.
      e.preventDefault();
      const dist = damp(Math.max(0, dy - START));
      setPull(dist);
      const nowArmed = dist >= ARM;
      if (nowArmed !== st.armed) {
        st.armed = nowArmed;
        setArmed(nowArmed);
        if (nowArmed) hapticTick(); // the arm, marked
      }
    },
    [],
  );

  const onEnd = useCallback(
    (e: ReactPointerEvent) => {
      const st = g.current;
      if (e.pointerId !== st.id) return;
      if (st.phase === 'active') release();
      else reset();
    },
    [release, reset],
  );

  return {
    pull,
    armed,
    refreshing,
    settling,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onEnd,
      onPointerCancel: onEnd,
      onLostPointerCapture: onEnd,
    },
  };
}
