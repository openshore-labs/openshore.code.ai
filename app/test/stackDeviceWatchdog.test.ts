// B2 (chat review D2): a "My Stack" chat on the phone could stick busy forever.
// StackDriver.runDevice finished only on generationDone; when the native side
// lost the request (a memory-warning unload, a wedged runner) no token and no
// generationDone ever came, busy stayed true, every later message queued, and
// Stop could not unstick it. The same stall watchdog OnDeviceDriver carries now
// guards the stack's device path, and abort() finishes the turn itself when
// Llama.stop yields no generationDone within a beat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const llama = vi.hoisted(() => ({
  tokenCb: null as null | ((e: { requestId: string; delta: string }) => void),
  doneCb: null as null | ((e: { requestId: string; stopReason: string; detail?: string }) => void),
  stops: [] as string[],
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
    generate: async () => ({ started: true }),
    stop: async ({ requestId }: { requestId: string }) => {
      llama.stops.push(requestId);
    },
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  secretGet: async () => null,
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { STALL_TIMEOUT_MS, ABORT_BEAT_MS } = await import('../src/drivers/deviceModel.js');
import type { AppStack } from '../src/lib/stack.js';

const stack: AppStack = {
  reasoning: { kind: 'device', modelId: 'reason-model', modelName: 'Reasoner' },
  active: [],
  saved: {},
};

function driverWithEvents() {
  const driver = new StackDriver(stack, 'offline');
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const doneEvents = (events: DriverEvent[]) => events.filter((e) => e.type === 'task-done');

describe('StackDriver device stall watchdog (B2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    llama.stops.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends the turn when a started reply goes quiet', async () => {
    const { driver, events } = driverWithEvents();
    driver.send('hello');
    await vi.advanceTimersByTimeAsync(5);
    expect(events.some((e) => e.type === 'task-start')).toBe(true);
    // The reply started (generate returned started) and then nothing came.
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 5);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ reason: 'error' });
    expect((done[0] as { message?: string }).message).toMatch(/stopped answering/i);
    expect(llama.stops.length).toBeGreaterThanOrEqual(1);
    driver.dispose();
  });

  it('a steady stream of tokens never trips the watchdog', async () => {
    const { driver, events } = driverWithEvents();
    driver.send('hello');
    await vi.advanceTimersByTimeAsync(5);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 50);
      // The request id is whatever generate was given; the token listener
      // filters on it, so read it off the first stop call is not possible here.
      // The driver exposes nothing, so we feed the token through the same
      // path the plugin would: any active request.
      llama.tokenCb!({ requestId: currentRequestId(driver), delta: 'w' });
    }
    expect(doneEvents(events)).toHaveLength(0);
    llama.doneCb!({ requestId: currentRequestId(driver), stopReason: 'end' });
    await vi.advanceTimersByTimeAsync(5);
    expect(doneEvents(events)).toHaveLength(1);
    expect(doneEvents(events)[0]).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('abort() finishes the turn when Llama.stop yields no generationDone within a beat', async () => {
    const { driver, events } = driverWithEvents();
    driver.send('hello');
    await vi.advanceTimersByTimeAsync(5);
    driver.abort();
    expect(llama.stops).toHaveLength(1);
    // No generationDone arrives. A beat later the turn is over anyway.
    await vi.advanceTimersByTimeAsync(ABORT_BEAT_MS + 5);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ reason: 'aborted' });
    driver.dispose();
  });

  it('abort() defers to a generationDone that does arrive in time', async () => {
    const { driver, events } = driverWithEvents();
    driver.send('hello');
    await vi.advanceTimersByTimeAsync(5);
    driver.abort();
    llama.doneCb!({ requestId: llama.stops[0]!, stopReason: 'stopped' });
    await vi.advanceTimersByTimeAsync(ABORT_BEAT_MS + 5);
    expect(doneEvents(events)).toHaveLength(1);
    expect(doneEvents(events)[0]).toMatchObject({ reason: 'aborted' });
    driver.dispose();
  });
});

/** The request id the driver is waiting on (private, read for the test only). */
function currentRequestId(driver: unknown): string {
  return (driver as { activeRequestId?: string }).activeRequestId ?? 'none';
}
