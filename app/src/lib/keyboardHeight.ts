// The on-screen keyboard's height, remembered on the device. The Keyboard
// plugin hands the exact height over on keyboardWillShow, and the composer
// lifts by it (hooks/useKeyboardInset.ts). The fallback needs that number when
// the plugin has not just said it: it lifts a focused composer anyway when no
// show event arrives in time (founder, 2026-09-03: the keyboard rose over the
// text box after Chats, then a chat, then a tap). A keyboard's height is
// stable per device and orientation, so the last real reading is the right
// guess (one per orientation), and a phone-sized
// default covers the first focus before any reading exists.
//
// Device-local by design: nothing here is a preference or customization.

const KEY = 'oscode.keyboardHeight';

/** A portrait iPhone keyboard with the QuickType bar, near enough on most
 *  models (336pt on the 6.1-inch phones; a compact phone gets a small gap). */
export const DEFAULT_KEYBOARD_HEIGHT = 336;

/** A landscape iPhone keyboard, for the first landscape focus before any
 *  landscape reading exists. */
export const DEFAULT_LANDSCAPE_KEYBOARD_HEIGHT = 208;

/** The smallest height a real keyboard reports; below it is a stray zero or
 *  an accessory bar alone, never worth remembering or lifting for. */
export const MIN_REAL_HEIGHT = 120;

/** How long a bare accessory-bar reading waits for the full keyboard's own
 *  event before it is taken as the truth (a hardware keyboard: only the
 *  shortcut bar shows, and no bigger reading ever follows). */
export const HARDWARE_SETTLE_MS = 600;

export type KeyboardOrientation = 'portrait' | 'landscape';

/** Which keyboard this is: a landscape keyboard is far shorter, so each
 *  orientation keeps its own reading (one number would let a landscape
 *  reading short-lift the portrait composer). */
export function currentOrientation(): KeyboardOrientation {
  if (typeof window === 'undefined') return 'portrait';
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

const cached: Partial<Record<KeyboardOrientation, number>> = {};
const storageKey = (o: KeyboardOrientation) => (o === 'portrait' ? KEY : `${KEY}.${o}`);
const fallbackFor = (o: KeyboardOrientation) =>
  o === 'portrait' ? DEFAULT_KEYBOARD_HEIGHT : DEFAULT_LANDSCAPE_KEYBOARD_HEIGHT;

/** Remember a height the plugin reported, when it is a real keyboard's. */
export function rememberKeyboardHeight(
  height: number,
  orientation: KeyboardOrientation = currentOrientation(),
): void {
  if (!(height >= MIN_REAL_HEIGHT)) return;
  cached[orientation] = height;
  try {
    localStorage.setItem(storageKey(orientation), String(Math.round(height)));
  } catch {
    // Storage may be unavailable (private mode); the in-memory copy still serves.
  }
}

/** The best known keyboard height for this orientation: the last real
 *  reading, else the default. */
export function knownKeyboardHeight(
  orientation: KeyboardOrientation = currentOrientation(),
): number {
  const hit = cached[orientation];
  if (hit !== undefined) return hit;
  try {
    const stored = Number(localStorage.getItem(storageKey(orientation)));
    if (stored >= MIN_REAL_HEIGHT) {
      cached[orientation] = stored;
      return stored;
    }
  } catch {
    // fall through to the default
  }
  return fallbackFor(orientation);
}

/**
 * The inset to lift the composer by when a show event reports `reported`.
 * A real height wins and is remembered; a stray zero or an accessory bar
 * alone (iOS sometimes announces the bar's frame first) lifts by the last
 * known height instead, so a bad reading never leaves the field covered. A
 * bar reading that is never followed by a full one is a hardware keyboard,
 * which the inset hook settles to after HARDWARE_SETTLE_MS.
 */
export function insetForShow(reported: number, known: number = knownKeyboardHeight()): number {
  return reported >= MIN_REAL_HEIGHT ? reported : known;
}

/** A hardware keyboard shows only its shortcut bar (or nothing): a positive
 *  reading below a real keyboard's. */
export function isHardwareBarReading(reported: number): boolean {
  return reported > 0 && reported < MIN_REAL_HEIGHT;
}

/** Test seam: forget the cached readings. */
export function resetKeyboardHeightCache(): void {
  delete cached.portrait;
  delete cached.landscape;
}
