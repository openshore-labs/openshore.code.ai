// Where the person was, kept so a cold start the person did not ask for (the
// system reclaimed the app in the background) puts them back in the same chat
// and skips the long opening splash. Only the open chat is remembered; a room,
// a sheet or a draft is not. localStorage on purpose: main.tsx reads it before
// the store exists, and a blocked or empty store just means a normal opening.
//
// Three rules (founder, 2026-10-12):
// - The clock runs from when the person left, not from the last chat switch:
//   the point is stamped again every time the app goes to the background.
// - A deliberate Quit on the desktop opens fresh: the main process marks it
//   and the page reads `afterQuit` from the bridge.
// - The iPhone cannot tell a swipe away from the system reclaiming the app,
//   so its window is short: a quick return is resumed, a later one is fresh.

import type { Platform } from './platform.js';

const KEY = 'oscode.resume.v1';

/** How long a remembered chat counts as "just now", per platform. Past it, a
 *  launch is a fresh one with the full opening. The desktop's cold starts are
 *  a crash or a reboot (a Quit is fresh), so it keeps the long window. */
export const RESUME_WINDOW_MS: Record<Platform, number> = {
  ios: 30 * 60 * 1000,
  electron: 12 * 60 * 60 * 1000,
  web: 12 * 60 * 60 * 1000,
};

/** The unhurried opening, and the quick one for a return. */
export const SPLASH_HOLD_MS = 2700;
export const SPLASH_RETURN_MS = 350;

export interface ResumePoint {
  /** The open chat, if one was open. */
  activeId?: string;
  at: number;
}

function write(point: ResumePoint): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(point));
  } catch {
    // Storage blocked or full: the next launch simply opens normally.
  }
}

function readRaw(): ResumePoint | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Partial<ResumePoint>;
    if (typeof p.at !== 'number') return undefined;
    return { at: p.at, ...(typeof p.activeId === 'string' ? { activeId: p.activeId } : {}) };
  } catch {
    return undefined;
  }
}

/** The open chat changed: remember it, as of now. */
export function saveResumePoint(activeId: string | undefined, now = Date.now()): void {
  write({ ...(activeId ? { activeId } : {}), at: now });
}

/** The app is going to the background: restart the clock on what is open. */
export function stampResumePoint(now = Date.now()): void {
  const p = readRaw();
  write({ ...(p?.activeId ? { activeId: p.activeId } : {}), at: now });
}

/** Forget the point, so the next launch opens fresh. */
export function clearResumePoint(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Whether the run before this one ended in a deliberate Quit (desktop). */
function launchedAfterQuit(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as { oscode?: { afterQuit?: boolean } }).oscode?.afterQuit === true
  );
}

export function readResumePoint(platform: Platform, now = Date.now()): ResumePoint | undefined {
  if (launchedAfterQuit()) {
    clearResumePoint();
    return undefined;
  }
  const p = readRaw();
  if (!p) return undefined;
  if (now - p.at > RESUME_WINDOW_MS[platform] || p.at > now + 60_000) return undefined;
  return p;
}

/** How long the boot splash holds: short on a return, full on a fresh start. */
export function splashHoldMs(platform: Platform, now = Date.now()): number {
  return readResumePoint(platform, now) ? SPLASH_RETURN_MS : SPLASH_HOLD_MS;
}
