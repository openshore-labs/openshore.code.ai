// Slack Water (Creative Studio, 2026-10-01; docs/slack-water.md): the
// one-time transition from the setup walk's chat to the main chat page, when
// the person chooses to just chat at the break. Slack water is the still
// moment at the turn of the tide, when the current stops pulling either way:
// setup lets go, and the room they will live in arrives underneath.
//
// This file is the pure part: the geometry and the backstop clocks. The store
// raises it (state/store.ts carryToGreeting) and components/SlackWater.tsx
// draws it; the motion itself is CSS on the tokens (theme.css .slack-water).

/** How far the solid paper reaches inside the disc's gradient (its wet lip is
 *  the rest), so at full scale the solid core still covers the far corner. */
export const DISC_CORE = 0.86;

/** If the disc's animationend never comes (a backgrounded WebView), the room
 *  swaps anyway once the flood has surely covered: 280ms delay plus 1.1s. */
export const SWAP_BACKSTOP_MS = 1500;
/** And the cover leaves: 220ms of stillness plus the 1s lift, with room. */
export const CLEAR_BACKSTOP_MS = 1400;

export interface SlackWaterGeometry {
  /** The ripple rings' diameter: the distance to the farthest corner, twice. */
  ring: number;
  /** The paper disc's diameter, sized so its solid core covers that corner. */
  disc: number;
}

/** Sizes for a ripple centred on (x, y) in a vw by vh window. */
export function slackWaterGeometry(
  x: number,
  y: number,
  vw: number,
  vh: number,
): SlackWaterGeometry {
  const r = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)) + 2;
  return { ring: 2 * r, disc: (2 * r) / DISC_CORE };
}
