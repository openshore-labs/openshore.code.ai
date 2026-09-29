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
