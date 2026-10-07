// Desktop Offline (founder, 2026-10-07), what the person sees on the desktop,
// mounted in a real (small) DOM: the Status sheet in this computer's words
// (Automatic follows the connection, Offline is a choice, Docked and Offshore
// say why they cannot apply), the Stack room's quiet door under its status
// line, the model sheet's cloud models waiting for a connection (shown, not
// picked, no spend mark), Cloud Connections' one line and its Save that
// waits for the network, and the stop card's one door to a model here.
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import type { ConversationSource } from '../src/state/types.js';

type Status = {
  ollama: { up: boolean; detail: string; models: string[] };
  hardwareSummary: string;
  stack: {
    configured: boolean;
    description: string;
    orchestrator?: { model: string; provider: string; kind: 'local' | 'cloud' };
    specialists: Array<{ role: string; model: string }>;
  };
  connections: { anthropic: boolean; openai: boolean; github: boolean };
};

const app = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const overrides: Array<string | undefined> = [];
  const reset = () => {
    for (const k of Object.keys(state)) delete state[k];
    overrides.length = 0;
    Object.assign(state, {
      settings: { deviceModels: {}, pinnedModels: [] },
      connectivity: { homeReachable: false, online: true },
      connectedProviders: {},
      cloudKeyPresent: true,
      saveSettings: async () => {},
      setView: () => {},
      viewTrail: [],
      goBack: () => {},
      sourceReady: () => true,
      harborDownload: undefined,
      harborMasterDownload: undefined,
      ensureHarborMaster: async () => false,
      showToast: () => {},
      startGuideChat: async () => {},
      connectProvider: async () => {},
      disconnectProvider: async () => {},
      clearConnectionsFocus: () => {},
      connectionsFocus: undefined,
      setProfileOverride: async (p?: string) => {
        overrides.push(p);
      },
    });
  };
  reset();
  return { state, overrides, reset };
});
vi.mock('../src/state/store.js', () => ({
  useApp: Object.assign(
    <T,>(select?: (s: typeof app.state) => T) => (select ? select(app.state) : app.state),
    { getState: () => app.state },
  ),
  stackAdmin: () => true,
  agenticView: () => ({}),
  harnessView: () => ({}),
}));

const machine = vi.hoisted(() => ({ status: undefined as unknown }));
vi.mock('../src/lib/electronBridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/electronBridge.js')>()),
  bridge: () => ({ status: async () => machine.status }),
}));
vi.mock('../src/lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform.js')>()),
  platform: () => 'electron',
  isDesktop: () => true,
  isPhone: () => false,
}));
// The Stack's prefab shelf reads the live catalog; here it has none.
vi.mock('../src/lib/catalog.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/catalog.js')>()),
  loadAppCatalog: async () => ({ catalog: undefined }),
}));

function status(kind: 'local' | 'cloud', models: string[] = ['qwen2.5-coder:7b']): Status {
  const model = kind === 'cloud' ? 'claude-sonnet-5' : 'qwen2.5-coder:7b';
  return {
    ollama: { up: true, detail: 'running', models },
    hardwareSummary: 'no dedicated GPU detected, 16 GB system RAM',
    stack: {
      configured: true,
      description: `${model}, solo`,
      orchestrator: { model, provider: kind === 'cloud' ? 'anthropic' : 'ollama', kind },
      specialists: [],
    },
    connections: { anthropic: kind === 'cloud', openai: false, github: false },
  };
}

