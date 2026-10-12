// The first ten minutes (build 2026-09-29, package F1; UX review ruling 2, tech review ruling
// 8). A first message typed before anything can answer is held in the store,
// so a trip to a setup room never loses it. On a signed-out desktop with no
// model, it waits on the First Seat (never the sign-in sheet) and goes out the
// moment the engine can answer, as the free chat with this computer's own
// model over IPC: no session, no coding agent. The phone's free chat still
// rides the daemon over HTTP. Signed out, a coding chat's commands open the
// sign-in sheet, and a message parked at that door stays after "Not now".
// The pure rules first, then the store against a fake desktop bridge.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();

// The desktop shell and this computer's engine, as far as the first run sees
// them: whether a model is set up, the sessions opened, and the free chats.
type FreeChatListener = (payload: { requestId: string; event: Record<string, unknown> }) => void;
const desk = vi.hoisted(() => ({
  on: false,
  configured: false,
  kind: 'local' as 'local' | 'cloud',
  sessions: 0,
  freeChats: [] as Array<{ requestId: string; body: Record<string, unknown> }>,
  listeners: new Set<FreeChatListener>(),
  reply: 'Hello. Ask me anything.',
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => (desk.on ? 'electron' : 'web'),
  isDesktop: () => desk.on,
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

function fakeBridge() {
  return {
    status: async () => ({
      ollama: { up: true, detail: 'running', models: [] },
      hardwareSummary: 'no dedicated GPU detected, 8 GB system RAM',
      stack: {
        configured: desk.configured,
        description: desk.configured ? 'qwen2.5:3b, solo' : 'not set up yet',
        orchestrator: desk.configured
          ? { model: 'qwen2.5:3b', provider: 'ollama', kind: desk.kind }
          : undefined,
        specialists: [],
      },
      connections: { anthropic: false, openai: false, github: false },
    }),
    onInstallProgress: () => () => {},
    installModel: async () => ({ ok: true, detail: 'pulled' }),
    setOrchestrator: async () => {
      desk.configured = true;
      return { ok: true, detail: 'seated' };
    },
    createSession: async () => {
      desk.sessions++;
      return { id: 'sess_x', cwd: '/tmp/x', warnings: [] };
    },
    resumeSession: async () => ({ error: 'none' }),
    onEvent: () => () => {},
    freeChat: async (requestId: string, body: Record<string, unknown>) => {
      // IPC copies what it carries, so the record is a copy too.
      desk.freeChats.push({ requestId, body: JSON.parse(JSON.stringify(body)) });
      await Promise.resolve();
      for (const l of [...desk.listeners]) {
        l({ requestId, event: { type: 'text', delta: desk.reply } });
        l({ requestId, event: { type: 'done' } });
      }
    },
    freeChatAbort: async () => {},
    onFreeChat: (cb: FreeChatListener) => {
      desk.listeners.add(cb);
      return () => desk.listeners.delete(cb);
    },
  };
}

vi.mock('../src/lib/electronBridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/electronBridge.js')>()),
  bridge: () => (desk.on ? fakeBridge() : undefined),
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

// Accounts are configured, and nobody is signed in unless a test says so.
vi.mock('../src/lib/supabase.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabase.js')>()),
  isConfigured: () => true,
  select: async () => [],
  rpc: async () => null,
  readUserPrefs: async () => undefined,
  writeUserPrefs: async () => {},
}));

const {
  FIRST_SEAT_COPY,
  defaultComposerSource,
  engineChatReady,
  heldMessagePlan,
  joinHeld,
  waitsOnFirstSeat,
} = await import('../src/state/firstRunOps.js');
const { SOURCE_ACCOUNT } = await import('../src/lib/accountGate.js');
const { useApp } = await import('../src/state/store.js');
const { emptyThread } = await import('../src/state/types.js');
type AppSettings = import('../src/state/store.js').AppSettings;
type Conversation = import('../src/state/types.js').Conversation;

