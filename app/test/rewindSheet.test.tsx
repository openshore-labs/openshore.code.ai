// "Rewind to here" on screen (P2), mounted in a real (small) DOM: the sheet's
// two paths on a coding chat and its one choice elsewhere, the quiet action
// on the person's own message and the phone's long press with its tick, and
// the chat screen handing the rewound message back to the composer. The
// composer's Esc Esc is in rewindComposer.test.tsx (it mounts on a stub store).
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import type { SeedTurn, ThreadState } from '../src/state/types.js';

const mem = new Map<string, string>();
const ticks = vi.hoisted(() => ({ tick: 0, commit: 0 }));

vi.mock('../src/lib/haptics.js', () => ({
  hapticTick: () => {
    ticks.tick += 1;
  },
  hapticCommit: () => {
    ticks.commit += 1;
  },
  hapticApproval: () => {},
  hapticSuccess: () => {},
}));

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

// The phone's own model, faked: it records the history each build is seeded
// with, so a rewind's rebuild is observable.
const seeds: Array<SeedTurn[] | undefined> = [];
vi.mock('../src/drivers/onDeviceDriver.js', () => ({
  OnDeviceDriver: class {
    readonly kind = 'device' as const;
    constructor(_id: string, _name: string, seed?: SeedTurn[]) {
      seeds.push(seed);
    }
    subscribe() {
      return () => {};
    }
    send() {}
    abort() {}
    answerApproval() {}
    dispose() {}
  },
}));

let dom: TestDom;

beforeEach(async () => {
  dom = await mountDom();
  mem.clear();
  seeds.length = 0;
  ticks.tick = 0;
  ticks.commit = 0;
  Object.assign(window, { matchMedia: () => ({ matches: false }) });
  const area = window.HTMLTextAreaElement.prototype as { setSelectionRange?: unknown };
  area.setSelectionRange ??= () => {};
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  Object.assign(window.HTMLElement.prototype, { scrollTo() {} });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // A tap in the transcript raises an event on the window (skipReveals);
  // linkedom's window takes its own kind.
  const NodeEvent = globalThis.Event;
  globalThis.Event = window.Event as unknown as typeof Event;
  onTestFinished(() => {
    globalThis.Event = NodeEvent;
  });
});
afterEach(async () => {
  await dom.unmount();
});

async function act(work: () => void | Promise<void>): Promise<void> {
  const react = await import('react');
  await react.act(async () => {
    await work();
  });
}

function pointer(el: Element, type: string, init: Record<string, unknown>): void {
  const event = new window.Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.assign(event, { pointerId: 1, clientX: 10, clientY: 10, ...init });
  el.dispatchEvent(event);
}

function thread(): ThreadState {
  return {
    items: [
      { kind: 'user', id: 'u1', text: 'make the page', seq: 1 },
      { kind: 'assistant', id: 'a1', text: 'Made it.', streaming: false },
      { kind: 'user', id: 'u2', text: 'add a header', seq: 5 },
      { kind: 'assistant', id: 'a2', text: 'Added.', streaming: false },
    ],
    citations: [],
    busy: false,
    contextPercent: 0,
    dollars: 0,
    pendingApprovals: [],
    todos: [],
    queued: [],
    changedFiles: [],
    lastSeq: 8,
  };
}

describe('the rewind sheet', () => {
  it('a coding chat offers the chat and its files, or the chat alone', async () => {
    const { RewindSheet } = await import('../src/components/RewindSheet.js');
    const { REWIND_FILES_LINE } = await import('../src/state/rewindOps.js');
    const chosen: boolean[] = [];
    const render = () =>
      dom.render(
        <RewindSheet
          open
          files
          onClose={() => {}}
          onChoose={async (files) => {
            chosen.push(files);
            return undefined;
          }}
        />,
      );
    await render();
    expect(dom.text()).toContain('Rewind to this message?');
    expect(dom.text()).toContain(REWIND_FILES_LINE);
    expect(REWIND_FILES_LINE).toBe(
      'Files in this folder go back. Commits, pushes, and changes outside this folder stay.',
    );
    expect(dom.buttons()).toEqual(['', 'Rewind chat and files', 'Rewind chat only']);
    await dom.click('Rewind chat and files');
    await dom.click('Rewind chat only');
    expect(chosen).toEqual([true, false]);
    // The tap is a decisive commit.
    expect(ticks.commit).toBe(2);
  });

  it('a chat with no folder offers the one choice, and says nothing of files', async () => {
    const { RewindSheet } = await import('../src/components/RewindSheet.js');
    const chosen: boolean[] = [];
    await dom.render(
      <RewindSheet
        open
        files={false}
        onClose={() => {}}
        onChoose={async (files) => {
          chosen.push(files);
          return undefined;
        }}
      />,
    );
    expect(dom.buttons()).toEqual(['', 'Rewind chat']);
    expect(dom.text()).not.toContain('Files in this folder');
    await dom.click('Rewind chat');
    expect(chosen).toEqual([false]);
  });

  it('stays up and says why when a rewind did not happen, and offers Copy only when asked', async () => {
    const { RewindSheet } = await import('../src/components/RewindSheet.js');
    let closed = 0;
    let copied = 0;
    await dom.render(
      <RewindSheet
        open
        files
        onClose={() => closed++}
        onChoose={async () => 'Wait for the current step to finish, then rewind.'}
        onCopy={() => copied++}
      />,
    );
    await dom.click('Rewind chat and files');
    expect(dom.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Wait for the current step to finish, then rewind.',
    );
    expect(closed).toBe(0);
    await dom.click('Copy message');
    expect(copied).toBe(1);
  });
});

