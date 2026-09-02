// Sheets behave like dialogs: focus wraps inside the open one. The wrap logic
// is pure so it is pinned here, and the App must wire the trap (a sheet that
// lets Tab escape onto the page behind it is the bug this closes).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextFocus } from '../src/hooks/useSheetFocusTrap.js';

const el = (id: string) => ({ id }) as unknown as HTMLElement;

describe('sheet focus trap', () => {
  const a = el('a');
  const b = el('b');
  const c = el('c');

  it('wraps forward from the last control to the first', () => {
    expect(nextFocus([a, b, c], c, false)).toBe(a);
    expect(nextFocus([a, b, c], a, false)).toBe(b);
  });

  it('wraps backward from the first control to the last', () => {
    expect(nextFocus([a, b, c], a, true)).toBe(c);
    expect(nextFocus([a, b, c], c, true)).toBe(b);
  });

  it('enters at the first (or last, going backward) when focus is outside the sheet', () => {
    expect(nextFocus([a, b, c], null, false)).toBe(a);
    expect(nextFocus([a, b, c], null, true)).toBe(c);
    expect(nextFocus([], null, false)).toBeUndefined();
  });

  it('is wired at the app root so every sheet is covered', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('useSheetFocusTrap()');
  });
});
