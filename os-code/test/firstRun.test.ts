// The first five minutes: npm install, osc init, osc. These hold the seams a
// first-time user hit on a light terminal (2026-10-29): wizard text painted
// paper-white vanished, the Pocket phone preset sat in a desktop picker, and
// the closing step was a placeholder that failed when pasted.
import { afterEach, describe, expect, it } from 'vitest';
import { setColorEnabled, t, TOKENS } from '../src/brand/theme.js';
import { desktopPresets, nextSteps } from '../src/commands/init.js';
import type { CatalogPreset } from '../src/market/schema.js';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

afterEach(() => setColorEnabled(undefined));

describe('terminal colors read on a light or a dark background', () => {
  it('leaves primary text to the terminal foreground', () => {
    expect(TOKENS.text).toBeUndefined();
    setColorEnabled(true);
    expect(t.text('hello')).toBe('hello');
  });

  it('keeps every painted token at 2.6:1 or better on white and on near-black', () => {
    for (const [name, hex] of Object.entries(TOKENS)) {
      if (!hex || name === 'bg') continue;
      expect(contrast(hex, '#FFFFFF'), `${name} on white`).toBeGreaterThanOrEqual(2.6);
      expect(contrast(hex, '#1E1E1E'), `${name} on dark`).toBeGreaterThanOrEqual(2.6);
    }
  });
});

describe('osc init', () => {
  const preset = (id: string, minVramGB: number): CatalogPreset => ({
    id,
    name: id,
    tagline: id,
    minVramGB,
    stack: { orchestrator: 'x', specialists: {} },
  });

  it('leaves the phone preset out of the desktop picker, smallest first', () => {
    const ids = desktopPresets([
      preset('coding', 12),
      preset('pocket', 0),
      preset('starter', 0),
    ]).map((p) => p.id);
    expect(ids).toEqual(['starter', 'coding']);
  });

  it('ends with commands that run as typed, no placeholder', () => {
    for (const running of [true, false]) {
      const text = nextSteps(running).join('\n');
      expect(text).not.toMatch(/your-project/);
      expect(text).toMatch(/mkdir hello && cd hello && osc/);
      expect(text).not.toMatch(/osc market/);
    }
    expect(nextSteps(false).join('\n')).toMatch(/osc doctor/);
  });
});
