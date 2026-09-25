// Mid-chat model switching and conversation reopen must keep the thread's
// context alive: a reopened chat reseeds the fresh driver from the persisted
// transcript (drivers do not survive a reload), a switch that fails to build
// its driver leaves the conversation on its current brain, and switching a
// private on-device chat to a network brain discloses that the history crosses
// over. The drivers are mocked so the seed each one receives is observable
// without pulling in the model SDKs.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedTurn } from '../src/state/types.js';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  openExternal: () => {},
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
  secretGet: async (k: string) => secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => {
    secrets.set(k, v);
  },
  secretDelete: async (k: string) => {
    secrets.delete(k);
  },
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

// Fake drivers that record the seed handed to their constructor, and what
// they were asked to send. A send echoes its task-start the way every real
// driver does, and leaves the turn open (a reply on its way).
let lastDeviceSeed: SeedTurn[] | undefined;
let lastCloudSeed: SeedTurn[] | undefined;
let lastDesktopChatSeed: SeedTurn[] | undefined;
const sends: string[] = [];

class FakeDriver {
  private sink?: (event: unknown, seq: number) => void;
  disposed = false;
  subscribe(sink: (event: unknown, seq: number) => void) {
    this.sink = sink;
    return () => {
      this.sink = undefined;
    };
  }
  send(text: string) {
    sends.push(text);
    queueMicrotask(() => this.sink?.({ type: 'task-start', input: text }, 0));
  }
  abort() {}
  answerApproval() {}
  dispose() {
    this.disposed = true;
  }
}

vi.mock('../src/drivers/onDeviceDriver.js', () => ({
  OnDeviceDriver: class extends FakeDriver {
    readonly kind = 'device' as const;
    constructor(_id: string, _name: string, seed?: SeedTurn[]) {
      super();
      lastDeviceSeed = seed;
    }
  },
}));

vi.mock('../src/drivers/cloudClaudeDriver.js', () => ({
  DEFAULT_CLAUDE_MODEL: 'claude-default',
  CloudClaudeDriver: class extends FakeDriver {
    readonly kind = 'cloud' as const;
    constructor(_key: string, _model: string, seed?: SeedTurn[]) {
      super();
      lastCloudSeed = seed;
    }
  },
}));

vi.mock('../src/drivers/desktopChatDriver.js', () => ({
  DesktopChatDriver: class extends FakeDriver {
    readonly kind = 'desktop-chat' as const;
    constructor(_target: unknown, _model: string | undefined, seed?: SeedTurn[]) {
      super();
      lastDesktopChatSeed = seed;
    }
  },
}));

const ANTHROPIC_KEY_KEY = 'oscode.secret.anthropic';
const { useApp } = await import('../src/state/store.js');

function convWith(items: Array<{ role: 'user' | 'assistant'; text: string }>) {
  return {
    id: 'c1',
    title: 'chat',
    source: { kind: 'device' as const, modelId: 'm', modelName: 'M' },
    createdAt: 'x',
    updatedAt: 'x',
    thread: {
      items: items.map((it, i) =>
        it.role === 'user'
          ? { kind: 'user' as const, id: `u${i}`, text: it.text }
          : { kind: 'assistant' as const, id: `a${i}`, text: it.text, streaming: false },
      ),
      citations: [],
      busy: false,
      contextPercent: 0,
      pendingApprovals: [],
    },
  };
}

function reset() {
  mem.clear();
  secrets.clear();
  lastDeviceSeed = undefined;
  lastCloudSeed = undefined;
  lastDesktopChatSeed = undefined;
  sends.length = 0;
  useApp.setState({
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    conversations: {},
    order: [],
    activeId: undefined,
  });
}

