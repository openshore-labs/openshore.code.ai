// One place that reads the motion vocabulary out of the stylesheet, so a timer
// in TypeScript and a transition in CSS never carry two copies of the same
// number. theme.css :root is the source of truth; the fallbacks here only
// cover a test runner with no document, or a viewer too old for @property.

function rootStyle(): CSSStyleDeclaration | null {
  return typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
}

/** A duration token (`--dur-4`) in milliseconds. */
export function durationMs(token: string, fallback: number): number {
  const raw = rootStyle()?.getPropertyValue(token).trim() ?? '';
  const m = raw.match(/^(\d*\.?\d+)(ms|s)$/);
  if (!m) return fallback;
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : n;
}

/** An easing token (`--ease-arrive`) as a cubic-bezier string, for the Web
 *  Animations API. CSS keeps referencing the var directly; a scripted animation
 *  reads the same curve here so the two never carry two copies of it. */
export function easing(token: string, fallback: string): string {
  const raw = rootStyle()?.getPropertyValue(token).trim();
  return raw && raw.length ? raw : fallback;
}

/** Whether the viewer has asked for reduced motion. A scripted animation must
 *  check this itself; the global CSS `*` reset only reaches CSS animations. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** How long the drawer stays mounted after it is asked to close: the door's
 *  clock (`--dur-7`) plus a hair, so the glide's decelerating tail is never
 *  clipped by the unmount. The gesture hook holds the finger's position for
 *  the same length, so a drag-to-close (which finishes sooner, on its own
 *  velocity clock) never loses its keyframe start mid-hold. */
export function drawerExitMs(): number {
  return doorExitMs();
}

/** The same hold for a sheet: it slides on the door clock too (theme.css
 *  `.sheet`), so useSheetExit and Sheet.tsx keep it mounted this long. */
export function sheetExitMs(): number {
  return doorExitMs();
}

/** The door clock plus a hair, the hold for any surface that crosses the
 *  screen on --dur-7. */
export function doorExitMs(): number {
  return durationMs('--dur-7', 520) + 20;
}

/** The drawer's rendered width in px. `--drawer-width` is registered as a
 *  `<length>` (theme.css @property), so its computed value comes back already
 *  resolved to pixels for the current viewport. */
export function drawerWidth(): number {
  const px = parseFloat(rootStyle()?.getPropertyValue('--drawer-width') ?? '');
  if (Number.isFinite(px) && px > 0) return px;
  // No @property support: mirror the stylesheet's min(310px, 84vw).
  return typeof window === 'undefined' ? 310 : Math.min(310, window.innerWidth * 0.84);
}
