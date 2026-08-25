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

// Fake drivers that record the seed handed to their constructor.
let lastDeviceSeed: SeedTurn[] | undefined;
let lastCloudSeed: SeedTurn[] | undefined;

class FakeDriver {
  subscribe() {
    return () => {};
  }
  send() {}
  abort() {}
  answerApproval() {}
  dispose() {}
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
    await useApp.getState().switchModel({ kind: 'cloud', model: 'claude-x' });
    expect(useApp.getState().conversations.c1!.source.kind).toBe('device');
  });

  it('commits the switch and discloses the device-to-network crossing on success', async () => {
    secrets.set(ANTHROPIC_KEY_KEY, 'sk-test');
    useApp.setState({
      conversations: { c1: convWith([{ role: 'user', text: 'hi' }]) },
      order: ['c1'],
      activeId: 'c1',
    });
    await useApp.getState().switchModel({ kind: 'cloud', model: 'claude-x' });
    const conv = useApp.getState().conversations.c1!;
    expect(conv.source.kind).toBe('cloud');
    // The new cloud driver was seeded with the prior turn.
    expect(lastCloudSeed).toEqual([{ role: 'user', text: 'hi' }]);
    const note = conv.thread.items.find((i) => i.kind === 'note') as { text: string } | undefined;
    expect(note?.text).toContain("sends this chat's history");
  });
});
