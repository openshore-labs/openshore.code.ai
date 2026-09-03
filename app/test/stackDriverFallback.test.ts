// COR-12: when a routed specialist cannot run this turn (here: a cloud coding
// specialist with no API key), the stack must degrade to the Reasoning anchor
// for that turn and say so, rather than dead-ending with an error, matching the
// desktop router's graceful-degradation contract. Also covers R-18: two device
// requests get distinct ids. Llama and secrets are mocked so the reasoning
// anchor (a device model) can complete under test.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const llama = vi.hoisted(() => ({
  tokenCb: null as null | ((e: { requestId: string; delta: string }) => void),
  doneCb: null as null | ((e: { requestId: string; stopReason: string; detail?: string }) => void),
  requestIds: [] as string[],
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (e: never) => void) => {
      if (event === 'token') llama.tokenCb = cb as typeof llama.tokenCb;
      if (event === 'generationDone') llama.doneCb = cb as typeof llama.doneCb;
      return { remove: async () => {} };
    },
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async ({ requestId }: { requestId: string }) => {
      llama.requestIds.push(requestId);
    },
    stop: async () => {},
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  secretGet: async () => null, // no cloud key stored: the specialist cannot run
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
import type { AppStack } from '../src/lib/stack.js';
import type { DriverEvent } from 'os-code/protocol';

const tick = () => new Promise((r) => setTimeout(r, 0));

const stack: AppStack = {
  reasoning: { kind: 'device', modelId: 'reason-model', modelName: 'Reasoner' },
  active: [
    {
      ref: { kind: 'cloud', provider: 'openai', model: 'gpt', label: 'GPT Coder' },
      placement: { category: 'coding' },
    },
  ],
  saved: {},
};

describe('stack routing degradation (COR-12)', () => {
  beforeEach(() => {
    llama.tokenCb = null;
    llama.doneCb = null;
    llama.requestIds.length = 0;
  });

  it('falls back to the reasoning anchor when the specialist has no key', async () => {
    const driver = new StackDriver(stack, 'docked', {});
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    await tick(); // listenersReady

    driver.send('please debug this typescript function');
    // Wait for the routing + failed specialist + fallback to reach runDevice.
    for (let i = 0; i < 20 && llama.requestIds.length === 0; i++) await tick();
    expect(llama.requestIds.length).toBe(1);

    // The reasoning anchor now streams and completes the turn.
    const reqId = llama.requestIds[0]!;
    llama.tokenCb!({ requestId: reqId, delta: 'here is the fix' });
    llama.doneCb!({ requestId: reqId, stopReason: 'complete' });
    await tick();

    const statuses = events.filter((e) => e.type === 'status') as Array<{ message: string }>;
    expect(statuses.some((s) => s.message.includes('Falling back'))).toBe(true);
    expect(events.some((e) => e.type === 'text-delta' && e.text === 'here is the fix')).toBe(true);
    const done = events.find((e) => e.type === 'task-done') as { reason: string } | undefined;
    expect(done?.reason).toBe('complete');
    // No error was surfaced despite the specialist being unusable.
    expect(events.some((e) => e.type === 'task-done' && e.reason === 'error')).toBe(false);
    driver.dispose();
  });

  it('gives distinct request ids to successive device turns (R-18)', async () => {
    const deviceStack: AppStack = {
      reasoning: { kind: 'device', modelId: 'reason-model', modelName: 'Reasoner' },
      active: [],
      saved: {},
    };
    const driver = new StackDriver(deviceStack, 'docked', {});
    driver.subscribe(() => {});
    await tick();

    driver.send('first');
    for (let i = 0; i < 20 && llama.requestIds.length === 0; i++) await tick();
    llama.doneCb!({ requestId: llama.requestIds[0]!, stopReason: 'complete' });
    await tick();
    driver.send('second');
    for (let i = 0; i < 20 && llama.requestIds.length < 2; i++) await tick();

    expect(llama.requestIds.length).toBe(2);
    expect(llama.requestIds[0]).not.toBe(llama.requestIds[1]);
    driver.dispose();
  });
});
