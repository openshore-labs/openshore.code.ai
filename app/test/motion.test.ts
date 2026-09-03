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
});
