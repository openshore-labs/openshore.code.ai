// The nav groups (founder, 2026-10-19): Chats, Projects, Stack, Agents, the
// Local Library and Cloud Connections above the recent chats, and Terminal,
// Repositories, the Vault and Computer below them, above Settings. The same
// on every device. Every room is listed exactly once. The Sidebar's default
// order reads it (sidebarOrder.test.tsx mounts it).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { navRooms } from '../src/lib/navRooms.js';

describe('navRooms', () => {
  it("puts the founder's rooms on top, in the founder's order, then the later tiers'", () => {
    expect(navRooms().primary.map((r) => r.view)).toEqual([
      'chats',
      'projects',
      'stack',
      'crew',
      'library',
      'connections',
      'stackhealth',
      'launch',
    ]);
  });

  it('puts Terminal, Repositories, the Vault and Computer below, Settings last', () => {
    expect(navRooms().explore.map((r) => r.view)).toEqual([
      'terminalroom',
      'repos',
      'vault',
      'pair',
      'settings',
    ]);
  });

  it('lists every room exactly once', () => {
    const { primary, explore } = navRooms();
    const all = [...primary, ...explore].map((r) => r.view);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(13);
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
    const { explore } = navRooms();
    expect(explore.find((r) => r.view === 'pair')?.label).toBe('Computer');
  });
});
