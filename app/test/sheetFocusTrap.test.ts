// Sheets behave like dialogs: focus wraps inside the open one. The wrap logic
// is pure so it is pinned here, and the App must wire the trap (a sheet that
// lets Tab escape onto the page behind it is the bug this closes). UI-9 widened
// it: confirm cards and the drawer are dialogs too, the opener gets focus back,
// and the observer never walks the document for a streamed token.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIALOG,
  mutationTouchesDialog,
  nextFocus,
  type MutationLike,
} from '../src/hooks/useSheetFocusTrap.js';

const el = (id: string) => ({ id }) as unknown as HTMLElement;

/** A fake node: an element that matches (or contains) a dialog, or not. */
function node(kind: 'text' | 'plain' | 'dialog' | 'holder'): Node {
  if (kind === 'text') return { nodeType: 3 } as unknown as Node;
  return {
    nodeType: 1,
    matches: () => kind === 'dialog',
    querySelector: () => (kind === 'holder' ? {} : null),
  } as unknown as Node;
}
const record = (added: Node[], removed: Node[] = []): MutationLike => ({
  addedNodes: added,
  removedNodes: removed,
});

describe('sheet focus trap', () => {
  const a = el('a');
  const b = el('b');
  const c = el('c');

  it('wraps forward from the last control to the first', () => {
    expect(nextFocus([a, b, c], c, false)).toBe(a);
    expect(nextFocus([a, b, c], a, false)).toBe(b);
  });

  it('wraps backward from the first control to the last', () => {
    expect(nextFocus([a, b, c], a, true)).toBe(c);
    expect(nextFocus([a, b, c], c, true)).toBe(b);
  });

  it('enters at the first (or last, going backward) when focus is outside the sheet', () => {
    expect(nextFocus([a, b, c], null, false)).toBe(a);
    expect(nextFocus([a, b, c], null, true)).toBe(c);
    expect(nextFocus([], null, false)).toBeUndefined();
  });

  it('treats confirm cards and the drawer as dialogs, not only sheets (UI-9)', () => {
    expect(DIALOG).toContain('.sheet:not(.closing)');
    expect(DIALOG).toContain('.confirm-card:not(.closing)');
    expect(DIALOG).toContain('.sidebar.drawer:not(.closing)');
  });

  it('ignores streamed text and plain nodes, reacts to a dialog root arriving or leaving', () => {
    expect(mutationTouchesDialog([record([node('text')])])).toBe(false);
    expect(mutationTouchesDialog([record([node('plain')])])).toBe(false);
    expect(mutationTouchesDialog([record([node('dialog')])])).toBe(true);
    expect(mutationTouchesDialog([record([node('holder')])])).toBe(true);
    expect(mutationTouchesDialog([record([], [node('dialog')])])).toBe(true);
    expect(mutationTouchesDialog([])).toBe(false);
  });

  it('is wired at the app root so every sheet is covered, and hands focus back', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain('useSheetFocusTrap()');
    const hook = readFileSync(join(process.cwd(), 'src/hooks/useSheetFocusTrap.ts'), 'utf8');
    expect(hook).toMatch(/opener\.focus\(\)/);
    expect(hook).toMatch(/mutationTouchesDialog\(records\)/);
  });

  it('labels the composer field and keeps the greeting a heading with a real button', () => {
    const composer = readFileSync(join(process.cwd(), 'src/components/Composer.tsx'), 'utf8');
    const area = composer.slice(composer.indexOf('<textarea'), composer.indexOf('<textarea') + 400);
    expect(area).toMatch(/aria-label=/);
    const chat = readFileSync(join(process.cwd(), 'src/screens/ChatScreen.tsx'), 'utf8');
    expect(chat).not.toMatch(/<h1[^>]*role="button"/);
    expect(chat).toMatch(/<h1 className="greeting-heading">\s*<button/);
  });
});
