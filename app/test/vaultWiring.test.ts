// The store hands every app chat its vault (Vault M5, wave 2): one pack per
// conversation to the device, Claude, OpenAI-compatible and Stack drivers;
// the Stack's personal vault tools; the desktop chat's /chat vault fields;
// prompt caching mirrored from the setting. The Memory switch off means no
// vault in a chat at all: no pack and no vault tools, and /chat says so. The
// drivers are faked so what each constructor receives is observable.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  storeKeys: async () => [...mem.keys()],
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

/** What the last constructor of each kind received as its trailing options. */
const built: {
  device?: { vaultPack?: unknown };
  claude?: { vaultPack?: unknown };
  desktopChat?: Record<string, unknown>;
  stack?: { context: Record<string, unknown>; opts: Record<string, unknown> };
} = {};

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
    constructor(...args: unknown[]) {
      super();
      built.device = args[6] as { vaultPack?: unknown };
    }
  },
}));

vi.mock('../src/drivers/cloudClaudeDriver.js', () => ({
  DEFAULT_CLAUDE_MODEL: 'claude-default',
  CloudClaudeDriver: class extends FakeDriver {
    readonly kind = 'cloud' as const;
    constructor(...args: unknown[]) {
      super();
      built.claude = args[5] as { vaultPack?: unknown };
    }
  },
}));

vi.mock('../src/drivers/desktopChatDriver.js', () => ({
  DesktopChatDriver: class extends FakeDriver {
    readonly kind = 'desktop-chat' as const;
    constructor(...args: unknown[]) {
      super();
      built.desktopChat = args[5] as Record<string, unknown>;
    }
  },
}));

vi.mock('../src/drivers/stackDriver.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/drivers/stackDriver.js')>();
  return {
    ...real,
    StackDriver: class extends FakeDriver {
      readonly kind = 'stack' as const;
      constructor(...args: unknown[]) {
        super();
        built.stack = {
          context: args[2] as Record<string, unknown>,
          opts: args[4] as Record<string, unknown>,
        };
      }
    },
  };
});

const { useApp } = await import('../src/state/store.js');
const { promptCacheOn } = await import('../src/lib/claudeCache.js');

type Source =
  | { kind: 'device'; modelId: string; modelName: string }
  | { kind: 'cloud'; provider: 'anthropic'; model: string }
  | { kind: 'desktop-chat' }
  | { kind: 'stack' };

function conv(id: string, source: Source) {
  return {
    id,
    title: 'chat',
    source,
    projectId: 'p1',
    createdAt: 'x',
    updatedAt: 'x',
    thread: { items: [], citations: [], busy: false, contextPercent: 0, pendingApprovals: [] },
  };
}

/** Each test's chats get fresh ids, since live drivers are module state. */
let run = 0;
const idOf = (key: string) => `${key}${run}`;

function reset(extra: Record<string, unknown> = {}) {
  run += 1;
  mem.clear();
  secrets.clear();
  secrets.set('oscode.secret.anthropic', 'sk-ant');
  for (const k of Object.keys(built)) delete built[k as keyof typeof built];
  useApp.setState({
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      daemon: { baseUrl: 'http://127.0.0.1:1', token: 't' },
      projects: [
        {
          id: 'p1',
          name: 'Demo',
          instructions: '',
          repoIds: [],
          createdAt: 'x',
          vaultPins: ['Pinned.md'],
        },
      ],
      ...extra,
    } as never,
    conversations: {
      [idOf('d')]: conv(idOf('d'), { kind: 'device', modelId: 'm', modelName: 'M' }),
      [idOf('c')]: conv(idOf('c'), {
        kind: 'cloud',
        provider: 'anthropic',
        model: 'claude-opus-5',
      }),
      [idOf('h')]: conv(idOf('h'), { kind: 'desktop-chat' }),
      [idOf('s')]: conv(idOf('s'), { kind: 'stack' }),
    } as never,
    order: ['d', 'c', 'h', 's'].map(idOf),
    activeId: undefined,
  });
}

