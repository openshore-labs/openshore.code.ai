// The chat box review (founder, 2026-09-25: "make sure it's crisp and fully
// functional like a premium chat app"). Each guard pins one verified fix, so
// the seams stay closed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const composer = src('components/Composer.tsx');
const dictation = src('hooks/useDictation.ts');
const thread = src('components/MessageList.tsx');
const theme = src('theme.css');

describe('typing and sending', () => {
  it('never sends on the Enter that confirms an IME conversion', () => {
    expect(composer).toMatch(/e\.nativeEvent\.isComposing \|\| e\.keyCode === 229/);
  });

  it('on a phone, Return breaks a line and the button sends', () => {
    expect(composer).toMatch(/e\.key === 'Enter' && !e\.shiftKey && !isTouch\(\)/);
    expect(composer).toMatch(/enterKeyHint=\{isTouch\(\) \? 'enter' : 'send'\}/);
  });

  it('sizes the field from its value, whoever set it', () => {
    expect(composer).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?scrollHeight[\s\S]*?\}, \[value\]\)/,
    );
  });

  it('a quick second tap on send never stops the run it started', () => {
    expect(composer).toMatch(/Date\.now\(\) - lastSendAt\.current < 400/);
    expect(composer).toMatch(/onClick=\{stopTap\}/);
  });

  it('a folded paste can be queued mid-run, and terminal mode still offers stop', () => {
    expect(composer).toMatch(
      /showSend = !busy \|\| value\.trim\(\)\.length > 0 \|\| \(!terminal && pasted\.length > 0\)/,
    );
  });

  it('terminal mode resets when the chat or model changes', () => {
    expect(composer).toMatch(/useEffect\(\(\) => setTermMode\(false\), \[sourceKey\]\)/);
  });
});

describe('dictation', () => {
  it('stops on send, on typing, and before voice mode', () => {
    expect(composer).toMatch(/const resetField = \(\) => \{\s*stopDictation\(\);/);
    expect(composer).toMatch(/if \(dictation\.listening\) stopDictation\(\);/);
    expect(composer).toMatch(/stopDictation\(\);\s*if \(tray\) closeTray\(\);\s*onOpenVoice\(\);/);
  });

  it('drops late results from a stopped session and guards a double start', () => {
    expect(dictation).toMatch(/sessionRef\.current === session/);
    expect(dictation).toMatch(/if \(startingRef\.current\) return;/);
  });

  it('says why when the microphone is refused', () => {
    expect(dictation).toMatch(/onFailRef\.current\?\.\('denied'\)/);
    expect(composer).toContain('Microphone access is off.');
  });
});

describe('attachments', () => {
  it('redraws images a model cannot read, and never pastes a binary as text', () => {
    expect(composer).toMatch(
      /sendsAsIs\(f\) \? fileToAttachment\(f\) : imageToJpegAttachment\(f\)/,
    );
    expect(composer).toMatch(/await isTextFile\(f\)/);
  });

  it('the tray goes away on an outside tap, a thread scroll, or Esc', () => {
    expect(composer).toMatch(/addEventListener\('pointerdown', onDown, true\)/);
    expect(composer).toMatch(/classList\.contains\('thread'\)\) closeTray\(\)/);
  });

  it('a removed chip plays its exit', () => {
    expect(composer).toMatch(/removeChip\(/);
    expect(theme).toMatch(/\.composer-chip\.closing \{[^}]*animation: chip-out/);
  });

  it('only a drag carrying files lights the drop target', () => {
    expect(composer).toMatch(/\.includes\('Files'\)/);
  });
});

describe('menus and the toolbar row', () => {
  it('Shift+Tab cycles the mode instead of running the highlighted command', () => {
    expect(composer.match(/\(e\.key === 'Tab' && !e\.shiftKey\)/g)?.length).toBe(2);
  });

  it('a menu row tap keeps focus in the field, and the menu closes with it', () => {
    expect(composer).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
    expect(composer).toMatch(/const menu: MenuModel \| null = !focused/);
  });

  it('send keeps its shape and the model name is never a letter and an ellipsis', () => {
    expect(theme).toMatch(/\.send-btn \{[^}]*flex-shrink: 0/);
    expect(theme).toMatch(/\.composer-pill \{[^}]*min-width: 64px/);
    expect(theme).toMatch(
      /@media \(max-width: 430px\) \{[\s\S]*?\.composer-pill-mode \.composer-pill-text \{\s*display: none;/,
    );
  });

  it('the pills have a 44pt tap target', () => {
    expect(theme).toMatch(/\.composer-pill::after \{[^}]*inset: -6px 0/);
  });
});

describe('the thread around the composer', () => {
  it('a pinned reader stays on the latest when the keyboard or the field resizes the room', () => {
    expect(thread).toMatch(
      /new ResizeObserver\(\(\) => \{\s*if \(pinnedRef\.current\) followBottom\(el\)/,
    );
    expect(thread).toMatch(/behavior: 'instant'/);
    expect(thread).not.toMatch(/el\.scrollTop = el\.scrollHeight/);
  });

  it('a downward drag on the transcript puts the keyboard away', () => {
    expect(thread).toMatch(/y - startY < DISMISS_DRAG_PX/);
    expect(thread).toMatch(/const DISMISS_DRAG_PX = 16;/);
    expect(thread).toMatch(/if \(isPhone\(\)\) void Keyboard\.hide\(\)/);
  });

  it('a long todo list scrolls inside its card', () => {
    expect(theme).toMatch(/\.todo-list \{[^}]*max-height: 30vh/);
    expect(theme).toMatch(/\.composer-wrap \{\s*flex-shrink: 0;/);
  });
});
