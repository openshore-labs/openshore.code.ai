// A private plan's file-editing step (CX and CMO, 2026-10-08, J). The step
// runs on the paired computer when that computer, asked fresh (GET /stack),
// says its Reasoning model stays on its network and it takes a local-only
// turn: the step goes marked (POST /input `localOnly`), so the engine's own
// D5 rules hold for it, and its reply comes back marked. A computer whose
// Reasoning model is a cloud model gets the step described here, with a note
// saying so; an older daemon, or one that does not answer, keeps today's
// note.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonStackInfo, DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  nativeReplies: [] as string[],
  nativeBodies: [] as Array<{
    model?: string;
    messages: Array<{ role: string; content: unknown }>;
  }>,
  // The paired computer's engine session: what each send carried, and the
  // events it answers with.
  engineSends: [] as Array<{ prompt: string; opts?: { localOnly?: true } }>,
  engineEvents: [] as unknown[],
  // GET /stack's answer; undefined is no answer.
  engineStack: undefined as DaemonStackInfo | undefined,
  stackAsks: 0,
}));

vi.mock('../src/drivers/remoteDriver.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeRemoteDriver {
    private sinks: Array<(e: unknown, seq: number) => void> = [];
    subscribe(sink: (e: unknown, seq: number) => void) {
      this.sinks.push(sink);
      return () => undefined;
    }
    send(prompt: string, _attachments?: unknown, opts?: { localOnly?: true }) {
      h.engineSends.push({ prompt, ...(opts && Object.keys(opts).length ? { opts } : {}) });
      setTimeout(() => {
        for (const e of h.engineEvents) for (const s of this.sinks) s(e, 0);
      }, 0);
    }
    abort() {}
    answerApproval() {}
    dispose() {}
  }
  return {
    ...actual,
    RemoteDriver: FakeRemoteDriver,
    daemonCreateSession: async () => 'engine-session',
    daemonStack: async () => {
      h.stackAsks++;
      if (!h.engineStack) throw new Error('Your computer did not answer.');
      return h.engineStack;
    },
  };
});

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  secretGet: async () => null,
  storeGetJson: async () => null,
}));

vi.mock('../src/lib/streamingFetch.js', () => ({
  streamingFetch: async () => {
    throw new TypeError('Load failed');
  },
}));

vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: async (_url: string, init: { body: string }) => {
    h.nativeBodies.push(JSON.parse(init.body));
    const content = h.nativeReplies.shift() ?? '';
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  },
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { isLocalOnlyFinal } = await import('../src/drivers/types.js');
import type { AppVaultPack, PackSeat } from '../src/drivers/types.js';
import type { StackModelRef } from '../src/lib/stack.js';

const NOTE = 'The secret is teal.';
const boxMid: StackModelRef = {
  kind: 'byom',
  id: 'box-mid',
  label: 'Box Mid',
  baseUrl: 'http://192.168.1.20:11434/v1',
  model: 'qwen2.5:14b',
};
const seatOf = (ref: StackModelRef): PackSeat => ({
  modelClass: 'mid',
  servedTokens: 32000,
  leavesNetwork: ref.kind === 'cloud',
});
/** The vault pack: a seat that stays here gets the private note. */
const pack: AppVaultPack = {
  prepare: async () => {},
  render: (seat) =>
    seat.leavesNetwork
      ? { text: 'VAULT PACK cloud' }
      : { text: `VAULT PACK ${NOTE}`, localOnly: true },
};
const PLAN = JSON.stringify({
  clear: true,
  summary: `Edit per the diary: ${NOTE}`,
  steps: [
    { id: 'a', title: 'Edit', category: 'coding', brief: NOTE, needsTools: true },
    { id: 'b', title: 'Check', category: 'reasoning', brief: 'Check it.', dependsOn: ['a'] },
  ],
});
const DESCRIBED =
  'Edit. This plan draws on a private note, so Box Mid describes the change here instead of running it on your computer, whose agent may use a cloud model.';
const CLOUD_NOTE =
  "Edit. This plan draws on a private note, and your computer's agent can hand work to a cloud model, so Box Mid describes the change here instead.";

