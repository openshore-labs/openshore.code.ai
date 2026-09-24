import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// The type, weight, radius, and icon scales are code, not memory (Creative
// Studio brand sweep, 2026-09-24). Thirty-three font sizes, eight weights,
// seventeen pixel radii, and eleven icon stroke widths became one scale each,
// declared once in theme.css :root. This holds them there. Emergency door is
// a targeted .skip with a reason, never a loosened guard.

const SRC = join(process.cwd(), 'src');
const THEME = readFileSync(join(SRC, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) =>
  m.replace(/[^\n]/g, ' '),
);

function decls(prop: RegExp): Array<{ line: number; value: string; inFontFace: boolean }> {
  const out: Array<{ line: number; value: string; inFontFace: boolean }> = [];
  let inFontFace = false;
  THEME.split('\n').forEach((line, i) => {
    if (/@font-face\s*\{/.test(line)) inFontFace = true;
    else if (inFontFace && /^\}/.test(line)) inFontFace = false;
    const m = line.match(prop);
    if (m) out.push({ line: i + 1, value: m[1]!.trim(), inFontFace });
  });
  return out;
}

function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(path);
  }
  return out;
}

const TEXT_TOKEN = /^var\(--text-(\d|display-\d)\)$/;

describe('type, radius, and icon scales', () => {
  it('declares the scales in :root', () => {
    const root = THEME.slice(THEME.indexOf(':root {'));
    const px = ['11', '12', '13', '14', '15', '17', '20', '26'];
    px.forEach((v, i) => expect(root).toMatch(new RegExp(`--text-${i + 1}: ${v}px;`)));
    expect(root).toMatch(/--weight-regular: 400;/);
    expect(root).toMatch(/--weight-medium: 500;/);
    expect(root).toMatch(/--weight-semibold: 600;/);
    expect(root).toMatch(/--radius-sm: 8px;/);
    expect(root).toMatch(/--radius-md: 10px;/);
    expect(root).toMatch(/--icon-stroke: 1\.8;/);
    expect(root).toMatch(/--icon-stroke-hairline: 1\.4;/);
  });

  it('sets every font-size on the scale (a text token, em, a token clamp, or inherit)', () => {
    const offenders = decls(/^\s*font-size:\s*([^;]+);/)
      .filter(({ value }) => {
        if (TEXT_TOKEN.test(value)) return false;
        if (/^\d*\.?\d+em$/.test(value)) return false;
        if (value === 'inherit' || value === '0') return false;
        const clamp = value.match(/^clamp\((.*)\)$/);
        if (clamp) {
          const parts = clamp[1]!.split(',').map((p) => p.trim());
          return !(
            parts.length === 3 &&
            TEXT_TOKEN.test(parts[0]!) &&
            /^\d*\.?\d+vw$/.test(parts[1]!) &&
            TEXT_TOKEN.test(parts[2]!)
          );
        }
        return true;
      })
      .map(({ line, value }) => `theme.css:${line}  font-size: ${value}`);
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('uses the three weights only', () => {
    const offenders = decls(/^\s*font-weight:\s*([^;]+);/)
      .filter(({ inFontFace }) => !inFontFace)
      .filter(({ value }) => !/^var\(--weight-(regular|medium|semibold)\)$/.test(value))
      .filter(({ value }) => value !== 'inherit')
      .map(({ line, value }) => `theme.css:${line}  font-weight: ${value}`);
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('rounds every corner with a radius token (or a circle, a pill, or none)', () => {
    // The Currents ring follows the phone's own screen corner, a device
    // geometry rather than a design radius; its fallback is still the token.
    const EXEMPT = new Set(['var(--current-corner, var(--radius-lg))']);
    const offenders = decls(/^\s*border(?:-[a-z]+)?-radius:\s*([^;]+);/)
      .filter(({ value }) => !EXEMPT.has(value))
      .filter(({ value }) =>
        value.split(/\s+/).some((part) => !/^(var\(--radius(-\w+)?\)|50%|999px|0)$/.test(part)),
      )
      .map(({ line, value }) => `theme.css:${line}  border-radius: ${value}`);
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('keeps inline fontSize, borderRadius, and strokeWidth out of components', () => {
    const ALLOW: Record<string, string> = {
      'components/Icon.tsx': 'the icon frame itself',
      'components/BrandMark.tsx': 'the brand mark, drawn on its own grid',
      'components/WaveMark.tsx': 'the brand wave, drawn on its own grid',
      'components/MarketIcon.tsx': 'a monogram sized in proportion to its tile, computed',
      'components/DesktopTerminal.tsx': "xterm's fontSize option, not a CSS style",
      'screens/TerminalScreen.tsx': "xterm's fontSize option, not a CSS style",
    };
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      if (ALLOW[rel]) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (/\b(fontSize|borderRadius|strokeWidth)\b/.test(line))
            offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('draws every 24-unit glyph through the Icon frame', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      if (rel === 'components/Icon.tsx') continue;
      const text = readFileSync(file, 'utf8');
      if (/viewBox[=:]\s*["'{]?\s*['"]?0 0 24 24/.test(text)) offenders.push(rel);
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });
});
