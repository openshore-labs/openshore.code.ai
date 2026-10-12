// The nav split (review 6, blocker A): Terminal is day-one on a desktop or a
// phone with a paired computer, second-session on a bare phone. Every room is
// listed exactly once either way. The Sidebar's default order reads it (D10,
// 2026-10-07; sidebarOrder.test.tsx mounts it).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  // The order the sidebar has always shown (2026-10-01): Crew, Cloud
  // Connections and Pairing straight under the day-one rooms, the later
  // tiers' rooms after them, Settings last.
  it('keeps Crew, Cloud Connections and Pairing first among the rest', () => {
    for (const input of [
      { desktop: true, hubPaired: false },
      { desktop: false, hubPaired: true },
    ]) {
      expect(navRooms(input).explore.map((r) => r.view)).toEqual([
        'crew',
        'connections',
        'pair',
        'marketplace',
        'stackhealth',
        'launch',
        'settings',
      ]);
    }
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

  // The current room is a filled row with aria-current, not a tint alone, and
  // a page inside a room keeps that room lit (design review, 2026-10-07).
  it('marks the current room by more than colour', () => {
    const sidebar = readFileSync(join(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');
    expect(sidebar).toContain("aria-current={lit === v ? 'page' : undefined}");
    expect(sidebar).toContain("project: 'projects'");
    const theme = readFileSync(join(process.cwd(), 'src/theme.css'), 'utf8');
    expect(theme).toMatch(/\.nav-item\.active \{[^}]*background: var\(--surface\)/);
  });

  it('names the pair room one way', () => {
    const { explore } = navRooms({ desktop: false, hubPaired: false });
    expect(explore.find((r) => r.view === 'pair')?.label).toBe('Computer');
  });
});
