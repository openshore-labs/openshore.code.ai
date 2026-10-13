// The sidebar's order is the person's (2026-10-01): every room can be
// dragged to a new place, in its group or across to the other one, and the
// recent chats sit between the two groups. Settings and the sign-in card are
// pinned to the bottom and never move. Pure, so the rules are tested here and
// the Sidebar only renders them.
import type { NavRoom } from './navRooms.js';

/** The rooms the person may move. Settings is pinned, so it is never one. */
export type MovableRoom = Exclude<NavRoom, 'settings'>;

/** The saved order: the group above the recent chats and the one below. */
export interface NavOrder {
  top: MovableRoom[];
  bottom: MovableRoom[];
  /** The default the order was saved against. An order saved under an older
   *  default is set aside once (NAV_ORDER_VERSION). */
  v?: number;
}

/** 2: every room in one group under the Vault (2026-10-01). */
export const NAV_ORDER_VERSION = 2;

/** Rooms renamed since an order may have been saved, so a dragged room
 *  keeps its place: the Marketplace became the Local Library (2026-10-13). */
const RENAMED_ROOMS: Record<string, MovableRoom> = { marketplace: 'library' };

/** Where the recent chats sit in the flat list a drag works on. */
export const DIVIDER = '|' as const;
export type FlatSlot = MovableRoom | typeof DIVIDER;

/**
 * The order to render: the saved one, kept only to rooms this build shows,
 * each once, with any room the saved order does not know (a room new in an
 * update, or a first launch) placed in its default group after its default
 * neighbour. Settings is dropped wherever it appears.
 */
export function resolveNavOrder(saved: NavOrder | undefined, defaults: NavOrder): NavOrder {
  const allowed = new Set<MovableRoom>([...defaults.top, ...defaults.bottom]);
  const seen = new Set<MovableRoom>();
  const keep = (list: readonly string[] | undefined): MovableRoom[] =>
    (list ?? [])
      .map((r) => RENAMED_ROOMS[r] ?? r)
      .filter((r): r is MovableRoom => {
        if (!allowed.has(r as MovableRoom) || seen.has(r as MovableRoom)) return false;
        seen.add(r as MovableRoom);
        return true;
      });
  const out: NavOrder = { top: keep(saved?.top), bottom: keep(saved?.bottom) };
  for (const group of ['top', 'bottom'] as const) {
    const def = defaults[group];
    def.forEach((room, i) => {
      if (seen.has(room)) return;
      seen.add(room);
      const list = out[group];
      // After the nearest default neighbour already placed in this group, or
      // first when there is none.
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const k = list.indexOf(def[j]!);
        if (k >= 0) {
          at = k + 1;
          break;
        }
      }
      list.splice(at, 0, room);
    });
  }
  return out;
}

/** The two groups as one list, the recent chats a slot between them. */
export function flatten(order: NavOrder): FlatSlot[] {
  return [...order.top, DIVIDER, ...order.bottom];
}

/** The flat list back into its two groups. */
export function unflatten(flat: readonly FlatSlot[]): NavOrder {
  const at = flat.indexOf(DIVIDER);
  return {
    top: flat.slice(0, at) as MovableRoom[],
    bottom: flat.slice(at + 1) as MovableRoom[],
  };
}

/** The flat list with `room` taken out and put back at `index` of what is
 *  left. The same list (by value) when nothing moved. */
export function placeAt(flat: readonly FlatSlot[], room: MovableRoom, index: number): FlatSlot[] {
  const rest = flat.filter((s) => s !== room);
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), room, ...rest.slice(at)];
}

/** One step up (-1) or down (+1), crossing the recent chats like any other
 *  slot. The keyboard's move, and the same rule a drag follows. */
export function step(order: NavOrder, room: MovableRoom, dir: -1 | 1): NavOrder {
  const flat = flatten(order);
  const from = flat.indexOf(room);
  if (from < 0) return order;
  return unflatten(placeAt(flat, room, from + dir));
}

/** Whether two orders are the same. */
export function sameOrder(a: NavOrder, b: NavOrder): boolean {
  return flatten(a).join() === flatten(b).join();
}

/** How many recent chats fit cleanly in `height` px, leaving room for the
 *  heading and the View all row. Never negative, never more than there are. */
export function recentFit(height: number, rowHeight: number, reserved: number, total: number) {
  if (!(height > 0) || !(rowHeight > 0)) return 0;
  return Math.max(0, Math.min(total, Math.floor((height - reserved) / rowHeight)));
}
