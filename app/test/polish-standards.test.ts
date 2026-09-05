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

  // The stylesheet's motion declarations, comments stripped, as
  // `{ prop, value, context }` where context is the few lines above (so a
  // stated exemption in a comment can be read).
  function motionDeclarations(): Array<{ prop: string; value: string; context: string }> {
    const out: Array<{ prop: string; value: string; context: string }> = [];
    const lines = THEME.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(
        /^\s*(transition|animation)(-duration|-delay|-timing-function|-property)?\s*:\s*(.*)$/,
      );
      if (!m) continue;
      let value = m[3]!;
      let j = i;
      while (!value.includes(';') && j + 1 < lines.length) {
        j += 1;
        value += ' ' + lines[j]!.trim();
      }
      value = value
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/;.*$/, '')
        .trim();
      const context = lines.slice(Math.max(0, i - 5), i).join('\n');
      out.push({ prop: `${m[1]}${m[2] ?? ''}`, value, context });
      i = j;
    }
    return out;
  }

  it('references the motion tokens, never a raw easing keyword or cubic-bezier()', () => {
    // One vocabulary. The token declarations in :root are the only place a
    // literal curve may appear; `ease` (the browser default) is never chosen
    // on purpose. Infinite loops keep `linear` and `steps()`.
    const offenders: string[] = [];
    for (const { value } of motionDeclarations()) {
      if (/(?<![-\w])(ease(?:-in|-out|-in-out)?|cubic-bezier\()/.test(value))
        offenders.push(value.slice(0, 90));
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('references the duration tokens for anything under a second', () => {
    // Ad-hoc milliseconds are how one screen drifts snappier than the rest.
    // The tokens cover 120 to 520 ms; loops and long delays (a second or more)
    // sit outside that range and stay literal by design.
    const offenders: string[] = [];
    for (const { prop, value } of motionDeclarations()) {
      if (/\binfinite\b/.test(value)) continue;
      if (/!important/.test(value)) continue; // the reduced-motion reset
      for (const m of value.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
        if (ms > 0 && ms < 1000) offenders.push(`${prop}: ${value.slice(0, 90)}`);
      }
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('never transitions a layout property (transform, opacity, scale only)', () => {
    // Width, height, inset, margin, padding, and max-height reflow on every
    // frame and jank on the phone. A stated exemption in the comment above the
    // declaration (the word "exemption") is the only way past this.
    const offenders: string[] = [];
    for (const { prop, value, context } of motionDeclarations()) {
      if (!prop.startsWith('transition')) continue;
      if (/exemption/i.test(context)) continue;
      const hit = value.match(
        /(?<![-\w])(width|height|top|left|right|bottom|inset|margin(?:-\w+)?|padding(?:-\w+)?|max-height|min-height)(?![-\w])/,
      );
      if (hit) offenders.push(`${hit[1]} in: ${value.slice(0, 90)}`);
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('gives every scrim an exit: no JSX scrim without a closing binding', () => {
    // Everything that animates in animates out. A scrim rendered with a bare
    // literal class can only snap-unmount. Use components/Sheet.tsx, or
    // useSheetExit / useExitPresence and bind the `closing` class.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!file.endsWith('.tsx')) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/className="(sheet|confirm|drawer)-scrim"/.test(line))
            offenders.push(`${relative(SRC, file)}:${i + 1}`);
        });
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('keeps a pointer-capturing surface mounted through its own gesture', () => {
    // The edge zone captures the pointer on touch-down. App once rendered it
    // under `!gesture.peek`, so the render that followed removed it; a removed
    // element loses its capture, the release handler never fired, the gesture
    // stayed armed, and the drawer's invisible scrim sat over the room eating
    // every tap until the app was quit (founder, 2026-09-03). Pinned here: the
    // zone outlives the gesture, and lost capture counts as a release.
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8').split('\n');
    const at = app.findIndex((line) => line.includes('className="edge-swipe-zone"'));
    expect(at, 'edge-swipe-zone not rendered in App.tsx').toBeGreaterThan(0);
    const condition = app[at - 1]!; // the `{compact && (...) ? (` line above the zone
    expect(condition).toMatch(/\|\|\s*gesture\.peek/);
    expect(condition).not.toMatch(/!\s*gesture\.peek/);
    const hook = readFileSync(join(SRC, 'hooks', 'useDrawerGesture.ts'), 'utf8');
    expect(hook).toMatch(/onLostPointerCapture:\s*edgeUp/);
    expect(hook).toMatch(/onLostPointerCapture:\s*drawerUp/);
  });

  // UI-8: inline motion in TSX (`style={{ transition: ... }}`, `animation:`)
  // drifted unchecked because the guards above read only theme.css. Every
  // string literal on a `transition:` / `animation:` line in a .tsx file is
  // held to the same bar: tokens only, no `ease` keyword, no raw
  // cubic-bezier, no ad-hoc milliseconds, and no layout property.
  const MOTION_EXEMPT: Record<string, string> = {
    // The boot splash paints before the bundle (and the tokens) can load, so
    // its curves are literal by necessity; it honors reduced motion inline.
    'index.html': 'boot splash, pre-bundle; documented and reduced-motion handled',
  };

  function inlineMotion(): Array<{ where: string; value: string; prop: string }> {
    const out: Array<{ where: string; value: string; prop: string }> = [];
    const files = sourceFiles().filter((f) => f.endsWith('.tsx'));
    files.push(join(process.cwd(), 'index.html'));
    for (const file of files) {
      const rel = file.endsWith('index.html') ? 'index.html' : relative(SRC, file);
      if (MOTION_EXEMPT[rel]) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
          const m = line.match(/\b(transition|animation)\s*:\s*(.*)$/);
          if (!m) return;
          const literals = [...m[2]!.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(
            (x) => x[1] ?? x[2] ?? x[3] ?? '',
          );
          for (const value of literals) out.push({ where: `${rel}:${i + 1}`, value, prop: m[1]! });
        });
    }
    return out;
  }

  it('holds inline TSX motion to the tokens: no raw curve, keyword, or ad-hoc ms', () => {
    const offenders: string[] = [];
    for (const { where, value } of inlineMotion()) {
      if (/(?<![-\w])(ease(?:-in|-out|-in-out)?|cubic-bezier\()/.test(value))
        offenders.push(`${where}  ${value}`);
      if (/\binfinite\b/.test(value)) continue;
      for (const m of value.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
        if (ms > 0 && ms < 1000) offenders.push(`${where}  ${value}`);
      }
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('never transitions a layout property inline either', () => {
    const offenders: string[] = [];
    for (const { where, value, prop } of inlineMotion()) {
      if (prop !== 'transition') continue;
      const hit = value.match(
        /(?<![-\w])(width|height|top|left|right|bottom|inset|margin(?:-\w+)?|padding(?:-\w+)?|max-height|min-height)(?![-\w])/,
      );
      if (hit) offenders.push(`${where}  ${hit[1]} in: ${value}`);
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('defers a sheet pick through the exit: no direct onPick( beside useSheetExit (UI-4)', () => {
    // A sheet that hands its choice straight up is unmounted by the parent
    // in the same tick, so it snap-closes. The only allowed call is the one
    // held for the exit: `pending.current = () => onPick(...)` next to a
    // dismiss(). ApprovalSheet and ModelSheet are the pattern.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!file.endsWith('.tsx')) continue;
      const text = readFileSync(file, 'utf8');
      if (!text.includes('useSheetExit')) continue;
      if (!/\bdismiss\b/.test(text)) offenders.push(`${relative(SRC, file)}: no dismiss`);
      text.split('\n').forEach((line, i) => {
        if (!/\bonPick\(/.test(line)) return;
        if (/\.current\s*=\s*\(\)\s*=>\s*onPick\(/.test(line)) return;
        offenders.push(`${relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('ticks a tap once: no hapticTick() inside a button onClick (UI-7)', () => {
    // App.tsx ticks every button, [role="button"], and link on the capture
    // phase, so a component that ticks in its own onClick makes the finger
    // feel two. Components mark only what a click cannot: a gesture's lift,
    // arm, and drop, a keyboard commit, and the streaming pulse.
    const GESTURE_FILES: Record<string, string> = {
      'components/Sheet.tsx': 'grabber drag: lift and drop',
      'components/SwipeRow.tsx': 'swipe: arm and commit',
      'components/ProfileStatus.tsx': 'grabber drag: lift and drop',
      'hooks/useDrawerGesture.ts': 'edge drag: arm, drop, and settle',
    };
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).toMatch(/closest\('button:not\(:disabled\), \[role="button"\], a\[href\]'\)/);
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!/\.tsx?$/.test(file)) continue;
      const rel = relative(SRC, file);
      if (GESTURE_FILES[rel]) continue;
      const text = readFileSync(file, 'utf8');
      const bad = [
        /onClick=\{(?:async\s*)?\(\)\s*=>\s*\{\s*hapticTick\(\)/g,
        /onClick=\{(?:async\s*)?\(\)\s*=>\s*hapticTick\(\)/g,
        /onClick=\{hapticTick\b/g,
      ];
      for (const re of bad) {
        for (const m of text.matchAll(re)) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${rel}:${line}`);
        }
      }
    }
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
