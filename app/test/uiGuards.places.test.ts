// The 2026-10-07 UI rules (test/support/uiGuards.ts) over the places
// package's files: the Vault, Crew and Crew command, Settings, and the guide's
// copy. uiGuards.test.ts holds every file no room package owns.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOM_FILES, offences } from './support/uiGuards.js';

const read = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

describe('the 2026-10-07 UI rules in the places rooms', () => {
  it('holds every rule in every places file', () => {
    const found = offences(ROOM_FILES.places);
    expect(found, found.join('\n  ')).toEqual([]);
  });

  // A sheet that ends in Cancel or Close names itself with SheetTitle, so a
  // screen reader announces the dialog by its title (CS-E-14).
  it('names each bare sheet title for VoiceOver', () => {
    expect(read('screens/CrewScreen.tsx')).not.toMatch(/<h2>\{?[^<]*(Edit|New) crew member/);
    expect(read('screens/CrewCommandScreen.tsx')).not.toMatch(/<h2 className="cc-sheet-title"/);
    expect(read('screens/VaultScreen.tsx')).not.toMatch(/<h2>New note<\/h2>/);
  });
});
