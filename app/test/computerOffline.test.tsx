// Desktop Offline follow-up (2026-10-08): a paired phone hears when its
// computer works offline. The daemon says so on GET /health (the store's
// connection poll) and on GET /stack (with the model that answers there
// meanwhile), additively, so an older daemon reads as online. While it is
// offline the phone's model sheet and its Stack say what is true: the
// computer's cloud models wait for its connection, and the models on it
// still answer (named in the sheet), or none can yet. The phone's own reach
// is untouched. Mounted in a real (small) DOM, as a phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonStackInfo } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';
import type { ConversationSource } from '../src/state/types.js';

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

// What the computer answers GET /stack with, set per test.
const box = vi.hoisted(() => ({ stack: undefined as unknown }));
vi.mock('../src/drivers/remoteDriver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/drivers/remoteDriver.js')>()),
  daemonStack: async () => box.stack,
}));

// The DOM comes first: React DOM decides whether it has one when it loads.
const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { computerOfflineNote } = await import('../src/state/offlineOps.js');

const hub = { baseUrl: 'http://100.64.0.2:4816', token: 'osc_device' };

/** The computer's stack: Claude runs the show there, with Ollama beside it. */
function computerStack(extra: Partial<DaemonStackInfo> = {}): DaemonStackInfo {
  return {
    description: 'claude-sonnet-5, solo',
    orchestrator: { model: 'claude-sonnet-5', provider: 'anthropic', kind: 'cloud' },
    specialists: [],
    ...extra,
  };
}

beforeEach(() => {
  box.stack = computerStack();
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true, userAgent: 'test' },
    configurable: true,
  });
  useApp.setState({
    view: 'stack',
    viewTrail: [],
    connectedProviders: { anthropic: true },
    cloudKeyPresent: true,
    connectivity: { homeReachable: true, online: true },
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {}, daemon: hub },
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await dom.render(null);
});

describe('the store hears that its computer is offline', () => {
  /** The computer's GET /health, answering this body. */
  function health(body: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe(`${hub.baseUrl}/health`);
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
  }

  it('offline and why, while still docked; online again, or an older daemon, reads as online', async () => {
    health({ ok: true, role: 'admin', offline: 'chosen' });
    await useApp.getState().refreshConnectivity();
    expect(useApp.getState().connectivity).toEqual({
      online: true,
      homeReachable: true,
      homeOffline: 'chosen',
    });

    health({ ok: true, role: 'admin', offline: 'network' });
    await useApp.getState().refreshConnectivity();
    expect(useApp.getState().connectivity.homeOffline).toBe('network');

    // An older daemon never sends the field.
    health({ ok: true, role: 'admin' });
    await useApp.getState().refreshConnectivity();
    expect(useApp.getState().connectivity).toEqual({ online: true, homeReachable: true });
  });
});

