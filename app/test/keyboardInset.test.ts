// The composer must never end up under the keyboard (founder, 2026-09-03, a
// recording of the keyboard rising clean over the text box). The lift no
// longer hangs on one plugin event with one good number: the height is
// remembered on the device, a stray zero lifts by the remembered height, both
// show events feed it, and a focused field that hears nothing lifts on its
// own. The attach tray takes the same slot. Pinned here.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_KEYBOARD_HEIGHT,
  MIN_REAL_HEIGHT,
  insetForShow,
  knownKeyboardHeight,
  rememberKeyboardHeight,
  resetKeyboardHeightCache,
} from '../src/lib/keyboardHeight.js';
import { FALLBACK_AFTER_MS } from '../src/hooks/useKeyboardInset.js';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('the remembered keyboard height', () => {
  beforeEach(() => {
    resetKeyboardHeightCache();
    try {
      localStorage.clear();
    } catch {
      // no storage in this environment; the in-memory path is what is tested
    }
  });

  it('starts from a phone-sized default before any reading exists', () => {
    expect(knownKeyboardHeight()).toBe(DEFAULT_KEYBOARD_HEIGHT);
    expect(DEFAULT_KEYBOARD_HEIGHT).toBeGreaterThan(300);
  });

  it('remembers a real reading and ignores a stray zero or a bare accessory bar', () => {
    rememberKeyboardHeight(0);
    expect(knownKeyboardHeight()).toBe(DEFAULT_KEYBOARD_HEIGHT);
    rememberKeyboardHeight(44);
    expect(knownKeyboardHeight()).toBe(DEFAULT_KEYBOARD_HEIGHT);
    rememberKeyboardHeight(346);
    expect(knownKeyboardHeight()).toBe(346);
    expect(MIN_REAL_HEIGHT).toBeLessThan(260); // the smallest iPhone keyboard still counts
  });

  it('lifts by the reported height when it is real, else by the remembered one', () => {
    expect(insetForShow(336, 300)).toBe(336);
    expect(insetForShow(0, 300)).toBe(300);
    expect(insetForShow(44, 300)).toBe(300);
  });
});

describe('the keyboard inset hook', () => {
  const hook = read('hooks/useKeyboardInset.ts');

  it('listens on both show events, both hide events, and the window road', () => {
    for (const name of [
      'keyboardWillShow',
      'keyboardDidShow',
      'keyboardWillHide',
      'keyboardDidHide',
    ])
      expect(hook).toContain(`Keyboard.addListener('${name}'`);
    expect(hook).toContain("window.addEventListener('keyboardWillShow'");
  });

  it('lifts a focused field on its own when no event lands within a beat', () => {
    expect(FALLBACK_AFTER_MS).toBeGreaterThanOrEqual(300);
    expect(FALLBACK_AFTER_MS).toBeLessThanOrEqual(600);
    expect(hook).toMatch(/document\.addEventListener\('focusin', onFocusIn\)/);
    expect(hook).toMatch(/lift\(knownKeyboardHeight\(\)\)/);
    expect(hook).toMatch(/lift\(insetForShow\(reported\)\)/);
  });

  it('is registered once at the shell, never per screen', () => {
    expect(read('App.tsx')).toContain('useKeyboardInset()');
    expect(read('screens/ChatScreen.tsx')).not.toContain('useKeyboardInset(');
  });
});

describe('the attach tray', () => {
  const composer = read('components/Composer.tsx');
  const theme = read('theme.css');

  it('takes the keyboard slot on a phone so the composer does not move', () => {
    expect(composer).toContain("root.style.setProperty('--tray-inset'");
    expect(composer).toMatch(/classList\.add\('tray-open'\)/);
    expect(theme).toMatch(
      /:root\.tray-open \.composer-wrap \{[^}]*padding-bottom: calc\(4px \+ var\(--tray-inset/,
    );
    expect(theme).toMatch(/\.attach-tray \{[^}]*height: var\(--tray-inset/);
  });

  it('plays an exit and offers the camera, the photo library, and any file', () => {
    expect(composer).toMatch(/<AttachTray[\s\S]*?closing=\{trayPresence\.closing\}/);
    expect(theme).toMatch(/\.attach-tray\.closing \{[^}]*animation: tray-out/);
    const tray = read('components/AttachTray.tsx');
    for (const source of ["'camera'", "'photos'", "'files'"]) expect(tray).toContain(source);
    expect(composer).toMatch(/capture="environment"/);
  });

  it('closes when the field takes focus again, so the keyboard swaps back in', () => {
    expect(composer).toMatch(/onFocus=\{[^}]*closeTray/);
  });
});
