// Web search for on-device chat (Embarks). Zero-config default: DuckDuckGo's
// HTML endpoint, no key needed, good enough for almost everything. Bring
// your own Brave or Tavily key in Settings to switch backends. Nothing here
// costs OpenShore anything: DuckDuckGo is free, and a Brave/Tavily key is the
// user's own account, their own bill.
import { secretGet } from './platform.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchBackend = 'duckduckgo' | 'brave' | 'tavily';

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
  return duckduckgoSearch(query, count);
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

/** Format results for the model's next turn: plain, numbered, with URLs it
 *  can cite. Kept short on purpose, this eats into the guide's own context. */
export function formatSearchResults(query: string, results: WebSearchResult[]): string {
  if (!results.length)
    return `No results for "${query}". Answer from what you already know instead.`;
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`.trim());
  return `Search results for "${query}":\n${lines.join('\n')}\n\nAnswer the user's question using these. Cite a source URL when you rely on one.`;
}
