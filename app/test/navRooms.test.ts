// The nav split (review 6, blocker A): Terminal is day-one on a desktop or a
// phone with a paired hub, second-session on a bare phone. Every room is
// listed exactly once either way.
import { describe, expect, it } from 'vitest';
import { navRooms, terminalIsDayOne } from '../src/lib/navRooms.js';

describe('navRooms', () => {
  it('keeps Terminal third in the day-one set on a desktop', () => {
    const { primary, explore } = navRooms({ desktop: true, hubPaired: false });
    expect(primary.map((r) => r.view)).toEqual([
      'chats',
      'projects',
      'terminalroom',
      'repos',
      'stack',
      'vault',
    ]);
    expect(explore.map((r) => r.view)).not.toContain('terminalroom');
  });

  it('keeps Terminal day-one on a phone once a hub is paired', () => {
    expect(terminalIsDayOne({ desktop: false, hubPaired: true })).toBe(true);
    expect(navRooms({ desktop: false, hubPaired: true }).primary.map((r) => r.view)).toContain(
      'terminalroom',
    );
  });

  it('moves Terminal to the second-session group on a bare phone', () => {
    const { primary, explore } = navRooms({ desktop: false, hubPaired: false });
    expect(primary.map((r) => r.view)).toEqual(['chats', 'projects', 'repos', 'stack', 'vault']);
    expect(explore[0]?.view).toBe('terminalroom');
    expect(explore[explore.length - 1]?.view).toBe('settings');
  });

  it('lists every room exactly once in either layout', () => {
    for (const input of [
      { desktop: true, hubPaired: false },
      { desktop: false, hubPaired: false },
    ]) {
      const { primary, explore } = navRooms(input);
      const all = [...primary, ...explore].map((r) => r.view);
      expect(new Set(all).size).toBe(all.length);
      expect(all.length).toBe(13);
    }
  });

  it('names the pair room one way', () => {
    const { explore } = navRooms({ desktop: false, hubPaired: false });
    expect(explore.find((r) => r.view === 'pair')?.label).toBe('Desktop + phone');
  });
});
