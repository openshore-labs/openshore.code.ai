// G3: the on-device driver must remove its two Llama listeners on dispose, or
// every opened device chat leaks them (retaining the driver and its history).
// APP-3: the phone has one llama slot, so every device driver must confirm its
// model is the one loaded before each generate, never assume it still is.
// UI-1: a reply that never produces a token (the native runner lost it, say to
// a load from another chat) ends the task from the JS side, so the chat cannot
// spin forever.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listeners, removed, calls, handlers } = vi.hoisted(() => ({
  listeners: [] as string[],
  removed: [] as string[],
  calls: [] as string[],
  handlers: new Map<string, (data: unknown) => void>(),
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (data: unknown) => void) => {
      listeners.push(event);
      handlers.set(event, cb);
      return {
        remove: async () => {
          removed.push(event);
        },
      };
    },
    stop: async () => {
      calls.push('stop');
    },
    ensureLocal: async () => ({ ready: true }),
    load: async ({ id }: { id: string }) => {
      calls.push(`load:${id}`);
      return { ok: true };
    },
    generate: async ({ requestId }: { requestId: string }) => {
      calls.push(`generate:${requestId}`);
      return { started: true };
    },
  },
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { forgetDeviceModel, STALL_TIMEOUT_MS } = await import('../src/drivers/deviceModel.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('OnDeviceDriver listener lifecycle (G3)', () => {
  it('adds two listeners and removes both on dispose', async () => {
    listeners.length = 0;
    removed.length = 0;
    const driver = new OnDeviceDriver('some-model', 'Some Model');
    // attachListeners runs asynchronously in the constructor.
    await tick();
    expect(listeners.filter((l) => l === 'token' || l === 'generationDone')).toHaveLength(2);

    driver.dispose();
    await tick();
    expect([...removed].sort()).toEqual(['generationDone', 'token']);
  });
});

describe('OnDeviceDriver shares the single model slot (APP-3)', () => {
  beforeEach(() => {
    calls.length = 0;
    forgetDeviceModel();
  });

  it('reloads model a after model b took the slot, before generating', async () => {
    const a = new OnDeviceDriver('model-a', 'A');
    const b = new OnDeviceDriver('model-b', 'B');
    await tick();

    a.send('hi');
    await tick();
    await tick();
    b.send('hi');
    await tick();
    await tick();
    a.send('again');
    await tick();
    await tick();

    const loads = calls.filter((c) => c.startsWith('load:'));
    expect(loads).toEqual(['load:model-a', 'load:model-b', 'load:model-a']);
    // Every generate follows the load that put its model in the slot.
    const order = calls.filter((c) => /^(load|generate)/.test(c));
    expect(order[order.length - 1]).toMatch(/^generate:/);
    expect(order[order.length - 2]).toBe('load:model-a');

    a.dispose();
    b.dispose();
  });

  it('does not reload when the same model is already in the slot', async () => {
    const a = new OnDeviceDriver('model-a', 'A');
    await tick();
    a.send('one');
    await tick();
    await tick();
    a.send('two');
    await tick();
    await tick();
    expect(calls.filter((c) => c.startsWith('load:'))).toEqual(['load:model-a']);
    a.dispose();
  });
});

describe('OnDeviceDriver watchdog (UI-1)', () => {
  beforeEach(() => {
    calls.length = 0;
    forgetDeviceModel();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends the task with an error when no token arrives after generate started', async () => {
    const driver = new OnDeviceDriver('model-a', 'A');
    const events: string[] = [];
    driver.subscribe((e) => {
      if (e.type === 'task-done') events.push(`${e.reason}:${e.message ?? ''}`);
    });
    await vi.advanceTimersByTimeAsync(0);
    driver.send('hi');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.some((c) => c.startsWith('generate:'))).toBe(true);
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(/^error:/);
    expect(events[0]).toMatch(/stopped answering/i);
    // The native side is told to drop the request too.
    expect(calls).toContain('stop');
    driver.dispose();
  });

  it('keeps waiting while tokens keep arriving', async () => {
    const driver = new OnDeviceDriver('model-a', 'A');
    const events: string[] = [];
    driver.subscribe((e) => {
      if (e.type === 'task-done') events.push(e.reason);
    });
    await vi.advanceTimersByTimeAsync(0);
    driver.send('hi');
    await vi.advanceTimersByTimeAsync(0);
    const requestId = calls.find((c) => c.startsWith('generate:'))!.slice('generate:'.length);

    // A token just before the deadline resets it.
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 10);
    handlers.get('token')!({ requestId, delta: 'a' });
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 10);
    expect(events).toEqual([]);

    // A normal end clears it: no error fires later.
    handlers.get('generationDone')!({ requestId, stopReason: 'end' });
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 2);
    expect(events).toEqual(['complete']);
    driver.dispose();
  });
});
