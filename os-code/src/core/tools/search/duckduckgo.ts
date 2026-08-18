// DuckDuckGo HTML endpoint: zero config, no key, the out-of-the-box default.
// Parses the lite HTML results page and unwraps the uddg redirect links.
import { parseHTML } from 'linkedom';
import type { SearchProvider, SearchResult } from './index.js';

export function duckduckgoProvider(): SearchProvider {
  return {
    id: 'duckduckgo',
    describe: () => 'DuckDuckGo (no key needed, the zero-config default)',
    async search(query, count, egress) {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await egress.fetch(url, 'web-search', {
        headers: {
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) os-code/0.1',
          accept: 'text/html',
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        throw new Error(
          `DuckDuckGo answered ${res.status}. It may be rate limiting; try again in a moment or switch search.backend.`,
        );
      }
      const html = await res.text();
      const { document } = parseHTML(html);
      const results: SearchResult[] = [];
      for (const node of document.querySelectorAll('.result')) {
        const link = node.querySelector('a.result__a') as {
          getAttribute(name: string): string | null;
          textContent: string | null;
        } | null;
        if (!link) continue;
        const href = unwrapDdg(link.getAttribute('href') ?? '');
        if (!href) continue;
        const snippet = node.querySelector('.result__snippet')?.textContent?.trim() ?? '';
        results.push({ title: link.textContent?.trim() ?? href, url: href, snippet });
        if (results.length >= count) break;
      }
      return results;
    },
  };
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
