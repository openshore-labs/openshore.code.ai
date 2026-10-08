// Every sheet keeps its top in view (founder, 2026-10-01): the grabber and the
// header row (the round close and the title) are frozen, and only what is under
// the hairline scrolls, so the way out is always on screen. The offsets ride
// the sheet's padding, which is the page gutter since D22 (2026-10-07).
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
      expect(r).toMatch(/top: calc\(-1 \* var\(--gutter\)\)/);
      expect(r).toMatch(/background: var\(--bg-raised\)/);
    }
  });

  it('sets the header under the grabber, and at the top where there is none', () => {
    // The grabber is 32px tall, so the head pins 32px down, less the padding.
    expect(rule('.sheet:not(.top) > .sheet-grabber + .mode-head')).toMatch(
      /top: calc\(32px - var\(--gutter\)\)/,
    );
    expect(theme).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.sheet:not\(\.top\) > \.sheet-grabber \+ \.mode-head \{\s*top: calc\(-1 \* var\(--gutter\)\)/,
    );
  });

  it('keeps the card itself the scroller the header sticks in', () => {
    expect(rule('.sheet')).toMatch(/overflow-y: auto/);
  });
});