const base = (extra: Partial<AppSettings> = {}): AppSettings => ({
  onboarded: true,
  claudeModel: 'x',
  deviceModels: {},
  ...extra,
});

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function reset(): void {
  mem.clear();
  desk.on = false;
  desk.configured = false;
  desk.kind = 'local';
  desk.sessions = 0;
  desk.freeChats.length = 0;
  desk.listeners.clear();
  useApp.setState({
    authSession: undefined,
    accountGate: undefined,
    view: 'chat',
    viewTrail: [],
    toast: undefined,
    paywall: undefined,
    conversations: {},
    order: [],
    activeId: undefined,
    desktopStatus: undefined,
    cloudKeyPresent: false,
    harborMasterDownload: undefined,
    settings: base(),
  });
}

describe('the first run rules (state/firstRunOps.ts)', () => {
  it("says UX review ruling 2's words exactly", () => {
    expect(FIRST_SEAT_COPY.held).toBe('Your message is saved. It sends when DeepBlue is ready.');
    const { before, link, after } = FIRST_SEAT_COPY.signIn;
    expect(`${before}${link}${after}`).toBe(
      'While you wait, you can sign in so DeepBlue can also work in your projects. Free, and not needed to chat.',
    );
    expect(FIRST_SEAT_COPY.failed).toBe('Your message is still saved.');
    expect(FIRST_SEAT_COPY.sending).toBe('DeepBlue is ready. Sending your message.');
  });

  it('starts a signed-out desktop on the free chat, never the coding agent', () => {
    const d = { desktop: true, needsAccount: true };
    expect(defaultComposerSource({ ...d, engineChat: true, stackReady: true })).toEqual({
      kind: 'desktop-chat',
    });
    expect(defaultComposerSource({ ...d, engineChat: false, stackReady: true })).toEqual({
      kind: 'stack',
    });
    expect(defaultComposerSource({ ...d, engineChat: false, stackReady: false })).toEqual({
      kind: 'desktop-chat',
    });
    // Signed in, the desktop starts on its engine's agent; the phone on the Stack.
    expect(
      defaultComposerSource({
        desktop: true,
        needsAccount: false,
        engineChat: true,
        stackReady: true,
      }),
    ).toEqual({ kind: 'desktop' });
    expect(
      defaultComposerSource({
        desktop: false,
        needsAccount: true,
        engineChat: false,
        stackReady: false,
      }),
    ).toEqual({ kind: 'stack' });
  });

  it('the free chat is chat in the gate, and only the coding agent needs a sign-in', () => {
    expect(SOURCE_ACCOUNT['desktop-chat']).toBeNull();
    expect(SOURCE_ACCOUNT.desktop).toBe('coding');
    for (const kind of ['device', 'cloud', 'stack', 'mock'] as const) {
      expect(SOURCE_ACCOUNT[kind], kind).toBeNull();
    }
  });

  it('the engine holds a free chat only with a local model', () => {
    expect(engineChatReady(undefined)).toBe(false);
    expect(engineChatReady({ stack: { configured: false } })).toBe(false);
    expect(engineChatReady({ stack: { configured: true, orchestrator: { kind: 'local' } } })).toBe(
      true,
    );
    expect(engineChatReady({ stack: { configured: true, orchestrator: { kind: 'cloud' } } })).toBe(
      false,
    );
  });

  it('waits on the First Seat only on a desktop with its status read and nothing set up', () => {
    const d = { desktop: true, statusKnown: true, configured: false, cloudReady: false };
    expect(waitsOnFirstSeat(d)).toBe(true);
    expect(waitsOnFirstSeat({ ...d, statusKnown: false })).toBe(false);
    expect(waitsOnFirstSeat({ ...d, configured: true })).toBe(false);
    expect(waitsOnFirstSeat({ ...d, cloudReady: true })).toBe(false);
    expect(waitsOnFirstSeat({ ...d, desktop: false })).toBe(false);
  });

  it('plans a held message: restore after a jump, wait on the seat, send when ready', () => {
    const on = { emptyChat: true, chooserOpen: false, statusKnown: true };
    const chooser = { untilReady: undefined };
    const seat = { untilReady: true };
    expect(heldMessagePlan({ ...on, held: undefined, engineReady: true, seatUp: false })).toBe(
      'none',
    );
    expect(heldMessagePlan({ ...on, held: chooser, engineReady: false, seatUp: false })).toBe(
      'restore',
    );
    expect(
      heldMessagePlan({
        ...on,
        held: chooser,
        chooserOpen: true,
        engineReady: false,
        seatUp: false,
      }),
    ).toBe('none');
    expect(
      heldMessagePlan({
        ...on,
        held: chooser,
        emptyChat: false,
        engineReady: false,
        seatUp: false,
      }),
    ).toBe('none');
    expect(heldMessagePlan({ ...on, held: seat, engineReady: false, seatUp: true })).toBe('wait');
    expect(
      heldMessagePlan({
        ...on,
        held: seat,
        statusKnown: false,
        engineReady: false,
        seatUp: false,
      }),
    ).toBe('wait');
    expect(heldMessagePlan({ ...on, held: seat, engineReady: true, seatUp: false })).toBe('send');
    // Something other than the engine can answer now: back into the composer.
    expect(heldMessagePlan({ ...on, held: seat, engineReady: false, seatUp: false })).toBe(
      'restore',
    );
    expect(joinHeld(undefined, 'hi')).toBe('hi');
    expect(joinHeld('hi', 'and this')).toBe('hi\n\nand this');
  });
});

