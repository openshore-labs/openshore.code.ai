// Where the eye left each room. Pins the memory's contract: a saved offset
// comes back on a later recall (kept, not consumed, so an async room can
// restore twice), zero clears it, and forget clears it.
import { describe, expect, it } from 'vitest';
import { forgetScroll, recallScroll, rememberScroll } from '../src/lib/scrollMemory.js';

describe('scroll memory', () => {
  it('remembers an offset per room and keeps it across recalls', () => {
    rememberScroll('marketplace', 640);
    rememberScroll('settings', 120);
    expect(recallScroll('marketplace')).toBe(640);
    expect(recallScroll('marketplace')).toBe(640);
    expect(recallScroll('settings')).toBe(120);
  });

  it('reads zero for a room never saved, and zero clears a room', () => {
    expect(recallScroll('vault')).toBe(0);
    rememberScroll('marketplace', 0);
    expect(recallScroll('marketplace')).toBe(0);
  });

  it('forgets on request', () => {
    rememberScroll('repos', 80);
    forgetScroll('repos');
    expect(recallScroll('repos')).toBe(0);
  });
});
