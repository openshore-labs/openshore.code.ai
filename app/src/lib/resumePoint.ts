// Where the person was, kept so a cold start (the system reclaimed the app in
// the background) puts them back in the same chat and skips the long opening
// splash. Only the open chat is remembered; a room, a sheet or a draft is not.
// localStorage on purpose: main.tsx reads it before the store exists, and a
// blocked or empty store just means a normal opening.

const KEY = 'oscode.resume.v1';

/** How long a remembered chat counts as "just now". Past it, a launch is a
 *  fresh one with the full opening. */
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

/** The unhurried opening, and the quick one for a return. */
export const SPLASH_HOLD_MS = 2700;
export const SPLASH_RETURN_MS = 350;

export interface ResumePoint {
  /** The open chat, if one was open. */
  activeId?: string;
  at: number;
}

export function saveResumePoint(activeId: string | undefined, now = Date.now()): void {
  try {
    const point: ResumePoint = { ...(activeId ? { activeId } : {}), at: now };
    localStorage.setItem(KEY, JSON.stringify(point));
  } catch {
    // Storage blocked or full: the next launch simply opens normally.
  }
}

export function readResumePoint(now = Date.now()): ResumePoint | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Partial<ResumePoint>;
    if (typeof p.at !== 'number' || now - p.at > RESUME_WINDOW_MS || p.at > now + 60_000) {
      return undefined;
    }
    return {
      at: p.at,
      ...(typeof p.activeId === 'string' ? { activeId: p.activeId } : {}),
    };
  } catch {
    return undefined;
  }
}

/** How long the boot splash holds: short on a return, full on a fresh start. */
export function splashHoldMs(now = Date.now()): number {
  return readResumePoint(now) ? SPLASH_RETURN_MS : SPLASH_HOLD_MS;
}
