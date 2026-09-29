// Page extraction: fetch HTML, strip it to the readable article with
// @mozilla/readability, convert to markdown with turndown, cap the size for
// small local context windows.
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { EgressPolicy } from '../../security/egress.js';

export interface ExtractedPage {
  title: string;
  url: string;
  markdown: string;
  truncated: boolean;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.remove(['script', 'style', 'nav', 'footer', 'iframe', 'noscript']);

/** The most of one page read before parsing (D3). The markdown is cut far
 *  shorter for the model anyway, and a page that streams without end (or a
 *  multi-gigabyte file) must not fill the memory of the computer it runs on. */
export const MAX_PAGE_BYTES = 4 * 1024 * 1024;

/** The body as text, reading no more than `maxBytes`; the rest is never
 *  downloaded (the stream is cancelled). */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - total;
      const piece = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(piece);
      total += piece.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function fetchReadable(
  url: string,
  egress: EgressPolicy,
  maxChars: number,
): Promise<ExtractedPage> {
  const res = await egress.fetch(url, 'web-fetch', {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) os-code/0.1',
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
    },
    // Redirects are followed by the egress wrapper itself, hop by hop.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`${url} answered ${res.status} ${res.statusText}.`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const raw = await readCapped(res, MAX_PAGE_BYTES);

  if (contentType.includes('json')) {
    return finish(url, url, '```json\n' + raw + '\n```', maxChars);
  }
  if (!contentType.includes('html') && !/^\s*</.test(raw)) {
    return finish(url, url, raw, maxChars);
  }

  const { document } = parseHTML(raw);
  let title = document.querySelector('title')?.textContent?.trim() ?? url;
  let markdown: string;
  try {
    const article = new Readability(document as unknown as Document).parse();
    if (article?.content) {
      title = article.title || title;
      markdown = turndown.turndown(article.content);
    } else {
      markdown = turndown.turndown(document.querySelector('body')?.innerHTML ?? raw);
    }
  } catch {
    markdown = turndown.turndown(document.querySelector('body')?.innerHTML ?? raw);
  }
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  return finish(title, url, markdown, maxChars);
}

function finish(title: string, url: string, body: string, maxChars: number): ExtractedPage {
  const truncated = body.length > maxChars;
  const markdown = truncated
    ? `${body.slice(0, maxChars)}\n\n[trimmed ${body.length - maxChars} characters to fit the context window]`
    : body;
  return { title, url, markdown, truncated };
}
