// Web search for on-device chat (Harbor). Zero-config default: DuckDuckGo's
// HTML endpoint, no key needed, good enough for almost everything. Bring
// your own Brave or Tavily key in Settings to switch backends. Nothing here
// costs OpenShore anything: DuckDuckGo is free, and a Brave/Tavily key is the
// user's own account, their own bill.
import { secretGet } from './platform.js';
import { providerSecretKey } from './providers.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchBackend = 'duckduckgo' | 'brave' | 'tavily' | 'perplexity';

export interface SearchKey {
  backend: SearchBackend;
  apiKey: string;
}

/** One shared secret slot: a user configures at most one override backend at
 *  a time, same pattern as the single Codemagic token slot. */
export const SEARCH_SECRET_KEY = 'oscode.secret.search';

const DEFAULT_COUNT = 5;

/** Read the user's configured search key, if any. Malformed/missing storage
 *  degrades to the DuckDuckGo default rather than throwing. */
export async function loadSearchKey(): Promise<SearchKey | undefined> {
  const raw = await secretGet(SEARCH_SECRET_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<SearchKey>;
    if (parsed.backend && parsed.apiKey) return parsed as SearchKey;
  } catch {
    // Fall through to undefined.
  }
  return undefined;
}

export async function webSearch(
  query: string,
  key: SearchKey | undefined,
  count = DEFAULT_COUNT,
): Promise<WebSearchResult[]> {
  if (key?.backend === 'brave' && key.apiKey) return braveSearch(query, key.apiKey, count);
  if (key?.backend === 'tavily' && key.apiKey) return tavilySearch(query, key.apiKey, count);
  if (key?.backend === 'perplexity' && key.apiKey)
    return perplexitySearch(query, key.apiKey, count);
  return duckduckgoSearch(query, count);
}

/** Resolve the search backend for a turn. Research (default off) reuses the
 *  Perplexity provider key already connected in Cloud Connections, so there is
 *  no second key to paste: on, and keyed, it grounds search in Perplexity's
 *  Sonar. Off, or no key, it falls back to whatever the user configured
 *  (Brave/Tavily override, else DuckDuckGo). Perplexity always wins when on
 *  because it is the deliberate opt-in, not a silent default. */
export async function resolveSearchKey(researchOn: boolean): Promise<SearchKey | undefined> {
  if (researchOn) {
    const apiKey = await secretGet(providerSecretKey('perplexity'));
    if (apiKey) return { backend: 'perplexity', apiKey };
  }
  return loadSearchKey();
}

/** DuckDuckGo's lite HTML endpoint: no key, the zero-config default. Uses the
 *  browser's own DOMParser (no linkedom dependency needed client-side). */
async function duckduckgoSearch(query: string, count: number): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo answered ${res.status}. It may be rate limiting, try again.`);
  }
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const results: WebSearchResult[] = [];
  for (const node of doc.querySelectorAll('.result')) {
    const link = node.querySelector('a.result__a');
    const href = unwrapDdg(link?.getAttribute('href') ?? '');
    if (!href) continue;
    const snippet = node.querySelector('.result__snippet')?.textContent?.trim() ?? '';
    results.push({ title: link?.textContent?.trim() ?? href, url: href, snippet });
    if (results.length >= count) break;
  }
  return results;
}

/** DDG links point through /l/?uddg=<encoded>; unwrap to the real URL. */
export function unwrapDdg(href: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = href.startsWith('//')
      ? new URL(`https:${href}`)
      : new URL(href, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    if (url.hostname.includes('duckduckgo.com')) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function braveSearch(
  query: string,
  apiKey: string,
  count: number,
): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Brave Search answered ${res.status}.`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  };
  return (data.web?.results ?? [])
    .slice(0, count)
    .map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
}

async function tavilySearch(
  query: string,
  apiKey: string,
  count: number,
): Promise<WebSearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: count }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Tavily answered ${res.status}.`);
  const data = (await res.json()) as {
    results?: Array<{ title: string; url: string; content?: string }>;
  };
  return (data.results ?? [])
    .slice(0, count)
    .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
}

/** Perplexity Sonar, the Research backend. Sonar is search-grounded: it runs a
 *  live web search and returns both a synthesized answer and its sources. We
 *  take the sources here (mapped to the same {title, url, snippet} shape as
 *  every other backend), so the on-device model reads current, curated sources
 *  and cites them the same way it does DuckDuckGo's. Sonar returns sources as
 *  `search_results` (title/url/snippet) or, on older responses, `citations`
 *  (bare URLs), both outside the OpenAI schema; parse defensively and never
 *  throw on a missing field. Uses the fast `sonar` model on purpose: this is a
 *  retrieval call, not a reasoning one. A dedicated Perplexity Search API may
 *  be cheaper than a chat completion once its shape is verified against the
 *  live docs (a follow-up, egress-blocked in this sandbox). */
async function perplexitySearch(
  query: string,
  apiKey: string,
  count: number,
): Promise<WebSearchResult[]> {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Perplexity answered ${res.status}.`);
  const data = (await res.json()) as {
    search_results?: Array<{ title?: string; url?: string; snippet?: string }>;
    citations?: string[];
  };
  const fromResults = (data.search_results ?? [])
    .filter((r): r is { url: string; title?: string; snippet?: string } => Boolean(r?.url))
    .map((r) => ({ title: r.title || hostOf(r.url), url: r.url, snippet: r.snippet ?? '' }));
  if (fromResults.length) return fromResults.slice(0, count);
  // Older responses carry only citation URLs. Title from the host so the model
  // has something readable to cite.
  return (data.citations ?? [])
    .filter((u) => typeof u === 'string' && u.length > 0)
    .slice(0, count)
    .map((url) => ({ title: hostOf(url), url, snippet: '' }));
}

/** The host of a URL, for a readable citation title. Degrades to the raw
 *  string on a malformed URL rather than throwing. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Format results for the model's next turn: plain, numbered, with URLs it
 *  can cite. Kept short on purpose, this eats into the guide's own context. */
export function formatSearchResults(query: string, results: WebSearchResult[]): string {
  if (!results.length)
    return `No results for "${query}". Answer from what you already know instead.`;
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`.trim());
  return `Search results for "${query}":\n${lines.join('\n')}\n\nAnswer the user's question using these. Cite a source URL when you rely on one.`;
}
