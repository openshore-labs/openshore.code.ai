// The sidebar's two layouts (founder, 2026-09-30), with the pay gates ON (the
// build submitted to App Review). Free: Chats, Projects, Stack, Cloud
// Connections and Settings up top, then the gold Upgrade banner, then every
// Plus room greyed. With Plus: the familiar layout. The flag is read at module
// load, so the env is stubbed before the store loads; the suite runs at tier
// 4, so the later tiers' rooms show too, each on its own side of the line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

vi.stubEnv('VITE_PAY_GATES', '1');

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

const { useApp } = await import('../src/state/store.js');
const { Sidebar, UPGRADE_BANNER, PLUS_ROOM_LABEL } = await import('../src/components/Sidebar.js');

const session = {
  accessToken: 'tok',
  refreshToken: 'rt',
  expiresAt: Date.now() + 3_600_000,
  user: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', email: 'a@b.c' },
};

// A real client render: a server render reads the store's first state, not
// the one each test sets.
let dom: TestDom | undefined;

/** Each button's visible text, in order, and whether it wears the Plus grey. */
async function rows(): Promise<Array<{ text: string; plus: boolean; label: string | null }>> {
  dom ??= await mountDom();
  await dom.render(<Sidebar />);
  return [...dom.container.querySelectorAll('button')].map((b) => ({
    text: (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
    plus: b.className.includes('nav-item--plus'),
    label: b.getAttribute('aria-label'),
  }));
}

afterEach(async () => {
  await dom?.render(null);
});

beforeEach(() => {
  useApp.setState({
    authConfigured: true,
    authSession: session,
    userEntitlement: undefined,
    entitlement: undefined,
    view: 'chat',
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
});

describe('the free sidebar', () => {
  it('puts the free rooms up top, the gold banner next, and every Plus room greyed below it', async () => {
    const r = await rows();
    const texts = r.map((x) => x.text);
    const banner = texts.indexOf(UPGRADE_BANNER);
    expect(texts.slice(0, banner)).toEqual([
      'Chats',
      'Projects',
      'Stack',
      'Cloud Connections',
      'Settings',
    ]);
    expect(texts.slice(banner + 1)).toEqual([
      'Terminal',
      'Repositories',
      'Vault',
      'Crew',
      'Marketplace',
      'Stack Health',
      'Launch with Codemagic',
      'Desktop + phone',
    ]);
    expect(r.slice(0, banner + 1).every((x) => !x.plus)).toBe(true);
    expect(r.slice(banner + 1).every((x) => x.plus)).toBe(true);
  });

  it('keeps the greyed rooms live and says what they are', async () => {
    const vault = (await rows()).find((x) => x.text === 'Vault');
    expect(vault?.label).toBe(PLUS_ROOM_LABEL('Vault'));
    expect(dom!.container.querySelector('.nav-item--plus[disabled]')).toBeNull();
  });

  it('opens the paywall from the banner and from a greyed room', () => {
    useApp.getState().openPaywall('plus');
    expect(useApp.getState().paywall).toBe('plus');
    useApp.setState({ paywall: undefined });
    useApp.getState().setView('vault', { root: true });
    expect(useApp.getState().paywall).toBe('plus');
    expect(useApp.getState().view).toBe('chat');
  });

  it('shows the free layout signed out too, with the sign-in card above the banner', async () => {
    useApp.setState({ authSession: undefined });
    const texts = (await rows()).map((x) => x.text);
    const signIn = texts.findIndex((t) => t.startsWith('Sign in'));
    expect(signIn).toBeGreaterThan(texts.indexOf('Settings'));
    expect(signIn).toBeLessThan(texts.indexOf(UPGRADE_BANNER));
  });
});

describe('the Plus sidebar', () => {
  it('is the familiar layout, with no banner and nothing greyed', async () => {
    useApp.setState({ userEntitlement: { tierId: 'personal', status: 'active' } });
    const r = await rows();
    expect(r.map((x) => x.text)).toEqual([
      'Chats',
      'Projects',
      'Terminal',
      'Repositories',
      'Stack',
      'Vault',
      'Crew',
      'Marketplace',
      'Stack Health',
      'Launch with Codemagic',
      'Cloud Connections',
      'Desktop + phone',
      'Settings',
    ]);
    expect(r.some((x) => x.plus)).toBe(false);
  });
});

describe('the banner', () => {
  const theme = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');

  it('wears its own gold token in both themes, and arrives with the drawer', () => {
    expect(theme).toMatch(/\.sidebar-plus \{[^}]*background: var\(--plus\)/);
    expect(theme.match(/--plus: #/g)?.length).toBe(3);
    expect(theme).toMatch(/\.sidebar\.drawer \.sidebar-plus \{/);
  });
});
