// A view swap inside one room crossfades instead of cutting (motion standard,
// rule 3: everything that animates in animates out). The room ghost's method
// (useRoomGhost), one level down: when a view's root leaves because the view
// changed, its DOM is cloned in place into a static snapshot that fades out
// on the tokens while the arriving view fades in over it. A DOM snapshot, not
// a second React mount, so no effect runs twice, no editor autofocuses twice,
// and no sheet or timer is doubled.
//
// Bind it by view: `const ghost = useViewGhost(view)` and `ref={ghost('tree')}`
// on each view's root. The ref's detach runs in React's commit before the old
// root leaves the document, so its box and its typed text are still there to
// copy. A re-key of the same view (a reload settling in) is not a swap and
// leaves no ghost; neither does the whole room leaving (the room ghost has it).
//
// The snapshot is inert and aria-hidden, so it never takes a tap, a focus, or
// a screen reader's attention while it fades; its ids are dropped so nothing
// points into it. It sits over the old view's own box, lifted out of the flow
// (absolute in the positioned ancestor both share), clipped to what was on
// screen. Skipped under reduced motion, and where
// the host cannot say whether motion is wanted (no matchMedia).
import { useCallback, useRef } from 'react';
import { durationMs } from '../lib/motion.js';

/** The class the snapshot wears, beside the leaving view's own classes. */
export const VIEW_GHOST_CLASS = 'view-ghost';

/** How long the snapshot stays: the crossfade clock (--dur-3) plus a hair, so
 *  the tail is never clipped. */
export function viewGhostMs(): number {
  return durationMs('--dur-3', 220) + 20;
}

function motionWanted(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Copy the leaving root into a fading, inert snapshot beside it. Exported for
 *  the guard test; the room binds it through `useViewGhost`. */
export function ghostOf(node: HTMLElement): HTMLElement | undefined {
  const parent = node.parentNode;
  if (!parent || !node.isConnected || !motionWanted()) return undefined;
  const box = node.getBoundingClientRect();
  const clone = node.cloneNode(true) as HTMLElement;
  // A clone carries a field's markup, not what was typed into it.
  const from = node.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input');
  const to = clone.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input');
  to.forEach((field, i) => {
    const typed = from[i]?.value;
    if (typed !== undefined) field.value = typed;
  });
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  clone.classList.add(VIEW_GHOST_CLASS, 'closing');
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  // What was on screen, no more: a long list must not hang past the room.
  const scroller = node.closest('.screen');
  const bottom = scroller ? scroller.getBoundingClientRect().bottom : box.bottom;
  const shown = Math.max(0, Math.min(box.height, bottom - box.top));
  if (box.width > 0) clone.style.width = `${box.width}px`;
  if (shown > 0) clone.style.height = `${shown}px`;
  // Pinned to the old box inside the positioned ancestor both share (the
  // room's scroller), scroll included, so centering margins cannot move it.
  const frame = node.offsetParent;
  if (frame instanceof HTMLElement && box.width > 0) {
    const at = frame.getBoundingClientRect();
    clone.style.left = `${box.left - at.left - frame.clientLeft + frame.scrollLeft}px`;
    clone.style.top = `${box.top - at.top - frame.clientTop + frame.scrollTop}px`;
    clone.style.margin = '0';
  }
  parent.insertBefore(clone, node.nextSibling);
  setTimeout(() => clone.remove(), viewGhostMs());
  return clone;
}

/** The ref binder for one set of views that replace each other. `view` is the
 *  view this render shows; `ghost(key)` is the ref for the root of view `key`. */
export function useViewGhost(view: string): (key: string) => (node: HTMLElement | null) => void {
  // The view this render asked for, read when an old root detaches in the
  // commit that follows.
  const showing = useRef(view);
  showing.current = view;
  const nodes = useRef(new Map<string, HTMLElement>());
  const binders = useRef(new Map<string, (node: HTMLElement | null) => void>());
  return useCallback((key: string) => {
    let bind = binders.current.get(key);
    if (!bind) {
      bind = (node) => {
        if (node) {
          nodes.current.set(key, node);
          return;
        }
        const old = nodes.current.get(key);
        nodes.current.delete(key);
        if (old && showing.current !== key) ghostOf(old);
      };
      binders.current.set(key, bind);
    }
    return bind;
  }, []);
}
