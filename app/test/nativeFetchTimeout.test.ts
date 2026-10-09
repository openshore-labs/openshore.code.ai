// A read with a clock (bring your own keys, Part 2, 2026-10-09): an address
// that never answers cannot hold its caller. The iPhone hands the clock to
// CapacitorHttp as its connect and read timeouts; the web aborts its fetch,
// and a body that stalls after the headers is cut off too. A request with no
// clock goes exactly as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'web' as 'web' | 'ios',
  request: vi.fn(),
}));

vi.mock('../src/lib/platform.js', () => ({ platform: () => h.platform }));
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: h.request } }));
vi.mock('../src/lib/electronBridge.js', () => ({ bridge: () => undefined }));

const { nativeFetch } = await import('../src/lib/nativeFetch.js');

const realFetch = globalThis.fetch;
beforeEach(() => {
  h.platform = 'web';
  h.request.mockReset();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe('nativeFetch with a clock', () => {
  it('the iPhone passes it to CapacitorHttp as both timeouts', async () => {
    h.platform = 'ios';
    h.request.mockResolvedValue({ status: 200, data: { data: [] } });
    await nativeFetch('https://host/v1/models', { timeoutMs: 8000 });
    expect(h.request.mock.calls[0]![0]).toMatchObject({ connectTimeout: 8000, readTimeout: 8000 });
    await nativeFetch('https://host/v1/models');
    expect(h.request.mock.calls[1]![0]).not.toHaveProperty('connectTimeout');
    expect(h.request.mock.calls[1]![0]).not.toHaveProperty('readTimeout');
  });

  it('the web gives up on an address that never answers', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    ) as typeof fetch;
    const pending = nativeFetch('http://10.0.0.9:4000/v1/models', { timeoutMs: 8000 });
    const settled = pending.then(
      () => 'answered',
      () => 'gave up',
    );
    await vi.advanceTimersByTimeAsync(7999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBe('gave up');
  });

  it('the web cuts off a body that stalls after its headers', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
        text: async () => '',
      } as unknown as Response;
    }) as typeof fetch;
    const res = await nativeFetch('http://10.0.0.9:4000/v1/models', { timeoutMs: 8000 });
    const body = res.json().then(
      () => 'read',
      () => 'cut off',
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect(await body).toBe('cut off');
  });

  it('a web request with no clock carries no signal, as before', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: 1 }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await nativeFetch('https://host/v1/models');
    expect(await res.json()).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('signal');
  });
});
