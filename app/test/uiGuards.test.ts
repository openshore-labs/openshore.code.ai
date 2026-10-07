// The 2026-10-07 UI rules (test/support/uiGuards.ts) over every file no room
// package owns. Each room's uiGuards.<room>.test.ts holds its own files, so
// between them every source file falls under the same rules.
import { describe, expect, it } from 'vitest';
import { ROOM_FILES, offences, restFiles } from './support/uiGuards.js';

describe('the 2026-10-07 UI rules', () => {
  it('holds the 2026-10-07 UI rules in every file no room package owns', () => {
    const rest = restFiles();
    expect(rest).toContain('components/SheetGlyphs.tsx');
    const found = offences(rest);
    expect(found, found.join('\n  ')).toEqual([]);
  });

  it('lists each room file once', () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const [room, files] of Object.entries(ROOM_FILES)) {
      for (const file of files) {
        if (seen.has(file)) twice.push(`${file} in ${seen.get(file)} and ${room}`);
        else seen.set(file, room);
      }
    }
    expect(twice).toEqual([]);
  });
});
