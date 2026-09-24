// webSearch: local models have a knowledge cutoff and no network of their
// own, so the agent provides the web as a tool, with citations the TUI can
// show. Queries leave the machine; the egress policy governs every request.
import { z } from 'zod';
import type { Citation, ToolDef } from './index.js';
import { searchProviderFor, searchServiceName } from './search/index.js';
import { EgressBlocked } from '../security/egress.js';

const schema = z.object({
  query: z.string().min(1).describe('What to search the web for'),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('How many results (default from config)'),
});

export const webSearchTool: ToolDef<typeof schema> = {
  name: 'webSearch',
  description:
    'Search the web and get ranked results (title, url, snippet). Use webFetch on a result to read the page.',
  schema,
  risk: 'network',
  // The approval card shows the exact query and names the service it goes to.
  async preview(args, ctx) {
    const service = searchServiceName(ctx.config.search);
    return {
      summary: `Search the web for: ${args.query}`,
      detail: `The query goes to ${service}. Allowing lets this session search and read the web without asking again.`,
    };
  },
  async execute(args, ctx) {
    const provider = searchProviderFor(ctx.config.search);
    const count = args.count ?? ctx.config.search.resultCount;
    try {
      const results = await provider.search(args.query, count, ctx.egress);
      if (!results.length) {
        return { ok: true, content: `No results for "${args.query}". Try different words.` };
      }
      const lines = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`.trim(),
      );
      const citations: Citation[] = results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));
      return {
        ok: true,
        content: `Results for "${args.query}" (via ${provider.id}):\n${lines.join('\n')}`,
        citations,
      };
    } catch (err) {
      if (err instanceof EgressBlocked) return { ok: false, content: err.message };
      return { ok: false, content: `Search failed: ${(err as Error).message}` };
    }
  },
};
