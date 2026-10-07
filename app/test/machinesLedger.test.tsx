// Cloud Connections and Repositories in the Settings ledger (D14, founder
// 2026-10-07, built as the Creative Studio recommended, A): one row per
// provider or platform, a tap opens its connect sheet, and a connected row
// asks before it disconnects. The Stack's Image reading rows name the model
// an image goes to until the person chooses one (D13, B). Mounted in a real
// DOM (test/support/dom.ts) so the taps are the ones a person makes.
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

// The DOM comes first: React DOM decides whether it has one when it loads.
const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { PROVIDERS, providerBenchModels } = await import('../src/lib/providers.js');
const { REPO_CONNECTORS } = await import('../src/lib/repos.js');
const { claudeModelLabel, visionFallbackClaudeModel } = await import('../src/lib/claudeModels.js');

const hub = { baseUrl: 'http://100.64.0.2:4816', token: 'osc_member' };

beforeEach(() => {
  useApp.setState({
    view: 'connections',
    viewTrail: [],
    connectedProviders: {},
    connectedRepoPlatforms: {},
    connectivity: { homeReachable: false, online: true },
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
});

afterEach(async () => {
  await dom.render(null);
});

/** The ledger rows on screen, by their label. */
function rows(): Array<{ label: string; sub: string; value: string; el: HTMLElement }> {
  return [...dom.container.querySelectorAll<HTMLElement>('.settings-row')].map((el) => ({
    label: el.querySelector('.settings-row-label')?.textContent ?? '',
    sub: el.querySelector('.settings-row-sub')?.textContent ?? '',
    value: el.querySelector('.settings-row-value')?.textContent ?? '',
    el,
  }));
}

/** Tap the row with this label, the way a finger does. */
async function tapRow(label: string): Promise<void> {
  const row = rows().find((r) => r.label === label);
  if (!row) throw new Error(`No "${label}" row in: ${rows().map((r) => r.label)}`);
  const { act } = await import('react');
  await act(async () => {
    row.el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

/** A field's enterKeyHint. React writes the attribute as it is spelled in
 *  JSX, and linkedom keeps that case, where a browser would lower it. */
const keyHint = (el: HTMLInputElement) =>
  el.getAttribute('enterKeyHint') ?? el.getAttribute('enterkeyhint');

/** The open sheet's title. */
const sheetTitle = () =>
  dom.container.querySelector('.sheet:not(.closing) .mode-head h2')?.textContent ?? '';

describe('Cloud Connections in the ledger', () => {
  it('lists one row per provider with its model count, and no Connect buttons', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    const listed = rows();
    expect(listed.map((r) => r.label)).toEqual(PROVIDERS.map((p) => p.name));
    for (const p of PROVIDERS) {
      const n = providerBenchModels(p).length;
      expect(listed.find((r) => r.label === p.name)!.sub).toBe(
        `${n} ${n === 1 ? 'model' : 'models'}`,
      );
    }
    expect(dom.container.querySelector('.card')).toBeNull();
    expect(dom.buttons()).not.toContain('Connect');
  });

  it('opens the key sheet on a tap: the key link, the field, Save and Cancel', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await tapRow('Claude');
    expect(sheetTitle()).toBe('Connect Claude');
    const group = dom.container.querySelector('.sheet [data-reveal-with]')!;
    expect(group).not.toBeNull();
    const field = group.querySelector('#connections-api-key') as HTMLInputElement;
    expect(keyHint(field)).toBe('go');
    expect(group.querySelector('[data-reveal-primary]')?.textContent).toBe('Save');
    expect(dom.buttons()).toContain('Get a key ↗');
    expect(dom.buttons()).toContain('Cancel');
    // The workspace field waits until Claude asks for it.
    expect(dom.container.querySelector('#connections-workspace-id')).toBeNull();
  });

  it('marks a connected provider and asks before it disconnects', async () => {
    useApp.setState({ connectedProviders: { anthropic: true } });
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    expect(rows().find((r) => r.label === 'Claude')!.value).toBe('Connected');
    await tapRow('Claude');
    expect(dom.text()).toContain('Disconnect Claude?');
    const confirm = [...dom.container.querySelectorAll('.confirm-row button')].map(
      (b) => b.textContent,
    );
    expect(confirm).toEqual(['Keep', 'Disconnect']);
    expect(sheetTitle()).toBe('');
  });
});

describe('Repositories in the ledger', () => {
  it('keeps the computer card first, then one row per platform', async () => {
    useApp.setState({ view: 'repos' });
    const { ReposScreen } = await import('../src/screens/ReposScreen.js');
    await dom.render(<ReposScreen />);
    const text = dom.text();
    expect(text.indexOf('Your repositories live on your computer')).toBeLessThan(
      text.indexOf('Connect a platform'),
    );
    expect(rows().map((r) => r.label)).toEqual(REPO_CONNECTORS.map((c) => c.name));
    for (const r of rows()) expect(r.sub).toBe('Paste an access token');
    expect(dom.buttons()).not.toContain('Connect');
    // On your computer waits for a computer.
    expect(text).not.toContain('On your computer');
  });

  it('opens the token sheet on a tap, with Save held until a token is typed', async () => {
    useApp.setState({ view: 'repos' });
    const { ReposScreen } = await import('../src/screens/ReposScreen.js');
    await dom.render(<ReposScreen />);
    await tapRow('GitHub');
    expect(sheetTitle()).toBe('Connect GitHub');
    const group = dom.container.querySelector('.sheet [data-reveal-with]')!;
    const field = group.querySelector('#repos-access-token') as HTMLInputElement;
    expect(keyHint(field)).toBe('go');
    const save = group.querySelector('[data-reveal-primary]') as HTMLButtonElement;
    expect(save.textContent).toBe('Save access token');
    expect(save.disabled).toBe(true);
    await dom.type(field.getAttribute('placeholder')!, 'ghp_test');
    expect(save.disabled).toBe(false);
    expect(dom.buttons()).toContain('Cancel');
    expect(dom.text()).toContain('It stays on this device, never in a log.');
  });

  it('asks before a connected platform disconnects', async () => {
    useApp.setState({ view: 'repos', connectedRepoPlatforms: { gitlab: true } });
    const { ReposScreen } = await import('../src/screens/ReposScreen.js');
    await dom.render(<ReposScreen />);
    const gitlab = rows().find((r) => r.label === 'GitLab')!;
    expect(gitlab.value).toBe('Connected');
    expect(gitlab.sub).toBe('Its repositories are ready to add to a chat.');
    await tapRow('GitLab');
    expect(dom.text()).toContain('Disconnect GitLab?');
  });

  it('gives a connected computer its rows, and Clone its own sheet', async () => {
    useApp.setState({
      view: 'repos',
      settings: { ...useApp.getState().settings, daemon: hub, daemons: [hub] },
    });
    const { ReposScreen } = await import('../src/screens/ReposScreen.js');
    await dom.render(<ReposScreen />);
    expect(dom.text()).not.toContain('Your repositories live on your computer');
    expect(dom.text()).toContain('On your computer');
    await tapRow('Clone from a URL');
    expect(sheetTitle()).toBe('Clone from a URL');
    const field = dom.container.querySelector('#repos-clone-url') as HTMLInputElement;
    expect(keyHint(field)).toBe('go');
    expect(dom.container.querySelector('.sheet [data-reveal-primary]')?.textContent).toBe(
      'Clone and open a chat',
    );
  });
});

describe('the Stack names its image reader', () => {
  const reader = `Claude ${claudeModelLabel(visionFallbackClaudeModel().id)}`;
  const cloudRow = () => rows().find((r) => r.label === 'Cloud')!.sub;
  const localRow = () => rows().find((r) => r.label === 'Local')!.sub;

  it("names Claude's image reader once Claude is connected", async () => {
    useApp.setState({ view: 'stack', connectedProviders: { anthropic: true } });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(reader).toBe('Claude Haiku 4.5');
    expect(cloudRow()).toBe(`${reader}. Until you choose one. Asks before each image.`);
    expect(localRow()).toBe(`None yet · ${reader} reads images for now.`);
  });

  it('says so when no cloud model can read images', async () => {
    useApp.setState({ view: 'stack' });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(cloudRow()).toBe(
      'None yet · Connect a cloud model in Cloud Connections to read images.',
    );
    expect(localRow()).toBe('None yet · Nothing reads images.');
  });

  it('names an anchor that can see, since an image goes to it first', async () => {
    const opus = {
      kind: 'cloud' as const,
      provider: 'anthropic',
      model: 'claude-opus-5',
      label: 'Opus 5',
    };
    useApp.setState({
      view: 'stack',
      connectedProviders: { anthropic: true },
      settings: {
        ...useApp.getState().settings,
        stacks: { offshore: { reasoning: opus, active: [], saved: {} } },
      },
    });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(cloudRow()).toBe('Opus 5. Until you choose one. Asks before each image.');
  });
});