const offlineNet = () => {
  app.state.connectivity = { homeReachable: false, online: false };
};
const chooseOffline = () => {
  app.state.settings = { ...(app.state.settings as object), profileOverride: 'offline' };
};

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
  app.reset();
  machine.status = status('local');
  // linkedom lays nothing out, so there is nothing to scroll or to measure.
  Object.assign(window.HTMLElement.prototype, { scrollTo() {}, scrollIntoView() {} });
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** Tap the model sheet row whose main line reads this. */
async function tapRow(main: string): Promise<void> {
  const row = [...dom.container.querySelectorAll<HTMLElement>('.ms-row')].find(
    (r) => r.querySelector('.ms-row-main')?.textContent === main,
  );
  if (!row) throw new Error(`No "${main}" row`);
  const { act } = await import('react');
  await act(async () => {
    row.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

/** A tap in the transcript raises an event on the window; linkedom's window
 *  takes its own kind. */
function windowEvents(): void {
  const NodeEvent = globalThis.Event;
  globalThis.Event = window.Event as unknown as typeof Event;
  onTestFinished(() => {
    globalThis.Event = NodeEvent;
  });
}
afterEach(async () => {
  await dom.render(null);
});

describe('the Status sheet on the desktop', () => {
  it("speaks of this computer: Docked does not apply, Offline is this computer's models", async () => {
    offlineNet();
    const { StatusSheet } = await import('../src/components/ProfileStatus.js');
    await dom.render(<StatusSheet open onClose={() => {}} />);
    // The sheet portals to the body, past the bar's containing block.
    const text = document.body.textContent ?? '';
    expect(text).toContain('Which models can answer depends on what this computer can reach.');
    expect(text).toContain('For your phone, when it reaches this computer. Not used here.');
    expect(text).toContain(
      "Online. Cloud models and this computer's models. No connection right now.",
    );
    expect(text).toContain("Only this computer's models. Cloud models wait for a connection.");
    expect(text).not.toContain('Not reachable right now.');
    expect(text).not.toMatch(/\bhub\b/i);
  });

  it('Offline can be chosen on purpose, and Automatic goes back', async () => {
    const { StatusSheet } = await import('../src/components/ProfileStatus.js');
    await dom.render(<StatusSheet open onClose={() => {}} />);
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('.profile-row')];
    const offline = rows.find(
      (r) => r.querySelector('.profile-row-title')?.textContent === 'Offline',
    );
    const docked = rows.find(
      (r) => r.querySelector('.profile-row-title')?.textContent === 'Docked',
    );
    expect(docked?.disabled).toBe(true);
    expect(offline?.disabled).toBe(false);
    const { act } = await import('react');
    await act(async () => {
      offline!.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    expect(app.overrides).toEqual(['offline']);
  });
});

describe("the desktop Stack's quiet door", () => {
  it('online: the status line and Choose Offline, which opens the Status sheet', async () => {
    const { StackScreen } = await import('../src/screens/StackScreen.js');
    await dom.render(<StackScreen />);
    await dom.settle();
    expect(dom.container.querySelector('.stack-status-note')?.textContent).toBe(
      "Online. Cloud models and this computer's models can answer.",
    );
    expect(dom.buttons()).toContain('Choose Offline');
    await dom.click('Choose Offline');
    expect(document.body.textContent).toContain('Follow the connection.');
  });

  it('chosen: the line says cloud models wait, and the door reads Follow the connection', async () => {
    chooseOffline();
    const { StackScreen } = await import('../src/screens/StackScreen.js');
    await dom.render(<StackScreen />);
    await dom.settle();
    expect(dom.container.querySelector('.stack-status-note')?.textContent).toMatch(
      /Cloud models wait until you follow the connection again\.$/,
    );
    expect(dom.buttons()).toContain('Follow the connection');
  });

  it('names a cloud model the way a person reads it, never by its id', async () => {
    machine.status = status('cloud');
    const { StackScreen } = await import('../src/screens/StackScreen.js');
    await dom.render(<StackScreen />);
    await dom.settle();
    expect(dom.text()).toContain('Sonnet 5');
    expect(dom.text()).not.toContain('claude-sonnet-5');
  });

  it('the connection dropped: the line, and no door (the lone pill is in the bar)', async () => {
    offlineNet();
    const { StackScreen } = await import('../src/screens/StackScreen.js');
    await dom.render(<StackScreen />);
    await dom.settle();
    expect(dom.container.querySelector('.stack-status-note')?.textContent).toBe(
      "Offline. This computer's models answer. Cloud models wait for a connection.",
    );
    expect(dom.buttons()).not.toContain('Choose Offline');
  });
});

describe("the model sheet's waiting cloud models", () => {
  async function openCloud(): Promise<ConversationSource[]> {
    const picked: ConversationSource[] = [];
    const { ModelSheet } = await import('../src/components/ModelSheet.js');
    await dom.render(<ModelSheet onPick={(s) => picked.push(s)} onClose={() => {}} />);
    await dom.settle();
    await tapRow('Cloud models');
    return picked;
  }

  it('offline: shown, muted, not a pick, and no spend mark', async () => {
    offlineNet();
    const picked = await openCloud();
    expect(dom.text()).toContain('Offline. Cloud models wait for a connection.');
    const waiting = [...dom.container.querySelectorAll('.ms-row-disabled')];
    expect(waiting.length).toBeGreaterThan(0);
    // The sheet says why once, at the top; each row is its muted name alone,
    // not the same line again under every model.
    for (const row of waiting) {
      expect(row.querySelector('.ms-row-sub')).toBeNull();
      expect(row.getAttribute('aria-disabled')).toBe('true');
    }
    expect(dom.text().match(/wait for a connection|Waits for a connection/g)).toHaveLength(1);
    expect(dom.container.querySelector('.model-sheet .ms-pin')).toBeNull();
    expect(dom.container.querySelector('.model-sheet .pill.cloud, .model-sheet .amber')).toBeNull();
    const { act } = await import('react');
    await act(async () => {
      waiting[0]!.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    expect(picked).toEqual([]);
  });

  it('online: the same models are picks again', async () => {
    await openCloud();
    expect(dom.text()).not.toContain('Waits for a connection');
    expect(dom.container.querySelector('.model-sheet .ms-pin')).not.toBeNull();
  });

  it('This computer stays, and with a cloud model in charge it says a model here answers', async () => {
    offlineNet();
    machine.status = status('cloud');
    const { ModelSheet } = await import('../src/components/ModelSheet.js');
    await dom.render(<ModelSheet onPick={() => {}} onClose={() => {}} />);
    await dom.settle();
    expect(dom.text()).toContain('Offline, so a model on this computer answers for now');
    // The root row for the cloud sheet says why it waits.
    expect(dom.text()).toContain('Waits for a connection');
  });

  it('with no model on this computer at all, This computer says it cannot answer yet', async () => {
    offlineNet();
    machine.status = status('cloud', ['nomic-embed-text']);
    const { ModelSheet } = await import('../src/components/ModelSheet.js');
    await dom.render(<ModelSheet onPick={() => {}} onClose={() => {}} />);
    await dom.settle();
    expect(dom.text()).toContain('Offline, and no model on this computer can answer yet.');
  });
});

describe('Cloud Connections while offline', () => {
  it('one quiet line at the top, and Save waits for the network with a plain reason', async () => {
    offlineNet();
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    expect(dom.container.querySelector('.connections-offline')?.textContent).toBe(
      'Offline. These models wait for a connection. Keys stay saved.',
    );
    const row = [...dom.container.querySelectorAll<HTMLElement>('.settings-row')].find(
      (r) => r.querySelector('.settings-row-label')?.textContent === 'Claude',
    )!;
    const { act } = await import('react');
    await act(async () => {
      row.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    await dom.type('sk-ant-...', 'sk-ant-test');
    expect(dom.text()).toContain(
      'Saving checks the key with Claude, so it waits for a connection.',
    );
    const save = [...dom.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save',
    );
    expect(save?.disabled).toBe(true);
  });

  it('chosen Offline: its own line, and Save still checks the key', async () => {
    chooseOffline();
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    expect(dom.container.querySelector('.connections-offline')?.textContent).toMatch(
      /^Offline is chosen/,
    );
    expect(dom.text()).not.toContain('Saving checks the key');
  });

  it('online: no line', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    expect(dom.container.querySelector('.connections-offline')).toBeNull();
  });
});

describe("the stop card's door when nothing here can answer", () => {
  it('offline with no local model: one door, Install DeepBlue, and no model picker', async () => {
    windowEvents();
    const { offlineNoModelLine } = await import('os-code/protocol');
    const { emptyThread } = await import('../src/state/types.js');
    const { MessageList } = await import('../src/components/MessageList.js');
    let installs = 0;
    let picks = 0;
    await dom.render(
      <MessageList
        thread={{
          ...emptyThread(),
          items: [
            { kind: 'user', id: 'u1', text: 'hello' },
            { kind: 'stopped', id: 's1', message: offlineNoModelLine('chosen') },
          ],
        }}
        onPickModel={() => picks++}
        onInstallLocal={{ label: 'Install DeepBlue', busy: false, run: () => installs++ }}
      />,
    );
    expect(dom.text()).toContain('Offline, and no model on your computer can answer yet.');
    expect(dom.buttons()).toContain('Install DeepBlue');
    expect(dom.buttons()).not.toContain('Choose another model');
    await dom.click('Install DeepBlue');
    expect(installs).toBe(1);
    expect(picks).toBe(0);
  });

  it('a chosen Offline also offers the way back: Follow the connection', async () => {
    windowEvents();
    const { offlineNoModelLine } = await import('os-code/protocol');
    const { emptyThread } = await import('../src/state/types.js');
    const { MessageList } = await import('../src/components/MessageList.js');
    let follows = 0;
    await dom.render(
      <MessageList
        thread={{
          ...emptyThread(),
          items: [
            { kind: 'user', id: 'u1', text: 'hello' },
            { kind: 'stopped', id: 's1', message: offlineNoModelLine('chosen') },
          ],
        }}
        onPickModel={() => {}}
        onInstallLocal={{ label: 'Install DeepBlue', busy: false, run: () => {} }}
        onFollowConnection={() => follows++}
      />,
    );
    expect(dom.buttons()).toEqual(
      expect.arrayContaining(['Install DeepBlue', 'Follow the connection']),
    );
    await dom.click('Follow the connection');
    expect(follows).toBe(1);
  });

  it('with no network the line says when, and there is no door that would fail', async () => {
    windowEvents();
    const { offlineNoModelLine } = await import('os-code/protocol');
    const { emptyThread } = await import('../src/state/types.js');
    const { MessageList } = await import('../src/components/MessageList.js');
    await dom.render(
      <MessageList
        thread={{
          ...emptyThread(),
          items: [
            { kind: 'user', id: 'u1', text: 'hello' },
            { kind: 'stopped', id: 's1', message: offlineNoModelLine('network') },
          ],
        }}
        onPickModel={() => {}}
      />,
    );
    expect(dom.text()).toContain('Once you are back online, install DeepBlue to work offline.');
    expect(dom.buttons()).not.toContain('Install DeepBlue');
    expect(dom.buttons()).not.toContain('Choose another model');
  });
});
