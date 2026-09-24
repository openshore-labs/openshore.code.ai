// webFetch: fetch a page and return clean, readable markdown, stripped of
// nav and ads, size-capped for small local context windows.
import { z } from 'zod';
import type { ToolDef } from './index.js';
import { fetchReadable } from './search/readability.js';
import { EgressBlocked } from '../security/egress.js';

const schema = z.object({
  url: z.string().describe('The http(s) URL to fetch'),
});

export const webFetchTool: ToolDef<typeof schema> = {
  name: 'webFetch',
  description: 'Fetch a web page and return its readable content as markdown.',
  schema,
  risk: 'network',
  // The approval card shows the exact URL; the page is read from its own site.
  async preview(args) {
    return {
      summary: `Read the web page: ${args.url}`,
      detail:
        'The request goes to that site directly. Allowing lets this session search and read the web without asking again.',
    };
  },
  async execute(args, ctx) {
    try {
      const page = await fetchReadable(args.url, ctx.egress, ctx.config.search.fetchMaxChars);
      return {
        ok: true,
        content: `# ${page.title}\nSource: ${page.url}\n\n${page.markdown}`,
        citations: [{ title: page.title, url: page.url }],
      };
    } catch (err) {
      if (err instanceof EgressBlocked) return { ok: false, content: err.message };
      return {
        ok: false,
        content: `Could not fetch ${args.url}: ${(err as Error).message} If the page needs a browser, try a different source from the search results.`,
      };
    }
  },
};
