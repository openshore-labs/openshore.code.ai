// Drag to reorder the sidebar (2026-10-01). A row lifts on a long
// press with a finger (a short press still opens the room, and a sideways
// swipe still closes the drawer) or on a short drag with a mouse, follows the
// pointer 1:1, and the rows it passes step aside on the standard curve
// (FLIP: each is measured before and after the move, then eased from where it
// was). On release it settles into its slot on the spring and the order is
// saved. Alt+Arrow moves a focused row one slot, the keyboard's way in.
// Motion rule 5: the lift and the drop are marked, and each slot crossed is a
// light tick, the way iOS reorders a list.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { hapticApproval, hapticTick } from '../lib/haptics.js';
import { durationMs } from '../lib/motion.js';
import {
  DIVIDER,
  flatten,
  placeAt,
  sameOrder,
  step,
  unflatten,
  type FlatSlot,
  type MovableRoom,
  type NavOrder,
} from '../lib/sidebarOrder.js';

/** How long a finger holds still before the row lifts. */
const LONG_PRESS_MS = 380;
/** Movement that cancels a pending long press (the finger meant to swipe or
 *  scroll), and the drag a mouse needs before the row lifts. */
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 5;

interface Drag {
  room: MovableRoom;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  y: number;
  /** Where in the row the pointer took hold, so the row never jumps. */
  grab: number;
  armed: boolean;
  timer: number | null;
  el: HTMLElement;
}

/** The row's top without any transform it wears (a FLIP or the drag). */
function layoutTop(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  const dy = t && t !== 'none' && typeof DOMMatrix !== 'undefined' ? new DOMMatrix(t).m42 : 0;
  return el.getBoundingClientRect().top - dy;
}

export interface NavReorder {
  /** The order to render: the live one while a row is held. */
  order: NavOrder;
  /** The room in the hand, if any. */
  lifted: MovableRoom | null;
  /** Bind to each movable row. */
  rowProps: (room: MovableRoom) => {
    ref: (el: HTMLElement | null) => void;
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
    onKeyDown: (e: ReactKeyboardEvent) => void;
    onContextMenu: (e: ReactMouseEvent) => void;
  };
  /** Bind to the recent chats between the groups: a slot the rows pass. */
  dividerRef: (el: HTMLElement | null) => void;
}