describe('a held first message in the store', () => {
  beforeEach(reset);

  it('survives a jump from the chooser to the Stack and comes back for the composer', async () => {
    await useApp.getState().holdFirstMessage('build me a login page');
    // While the chooser has it, nothing settles it.
    expect(useApp.getState().settleHeldMessage({ chooserOpen: true })).toBeUndefined();
    useApp.getState().setView('stack');
    // In the Stack room, the chat screen is gone and the message is still held.
    expect(useApp.getState().settleHeldMessage({ chooserOpen: false })).toBeUndefined();
    expect(useApp.getState().settings.heldFirstMessage?.text).toBe('build me a login page');
    useApp.getState().setView('chat');
    const back = useApp.getState().settleHeldMessage({ chooserOpen: false });
    expect(back?.text).toBe('build me a login page');
    expect(useApp.getState().settings.heldFirstMessage).toBeUndefined();
    expect(useApp.getState().order).toEqual([]);
  });
});

describe('a signed-out desktop with no model (UX review ruling 2, tech review ruling 8)', () => {
  beforeEach(reset);

  it('waits on the First Seat, then sends the message as a free chat once the engine is ready', async () => {
    desk.on = true;
    await useApp.getState().refreshDesktopStatus();
    const s = useApp.getState();
    expect(s.needsAccountNow()).toBe(true);
    expect(s.composerDefaultSource()).toEqual({ kind: 'desktop-chat' });
    expect(s.sourceReady({ kind: 'desktop-chat' })).toBe(false);
    // With nothing set up, a send waits on the First Seat: no chooser, no
    // sign-in sheet.
    expect(s.sendWaitsOnFirstSeat()).toBe(true);
    await s.holdUntilReady('what is a closure?');
    await s.holdUntilReady('and a promise?');
    expect(useApp.getState().settings.heldFirstMessage).toMatchObject({
      text: 'what is a closure?\n\nand a promise?',
      untilReady: true,
    });
    expect(useApp.getState().settleHeldMessage({ chooserOpen: false })).toBeUndefined();
    expect(useApp.getState().order).toEqual([]);
    expect(useApp.getState().accountGate).toBeUndefined();

    // The one tap on the seat: DeepBlue comes down and is seated, and the
    // engine reports a model.
    expect(await useApp.getState().ensureHarborMaster()).toBe(true);
    expect(useApp.getState().sourceReady({ kind: 'desktop-chat' })).toBe(true);
    expect(useApp.getState().settleHeldMessage({ chooserOpen: false })).toBeUndefined();
    expect(useApp.getState().toast).toBe(FIRST_SEAT_COPY.sending);
    expect(useApp.getState().settings.heldFirstMessage).toBeUndefined();

    // A plain chat with this computer's own model: over IPC, no session.
    await until(() => desk.freeChats.length === 1, 'the free chat');
    const id = useApp.getState().activeId!;
    const conv = useApp.getState().conversations[id]!;
    expect(conv.source).toEqual({ kind: 'desktop-chat' });
    expect(desk.sessions).toBe(0);
    expect(desk.freeChats[0]!.body.messages).toEqual([
      { role: 'user', content: 'what is a closure?\n\nand a promise?' },
    ]);
    // No vault fields ride the desktop's free chat.
    expect(desk.freeChats[0]!.body.vaultPack).toBeUndefined();
    await until(
      () => useApp.getState().conversations[id]!.thread.items.some((i) => i.kind === 'assistant'),
      'the answer',
    );
    const items = useApp.getState().conversations[id]!.thread.items;
    expect(items.find((i) => i.kind === 'user')).toMatchObject({
      text: 'what is a closure?\n\nand a promise?',
    });
    expect(items.find((i) => i.kind === 'assistant')).toMatchObject({ text: desk.reply });
    expect(useApp.getState().accountGate).toBeUndefined();
  });

  it('gives the waiting words back when something else can answer first (a cloud key)', async () => {
    desk.on = true;
    await useApp.getState().refreshDesktopStatus();
    await useApp.getState().holdUntilReady('hello');
    useApp.setState({ cloudKeyPresent: true });
    const back = useApp.getState().settleHeldMessage({ chooserOpen: false });
    expect(back?.text).toBe('hello');
    expect(useApp.getState().order).toEqual([]);
    expect(desk.freeChats).toHaveLength(0);
  });

  it('with a model already set up, a signed-out first message is a free chat at once', async () => {
    desk.on = true;
    desk.configured = true;
    await useApp.getState().refreshDesktopStatus();
    const source = useApp.getState().composerDefaultSource();
    expect(source).toEqual({ kind: 'desktop-chat' });
    const id = await useApp.getState().newConversation(source, { firstMessage: { text: 'hi' } });
    expect(id).toBeDefined();
    await until(() => desk.freeChats.length === 1, 'the free chat');
    expect(desk.sessions).toBe(0);
    expect(useApp.getState().accountGate).toBeUndefined();
  });

  it('a cloud orchestrator is not a free chat seat', async () => {
    desk.on = true;
    desk.configured = true;
    desk.kind = 'cloud';
    await useApp.getState().refreshDesktopStatus();
    expect(useApp.getState().sourceReady({ kind: 'desktop-chat' })).toBe(false);
    expect(useApp.getState().sourceReady({ kind: 'desktop' })).toBe(true);
  });
});

