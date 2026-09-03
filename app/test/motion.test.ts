import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { durationMs, drawerWidth } from '../src/lib/motion.js';

// lib/motion.ts reads the motion vocabulary out of theme.css at runtime so a
// TypeScript timer and a CSS transition never carry two copies of one number.
// This runner has no document, so the fallbacks are what is exercised here;
// the stylesheet side is pinned by text so the runtime read has something to
// find on a device.

const THEME = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');

describe('motion readers', () => {
  it('fall back cleanly without a document', () => {
    expect(durationMs('--dur-4', 280)).toBe(280);
    expect(drawerWidth()).toBe(310);
  });

  it('have a registered --drawer-width to read, and the drawer uses it', () => {
    // Registered as a <length>, the computed value comes back in px, which is
    // what drawerWidth() parses. An unregistered property would come back as
    // the raw min() expression and silently hit the fallback.
    expect(THEME).toMatch(/@property --drawer-width \{[^}]*syntax:\s*'<length>'/);
    expect(THEME).toMatch(/--drawer-width:\s*min\(310px, 84vw\);/);
    expect(THEME).toMatch(/\.sidebar\.drawer \{[^}]*width:\s*var\(--drawer-width\)/);
  });

  it('lets the settle spring take its duration from the gesture', () => {
    expect(THEME).toMatch(
      /\.sidebar\.drawer \{[^}]*transition:\s*transform var\(--drawer-settle, var\(--dur-4\)\) var\(--ease-spring\)/,
    );
  });

  it('lets the exit take its duration from the release velocity, shadow included', () => {
    // Panel, scrim, and the shadow pseudo-element all leave on --drawer-exit
    // (default --dur-5), so a flick and a slow release stay one motion.
    for (const selector of [
      '.sidebar.drawer.closing',
      '.drawer-scrim.closing',
      '.sidebar.drawer.closing::after',
    ]) {
      const block = THEME.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')} \\{[^}]*\\}`));
      expect(block, `${selector} not found`).toBeTruthy();
      expect(block![0]).toMatch(/animation:\s*[\w-]+ var\(--drawer-exit, var\(--dur-5\)\)/);
    }
    // The shadow is the pseudo-element's, never the panel's own, so it can
    // fade on opacity while the panel stays solid.
    expect(THEME).toMatch(/\.sidebar\.drawer::after \{[^}]*box-shadow:/);
    expect(THEME).not.toMatch(/\.sidebar\.drawer \{[^}]*box-shadow:/);
  });
});