export function useNavReorder(order: NavOrder, commit: (next: NavOrder) => void): NavReorder {
  const [live, setLive] = useState<NavOrder | null>(null);
  const [lifted, setLifted] = useState<MovableRoom | null>(null);
  const shown = live ?? order;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const els = useRef(new Map<FlatSlot, HTMLElement>());
  const drag = useRef<Drag | null>(null);
  const first = useRef<Map<FlatSlot, number> | null>(null);
  const settleTimer = useRef<number | null>(null);

  // A held row is let go of once the saved order has caught up, so the list
  // never flickers back to the old order between the drop and the save.
  useEffect(() => {
    if (live && !lifted && sameOrder(live, order)) setLive(null);
  }, [live, lifted, order]);

  useEffect(
    () => () => {
      const d = drag.current;
      if (d?.timer != null) window.clearTimeout(d.timer);
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
      win.current?.remove();
    },
    [],
  );

  /** Keep the held row under the pointer, wherever its slot is now. A row
   *  that crosses to the other group is a new element there, so the row is
   *  looked up by its room every time, never held by reference. */
  const place = useCallback(() => {
    const d = drag.current;
    if (!d?.armed) return;
    const el = els.current.get(d.room) ?? d.el;
    d.el = el;
    el.style.transform = `translateY(${d.y - d.grab - layoutTop(el)}px)`;
  }, []);

  // FLIP: every row but the held one eases from where it was to its new slot.
  useLayoutEffect(() => {
    const before = first.current;
    if (!before) return;
    first.current = null;
    const held = drag.current?.room;
    for (const [key, el] of els.current) {
      if (key === held) continue;
      const was = before.get(key);
      if (was === undefined) continue;
      el.classList.add('nav-flip-hold');
      el.style.transform = '';
      const delta = was - el.getBoundingClientRect().top;
      if (Math.abs(delta) >= 0.5) {
        el.style.transform = `translateY(${delta}px)`;
        void el.getBoundingClientRect();
        el.classList.remove('nav-flip-hold');
        el.style.transform = '';
      } else {
        el.classList.remove('nav-flip-hold');
      }
    }
    place();
  }, [live, place]);

  const move = useCallback((next: NavOrder) => {
    const tops = new Map<FlatSlot, number>();
    for (const [key, el] of els.current) tops.set(key, el.getBoundingClientRect().top);
    first.current = tops;
    setLive(next);
  }, []);

  /** Which slot the held row's middle is over, by every other slot's middle. */
  const retarget = useCallback(() => {
    const d = drag.current;
    if (!d?.armed) return;
    const flat = flatten(shownRef.current);
    const middle = d.y - d.grab + (els.current.get(d.room) ?? d.el).offsetHeight / 2;
    let index = 0;
    for (const slot of flat) {
      if (slot === d.room) continue;
      const el = els.current.get(slot);
      if (!el) continue;
      if (layoutTop(el) + el.offsetHeight / 2 < middle) index++;
    }
    const next = placeAt(flat, d.room, index);
    if (next.join() !== flat.join()) {
      hapticTick();
      move(unflatten(next));
    }
  }, [move]);

  // The window's listeners for a held row. Made once, so the ones added at
  // the lift are the ones taken off at the drop; each reads this render's
  // work through `latest`.
  const latest = useRef({ place, retarget, drop: () => {} });
  const win = useRef<{
    move: (ev: PointerEvent) => void;
    up: (ev: PointerEvent) => void;
    holdStill: (ev: TouchEvent) => void;
    add: () => void;
    remove: () => void;
  } | null>(null);
  if (!win.current) {
    const w = {
      holdStill: (ev: TouchEvent) => {
        if (drag.current?.armed) ev.preventDefault();
      },
      move: (ev: PointerEvent) => {
        const d = drag.current;
        if (!d?.armed || ev.pointerId !== d.pointerId) return;
        ev.stopPropagation();
        d.y = ev.clientY;
        latest.current.place();
        latest.current.retarget();
      },
      up: (ev: PointerEvent) => {
        const d = drag.current;
        if (!d?.armed || ev.pointerId !== d.pointerId) return;
        // Not stopped: the drawer's gesture saw the press go down and must see
        // it come up, or it stays mid-gesture and the next swipe is ignored.
        // It never captured this pointer, so it reads the release as a tap.
        latest.current.drop();
      },
      add: () => {
        window.addEventListener('pointermove', w.move, true);
        window.addEventListener('pointerup', w.up, true);
        window.addEventListener('pointercancel', w.up, true);
        window.addEventListener('touchmove', w.holdStill, { capture: true, passive: false });
      },
      remove: () => {
        window.removeEventListener('pointermove', w.move, true);
        window.removeEventListener('pointerup', w.up, true);
        window.removeEventListener('pointercancel', w.up, true);
        window.removeEventListener('touchmove', w.holdStill, true);
      },
    };
    win.current = w;
  }
  const listeners = win.current;

  const arm = useCallback(() => {
    const d = drag.current;
    if (!d || d.armed) return;
    d.armed = true;
    d.timer = null;
    d.grab = d.startY - layoutTop(d.el);
    try {
      d.el.setPointerCapture(d.pointerId);
    } catch {
      // The pointer is already gone; the release will tidy up.
    }
    if (settleTimer.current != null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    d.el.classList.remove('nav-settling');
    hapticApproval();
    setLifted(d.room);
    setLive(shownRef.current);
    place();
    // From here the window follows the pointer, wherever it goes and whatever
    // element the row is by then, and nothing under it (the drawer's own
    // drag, a tap) sees the gesture.
    listeners.add();
  }, [place, listeners]);

  // The release of a drag is not a tap on whatever is under it.
  const swallowNextClick = () => {
    const swallow = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };

  latest.current = {
    place,
    retarget,
    drop: () => {
      const d = drag.current;
      if (!d?.armed) return;
      drag.current = null;
      listeners.remove();
      swallowNextClick();
      hapticTick();
      // Settle into the slot on the spring, from wherever the hand left it.
      const el = els.current.get(d.room) ?? d.el;
      el.classList.add('nav-settling');
      el.style.transform = '';
      settleTimer.current = window.setTimeout(
        () => {
          el.classList.remove('nav-settling');
          settleTimer.current = null;
        },
        durationMs('--dur-4', 280),
      );
      setLifted(null);
      const next = shownRef.current;
      if (!sameOrder(next, order)) commit(next);
      else setLive(null);
    },
  };

  /** A press that never became a drag lets go of its long-press clock. */
  const letGo = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || d.armed) return;
    if (d.timer != null) window.clearTimeout(d.timer);
    drag.current = null;
  };

  const register = useCallback(
    (key: FlatSlot) => (el: HTMLElement | null) => {
      if (el) els.current.set(key, el);
      else els.current.delete(key);
    },
    [],
  );

  // A held row owns the finger: the page must not scroll or pan under it.
  // Bound once per row, not passive, so it can say no from the first move
  // (the window's guard, added at the lift, may come too late for a browser
  // that has already decided).
  const touchGuards = useRef(new WeakSet<HTMLElement>());
  const guard = (el: HTMLElement) => {
    if (touchGuards.current.has(el)) return;
    touchGuards.current.add(el);
    el.addEventListener('touchmove', listeners.holdStill, { passive: false });
  };

  const rowProps = (room: MovableRoom) => ({
    ref: (el: HTMLElement | null) => {
      register(room)(el);
      if (el) guard(el);
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const el = e.currentTarget as HTMLElement;
      const d: Drag = {
        room,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        y: e.clientY,
        grab: 0,
        armed: false,
        timer: null,
        el,
      };
      drag.current = d;
      if (e.pointerType !== 'mouse') d.timer = window.setTimeout(arm, LONG_PRESS_MS);
    },
    // Before the lift only; once a row is held the window has the pointer.
    onPointerMove: (e: ReactPointerEvent) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId || d.armed) return;
      d.y = e.clientY;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.pointerType === 'mouse') {
        if (Math.abs(dy) > MOUSE_SLOP && Math.abs(dy) > Math.abs(dx)) {
          arm();
          e.stopPropagation();
        } else if (Math.abs(dx) > MOUSE_SLOP) drag.current = null;
      } else if (Math.hypot(dx, dy) > TOUCH_SLOP) {
        // The finger moved before the hold: a swipe or a scroll, not ours.
        if (d.timer != null) window.clearTimeout(d.timer);
        drag.current = null;
      }
    },
    onPointerUp: letGo,
    onPointerCancel: letGo,
    // A long press must not open the system's menu over the row.
    onContextMenu: (e: ReactMouseEvent) => {
      if (drag.current) e.preventDefault();
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const next = step(shownRef.current, room, e.key === 'ArrowUp' ? -1 : 1);
      if (sameOrder(next, shownRef.current)) return;
      hapticTick();
      move(next);
      commit(next);
      // Moving the row can drop its focus; the keyboard keeps hold of it.
      queueMicrotask(() => els.current.get(room)?.focus());
    },
  });

  return { order: shown, lifted, rowProps, dividerRef: register(DIVIDER) };
}
