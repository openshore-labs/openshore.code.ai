import { describe, expect, it, vi } from 'vitest';

const { secretGetMock } = vi.hoisted(() => ({ secretGetMock: vi.fn() }));
vi.mock('../src/lib/platform.js', () => ({ secretGet: secretGetMock }));

import {
  formatSearchResults,
  resolveSearchKey,
  unwrapDdg,
  webSearch,
} from '../src/lib/webSearch.js';
import { providerSecretKey } from '../src/lib/providers.js';

describe('unwrapDdg', () => {
  it('unwraps a DuckDuckGo redirect link', () => {
    expect(unwrapDdg('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage')).toBe(
      'https://example.com/page',
    );
  });

  it('passes through a plain external link', () => {
    expect(unwrapDdg('https://example.com/page')).toBe('https://example.com/page');
  });

  it('drops an empty or unparseable href', () => {
    expect(unwrapDdg('')).toBeUndefined();
    expect(unwrapDdg('not a url at all::')).toBeUndefined();
  });
});

describe('formatSearchResults', () => {
  it('formats numbered results with a citation instruction', () => {
    const text = formatSearchResults('cats', [
      { title: 'About cats', url: 'https://example.com/cats', snippet: 'Cats are animals.' },
    ]);
    expect(text).toContain('1. About cats');
    expect(text).toContain('https://example.com/cats');
    expect(text).toContain('Cite a source URL');
  });

  it('tells the model to answer from what it knows when there are no results', () => {
    const text = formatSearchResults('xyzzy', []);
    expect(text).toContain('No results for "xyzzy"');
    expect(text).toContain('Answer from what you already know');
  });
});

describe('webSearch backend selection', () => {
  it('calls the Brave endpoint with the subscription header when a Brave key is set', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        web: { results: [{ title: 'T', url: 'https://u', description: 'D' }] },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await webSearch('q', { backend: 'brave', apiKey: 'k' });
    expect(results).toEqual([{ title: 'T', url: 'https://u', snippet: 'D' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.search.brave.com');
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('k');
    vi.unstubAllGlobals();
  });

  it('calls the Tavily endpoint with the api_key in the body when a Tavily key is set', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ title: 'T', url: 'https://u', content: 'C' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await webSearch('q', { backend: 'tavily', apiKey: 'k' });
    expect(results).toEqual([{ title: 'T', url: 'https://u', snippet: 'C' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(init.body as string).api_key).toBe('k');
    vi.unstubAllGlobals();
  });

  it('grounds in Perplexity Sonar, mapping search_results to sources with a bearer key', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'A synthesized answer.' } }],
        search_results: [{ title: 'Src', url: 'https://src', snippet: 'S' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await webSearch('q', { backend: 'perplexity', apiKey: 'pplx-k' });
    expect(results).toEqual([{ title: 'Src', url: 'https://src', snippet: 'S' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.perplexity.ai/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer pplx-k');
    expect(JSON.parse(init.body as string).model).toBe('sonar');
    vi.unstubAllGlobals();
  });

  it('falls back to citation URLs when Sonar returns no search_results, titling by host', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ citations: ['https://example.com/a', 'not-a-url'] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await webSearch('q', { backend: 'perplexity', apiKey: 'pplx-k' });
    // The malformed entry still maps (host-of falls back to the raw string), so
    // assert the first, well-formed source is titled by its host.
    expect(results[0]).toEqual({ title: 'example.com', url: 'https://example.com/a', snippet: '' });
    vi.unstubAllGlobals();
  });
});

describe('resolveSearchKey (Research gating)', () => {
  it('prefers the Perplexity provider key when Research is on and a key is connected', async () => {
    secretGetMock.mockReset();
    secretGetMock.mockImplementation(async (k: string) =>
      k === providerSecretKey('perplexity') ? 'pplx-key' : undefined,
    );
    const key = await resolveSearchKey(true);
    expect(key).toEqual({ backend: 'perplexity', apiKey: 'pplx-key' });
  });

  it('falls back to the configured override when Research is on but no key is connected', async () => {
    secretGetMock.mockReset();
    // No Perplexity key; a Brave override is set in the shared search slot.
    secretGetMock.mockImplementation(async (k: string) =>
      k === providerSecretKey('perplexity')
        ? undefined
        : JSON.stringify({ backend: 'brave', apiKey: 'brave-key' }),
    );
    const key = await resolveSearchKey(true);
    expect(key).toEqual({ backend: 'brave', apiKey: 'brave-key' });
  });

  it('ignores Perplexity entirely when Research is off', async () => {
    secretGetMock.mockReset();
    secretGetMock.mockResolvedValue(undefined);
    const key = await resolveSearchKey(false);
    expect(key).toBeUndefined();
    // Never even looked up the Perplexity key.
    expect(secretGetMock.mock.calls.some((c) => c[0] === providerSecretKey('perplexity'))).toBe(
      false,
    );
  });
});
