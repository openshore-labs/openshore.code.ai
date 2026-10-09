// Cloud Connections and Repositories in the Settings ledger (D14, founder
// 2026-10-07, built as the Creative Studio recommended, A): one row per
// provider or platform, a tap opens its connect sheet, and a connected row
// asks before it disconnects. The Stack's Image reading rows name the model
// an image goes to until the person chooses one (D13, B). Mounted in a real
// DOM (test/support/dom.ts) so the taps are the ones a person makes.
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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
const { PROVIDERS, providerBenchModels } = await import('../src/lib/providers.js');
const { REPO_CONNECTORS } = await import('../src/lib/repos.js');
const { claudeModelLabel, visionFallbackClaudeModel } = await import('../src/lib/claudeModels.js');

const hub = { baseUrl: 'http://100.64.0.2:4816', token: 'osc_member' };

beforeEach(() => {
  shell.desktop = false;
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

/** A form sheet has one way out, the round close (2026-10-07, the same exit
 *  as New project): its head sits straight in the sheet, where it stays in
 *  view while the sheet scrolls, and the body ends in no Cancel. */
function expectOneWayOut(): void {
  const sheet = dom.container.querySelector('.sheet:not(.closing)')!;
  const head = [...sheet.children].find((el) => el.classList.contains('mode-head'));
  expect(head?.querySelector('.mode-close')).toBeTruthy();
  expect(dom.buttons()).not.toContain('Cancel');
}

/** The familiar seven, and the named providers that wait under More
 *  providers until their key is in (2026-10-09). */
const FAMILIAR = PROVIDERS.filter((p) => !p.more);
const NAMED = PROVIDERS.filter((p) => p.more);

/** The rows in the open sheet, by their label. */
const sheetRows = () =>
  [...dom.container.querySelectorAll<HTMLElement>('.sheet:not(.closing) .settings-row')].map(
    (el) => el.querySelector('.settings-row-label')?.textContent ?? '',
  );

/** Tap a row in the open sheet, then wait out its exit. */
async function tapSheetRow(label: string): Promise<void> {
  const el = [
    ...dom.container.querySelectorAll<HTMLElement>('.sheet:not(.closing) .settings-row'),
  ].find((r) => r.querySelector('.settings-row-label')?.textContent === label);
  if (!el) throw new Error(`No "${label}" row in the sheet: ${sheetRows()}`);
  const { act } = await import('react');
  const { sheetExitMs } = await import('../src/lib/motion.js');
  await act(async () => {
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, sheetExitMs() + 40));
  });
}

