// Room changes dissolve instead of hard-cutting (motion standard, rule 3):
// the moment the view changes, before React swaps the room, the outgoing
// room's DOM is cloned into a static overlay that fades out while the new
// room fades in. A DOM snapshot, not a second React mount, so no effects
// re-run and a streaming transcript is never duplicated. Skipped under
// prefers-reduced-motion. The clone is inert: no pointer events, no
// animations of its own (a cloned entrance would replay from zero).
import { useEffect, type RefObject } from 'react';
import { useApp } from '../state/store.js';

/** Held to the animation's full length (--dur-3) so the tail is never clipped. */
export const ROOM_OUT_MS = 220;

export function useRoomGhost(
  mainRef: RefObject<HTMLElement | null>,
  hostRef: RefObject<HTMLElement | null>,
): void {
  useEffect(
    () =>
      useApp.subscribe((state, prev) => {
        if (state.view === prev.view) return;
        // Onboarding is a full takeover with its own entrance; and a room that
        // is not on screen has nothing to dissolve.
        if (prev.view === 'onboarding' || state.view === 'onboarding') return;
        const main = mainRef.current;
        const host = hostRef.current;
        if (!main || !host) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const box = main.getBoundingClientRect();
        const shell = host.parentElement?.getBoundingClientRect();
        const clone = main.cloneNode(true) as HTMLElement;
        clone.className = 'room-ghost';
        clone.removeAttribute('id');
        clone.setAttribute('aria-hidden', 'true');
        clone.inert = true;
        clone.style.left = `${box.left - (shell?.left ?? 0)}px`;
        clone.style.top = `${box.top - (shell?.top ?? 0)}px`;
        clone.style.width = `${box.width}px`;
        clone.style.height = `${box.height}px`;
        host.replaceChildren(clone);
        setTimeout(() => clone.remove(), ROOM_OUT_MS);
      }),
    [mainRef, hostRef],
  );
}
