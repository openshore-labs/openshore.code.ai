// Who runs the show (founder, 2026-10-15): Harbor, once downloaded, can be
// the Reasoning model, and each cloud provider is one row whose models open a
// step in. Mounted in a real DOM (test/support/dom.ts) so the taps are the
// ones a person makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const shell = vi.hoisted(() => ({ desktop: false }));
vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => shell.desktop,
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
const { CLAUDE_MODELS_PRIMARY } = await import('../src/lib/claudeModels.js');

beforeEach(() => {
  shell.desktop = false;
  useApp.setState({
    view: 'stack',
    viewTrail: [],
    connectedProviders: {},
    connectivity: { homeReachable: false, online: true },
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
});

afterEach(async () => {
  await dom.render(null);
});

/** Tap something by its text, then wait out a sheet's exit. */
async function tap(el: Element | undefined): Promise<void> {
  if (!el) throw new Error('Nothing to tap');
  const { act } = await import('react');
  const { sheetExitMs } = await import('../src/lib/motion.js');
  await act(async () => {
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, sheetExitMs() + 40));
  });
}

const reasoningRow = () =>
  [...dom.container.querySelectorAll('.settings-row')].find((el) =>
    el.querySelector('.settings-row-sub')?.textContent?.startsWith('Reasoning model'),
  );
const options = () =>
  [...dom.container.querySelectorAll('.sheet:not(.closing) .profile-option-title')].map(
    (el) => el.firstChild?.textContent ?? '',
  );
const option = (name: string) =>
  [...dom.container.querySelectorAll('.sheet:not(.closing) .profile-option')].find(
    (el) => el.querySelector('.profile-option-title')?.firstChild?.textContent === name,
  );

describe('Who runs the show', () => {
  it('offers Harbor once it is downloaded, and seats it', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, harborReady: true, harborMiniReady: true },
    });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    await tap(reasoningRow());
    expect(options()).toContain('Harbor');
    await tap(option('Harbor'));
    const stacks = useApp.getState().settings.stacks;
    const seated = Object.values(stacks ?? {}).map((s) => s?.reasoning);
    expect(seated).toContainEqual(expect.objectContaining({ kind: 'device', modelId: 'harbor' }));
  });

  it('lists a cloud provider once, and its models a step in', async () => {
    useApp.setState({ connectedProviders: { anthropic: true } });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    await tap(reasoningRow());
    expect(options()).toContain('Claude');
    for (const m of CLAUDE_MODELS_PRIMARY) expect(options()).not.toContain(m.label);
    await tap(option('Claude'));
    expect(options()).toEqual(expect.arrayContaining(CLAUDE_MODELS_PRIMARY.map((m) => m.label)));
    expect(options()).toContain('Opus 5.5');
    await tap(option('Opus 5.5'));
    const seated = Object.values(useApp.getState().settings.stacks ?? {}).map((s) => s?.reasoning);
    expect(seated).toContainEqual(
      expect.objectContaining({ kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5-5' }),
    );
  });
});
