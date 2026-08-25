import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Enforces the motion and interaction polish standards ported from the Uki app
// (its CLAUDE.md "Motion & interaction polish is a standard"). A test rather
// than a note so the standard survives the next session that does not remember
// it. Emergency door is a targeted .skip with a reason, never loosening a guard.

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(jsx?|tsx?|css)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name))
      out.push(path);
  }
  return out;
}

const THEME = readFileSync(join(SRC, 'theme.css'), 'utf8');

describe('polish standards', () => {
  it('never uses `transition: all`', () => {
    const offenders: string[] = [];
    const re = /transition(?:-property)?\s*:\s*['"`]?\s*all\b/;
    for (const file of sourceFiles()) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (re.test(line))
            offenders.push(`${relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('hardens the global reduced-motion reset (durations, delays, and iteration count)', () => {
    const block = THEME.match(
      /\*,\s*\*::before,\s*\*::after\s*\{[\s\S]*?transition-duration:\s*0\.01ms[\s\S]*?\}/,
    );
    expect(block, 'global prefers-reduced-motion `*` reset not found').toBeTruthy();
    const text = block![0];
    for (const decl of [
      'transition-duration: 0.01ms !important',
      'animation-duration: 0.01ms !important',
      'animation-delay: 0ms !important',
      'animation-iteration-count: 1 !important',
    ]) {
      expect(text.includes(decl), `reduced-motion reset missing: ${decl}`).toBe(true);
    }
  });

  it('never pins an entrance with animation-fill-mode: both (it kills a press state)', () => {
    // `both` holds the final keyframe transform after the animation ends, which
    // wins over an :active transform and silently kills the press. Use
    // `backwards` (it still covers a stagger delay without pinning the end).
    const offenders: string[] = [];
    THEME.split('\n').forEach((line, i) => {
      if (/^\s*(\/\*|\*)/.test(line)) return;
      if (/animation(?:-fill-mode)?\s*:[^;]*\bboth\b/.test(line))
        offenders.push(`theme.css:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('routes haptics through @capacitor/haptics, never navigator.vibrate', () => {
    const src = readFileSync(join(SRC, 'lib', 'haptics.ts'), 'utf8');
    expect(src.includes('@capacitor/haptics')).toBe(true);
    expect(/Haptics\.impact/.test(src)).toBe(true);
    // navigator.vibrate is a silent no-op in the iOS WebView; it must not appear
    // anywhere in the app.
    for (const file of sourceFiles()) {
      expect(readFileSync(file, 'utf8').includes('navigator.vibrate'), `${file}`).toBe(false);
    }
  });
});
