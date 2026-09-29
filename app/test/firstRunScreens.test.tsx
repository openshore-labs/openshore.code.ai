// The first run's screens, mounted in a real (small) DOM (build 2026-09-29,
// package F1). The chat screen keeps a first message across a jump from the
// model chooser to the Stack and back (finding 14): it used to live in the
// screen's own state, so leaving the room lost it. A message parked on a chat
// shows as a bubble that says it is waiting, and keeps its Retry when
// something went wrong.
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const mem = new Map<string, string>();

vi.mock('../src/lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform.js')>()),
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
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

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

let dom: TestDom;

beforeEach(async () => {
  dom = await mountDom();
  mem.clear();
  Object.assign(window, { matchMedia: () => ({ matches: false }) });
  const area = window.HTMLTextAreaElement.prototype as { setSelectionRange?: unknown };
  area.setSelectionRange ??= () => {};
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  // linkedom lays nothing out, so there is nothing to scroll or to measure.
  Object.assign(window.HTMLElement.prototype, { scrollTo() {} });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(async () => {
  await dom.unmount();
});

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await dom.settle();
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const FIELD = 'Chat with OpenShore';

describe('a held first message and the chat screen', () => {
  // The first mount imports the whole store and chat screen, so these get room.
  it(
    'survives a jump from the chooser to the Stack and back, into the composer',
    { timeout: 20_000 },
    async () => {
      const { useApp } = await import('../src/state/store.js');
      const { ChatScreen } = await import('../src/screens/ChatScreen.js');
      const { HELD_MESSAGE_KEPT } = await import('../src/lib/heldMessage.js');
      useApp.setState({
        ready: true,
        view: 'chat',
        viewTrail: [],
        activeId: undefined,
        conversations: {},
        order: [],
        toast: undefined,
        settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
      });
      await dom.render(<ChatScreen compact={false} />);
      await dom.type(FIELD, 'build me a login page');
      await dom.click('↑');
      // Nothing can answer yet: the chooser opens, holding the message.
      expect(useApp.getState().settings.heldFirstMessage?.text).toBe('build me a login page');
      expect(dom.text()).toContain('Select model');
      // Every door in the chooser leaves for a setup room.
      await dom.click('Create your stack to get started');
      await until(() => useApp.getState().view === 'stack', 'the Stack room');
      expect(useApp.getState().settings.heldFirstMessage?.text).toBe('build me a login page');
      // The Stack room replaces the chat screen, then the way back returns.
      await dom.render(<div className="stack-room" />);
      useApp.getState().setView('chat');
      await dom.render(<ChatScreen compact={false} />);
      await until(() => dom.value(FIELD) === 'build me a login page', 'the words back in the box');
      expect(useApp.getState().settings.heldFirstMessage).toBeUndefined();
      expect(useApp.getState().toast).toBe(HELD_MESSAGE_KEPT);
    },
  );

  it('a dismissed chooser hands the message straight back', { timeout: 20_000 }, async () => {
    const { useApp } = await import('../src/state/store.js');
    const { ChatScreen } = await import('../src/screens/ChatScreen.js');
    useApp.setState({
      ready: true,
      view: 'chat',
      viewTrail: [],
      activeId: undefined,
      conversations: {},
      order: [],
      settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    });
    await dom.render(<ChatScreen compact={false} />);
    await dom.type(FIELD, 'explain this error');
    await dom.click('↑');
    const close = dom.container.querySelector('.model-sheet .mode-close') as HTMLElement;
    await (async () => {
      const { act } = await import('react');
      await act(async () => {
        close.dispatchEvent(new window.Event('click', { bubbles: true }));
      });
    })();
    await until(() => dom.value(FIELD) === 'explain this error', 'the words back in the box');
    expect(useApp.getState().settings.heldFirstMessage).toBeUndefined();
  });
});

describe('the parked message bubble', () => {
  const thread = async () => {
    const { emptyThread } = await import('../src/state/types.js');
    return {
      ...emptyThread(),
      items: [{ kind: 'user' as const, id: 'u1', text: 'fix the header' }],
    };
  };

  it('shows the message waiting to send', async () => {
    const { MessageList, PARKED_WAITING } = await import('../src/components/MessageList.js');
    await dom.render(<MessageList thread={await thread()} parked={{ text: 'and the footer' }} />);
    const bubble = dom.container.querySelector('.msg-user.parked');
    expect(bubble?.textContent).toContain('and the footer');
    expect(bubble?.textContent).toContain(PARKED_WAITING);
    expect(PARKED_WAITING).toBe('Waiting to send');
    expect(dom.buttons()).not.toContain('Try again');
  });

  it('says why it has not gone, with a Retry', async () => {
    const { MessageList } = await import('../src/components/MessageList.js');
    // A tap in the transcript finishes any typing (skipReveals), which
    // raises an event on the window; linkedom's window takes its own kind.
    const NodeEvent = globalThis.Event;
    globalThis.Event = window.Event as unknown as typeof Event;
    onTestFinished(() => {
      globalThis.Event = NodeEvent;
    });
    let retried = 0;
    await dom.render(
      <MessageList
        thread={await thread()}
        parked={{ text: 'hello?', error: 'Your computer did not answer.' }}
        onRetryParked={() => retried++}
      />,
    );
    expect(dom.text()).toContain('Your computer did not answer.');
    await dom.click('Try again');
    expect(retried).toBe(1);
  });
});
