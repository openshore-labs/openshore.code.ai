// Release tiers (2026-09-27; docs/release-tiers.md). A build is
// Personal unless it says otherwise, and a later tier's surfaces have no door
// in an earlier build: not in the Sidebar, not in the room list, not through
// navigation, and no current is on anywhere. The suite itself runs at tier 4
// (vite.config.ts) so every tier's code stays tested; these tests pass the
// tier explicitly to pin what a Personal build carries.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FEATURE_TIER,
  RELEASE_TIER,
  featureOn,
  roomOpen,
  tierFrom,
  visibleRooms,
  type TieredFeature,
} from '../src/lib/focus.js';
import { navRooms } from '../src/lib/navRooms.js';

const root = join(process.cwd(), '..');
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('which tier a build carries', () => {
  it('is Personal unless VITE_RELEASE_TIER names a later one', () => {
    expect(tierFrom(undefined)).toBe(1);
    expect(tierFrom({})).toBe(1);
    expect(tierFrom({ VITE_RELEASE_TIER: '3' })).toBe(3);
    for (const junk of ['0', '5', 'all', 'enterprise', ' ']) {
      expect(tierFrom({ VITE_RELEASE_TIER: junk }), junk).toBe(1);
    }
    // The suite runs at tier 4 so the later tiers' code stays tested.
    expect(RELEASE_TIER).toBe(4);
  });

  it('no shipped build asks for a later tier', () => {
    for (const file of [
      join(root, '.github', 'workflows', 'release.yml'),
      join(root, 'codemagic.yaml'),
      join(process.cwd(), '.env'),
      join(process.cwd(), '.env.production'),
    ]) {
      if (!existsSync(file)) continue;
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/VITE_RELEASE_TIER/);
    }
    // Only the test block of the Vite config raises it.
    const vite = read('vite.config.ts');
    expect(vite.slice(0, vite.indexOf('test: {'))).not.toMatch(/VITE_RELEASE_TIER/);
  });

  it("places each feature in a maintainer's tier", () => {
    expect(FEATURE_TIER).toEqual({
      currents: 2,
      stackhealth: 2,
      launch: 2,
      admin: 4,
      teams: 4,
      hubMembers: 4,
    });
  });
});

describe('a Personal build', () => {
  it('shows the v1 rooms, Crew, Terminal and the Marketplace included, and nothing later', () => {
    const desk = navRooms({ desktop: true, hubPaired: false }, 1);
    expect(desk.primary.map((r) => r.view)).toEqual([
      'chats',
      'projects',
      'terminalroom',
      'repos',
      'stack',
      'vault',
    ]);
    expect(desk.explore.map((r) => r.view)).toEqual([
      'crew',
      'connections',
      'pair',
      'marketplace',
      'settings',
    ]);
    for (const view of ['stackhealth', 'launch', 'admin']) {
      expect(roomOpen(view, 1), view).toBe(false);
    }
    for (const view of [
      'chats',
      'crew',
      'terminalroom',
      'vault',
      'pair',
      'marketplace',
      'settings',
    ]) {
      expect(roomOpen(view, 1), view).toBe(true);
    }
    // The Marketplace is a v1 room since 2026-10-11.
    expect(
      visibleRooms([{ view: 'launch' }, { view: 'marketplace' }, { view: 'crew' }], 1),
    ).toEqual([{ view: 'marketplace' }, { view: 'crew' }]);
  });

  it('each later tier opens its own rooms and keeps the next one shut', () => {
    expect(roomOpen('stackhealth', 2)).toBe(true);
    expect(roomOpen('marketplace', 1)).toBe(true);
    expect(roomOpen('admin', 3)).toBe(false);
    expect(roomOpen('admin', 4)).toBe(true);
    expect(featureOn('currents', 1)).toBe(false);
    expect(featureOn('teams', 4)).toBe(true);
  });

  it('turns every current off', async () => {
    const { agenticView, harnessView } = await import('../src/state/store.js');
    const settings = {
      activeProjectId: 'p1',
      projects: [{ id: 'p1', name: 'P', agenticCurrent: 'hermes', harnessCurrent: 'jev' }],
    } as never;
    expect(agenticView(settings, 1).agenticCurrent).toBeNull();
    expect(harnessView(settings, 1).harnessCurrent).toBeNull();
    expect(agenticView(settings, 2).agenticCurrent).toBe('hermes');
  });

  it('gates every door through the one module', () => {
    // The Sidebar's rooms come from navRooms (D10), which gates them.
    const sidebar = read('src', 'components', 'Sidebar.tsx');
    expect(sidebar).toContain('navRooms(device)');
    expect(read('src', 'lib', 'navRooms.ts')).toContain('visibleRooms(');
    expect(sidebar).toContain("roomOpen('admin')");
    const store = read('src', 'state', 'store.ts');
    const setView = store.slice(store.indexOf('    setView(view, opts) {'));
    expect(setView.slice(0, 400)).toContain('if (!roomOpen(view))');
    const detail = read('src', 'screens', 'ProjectDetailScreen.tsx');
    expect(detail).toMatch(/mayEdit && featureOn\('currents'\) \?\s*\(?\s*<ProjectCurrents/);
  });
});

describe('the build-time gates', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // RELEASE_TIER is spelled inline (so the bundler folds it) and each SHIPS_
  // constant repeats a tier from FEATURE_TIER (so it folds too). Reload the
  // module at every tier and hold both to the one rule.
  it('agree with tierFrom and featureOn at every tier', async () => {
    const SHIPS: Record<TieredFeature, string> = {
      currents: 'SHIPS_CURRENTS',
      stackhealth: 'SHIPS_STACKHEALTH',
      launch: 'SHIPS_LAUNCH',
      admin: 'SHIPS_ADMIN',
      teams: 'SHIPS_TEAMS',
      hubMembers: 'SHIPS_HUBMEMBERS',
    };
    for (const raw of ['', '1', '2', ' 3 ', '4', '5', 'all']) {
      vi.stubEnv('VITE_RELEASE_TIER', raw);
      vi.resetModules();
      const focus = (await import('../src/lib/focus.js')) as unknown as Record<string, unknown> &
        typeof import('../src/lib/focus.js');
      expect(focus.RELEASE_TIER, raw).toBe(tierFrom({ VITE_RELEASE_TIER: raw }));
      for (const feature of Object.keys(FEATURE_TIER) as TieredFeature[]) {
        expect(focus[SHIPS[feature]], `${SHIPS[feature]} at "${raw}"`).toBe(
          featureOn(feature, focus.RELEASE_TIER),
        );
      }
    }
  });
});
