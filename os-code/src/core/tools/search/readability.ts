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
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`${url} answered ${res.status} ${res.statusText}.`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const raw = await res.text();

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
