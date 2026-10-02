// The profile (founder, 2026-10-02): signed in, the sidebar's account card
// names the account and opens the profile sheet, a standard set: plan, what
// follows you between devices, privacy and help, sign-in, delete.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import {
  FOLLOWS_LABEL,
  accountInitial,
  followingKeys,
  followsLabel,
  followsLine,
  planStanding,
  useProfileSheet,
} from '../src/lib/profile.js';

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

describe('the profile rules', () => {
  it('names every preference that follows a signed-in person, in plain words', () => {
    const keys = followingKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(FOLLOWS_LABEL[k], String(k)).toBeTruthy();
      expect(followsLine().toLowerCase()).toContain(followsLabel(k).toLowerCase());
    }
    expect(followsLine()).toMatch(/^Appearance, .+, and .+ follow you to every device/);
  });

  it('draws the avatar from the email', () => {
    expect(accountInitial('founder@openshore.ai')).toBe('F');
    expect(accountInitial(undefined)).toBe('?');
  });

  it('says the plan plainly with the gates off and on', () => {
    expect(planStanding({ gates: false, unlocked: true }).short).toBe('Free in the beta');
    expect(planStanding({ gates: true, unlocked: true }).short).toBe('OpenShore Plus');
    expect(planStanding({ gates: true, unlocked: false }).short).toBe('Free');
  });
});

const { useApp } = await import('../src/state/store.js');
const { Sidebar } = await import('../src/components/Sidebar.js');
const { ProfileSheet } = await import('../src/components/ProfileSheet.js');

let dom: TestDom | undefined;

beforeEach(() => {
  useProfileSheet.setState({ open: false });
  useApp.setState({
    authConfigured: true,
    authSession: { user: { email: 'founder@openshore.ai' } } as never,
    view: 'chat',
    order: [],
    conversations: {},
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    saveSettings: async (patch) => {
      useApp.setState((s) => ({ settings: { ...s.settings, ...patch } }));
    },
  });
});

afterEach(async () => {
  await dom?.render(null);
});

describe('signed in', () => {
  it('the sign-in card becomes the account card, named, and opens the profile', async () => {
    dom ??= await mountDom();
    await dom.render(
      <>
        <Sidebar />
        <ProfileSheet />
      </>,
    );
    const buttons = [...dom.container.querySelectorAll('button')];
    const texts = buttons.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(texts.at(-2)).toBe('Settings');
    expect(texts.some((t) => t.startsWith('Sign in'))).toBe(false);
    const card = dom.container.querySelector<HTMLButtonElement>('.sidebar-account');
    expect(card?.textContent).toContain('founder@openshore.ai');
    expect(card?.textContent).toContain('Free in the beta');

    card!.click();
    await dom.settle();
    expect(useProfileSheet.getState().open).toBe(true);
    const sheet = dom.text();
    for (const part of [
      'Profile',
      'OpenShore Plus',
      'Preferences that follow you',
      'What leaves this device',
      'Contact support',
      'Sign out',
    ]) {
      expect(sheet, part).toContain(part);
    }
  });

  it('signed out, the card still says Sign in and the profile stays shut', async () => {
    useApp.setState({ authSession: undefined });
    useProfileSheet.setState({ open: true });
    dom ??= await mountDom();
    await dom.render(
      <>
        <Sidebar />
        <ProfileSheet />
      </>,
    );
    expect(dom.container.querySelector('.sidebar-account')).toBeNull();
    expect(dom.text()).not.toContain('Preferences that follow you');
  });
});
