// The Stack's vault pack and prompt order (Vault M5, CTO J5, J16, I5). The
// pack is prepared once per send and rendered only after routing and any Jev
// steer, so it is sized for the seat that actually answers; the fallback to
// the anchor renders again; each play step renders for its owner; a current
// bench seat gets none; with no pack passed (Memory off) nothing rides. The
// system prompt runs stable first and volatile last, and with prompt caching
// on the stable head is its own block marked for caching. A reply written
// after a local-only read is marked, and a later leaving seat gets the stub.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import {
  LOCAL_ONLY_STUB,
  compileVaultPrivacy,
  humanizerStandardPrompt,
  uxStandardPrompt,
} from 'os-code/protocol';
import { effortDirective } from '../src/lib/effort.js';

type NativeReply =
  | string
  | { status: number }
  | { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };

const h = vi.hoisted(() => ({
  callbacks: {} as Record<string, (payload: any) => void>,
  generateCalls: [] as Array<{ requestId: string; system: string; messages: unknown[] }>,
  nativeReplies: [] as NativeReply[],
  nativeBodies: [] as Array<{
    messages: Array<{ role: string; content: unknown }>;
    tools?: unknown[];
  }>,
  claudeScript: [] as string[],
  claudeParams: [] as Array<Record<string, unknown>>,
  jev: undefined as undefined | { steer: (i: unknown) => Promise<unknown> },
  // The paired computer's engine session a play's tool step runs on: each
  // send replays these events to the subscriber.
  engineEvents: [] as unknown[],
  enginePrompts: [] as string[],
  // What the paired computer says of its stack (GET /stack); undefined is
  // no answer, an older daemon's or one out of reach.
  engineStack: undefined as unknown,
}));

vi.mock('../src/drivers/remoteDriver.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeRemoteDriver {
    private sinks: Array<(e: unknown, seq: number) => void> = [];
    subscribe(sink: (e: unknown, seq: number) => void) {
      this.sinks.push(sink);
      return () => undefined;
    }
    send(prompt: string) {
      h.enginePrompts.push(prompt);
      setTimeout(() => {
        for (const e of h.engineEvents) for (const s of this.sinks) s(e, 0);
      }, 0);
    }
    abort() {}
    dispose() {}
  }
  return {
    ...actual,
    RemoteDriver: FakeRemoteDriver,
    daemonCreateSession: async () => 'engine-session',
    daemonStack: async () => {
      if (!h.engineStack) throw new Error('Your computer did not answer.');
      return h.engineStack;
    },
  };
});

vi.mock('os-code/protocol', async (importOriginal) => {
  const real = await importOriginal<typeof import('os-code/protocol')>();
  return { ...real, JevAdvisor: { from: () => h.jev } };
});

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIUserAbortError = class extends Error {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    messages = {
      stream: (params: Record<string, unknown>) => {
        h.claudeParams.push(params);
        const reply = h.claudeScript.shift() ?? 'ok';
        const handlers: Record<string, (delta: string) => void> = {};
        return {
          on: (event: string, cb: (delta: string) => void) => {
            handlers[event] = cb;
          },
          finalMessage: async () => {
            handlers.text?.(reply);
            return { content: [{ type: 'text', text: reply }] };
          },
          abort: () => {},
        };
      },
    };
  }
  return { default: Anthropic };
});

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (payload: any) => void) => {
      h.callbacks[event] = cb;
      return { remove: async () => {} };
    },
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async (opts: { requestId: string; system: string; messages: unknown[] }) => {
      h.generateCalls.push(opts);
      return { started: true };
    },
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  // A cloud key for every provider; your own model runs without one.
  secretGet: async (key: string) => (key.includes('.byom.') ? null : 'sk-test'),
  storeGetJson: async () => null,
}));

// The iPhone streams through the WebView's fetch first; here every server
// refuses the cross-origin call at the preflight, so each request goes once
// through the native shim below (the transport's fallback, CTO ruling 7).
vi.mock('../src/lib/streamingFetch.js', () => ({
  streamingFetch: async () => {
    throw new TypeError('Load failed');
  },
}));

vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: async (_url: string, init: { body: string }) => {
    h.nativeBodies.push(JSON.parse(init.body));
    const reply = h.nativeReplies.shift() ?? '';
    if (typeof reply === 'object' && 'status' in reply) {
      return { ok: false, status: reply.status, json: async () => ({}) };
    }
    const message =
      typeof reply === 'string'
        ? { content: reply }
        : { content: '', tool_calls: reply.tool_calls };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
  },
}));

