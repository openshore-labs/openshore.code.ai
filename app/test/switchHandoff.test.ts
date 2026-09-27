// The switch handoff (Vault M5, CTO J12, J13). A model switch seeds the new
// seat with the whole chat when it fits the seat's window, and otherwise with
// a handoff covering exactly what dropped plus the newest turns that fit; a
// 32k seat never gets more than fits; the desktop agent, which takes no
// history, receives the handoff in its session create; no handoff ever holds
// thinking or a reply that drew on a local-only note; the device store
// `oscode.handoffs.v1` is written on a switch and when a chat of four or more
// turns is left, never with Memory off, and cleared with the chat; and the
// note's "Save to Vault" writes `Handoffs/<date> <project>.md`, " 2" on a
// clash, never over a note already there.
//
// The core's `buildHandoff` and `fitSeed` are stream A's; here they are small
// honest fakes (the fit keeps the newest turns within the window; the handoff
// quotes the turns it was given), so what is asserted is the app's adapter,
// sizing and wiring. The seat judge (`packSeatFor`, stream E) is faked too.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedTurn, ThreadItem } from '../src/state/types.js';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();
const desk = vi.hoisted(() => ({ on: false }));

vi.mock('os-code/protocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os-code/protocol')>();
  return {
    ...actual,
    // Keep the newest messages that fit beside the system, the handoff and
    // the reply; the last message always stays.
    fitSeed: <M>(o: {
      system: string;
      handoff?: string;
      messages: M[];
      replyTokens: number;
      contextTokens: number;
      estimate: (s: string) => number;
    }) => {
      const text = (m: M) => (m as unknown as { content: string }).content;
      let budget =
        o.contextTokens - o.replyTokens - o.estimate(o.system) - o.estimate(o.handoff ?? '');
      let start = o.messages.length - 1;
      budget -= o.estimate(text(o.messages[start]!));
      while (start > 0 && o.estimate(text(o.messages[start - 1]!)) <= budget) {
        budget -= o.estimate(text(o.messages[start - 1]!));
        start -= 1;
      }
      return { messages: o.messages.slice(start), dropped: start };
    },
    buildHandoff: (
      turns: Array<{ role: string; text: string }>,
      budget: number,
      meta: { from?: string; date: string },
    ) => {
      const spoken = turns.filter((t) => t.role !== 'tool').length;
      const head = `HANDOFF from ${meta.from ?? 'a model'}, ${meta.date}, covering ${spoken} earlier turns.`;
      const body = turns.map((t) => `${t.role}: ${t.text}`).join('\n');
      const text = `${head}\n${body}`.slice(0, Math.max(head.length, budget * 4));
      return { text, tokens: Math.ceil(text.length / 4), turns: spoken };
    },
  };
});