describe('the way in on the message itself', () => {
  // The first mount imports the transcript and its Markdown, so these get room.
  it(
    'a quiet action on a message the chat can rewind to, and only there',
    { timeout: 20_000 },
    async () => {
      const { MessageList } = await import('../src/components/MessageList.js');
      const opened: string[] = [];
      await dom.render(
        <MessageList thread={thread()} rewindIds={['u2']} onRewind={(id) => opened.push(id)} />,
      );
      const actions = dom.container.querySelectorAll('button[aria-label="Rewind to here"]');
      expect(actions).toHaveLength(1);
      expect(actions[0]!.parentElement?.textContent).toContain('add a header');
      await act(() => {
        actions[0]!.dispatchEvent(new window.Event('click', { bubbles: true }));
      });
      expect(opened).toEqual(['u2']);
    },
  );

  it(
    'a held finger opens it on the phone with a tick; a mouse, or a scroll, does not',
    { timeout: 20_000 },
    async () => {
      const { MessageList } = await import('../src/components/MessageList.js');
      const opened: string[] = [];
      await dom.render(
        <MessageList
          thread={thread()}
          rewindIds={['u1', 'u2']}
          onRewind={(id) => opened.push(id)}
        />,
      );
      const bubble = () => dom.container.querySelectorAll('.msg-user.rewindable')[0]!;
      const hold = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

      await act(() => pointer(bubble(), 'pointerdown', { pointerType: 'touch' }));
      expect(bubble().className).toContain('holding');
      await hold(560);
      expect(opened).toEqual(['u1']);
      expect(ticks.tick).toBe(1);
      expect(bubble().className).not.toContain('holding');

      await act(() => pointer(bubble(), 'pointerdown', { pointerType: 'mouse' }));
      await hold(560);
      expect(opened).toEqual(['u1']);

      await act(() => pointer(bubble(), 'pointerdown', { pointerType: 'touch' }));
      await act(() => pointer(bubble(), 'pointermove', { pointerType: 'touch', clientY: 40 }));
      await hold(560);
      expect(opened).toEqual(['u1']);
    },
  );
});

describe('the chat screen hands the rewound message back to the composer', () => {
  it(
    'a chat on this phone is cut before the message, reseeded, and the words are back in the box',
    { timeout: 20_000 },
    async () => {
      const { useApp } = await import('../src/state/store.js');
      const { ChatScreen } = await import('../src/screens/ChatScreen.js');
      useApp.setState({
        ready: true,
        view: 'chat',
        viewTrail: [],
        activeId: 'c1',
        order: ['c1'],
        conversations: {
          c1: {
            id: 'c1',
            title: 'A page',
            source: { kind: 'device', modelId: 'm', modelName: 'M' },
            createdAt: 'x',
            updatedAt: 'x',
            thread: thread(),
          },
        },
        settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
      });
      await dom.render(<ChatScreen compact={false} />);
      const actions = dom.container.querySelectorAll('button[aria-label="Rewind to here"]');
      expect(actions).toHaveLength(2);
      await act(() => {
        actions[1]!.dispatchEvent(new window.Event('click', { bubbles: true }));
      });
      // No folder behind this chat: the one choice.
      expect(dom.buttons()).toContain('Rewind chat');
      expect(dom.buttons()).not.toContain('Rewind chat and files');
      seeds.length = 0;
      await dom.click('Rewind chat');
      await dom.settle();

      const field = dom.container.querySelector('textarea')!;
      expect(field.value).toBe('add a header');
      const items = useApp.getState().conversations.c1!.thread.items;
      expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'note']);
      // The brain was rebuilt from what is left.
      expect(seeds.at(-1)).toEqual([
        { role: 'user', text: 'make the page' },
        { role: 'assistant', text: 'Made it.' },
      ]);
    },
  );
});
