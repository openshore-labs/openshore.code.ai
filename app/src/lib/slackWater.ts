// Slack Water (Creative Studio, 2026-10-01; docs/slack-water.md): the
// one-time transition from the setup walk's chat to the main chat page, when
// the person chooses to just chat at the break. Slack water is the still
// moment at the turn of the tide, when the current stops pulling either way:
// setup lets go, and the room they will live in arrives underneath.
//
// The third pass (founder, 2026-10-02): the water is clear. Nothing floods the
// screen. A train of ripples leaves the tap and crosses the app itself; each
// of the room's blocks heaves as a crest passes under it, the old chat thins
// away beneath the water, and the greeting surfaces as it settles.
//
// This file is the pure part: the geometry, the clocks, and the shape of the
// water at any moment. The store raises it (state/store.ts carryToGreeting),
// components/SlackWater.tsx plays it, and lib/rippleGl.ts draws each frame.

/** The beat between the guide's line settling and the water starting: enough
 *  to see the line land, short enough that the tap still feels answered
 *  (founder, 2026-10-02: the old three-second read pause felt like a stall). */
export const WATER_AFTER_LINE_MS = 300;

/** The touch: the surface dips where the finger was before a crest leaves. */
export const DIP_MS = 120;
/** The dimple's release, after which only the train is moving. */
export const DIP_RELEASE_MS = 240;
/** The leading crest's trip from the tap to the farthest corner. */
export const FRONT_MS = 1100;
/** How the front slows as it spreads: it leaves at (1 + k) times its mean
 *  speed and reaches the corner at (1 - k), the way a ring loses energy. */
export const FRONT_EASE = 0.5;
/** How many wavelengths the train carries behind its leading crest. */
export const TRAIN_WAVES = 9;
/** The crests drift back through the train one wavelength in this long, so
 *  the rings flow instead of sliding out as one rigid stamp. */
export const FLOW_MS = 650;
/** The water's energy halves in about this long (an exponential's time
 *  constant), so later rings are fainter than the first. */
export const DECAY_MS = 1500;
/** The last of the water fades out over this long, ending at WATER_MS. */
export const SETTLE_MS = 450;
/** The whole play, the touch to still water. */
export const WATER_MS = 2300;

/** The old room starts to thin once the front is this far to the corner. */
export const THIN_AT_REACH = 0.5;

/** How far a block heaves at the tap, in CSS pixels; it weakens with distance
 *  the way a ring's height does. */
export const HEAVE_PX = 6;
/** One block's heave: the train passing under it, crest to calm. */
export const HEAVE_MS = 1200;

/** The swap never waits longer than this, whatever the thinning's clock says,
 *  so no one is ever left looking at an empty room. */
export const SWAP_BACKSTOP_MS = 2000;

export interface SlackWaterGeometry {
  /** The ripple rings' diameter: the distance to the farthest corner, twice. */
  ring: number;
  /** The distance to the farthest corner (the rings' radius). */
  reach: number;
}

/** Sizes for a ripple centred on (x, y) in a vw by vh window. */
export function slackWaterGeometry(
  x: number,
  y: number,
  vw: number,
  vh: number,
): SlackWaterGeometry {
  const r = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)) + 2;
  return { ring: 2 * r, reach: r };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (n: number) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};

/** The leading crest's radius at time t (ms since the water started), for a
 *  reach of R pixels. It holds at the tap through the dip, eases out to the
 *  corner on FRONT_MS, then carries on past it at its arriving speed. */
export function frontRadius(t: number, R: number): number {
  const u = (t - DIP_MS) / FRONT_MS;
  if (u <= 0) return 0;
  const k = FRONT_EASE;
  if (u <= 1) return R * (u + k * u * (1 - u));
  return R * (1 + (1 - k) * (u - 1));
}

/** When the leading crest reaches a point d pixels from the tap: the inverse
 *  of frontRadius. */
export function reachMs(d: number, R: number): number {
  if (R <= 0 || d <= 0) return DIP_MS;
  const x = d / R;
  const k = FRONT_EASE;
  if (x >= 1) return DIP_MS + FRONT_MS * (1 + (x - 1) / (1 - k));
  // k u^2 - (1 + k) u + x = 0, the root in [0, 1].
  const u = (1 + k - Math.sqrt((1 + k) ** 2 - 4 * k * x)) / (2 * k);
  return DIP_MS + u * FRONT_MS;
}

/** The ripples' wavelength for a reach: longer on a bigger window, never so
 *  fine it shimmers or so broad it reads as a swell. */
export function wavelength(R: number): number {
  return Math.min(40, Math.max(20, R * 0.048));
}

/** The water at one moment, everything the renderer needs. */
export interface WaterFrame {
  /** The leading crest's radius, CSS pixels. */
  front: number;
  /** The distance between crests, CSS pixels; it lengthens as the rings spread. */
  lambda: number;
  /** How far the train reaches behind its front, CSS pixels. */
  train: number;
  /** The crests' drift back through the train, radians. */
  phase: number;
  /** The train's strength, 0 to 1: it loses energy and finally settles. */
  amp: number;
  /** The touch's dimple, 0 to 1. */
  dip: number;
}

export function waterFrame(t: number, R: number): WaterFrame {
  const lambda = wavelength(R) * (1 + 0.35 * clamp01(t / (DIP_MS + FRONT_MS)));
  const dip = t <= DIP_MS ? smooth(t / DIP_MS) : 1 - smooth((t - DIP_MS) / DIP_RELEASE_MS);
  const settle = 1 - smooth((t - (WATER_MS - SETTLE_MS)) / SETTLE_MS);
  return {
    front: frontRadius(t, R),
    lambda,
    train: TRAIN_WAVES * lambda,
    phase: (2 * Math.PI * Math.max(0, t)) / FLOW_MS,
    amp: Math.exp(-Math.max(0, t) / DECAY_MS) * settle,
    dip: Math.max(0, dip),
  };
}

/** One block's heave: when the train reaches it and how far it moves. */
export function heaveFor(d: number, R: number): { delay: number; px: number } {
  return {
    delay: reachMs(d, R),
    px: HEAVE_PX * Math.sqrt(0.25 / (0.25 + d / Math.max(1, R))),
  };
}

/** The heave's shape: out with the crest, back through the trough, settling.
 *  Offsets along the line away from the tap (in heave pixels) and the radial
 *  stretch a crest's lens gives the block under it. */
export const HEAVE_KEYS: ReadonlyArray<{ at: number; push: number; stretch: number }> = [
  { at: 0, push: 0, stretch: 0 },
  { at: 0.16, push: 1, stretch: 0.022 },
  { at: 0.36, push: -0.62, stretch: -0.014 },
  { at: 0.56, push: 0.34, stretch: 0.008 },
  { at: 0.78, push: -0.12, stretch: -0.003 },
  { at: 1, push: 0, stretch: 0 },
];

/** When the old room starts to thin, in ms since the water started. */
export function thinAtMs(R: number): number {
  return reachMs(THIN_AT_REACH * R, R);
}