describe('conversation reopen reseeds the driver', () => {
  beforeEach(reset);

  it('passes the persisted transcript to a rebuilt device driver (no amnesia)', () => {
    // A conversation loaded from disk with no live driver (as after a reload).
    useApp.setState({
      conversations: {
        c1: convWith([
          { role: 'user', text: 'remember X' },
          { role: 'assistant', text: 'noted' },
        ]),
      },
      order: ['c1'],
    });
    useApp.getState().openConversation('c1');
    // The device driver builds synchronously; assert it got the full transcript.
    expect(lastDeviceSeed).toEqual([
      { role: 'user', text: 'remember X' },
      { role: 'assistant', text: 'noted' },
    ]);
  });
});

describe('mid-chat model switch', () => {
  beforeEach(reset);

  it('keeps the current brain when the new driver fails to build', async () => {
    useApp.setState({
      conversations: { c1: convWith([{ role: 'user', text: 'hi' }]) },
      order: ['c1'],
      activeId: 'c1',
    });
    // No Claude key stored, so buildDriver('cloud') throws before attaching.
    await useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    expect(useApp.getState().conversations.c1!.source.kind).toBe('device');
  });

  it('commits the switch and discloses the device-to-network crossing on success', async () => {
    secrets.set(ANTHROPIC_KEY_KEY, 'sk-test');
    useApp.setState({
      conversations: { c1: convWith([{ role: 'user', text: 'hi' }]) },
      order: ['c1'],
      activeId: 'c1',
    });
    await useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    const conv = useApp.getState().conversations.c1!;
    expect(conv.source.kind).toBe('cloud');
    // The new cloud driver was seeded with the prior turn.
    expect(lastCloudSeed).toEqual([{ role: 'user', text: 'hi' }]);
    const note = conv.thread.items.find((i) => i.kind === 'note') as { text: string } | undefined;
    expect(note?.text).toContain("sends this chat's history");
  });
});

describe('switching mid-chat does not race a send', () => {
  beforeEach(reset);

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it('a message sent while the new brain builds stays with the old one, and the switch stands down', async () => {
    secrets.set(ANTHROPIC_KEY_KEY, 'sk-test');
    useApp.setState({
      conversations: { c1: convWith([{ role: 'user', text: 'hi' }]) },
      order: ['c1'],
      activeId: 'c1',
    });
    useApp.getState().openConversation('c1');
    await flush();
    // The switch starts building (it awaits the key), and a message goes out.
    const switching = useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    useApp.getState().send('one more thing');
    await switching;
    // The ethics screen runs before the driver hears the message.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const conv = useApp.getState().conversations.c1!;
    expect(sends).toEqual(['one more thing']);
    // The old brain is answering, so the chat stays on it.
    expect(conv.source.kind).toBe('device');
    expect(conv.thread.busy).toBe(true);
  });

  it('shows a sent message once, busy from the moment it leaves', async () => {
    useApp.setState({
      conversations: { c1: convWith([{ role: 'user', text: 'hi' }]) },
      order: ['c1'],
      activeId: 'c1',
    });
    useApp.getState().openConversation('c1');
    await flush();
    useApp.getState().send('next');
    // Painted before the driver has said a word.
    expect(useApp.getState().conversations.c1!.thread.busy).toBe(true);
    await flush();
    const users = useApp
      .getState()
      .conversations.c1!.thread.items.filter((i) => i.kind === 'user' && i.text === 'next');
    expect(users).toHaveLength(1);
  });

  it("carries the thread to your computer's local chat", async () => {
    useApp.setState({
      settings: {
        onboarded: true,
        claudeModel: 'x',
        deviceModels: {},
        daemon: { baseUrl: 'http://box', token: 't' } as never,
      },
      conversations: {
        c1: convWith([
          { role: 'user', text: 'remember X' },
          { role: 'assistant', text: 'noted' },
        ]),
      },
      order: ['c1'],
      activeId: 'c1',
    });
    await useApp.getState().switchModel({ kind: 'desktop-chat', model: 'qwen' } as never);
    expect(useApp.getState().order).toEqual(['c1']);
    expect(useApp.getState().conversations.c1!.source.kind).toBe('desktop-chat');
    expect(lastDesktopChatSeed).toEqual([
      { role: 'user', text: 'remember X' },
      { role: 'assistant', text: 'noted' },
    ]);
  });
});