describe("the phone's model sheet, while its computer is offline", () => {
  async function openSheet(): Promise<ConversationSource[]> {
    const picked: ConversationSource[] = [];
    const { ModelSheet } = await import('../src/components/ModelSheet.js');
    await dom.render(<ModelSheet onPick={(s) => picked.push(s)} onClose={() => {}} />);
    await dom.settle();
    return picked;
  }
  const computerRow = () =>
    [...dom.container.querySelectorAll<HTMLElement>('.ms-row')].find(
      (r) => r.querySelector('.ms-row-main')?.textContent === 'Your computer',
    )!;

  it('names the model on your computer that answers for now, and it is still a pick', async () => {
    box.stack = computerStack({
      offline: 'network',
      offlineSeat: { model: 'qwen2.5-coder:7b', provider: 'ollama' },
    });
    const picked = await openSheet();
    expect(computerRow().querySelector('.ms-row-sub')?.textContent).toBe(
      'Offline, so qwen2.5-coder:7b on your computer answers for now',
    );
    const { act } = await import('react');
    await act(async () => {
      computerRow().dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    // The pick lands once the sheet's exit has played.
    await vi.waitFor(() => expect(picked).toEqual([{ kind: 'desktop' }]), { timeout: 3000 });
  });

  it('with no model there, says none can answer yet, and is not a pick', async () => {
    box.stack = computerStack({ offline: 'chosen' });
    const picked = await openSheet();
    const row = computerRow();
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.querySelector('.ms-row-sub')?.textContent).toBe(
      'Offline, and no model on your computer can answer yet.',
    );
    const { act } = await import('react');
    await act(async () => {
      row.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    expect(picked).toEqual([]);
  });

  it('Chat with your computer shows only while a model there runs the show, as the free chat needs', async () => {
    // A cloud model in charge: the free chat would refuse it, so no row.
    box.stack = computerStack({ offline: 'chosen' });
    await openSheet();
    expect(dom.text()).not.toContain('Chat with your computer');
    await dom.render(null);
    box.stack = computerStack({
      offline: 'network',
      orchestrator: { model: 'qwen2.5-coder:7b', provider: 'ollama', kind: 'local' },
      offlineSeat: { model: 'qwen2.5-coder:7b', provider: 'ollama' },
    });
    await openSheet();
    expect(dom.text()).toContain('Chat with your computer');
  });

  it("this phone's own cloud models are untouched: the phone is online", async () => {
    box.stack = computerStack({ offline: 'network' });
    await openSheet();
    expect(dom.text()).not.toContain('Waits for a connection');
  });

  it('online, or a model on the computer in charge, the row reads as before', async () => {
    await openSheet();
    // A cloud model in charge runs at its provider, on your key, and the
    // computer only sends it each turn (keys on your server, 2026-10-09).
    expect(computerRow().querySelector('.ms-row-sub')?.textContent).toBe(
      'claude-sonnet-5, at Anthropic on your key, from your computer',
    );
    await dom.render(null);
    box.stack = computerStack({
      offline: 'network',
      orchestrator: { model: 'qwen2.5-coder:7b', provider: 'ollama', kind: 'local' },
      offlineSeat: { model: 'qwen2.5-coder:7b', provider: 'ollama' },
    });
    await openSheet();
    expect(computerRow().querySelector('.ms-row-sub')?.textContent).toBe(
      'qwen2.5-coder:7b, running on your computer',
    );
  });
});

describe("the phone's Stack, docked to a computer that is offline", () => {
  const note = () => dom.container.querySelector('.stack-status-note')?.textContent ?? '';

  async function openStack(): Promise<void> {
    const { StackScreen } = await import('../src/screens/StackScreen.js');
    await dom.render(<StackScreen />);
    await dom.settle();
  }

  it('says its cloud models wait and its own models still answer', async () => {
    useApp.setState({
      connectivity: { homeReachable: true, online: true, homeOffline: 'network' },
    });
    box.stack = computerStack({
      offline: 'network',
      offlineSeat: { model: 'qwen2.5-coder:7b', provider: 'ollama' },
    });
    await openStack();
    expect(note()).toBe(
      'Connected to your computer, which is offline. Models on your computer still answer. Its cloud models wait for its connection.',
    );
  });

  it('a chosen Offline there, with no model on it, says so and where to undo it', async () => {
    useApp.setState({ connectivity: { homeReachable: true, online: true, homeOffline: 'chosen' } });
    box.stack = computerStack({ offline: 'chosen' });
    await openStack();
    expect(note()).toBe(computerOfflineNote('chosen', false));
    expect(note()).toMatch(/No model on your computer can answer yet\./);
    expect(note()).toMatch(/until you follow the connection there\.$/);
  });

  it('before the computer has said what answers, the line claims nothing about its models', async () => {
    useApp.setState({
      connectivity: { homeReachable: true, online: true, homeOffline: 'network' },
    });
    // A /stack read from before it went offline carries no offline field.
    box.stack = computerStack();
    await openStack();
    expect(note()).toBe(
      'Connected to your computer, which is offline. Its cloud models wait for its connection.',
    );
  });

  it("online, Docked keeps its own line, and another status's tab keeps its own", async () => {
    await openStack();
    expect(note()).toBe(
      "Connected to your computer. Its models, cloud models, and this device's models.",
    );
    await dom.render(null);
    useApp.setState({
      connectivity: { homeReachable: true, online: true, homeOffline: 'network' },
    });
    await openStack();
    await dom.click('Offshore');
    expect(note()).toMatch(/^Used when you are offshore\./);
  });
});