describe("the phone's free chat still rides the daemon over HTTP", () => {
  beforeEach(reset);

  it('posts to the paired computer and never to the desktop bridge', async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode(`data: ${JSON.stringify({ type: 'text', delta: 'Hi.' })}\n\n`),
          );
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    }) as unknown as typeof fetch;
    try {
      useApp.setState({ settings: base({ daemon: { baseUrl: 'http://desk:7777', token: 't' } }) });
      const id = await useApp
        .getState()
        .newConversation({ kind: 'desktop-chat' }, { firstMessage: { text: 'hello' } });
      await until(
        () =>
          Boolean(
            id &&
            useApp.getState().conversations[id]!.thread.items.some((i) => i.kind === 'assistant'),
          ),
        'the answer',
      );
      expect(calls).toContain('http://desk:7777/chat');
      expect(desk.freeChats).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('signed out, the coding door opens the sheet (gate note)', () => {
  beforeEach(reset);

  function codingChat(): Conversation {
    const at = '2026-09-28T10:00:00.000Z';
    return {
      id: 'code1',
      title: 'Fix the header',
      source: { kind: 'desktop', sessionId: 'sess_1', cwd: '/repo' },
      repoIds: [],
      createdAt: at,
      updatedAt: at,
      thread: {
        ...emptyThread(),
        items: [{ kind: 'user', id: 'u1', text: 'fix the header' }],
      },
    };
  }

  it('running a command on a coding chat opens the sign-in sheet, not "no terminal"', () => {
    useApp.setState({
      conversations: { code1: codingChat() },
      order: ['code1'],
      activeId: 'code1',
    });
    useApp.getState().runCommand('ls');
    expect(useApp.getState().accountGate).toBe('coding');
    expect(useApp.getState().toast ?? '').not.toMatch(/no terminal/);
  });

  it('a message parked at the door stays on the chat after "Not now"', async () => {
    useApp.setState({
      conversations: { code1: codingChat() },
      order: ['code1'],
      activeId: 'code1',
    });
    useApp.getState().send('and the footer too');
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().accountGate).toBe('coding');
    useApp.getState().closeAccountGate();
    const conv = useApp.getState().conversations.code1!;
    expect(conv.pendingFirstMessage).toBe('and the footer too');
    expect(conv.pendingFirstError).toBeUndefined();
  });
});