describe('Cloud Connections in the ledger', () => {
  it('lists one row per provider with its model count, and no Connect buttons', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    const listed = rows();
    // Your server leads (connect-anywhere, 2026-10-07), then the familiar
    // seven, then one row for the named providers on your key, and on a
    // phone one for any other provider, by its address (2026-10-09).
    expect(listed.map((r) => r.label)).toEqual([
      'Set up a server',
      ...FAMILIAR.map((p) => p.name),
      'More providers',
      'Any other provider',
    ]);
    expect(FAMILIAR.map((p) => p.id)).toEqual([
      'anthropic',
      'openai',
      'google',
      'moonshot',
      'perplexity',
      'venice',
      'openrouter',
    ]);
    expect(listed.find((r) => r.label === 'More providers')!.sub).toBe(
      `Groq, Together AI, DeepSeek, and ${NAMED.length - 3} more, each on your own key.`,
    );
    for (const p of FAMILIAR) {
      const n = providerBenchModels(p).length;
      expect(listed.find((r) => r.label === p.name)!.sub).toBe(
        p.liveModels
          ? `Its models load from ${p.name} once your key is in.`
          : `${n} ${n === 1 ? 'model' : 'models'}`,
      );
    }
    expect(dom.container.querySelector('.card')).toBeNull();
    expect(dom.buttons()).not.toContain('Connect');
  });

  it('opens the key sheet on a tap: the key link, the field and Save', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await tapRow('Claude');
    expect(sheetTitle()).toBe('Connect Claude');
    const group = dom.container.querySelector('.sheet [data-reveal-with]')!;
    expect(group).not.toBeNull();
    const field = group.querySelector('#connections-api-key') as HTMLInputElement;
    expect(keyHint(field)).toBe('go');
    const save = group.querySelector('[data-reveal-primary]') as HTMLButtonElement;
    expect(save.textContent).toBe('Save');
    // Save waits for a key to check.
    expect(save.disabled).toBe(true);
    await dom.type(field.getAttribute('placeholder')!, 'sk-ant-test');
    expect(save.disabled).toBe(false);
    // The way out is drawn, never a typed arrow (CS-19).
    expect(dom.buttons()).toContain('Get a key ');
    const getKey = [...dom.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Get a key ',
    )!;
    expect(getKey.querySelector('svg.external-glyph')).not.toBeNull();
    expectOneWayOut();
    // The workspace field waits until Claude asks for it.
    expect(dom.container.querySelector('#connections-workspace-id')).toBeNull();
  });

  it('marks a connected provider and asks before it disconnects', async () => {
    useApp.setState({ connectedProviders: { anthropic: true } });
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    const claude = rows().find((r) => r.label === 'Claude')!;
    expect(claude.value).toBe('Connected');
    const n = providerBenchModels(PROVIDERS.find((p) => p.name === 'Claude')!).length;
    expect(claude.sub).toBe(`Its ${n} models are on your bench.`);
    // Its tap asks a question, so it draws no chevron (SettingsRow's grammar).
    expect(claude.el.querySelector('.disclosure-chevron')).toBeNull();
    await tapRow('Claude');
    expect(dom.text()).toContain('Disconnect Claude?');
    const confirm = [...dom.container.querySelectorAll('.confirm-row button')].map(
      (b) => b.textContent,
    );
    expect(confirm).toEqual(['Keep', 'Disconnect']);
    expect(sheetTitle()).toBe('');
    // Disconnecting takes its models off every stack (providerOps), so the
    // question says so, and offers the one way to keep them (2026-10-09).
    expect(dom.text()).toContain(
      'Its API key is removed from this device, and its models leave your bench and every stack. To keep them, replace its key instead.',
    );
  });

  it("replacing a connected provider's key opens its key sheet and disconnects nothing", async () => {
    const real = useApp.getState().disconnectProvider;
    const disconnectProvider = vi.fn(async () => {});
    useApp.setState({ connectedProviders: { groq: true }, disconnectProvider });
    onTestFinished(() => useApp.setState({ disconnectProvider: real }));
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await tapRow('Groq');
    expect(dom.text()).toContain('Disconnect Groq?');
    const replace = [...dom.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'replace its key',
    )!;
    expect(replace.classList.contains('press-fb')).toBe(true);
    const { act } = await import('react');
    const { sheetExitMs } = await import('../src/lib/motion.js');
    await act(async () => {
      replace.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, sheetExitMs() + 40));
    });
    expect(sheetTitle()).toBe('Connect Groq');
    expect(dom.text()).not.toContain('Disconnect Groq?');
    expect(disconnectProvider).not.toHaveBeenCalled();
  });

  it('opens More providers: every named provider not yet connected, and a search', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await tapRow('More providers');
    expect(sheetTitle()).toBe('More providers');
    expect(sheetRows()).toEqual(NAMED.map((p) => p.name));
    expect(dom.text()).toContain(`Search ${NAMED.length} providers`);
    expectOneWayOut();
    // The search narrows by name, any case, or by the provider's id.
    await dom.type('Groq, Mistral, DeepSeek...', 'MIS');
    expect(sheetRows()).toEqual(['Mistral']);
    await dom.type('Groq, Mistral, DeepSeek...', 'hugging face');
    expect(sheetRows()).toEqual(['Hugging Face']);
    // And by the other names people know it by.
    await dom.type('Groq, Mistral, DeepSeek...', 'grok');
    expect(sheetRows()).toEqual(['xAI']);
    await dom.type('Groq, Mistral, DeepSeek...', 'hf');
    expect(sheetRows()).toEqual(['Hugging Face']);

    await dom.type('Groq, Mistral, DeepSeek...', 'nothing like it');
    expect(sheetRows()).toEqual([]);
    expect(dom.text()).toContain(
      'No provider here by that name. Any OpenAI-compatible one connects by its address in the Stack.',
    );
  });

  it('a tap in More providers closes the list and opens the same key sheet', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await tapRow('More providers');
    await tapSheetRow('xAI');
    expect(sheetTitle()).toBe('Connect xAI');
    // One sheet at a time: the list has gone.
    expect(dom.container.querySelectorAll('.sheet')).toHaveLength(1);
    const group = dom.container.querySelector('.sheet [data-reveal-with]')!;
    const field = group.querySelector('#connections-api-key') as HTMLInputElement;
    expect(field.getAttribute('placeholder')).toBe('an xAI API key');
    expect(keyHint(field)).toBe('go');
    const save = group.querySelector('[data-reveal-primary]') as HTMLButtonElement;
    expect(save.textContent).toBe('Save');
    expect(save.disabled).toBe(true);
    expect(dom.buttons()).toContain('Get a key ');
    expectOneWayOut();
    // Only a provider with a word to add says more than where to get a key.
    expect(dom.container.querySelector('.sheet .field .hint')).toBeNull();
  });

  it("Hugging Face's key sheet asks for a token with the one permission it needs", async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await tapRow('More providers');
    await tapSheetRow('Hugging Face');
    expect(sheetTitle()).toBe('Connect Hugging Face');
    expect(dom.container.querySelector('.sheet .field .hint')?.textContent).toBe(
      'Make a fine-grained token with only the "Make calls to Inference Providers" permission. OpenShore needs nothing more.',
    );
  });

  it('a connected named provider joins the familiar seven, and leaves the list', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    const labels = rows().map((r) => r.label);
    expect(labels.slice(0, FAMILIAR.length + 3)).toEqual([
      'Set up a server',
      ...FAMILIAR.map((p) => p.name),
      'Groq',
      'Choose Groq models',
    ]);
    expect(rows().find((r) => r.label === 'Groq')!.value).toBe('Connected');
    expect(rows().find((r) => r.label === 'More providers')!.sub).toBe(
      `Together AI, DeepSeek, Mistral, and ${NAMED.length - 4} more, each on your own key.`,
    );
    await tapRow('More providers');
    expect(sheetRows()).not.toContain('Groq');
    expect(sheetRows()).toHaveLength(NAMED.length - 1);
  });

  it('on a phone, any other provider opens the Stack, where it connects by address', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    const other = rows().find((r) => r.label === 'Any other provider')!;
    expect(other.sub).toBe(
      'Connect any OpenAI-compatible provider by its address in the Stack, under Connect a model.',
    );
    await tapRow('Any other provider');
    expect(useApp.getState().view).toBe('stack');
  });

  it('on the desktop, no row points to an address form its Stack does not have', async () => {
    shell.desktop = true;
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    expect(rows().map((r) => r.label)).not.toContain('Any other provider');
    await tapRow('More providers');
    await dom.type('Groq, Mistral, DeepSeek...', 'nothing like it');
    expect(dom.text()).toContain('No provider here by that name.');
    expect(dom.text()).not.toContain('in the Stack');
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
    expectOneWayOut();
    expect(dom.text()).toContain('It stays on this device, never in a log.');
  });

  it('asks before a connected platform disconnects', async () => {
    useApp.setState({ view: 'repos', connectedRepoPlatforms: { gitlab: true } });
    const { ReposScreen } = await import('../src/screens/ReposScreen.js');
    await dom.render(<ReposScreen />);
    const gitlab = rows().find((r) => r.label === 'GitLab')!;
    expect(gitlab.value).toBe('Connected');
    expect(gitlab.sub).toBe('Its repositories are ready to add to a chat.');
    expect(gitlab.el.querySelector('.disclosure-chevron')).toBeNull();
    // A platform not yet connected opens a place, its connect sheet.
    expect(
      rows()
        .find((r) => r.label === 'GitHub')!
        .el.querySelector('.disclosure-chevron'),
    ).not.toBeNull();
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
    const clone = dom.container.querySelector('.sheet [data-reveal-primary]') as HTMLButtonElement;
    expect(clone.textContent).toBe('Clone and open a chat');
    // Clone waits for an address.
    expect(clone.disabled).toBe(true);
    await dom.type(field.getAttribute('placeholder')!, 'https://github.com/sam/harbor');
    expect(clone.disabled).toBe(false);
    expectOneWayOut();
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
    // The stand-in reads a picture in a chat, after asking; it never takes a
    // plan's image step (CX and CMO, 2026-10-08, E), so no row names one.
    expect(cloudRow()).toBe(`None yet · ${reader} reads images for now. It asks before a picture.`);
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
    expect(cloudRow()).toBe('None yet · Opus 5 reads images for now. It asks before a picture.');
  });

  // CX and CMO, 2026-10-08 (E): the founder's 2026-10-07 exception is off. A
  // plan carries no picture, so with nothing set for Image reading its image
  // step goes to the Reasoning model, which works from the text, and the
  // stand-in never takes it. So the row names no plan's image step, even on
  // a stack that plans (play.ts planCanRun, the gate runTurn reads).
  it("never names a plan's image step, even on a stack that can plan", async () => {
    const opus = {
      kind: 'cloud' as const,
      provider: 'anthropic',
      model: 'claude-opus-5',
      label: 'Opus 5',
    };
    const sonarPro = {
      kind: 'cloud' as const,
      provider: 'perplexity',
      model: 'sonar-pro',
      label: 'Sonar Pro',
    };
    const writer = { ref: sonarPro, placement: { category: 'writing' as const } };
    const harbor = { active: [writer], saved: {} };
    const alone = { reasoning: opus, active: [], saved: {} };
    const withWriter = { reasoning: opus, active: [writer], saved: {} };
    // Which stacks plan (planCanRun is unchanged by E): the ones below that
    // do, and the ones that do not.
    const { planCanRun } = await import('../src/lib/play.js');
    const online = () => true;
    expect(planCanRun(harbor, online, true)).toBe(false);
    expect(planCanRun(alone, online, false)).toBe(false);
    expect(planCanRun(alone, online, true)).toBe(true);
    expect(planCanRun(withWriter, online, false)).toBe(true);
    // Offline: the cloud anchor is out of reach, so no plan.
    expect(planCanRun(withWriter, (r) => r.kind === 'device', true)).toBe(false);
    const line = 'None yet · Opus 5 reads images for now. It asks before a picture.';
    const { StackManager } = await import('../src/components/StackManager.js');

    // A writing specialist to hand a step to: this stack plans.
    useApp.setState({
      view: 'stack',
      connectedProviders: { anthropic: true, perplexity: true },
      settings: { ...useApp.getState().settings, stacks: { offshore: withWriter } },
    });
    await dom.render(<StackManager />);
    expect(cloudRow()).toBe(line);
    expect(dom.text()).not.toContain("plan's image step");
    await dom.render(null);

    // Harbor Lite with that same specialist: Harbor Lite never plans.
    useApp.setState({
      settings: { ...useApp.getState().settings, stacks: { offshore: harbor } },
    });
    await dom.render(<StackManager />);
    expect(cloudRow()).toBe(`None yet · ${reader} reads images for now. It asks before a picture.`);
    await dom.render(null);

    // Docked to a paired computer: its engine takes a step that edits files,
    // so this stack plans too.
    useApp.setState({
      connectivity: { homeReachable: true, online: true },
      settings: {
        ...useApp.getState().settings,
        daemon: hub,
        daemons: [hub],
        stacks: { docked: alone },
      },
    });
    await dom.render(<StackManager />);
    expect(cloudRow()).toBe(line);
    await tapRow('Cloud');
    expect(dom.container.querySelector('.sheet:not(.closing) .sheet-sub')?.textContent ?? '').toBe(
      'A cloud model that reads images. Until you choose one, Opus 5 reads them. It asks before a picture.',
    );
    expect(dom.text()).not.toContain("plan's image step");
  });

  it('names the stand-in in the slot sheets only while it is one', async () => {
    useApp.setState({ view: 'stack', connectedProviders: { anthropic: true } });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    const sheetSub = () =>
      dom.container.querySelector('.sheet:not(.closing) .sheet-sub')?.textContent ?? '';
    await tapRow('Cloud');
    expect(sheetSub()).toBe(
      `A cloud model that reads images. Until you choose one, ${reader} reads them. It asks before a picture.`,
    );
    await dom.render(null);
    await dom.render(<StackManager />);
    await tapRow('Local');
    expect(sheetSub()).toBe(
      `A model on this device or your own server. A model on this device cannot read images yet, so ${reader} reads them until one can.`,
    );
  });

  // sp-claims2: a Local slot that reads images takes every picture and every
  // plan's image step itself (routeVision and stepRunner both go to it
  // first), so no line names a cloud model reading them "for now".
  it('names the Local model, and no stand-in, once the Local slot reads images itself', async () => {
    const HOME = {
      id: 'home',
      label: 'Home reader',
      baseUrl: 'http://192.168.1.20:11434/v1',
      model: 'llava:13b',
    };
    const home = { kind: 'byom' as const, ...HOME };
    const stack = {
      active: [{ ref: home, placement: { category: 'vision' as const } }],
      saved: {},
    };
    // The rule the chat and a plan follow, with Claude connected too.
    const { pickVisionRef } = await import('../src/lib/stack.js');
    const { imageStepRunner } = await import('../src/lib/play.js');
    expect(pickVisionRef(stack, () => true)?.ref).toEqual(home);
    expect(imageStepRunner({ ...stack, imageReader: home })).toEqual(home);
    useApp.setState({
      view: 'stack',
      connectedProviders: { anthropic: true },
      settings: {
        ...useApp.getState().settings,
        byomModels: [HOME],
        stacks: { offshore: stack },
      },
    });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(localRow()).toMatch(/^Home reader · .+ effort$/);
    expect(cloudRow()).toBe('None yet · Home reader reads images.');
    expect(cloudRow()).not.toContain(reader);
    const sheetSub = () =>
      dom.container.querySelector('.sheet:not(.closing) .sheet-sub')?.textContent ?? '';
    await tapRow('Cloud');
    expect(sheetSub()).toBe(
      'Reads a picture only when your Local model cannot read here, or after you approve when it fails on one.',
    );
    await dom.render(null);
    await dom.render(<StackManager />);
    await tapRow('Local');
    expect(sheetSub()).toBe(
      'A model on this device or your own server. A model on this device cannot read images yet.',
    );
  });

  it("names the stand-in's plan step only when the plan gives it the step", async () => {
    // A model on this device in the Local slot cannot read a picture, so the
    // chat's reader is the cloud stand-in; a plan's image step goes to that
    // slot's model, which a play never runs, so the Reasoning model covers it.
    const pocket = { kind: 'device' as const, modelId: 'pocket-3b', modelName: 'Pocket 3B' };
    const sonar = {
      kind: 'cloud' as const,
      provider: 'perplexity',
      model: 'sonar-reasoning-pro',
      label: 'Sonar Reasoning Pro',
    };
    // A writing specialist too, so a plan can run here (planCanRun) and the
    // plan's own rule is what keeps the clause off.
    const sonarPro = {
      kind: 'cloud' as const,
      provider: 'perplexity',
      model: 'sonar-pro',
      label: 'Sonar Pro',
    };
    const stack = {
      reasoning: sonar,
      active: [
        { ref: pocket, placement: { category: 'vision' as const } },
        { ref: sonarPro, placement: { category: 'writing' as const } },
      ],
      saved: {},
    };
    const { imageStepRunner, planCanRun } = await import('../src/lib/play.js');
    expect(planCanRun(stack, () => true, false)).toBe(true);
    const haiku = {
      kind: 'cloud' as const,
      provider: 'anthropic',
      model: visionFallbackClaudeModel().id,
    };
    expect(imageStepRunner({ ...stack, imageReader: haiku, reachable: () => true })).toEqual(sonar);
    // With nothing set for Image reading, a plan carries no picture, so its
    // image step is the Reasoning model's whatever reads one in the chat (CX
    // and CMO, 2026-10-08, E): never the connected cloud reader.
    const unplaced = { ...stack, active: stack.active.slice(1) };
    expect(imageStepRunner({ ...unplaced, imageReader: haiku, reachable: () => true })).toEqual(
      sonar,
    );
    useApp.setState({
      view: 'stack',
      connectedProviders: { anthropic: true, perplexity: true },
      settings: {
        ...useApp.getState().settings,
        deviceModels: { [pocket.modelId]: pocket.modelName },
        stacks: { offshore: stack },
      },
    });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(localRow()).toMatch(/^Pocket 3B · .+ effort$/);
    expect(cloudRow()).toBe(`None yet · ${reader} reads images for now. It asks before a picture.`);
  });

  it('says nothing of a stand-in once a cloud model is chosen, since it never asks', async () => {
    const sonnet = {
      kind: 'cloud' as const,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      label: 'Sonnet 5',
    };
    useApp.setState({
      view: 'stack',
      connectedProviders: { anthropic: true },
      settings: {
        ...useApp.getState().settings,
        stacks: {
          offshore: {
            active: [{ ref: sonnet, placement: { category: 'vision' } }],
            saved: {},
          },
        },
      },
    });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(cloudRow()).toMatch(/^Sonnet 5 · .+ effort$/);
    await tapRow('Cloud');
    expect(dom.container.querySelector('.sheet:not(.closing) .sheet-sub')?.textContent ?? '').toBe(
      'A cloud model that reads images.',
    );
  });
});

