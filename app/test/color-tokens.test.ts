import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Color meaning is code, not memory (Creative Studio brand sweep, 2026-09-24).
// Every colour lives as a token in theme.css :root and the two dark blocks;
// the rules reference tokens only, so dark mode follows everywhere. Teal
// (--local) means local and private only; amber (--cloud) means cloud and
// spend only; UI chrome wears --accent and "needs you" wears --attention.
// Emergency door is a targeted .skip with a reason, never a loosened guard.

const SRC = join(process.cwd(), 'src');
const THEME = readFileSync(join(SRC, 'theme.css'), 'utf8');

function stripComments(css: string): string {
  // Keep line breaks so reported line numbers stay true.
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const CSS = stripComments(THEME);

/** The body of the first block whose header matches, braces balanced. */
function blockBody(header: RegExp): { body: string; start: number; end: number } {
  const m = header.exec(CSS);
  if (!m) throw new Error(`block not found: ${header}`);
  const open = CSS.indexOf('{', m.index);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0)
      return { body: CSS.slice(open + 1, i), start: m.index, end: i + 1 };
  }
  throw new Error(`unbalanced block: ${header}`);
}

const ROOT = blockBody(/^:root \{/m);
const DARK_MEDIA = blockBody(/^@media \(prefers-color-scheme: dark\) \{/m);
const DARK_ATTR = blockBody(/^:root\[data-theme='dark'\] \{/m);

function tokenMap(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    map.set(m[1]!, m[2]!.replace(/\s+/g, ' ').trim());
  return map;
}

const ROOT_TOKENS = tokenMap(ROOT.body);
const COLOR_VALUE = /^(#|rgba?\(|color-mix\(|var\(--bg\))/;

/** The stylesheet with the three token blocks blanked out (lines kept). */
function rulesOnly(): string {
  let out = CSS;
  for (const b of [ROOT, DARK_MEDIA, DARK_ATTR].sort((a, z) => z.start - a.start))
    out =
      out.slice(0, b.start) + out.slice(b.start, b.end).replace(/[^\n]/g, ' ') + out.slice(b.end);
  return out;
}

// A literal colour: a hex, or an rgb()/rgba() whose channels are numbers
// (rgba(var(--shadow-rgb), a) is token-driven and fine). #fff and #000 are
// allowed: pure white and black as mask stops and the on-fill base.
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_LITERAL = /rgba?\(\s*\d/g;
const ALLOWED_HEX = new Set(['#fff', '#000']);

function literalColors(line: string): string[] {
  const hits: string[] = [];
  for (const m of line.matchAll(HEX)) if (!ALLOWED_HEX.has(m[0].toLowerCase())) hits.push(m[0]);
  for (const m of line.matchAll(RGB_LITERAL)) hits.push(m[0]);
  return hits;
}

/** Declarations with their enclosing selector chain, from the rules only. */
function declarations(css: string): Array<{ line: number; context: string; decl: string }> {
  const out: Array<{ line: number; context: string; decl: string }> = [];
  const stack: string[] = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  for (const ch of css) {
    if (ch === '{') {
      stack.push(buf.replace(/\s+/g, ' ').trim());
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';') {
      const decl = buf.replace(/\s+/g, ' ').trim();
      if (decl) out.push({ line: startLine, context: stack.join(' > '), decl });
      buf = '';
    } else {
      if (!buf.trim() && ch.trim()) startLine = line;
      buf += ch;
    }
    if (ch === '\n') line++;
  }
  return out;
}

function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

// Files that may hold literal colours, each with its reason.
const TSX_COLOR_ALLOW: Record<string, string> = {
  'components/BrandMark.tsx': 'the brand mark is drawn in its exact brand values in both themes',
  'components/terminalTheme.ts': 'xterm fallbacks for --term-bg/--term-fg, read before CSS lands',
};
// Single lines elsewhere, matched by content.
const TSX_COLOR_LINES: Array<{ file: string; match: RegExp; reason: string }> = [
  {
    file: 'screens/PairScreen.tsx',
    match: /color: \{ dark: '#1c2a33', light: '#f6f4ef' \}/,
    reason: 'the pairing QR is rendered to a PNG, so it cannot read a CSS token',
  },
];

// --cloud (amber) is for cloud and spend. A selector wearing it must say so.
const CLOUD_SELECTOR = /cloud|spend|price|saved|over|offload|harness/;
// --local (teal) is for local and private. A selector wearing it must say so,
// or be one of the documented surfaces below whose meaning is local work.
const LOCAL_SELECTOR =
  /local|on-device|private|runs-on|teal-dot|current-pill|sh-green|sh-lean|sh-rings|sh-seal/;
const LOCAL_ALLOW: Record<string, string> = {
  'hero-card': "the store's teal heroes are on-device models (cloud heroes override to amber)",
  'cc-hero': 'Crew command: unattended work that runs on your own computer',
  'crew-command-door': 'the door to Crew command, the same local work',
  'cc-dot.working': 'a crew member working, on your computer',
  'cc-pulse': "the working dot's pulse",
  'seat-bloom': 'the First Seat: a local model taking its seat on this device',
  'cc-presence.working': 'the same working state, as a pill',
  'cc-member.working': 'the same working state, on the roster',
  'cc-routine.working': 'the same working state, on a routine card',
  'store-row-meta': 'the on-device capability glyph on a store row',
};

describe('color tokens', () => {
  it('keeps every literal colour inside :root and the two dark blocks', () => {
    const offenders: string[] = [];
    rulesOnly()
      .split('\n')
      .forEach((line, i) => {
        for (const hit of literalColors(line))
          offenders.push(`theme.css:${i + 1}  ${hit}  ${line.trim().slice(0, 70)}`);
      });
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('keeps literal colours out of components (tokens or currentColor only)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      if (TSX_COLOR_ALLOW[rel]) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (TSX_COLOR_LINES.some((l) => l.file === rel && l.match.test(line))) return;
          for (const hit of literalColors(line)) offenders.push(`${rel}:${i + 1}  ${hit}`);
        });
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('gives a token fallback only when it equals the token (or none at all)', () => {
    // var(--warn, #b7791f) once disagreed with --warn, so the fallback and the
    // token drew two different colours depending on load order.
    const offenders: string[] = [];
    rulesOnly()
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/var\((--[\w-]+)\s*,\s*([^()]+?)\)/g)) {
          const declared = ROOT_TOKENS.get(m[1]!);
          if (declared === undefined) continue; // a local custom property, not a token
          if (!COLOR_VALUE.test(declared)) continue; // a motion or size token
          if (declared !== m[2]!.trim())
            offenders.push(`theme.css:${i + 1}  var(${m[1]}, ${m[2]}) but ${m[1]} is ${declared}`);
        }
      });
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('keeps the two dark blocks identical, token for token', () => {
    // CSS cannot share one declaration block between the media query and the
    // [data-theme='dark'] toggle, so both copies exist; they may never drift.
    const inner = blockBody(/:root:not\(\[data-theme='light'\]\) \{/m);
    const media = tokenMap(inner.body);
    const attr = tokenMap(DARK_ATTR.body);
    expect(media.size).toBeGreaterThan(20);
    expect([...media.entries()].sort()).toEqual([...attr.entries()].sort());
    // Both also set the dark color-scheme.
    expect(inner.body).toMatch(/color-scheme:\s*dark;/);
    expect(DARK_ATTR.body).toMatch(/color-scheme:\s*dark;/);
  });

  it('declares the meaning split in both themes', () => {
    const dark = tokenMap(DARK_ATTR.body);
    for (const name of [
      '--accent',
      '--accent-deep',
      '--accent-soft',
      '--attention',
      '--attention-soft',
    ]) {
      expect(ROOT_TOKENS.has(name), `${name} in :root`).toBe(true);
      expect(dark.has(name), `${name} in dark`).toBe(true);
    }
    for (const name of ['--accent-ink', '--warn-soft', '--danger-soft'])
      expect(ROOT_TOKENS.has(name), `${name} in :root`).toBe(true);
    // The dark warn is an ochre, never the cloud amber.
    expect(dark.get('--warn')).not.toBe(dark.get('--cloud'));
  });

  it('wears --cloud only on cloud and spend selectors', () => {
    const offenders = declarations(rulesOnly())
      .filter((d) => /var\(--cloud(-soft|-bright)?\)/.test(d.decl))
      .filter((d) => !CLOUD_SELECTOR.test(d.context))
      .map((d) => `theme.css:${d.line}  ${d.context}  ${d.decl.slice(0, 60)}`);
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('wears --local only on local and private selectors', () => {
    const offenders = declarations(rulesOnly())
      .filter((d) => /var\(--local(-soft|-deep)?\)/.test(d.decl))
      .filter((d) => !LOCAL_SELECTOR.test(d.context))
      .filter((d) => !Object.keys(LOCAL_ALLOW).some((k) => d.context.includes(k)))
      .map((d) => `theme.css:${d.line}  ${d.context}  ${d.decl.slice(0, 60)}`);
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('dresses plan mode in ink, not amber, and waiting in attention', () => {
    const decls = declarations(rulesOnly());
    const plan = decls.filter((d) => /mode-plan/.test(d.context));
    expect(plan.length).toBeGreaterThan(0);
    for (const d of plan) expect(d.decl).not.toMatch(/--cloud/);
    expect(CSS).not.toMatch(/\.mode-row-icon\.mode-auto/);
    const waiting = decls.filter((d) => /\.waiting|cc-row-needs|\.away/.test(d.context));
    for (const d of waiting) expect(d.decl, d.context).not.toMatch(/--cloud/);
  });
});
