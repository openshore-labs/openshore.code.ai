// A quick return resumes the open chat behind a short splash; a Quit, a long
// absence or (on the iPhone) more than half an hour away opens fresh
// (founder, 2026-10-12).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeQuitMarker, writeQuitMarker } from '../electron/lifecycle.js';
import {
  RESUME_WINDOW_MS,
  SPLASH_HOLD_MS,
  SPLASH_RETURN_MS,
  readResumePoint,
  saveResumePoint,
  splashHoldMs,
  stampResumePoint,
} from '../src/lib/resumePoint.js';

const mem = new Map<string, string>();
const MIN = 60_000;

describe('resume point', () => {
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    vi.stubGlobal('window', {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds the full splash on a fresh start', () => {
    expect(splashHoldMs('ios')).toBe(SPLASH_HOLD_MS);
  });

  it('returns to the open chat soon after, with a quick splash', () => {
    saveResumePoint('c1', 1_000);
    expect(readResumePoint('electron', 2_000)?.activeId).toBe('c1');
    expect(splashHoldMs('ios', 2_000)).toBe(SPLASH_RETURN_MS);
  });

  it('gives the iPhone half an hour and the desktop twelve hours', () => {
    expect(RESUME_WINDOW_MS.ios).toBe(30 * MIN);
    expect(RESUME_WINDOW_MS.electron).toBe(12 * 60 * MIN);
    saveResumePoint('c1', 0);
    expect(readResumePoint('ios', 31 * MIN)).toBeUndefined();
    expect(readResumePoint('electron', 31 * MIN)?.activeId).toBe('c1');
  });

  it('counts from when the person left, not from the last chat switch', () => {
    saveResumePoint('c1', 0);
    // Hours in the same chat, then the app goes to the background.
    stampResumePoint(5 * 60 * MIN);
    expect(readResumePoint('ios', 5 * 60 * MIN + 10 * MIN)?.activeId).toBe('c1');
  });

  it('opens fresh after a deliberate Quit, and forgets the chat', () => {
    saveResumePoint('c1', 1_000);
    vi.stubGlobal('window', { oscode: { afterQuit: true } });
    expect(splashHoldMs('electron', 2_000)).toBe(SPLASH_HOLD_MS);
    vi.stubGlobal('window', {});
    expect(readResumePoint('electron', 2_000)).toBeUndefined();
  });

  it('ignores damaged storage', () => {
    mem.set('oscode.resume.v1', '{nope');
    expect(readResumePoint('web')).toBeUndefined();
  });
});

describe('the quit marker', () => {
  it('is left by Quit and counts once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osc-quit-'));
    try {
      expect(takeQuitMarker(dir)).toBe(false);
      writeQuitMarker(dir);
      expect(takeQuitMarker(dir)).toBe(true);
      expect(takeQuitMarker(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
