// Where the eye left each room. A room's scroller (`.screen`) is remounted on
// every room switch, so without this a round trip (Marketplace, Cloud
// Connections, back) lands at the top of the store instead of the shelf the
// person was reading. The store front saves on the way out (useScrollMemory)
// and a room restores on a back navigation only: a fresh open from the panel
// starts at the top, the way a tab does. Pure: a map, unit-tested directly.
const positions = new Map<string, number>();

export function rememberScroll(room: string, top: number): void {
  if (top > 0) positions.set(room, top);
  else positions.delete(room);
}

/** The saved offset for a room, or 0. Kept, not consumed: a second back into
 *  the same room (an async room that restores twice, before and after its
 *  content lands) reads the same number. */
export function recallScroll(room: string): number {
  return positions.get(room) ?? 0;
}

export function forgetScroll(room: string): void {
  positions.delete(room);
}

/** The scroller inside a room's DOM, when it has one. */
export function roomScroller(main: Element | null): HTMLElement | null {
  return main?.querySelector<HTMLElement>('.screen') ?? null;
}
