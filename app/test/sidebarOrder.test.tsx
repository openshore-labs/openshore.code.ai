// The person's sidebar (founder, 2026-10-01): every room can be moved, in its
// group or across to the other; the recent chats sit between the groups, as
// many as fit, with View all to the Chats room; Settings and then the sign-in
// card are pinned to the bottom. The pure rules first, then the mounted
// sidebar (pay gates off, so the Plus layout every build shows today).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIVIDER,
  flatten,
  placeAt,
  recentFit,
  resolveNavOrder,
  step,
  unflatten,
  type NavOrder,
} from '../src/lib/sidebarOrder.js';
import { ROOM_LABELS } from '../src/lib/navRooms.js';
import { mountDom, type TestDom } from './support/dom.js';

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => true,
  dataUnlockState: async () => 'ok',
  openExternal: () => {},
  openInAppBrowser: () => {},
  storeGetJson: async () => undefined,
  storeSetJson: async () => {},
  storeGet: async () => null,
  storeSet: async () => {},
  storeDelete: async () => {},
  sealExistingKeys: async () => {},
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return { ...real, isConfigured: () => true };
});

const DEFAULTS: NavOrder = {
  top: ['chats', 'projects', 'repos', 'vault'],
  bottom: ['crew', 'connections', 'pair'],
};