const settle = async (n = 40) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function run(): { driver: InstanceType<typeof StackDriver>; events: DriverEvent[] } {
  const driver = new StackDriver(
    { reasoning: boxMid, active: [], saved: {} },
    'docked',
    { daemon: { baseUrl: 'http://127.0.0.1:7777', token: 't' }, repoCwd: '/work/repo' },
    undefined,
    { vaultPack: pack, packSeat: seatOf },
  );
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const statuses = (events: DriverEvent[]) =>
  events.flatMap((e) => (e.type === 'status' ? [e.message] : []));

function stack(over: Partial<DaemonStackInfo>): DaemonStackInfo {
  return {
    description: 'Box',
    orchestrator: { model: 'qwen3-coder:30b', provider: 'ollama', kind: 'local' },
    specialists: [],
    ...over,
  } as DaemonStackInfo;
}

beforeEach(() => {
  h.nativeReplies.length = 0;
  h.nativeBodies.length = 0;
  h.engineSends.length = 0;
  h.engineStack = undefined;
  h.stackAsks = 0;
  h.engineEvents = [
    { type: 'tool-start', call: { id: 'e1', name: 'editFile', args: { path: 'src/a.ts' } } },
    {
      type: 'tool-end',
      call: { id: 'e1', name: 'editFile', args: { path: 'src/a.ts' } },
      result: { ok: true, content: 'Edited src/a.ts (+1 -1)' },
      durationMs: 5,
    },
    { type: 'text-final', text: 'Edited src/a.ts.', localOnly: true },
    { type: 'task-done', reason: 'complete' },
  ];
});

describe("a private plan's file-editing step", () => {
  it('runs marked on a computer whose Reasoning model stays there, and comes back marked', async () => {
    h.engineStack = stack({ acceptsLocalOnly: true });
    h.nativeReplies.push(PLAN, 'no replan', 'checked', 'Final.');
    const { driver, events } = run();
    driver.send('edit the file from my diary and check it');
    await settle();
    // The computer was asked fresh, once for the one step that edits files.
    expect(h.stackAsks).toBe(1);
    expect(h.engineSends).toHaveLength(1);
    expect(h.engineSends[0]!.opts).toEqual({ localOnly: true });
    // Marked, the step reads the plan whole: the engine holds it to D5.
    expect(h.engineSends[0]!.prompt).toContain('Your step: Edit.');
    expect(h.engineSends[0]!.prompt).toContain(NOTE);
    expect(statuses(events)).toContain('Running "Edit" on your computer.');
    expect(statuses(events)).not.toContain(DESCRIBED);
    // The engine's tool card reached the chat.
    expect(events.some((e) => e.type === 'tool-start')).toBe(true);
    // Nothing went to a model off this network: the send stays local.
    const reach = events.flatMap((e) => (e.type === 'turn-start' ? [e.providerKind] : []));
    expect(reach.every((k) => k === 'local')).toBe(true);
    // The answer, written from the marked step, is marked too.
    const final = events.findLast((e) => e.type === 'text-final')!;
    expect(isLocalOnlyFinal(final)).toBe(true);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('is described here, with the note, when the computer runs a cloud model', async () => {
    h.engineStack = stack({
      orchestrator: { model: 'claude-sonnet-5', provider: 'anthropic', kind: 'cloud' },
      acceptsLocalOnly: true,
    });
    h.nativeReplies.push(PLAN, 'the diff', 'no replan', 'checked', 'Final.');
    const { driver, events } = run();
    driver.send('edit the file from my diary and check it');
    await settle();
    expect(h.engineSends).toHaveLength(0);
    expect(statuses(events)).toContain(CLOUD_NOTE);
    expect(statuses(events)).not.toContain(DESCRIBED);
    for (const body of h.nativeBodies) expect(body.model).toBe('qwen2.5:14b');
    driver.dispose();
  });

  it("keeps today's note for a daemon that does not take a local-only turn", async () => {
    h.engineStack = stack({});
    h.nativeReplies.push(PLAN, 'the diff', 'no replan', 'checked', 'Final.');
    const { driver, events } = run();
    driver.send('edit the file from my diary and check it');
    await settle();
    expect(h.engineSends).toHaveLength(0);
    expect(statuses(events)).toContain(DESCRIBED);
    driver.dispose();
  });

  it("keeps today's note when the computer does not answer", async () => {
    h.nativeReplies.push(PLAN, 'the diff', 'no replan', 'checked', 'Final.');
    const { driver, events } = run();
    driver.send('edit the file from my diary and check it');
    await settle();
    expect(h.stackAsks).toBe(1);
    expect(h.engineSends).toHaveLength(0);
    expect(statuses(events)).toContain(DESCRIBED);
    driver.dispose();
  });
});
