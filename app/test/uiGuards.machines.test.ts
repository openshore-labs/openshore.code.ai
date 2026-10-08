// The 2026-10-07 UI rules (test/support/uiGuards.ts) over the machines
// package's files: Pairing, the Terminal rooms, Repositories, Cloud
// Connections and the Stack. uiGuards.test.ts holds every file no room
// package owns.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOM_FILES, offences, stripComments } from './support/uiGuards.js';

const read = (rel: string) =>
  stripComments(readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8'));

describe('the 2026-10-07 UI rules in the machines rooms', () => {
  it('holds every rule in every machines file', () => {
    const found = offences(ROOM_FILES.machines);
    expect(found, found.join('\n  ')).toEqual([]);
  });

  // A Stack sheet names itself with SheetTitle, so a screen reader announces
  // the dialog by it, and its more button is drawn, never a typed ellipsis
  // (CS-E-14).
  it('names every Stack sheet and draws its more glyph', () => {
    const stack = read('components/StackManager.tsx');
    expect(stack).not.toMatch(/<h2/);
    expect(stack).not.toContain('⋯');
  });

  // Repositories heads its sections with the shared section head, never a
  // bare h3 styled in place (CS-E-05).
  it('heads the Repositories sections with .section-head', () => {
    expect(read('screens/ReposScreen.tsx')).not.toMatch(/<h3 style=/);
  });
});
