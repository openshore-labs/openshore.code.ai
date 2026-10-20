// Harbor's research eval on the reference box (src/lib/harborResearch.ts):
// each question with Harbor's harness and the web, and without either, against
// Ollama. The search hands back the results DuckDuckGo gave when the case was
// written (scripts/harbor-research/results.json), so a run is repeatable.
//
//   pnpm --filter oscode-app eval:harbor-research                 # qwen3.5:4b
//   pnpm --filter oscode-app eval:harbor-research --out r.md --replies r.jsonl
//   pnpm --filter oscode-app eval:harbor-research --excerpts long
//   pnpm --filter oscode-app eval:harbor-research --search-first
//   pnpm --filter oscode-app eval:harbor-research --search-first default
//   pnpm --filter oscode-app eval:harbor-research --search-note
//   pnpm --filter oscode-app eval:harbor-research --search-first default --exact
//
// --search-first searches by rule before Harbor writes, for a question about
// something current (harborNeedsWeb); "default" for every question about the
// world (harborSearchesByDefault). Levers under test. Harbor's prompt carries
// today's date, as on the phone.
//
// Search providers differ in how much of a page a result carries: DuckDuckGo
// and Brave give a short snippet, Tavily a long excerpt. Each saved result
// holds both, so --excerpts long measures Harbor on the longer kind (and on
// what reading the page would give) with the same pages.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARBOR_CONTEXT_TOKENS, HARBOR_SAMPLING } from '../src/lib/harbor.js';
import { HARBOR_EVAL_REPLY_TOKENS, type HarborComplete } from '../src/lib/harborEval.js';
import {
  RESEARCH_CASES,
  SEARCH_WHEN_UNSURE_NOTE,
  researchTable,
  researchWithHarness,
  researchWithout,
  type ResearchRun,
} from '../src/lib/harborResearch.js';
import type { WebSearchResult } from '../src/lib/webSearch.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flagValues = new Set(
  ['--out', '--replies', '--excerpts', '--search-first'].map(flag).filter(Boolean),
);
const long = flag('--excerpts') === 'long';
const levers = {
  // --search-first alone is the list of current words; "default" searches
  // every question about the world.
  searchFirst: !args.includes('--search-first')
    ? false
    : flag('--search-first') === 'default'
      ? ('default' as const)
      : ('rule' as const),
  searchNote: args.includes('--search-note') ? SEARCH_WHEN_UNSURE_NOTE : undefined,
  exactMatch: args.includes('--exact'),
};
const model = args.find((a) => !a.startsWith('--') && !flagValues.has(a)) ?? 'qwen3.5:4b';
const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const saved = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'harbor-research', 'results.json'), 'utf8'),
) as Record<
  string,
  { query: string; captured: string; results: Array<WebSearchResult & { excerpt?: string }> }
>;

const complete: HarborComplete = async ({ system, messages, harness }) => {
  // With the harness: Harbor's window, reply cap and sampling, as a research
  // turn runs on the phone (it does not think). Without: Ollama's own sampling.
  const options = harness
    ? {
        num_ctx: HARBOR_CONTEXT_TOKENS,
        num_predict: HARBOR_EVAL_REPLY_TOKENS,
        temperature: HARBOR_SAMPLING.temperature,
        top_k: HARBOR_SAMPLING.topK,
        top_p: HARBOR_SAMPLING.topP,
        min_p: HARBOR_SAMPLING.minP,
        repeat_penalty: HARBOR_SAMPLING.repeatPenalty,
      }
    : { num_ctx: HARBOR_CONTEXT_TOKENS, num_predict: HARBOR_EVAL_REPLY_TOKENS };
  const body = JSON.stringify({
    model,
    stream: true,
    think: false,
    options,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  const ask = () =>
    fetch(`${host}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(900_000),
      headers: { 'content-type': 'application/json' },
      body,
    });
  let res = await ask();
  let raw = await res.text();
  if (/runner has unexpectedly stopped/i.test(raw)) {
    // The box ran out of memory and the kernel stopped the runner: once more.
    console.log('  (the model runner stopped; asking once more)');
    await new Promise((r) => setTimeout(r, 10_000));
    res = await ask();
    raw = await res.text();
  }
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${raw}`);
  let text = '';
  let done: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const chunk = JSON.parse(line) as { error?: string; done?: boolean; message?: { content?: string } };
    if (chunk.error) throw new Error(chunk.error);
    text += chunk.message?.content ?? '';
    if (chunk.done) done = chunk as unknown as Record<string, number>;
  }
  return {
    text,
    promptTokens: done.prompt_eval_count,
    promptMs: done.prompt_eval_duration ? done.prompt_eval_duration / 1e6 : undefined,
    outputTokens: done.eval_count,
    outputMs: done.eval_duration ? done.eval_duration / 1e6 : undefined,
  };
};

/** The saved results for the case, whatever words the model searched with. */
const search = async (_query: string, c: { id: string }): Promise<WebSearchResult[]> =>
  (saved[c.id]?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: long ? (r.excerpt ?? r.snippet) : r.snippet,
  }));

const replies = flag('--replies');
if (replies) writeFileSync(replies, '');
const started = Date.now();
const runs: ResearchRun[] = [];
for (const c of RESEARCH_CASES) {
  const run: ResearchRun = {
    id: c.id,
    needsSearch: c.needsSearch,
    withHarness: await researchWithHarness(c, complete, search, levers),
    without: await researchWithout(c, complete),
  };
  runs.push(run);
  const w = run.withHarness;
  const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
  console.log(
    `${c.id.padEnd(18)} with ${pct(w.score)}  without ${pct(run.without.score)}  ${w.searched ? `searched "${w.query}"${w.cited ? ', cited' : ''}` : 'no search'}  ${w.seconds.toFixed(0)}s${w.misses.length ? `  (${w.misses.join('; ')})` : ''}`,
  );
  if (replies) writeFileSync(replies, `${JSON.stringify(run)}\n`, { flag: 'a' });
}
const table = researchTable(model, runs, Math.round((Date.now() - started) / 1000));
const out = flag('--out') ?? `harbor-research-${model.replace(/[^A-Za-z0-9.]+/g, '-')}.md`;
writeFileSync(out, `${table}\n`);
console.log(`\n${table}\n\nWritten to ${out}.`);
