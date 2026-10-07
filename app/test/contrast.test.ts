// Contrast is a rule, not a look (founder, 2026-10-02: "make sure all of the
// contrast is compliant ... with the background as the anchor"). WCAG 2.2 AA,
// measured from theme.css itself in both themes: every text colour clears
// 4.5:1 on each ground it sits on (the page, a raised card, a surface fill),
// every tinted pill's text clears 4.5:1 on its own tint, and a control's edge
// (a switch at rest, a field's border) and the send arrow clear 3:1. The
// grounds never move to pass; the inks do.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function block(start: string): string {
  const i = CSS.indexOf(start);
  const j = CSS.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < CSS.length; k++) {
    if (CSS[k] === '{') depth++;
    else if (CSS[k] === '}' && --depth === 0) return CSS.slice(j + 1, k);
  }
  throw new Error(`no block ${start}`);
}
function tokens(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}
const LIGHT = tokens(block(':root {'));
const DARK = { ...LIGHT, ...tokens(block(":root[data-theme='dark'] {")) };

type RGBA = [number, number, number, number];
function color(v: string, t: Record<string, string>): RGBA {
  const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return color(t[ref[1]!]!, t);
  const hex = v.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hex) {
    // A three-digit hex (--on-fill: #fff) doubles each digit.
    const h = hex[1]!.length === 3 ? hex[1]!.replace(/./g, (d) => d + d) : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const rgba = v.match(/^rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)$/);
  if (rgba) return rgba.slice(1).map(Number) as RGBA;
  throw new Error(`unreadable colour ${v}`);
}
const over = (fg: RGBA, bg: RGBA): RGBA => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
];
const lum = (c: RGBA) =>
  [0, 1, 2]
    .map((i) => {
      const x = c[i]! / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    })
    .reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i]!, 0);
function ratio(fg: string, ground: string, t: Record<string, string>, under = 'bg'): number {
  let g = color(t[ground]!, t);
  if (g[3] < 1) g = over(g, color(t[under]!, t));
  let f = color(t[fg]!, t);
  if (f[3] < 1) f = over(f, g);
  const [a, b] = [lum(f), lum(g)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

const TEXT = [
  'ink',
  'ink-soft',
  'muted',
  'accent',
  'local',
  'cloud',
  'ok',
  'warn',
  'danger',
  'link',
  'attention',
  'voice-ink',
];
const GROUNDS = ['bg', 'bg-raised', 'surface'];
const PILLS: Array<[string, string]> = [
  ['accent', 'accent-soft'],
  ['local', 'local-soft'],
  ['cloud', 'cloud-soft'],
  ['ok', 'ok-soft'],
  ['attention', 'attention-soft'],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('contrast, %s theme', (_name, t) => {
  it.each(TEXT)('%s text clears 4.5:1 on every ground', (fg) => {
    for (const g of GROUNDS) expect(ratio(fg, g, t), `${fg} on ${g}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(PILLS)('%s on its own tint clears 4.5:1', (fg, tint) => {
    for (const g of GROUNDS)
      expect(ratio(fg, tint, t, g), `${fg} on ${tint} over ${g}`).toBeGreaterThanOrEqual(4.5);
  });
  it('a control edge clears 3:1 on every ground', () => {
    for (const g of GROUNDS) expect(ratio('control-edge', g, t)).toBeGreaterThanOrEqual(3);
  });
  it('the send arrow clears 3:1 on its fill, ready or waiting', () => {
    expect(ratio('bg', 'accent', t)).toBeGreaterThanOrEqual(3);
    expect(ratio('ink-soft', 'surface', t)).toBeGreaterThanOrEqual(3);
  });
  it('the local hero keeps its white text and its white button legible', () => {
    // The hero's deep water holds in both themes, so white text clears AA
    // across its whole gradient, and the white button's label is the start.
    expect(ratio('on-fill', 'hero-local-start', t)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('on-fill', 'hero-local-end', t)).toBeGreaterThanOrEqual(4.5);
  });
  it("the selected segment's label clears 4.5:1 on its thumb", () => {
    expect(ratio('accent', 'seg-thumb', t)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the controls wear their edge', () => {
  it('waits for input as a quiet solid circle, never a faded one', () => {
    const rule = CSS.match(/\.send-btn:disabled \{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toMatch(/opacity/);
    expect(rule).toMatch(/color: var\(--ink-soft\)/);
  });
  it('draws a switch at rest and a field border on the control edge', () => {
    expect(CSS).toMatch(/\.switch \{[^}]*background: var\(--control-edge\)/);
    expect(CSS).toMatch(/\.field input \{[^}]*border: 1px solid var\(--control-edge\)/);
  });
  it("gives the hero's ghost a glass to read on, and its primary the hero's own water", () => {
    expect(CSS).toMatch(/\.cc-hero-actions \.btn\.ghost \{[^}]*background: color-mix\(/);
    expect(CSS).toMatch(/\.cc-hero \.btn\.primary \{[^}]*color: var\(--hero-local-start\)/);
  });
});
