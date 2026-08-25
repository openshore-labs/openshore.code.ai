// The streaming fetch reaches past Capacitor's native-HTTP patch by using the
// original WebView fetch the bridge stashes as `window.CapacitorWebFetch`, and
// falls back to the ordinary `fetch` everywhere that symbol is absent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamingFetch } from '../src/lib/streamingFetch.js';

type G = { CapacitorWebFetch?: typeof fetch; fetch: typeof fetch };

afterEach(() => {
  delete (globalThis as unknown as G).CapacitorWebFetch;
  vi.restoreAllMocks();
});

describe('streamingFetch', () => {
  it('prefers the unpatched CapacitorWebFetch when the bridge patched fetch', async () => {
    const unpatched = vi.fn(async () => new Response('stream')) as unknown as typeof fetch;
    const patched = vi.fn(async () => new Response('buffered')) as unknown as typeof fetch;
    (globalThis as unknown as G).CapacitorWebFetch = unpatched;
    const original = globalThis.fetch;
    globalThis.fetch = patched;
    try {
      const res = await streamingFetch('https://example.test/events');
      expect(await res.text()).toBe('stream');
      expect(unpatched).toHaveBeenCalledTimes(1);
      expect(patched).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('falls back to the ordinary fetch off-device (no CapacitorWebFetch)', async () => {
    const plain = vi.fn(async () => new Response('web')) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = plain;
    try {
      const res = await streamingFetch('https://example.test/events');
      expect(await res.text()).toBe('web');
      expect(plain).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('passes the init argument through unchanged', async () => {
    const spy = vi.fn(async () => new Response('ok')) as unknown as typeof fetch;
    (globalThis as unknown as G).CapacitorWebFetch = spy;
    const init: RequestInit = { headers: { authorization: 'Bearer x' } };
    await streamingFetch('https://example.test/events', init);
    expect(spy).toHaveBeenCalledWith('https://example.test/events', init);
  });
});
