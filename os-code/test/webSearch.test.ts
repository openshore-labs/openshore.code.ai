// Web tools against a mocked HTTP layer: search backends parse real response
// shapes, webFetch extracts readable markdown, and the egress policy governs
// every request.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { EgressPolicy } from '../src/core/security/egress.js';
import { duckduckgoProvider, unwrapDdg } from '../src/core/tools/search/duckduckgo.js';
import { braveProvider } from '../src/core/tools/search/brave.js';
import { searxngProvider } from '../src/core/tools/search/searxng.js';
import { tavilyProvider } from '../src/core/tools/search/tavily.js';
import { webSearchTool } from '../src/core/tools/webSearch.js';
import { webFetchTool } from '../src/core/tools/webFetch.js';
import { Jail } from '../src/core/security/jail.js';
import type { ToolContext } from '../src/core/tools/index.js';

const config = ConfigSchema.parse({});

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: process.cwd(),
    jail: new Jail(process.cwd()),
    egress: new EgressPolicy(config.egress),
    config,
    ...overrides,
  };
}

function mockFetchOnce(body: string, init: { status?: number; contentType?: string } = {}) {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  });
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  return spy;
}

afterEach(() => vi.restoreAllMocks());

const DDG_HTML = `
<html><body>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=x">Example Docs</a>
  <a class="result__snippet">The documentation for the example project.</a>
</div>
<div class="result">
  <a class="result__a" href="https://another.org/page">Another Page</a>
  <div class="result__snippet">Something else entirely.</div>
</div>
</body></html>`;

describe('duckduckgo', () => {
  it('parses results and unwraps redirect links', async () => {
    mockFetchOnce(DDG_HTML, { contentType: 'text/html' });
    const results = await duckduckgoProvider().search(
      'example docs',
      5,
      new EgressPolicy(config.egress),
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: 'Example Docs', url: 'https://example.com/docs' });
  });

  it('unwrapDdg handles direct and wrapped urls', () => {
    expect(unwrapDdg('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.io%2Fx')).toBe('https://a.io/x');
    expect(unwrapDdg('https://plain.example/x')).toBe('https://plain.example/x');
    expect(unwrapDdg('')).toBeUndefined();
  });
});

describe('keyed backends', () => {
  it('brave parses its response shape and requires its key', async () => {
    const cfg = ConfigSchema.parse({}).search;
    delete process.env.BRAVE_API_KEY;
    await expect(
      braveProvider(cfg).search('q', 3, new EgressPolicy(config.egress)),
    ).rejects.toThrow(/BRAVE_API_KEY/);
    process.env.BRAVE_API_KEY = 'test-key';
    mockFetchOnce(
      JSON.stringify({ web: { results: [{ title: 'T', url: 'https://u.io', description: 'D' }] } }),
    );
    const results = await braveProvider(cfg).search('q', 3, new EgressPolicy(config.egress));
    expect(results).toEqual([{ title: 'T', url: 'https://u.io', snippet: 'D' }]);
    delete process.env.BRAVE_API_KEY;
  });

  it('searxng needs its url and parses the json format', async () => {
    const bare = ConfigSchema.parse({}).search;
    await expect(
      searxngProvider(bare).search('q', 3, new EgressPolicy(config.egress)),
    ).rejects.toThrow(/searxngUrl/);
    const cfg = ConfigSchema.parse({ search: { searxngUrl: 'http://localhost:8888' } }).search;
    mockFetchOnce(JSON.stringify({ results: [{ title: 'S', url: 'https://s.io', content: 'C' }] }));
    const results = await searxngProvider(cfg).search('q', 3, new EgressPolicy(config.egress));
    expect(results).toEqual([{ title: 'S', url: 'https://s.io', snippet: 'C' }]);
  });

  it('tavily posts and parses', async () => {
    process.env.TAVILY_API_KEY = 'tv-key';
    const spy = mockFetchOnce(
      JSON.stringify({ results: [{ title: 'V', url: 'https://v.io', content: 'C' }] }),
    );
    const cfg = ConfigSchema.parse({}).search;
    const results = await tavilyProvider(cfg).search('q', 2, new EgressPolicy(config.egress));
    expect(results[0]!.url).toBe('https://v.io');
    expect(spy).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({ method: 'POST' }),
    );
    delete process.env.TAVILY_API_KEY;
  });
});

describe('webSearch tool', () => {
  it('returns formatted results with citations', async () => {
    mockFetchOnce(DDG_HTML, { contentType: 'text/html' });
    const result = await webSearchTool.execute({ query: 'example docs' }, ctx());
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Example Docs');
    expect(result.citations).toHaveLength(2);
  });

  it('is governed by the egress policy: web off means no packet leaves', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const off = new EgressPolicy({ webEnabled: false, allowlist: [], blocklist: [] });
    const result = await webSearchTool.execute({ query: 'anything' }, ctx({ egress: off }));
    expect(result.ok).toBe(false);
    expect(result.content).toContain('/web on');
    expect(spy).not.toHaveBeenCalled();
  });

  it('honors the blocklist', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const blocked = new EgressPolicy({
      webEnabled: true,
      allowlist: [],
      blocklist: ['duckduckgo.com'],
    });
    const result = await webSearchTool.execute({ query: 'anything' }, ctx({ egress: blocked }));
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('webFetch tool', () => {
  it('extracts readable markdown and cites the page', async () => {
    const html = `<html><head><title>My Post</title></head><body>
      <nav>menu menu menu</nav>
      <article><h1>My Post</h1><p>${'A meaningful paragraph about the topic. '.repeat(20)}</p>
      <pre><code>const x = 1;</code></pre></article>
      <footer>footer junk</footer></body></html>`;
    mockFetchOnce(html, { contentType: 'text/html' });
    const result = await webFetchTool.execute({ url: 'https://blog.example/post' }, ctx());
    expect(result.ok).toBe(true);
    expect(result.content).toContain('My Post');
    expect(result.content).toContain('meaningful paragraph');
    expect(result.content).not.toContain('menu menu menu');
    expect(result.citations?.[0]?.url).toBe('https://blog.example/post');
  });

  it('caps the size for small context windows', async () => {
    const big = `<html><body><article><p>${'word '.repeat(30000)}</p></article></body></html>`;
    mockFetchOnce(big, { contentType: 'text/html' });
    const tight = ConfigSchema.parse({ search: { fetchMaxChars: 2000 } });
    const result = await webFetchTool.execute(
      { url: 'https://big.example/' },
      ctx({ config: tight }),
    );
    expect(result.ok).toBe(true);
    expect(result.content.length).toBeLessThan(4000);
    expect(result.content).toContain('trimmed');
  });

  it('fails with a helpful message on an http error', async () => {
    mockFetchOnce('gone', { status: 404, contentType: 'text/html' });
    const result = await webFetchTool.execute({ url: 'https://gone.example/x' }, ctx());
    expect(result.ok).toBe(false);
    expect(result.content).toContain('404');
  });
});
