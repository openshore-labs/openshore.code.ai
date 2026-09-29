// Rewind through the store on the desktop (P2): a coding chat's "Rewind to
// here" asks this computer's engine over the bridge with the message's
// journal seq, the engine's `rewound` marker cuts the chat as it arrives, and
// the store hands the message's words back for the composer. With no engine
// attached it says so plainly, and it never asks while the chat is working.
// The store runs against a fake desktop bridge.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const mem = new Map<string, string>();

type Listener = (payload: { sessionId: string; seq: number; event: DriverEvent }) => void;
const desk = vi.hoisted(() => ({
  listeners: new Set<(payload: unknown) => void>(),
  asked: [] as unknown[][],
  answer: undefined as undefined | { ok: true; paths: string[] } | { error: string },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'electron',
  isDesktop: () => true,
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

/** The engine's journal for session s1: two tasks, each with a checkpoint. */
const JOURNAL: Array<{ seq: number; event: DriverEvent }> = [
  { type: 'task-start', input: 'make the page' },
  { type: 'text-final', text: 'Made it.' },
  { type: 'task-done', reason: 'complete' },
  { type: 'checkpoint', id: 'k1', files: [{ path: 'index.html', status: 'added' }] },
  { type: 'task-start', input: 'add a header' },
  { type: 'text-final', text: 'Added.' },
  { type: 'task-done', reason: 'complete' },
  { type: 'checkpoint', id: 'k2', files: [{ path: 'index.html', status: 'modified' }] },
].map((event, i) => ({ seq: i + 1, event: event as DriverEvent }));

function fakeBridge() {
  const emit = (seq: number, event: DriverEvent) => {
    for (const l of [...desk.listeners]) (l as Listener)({ sessionId: 's1', seq, event });
  };
  return {
    platform: 'electron',
    resumeSession: async (id: string) => ({ id, cwd: '/work', journal: JOURNAL }),
    onEvent: (cb: (payload: unknown) => void) => {
      desk.listeners.add(cb);
      return () => desk.listeners.delete(cb);
    },
    send: async () => {},
    abort: async () => {},
    setMode: async () => {},
    answerApproval: async () => {},
    rewind: async (...args: unknown[]) => {
      desk.asked.push(args);
      const answer = desk.answer ?? { ok: true as const, paths: ['index.html'] };
      if ('ok' in answer) {
        emit(9, {
          type: 'checkpoint-restored',
          id: 'k2',
          direction: 'undo',
          paths: ['index.html'],
        });
        emit(10, { type: 'rewound', toSeq: args[1] as number, paths: answer.paths });
      }
      return answer;
    },
  };
}

vi.mock('../src/lib/electronBridge.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/electronBridge.js')>();
  const shared = fakeBridge();
  return { ...real, bridge: () => shared, requireBridge: () => shared };
});

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const { useApp } = await import('../src/state/store.js');
const { REWIND_NO_COMPUTER, REWIND_NOT_NOW } = await import('../src/state/rewindOps.js');
const { emptyThread } = await import('../src/state/types.js');

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Each test opens its own chat on the same session: a chat's driver outlives
// a test (the store keeps it), and a fresh one replays the journal.
let chat = 'c0';
const said = () =>
  useApp
    .getState()
    .conversations[chat]!.thread.items.flatMap((i) =>
      i.kind === 'user' || i.kind === 'assistant' || i.kind === 'note' ? [i.text] : [],
    );

function openCodingChat(): void {
  chat = `c${Number(chat.slice(1)) + 1}`;
  useApp.setState({
    ready: true,
    view: 'chat',
    viewTrail: [],
    activeId: undefined,
    order: [chat],
    conversations: {
      [chat]: {
        id: chat,
        title: 'A page',
        source: { kind: 'desktop', sessionId: 's1', cwd: '/work' },
        createdAt: 'x',
        updatedAt: 'x',
        thread: emptyThread(),
      },
    },
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
  useApp.getState().openConversation(chat);
}

beforeEach(() => {
  mem.clear();
  desk.asked.length = 0;
  desk.answer = undefined;
});

describe('a coding chat rewinds on its computer', () => {
  it('asks the engine with the seq and the files, folds its marker, and hands back the words', async () => {
    openCodingChat();
    await until(() => said().length === 4, 'the journal replay');
    const header = useApp
      .getState()
      .conversations[chat]!.thread.items.find(
        (i) => i.kind === 'user' && i.text === 'add a header',
      )!;

    const back = await useApp.getState().rewindTo(header.id, { files: true });
    expect(back).toEqual({ text: 'add a header' });
    expect(desk.asked).toEqual([['s1', 5, true]]);
    expect(said()).toEqual([
      'make the page',
      'Made it.',
      'Rewound to an earlier message. index.html went back.',
    ]);
  });

  it('says why when the engine refuses, and the chat stays as it was', async () => {
    openCodingChat();
    await until(() => said().length === 4, 'the journal replay');
    desk.answer = { error: 'That message is not in this chat any more.' };
    const first = useApp.getState().conversations[chat]!.thread.items[0]!;
    expect(await useApp.getState().rewindTo(first.id, { files: false })).toEqual({
      error: 'That message is not in this chat any more.',
    });
    expect(said()).toHaveLength(4);
  });

  it('never asks while the chat works, or for something that is not a message', async () => {
    openCodingChat();
    await until(() => said().length === 4, 'the journal replay');
    const items = useApp.getState().conversations[chat]!.thread.items;
    const answer = items.find((i) => i.kind === 'assistant')!;
    expect(await useApp.getState().rewindTo(answer.id, { files: true })).toEqual({
      error: REWIND_NOT_NOW,
    });
    useApp.setState((s) => ({
      conversations: {
        [chat]: {
          ...s.conversations[chat]!,
          thread: { ...s.conversations[chat]!.thread, busy: true },
        },
      },
    }));
    expect(await useApp.getState().rewindTo(items[0]!.id, { files: true })).toEqual({
      error: REWIND_NOT_NOW,
    });
    expect(desk.asked).toEqual([]);
  });

  it('with no engine attached, says so plainly', async () => {
    useApp.setState({
      activeId: 'loose',
      conversations: {
        loose: {
          id: 'loose',
          title: 'Elsewhere',
          source: { kind: 'desktop', sessionId: 's2' },
          createdAt: 'x',
          updatedAt: 'x',
          thread: { ...emptyThread(), items: [{ kind: 'user', id: 'u', text: 'hi', seq: 1 }] },
        },
      },
    });
    expect(await useApp.getState().rewindTo('u', { files: true })).toEqual({
      error: REWIND_NO_COMPUTER,
    });
  });
});
