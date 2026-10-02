// A focused field rests just above the on-screen keyboard (founder,
// 2026-10-02: the Cloud Connections key field sat under the keyboard).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REVEAL_GAP, revealDelta } from '../src/lib/revealField.js';

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

describe('the room makes space under the keyboard', () => {
  const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  it('pads a room by the keyboard while it is open', () => {
    expect(theme).toMatch(
      /:root\.kb-open \.screen > \.screen-inner \{\s*padding-bottom: calc\(var\(--kb-inset, 0px\) \+ 24px\);/,
    );
  });
  it('scrolls the field to just above the keyboard, not to the centre', () => {
    expect(app).toContain('scrollParentOf(el).scrollBy');
    expect(app).not.toMatch(/scrollIntoView\(\{ block: 'center'/);
  });
});
