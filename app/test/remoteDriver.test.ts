// The phone's SSE wire format: frames in, protocol events out.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteDriver, parseSseFrame } from '../src/drivers/remoteDriver.js';

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

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

  it('stops retrying on a 401 and tells the user to re-pair (TS-P2-1)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: false, status: 401, body: null } as unknown as Response;
    }) as unknown as typeof fetch;

    const messages: string[] = [];
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    driver.subscribe((event) => {
      if (event.type === 'status') messages.push(event.message);
    });

    await vi.advanceTimersByTimeAsync(6000);
    driver.dispose();

    expect(calls).toBe(1); // no retry loop on a fatal answer
    expect(messages.some((m) => /re-pair/i.test(m))).toBe(true);
  });
});

// The Phase 2 terminal routes: the driver talks to its own PTY endpoints,
// carries bytes as base64, and surfaces "no PTY on this machine" cleanly.
describe('RemoteDriver terminal (Phase 2)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetch(termResponse: Partial<Response> & { jsonBody?: unknown }): FetchCall[] {
    const calls: FetchCall[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url: u, method, body });
      // The constructor's event stream loop hits /events: keep it inert.
      if (u.includes('/events')) {
        return { ok: false, status: 500, body: null } as unknown as Response;
      }
      return {
        ok: termResponse.status ? termResponse.status < 400 : true,
        status: termResponse.status ?? 200,
        json: async () => termResponse.jsonBody ?? {},
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  it('opens a terminal and returns its id and size', async () => {
    mockFetch({ status: 201, jsonBody: { termId: 'tm1', cols: 100, rows: 30 } });
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    const opened = await driver.openTerminal({ cols: 100, rows: 30 });
    driver.dispose();
    expect(opened).toEqual({ termId: 'tm1', cols: 100, rows: 30 });
  });

  it('reports unavailable when the desktop has no PTY support (503)', async () => {
    mockFetch({ status: 503, jsonBody: { error: 'Terminal support is not installed.' } });
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    const opened = await driver.openTerminal({ cols: 80, rows: 24 });
    driver.dispose();
    expect(opened).toEqual({ unavailable: true, error: 'Terminal support is not installed.' });
  });

  it('sends stdin as base64 and kills over DELETE', async () => {
    const calls = mockFetch({ status: 200, jsonBody: {} });
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    driver.terminalStdin('tm1', 'ls\n');
    driver.terminalKill('tm1');
    driver.dispose();
    const stdin = calls.find((c) => c.url.endsWith('/term/tm1/stdin'));
    expect(stdin?.method).toBe('POST');
    // "ls\n" utf8 -> base64.
    expect((stdin?.body as { dataBase64: string }).dataBase64).toBe(btoa('ls\n'));
    const kill = calls.find((c) => c.url.endsWith('/term/tm1') && c.method === 'DELETE');
    expect(kill).toBeTruthy();
  });
});