async function open(key: string): Promise<void> {
  const id = idOf(key);
  useApp.getState().openConversation(id);
  await vi.waitFor(() => expect(useApp.getState().conversations[id]).toBeDefined());
  await new Promise((r) => setTimeout(r, 0));
}

describe('Memory on: every app chat carries the vault', () => {
  beforeEach(() => reset());

  it('the plain drivers get a pack, the Stack its pack, seat and tools', async () => {
    await open('d');
    await open('c');
    await open('s');
    await open('h');
    await vi.waitFor(() => expect(built.stack).toBeDefined());
    expect(built.device?.vaultPack).toBeDefined();
    expect(built.claude?.vaultPack).toBeDefined();
    expect(built.stack!.opts.vaultPack).toBeDefined();
    expect(built.stack!.opts.vaultTools).toBeDefined();
    expect(typeof built.stack!.opts.packSeat).toBe('function');
    // The desktop chat names the project; the computer builds the pack.
    await vi.waitFor(() => expect(built.desktopChat).toBeDefined());
    expect(built.desktopChat).toEqual({ vaultPack: { projectName: 'Demo' } });
  });

  it('one pack per conversation, kept across a rebuild', async () => {
    const id = idOf('d');
    const c = useApp.getState().conversations[id]!;
    useApp.setState({
      conversations: {
        ...useApp.getState().conversations,
        [id]: {
          ...c,
          thread: {
            ...c.thread,
            items: [
              { kind: 'user', id: 'u1', text: 'hi' },
              { kind: 'assistant', id: 'a1', text: 'hello', streaming: false },
            ],
          },
        },
      },
    });
    await open('d');
    const first = built.device?.vaultPack;
    expect(first).toBeDefined();
    await useApp.getState().switchModel({ kind: 'device', modelId: 'm2', modelName: 'M2' });
    await vi.waitFor(() => expect(built.device?.vaultPack).toBeDefined());
    expect(built.device?.vaultPack).toBe(first);
  });

  it('the pack setting off drops the pack but keeps the Stack tools', async () => {
    reset({ vaultContext: 'off' });
    await open('d');
    await open('s');
    await open('h');
    await vi.waitFor(() => expect(built.stack && built.desktopChat).toBeDefined());
    expect(built.device?.vaultPack).toBeUndefined();
    expect(built.stack!.opts.vaultPack).toBeUndefined();
    expect(built.stack!.opts.vaultTools).toBeDefined();
    expect(built.desktopChat).toEqual({});
  });
});

describe('Memory off: no vault in any chat', () => {
  beforeEach(() => reset({ wayfinding: { memory: false } }));

  it('withholds the pack and the vault tools, and tells /chat', async () => {
    await open('d');
    await open('c');
    await open('s');
    await open('h');
    await vi.waitFor(() => expect(built.stack && built.desktopChat).toBeDefined());
    expect(built.device?.vaultPack).toBeUndefined();
    expect(built.claude?.vaultPack).toBeUndefined();
    expect(built.stack!.opts.vaultPack).toBeUndefined();
    expect(built.stack!.opts.vaultTools).toBeUndefined();
    expect(built.desktopChat).toEqual({ memory: false });
  });
});

describe('prompt caching follows the setting (J16, J19)', () => {
  beforeEach(() => reset());

  it('is off by default and mirrored on change, and the Stack reads it', async () => {
    await open('s');
    await vi.waitFor(() => expect(built.stack).toBeDefined());
    expect(built.stack!.context.promptCache).toBe(false);
    expect(promptCacheOn()).toBe(false);
    await useApp.getState().saveSettings({ promptCache: true });
    expect(promptCacheOn()).toBe(true);
    await useApp.getState().saveSettings({ promptCache: false });
    expect(promptCacheOn()).toBe(false);
  });
});
