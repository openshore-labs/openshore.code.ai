import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELD_MESSAGE_KEPT, restoreFromHeld } from '../src/lib/heldMessage.js';

describe('held first message', () => {
  it('hands the text back with a fresh seq each time', () => {
    const first = restoreFromHeld({ text: 'build the sign-in screen' });
    expect(first).toEqual({ seq: 1, text: 'build the sign-in screen' });
    const again = restoreFromHeld({ text: 'build the sign-in screen' }, first);
    expect(again.seq).toBe(2);
  });

  it('keeps the attachments', () => {
    const att = { id: 'a', name: 'x.png', isImage: true } as never;
    expect(restoreFromHeld({ text: '', attachments: [att] }).attachments).toEqual([att]);
  });

  it('says the message was kept', () => {
    expect(HELD_MESSAGE_KEPT).toBe("Kept your message. Pick a model when you're ready.");
  });

  it('the chat screen restores the held message when the chooser closes', () => {
    const src = readFileSync(new URL('../src/screens/ChatScreen.tsx', import.meta.url), 'utf8');
    const onClose = src.slice(src.indexOf('onClose={() => {\n            setSheetOpen(false);'));
    expect(onClose).toMatch(/restoreFromHeld\(/);
    expect(onClose).toMatch(/HELD_MESSAGE_KEPT/);
    expect(src).toMatch(/restore=\{restore\}/);
  });
});
