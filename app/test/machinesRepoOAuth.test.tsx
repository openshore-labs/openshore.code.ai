// Repositories' connect sheet for a one-tap platform (D14, maintainer
// 2026-10-07): the sheet leads with the sign-in, still offers the access
// token path, and when the provider refuses the redirect it shows the exact
// Callback URL to register. Mounted in a real DOM (test/support/dom.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
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

// GitHub signs in with one tap; GitLab and Bitbucket take a token.
vi.mock('../src/lib/gitos/repoOAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/gitos/repoOAuth.js')>()),
  isRepoOAuthConfigured: (id: string) => id === 'github',
  repoOAuthCallbackUrl: () => 'https://example.supabase.co/functions/v1/repo-oauth',
  repoToken: async () => 'ghu_test',
}));

// A GitHub sign-in that sees only public repositories, so its one fix is
// reconnecting.
vi.mock('../src/lib/chatRepos.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/chatRepos.js')>()),
  githubStatus: async () => ({
    repos: [],
    line: 'Signed in to GitHub as @sam, through an OAuth app.',
    hint: {
      text: 'OpenShore sees only public repositories on this sign-in.',
      action: 'Reconnect GitHub',
      reconnect: true,
    },
  }),
}));

// The DOM comes first: React DOM decides whether it has one when it loads.
const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { ReposScreen } = await import('../src/screens/ReposScreen.js');

beforeEach(() => {
  useApp.setState({
    view: 'repos',
    viewTrail: [],
    connectedRepoPlatforms: {},
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
});

afterEach(async () => {
  await dom.render(null);
});

async function tapRow(label: string): Promise<void> {
  const row = [...dom.container.querySelectorAll<HTMLElement>('.settings-row')].find(
    (el) => el.querySelector('.settings-row-label')?.textContent === label,
  );
  if (!row) throw new Error(`No "${label}" row`);
  const { act } = await import('react');
  await act(async () => {
    row.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

describe('a one-tap platform', () => {
  // The row's tap opens the sheet, and the sheet holds both doors, so the
  // row names both (copy review), never "one tap".
  it('reads Sign in, or paste an access token, and its sheet leads with the sign-in', async () => {
    await dom.render(<ReposScreen />);
    const subs = [...dom.container.querySelectorAll('.settings-row-sub')].map((s) => s.textContent);
    expect(subs).toEqual([
      'Sign in, or paste an access token',
      'Paste an access token',
      'Paste an access token',
    ]);
    await tapRow('GitHub');
    const actions = [...dom.container.querySelectorAll('.sheet .sheet-actions button')].map(
      (b) => b.textContent,
    );
    expect(actions).toEqual(['Connect GitHub', 'Use an access token instead']);
    expect(dom.container.querySelector('#repos-access-token')).toBeNull();
    await dom.click('Use an access token instead');
    expect(dom.container.querySelector('#repos-access-token')).not.toBeNull();
    expect(dom.buttons()).toContain('Save access token');
  });

  it('shows the Callback URL when the provider refuses the redirect', async () => {
    const connectRepoOAuth = vi.fn(async () => ({ ok: false as const, error: 'Refused.' }));
    useApp.setState({ connectRepoOAuth } as never);
    await dom.render(<ReposScreen />);
    await tapRow('GitHub');
    await dom.click('Connect GitHub');
    await dom.settle();
    expect(connectRepoOAuth).toHaveBeenCalledWith('github');
    expect(dom.text()).toContain('https://example.supabase.co/functions/v1/repo-oauth');
    expect(dom.buttons()).toContain('Copy Callback URL');
  });

  it('reconnects in its sheet, so a refused sign-in still shows the Callback URL', async () => {
    const disconnectRepoPlatform = vi.fn(async () => {
      useApp.setState({ connectedRepoPlatforms: {} });
    });
    const connectRepoOAuth = vi.fn(async () => ({ ok: false as const, error: 'Refused.' }));
    useApp.setState({
      connectedRepoPlatforms: { github: true },
      disconnectRepoPlatform,
      connectRepoOAuth,
    } as never);
    await dom.render(<ReposScreen />);
    await dom.settle();
    // The row says who is signed in and what it sees, in words.
    expect(dom.text()).toContain(
      'Signed in to GitHub as @sam, through an OAuth app. It sees no repositories.',
    );
    await tapRow('Reconnect GitHub');
    await dom.settle();
    expect(disconnectRepoPlatform).toHaveBeenCalledWith('github');
    expect(connectRepoOAuth).toHaveBeenCalledWith('github');
    expect(dom.container.querySelector('.sheet:not(.closing) .mode-head h2')?.textContent).toBe(
      'Connect GitHub',
    );
    expect(dom.text()).toContain('https://example.supabase.co/functions/v1/repo-oauth');
  });

  it('closes its sheet once the sign-in connects', async () => {
    const connectRepoOAuth = vi.fn(async () => {
      useApp.setState({ connectedRepoPlatforms: { github: true } });
      return { ok: true as const };
    });
    useApp.setState({ connectRepoOAuth } as never);
    await dom.render(<ReposScreen />);
    await tapRow('GitHub');
    await dom.click('Connect GitHub');
    await dom.settle();
    expect(dom.container.querySelector('.sheet:not(.closing)')).toBeNull();
    const github = [...dom.container.querySelectorAll('.settings-row')][0]!;
    expect(github.querySelector('.settings-row-value')?.textContent).toBe('Connected');
  });
});
