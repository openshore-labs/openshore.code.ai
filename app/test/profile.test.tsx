// The profile (founder, 2026-10-02): signed in, the sidebar's account card
// names the account and opens the profile sheet, a standard set: what
// follows you between devices, privacy and help, sign-in, delete.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import {
  FOLLOWS_LABEL,
  accountInitial,
  followingKeys,
  followsLabel,
  followsLine,
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
  it('hands Settings one landing, taken once', async () => {
    const { useSettingsJump, FOLLOWS_GROUP_ID } = await import('../src/lib/profile.js');
    useSettingsJump.getState().jump(FOLLOWS_GROUP_ID);
    expect(useSettingsJump.getState().take()).toBe(FOLLOWS_GROUP_ID);
    expect(useSettingsJump.getState().take()).toBeUndefined();
  });

  it('names every preference that follows a signed-in person, in plain words', () => {
    const keys = followingKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(FOLLOWS_LABEL[k], String(k)).toBeTruthy();
      expect(followsLine().toLowerCase()).toContain(followsLabel(k).toLowerCase());
    }
    expect(followsLine()).toBe(
      'Appearance, effort, Humanize Writing, Chain of Thought, notices, and voice.',
    );
  });

  // egress-claims-4 (sp-plan): the signed-in card named four of the six.
  // It now reads the same list, and the sign-in sheets list none of them.
  it('names every preference that follows on the signed-in card, from the one list', async () => {
    const { SIGNED_IN_PERKS, ACCOUNT_GATE_BODY } = await import('../src/lib/accountGate.js');
    for (const k of followingKeys()) {
      expect(SIGNED_IN_PERKS.toLowerCase(), String(k)).toContain(followsLabel(k).toLowerCase());
    }
    expect(SIGNED_IN_PERKS).toBe(
      'These follow you to every device you sign in on: appearance, effort, Humanize Writing, Chain of Thought, notices, and voice. Signing out keeps everything on this device.',
    );
    expect(ACCOUNT_GATE_BODY).toMatch(/takes your theme and a few preferences to every device/);
    // What leaves this device names them in the same words (one name per
    // thing, sign-off): it said theme, reasoning and humanized writing.
    const { EGRESS } = await import('../src/lib/egressManifest.js');
    expect(EGRESS.find((e) => e.id === 'preferences')!.what).toBe(
      'Your app preferences, so they follow you to your other devices: appearance, effort, Humanize Writing, Chain of Thought, notices, and voice. Never your chats, prompts, projects, keys, or addresses.',
    );
  });

  it('draws the avatar from the email', () => {
    expect(accountInitial('founder@openshore.ai')).toBe('F');
    expect(accountInitial(undefined)).toBe('?');
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
    // Nothing is sold in this build, so no plan line, and never "beta" (2.2).
    expect(card?.textContent).not.toMatch(/beta|Free/);

    card!.click();
    await dom.settle();
    expect(useProfileSheet.getState().open).toBe(true);
    const sheet = dom.text();
    for (const part of [
      'Profile',
      'Preferences that follow you',
      'What leaves this device',
      'Contact support',
      'Not copied to your account',
      'Sign out',
    ]) {
      expect(sheet, part).toContain(part);
    }
    // Said once, by the profile's own row (CX, 2026-10-02).
    const { SIGNED_IN_PERKS } = await import('../src/lib/accountGate.js');
    expect(sheet).not.toContain(SIGNED_IN_PERKS);
    // Never claims more than the code does (CTO, 2026-10-02). The suite runs
    // at tier 4, where teams keep rows on our server, so the line claims only
    // the person's own and names what a team keeps (privacy review,
    // 2026-10-08); a Personal build's line is in tierPersonal.test.ts.
    expect(sheet).not.toMatch(/stay on the device they were made on/);
    expect(sheet).toContain(
      'OpenShore does not copy your own chats, projects, keys, or vault to your account.',
    );
    expect(sheet).toContain('the addresses it invites are kept on our server');
    expect(sheet).not.toMatch(/beta|OpenShore Plus/);
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

describe('no beta or test-build wording a reviewer could see (App Review 2.2)', () => {
  it('Settings and the profile never call the app a beta or a test build', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const file of [
      ['src', 'screens', 'SettingsScreen.tsx'],
      ['src', 'components', 'ProfileSheet.tsx'],
      ['src', 'components', 'Sidebar.tsx'],
      ['src', 'lib', 'profile.ts'],
    ]) {
      const src = readFileSync(join(process.cwd(), ...file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      expect(src, file.join('/')).not.toMatch(/['"`][^'"`]*\b(beta|test build)\b[^'"`]*['"`]/i);
    }
  });
});
