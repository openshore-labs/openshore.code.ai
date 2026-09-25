// The chat box review, second pass (founder, 2026-09-25: "fix all of the
// findings"): hardware keyboards, per-orientation keyboard height, sheets over
// the keyboard, video that can be stopped and never hangs, colour meaning on
// the composer pills, and the model sheet's honest favorites.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_KEYBOARD_HEIGHT,
  DEFAULT_LANDSCAPE_KEYBOARD_HEIGHT,
  isHardwareBarReading,
  knownKeyboardHeight,
  rememberKeyboardHeight,
  resetKeyboardHeightCache,
} from '../src/lib/keyboardHeight.js';
import { IMAGE_REDRAW_BYTES, sendsAsIs } from '../src/lib/attachments.js';
import { sourcePlace } from '../src/state/types.js';

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('keyboard height, per orientation', () => {
  beforeEach(() => {
    resetKeyboardHeightCache();
    try {
      localStorage.clear();
    } catch {
      // in-memory path
    }
  });

  it('keeps portrait and landscape readings apart', () => {
    expect(knownKeyboardHeight('landscape')).toBe(DEFAULT_LANDSCAPE_KEYBOARD_HEIGHT);
    rememberKeyboardHeight(200, 'landscape');
    expect(knownKeyboardHeight('portrait')).toBe(DEFAULT_KEYBOARD_HEIGHT);
    rememberKeyboardHeight(346, 'portrait');
    expect(knownKeyboardHeight('landscape')).toBe(200);
    expect(knownKeyboardHeight('portrait')).toBe(346);
  });

  it('reads a bare shortcut bar as a possible hardware keyboard, never a zero', () => {
    expect(isHardwareBarReading(55)).toBe(true);
    expect(isHardwareBarReading(0)).toBe(false);
    expect(isHardwareBarReading(336)).toBe(false);
  });

  it('the hook settles to the bar when no full keyboard follows, and stands the fallback down', () => {
    const hook = read('hooks/useKeyboardInset.ts');
    expect(hook).toMatch(
      /settleTimer = window\.setTimeout\(\(\) => \{[\s\S]*?hardware = true;[\s\S]*?lift\(reported\)/,
    );
    expect(hook).toMatch(/if \(hardware\) return;/);
  });
});

describe('sheets and the keyboard', () => {
  it('a sheet stands on the keyboard and fits the room above it', () => {
    const theme = read('theme.css');
    expect(theme).toMatch(/:root\.kb-open \.sheet-scrim \{\s*padding-bottom: var\(--kb-inset/);
    expect(theme).toMatch(/:root\.kb-open \.sheet \{\s*max-height: calc\(100dvh - var\(--kb-inset/);
  });

  it('field centering reads the inset the composer lifts by', () => {
    expect(read('App.tsx')).toMatch(/getPropertyValue\('--kb-inset'\)/);
  });
});

describe('video', () => {
  afterEach(() => vi.useRealTimers());

  it('a hung native call fails plainly instead of holding send forever', async () => {
    vi.useFakeTimers();
    const { withTimeout } = await import('../src/lib/videoBackends.js');
    const hung = withTimeout(new Promise<never>(() => {}), 1000);
    vi.advanceTimersByTime(1001);
    await expect(hung).rejects.toThrow('took too long');
  });

  it('a reading video can be stopped, and an oversized one is refused on the phone', () => {
    const composer = read('components/Composer.tsx');
    expect(composer).toMatch(/aria-label=\{`Stop reading \$\{job\.name\}`\}/);
    expect(composer).toMatch(/cancelledJobs\.current\.has\(jobId\)/);
    expect(composer).toMatch(/file\.size > PHONE_VIDEO_MAX_BYTES/);
  });
});

describe('images', () => {
  it('an oversized photo is redrawn smaller, a normal one goes as it is', () => {
    expect(sendsAsIs({ type: 'image/jpeg', size: 1_000_000 })).toBe(true);
    expect(sendsAsIs({ type: 'image/jpeg', size: IMAGE_REDRAW_BYTES + 1 })).toBe(false);
    expect(sendsAsIs({ type: 'image/heic', size: 1_000 })).toBe(false);
  });
});

describe('colour meaning on the composer', () => {
  it('the model pill shows where the answer comes from', () => {
    expect(sourcePlace({ kind: 'cloud', provider: 'anthropic', model: 'x' })).toBe('cloud');
    expect(sourcePlace({ kind: 'device', modelId: 'harbor', modelName: 'Harbor' })).toBe('local');
    expect(sourcePlace({ kind: 'stack' })).toBeUndefined();
  });

  it('the mode dot speaks in ink, never teal or amber', () => {
    const theme = read('theme.css');
    expect(theme).toMatch(/\.composer-pill-dot \{[^}]*background: var\(--ink\)/);
    expect(theme).toMatch(
      /mode-bypassPermissions \.composer-pill-dot \{\s*background: var\(--danger\)/,
    );
    expect(theme).not.toMatch(/composer-pill-dot \{[^}]*var\(--(accent|warn|cloud|local)\)/);
  });
});

describe('the model sheet', () => {
  const sheet = read('components/ModelSheet.tsx');

  it('leaving for a setup room plays the exit first', () => {
    expect(sheet).toMatch(/const goto = [\s\S]*?pending\.current = \(\) => \{[\s\S]*?dismiss\(\);/);
  });

  it('a favorite that is not set up is shown quiet, not offered as a pick', () => {
    expect(sheet).toMatch(/onTap=\{\(\) => \(ready \? pick\(src\) : undefined\)\}/);
  });
});

describe('a handed-back message', () => {
  it('returns its folded pastes as chips', () => {
    const composer = read('components/Composer.tsx');
    expect(composer).toMatch(/sent\.body === restore\.text && sent\.pasted\.length/);
  });
});