describe('the order rules', () => {
  it('starts from the defaults', () => {
    expect(resolveNavOrder(undefined, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('keeps a saved order, across groups, and drops what this build does not show', () => {
    const saved = {
      top: ['vault', 'crew', 'chats', 'launch', 'settings'],
      bottom: ['projects', 'repos', 'connections', 'pair', 'vault'],
    } as unknown as NavOrder;
    expect(resolveNavOrder(saved, DEFAULTS)).toEqual({
      top: ['vault', 'crew', 'chats'],
      bottom: ['projects', 'repos', 'connections', 'pair'],
    });
  });

  it('places a room the saved order never knew after its default neighbour', () => {
    const saved: NavOrder = { top: ['vault', 'chats', 'projects'], bottom: ['pair', 'crew'] };
    expect(resolveNavOrder(saved, DEFAULTS)).toEqual({
      top: ['vault', 'chats', 'projects', 'repos'],
      bottom: ['pair', 'crew', 'connections'],
    });
  });

  it('moves a room across the recent chats like any other slot', () => {
    expect(step(DEFAULTS, 'vault', 1)).toEqual({
      top: ['chats', 'projects', 'repos'],
      bottom: ['vault', 'crew', 'connections', 'pair'],
    });
    expect(step(DEFAULTS, 'crew', -1)).toEqual({
      top: ['chats', 'projects', 'repos', 'vault', 'crew'],
      bottom: ['connections', 'pair'],
    });
    expect(step(DEFAULTS, 'chats', -1)).toEqual(DEFAULTS);
    expect(step(DEFAULTS, 'pair', 1)).toEqual(DEFAULTS);
  });

  it('round-trips the flat list a drag works on', () => {
    const flat = flatten(DEFAULTS);
    expect(flat[DEFAULTS.top.length]).toBe(DIVIDER);
    expect(unflatten(flat)).toEqual(DEFAULTS);
    expect(unflatten(placeAt(flat, 'chats', 99)).bottom.at(-1)).toBe('chats');
  });

  it('fits only whole recent chats, never more than there are', () => {
    expect(recentFit(300, 34, 66, 20)).toBe(6);
    expect(recentFit(300, 34, 66, 3)).toBe(3);
    expect(recentFit(60, 34, 66, 20)).toBe(0);
    expect(recentFit(0, 34, 66, 20)).toBe(0);
  });
});

const { useApp } = await import('../src/state/store.js');
const { Sidebar, defaultNavOrder } = await import('../src/components/Sidebar.js');
const { emptyThread } = await import('../src/state/types.js');

let dom: TestDom | undefined;

async function texts(): Promise<string[]> {
  dom ??= await mountDom();
  await dom.render(<Sidebar />);
  return [...dom.container.querySelectorAll('button')].map((b) =>
    (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

function chat(id: string, title: string, minutesAgo: number, said = true) {
  const thread = emptyThread();
  if (said) thread.items.push({ kind: 'user', id: `${id}-u`, text: 'hi' } as never);
  return {
    id,
    title,
    source: { kind: 'mock' },
    thread,
    updatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  } as never;
}

afterEach(async () => {
  await dom?.render(null);
});

beforeEach(() => {
  useApp.setState({
    authConfigured: true,
    authSession: undefined,
    view: 'chat',
    order: [],
    conversations: {},
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    saveSettings: async (patch) => {
      useApp.setState((s) => ({ settings: { ...s.settings, ...patch } }));
    },
  });
});

describe('the sidebar', () => {
  it('pins Settings and then the sign-in card to the bottom', async () => {
    const t = await texts();
    expect(t.at(-2)).toBe('Settings');
    expect(t.at(-1)?.startsWith('Sign in')).toBe(true);
  });

  it('renders the saved order, a room moved across the recent chats included', async () => {
    useApp.setState((s) => ({
      settings: {
        ...s.settings,
        navOrder: { top: ['vault', 'chats', 'crew'], bottom: ['projects'], v: 2 },
      } as never,
    }));
    const t = await texts();
    // Rooms the saved order never named find their default neighbours: on
    // this phone with no computer, Terminal's is the Vault (D10).
    expect(t.slice(0, 3)).toEqual(['Vault', 'Terminal', 'Chats']);
    expect(t.indexOf('Crew')).toBeLessThan(t.indexOf('Projects'));
    expect(t.indexOf('Settings')).toBe(t.length - 2);
  });

  it('shows the recent chats newest first, skips an empty new chat, and offers View all', async () => {
    useApp.setState({
      order: ['a', 'b', 'c'],
      conversations: {
        a: chat('a', 'Older plan', 90),
        b: chat('b', 'Newest fix', 2),
        c: chat('c', 'New chat', 1, false),
      },
    });
    const t = await texts();
    const newest = t.indexOf('Newest fix');
    expect(newest).toBeGreaterThan(t.indexOf('Vault'));
    expect(t[newest + 1]).toBe('Older plan');
    expect(t[newest + 2]).toBe('View all');
    expect(t).not.toContain('New chat');
    await dom!.click('View all');
    expect(useApp.getState().view).toBe('chats');
  });

  it('opens a recent chat in one tap', async () => {
    useApp.setState({ order: ['a'], conversations: { a: chat('a', 'Older plan', 90) } });
    await texts();
    await dom!.click('Older plan');
    expect(useApp.getState().activeId).toBe('a');
    expect(useApp.getState().view).toBe('chat');
  });

  it('moves a room with the keyboard and saves the order', async () => {
    await texts();
    const vault = [...dom!.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Vault',
    )!;
    const { act } = await import('react');
    await act(async () => {
      const ev = new window.Event('keydown', { bubbles: true });
      Object.assign(ev, { key: 'ArrowDown', altKey: true });
      vault.dispatchEvent(ev);
    });
    const saved = useApp.getState().settings.navOrder;
    // One step down, past Terminal, the room that sits under the Vault on a
    // phone with no computer (D10).
    expect(saved?.top.indexOf('vault')).toBe(saved!.top.indexOf('terminalroom') + 1);
    expect(saved?.v).toBe(2);
  });

  // Founder, 2026-10-01: no separate section. Crew, Cloud Connections and the
  // pairing room sit straight under the Vault (after Terminal, on a phone
  // with no computer), and an order saved under the old two-group default is
  // set aside once so they come up there.
  it('puts every room in one group under the Vault, setting an old order aside once', async () => {
    useApp.setState((s) => ({
      settings: {
        ...s.settings,
        navOrder: { top: ['chats', 'vault'], bottom: ['crew', 'connections', 'pair'] },
      } as never,
    }));
    const t = await texts();
    const vault = t.indexOf('Vault');
    expect(t.slice(vault + 1, vault + 5)).toEqual([
      'Terminal',
      'Crew',
      'Cloud Connections',
      ROOM_LABELS.pair,
    ]);
    expect(t.indexOf(ROOM_LABELS.pair)).toBeLessThan(t.indexOf('Settings'));
  });
});

// D10 (founder, 2026-10-07): the default order comes from navRooms for this
// device. On a phone with no computer, Terminal is only a setup page, so it
// waits after the Vault; it moves up to third the day the phone pairs, for
// anyone who never moved a row, and a saved order still wins.
describe('the default order per device', () => {
  const PAIRED = { baseUrl: 'http://100.64.0.2:7337', token: 't', name: 'Desk' };

  it('puts Terminal third on a desktop or a paired phone, after the Vault on a bare phone', () => {
    const third = (device: { desktop: boolean; hubPaired: boolean }) =>
      defaultNavOrder(device).top.indexOf('terminalroom');
    expect(third({ desktop: true, hubPaired: false })).toBe(2);
    expect(third({ desktop: false, hubPaired: true })).toBe(2);
    const bare = defaultNavOrder({ desktop: false, hubPaired: false }).top;
    expect(bare.indexOf('terminalroom')).toBe(bare.indexOf('vault') + 1);
    expect(bare).not.toContain('settings');
    expect(defaultNavOrder({ desktop: false, hubPaired: false }).bottom).toEqual([]);
  });

  it('moves Terminal up when the phone pairs, for someone who never moved a row', async () => {
    let t = await texts();
    expect(t.indexOf('Terminal')).toBe(t.indexOf('Vault') + 1);
    useApp.setState((s) => ({ settings: { ...s.settings, daemon: PAIRED } as never }));
    t = await texts();
    expect(t.slice(0, 3)).toEqual(['Chats', 'Projects', 'Terminal']);
  });

  it('keeps a saved order once the phone pairs', async () => {
    useApp.setState((s) => ({
      settings: {
        ...s.settings,
        daemon: PAIRED,
        navOrder: { ...defaultNavOrder({ desktop: false, hubPaired: false }), v: 2 },
      } as never,
    }));
    const t = await texts();
    expect(t.indexOf('Terminal')).toBe(t.indexOf('Vault') + 1);
  });
});

describe('the motion', () => {
  const theme = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');
  it('moves a row on transform alone, settles it on the spring, and arrives with the drawer', () => {
    expect(theme).toMatch(
      /\.nav-item--movable,\n\.sidebar-recents \{[^}]*transform var\(--dur-3\)/,
    );
    expect(theme).toMatch(/\.nav-item--movable\.nav-settling \{[^}]*var\(--ease-spring\)/);
    expect(theme).toMatch(/\.sidebar\.drawer \.sidebar-recents,/);
  });
});
