import { describe, expect, it, vi } from 'vitest';
import { formatSearchResults, unwrapDdg, webSearch } from '../src/lib/webSearch.js';

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
});
