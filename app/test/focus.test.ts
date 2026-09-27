// The v1 focus flag (docs/v1-direction-review.md "Hide flag"): one switch
// that hides the extras, shipping OFF. Off, every room is where it was; on,
// the hidden rooms have no door left: not in the Sidebar, not in the room
// list, not through navigation, and both Currents groups read as off.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FOCUS_HIDDEN_ROOMS,
  V1_FOCUS,
  focusRequested,
  hiddenInFocus,
  visibleRooms,
} from '../src/lib/focus.js';
import { navRooms } from '../src/lib/navRooms.js';

describe('the v1 focus flag', () => {
  it('ships off: this build hides nothing', () => {
    expect(V1_FOCUS).toBe(false);
    expect(focusRequested(undefined)).toBe(false);
    expect(focusRequested({ VITE_V1_FOCUS: 'on' })).toBe(true);
    expect(focusRequested({ VITE_V1_FOCUS: 'yes' })).toBe(false);
    for (const room of FOCUS_HIDDEN_ROOMS) expect(hiddenInFocus(room)).toBe(false);
    const off = navRooms({ desktop: true, hubPaired: false });
    expect(off.primary.map((r) => r.view)).toEqual([
      'chats',
      'projects',
      'terminalroom',
      'repos',
      'stack',
      'vault',
    ]);
  });

  it('on, leaves the v1 rooms: Chats, Projects, Repositories, Stack, then Connections, Desktop + phone, Settings', () => {
    const on = navRooms({ desktop: true, hubPaired: false }, true);
    expect(on.primary.map((r) => r.view)).toEqual(['chats', 'projects', 'repos', 'stack']);
    expect(on.explore.map((r) => r.view)).toEqual(['connections', 'pair', 'settings']);
    expect(visibleRooms([{ view: 'vault' }, { view: 'chats' }], true)).toEqual([{ view: 'chats' }]);
    expect(hiddenInFocus('crew', true)).toBe(true);
    expect(hiddenInFocus('chats', true)).toBe(false);
  });

  it('gates every door: the Sidebar, navigation, and both Currents views', () => {
    const sidebar = readFileSync(join(process.cwd(), 'src', 'components', 'Sidebar.tsx'), 'utf8');
    expect(sidebar).toContain('visibleRooms(');
    expect(sidebar).toContain("hiddenInFocus('admin')");
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    const setView = store.slice(store.indexOf('    setView(view, opts) {'));
    expect(setView.slice(0, 400)).toContain('if (hiddenInFocus(view))');
    expect(store).toMatch(
      /export function agenticView\(settings: AppSettings, focus: boolean = V1_FOCUS\)/,
    );
    expect(store).toMatch(/if \(focus\) return projectHarnessSettings\(undefined/);
    const detail = readFileSync(
      join(process.cwd(), 'src', 'screens', 'ProjectDetailScreen.tsx'),
      'utf8',
    );
    expect(detail).toContain('mayEdit && !V1_FOCUS ? <ProjectCurrents');
  });

  it('turns every current off under focus', async () => {
    const { agenticView, harnessView } = await import('../src/state/store.js');
    const settings = {
      activeProjectId: 'p1',
      projects: [{ id: 'p1', name: 'P', agenticCurrent: 'hermes', harnessCurrent: 'jev' }],
    } as never;
    expect(agenticView(settings, true).agenticCurrent).toBeNull();
    expect(harnessView(settings, true).harnessCurrent).toBeNull();
  });
});
