// The "OpenShore team" label on a review (tech review 11 package B) is small text
// (--text-1, 11px), so it needs WCAG AA's 4.5:1 against the surfaces a review
// sits on, in both themes. The port once gave it --wave, a fill teal that
// reads about 3.3:1 on --bg and 3.0:1 on --surface in the light theme
// (review 2026-09-30); --wave-ink is the same teal deepened for text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');

/** The body of the first rule whose selector line starts with `head`. */
function block(head: string): string {
  const start = css.indexOf(head);
  expect(start, head).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed ${head}`);
}

function token(body: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(body)?.[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const staffColor = /color:\s*var\((--[a-z-]+)\)/.exec(block('.review-staff {'))?.[1];

const light = block(':root {');
const darkMedia = block(":root:not([data-theme='light'])");
const darkToggle = block(":root[data-theme='dark']");

describe('the OpenShore team label on a review', () => {
  for (const [theme, body] of [
    ['light', light],
    ['dark (system)', darkMedia],
    ['dark (toggle)', darkToggle],
  ] as const) {
    it(`reads at 4.5:1 or better on --bg and --surface, ${theme}`, () => {
      expect(staffColor).toBeDefined();
      const fg = token(body, staffColor!) ?? token(light, staffColor!);
      expect(fg, `${staffColor} in ${theme}`).toBeDefined();
      for (const bg of ['--bg', '--surface']) {
        const back = token(body, bg) ?? token(light, bg);
        expect(back, `${bg} in ${theme}`).toBeDefined();
        expect(contrast(fg!, back!), `${staffColor} on ${bg}, ${theme}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }
});
