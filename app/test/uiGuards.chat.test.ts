// The 2026-10-07 UI rules (test/support/uiGuards.ts) over the chat's own
// files: the composer, the model and mode sheets, the transcript's cards, the
// status sheet and the reply drivers.
import { describe, expect, it } from 'vitest';
import { ROOM_FILES, offences } from './support/uiGuards.js';

describe('the 2026-10-07 UI rules in the chat', () => {
  it('holds every rule in every chat file', () => {
    const found = offences(ROOM_FILES.chat);
    expect(found, found.join('\n  ')).toEqual([]);
  });
});
