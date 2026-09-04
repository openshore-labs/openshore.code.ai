// A lightweight shared-element move for one title: the project name flies from
// the card the person tapped to the large title of the room that opens. A full
// FLIP (First-Last-Invert-Play) on a single element, not a layout library:
// capture the source rect on tap, then on the destination's first layout invert
// the delta and play back to identity. Web Animations API so it runs off the
// main thread and needs no lingering React state.
//
// Motion vocabulary is honored: the curve and clock are read from the same
// tokens the stylesheet uses (lib/motion.ts), and reduced motion skips it.
import { useLayoutEffect, type RefObject } from 'react';
import { durationMs, easing, prefersReducedMotion } from './motion.js';

// One pending hand-off at a time: the last title tapped. Module state, so it
// survives the source screen unmounting before the destination mounts.
let pending: DOMRect | undefined;

/** Capture the tapped element as the source of the next title hero. Call it in
 *  the tap handler, just before navigating. A null element clears it. */
export function captureTitleHero(el: Element | null): void {
  pending = el ? el.getBoundingClientRect() : undefined;
}

/** Consume the pending source rect (once). */
function takeTitleHero(): DOMRect | undefined {
  const p = pending;
  pending = undefined;
  return p;
}

/**
 * Play the hero on the destination title. Attach the returned ref to the room's
 * heading; on mount it flies in from wherever the tapped card title sat. A no-op
 * (the title simply appears) when there was no tap source, or under reduced
 * motion, or if the browser lacks element.animate.
 */
export function useTitleHero(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const from = takeTitleHero();
    const el = ref.current;
    if (!from || !el || prefersReducedMotion() || typeof el.animate !== 'function') return;
    const to = el.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    // Match the source's height; width follows so the growth reads even though
    // the two use different type. Clamped so a tiny source never overshoots.
    const scale = Math.max(0.35, Math.min(1, from.height / to.height));
    el.animate(
      [
        {
          transformOrigin: 'left top',
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          opacity: 0.55,
        },
        { transformOrigin: 'left top', transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ],
      {
        duration: durationMs('--dur-6', 420),
        easing: easing('--ease-arrive', 'cubic-bezier(0.22,1,0.36,1)'),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
