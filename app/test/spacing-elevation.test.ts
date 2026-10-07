// Spacing and depth are tokens on the rhythm the eye reads (D22, founder
// 2026-10-07, built as the Creative Studio recommended, B): the page gutter, a
// card's inset, a ledger row, the step between groups, and three depths (a
// resting card, a raised dock or toast, a sheet). Only the structural
// selectors are held here; everything else keeps its own value, on purpose.
// A sheet pads on the gutter, so it no longer pads 18px against the page's 16.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every rule as its selector and declarations, @media bodies included. */
function rules(): Array<{ selector: string; decls: Map<string, string> }> {
  const out: Array<{ selector: string; decls: Map<string, string> }> = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2]!.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g))
      decls.set(d[1]!, d[2]!.replace(/\s+/g, ' ').trim());
    out.push({ selector: m[1]!.replace(/\s+/g, ' ').trim(), decls });
  }
  return out;
}
const RULES = rules();

/** Every value this exact selector gives the property, across its rules. */
function values(selector: string, prop: string): string[] {
  return RULES.filter((r) => r.selector === selector && r.decls.has(prop)).map((r) =>
    r.decls.get(prop)!,
  );
}

/** A value's top-level positions (a shorthand's parts), parentheses kept. */
function positions(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of value) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ' ' && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** A raw length left once the tokens and the safe-area insets are read. */
const rawPx = (v: string) => /\d+px/.test(v.replace(/var\(--[\w-]+\)|env\([^)]*\)/g, ''));

function root(): Record<string, string> {
  const body = RULES.find((r) => r.selector === ':root')!;
  return Object.fromEntries(body.decls);
}

describe('the structural tokens', () => {
  it('declares the scale on :root, each value the one the app used most', () => {
    const t = root();
    expect(t['--gutter']).toBe('16px');
    expect(t['--card-pad']).toBe('14px');
    expect(t['--row-pad']).toBe('12px');
    expect(t['--section-gap']).toBe('22px');
    for (const n of [1, 2, 3]) expect(t[`--elev-${n}`]).toMatch(/rgba\(var\(--shadow-rgb\)/);
  });
});

describe('the page gutter', () => {
  it('holds every room, the transcript and the composer on --gutter', () => {
    for (const side of ['padding-left', 'padding-right']) {
      const [v] = values('.screen-inner', side);
      expect(v, `.screen-inner ${side}`).toMatch(/^max\(var\(--gutter\), env\(/);
    }
    for (const sel of ['.screen-inner', '.thread-inner', '.composer-wrap']) {
      const [v] = values(sel, 'padding');
      expect(positions(v!)[1], `${sel} inline padding`).toBe('var(--gutter)');
    }
  });
  it('sets the docks on --gutter, never a raw px', () => {
    for (const sel of ['.projects-dock', '.project-room-dock']) {
      const [v] = values(sel, 'padding-inline');
      expect(v, sel).toMatch(/var\(--gutter\)/);
      expect(rawPx(v!), `${sel}: ${v}`).toBe(false);
    }
  });
  it('pads a sheet on --gutter, so it stops padding 18px against the page', () => {
    for (const [sel, prop] of [
      ['.sheet', 'padding'],
      ['.sheet', 'padding-bottom'],
      ['.sheet.top', 'padding'],
      ['.sheet:not(.top) > .sheet-grabber', 'margin'],
      ['.sheet:not(.top) > .sheet-grabber', 'top'],
      ['.sheet:not(.top) > .mode-head', 'top'],
      ['.sheet:not(.top) > .mode-head', 'margin-top'],
      ['.sheet:not(.top) > .mode-head', 'padding-top'],
      ['.sheet:not(.top) > .mode-head', 'box-shadow'],
    ] as const) {
      const vs = values(sel, prop);
      expect(vs.length, `${sel} ${prop}`).toBeGreaterThan(0);
      for (const v of vs) {
        expect(v, `${sel} ${prop}`).toMatch(/var\(--gutter\)/);
        expect(rawPx(v), `${sel} ${prop}: ${v}`).toBe(false);
      }
    }
  });
});

describe('cards and the ledger', () => {
  it('insets a card by --card-pad', () => {
    expect(values('.card', 'padding')).toEqual(['var(--card-pad)']);
  });
  it('pads a ledger row on --row-pad and --card-pad, its hairline on the same line', () => {
    expect(values('.settings-row', 'padding')).toEqual(['var(--row-pad) var(--card-pad)']);
    for (const v of values('.settings-block', 'padding')) expect(rawPx(v), v).toBe(false);
    const hairline = values(
      '.settings-row + .settings-row, .icon-picker + .settings-row',
      'border-image',
    );
    expect(hairline[0]).toMatch(/transparent var\(--card-pad\), var\(--border\) var\(--card-pad\)/);
  });
  it('steps from one group to the next by --section-gap, its head on the text line', () => {
    expect(values('.settings-group', 'margin-top')).toEqual(['var(--section-gap)']);
    expect(values('.section-head', 'margin-top')).toEqual(['var(--section-gap)']);
    expect(positions(values('.settings-group-head, .section-head', 'margin')[0]!)[3]).toBe(
      'var(--card-pad)',
    );
  });
});

describe('three depths', () => {
  it('rests a card on --elev-1', () => {
    for (const sel of ['.card', '.settings-card'])
      expect(values(sel, 'box-shadow'), sel).toEqual(['var(--elev-1)']);
  });
  it('raises the docks and the toast on --elev-2', () => {
    for (const sel of [
      '.projects-dock-round',
      '.projects-dock-new',
      '.projects-dock-field',
      '.jump-chip',
      '.toast',
    ])
      expect(values(sel, 'box-shadow'), sel).toEqual(['var(--elev-2)']);
  });
  it('lifts every sheet on --elev-3', () => {
    for (const sel of ['.sheet', '.sheet.top']) {
      const vs = values(sel, 'box-shadow');
      expect(vs.length, sel).toBeGreaterThan(0);
      for (const v of vs) expect(v, sel).toBe('var(--elev-3)');
    }
  });
});
