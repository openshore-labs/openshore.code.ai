// Save the outgoing room's scroll offset the moment the view changes, and put
// it back when a room is re-entered by going back along the trail. The store
// subscription fires synchronously on set(), before React swaps the room, so
// the old scroller is still in the DOM to be read (the same window the room
// ghost uses to clone it). Restoring happens in a layout effect right after
// the new room mounts, before paint, so there is no flash of the top; a room
// whose content arrives later (the Marketplace catalog) restores again itself
// once that content has given the scroller its height.
import { useLayoutEffect, type RefObject } from 'react';
import { useApp } from '../state/store.js';
import { recallScroll, rememberScroll, roomScroller } from '../lib/scrollMemory.js';

export function useScrollMemory(mainRef: RefObject<HTMLElement | null>): void {
  const view = useApp((s) => s.view);

  useLayoutEffect(
    () =>
      useApp.subscribe((state, prev) => {
        if (state.view === prev.view) return;
        const scroller = roomScroller(mainRef.current);
        if (scroller) rememberScroll(prev.view, scroller.scrollTop);
      }),
    [mainRef],
  );

  useLayoutEffect(() => {
    if (!useApp.getState().arrivedBack) return;
    const scroller = roomScroller(mainRef.current);
    const top = recallScroll(view);
    if (scroller && top) scroller.scrollTop = top;
  }, [view, mainRef]);
}