const { isLocalOnlyFinal, PackLocalOnlyMarker } = await import('../src/drivers/types.js');
const { StackDriver, historyForSeat } = await import('../src/drivers/stackDriver.js');
import type { AppVaultPack, PackSeat } from '../src/drivers/types.js';
import type { AppStack, StackModelRef } from '../src/lib/stack.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A framing reply that plans one specialist step, so the turn goes on to
 *  the single-turn path (a prose reply would be the lead's own answer). */
const ONE_STEP = JSON.stringify({
  clear: true,
  summary: 'One step',
  steps: [{ id: 's1', title: 'Answer', category: 'writing', brief: 'Answer it.' }],
});
const settle = async (n = 10) => {
  for (let i = 0; i < n; i++) await tick();
};

/** The seats this test judges by name: a cloud seat leaves, your own box and
 *  the phone stay here. */
function seatOf(ref: StackModelRef): PackSeat | null {
  if (ref.kind === 'device')
    return { modelClass: 'tiny', servedTokens: 4096, leavesNetwork: false };
  if (ref.kind === 'cloud')
    return { modelClass: 'large', servedTokens: 128000, leavesNetwork: true };
  if (ref.id === 'box-small')
    return { modelClass: 'small', servedTokens: 8192, leavesNetwork: false };
  return { modelClass: 'mid', servedTokens: 32000, leavesNetwork: false };
}

function fakePack() {
  const prepares: string[] = [];
  const seats: PackSeat[] = [];
  const pack: AppVaultPack = {
    prepare: async (task) => {
      prepares.push(task);
    },
    render: (seat) => {
      seats.push(seat);
      return {
        text: `VAULT PACK ${seat.modelClass} ${seat.servedTokens}`,
        event: {
          type: 'context-pack',
          seat: seat.leavesNetwork ? 'cloud' : 'local',
          mode: 'current-state',
          tokens: 12,
          budgetTokens: Math.floor(seat.servedTokens * 0.08),
          sources: [],
          withheld: 0,
          cold: false,
        },
      };
    },
  };
  return { pack, prepares, seats };
}

const device = { kind: 'device', modelId: 'qwen-pocket', modelName: 'Pocket' } as const;
const gpt = { kind: 'cloud', provider: 'openai', model: 'gpt-big', label: 'GPT' } as const;
const claude = {
  kind: 'cloud',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  label: 'Claude',
} as const;
const boxSmall = {
  kind: 'byom',
  id: 'box-small',
  label: 'Box',
  baseUrl: 'http://192.168.1.20:11434/v1',
  model: 'qwen2.5:7b',
} as const;
const boxMid = {
  kind: 'byom',
  id: 'box-mid',
  label: 'Box Mid',
  baseUrl: 'http://192.168.1.20:11434/v1',
  model: 'qwen2.5:14b',
} as const;

function chat(stack: AppStack, extra: Record<string, unknown> = {}, opts?: object) {
  const driver = new StackDriver(stack, 'offshore', extra, undefined, opts);
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

function finishDevice(index: number, text: string) {
  const { requestId } = h.generateCalls[index]!;
  h.callbacks.token!({ requestId, delta: text });
  h.callbacks.generationDone!({ requestId, stopReason: 'end' });
}

const systemOf = (body: { messages: Array<{ role: string; content: unknown }> }) =>
  String(body.messages.find((m) => m.role === 'system')?.content ?? '');

beforeEach(() => {
  h.generateCalls.length = 0;
  h.nativeReplies.length = 0;
  h.nativeBodies.length = 0;
  h.claudeScript.length = 0;
  h.claudeParams.length = 0;
  h.jev = undefined;
  h.engineStack = undefined;
});

describe('the pack on a Stack turn', () => {
  it('reaches a device seat as the last system part, within its window, card after turn-start', async () => {
    const { pack, prepares, seats } = fakePack();
    const { driver, events } = chat(
      { reasoning: device, active: [], saved: {} },
      {},
      {
        vaultPack: pack,
        packSeat: seatOf,
      },
    );
    await tick();
    driver.send('what did we decide about auth?');
    await settle();
    expect(prepares).toEqual(['what did we decide about auth?']);
    expect(seats).toEqual([{ modelClass: 'tiny', servedTokens: 4096, leavesNetwork: false }]);
    const system = h.generateCalls[0]!.system;
    expect(system).toContain('VAULT PACK tiny 4096');
    // Last of the prompt, except the per-send think line a pocket model may get.
    expect(system.indexOf('VAULT PACK')).toBeGreaterThan(system.indexOf('Reasoning effort'));
    const types = events.map((e) => e.type);
    expect(types.indexOf('context-pack')).toBe(types.indexOf('turn-start') + 1);
    finishDevice(0, 'We chose sessions.');
    await settle();
    driver.dispose();
  });

  it('reaches a cloud seat sized for it', async () => {
    const { pack, seats } = fakePack();
    const { driver } = chat(
      { reasoning: gpt, active: [], saved: {} },
      {},
      {
        vaultPack: pack,
        packSeat: seatOf,
      },
    );
    h.nativeReplies.push('Here you go.');
    driver.send('hello');
    await settle();
    expect(seats).toEqual([{ modelClass: 'large', servedTokens: 128000, leavesNetwork: true }]);
    // An anchor with no one to hand off to answers in one call (B2).
    expect(h.nativeBodies).toHaveLength(1);
    const system = systemOf(h.nativeBodies[0]!);
    expect(system.endsWith('VAULT PACK large 128000')).toBe(true);
    driver.dispose();
  });

  it('is left out when no pack is passed (Memory off)', async () => {
    const { driver } = chat({ reasoning: gpt, active: [], saved: {} }, {}, { packSeat: seatOf });
    h.nativeReplies.push('Here you go.');
    driver.send('hello');
    await settle();
    expect(systemOf(h.nativeBodies[0]!)).not.toContain('VAULT PACK');
    driver.dispose();
  });

  it('is budgeted for the seat Jev routes to, not the anchor', async () => {
    h.jev = {
      steer: async () => ({ classify: { category: 'writing', line: 'Writing work.' } }),
    };
    const { pack, seats } = fakePack();
    const { driver, events } = chat(
      {
        reasoning: gpt,
        active: [{ ref: boxSmall, placement: { category: 'writing' } }],
        saved: {},
      },
      { harnessCurrents: { jev: { baseUrl: 'https://jev.test' } } },
      { vaultPack: pack, packSeat: seatOf },
    );
    h.nativeReplies.push(ONE_STEP, 'A short note.');
    driver.send('hello there');
    await settle();
    expect(events.some((e) => e.type === 'harness-current')).toBe(true);
    // The framing call carries the anchor's own pack (it may be the answer);
    // the answer is budgeted for the seat Jev routed to.
    expect(seats).toEqual([
      { modelClass: 'large', servedTokens: 128000, leavesNetwork: true },
      { modelClass: 'small', servedTokens: 8192, leavesNetwork: false },
    ]);
    expect(systemOf(h.nativeBodies[1]!)).toContain('VAULT PACK small 8192');
    driver.dispose();
  });

  it('renders again for the anchor when the routed specialist cannot run', async () => {
    const { pack, seats } = fakePack();
    const { driver } = chat(
      {
        reasoning: device,
        active: [{ ref: boxMid, placement: { category: 'coding' } }],
        saved: {},
      },
      {},
      { vaultPack: pack, packSeat: seatOf },
    );
    await tick();
    h.nativeReplies.push({ status: 503 });
    driver.send('please debug this typescript function');
    await settle();
    expect(seats.map((s) => s.modelClass)).toEqual(['mid', 'tiny']);
    expect(h.generateCalls[0]!.system).toContain('VAULT PACK tiny 4096');
    finishDevice(0, 'Fixed.');
    await settle();
    driver.dispose();
  });

  it('never reaches an Agentic Current bench seat', async () => {
    const { pack, seats } = fakePack();
    const hermes = {
      kind: 'byom',
      id: 'current-hermes',
      label: 'Hermes',
      baseUrl: 'https://hermes.example.com/v1',
      model: 'hermes',
    } as const;
    const { driver, events } = chat(
      { reasoning: hermes, active: [], saved: {} },
      {},
      {
        vaultPack: pack,
        packSeat: seatOf,
      },
    );
    h.nativeReplies.push('Hermes here.');
    driver.send('hello');
    await settle();
    expect(seats).toEqual([]);
    expect(events.some((e) => e.type === 'context-pack')).toBe(false);
    for (const b of h.nativeBodies) expect(systemOf(b)).not.toContain('VAULT PACK');
    driver.dispose();
  });

  it('renders each play step for its owner from the one prepare', async () => {
    const { pack, prepares, seats } = fakePack();
    const { driver } = chat(
      {
        reasoning: gpt,
        active: [{ ref: boxMid, placement: { category: 'writing' } }],
        saved: {},
      },
      {},
      { vaultPack: pack, packSeat: seatOf },
    );
    const plan = JSON.stringify({
      clear: true,
      summary: 'Draft and check',
      steps: [
        { id: 'a', title: 'Draft', category: 'writing', brief: 'Write it.' },
        { id: 'b', title: 'Check', category: 'reasoning', brief: 'Check it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, 'draft text', 'no replan', 'checked', 'Final answer.');
    driver.send('write a launch note and check it');
    await settle(30);
    expect(prepares).toHaveLength(1);
    // The framing on the anchor, step a on your box, step b and the
    // synthesis on the anchor.
    expect(seats.map((s) => s.modelClass)).toEqual(['large', 'mid', 'large', 'large']);
    driver.dispose();
  });
});

describe('the prompt order and the cache (J16)', () => {
  it('keeps the stable head byte-identical while the effort and pack move the tail', async () => {
    let n = 0;
    const pack: AppVaultPack = {
      prepare: async () => {},
      render: () => ({ text: `VAULT PACK v${++n}` }),
    };
    const { driver } = chat(
      { reasoning: claude, active: [], saved: {} },
      { promptCache: true },
      {
        vaultPack: pack,
        packSeat: seatOf,
      },
    );
    h.claudeScript.push('one', 'two');
    driver.send('first');
    await settle();
    driver.send('second');
    await settle();
    const answers = [h.claudeParams[0]!, h.claudeParams[1]!];
    const [a, b] = answers.map(
      (p) => p.system as Array<{ text: string; cache_control?: { type: string } }>,
    );
    expect(a![0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(a![1]!.cache_control).toBeUndefined();
    expect(a![0]!.text).toBe(b![0]!.text);
    expect(a![1]!.text).toContain('VAULT PACK v1');
    expect(b![1]!.text).toContain('VAULT PACK v2');
    expect(a![0]!.text).not.toContain('VAULT PACK');
    expect(a![0]!.text).not.toContain('Reasoning effort');
    expect(answers[0]!.cache_control).toEqual({ type: 'ephemeral' });
    driver.dispose();
  });

  it('with caching off sends system as one plain string, the pre-M5 prompt with the pack last', async () => {
    const { pack } = fakePack();
    const context = { projectName: 'Harbor', projectInstructions: 'Use tabs.' };
    const { driver } = chat({ reasoning: claude, active: [], saved: {} }, context, {
      vaultPack: pack,
      packSeat: seatOf,
    });
    h.claudeScript.push('one');
    driver.send('first');
    await settle();
    const params = h.claudeParams[0]!;
    // Caching off is byte-identical to before M5: one string, no marker.
    expect(typeof params.system).toBe('string');
    expect(JSON.stringify(params)).not.toContain('cache_control');
    const system = params.system as string;
    // The joined prompt in the pre-M5 order (base, effort, project, then the
    // standards), with the M5 pack as the one addition, last.
    const base = system.slice(0, system.indexOf('\n\n'));
    expect(base.startsWith('You are OpenShore')).toBe(true);
    expect(system).toBe(
      [
        base,
        effortDirective(),
        'You are working in the project "Harbor".\nUse tabs.',
        uxStandardPrompt(),
        humanizerStandardPrompt(),
        'VAULT PACK large 128000',
      ].join('\n\n'),
    );
    driver.dispose();

    // An OpenAI-compatible seat reads the very same bytes.
    const other = chat({ reasoning: gpt, active: [], saved: {} }, context, {
      vaultPack: fakePack().pack,
      packSeat: seatOf,
    });
    h.nativeReplies.push('one');
    other.driver.send('first');
    await settle();
    expect(systemOf(h.nativeBodies[0]!)).toBe(system);
    other.driver.dispose();
  });
});

describe('a reply after a local-only read (I5 in the app)', () => {
  const privacy = compileVaultPrivacy({
    exclude: ['Hidden/**'],
    localOnly: { paths: ['Private/**'], tags: ['private'] },
  });
  const notes = new Map([
    ['Private/Diary.md', { text: '# Diary\nThe secret is teal.', version: 'v1' }],
  ]);
  const vaultTools = {
    privacy: async () => privacy,
    search: async () => [],
    read: async (p: string) => notes.get(p),
    write: async () => ({ ok: false as const, conflict: 'exists' as const }),
  };

  it('is marked, reaches a later local seat whole, and a leaving seat gets the stub', async () => {
    const { driver, events } = chat(
      {
        reasoning: boxMid,
        active: [{ ref: gpt, placement: { category: 'coding' } }],
        saved: {},
      },
      {},
      { packSeat: seatOf, vaultTools },
    );
    h.nativeReplies.push(
      ONE_STEP,
      {
        tool_calls: [
          {
            id: 'c1',
            function: { name: 'vaultRead', arguments: '{"path":"Private/Diary.md"}' },
          },
        ],
      },
      'The diary says the secret is teal.',
    );
    driver.send('what does my diary say?');
    await settle(20);
    // The local seat was offered the read tools and read the note whole.
    expect(JSON.stringify(h.nativeBodies[1]!.tools)).toContain('vaultRead');
    expect(JSON.stringify(h.nativeBodies[2]!.messages)).toContain('The secret is teal.');
    // The reply's text-final carries the mark to the transcript (I5).
    const finals = events.filter((e) => e.type === 'text-final');
    expect(isLocalOnlyFinal(finals.at(-1)!)).toBe(true);

    h.nativeReplies.push(ONE_STEP, 'Here is the fix.');
    driver.send('please debug this typescript function');
    await settle(20);
    // A reply with no local-only read is not marked.
    expect(isLocalOnlyFinal(events.filter((e) => e.type === 'text-final').at(-1)!)).toBe(false);
    // The planning call ran on your own box: the reply came along whole.
    expect(JSON.stringify(h.nativeBodies[3]!.messages)).toContain(
      'The diary says the secret is teal.',
    );
    // The cloud coding seat got the stub in its place.
    expect((h.nativeBodies[4] as { model?: string }).model).toBe('gpt-big');
    const cloud = JSON.stringify(h.nativeBodies[4]!.messages);
    expect(cloud).not.toContain('the secret is teal');
    expect(cloud).toContain(LOCAL_ONLY_STUB.slice(0, 40));
    driver.dispose();
  });

  it('a play step grounded in a local-only pack note reaches a leaving seat as the stub', async () => {
    const note = 'The secret is teal.';
    const pack: AppVaultPack = {
      prepare: async () => {},
      // The local seat's pack carries the local-only note; a leaving seat's
      // pack withholds it, as buildContextPack does.
      render: (seat) =>
        seat.leavesNetwork
          ? { text: 'VAULT PACK cloud' }
          : { text: `VAULT PACK ${note}`, localOnly: true },
    };
    const { driver, events } = chat(
      {
        reasoning: gpt,
        active: [{ ref: boxMid, placement: { category: 'writing' } }],
        saved: {},
      },
      {},
      { vaultPack: pack, packSeat: seatOf },
    );
    const plan = JSON.stringify({
      clear: true,
      summary: 'Draft and check',
      steps: [
        { id: 'a', title: 'Draft', category: 'writing', brief: 'Write it.' },
        { id: 'b', title: 'Check', category: 'reasoning', brief: 'Check it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, `Draft quoting the note: ${note}`, 'no replan', 'checked', 'Final.');
    driver.send('draft from my diary and check it');
    await settle(30);
    // Step a ran on your own box with the note in its pack.
    expect((h.nativeBodies[1] as { model?: string }).model).toBe('qwen2.5:14b');
    expect(JSON.stringify(h.nativeBodies[1])).toContain(note);
    // The replan, step b and the synthesis all ran on the leaving anchor:
    // each carries the stub for step a's output, never the note or the quote.
    const leaving = h.nativeBodies.slice(2);
    expect(leaving).toHaveLength(3);
    for (const body of leaving) {
      expect((body as { model?: string }).model).toBe('gpt-big');
      const sent = JSON.stringify(body);
      expect(sent).not.toContain('teal');
      expect(sent).not.toContain('Draft quoting');
      expect(sent).toContain(LOCAL_ONLY_STUB.slice(0, 40));
    }
    // The reply is marked, so a later leaving seat gets the stub for it too.
    expect(isLocalOnlyFinal(events.filter((e) => e.type === 'text-final').at(-1)!)).toBe(true);
    driver.dispose();
  });

  // The mirror (sp-plan, egress-claims-2): an anchor that stays read the
  // private note whole, so the goal and the briefs it wrote may quote it.
  // A placed cloud specialist and a cloud image reader then never get the
  // step: the anchor takes each one, and the note says why (D5).
  it('a plan from a local anchor that read a private note keeps every step off the cloud', async () => {
    const note = 'The secret is teal.';
    const pack: AppVaultPack = {
      prepare: async () => {},
      render: (seat) =>
        seat.leavesNetwork
          ? { text: 'VAULT PACK cloud' }
          : { text: `VAULT PACK ${note}`, localOnly: true },
    };
    const { driver, events } = chat(
      {
        reasoning: boxMid,
        active: [
          { ref: gpt, placement: { category: 'writing' } },
          { ref: claude, placement: { category: 'vision' } },
        ],
        saved: {},
      },
      {},
      { vaultPack: pack, packSeat: seatOf },
    );
    const plan = JSON.stringify({
      clear: true,
      summary: `Answer from the diary: ${note}`,
      steps: [
        { id: 'a', title: 'Draft', category: 'writing', brief: `Quote it: ${note}` },
        {
          id: 'b',
          title: 'Look',
          category: 'vision',
          brief: `Check the picture against: ${note}`,
          dependsOn: ['a'],
        },
      ],
    });
    h.nativeReplies.push(plan, 'drafted', 'no replan', 'looked', 'Final.');
    driver.send('draft from my diary and check the picture');
    await settle(30);
    // Every call ran on your own box; neither cloud model was asked anything.
    expect(h.nativeBodies).toHaveLength(5);
    for (const body of h.nativeBodies) {
      expect((body as { model?: string }).model).toBe('qwen2.5:14b');
    }
    expect(h.claudeParams).toHaveLength(0);
    // Each step's note names the model it would have gone to, and why not.
    const notes = events.flatMap((e) => (e.type === 'status' ? [e.message] : []));
    for (const [title, owner] of [
      ['Draft', 'GPT'],
      ['Look', 'Claude'],
    ]) {
      expect(notes).toContain(
        `${title}. This plan draws on a private note, so Box Mid, your Reasoning model, takes it instead of ${owner}.`,
      );
    }
    // The task list names the model that runs each step.
    const todos = events.filter((e) => e.type === 'todos').at(-1);
    expect(todos && 'items' in todos ? todos.items.map((t) => t.owner) : []).toEqual([
      'Box Mid (reasoning)',
      'Box Mid (reasoning)',
    ]);
    // Nothing left this network, so the chat reads local, and the reply is marked.
    const starts = events.filter((e) => e.type === 'turn-start');
    expect(starts.map((e) => (e as { providerKind: string }).providerKind)).toEqual(['local']);
    expect(isLocalOnlyFinal(events.filter((e) => e.type === 'text-final').at(-1)!)).toBe(true);
    driver.dispose();
  });

  it('a plan from a local anchor that read a private turn whole keeps its steps off the cloud', async () => {
    const driver = new StackDriver(
      { reasoning: boxMid, active: [{ ref: gpt, placement: { category: 'writing' } }], saved: {} },
      'offshore',
      {},
      [
        { role: 'user', text: 'diary?' },
        { role: 'assistant', text: 'teal secret', localOnly: true },
      ],
      { packSeat: seatOf },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    const plan = JSON.stringify({
      clear: true,
      summary: 'Write up the teal secret',
      steps: [
        { id: 'a', title: 'Draft', category: 'writing', brief: 'Use the teal secret.' },
        { id: 'b', title: 'Check', category: 'reasoning', brief: 'Check it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, 'drafted', 'no replan', 'checked', 'Final.');
    driver.send('write it up');
    await settle(30);
    // The anchor read the private turn whole when it planned.
    expect(JSON.stringify(h.nativeBodies[0])).toContain('teal secret');
    for (const body of h.nativeBodies) {
      expect((body as { model?: string }).model).toBe('qwen2.5:14b');
    }
    expect(isLocalOnlyFinal(events.filter((e) => e.type === 'text-final').at(-1)!)).toBe(true);
    driver.dispose();
  });

  // Sign-off (D5 off the plan path): a seat here that read a private turn
  // whole may quote it, the framing call's own answer and a single turn
  // alike, so its reply is marked, and a cloud model a later turn routes to
  // reads the stub in its place, never the quote.
  it('a reply from a seat here that read a private turn whole reaches a cloud turn as the stub', async () => {
    const seed = [
      { role: 'user' as const, text: 'diary?' },
      { role: 'assistant' as const, text: 'teal secret', localOnly: true as const },
    ];
    const finals = (events: DriverEvent[]) =>
      events.filter((e) => e.type === 'text-final').map((e) => isLocalOnlyFinal(e));

    // The framing call answers itself, then a later turn goes to GPT.
    const driver = new StackDriver(
      { reasoning: boxMid, active: [{ ref: gpt, placement: { category: 'writing' } }], saved: {} },
      'offshore',
      {},
      seed,
      { packSeat: seatOf },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    h.nativeReplies.push('It was the teal one.');
    driver.send('which was it again?');
    await settle(30);
    expect(finals(events)).toEqual([true]);
    h.nativeReplies.push(ONE_STEP, 'Dear landlord.');
    driver.send('draft an email about it');
    await settle(30);
    const toGpt = h.nativeBodies.filter((b) => (b as { model?: string }).model === 'gpt-big');
    expect(toGpt).toHaveLength(1);
    expect(JSON.stringify(toGpt[0])).not.toMatch(/teal/);
    expect(JSON.stringify(toGpt[0])).toContain(LOCAL_ONLY_STUB);
    driver.dispose();

    // One seat and no one to hand to: the single turn's reply is marked too.
    const alone = new StackDriver(
      { reasoning: boxMid, active: [], saved: {} },
      'offshore',
      {},
      seed,
      { packSeat: seatOf },
    );
    const aloneEvents: DriverEvent[] = [];
    alone.subscribe((e) => aloneEvents.push(e));
    h.nativeReplies.push('It was the teal one.');
    alone.send('which was it again?');
    await settle(30);
    expect(finals(aloneEvents)).toEqual([true]);
    alone.dispose();

    // A line handed over after the seed keeps its mark, so GPT reads the stub.
    const handed = chat({ reasoning: gpt, active: [], saved: {} }, {}, { packSeat: seatOf });
    handed.driver.recordLine({ role: 'assistant', text: 'teal secret', localOnly: true });
    h.nativeReplies.push('Noted.');
    handed.driver.send('and then?');
    await settle(30);
    const last = JSON.stringify(h.nativeBodies.at(-1));
    expect(last).not.toMatch(/teal/);
    expect(last).toContain(LOCAL_ONLY_STUB);
    handed.driver.dispose();
  });

  // Sign-off: the plan is kept here only when its Reasoning model read the
  // private turn. One older than the chat it reads (the newest 6,000
  // characters) never reached it, so the plan runs as placed and says
  // nothing about a private note.
  it('a plan whose Reasoning model never read the private turn runs as placed', async () => {
    const driver = new StackDriver(
      { reasoning: boxMid, active: [{ ref: gpt, placement: { category: 'writing' } }], saved: {} },
      'offshore',
      {},
      [
        { role: 'user', text: 'diary?' },
        { role: 'assistant', text: 'teal secret', localOnly: true },
        { role: 'user', text: 'x'.repeat(7000) },
        { role: 'assistant', text: 'noted' },
      ],
      { packSeat: seatOf },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    const plan = JSON.stringify({
      clear: true,
      summary: 'Write it up',
      steps: [
        { id: 'a', title: 'Draft', category: 'writing', brief: 'Write it.' },
        { id: 'b', title: 'Check', category: 'reasoning', brief: 'Check it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, 'drafted', 'no replan', 'checked', 'Final.');
    driver.send('write it up');
    await settle(30);
    expect(JSON.stringify(h.nativeBodies[0])).not.toContain('teal secret');
    expect((h.nativeBodies[1] as { model?: string }).model).toBe('gpt-big');
    const notes = events.flatMap((e) => (e.type === 'status' ? [e.message] : []));
    expect(notes.some((n) => n.includes('private note'))).toBe(false);
    expect(isLocalOnlyFinal(events.filter((e) => e.type === 'text-final').at(-1)!)).toBe(false);
    driver.dispose();
  });

  it('a replan by a local anchor that read a private step keeps the rest off the cloud', async () => {
    const note = 'The secret is teal.';
    // Only the small box's pack carries the note; the anchor's carries none.
    const pack: AppVaultPack = {
      prepare: async () => {},
      render: (seat) =>
        seat.servedTokens === 8192
          ? { text: `VAULT PACK ${note}`, localOnly: true }
          : { text: 'VAULT PACK plain' },
    };
    const { driver, events } = chat(
      {
        reasoning: boxMid,
        active: [
          { ref: boxSmall, placement: { category: 'writing' } },
          { ref: gpt, placement: { category: 'coding' } },
        ],
        saved: {},
      },
      {},
      { vaultPack: pack, packSeat: seatOf },
    );
    const plan = JSON.stringify({
      clear: true,
      summary: 'Draft and build',
      steps: [
        { id: 'a', title: 'Draft', category: 'writing', brief: 'Write it.' },
        { id: 'b', title: 'Build', category: 'coding', brief: 'Build it.', dependsOn: ['a'] },
      ],
    });
    const revised = JSON.stringify([
      { id: 'b', title: 'Build', category: 'coding', brief: `Build it from: ${note}` },
    ]);
    h.nativeReplies.push(plan, `Draft quoting: ${note}`, revised, 'built', 'Final.');
    driver.send('draft from my diary and build it');
    await settle(30);
    const models = h.nativeBodies.map((b) => (b as { model?: string }).model);
    // Plan, the small box's draft, the replan, then the build on the anchor.
    expect(models).toEqual([
      'qwen2.5:14b',
      'qwen2.5:7b',
      'qwen2.5:14b',
      'qwen2.5:14b',
      'qwen2.5:14b',
    ]);
    expect(JSON.stringify(h.nativeBodies[3])).toContain(`Build it from: ${note}`);
    const notes = events.flatMap((e) => (e.type === 'status' ? [e.message] : []));
    expect(notes).toContain(
      'Build. This plan draws on a private note, so Box Mid, your Reasoning model, takes it instead of GPT.',
    );
    driver.dispose();
  });

  // J (CX and CMO, 2026-10-08): with no word from the computer on what its
  // agent runs (here, no answer to GET /stack), a private plan's file step is
  // described here; test/stackPrivatePlan.test.ts holds the marked run.
  it('a private plan describes a step that edits files when the computer cannot say', async () => {
    h.engineEvents.length = 0;
    h.enginePrompts.length = 0;
    const note = 'The secret is teal.';
    const pack: AppVaultPack = {
      prepare: async () => {},
      render: (seat) =>
        seat.leavesNetwork
          ? { text: 'VAULT PACK cloud' }
          : { text: `VAULT PACK ${note}`, localOnly: true },
    };
    const driver = new StackDriver(
      { reasoning: boxMid, active: [], saved: {} },
      'docked',
      { daemon: { baseUrl: 'http://127.0.0.1:7777', token: 't' }, repoCwd: '/work/repo' },
      undefined,
      { vaultPack: pack, packSeat: seatOf },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    const plan = JSON.stringify({
      clear: true,
      summary: `Edit per the diary: ${note}`,
      steps: [
        { id: 'a', title: 'Edit', category: 'coding', brief: note, needsTools: true },
        { id: 'b', title: 'Check', category: 'reasoning', brief: 'Check it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, 'the diff', 'no replan', 'checked', 'Final.');
    driver.send('edit the file from my diary and check it');
    await settle(40);
    expect(h.enginePrompts).toHaveLength(0);
    const notes = events.flatMap((e) => (e.type === 'status' ? [e.message] : []));
    expect(notes).toContain(
      'Edit. This plan draws on a private note, so Box Mid describes the change here instead of running it on your computer, whose agent may use a cloud model.',
    );
    for (const body of h.nativeBodies) {
      expect((body as { model?: string }).model).toBe('qwen2.5:14b');
    }
    driver.dispose();
  });

  it('a play that hands a step to a cloud model marks the chat cloud', async () => {
    const { driver, events } = chat(
      { reasoning: boxMid, active: [{ ref: gpt, placement: { category: 'writing' } }], saved: {} },
      {},
      { packSeat: seatOf },
    );
    const plan = JSON.stringify({
      clear: true,
      summary: 'Draft and check',
      steps: [
        { id: 'a', title: 'Check', category: 'reasoning', brief: 'Check it.' },
        { id: 'b', title: 'Draft', category: 'writing', brief: 'Write it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, 'checked', 'no replan', 'drafted', 'Final.');
    driver.send('check and draft it');
    await settle(30);
    expect((h.nativeBodies[3] as { model?: string }).model).toBe('gpt-big');
    // Local while only your box ran, then cloud from the step that left.
    const starts = events.filter((e) => e.type === 'turn-start');
    expect(starts.map((e) => (e as { providerKind: string }).providerKind)).toEqual([
      'local',
      'cloud',
    ]);
    expect(starts.every((e) => (e as { model: string }).model === 'Box Mid')).toBe(true);
    driver.dispose();
  });

  // Sign-off (sp-plan, M1): the framing call on a Reasoning model that leaves
  // carries the message, so the send reads cloud on every route: the
  // questions it asks back, and a model on this phone that answers after it.
  it('a send framed by a cloud model marks the chat cloud, whoever answers it', async () => {
    const asks = chat(
      {
        reasoning: gpt,
        active: [{ ref: boxSmall, placement: { category: 'writing' } }],
        saved: {},
      },
      {},
      { packSeat: seatOf },
    );
    h.nativeReplies.push(
      JSON.stringify({
        clear: false,
        summary: 'Which draft?',
        questions: [{ id: 'q1', question: 'Which one?', options: ['A', 'B'] }],
      }),
    );
    asks.driver.send('draft it');
    await settle(20);
    expect(asks.events.some((e) => e.type === 'clarify')).toBe(true);
    const kinds = (events: DriverEvent[]) =>
      events.flatMap((e) => (e.type === 'turn-start' ? [e.providerKind] : []));
    expect(kinds(asks.events)).toEqual(['cloud']);
    asks.driver.dispose();

    const here = chat(
      {
        reasoning: gpt,
        active: [
          { ref: boxSmall, placement: { category: 'coding' } },
          { ref: device, placement: { category: 'writing' } },
        ],
        saved: {},
      },
      {},
      { packSeat: seatOf },
    );
    h.nativeReplies.push(ONE_STEP);
    here.driver.send('draft an email to my landlord');
    await settle(20);
    expect(h.generateCalls).toHaveLength(1);
    finishDevice(0, 'Dear landlord.');
    await settle(20);
    // GPT framed it and the phone's model answered: the send went to a cloud
    // model, so the chat reads cloud, never local.
    expect(kinds(here.events)).toEqual(['cloud', 'cloud']);
    expect(here.events.filter((e) => e.type === 'turn-start').at(-1)).toMatchObject({
      model: 'Pocket',
    });
    here.driver.dispose();
  });

  it('an engine step that read a local-only note reaches a leaving seat as the stub', async () => {
    const note = 'The secret is teal.';
    h.engineEvents.length = 0;
    h.enginePrompts.length = 0;
    h.engineEvents.push(
      {
        type: 'tool-end',
        call: { id: 't1', name: 'vaultRead', args: { path: 'Private/diary.md' } },
        result: { content: note, localOnly: true },
        durationMs: 1,
      },
      { type: 'text-final', text: `Edited, quoting the note: ${note}` },
      { type: 'task-done', reason: 'complete' },
    );
    const driver = new StackDriver(
      { reasoning: gpt, active: [], saved: {} },
      'docked',
      { daemon: { baseUrl: 'http://127.0.0.1:7777', token: 't' }, repoCwd: '/work/repo' },
      undefined,
      { packSeat: seatOf },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    const plan = JSON.stringify({
      clear: true,
      summary: 'Edit and check',
      steps: [
        { id: 'a', title: 'Edit', category: 'coding', brief: 'Edit it.', needsTools: true },
        { id: 'b', title: 'Check', category: 'reasoning', brief: 'Check it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, 'no replan', 'checked', 'Final.');
    driver.send('edit the file from my diary and check it');
    await settle(40);
    // Step a ran on the engine, whose tool read the local-only note.
    expect(h.enginePrompts).toHaveLength(1);
    // Everything after it ran on the leaving anchor and got the stub.
    const leaving = h.nativeBodies.slice(1);
    expect(leaving.length).toBeGreaterThanOrEqual(2);
    for (const body of leaving) {
      const sent = JSON.stringify(body);
      expect(sent).not.toContain('teal');
      expect(sent).not.toContain('quoting the note');
      expect(sent).toContain(LOCAL_ONLY_STUB.slice(0, 40));
    }
    expect(isLocalOnlyFinal(events.filter((e) => e.type === 'text-final').at(-1)!)).toBe(true);
    driver.dispose();
  });

  it('an engine session reply after a local-only tool read is marked, until the next task', () => {
    const marker = new PackLocalOnlyMarker();
    const final = { type: 'text-final', text: 'quoting it' } as DriverEvent;
    marker.mark({ type: 'task-start', input: 'q' } as DriverEvent);
    expect(isLocalOnlyFinal(marker.mark(final))).toBe(false);
    marker.mark({
      type: 'tool-end',
      call: { id: 't', name: 'vaultRead', args: {} },
      result: { content: 'x', localOnly: true },
      durationMs: 1,
    } as DriverEvent);
    expect(isLocalOnlyFinal(marker.mark(final))).toBe(true);
    marker.mark({ type: 'task-start', input: 'next' } as DriverEvent);
    expect(isLocalOnlyFinal(marker.mark(final))).toBe(false);
  });

  it('historyForSeat swaps only marked entries, and only for a leaving seat', () => {
    const history = [
      { role: 'user' as const, content: 'q' },
      { role: 'assistant' as const, content: 'secret', localOnly: true as const },
    ];
    expect(historyForSeat(history, false)[1]!.content).toBe('secret');
    expect(historyForSeat(history, true)[1]!.content).toBe(LOCAL_ONLY_STUB);
    expect(historyForSeat(history, true)[0]!.content).toBe('q');
    expect(history[1]!.content).toBe('secret');
  });

  it('a seeded local-only turn is stubbed for a leaving seat', async () => {
    const driver = new StackDriver(
      { reasoning: gpt, active: [], saved: {} },
      'offshore',
      {},
      [
        { role: 'user', text: 'diary?' },
        { role: 'assistant', text: 'teal secret', localOnly: true },
      ],
      { packSeat: seatOf },
    );
    driver.subscribe(() => {});
    h.nativeReplies.push('ok');
    driver.send('and now?');
    await settle();
    expect(h.nativeBodies).toHaveLength(1);
    expect(JSON.stringify(h.nativeBodies[0]!.messages)).not.toContain('teal secret');
    driver.dispose();
  });
});

// The sticky reply mark stays, and the person is told once where the context
// is lost (CX and CMO, 2026-10-08, F): one status line per chat for each
// model that leaves this network, on the first turn it is sent the
// placeholder for a reply a local model wrote after a private read.
describe('the placeholder line (F)', () => {
  const marked = [
    { role: 'user' as const, text: 'what does my diary say?' },
    {
      role: 'assistant' as const,
      text: 'The diary says the secret is teal.',
      localOnly: true as const,
    },
  ];
  const line = (model: string) =>
    `This chat drew on a private note, so ${model} sees your local models' replies since then only as a placeholder.`;
  const lines = (events: DriverEvent[]) =>
    events.flatMap((e) =>
      e.type === 'status' && e.message.startsWith('This chat drew on a private note')
        ? [e.message]
        : [],
    );

  it('shows once for a cloud model sent the placeholder, and not again on the next turn', async () => {
    const driver = new StackDriver(
      { reasoning: gpt, active: [], saved: {} },
      'offshore',
      {},
      marked,
      {
        packSeat: seatOf,
      },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    h.nativeReplies.push('ok');
    driver.send('and now?');
    await settle();
    expect(JSON.stringify(h.nativeBodies[0]!.messages)).toContain(LOCAL_ONLY_STUB.slice(0, 40));
    expect(lines(events)).toEqual([line('GPT')]);
    // Said before the request that carried the placeholder: ahead of the
    // reply, after the turn's start.
    const at = (pred: (e: DriverEvent) => boolean) => events.findIndex(pred);
    expect(at((e) => e.type === 'turn-start')).toBeLessThan(
      at((e) => e.type === 'status' && e.message === line('GPT')),
    );
    expect(at((e) => e.type === 'status' && e.message === line('GPT'))).toBeLessThan(
      at((e) => e.type === 'text-final'),
    );
    h.nativeReplies.push('still ok');
    driver.send('and after that?');
    await settle();
    expect(lines(events)).toEqual([line('GPT')]);
    driver.dispose();
  });

  it('shows again for a second cloud model in the same chat', async () => {
    const driver = new StackDriver(
      { reasoning: gpt, active: [{ ref: claude, placement: { category: 'coding' } }], saved: {} },
      'offshore',
      {},
      marked,
      { packSeat: seatOf },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    // GPT frames the request (its digest carries the placeholder), then the
    // coding question goes to Claude on the single-turn path.
    h.nativeReplies.push(ONE_STEP);
    h.claudeScript.push('Fixed.');
    driver.send('please debug this typescript function');
    await settle(20);
    expect(lines(events)).toEqual([line('GPT'), line('Claude')]);
    h.nativeReplies.push(ONE_STEP);
    h.claudeScript.push('Fixed again.');
    driver.send('please debug this other typescript function');
    await settle(20);
    expect(lines(events)).toEqual([line('GPT'), line('Claude')]);
    driver.dispose();
  });

  it('never shows on a seat that stays on this network', async () => {
    const driver = new StackDriver(
      { reasoning: boxMid, active: [], saved: {} },
      'offshore',
      {},
      marked,
      {
        packSeat: seatOf,
      },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    h.nativeReplies.push('ok');
    driver.send('and now?');
    await settle();
    expect(JSON.stringify(h.nativeBodies[0]!.messages)).toContain('the secret is teal');
    expect(lines(events)).toEqual([]);
    driver.dispose();
  });

  it('never shows in a clean chat', async () => {
    const clean = marked.map(({ role, text }) => ({ role, text }));
    const driver = new StackDriver(
      { reasoning: gpt, active: [], saved: {} },
      'offshore',
      {},
      clean,
      {
        packSeat: seatOf,
      },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    h.nativeReplies.push('ok');
    driver.send('and now?');
    await settle();
    expect(lines(events)).toEqual([]);
    driver.dispose();
  });

  it('a cloud chat seeded with a marked reply says it once, for its own model', async () => {
    const { CloudOpenAiDriver } = await import('../src/drivers/cloudOpenAiDriver.js');
    const { CloudClaudeDriver } = await import('../src/drivers/cloudClaudeDriver.js');
    const oai = new CloudOpenAiDriver('https://api.openai.com/v1', 'sk', 'gpt-5', 'OpenAI', marked);
    const oEvents: DriverEvent[] = [];
    oai.subscribe((e) => oEvents.push(e));
    h.nativeReplies.push('ok');
    oai.send('and now?');
    await settle();
    h.nativeReplies.push('ok');
    oai.send('and then?');
    await settle();
    expect(lines(oEvents)).toEqual([line('gpt-5')]);
    oai.dispose();

    const cl = new CloudClaudeDriver('k', 'claude-opus-5', marked, undefined, undefined, {
      modelLabel: 'Claude Opus 5',
    });
    const cEvents: DriverEvent[] = [];
    cl.subscribe((e) => cEvents.push(e));
    cl.send('and now?');
    await settle();
    expect(lines(cEvents)).toEqual([line('Claude Opus 5')]);
    cl.dispose();

    // A clean seed, or a marked line only recorded later, as the chat goes.
    const later = new CloudOpenAiDriver('https://api.openai.com/v1', 'sk', 'gpt-5', 'OpenAI', [
      { role: 'user', text: 'hello' },
    ]);
    const lEvents: DriverEvent[] = [];
    later.subscribe((e) => lEvents.push(e));
    h.nativeReplies.push('ok');
    later.send('first');
    await settle();
    expect(lines(lEvents)).toEqual([]);
    later.recordLine({ role: 'assistant', text: 'teal', localOnly: true });
    h.nativeReplies.push('ok');
    later.send('second');
    await settle();
    expect(lines(lEvents)).toEqual([line('gpt-5')]);
    later.dispose();
  });

  it("shows for a cloud model sent the placeholder for a local model's step in a plan", async () => {
    // A clean chat: the private note reaches only your own box's step, whose
    // output is then the placeholder for every model off this network.
    const note = 'The secret is teal.';
    const pack: AppVaultPack = {
      prepare: async () => {},
      render: (seat) =>
        seat.leavesNetwork
          ? { text: 'VAULT PACK cloud' }
          : { text: `VAULT PACK ${note}`, localOnly: true },
    };
    const { driver, events } = chat(
      {
        reasoning: gpt,
        active: [
          { ref: boxMid, placement: { category: 'analysis' } },
          { ref: claude, placement: { category: 'writing' } },
        ],
        saved: {},
      },
      {},
      { vaultPack: pack, packSeat: seatOf },
    );
    const plan = JSON.stringify({
      clear: true,
      summary: 'Sum it up, then write it',
      steps: [
        { id: 'a', title: 'Sum', category: 'analysis', brief: 'Add it up.' },
        { id: 'b', title: 'Write', category: 'writing', brief: 'Write it.', dependsOn: ['a'] },
      ],
    });
    h.nativeReplies.push(plan, 'summed', 'no replan', 'Final.');
    h.claudeScript.push('written');
    driver.send('sum my diary up and write it out');
    await settle(40);
    // The box's step read the note; neither cloud model got its output.
    expect(JSON.stringify(h.claudeParams)).not.toContain('summed');
    expect(JSON.stringify(h.claudeParams)).toContain(LOCAL_ONLY_STUB.slice(0, 40));
    // GPT is sent the placeholder first (its replan), then Claude (its
    // step); each hears it once, and the synthesis on GPT says nothing new.
    expect(lines(events)).toEqual([line('GPT'), line('Claude')]);
    driver.dispose();
  });
});
