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

  it('gives every Vault class name a rule in theme.css (CTO K18, 6.9)', () => {
    // Every `vault-` class the room and its components put on an element has
    // a rule, so a renamed rule or a class nobody styled fails CI. Only
    // className values are read (an id such as vault-rename-name is not a
    // class); a class built from a prefix (`vault-outline-depth-${n}`) needs
    // a rule for that prefix.
    const files = [
      join(SRC, 'screens', 'VaultScreen.tsx'),
      ...readdirSync(join(SRC, 'components', 'vault'))
        .filter((n) => n.endsWith('.tsx'))
        .map((n) => join(SRC, 'components', 'vault', n)),
    ];
    /** The source of every className value: "..." or a balanced {...}. */
    const classValues = (src: string): string[] => {
      const out: string[] = [];
      for (const m of src.matchAll(/className=/g)) {
        let i = m.index! + 'className='.length;
        if (src[i] === '"') {
          out.push(src.slice(i + 1, src.indexOf('"', i + 1)));
          continue;
        }
        if (src[i] !== '{') continue;
        let depth = 0;
        const start = i;
        for (; i < src.length; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}' && --depth === 0) break;
        }
        out.push(src.slice(start, i + 1));
      }
      return out;
    };
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(SRC, file);
      for (const value of classValues(src)) {
        for (const m of value.matchAll(/(?<![\w-])vault-[a-z0-9-]*/g)) {
          const name = m[0];
          const rule = name.endsWith('-')
            ? THEME.includes(`.${name}`)
            : new RegExp(`\\.${name}(?![a-z0-9-])`).test(THEME);
          if (!rule) missing.push(`${rel}: .${name}`);
        }
      }
    }
    expect([...new Set(missing)], missing.join('\n  ')).toEqual([]);
    // It reads what it should: the room's own classes are in the set.
    const screen = classValues(readFileSync(files[0]!, 'utf8')).join(' ');
    expect(screen).toMatch(/vault-note/);
    expect(screen).toMatch(/vault-folder-options/);
  });

  // G2 (the screens review): a tappable that does not answer the finger, a
  // scrim with no dialog behind it, and a field a screen reader cannot name
  // each slipped past review one file at a time. These read every .tsx file.

  /** Every opening tag of this element in a source, with its line. The tag
   *  ends at the first `>` outside braces and quotes, so an arrow function or
   *  a template in an attribute does not end it early. A tag on a comment
   *  line is prose, not markup. */
  function openingTags(src: string, name: string): Array<{ line: number; text: string }> {
    const out: Array<{ line: number; text: string }> = [];
    for (const m of src.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(src.slice(lineStart, m.index + 1))) continue;
      let i = m.index + m[0].length;
      let depth = 0;
      let quote: string | null = null;
      for (; i < src.length; i++) {
        const c = src[i]!;
        if (quote) {
          if (c === quote && src[i - 1] !== '\\') quote = null;
        } else if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) break;
      }
      out.push({ line: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, i + 1) });
    }
    return out;
  }

  const tsxFiles = () => sourceFiles().filter((f) => f.endsWith('.tsx'));

  it('gives every <button a press class, so every tap is answered', () => {
    // A press class is one of the shared ones, or any class with its own
    // :active rule in theme.css (the nav rows, the composer pills, the store
    // cards), read from the stylesheet so a new rule counts on its own.
    const press = new Set(['btn', 'linklike', 'press-fb', 'seg', 'switch']);
    for (const m of THEME.matchAll(
      /(?:^|[\s,{}])(?:button)?\.([a-z][\w-]*)(?:\.[\w-]+)*:active\b/gm,
    ))
      press.add(m[1]!);
    const WHITELIST: Record<string, string> = {
      // Its class list is built in a variable (cls) that always carries press-fb.
      'components/vault/VaultProvenanceChip.tsx': 'class list built in cls, press-fb included',
    };
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const rel = relative(SRC, file);
      if (WHITELIST[rel]) continue;
      const src = readFileSync(file, 'utf8');
      for (const tag of openingTags(src, 'button')) {
        const cls = tag.text.match(/className=(\{[\s\S]*\}|"[^"]*")/)?.[1] ?? '';
        const words = cls.match(/[a-z][\w-]*/g) ?? [];
        if (!words.some((w) => press.has(w)))
          offenders.push(`${rel}:${tag.line}  ${cls.slice(0, 60) || '(no class)'}`);
      }
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('puts a dialog behind every hand-rolled scrim (or uses <Sheet>)', () => {
    // components/Sheet.tsx gives its card role="dialog", aria-modal, and a
    // name from its SheetHead; a scrim written by hand must do the same.
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const rel = relative(SRC, file);
      if (rel === 'components/Sheet.tsx') continue;
      const src = readFileSync(file, 'utf8');
      for (const tag of openingTags(src, 'div')) {
        if (!/className=\{?`?"?(sheet|confirm)-scrim\b/.test(tag.text)) continue;
        const after = src.slice(src.indexOf(tag.text) + tag.text.length);
        const card = openingTags(after, 'div')[0]?.text ?? '';
        if (!/role="dialog"/.test(card)) offenders.push(`${rel}:${tag.line}`);
      }
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('names every text field: a wrapping <label>, a label for its id, or aria-label', () => {
    // A placeholder is not a label: it vanishes on the first keystroke and a
    // screen reader may skip it. Checkboxes and radios sit inside their own
    // labels and are not read here.
    const TEXTY = new Set(['text', 'email', 'password', 'url', 'search', 'tel', 'number']);
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const rel = relative(SRC, file);
      const src = readFileSync(file, 'utf8');
      for (const tag of openingTags(src, 'input')) {
        const type = tag.text.match(/\btype="([^"]+)"/)?.[1] ?? 'text';
        if (!TEXTY.has(type) && !/\btype=\{/.test(tag.text)) continue;
        if (/\baria-label(ledby)?=/.test(tag.text)) continue;
        const id = tag.text.match(/\bid=(?:"([^"]+)"|\{([^}]+)\})/);
        if (id && (src.includes(`htmlFor="${id[1]}"`) || src.includes(`htmlFor={${id[2]}}`)))
          continue;
        const before = src.slice(0, src.indexOf(tag.text));
        if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
        offenders.push(`${rel}:${tag.line}`);
      }
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
  });

  it('asks in a sheet, never window.prompt (Electron does not implement it)', () => {
    // A prompt() on the desktop returns nothing and the action silently does
    // nothing (renaming a computer did). Ask with a one-field Sheet instead.
    const WHITELIST: Record<string, string> = {
      // The operators' abuse review, inside Admin (v4, no door in Personal).
      'components/EnforcementReview.tsx': 'v4 operator tool; replace when Admin ships',
    };
    const offenders = tsxFiles()
      .filter((f) => !WHITELIST[relative(SRC, f)])
      .filter((f) => /\bwindow\.prompt\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
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

// A room scrolls up and down only (founder, 2026-10-02): the Vault's wash
// bled 4px past the edge and the whole room panned sideways on the phone.
describe('rooms never scroll sideways', () => {
  it('clips horizontal overflow on every room', () => {
    const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
    expect(theme).toMatch(/\.screen \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden;/);
  });
});
