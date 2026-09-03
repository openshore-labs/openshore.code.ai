import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards the motion vocabulary declared in theme.css :root, ported from the
// Uki app's gold-standard test. The tokens give the curve/duration family one
// name each; this pins those names to their canonical values so they cannot
// drift or be quietly deleted. OS Code had ~31 inlined literals (vs Uki's
// ~600), so this ALSO bans the two curves the migration retired: a drifted
// near-duplicate of the iOS standard, and a foreign easing with no home.

const STYLES = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');

const CANON: Record<string, string> = {
  '--ease-standard': 'cubic-bezier(0.32, 0.72, 0, 1)',
  '--ease-arrive': 'cubic-bezier(0.22, 1, 0.36, 1)',
  '--ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  '--ease-accel': 'cubic-bezier(0.4, 0, 1, 1)',
  '--ease-loop': 'cubic-bezier(0.45, 0, 0.55, 1)',
  // The glide: a bezier fit of UIKit's critically damped spring, for a
  // surface that crosses the screen (the drawer). Added 2026-09-03 with a
  // stated reason in theme.css; the family is otherwise closed.
  '--ease-glide': 'cubic-bezier(0.3, 0.1, 0.15, 1)',
  '--dur-1': '120ms',
  '--dur-2': '160ms',
  '--dur-3': '220ms',
  '--dur-4': '280ms',
  '--dur-5': '320ms',
  '--dur-6': '420ms',
  '--dur-7': '520ms',
  '--loop-1': '800ms',
  '--loop-2': '1100ms',
  '--loop-3': '1400ms',
  '--press-scale-btn': '0.96',
  '--press-scale-row': '0.985',
  '--press-scale-tile': '0.94',
};

function norm(s: string | null): string | null {
  return s == null ? s : s.replace(/\s+/g, '');
}

function tokenValue(name: string): string | null {
  const re = new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`);
  const m = STYLES.match(re);
  if (!m) return null;
  return m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

describe('motion tokens', () => {
  it('declares every canonical curve, duration, and press scale with its exact value', () => {
    const wrong: string[] = [];
    for (const [name, expected] of Object.entries(CANON)) {
      const actual = tokenValue(name);
      if (norm(actual) !== norm(expected))
        wrong.push(`${name}: expected "${expected}", got ${actual ?? '(undefined)'}`);
    }
    expect(wrong, wrong.join('\n  ')).toEqual([]);
  });

  it('composes the press-state shorthands from the base tokens (asymmetric on purpose)', () => {
    expect(norm(tokenValue('--press-in'))).toBe(norm('var(--dur-1) var(--ease-accel)'));
    expect(norm(tokenValue('--press-out'))).toBe(norm('260ms var(--ease-spring)'));
  });

  it('has no drifted or foreign easing left inline (migrated to the tokens)', () => {
    // The drifted iOS curve (a typo of the standard) and a foreign easing that
    // crept in must not reappear once migrated.
    expect(STYLES).not.toContain('cubic-bezier(0.32, 0.72, 0.28, 1)');
    expect(STYLES).not.toContain('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });
});