describe("the Stack's step down before a computer is paired (D1)", () => {
  // The tabs' names, without the "now" marker on the current one.
  const tabs = () =>
    [...dom.container.querySelectorAll('.stack-status [role="tab"]')].map((t) =>
      (t.textContent ?? '').replace(/now$/, ''),
    );

  it('holds only the statuses this device can be in, and opens the Status sheet', async () => {
    useApp.setState({ view: 'stack' });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(tabs()).toEqual(['Offshore', 'Offline']);
    await dom.click('Choose Offline');
    // The sheet portals to the body, past the room's own root.
    const offline = [...document.body.querySelectorAll<HTMLButtonElement>('.profile-row')].find(
      (b) => b.querySelector('.profile-row-title')?.textContent === 'Offline',
    );
    expect(offline).toBeTruthy();
    const { act } = await import('react');
    await act(async () => {
      offline!.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    expect(useApp.getState().settings.profileOverride).toBe('offline');
    expect(dom.buttons()).toContain('Follow the connection');
  });

  it('offers no Choose Offline when the connection has already dropped', async () => {
    // Offline by itself: the tab says so and the lone pill is in the bar, so
    // a link to choose what already holds would read wrong.
    useApp.setState({ view: 'stack', connectivity: { homeReachable: false, online: false } });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(dom.buttons()).not.toContain('Choose Offline');
    expect(dom.buttons()).not.toContain('Follow the connection');
  });

  it('leaves the step down to the pill once a computer is paired', async () => {
    useApp.setState({
      view: 'stack',
      settings: { ...useApp.getState().settings, daemon: hub, daemons: [hub] },
    });
    const { StackManager } = await import('../src/components/StackManager.js');
    await dom.render(<StackManager />);
    expect(tabs()).toEqual(['Docked', 'Offshore', 'Offline']);
    expect(dom.buttons()).not.toContain('Choose Offline');
  });
});
