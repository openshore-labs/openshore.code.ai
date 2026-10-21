import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { durationMs, drawerExitMs, drawerWidth } from '../src/lib/motion.js';

const SIDEBAR = readFileSync(join(process.cwd(), 'src', 'components', 'Sidebar.tsx'), 'utf8');
const APP = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
const GESTURE = readFileSync(join(process.cwd(), 'src', 'hooks', 'useDrawerGesture.ts'), 'utf8');

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
    // --dur-7 plus a hair, so the glide's tail is never clipped.
    expect(drawerExitMs()).toBe(540);
  });

  it('slides the drawer on the glide over the door clock, scrim and shadow in step', () => {
    // Maintainer, 2026-09-03, with a recording: the drawer jumped in and out. On
    // the standard curve a 310px door's visible travel was about 110ms of a
    // 320ms clock. The entrance, the scrim, and the shadow now share --dur-7
    // on --ease-glide, so nothing lands ahead of the door.
    expect(THEME).toMatch(
      /\.sidebar\.drawer \{[^}]*animation:\s*drawer-in var\(--dur-7\) var\(--ease-glide\)/,
    );
    expect(THEME).toMatch(
      /\.drawer-scrim \{[^}]*animation:\s*fade-in var\(--dur-7\) var\(--ease-glide\)/,
    );
    expect(THEME).toMatch(
      /\.sidebar\.drawer::after \{[^}]*animation:\s*fade-in var\(--dur-7\) var\(--ease-glide\)/,
    );
  });

  it('holds the drawer mounted for the door clock', () => {
    // An unmount on the generic EXIT_MS (340ms) would cut a 520ms glide short,
    // exactly the clipped tail that reads as cheap.
    expect(APP).toMatch(/useExitPresence\(compact && drawerOpen, drawerExitMs\(\)\)/);
    expect(GESTURE).not.toMatch(/EXIT_MS/);
  });

  it('never drags the open drawer shut: it closes on a tap (founder, 2026-10-19)', () => {
    // A swipe on the open panel closed it too easily. Only the edge swipe
    // (from closed) is a gesture; the panel binds no pointer handlers, and
    // the scrim beside it closes on a click.
    expect(GESTURE).not.toMatch(/drawerProps|mode\.current = 'close'/);
    expect(APP).not.toMatch(/dragProps=/);
    expect(SIDEBAR).not.toMatch(/dragProps|exitMs/);
    expect(SIDEBAR).toMatch(
      /className=\{`drawer-scrim[\s\S]*?onClick=\{\(\) => setDrawer\(false\)\}/,
    );
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

  it('plays the exit on the door clock, shadow included', () => {
    // Panel, scrim, and the shadow pseudo-element all leave on --drawer-exit
    // (default: the door clock) and --drawer-exit-ease (default: the glide),
    // so a tap-close is the entrance run backwards.
    for (const selector of [
      '.sidebar.drawer.closing',
      '.drawer-scrim.closing',
      '.sidebar.drawer.closing::after',
    ]) {
      const block = THEME.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')} \\{[^}]*\\}`));
      expect(block, `${selector} not found`).toBeTruthy();
      expect(block![0].replace(/\s+/g, ' ')).toMatch(
        /animation:\s*[\w-]+ var\(--drawer-exit, var\(--dur-7\)\) var\(--drawer-exit-ease, var\(--ease-glide\)\) forwards/,
      );
    }
    // The shadow is the pseudo-element's, never the panel's own, so it can
    // fade on opacity while the panel stays solid.
    expect(THEME).toMatch(/\.sidebar\.drawer::after \{[^}]*box-shadow:/);
    expect(THEME).not.toMatch(/\.sidebar\.drawer \{[^}]*box-shadow:/);
  });
});
