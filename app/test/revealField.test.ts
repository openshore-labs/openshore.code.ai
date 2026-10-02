// A focused field rests just above the on-screen keyboard (founder,
// 2026-10-02: the Cloud Connections key field sat under the keyboard).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REVEAL_GAP, revealDelta, revealPlan } from '../src/lib/revealField.js';

describe('revealDelta', () => {
  it('lifts a covered field to sit the gap above the keyboard', () => {
    // 852 tall, a 336 keyboard: the visible bottom is 516, minus the gap.
    expect(revealDelta(700, 852, 336)).toBe(700 - (852 - 336 - REVEAL_GAP));
  });
  it('leaves a field already clear of the keyboard alone', () => {
    expect(revealDelta(400, 852, 336)).toBe(0);
  });
  it('does nothing with no keyboard up', () => {
    expect(revealDelta(800, 852, 0)).toBe(0);
  });
});

// The field and its Save rise together where the form asks (CX, 2026-10-02).
describe('revealPlan', () => {
  const base = { viewTop: 60, viewportHeight: 852, inset: 336 };
  it('lifts a field with no marked action exactly as before', () => {
    expect(revealPlan({ ...base, fieldTop: 650, fieldBottom: 700 })).toBe(
      revealDelta(700, 852, 336),
    );
  });
  it('lifts the field and its action together when both fit', () => {
    const d = revealPlan({ ...base, fieldTop: 650, fieldBottom: 700, actionBottom: 770 });
    expect(d).toBe(revealDelta(770, 852, 336));
    expect(650 - d).toBeGreaterThanOrEqual(60 + REVEAL_GAP);
  });
  it('keeps the field in view when the action cannot fit too', () => {
    const d = revealPlan({ ...base, fieldTop: 300, fieldBottom: 350, actionBottom: 900 });
    expect(300 - d).toBe(60 + REVEAL_GAP);
    expect(d).toBeGreaterThanOrEqual(revealDelta(350, 852, 336));
  });
});

describe('the room makes space under the keyboard', () => {
  const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  it('pads a room by the keyboard while it is open', () => {
    expect(theme).toMatch(
      /:root\.kb-open \.screen > \.screen-inner \{\s*padding-bottom: calc\(var\(--kb-inset, 0px\) \+ 24px\);/,
    );
  });
  it('scrolls the field to just above the keyboard, not to the centre', () => {
    expect(app).toContain('scroller.scrollBy({ top: delta');
    expect(app).not.toMatch(/scrollIntoView\(\{ block: 'center'/);
  });
  it('marks the Cloud Connections key form and its Save', () => {
    const conn = readFileSync(
      new URL('../src/screens/ConnectionsScreen.tsx', import.meta.url),
      'utf8',
    );
    expect(conn).toContain('data-reveal-with');
    expect(conn).toContain('data-reveal-primary');
    expect(conn).toContain('enterKeyHint="go"');
  });
});
