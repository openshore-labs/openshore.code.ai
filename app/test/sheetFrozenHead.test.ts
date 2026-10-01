// Every sheet keeps its top in view (founder, 2026-10-01): the grabber and the
// header row (the round close and the title) are frozen, and only what is under
// the hairline scrolls, so the way out is always on screen.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const theme = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');
const rule = (selector: string) => {
  const at = theme.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return theme.slice(at, theme.indexOf('}', at));
};

describe('a sheet header stays put while the sheet scrolls', () => {
  it('pins the header row and the grabber to the top of the card', () => {
    for (const sel of ['.sheet:not(.top) > .mode-head', '.sheet:not(.top) > .sheet-grabber']) {
      const r = rule(sel);
      expect(r).toMatch(/position: sticky/);
      expect(r).toMatch(/top: -18px/);
      expect(r).toMatch(/background: var\(--bg-raised\)/);
    }
  });

  it('sets the header under the grabber, and at the top where there is none', () => {
    expect(rule('.sheet:not(.top) > .sheet-grabber + .mode-head')).toMatch(/top: 14px/);
    expect(theme).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.sheet:not\(\.top\) > \.sheet-grabber \+ \.mode-head \{\s*top: -18px/,
    );
  });

  it('keeps the card itself the scroller the header sticks in', () => {
    expect(rule('.sheet')).toMatch(/overflow-y: auto/);
  });
});
