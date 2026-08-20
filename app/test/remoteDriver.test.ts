// The phone's SSE wire format: frames in, protocol events out.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteDriver, parseSseFrame } from '../src/drivers/remoteDriver.js';

describe('SSE frame parsing', () => {
  it('parses id and data into a sequenced event', () => {
    const parsed = parseSseFrame('id: 42\ndata: {"type":"text-delta","text":"hello"}');
    expect(parsed).toEqual({ seq: 42, event: { type: 'text-delta', text: 'hello' } });
  });

  it('ignores keepalive comments and malformed frames', () => {
    expect(parseSseFrame(':ka')).toBeNull();
    expect(parseSseFrame('data: not-json')).toBeNull();
    expect(parseSseFrame('')).toBeNull();
  });

  it('survives a missing id (seq 0)', () => {
    const parsed = parseSseFrame('data: {"type":"task-done","reason":"complete"}');
    expect(parsed?.seq).toBe(0);
    expect(parsed?.event.type).toBe('task-done');
  });
});

// G5: an outage adds the "Connection blipped" status row exactly once, however
// many reconnect attempts it takes, and the reconnect loop backs off instead of
// spinning at zero delay.
describe('RemoteDriver reconnect (G5)', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('emits one blip per outage across many failed reconnects', async () => {
    vi.useFakeTimers();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      throw new Error('daemon down');
    }) as unknown as typeof fetch;

    const blips: string[] = [];
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    driver.subscribe((event) => {
      if (event.type === 'status') blips.push(event.message);
    });

    // Let several backoff cycles elapse (600 + 1200 + 2400 + ... ms).
    await vi.advanceTimersByTimeAsync(6000);
    driver.dispose();

    expect(calls).toBeGreaterThan(1); // it retried
    expect(blips).toHaveLength(1); // but blipped only once for the outage
  });
});
