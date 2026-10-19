// The desktop's first open is the phone's (founder, 2026-10-19), end to end
// through the real store: Harbor Lite's walk opens, its first step gets
// DeepBlue on this computer's engine, the second waits for a phone to dock,
// and the repository and key follow, each in its desktop words.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The copy reads the shell when it loads: this is the desktop app.
// A window over Node's globals (timers and the rest), plus the preload's shell.
vi.stubGlobal(
  'window',
  Object.assign(Object.create(globalThis), {
    oscode: { platform: 'electron' },
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
);

const mem = new Map<string, string>();
const desk = vi.hoisted(() => ({ configured: false, installs: [] as string[], devices: 0 }));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'electron',
  isDesktop: () => true,
  isPhone: () => false,
  openExternal: () => {},
  openInAppBrowser: () => {},
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
  sealExistingKeys: async () => {},
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
}));

function status() {
  return {
    ollama: { up: true, detail: 'running', models: [] },
    hardwareSummary: 'no dedicated GPU detected, 16 GB system RAM',
    stack: {
      configured: desk.configured,
      description: desk.configured ? 'deepblue' : 'not set up yet',
      orchestrator: desk.configured
        ? { model: 'qwen2.5-coder:7b', provider: 'ollama', kind: 'local' as const }
        : undefined,
      specialists: [],
    },
    connections: { anthropic: false, openai: false, github: false },
  };
}

vi.mock('../src/lib/electronBridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/electronBridge.js')>()),
  bridge: () => ({
    status: async () => status(),
    onInstallProgress: () => () => {},
    installModel: async (id: string) => {
      desk.installs.push(id);
      return { ok: true, detail: 'pulled' };
    },
    setOrchestrator: async () => {
      desk.configured = true;
      return { ok: true, detail: 'seated' };
    },
    daemonInfo: async () => ({
      running: true,
      port: 1,
      tailscaleUp: true,
      devices: Array.from({ length: desk.devices }, (_, i) => ({
        id: `d${i}`,
        label: 'iPhone',
        createdAt: '2026-10-19',
      })),
    }),
    harborLitePresent: async () => true,
    harborLiteGenerate: async () => ({ started: true }),
  }),
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

vi.mock('../src/drivers/onDeviceDriver.js', () => ({
  OnDeviceDriver: class {
    readonly kind = 'device' as const;
    subscribe() {
      return () => {};
    }
    send() {}
    abort() {}
    answerApproval() {}
    dispose() {}
  },
}));

const { useApp } = await import('../src/state/store.js');
const { STEP_COPY, HARBOR_READY_MESSAGE, stepIntro } = await import('../src/lib/guidedSetup.js');
const { HARBOR_MINI_MODEL_ID } = await import('../src/lib/harborMini.js');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const guided = () => useApp.getState().settings.guidedSetup!;
const texts = () =>
  useApp
    .getState()
    .conversations[guided().conversationId].thread.items.map((i) =>
      i.kind === 'assistant' ? i.text : '',
    );

describe('the guided walk on the desktop', () => {
  beforeEach(() => {
    mem.clear();
    desk.configured = false;
    desk.installs = [];
    desk.devices = 0;
    useApp.setState({
      settings: { onboarded: true, claudeModel: 'x', deviceModels: {}, harborMiniReady: true },
      conversations: {},
      order: [],
      activeId: undefined,
      view: 'chat',
      desktopStatus: status(),
      harborMasterDownload: undefined,
      dockedPhones: undefined,
      cloudKeyPresent: false,
      connectedProviders: {},
      connectedRepoPlatforms: {},
    });
  });

  it("opens in Harbor Lite's chat, gets DeepBlue, waits for a phone, then the rest", async () => {
    await useApp.getState().beginGuidedSetup();
    const conv = useApp.getState().conversations[guided().conversationId]!;
    expect(conv.source).toMatchObject({ kind: 'device', modelId: HARBOR_MINI_MODEL_ID });
    await wait(760);
    useApp.getState().chooseStart('setup');
    await wait(5);
    expect(guided().current).toBe('harbor');
    expect(texts().at(-1)).toContain(stepIntro('harbor'));
    expect(STEP_COPY.harbor.action).toBe('Get DeepBlue');

    // Get DeepBlue pulls the size that fits this computer and seats it.
    useApp.getState().openSetupStep();
    await wait(30);
    expect(desk.installs).toHaveLength(1);
    expect(useApp.getState().desktopStatus?.stack.configured).toBe(true);
    expect(texts().join('\n')).toContain(HARBOR_READY_MESSAGE);
    expect(guided().nextChoice).toBe('asking');
    useApp.getState().chooseNext('setup');
    await wait(5);
    expect(guided().current).toBe('computer');
    expect(texts().at(-1)).toContain('Connect your phone');

    // Connect your phone opens Computer, and a phone docking here brings the
    // person back with the next step.
    useApp.getState().openSetupStep();
    await wait(5);
    expect(useApp.getState().view).toBe('pair');
    useApp.setState({ dockedPhones: 1 });
    await wait(5);
    expect(useApp.getState().view).toBe('chat');
    expect(guided().current).toBe('repo');
    expect(texts().at(-1)).toContain(STEP_COPY.computer.done);

    useApp.getState().skipSetupStep();
    await wait(5);
    useApp.getState().skipSetupStep();
    await wait(5);
    expect(guided().finished).toBe(true);
    expect(texts().at(-1)).toMatch(/DeepBlue is ready/);
  });

  it('says in the chat when Ollama has to come first, once', async () => {
    await useApp.getState().beginGuidedSetup();
    await wait(760);
    const note = 'Ollama is not installed yet. In a terminal, run: x.';
    useApp.setState({
      harborMasterDownload: { percent: 0, label: 'Waiting for Ollama', indeterminate: true, note },
    });
    await wait(5);
    useApp.setState({
      harborMasterDownload: { percent: 0, label: 'Waiting for Ollama', indeterminate: true, note },
    });
    await wait(5);
    const said = texts().filter((t) => t.includes(note));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Before DeepBlue can download, Ollama/);
  });
});