vi.mock('../src/lib/vaultSeat.js', () => ({
  hubTailnetSuffix: () => null,
  packSeatFor: (ref: { kind: string; model?: string }) =>
    ref.kind === 'device'
      ? { modelClass: 'tiny', servedTokens: 4096, leavesNetwork: false }
      : {
          modelClass: 'large',
          servedTokens: ref.model === 'claude-32k' ? 32000 : 200000,
          leavesNetwork: true,
        },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => (desk.on ? 'electron' : 'web'),
  isDesktop: () => desk.on,
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

let lastCloudSeed: SeedTurn[] | undefined;
let lastDeviceSeed: SeedTurn[] | undefined;
const created: Array<{ cwd?: string; opts: Record<string, unknown> }> = [];

class FakeDriver {
  private sink?: (event: unknown, seq: number) => void;
  subscribe(sink: (event: unknown, seq: number) => void) {
    this.sink = sink;
    return () => {
      this.sink = undefined;
    };
  }
  send(text: string) {
    queueMicrotask(() => this.sink?.({ type: 'task-start', input: text }, 0));
  }
  abort() {}
  answerApproval() {}
  dispose() {}
}

vi.mock('../src/drivers/cloudClaudeDriver.js', () => ({
  DEFAULT_CLAUDE_MODEL: 'claude-default',
  contextWindowFor: () => 200000,
  CloudClaudeDriver: class extends FakeDriver {
    readonly kind = 'cloud' as const;
    constructor(_key: string, _model: string, seed?: SeedTurn[]) {
      super();
      lastCloudSeed = seed;
    }
  },
}));

vi.mock('../src/drivers/onDeviceDriver.js', () => ({
  OnDeviceDriver: class extends FakeDriver {
    readonly kind = 'device' as const;
    constructor(_id: string, _name: string, seed?: SeedTurn[]) {
      super();
      lastDeviceSeed = seed;
    }
  },
}));

vi.mock('../src/drivers/electronDriver.js', () => ({
  ElectronDriver: class extends FakeDriver {
    readonly kind = 'desktop' as const;
  },
}));

vi.mock('../src/lib/electronBridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/electronBridge.js')>();
  return {
    ...actual,
    bridge: () =>
      desk.on
        ? {
            platform: 'electron',
            createSession: async (cwd: string | undefined, opts: Record<string, unknown>) => {
              created.push({ cwd, opts });
              return { id: `s${created.length}`, cwd: cwd ?? '/w', warnings: [] };
            },
            resumeSession: async () => ({}),
          }
        : undefined,
  };
});

// The personal vault for "Save to Vault": an in-memory This device store that
// does not enforce the write guard, so the store must ask before it writes.
const notes = new Map<string, string>();
const local = {
  id: 'local',
  label: 'local',
  blurb: '',
  ready: true,
  async list() {
    return [...notes.keys()].map((path) => ({ path, updatedAt: 'x', size: 1 }));
  },
  async stat(_r: string, path: string) {
    return notes.has(path) ? { path, updatedAt: 'x', size: 1 } : undefined;
  },
  async read(_r: string, path: string) {
    return notes.has(path) ? { path, text: notes.get(path)!, updatedAt: 'x' } : undefined;
  },
  async write(_r: string, path: string, text: string) {
    notes.set(path, text);
    return { ok: true as const, file: { path, text, updatedAt: 'x' } };
  },
  async remove(_r: string, path: string) {
    notes.delete(path);
    return { ok: true as const };
  },
};
vi.mock('../src/lib/gitos/index.js', async () => {
  const providers = await vi.importActual<typeof import('../src/lib/gitos/providers.js')>(
    '../src/lib/gitos/providers.js',
  );
  return {
    isNotePath: providers.isNotePath,
    providerFor: (id: string) => (id === 'local' ? local : undefined),
    probeReady: async (id: string) => id === 'local',
    connectGdrive: async () => ({ ok: true }),
    disconnectGdrive: async () => {},
    isGdriveConnected: async () => false,
    setOrgVaultAuth: () => {},
    resetOrgVault: () => {},
  };
});

const { useApp } = await import('../src/state/store.js');
const { threadHandoffTurns, planSwitchSeed, HANDOFFS_KEY, handoffNotePath } =
  await import('../src/state/handoffs.js');
const { estimateTokens } = await import('../src/drivers/deviceModel.js');

const ANTHROPIC_KEY_KEY = 'oscode.secret.anthropic';

const user = (i: number, text: string): ThreadItem => ({ kind: 'user', id: `u${i}`, text });
const reply = (i: number, text: string, extra: Partial<ThreadItem> = {}): ThreadItem =>
  ({ kind: 'assistant', id: `a${i}`, text, streaming: false, ...extra }) as ThreadItem;

/** A chat of `pairs` exchanges, each turn about `chars` characters. */
function longChat(pairs: number, chars: number): ThreadItem[] {
  const items: ThreadItem[] = [];
  for (let i = 0; i < pairs; i++) {
    items.push(user(i, `Question ${i}. ${'q'.repeat(chars)}`));
    items.push(reply(i, `Answer ${i}. ${'a'.repeat(chars)}`));
  }
  return items;
}

// Each chat state is new, so the store's once-per-state write never skips.
let stamp = 0;
function conv(items: ThreadItem[], over: Record<string, unknown> = {}) {
  stamp += 1;
  return {
    id: 'c1',
    title: 'chat',
    projectId: 'p1',
    source: { kind: 'device' as const, modelId: 'm', modelName: 'Pocket' },
    createdAt: 'x',
    updatedAt: `2026-09-27T00:00:${String(stamp % 60).padStart(2, '0')}.${stamp}Z`,
    thread: {
      items,
      citations: [],
      busy: false,
      contextPercent: 0,
      dollars: 0,
      pendingApprovals: [],
      todos: [],
      queued: [],
      changedFiles: [],
      lastSeq: 0,
    },
    ...over,
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function reset(settings: Record<string, unknown> = {}) {
  mem.clear();
  secrets.clear();
  notes.clear();
  created.length = 0;
  lastCloudSeed = undefined;
  lastDeviceSeed = undefined;
  desk.on = false;
  useApp.setState({
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      projects: [{ id: 'p1', name: 'Atlas', repoIds: [], createdAt: 'x' }],
      activeProjectId: 'p1',
      ...settings,
    },
    conversations: {},
    order: [],
    activeId: undefined,
  });
}

const note = () =>
  useApp
    .getState()
    .conversations.c1!.thread.items.filter((i) => i.kind === 'note')
    .pop() as Extract<ThreadItem, { kind: 'note' }> | undefined;

describe('a switch seeds the new seat with what fits', () => {
  beforeEach(() => reset());

  it('carries the whole chat when it fits, and says so', async () => {
    secrets.set(ANTHROPIC_KEY_KEY, 'sk');
    const items = [user(0, 'remember X'), reply(0, 'noted')];
    useApp.setState({ conversations: { c1: conv(items) }, order: ['c1'], activeId: 'c1' });
    await useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    expect(lastCloudSeed).toEqual([
      { role: 'user', text: 'remember X' },
      { role: 'assistant', text: 'noted' },
    ]);
    expect(note()?.text).toContain('The whole chat came along.');
  });

  it('never gives a 32k seat more than fits: a handoff opens it, the newest turns follow', async () => {
    secrets.set(ANTHROPIC_KEY_KEY, 'sk');
    // Sixty exchanges of about 1,000 tokens a turn: far more than 32k.
    const items = longChat(60, 3200);
    useApp.setState({ conversations: { c1: conv(items) }, order: ['c1'], activeId: 'c1' });
    await useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-32k' });
    const seed = lastCloudSeed!;
    expect(seed.length).toBeLessThan(items.length);
    const used = seed.reduce((n, t) => n + estimateTokens(t.text), 0);
    expect(used).toBeLessThanOrEqual(32000);
    expect(seed[0]!.role).toBe('user');
    expect(seed[0]!.text.startsWith('HANDOFF from On this device · Pocket')).toBe(true);
    // The live end of the chat is kept word for word.
    expect(seed[seed.length - 1]!.text).toBe((items[items.length - 1] as { text: string }).text);
    const n = note()!;
    expect(n.text).toMatch(/Now using Claude .*Handed over with a summary of \d+ earlier turns\./);
    expect(n.handoff?.text.startsWith('HANDOFF from On this device · Pocket')).toBe(true);
    expect(n.handoff?.project).toBe('Atlas');
  });

  it('sizes a pocket seat by its 4,096 window', async () => {
    const items = longChat(12, 1600);
    useApp.setState({
      conversations: {
        c1: conv(items, { source: { kind: 'cloud', provider: 'anthropic', model: 'claude-x' } }),
      },
      order: ['c1'],
      activeId: 'c1',
    });
    await useApp.getState().switchModel({ kind: 'device', modelId: 'm2', modelName: 'Pocket 2' });
    const seed = lastDeviceSeed!;
    const used = seed.reduce((n, t) => n + estimateTokens(t.text), 0);
    expect(used).toBeLessThanOrEqual(4096);
    expect(seed[0]!.text.startsWith('HANDOFF from')).toBe(true);
  });

  it('the handoff covers exactly the turns that dropped', () => {
    const items = longChat(30, 3200);
    const plan = planSwitchSeed({ items, servedTokens: 32000, date: '2026-09-27', from: 'M' });
    expect(plan.dropped).toBeGreaterThan(0);
    // The fake quotes each turn it was given: the first dropped turn is in,
    // the first kept one is not.
    expect(plan.handoff!.text).toContain('Question 0.');
    const firstKept = `Question ${plan.dropped / 2}.`;
    expect(plan.handoff!.text).not.toContain(firstKept);
    expect(plan.seed[0]!.text).toContain(firstKept);
  });
});

describe('no thinking and no local-only text in any handoff', () => {
  it('the adapter drops thinking items, think tags and local-only replies', () => {
    const items: ThreadItem[] = [
      user(0, 'plan the launch'),
      { kind: 'thinking', id: 't0', text: 'SECRET-THOUGHT', streaming: false, startedAt: 0 },
      reply(0, '<think>SECRET-TAG</think>We will ship Friday.'),
      user(1, 'what did my private note say?'),
      reply(1, 'PRIVATE-NOTE-TEXT', { localOnly: true } as Partial<ThreadItem>),
      {
        kind: 'tool',
        id: 'x',
        name: 'readFile',
        summary: 'Read src/app.ts',
        state: 'ok',
        path: 'src/app.ts',
      },
    ];
    const turns = threadHandoffTurns(items);
    const all = JSON.stringify(turns);
    expect(all).not.toContain('SECRET-THOUGHT');
    expect(all).not.toContain('SECRET-TAG');
    expect(all).not.toContain('PRIVATE-NOTE-TEXT');
    expect(all).toContain('We will ship Friday.');
    expect(turns.find((t) => t.role === 'tool')?.paths).toEqual(['src/app.ts']);
  });

  it('a switch handoff holds no thinking', async () => {
    reset();
    secrets.set(ANTHROPIC_KEY_KEY, 'sk');
    const items: ThreadItem[] = [
      { kind: 'thinking', id: 't0', text: 'SECRET-THOUGHT', streaming: false, startedAt: 0 },
      reply(99, '<think>SECRET-TAG</think>Opening answer.'),
      ...longChat(60, 3200),
    ];
    useApp.setState({ conversations: { c1: conv(items) }, order: ['c1'], activeId: 'c1' });
    await useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-32k' });
    const text = lastCloudSeed![0]!.text;
    expect(text.startsWith('HANDOFF')).toBe(true);
    expect(text).toContain('Opening answer.');
    expect(text).not.toContain('SECRET');
    expect(note()!.handoff!.text).not.toContain('SECRET');
  });
});

describe('the desktop agent receives the handoff', () => {
  beforeEach(() => reset());

  it('a chat carried to the computer opens an agent chat whose create carries the handoff', async () => {
    desk.on = true;
    useApp.setState({
      personalUnlockedNow: () => true,
      conversations: { c1: conv([user(0, 'we chose Postgres'), reply(0, 'Going with Postgres.')]) },
      order: ['c1'],
      activeId: 'c1',
    });
    await useApp.getState().switchModel({ kind: 'desktop', cwd: '/w/atlas', repoName: 'atlas' });
    await flush();
    expect(created).toHaveLength(1);
    const handoff = created[0]!.opts.handoff as string;
    expect(handoff.startsWith('HANDOFF from On this device · Pocket')).toBe(true);
    expect(handoff).toContain('Going with Postgres.');
    const s = useApp.getState();
    expect(s.activeId).not.toBe('c1');
    const opened = s.conversations[s.activeId!]!;
    expect(opened.source.kind).toBe('desktop');
    const first = opened.thread.items[0] as { kind: string; text: string };
    expect(first.kind).toBe('note');
    expect(first.text).toContain('Handed over with a summary of 2 earlier turns from your chat.');
  });
});

describe('the device store, oscode.handoffs.v1', () => {
  beforeEach(() => reset());
  const stored = () =>
    (mem.has(HANDOFFS_KEY) ? JSON.parse(mem.get(HANDOFFS_KEY)!) : {}) as Record<
      string,
      { text: string; conversationId: string; turns: number }
    >;

  it('a switch writes the project handoff, even when the whole chat came along', async () => {
    secrets.set(ANTHROPIC_KEY_KEY, 'sk');
    useApp.setState({
      conversations: { c1: conv([user(0, 'hi'), reply(0, 'hello')]) },
      order: ['c1'],
      activeId: 'c1',
    });
    await useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    await flush();
    expect(stored().p1?.conversationId).toBe('c1');
    expect(stored().p1?.text.startsWith('HANDOFF')).toBe(true);
  });

  it('leaving a chat of four or more turns writes one; a shorter chat does not', async () => {
    useApp.setState({
      conversations: {
        c1: conv(longChat(2, 10)),
        c2: conv([user(0, 'hi')], { id: 'c2' }),
      },
      order: ['c1', 'c2'],
      activeId: 'c2',
    });
    useApp.setState({ activeId: 'c1' });
    await flush();
    expect(stored().p1).toBeUndefined();
    useApp.setState({ activeId: 'c2' });
    await flush();
    expect(stored().p1?.conversationId).toBe('c1');
    expect(stored().p1?.turns).toBe(4);
  });

  it('Memory off writes none', async () => {
    reset({ wayfinding: { memory: false } });
    useApp.setState({
      conversations: { c1: conv(longChat(3, 10)) },
      order: ['c1'],
      activeId: 'c1',
    });
    useApp.setState({ activeId: undefined });
    await flush();
    expect(stored().p1).toBeUndefined();
    expect(await useApp.getState().projectHandoff('p1')).toBeUndefined();
  });

  it('is read back within seven days and cleared with the chat', async () => {
    useApp.setState({
      conversations: { c1: conv(longChat(3, 10)) },
      order: ['c1'],
      activeId: 'c1',
    });
    useApp.setState({ activeId: undefined });
    await flush();
    expect((await useApp.getState().projectHandoff('p1'))?.conversationId).toBe('c1');
    const old = stored();
    old.p1 = { ...old.p1!, at: new Date(Date.now() - 8 * 86_400_000).toISOString() } as never;
    mem.set(HANDOFFS_KEY, JSON.stringify(old));
    expect(await useApp.getState().projectHandoff('p1')).toBeUndefined();
    useApp.getState().deleteConversation('c1');
    await flush();
    expect(stored().p1).toBeUndefined();
  });
});

describe('Save to Vault', () => {
  beforeEach(() => reset());

  it('writes Handoffs/<date> <project>.md, " 2" on a clash, never over a note', async () => {
    secrets.set(ANTHROPIC_KEY_KEY, 'sk');
    useApp.setState({
      conversations: { c1: conv([user(0, 'hi'), reply(0, 'hello')]) },
      order: ['c1'],
      activeId: 'c1',
    });
    await useApp
      .getState()
      .switchModel({ kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    const n = note()!;
    const date = n.handoff!.date;
    const taken = handoffNotePath(date, 'Atlas');
    expect(taken).toBe(`Handoffs/${date} Atlas.md`);
    notes.set(taken, 'mine, already here');
    const path = await useApp.getState().saveHandoffToVault('c1', n.id);
    expect(path).toBe(`Handoffs/${date} Atlas 2.md`);
    expect(notes.get(taken)).toBe('mine, already here');
    expect(notes.get(path!)).toContain('HANDOFF from On this device · Pocket');
    expect(note()!.handoff!.savedPath).toBe(path);
    // A second tap does not write again.
    expect(await useApp.getState().saveHandoffToVault('c1', n.id)).toBe(path);
    expect([...notes.keys()].filter((k) => k.startsWith('Handoffs/'))).toHaveLength(2);
  });
});
