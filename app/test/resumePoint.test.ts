import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESUME_WINDOW_MS,
  SPLASH_HOLD_MS,
  SPLASH_RETURN_MS,
  readResumePoint,
  saveResumePoint,
  splashHoldMs,
} from '../src/lib/resumePoint.js';

const mem = new Map<string, string>();

describe('resume point', () => {
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
  });

  it('holds the full splash on a fresh start', () => {
    expect(splashHoldMs()).toBe(SPLASH_HOLD_MS);
  });

  it('returns to the open chat soon after, with a quick splash', () => {
    saveResumePoint('c1', 1_000);
    expect(readResumePoint(2_000)?.activeId).toBe('c1');
    expect(splashHoldMs(2_000)).toBe(SPLASH_RETURN_MS);
  });

  it('forgets a point older than the window', () => {
    saveResumePoint('c1', 1_000);
    expect(readResumePoint(1_000 + RESUME_WINDOW_MS + 1)).toBeUndefined();
  });

  it('ignores damaged storage', () => {
    mem.set('oscode.resume.v1', '{nope');
    expect(readResumePoint()).toBeUndefined();
  });
});
