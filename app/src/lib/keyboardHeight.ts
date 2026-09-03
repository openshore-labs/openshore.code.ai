// The on-screen keyboard's height, remembered on the device. The Keyboard
// plugin hands the exact height over on keyboardWillShow, and the composer
// lifts by it (hooks/useKeyboardInset.ts). Two things need that number when
// the plugin has not just said it: the fallback that lifts a focused composer
// anyway when no show event arrives in time (founder, 2026-09-03: the keyboard
// rose over the text box after Chats, then a chat, then a tap), and the attach
// tray, which takes the keyboard's slot so the composer does not move when the
// keyboard swaps for it. A keyboard's height is stable per device and
// orientation, so the last real reading is the right guess, and a phone-sized
// default covers the first focus before any reading exists.
//
// Device-local by design: nothing here is a preference or customization.

const KEY = 'oscode.keyboardHeight';

/** A portrait iPhone keyboard with the QuickType bar, near enough on most
 *  models (336pt on the 6.1-inch phones; a compact phone gets a small gap). */
export const DEFAULT_KEYBOARD_HEIGHT = 336;

/** The smallest height a real keyboard reports; below it is a stray zero or
 *  an accessory bar alone, never worth remembering or lifting for. */
export const MIN_REAL_HEIGHT = 120;

let cached: number | undefined;

/** Remember a height the plugin reported, when it is a real keyboard's. */
export function rememberKeyboardHeight(height: number): void {
  if (!(height >= MIN_REAL_HEIGHT)) return;
  cached = height;
  try {
    localStorage.setItem(KEY, String(Math.round(height)));
  } catch {
    // Storage may be unavailable (private mode); the in-memory copy still serves.
  }
}

/** The best known keyboard height: the last real reading, else the default. */
export function knownKeyboardHeight(): number {
  if (cached !== undefined) return cached;
  try {
    const stored = Number(localStorage.getItem(KEY));
    if (stored >= MIN_REAL_HEIGHT) {
      cached = stored;
      return stored;
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_KEYBOARD_HEIGHT;
}

/**
 * The inset to lift the composer by when a show event reports `reported`.
 * A real height wins and is remembered; a stray zero or an accessory bar
 * alone (iOS sometimes announces the bar's frame first) lifts by the last
 * known height instead, so a bad reading never leaves the field covered.
 */
export function insetForShow(reported: number, known: number = knownKeyboardHeight()): number {
  return reported >= MIN_REAL_HEIGHT ? reported : known;
}

/** Test seam: forget the cached reading. */
export function resetKeyboardHeightCache(): void {
  cached = undefined;
}
