// Harbor Lite's answer eval, run on the reference box against the real weights.
// The phone bundles SmolLM2-135M-Instruct; Ollama carries the same model as
// smollm2:135m, so the number measured here is the phone's model on the
// lowest-common-denominator machine (tenet 2).
//
//   ollama pull smollm2:135m
//   pnpm --filter oscode-app eval:guide            # without web search
//   pnpm --filter oscode-app eval:guide --search   # live DuckDuckGo for web turns
//
// Prints each question's score with the harness and without it (every fact on
// every turn, the old prompt), then the two means. See src/lib/guideEval.ts.
import {
  GUIDE_EVAL_CASES,
  runAnswerEval,
  type Complete,
  type Search,
} from '../src/lib/guideEval.js';

const args = process.argv.slice(2);
const model = args.find((a) => !a.startsWith('--')) ?? 'smollm2:135m';
const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

const complete: Complete = async (system, messages) => {
  const res = await fetch(`${host}/api/chat`, {
    signal: AbortSignal.timeout(300_000),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      // The phone's settings: the device window, Harbor Lite's reply cap and
      // temperature (drivers/onDeviceDriver.ts).
      options: { num_ctx: 4096, num_predict: 512, temperature: 0.4 },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
};

// DuckDuckGo's HTML endpoint, the app's zero-config backend, read with a regex
// since Node has no DOMParser.
const search: Search = async (query) => {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`DuckDuckGo answered ${res.status}`);
  const html = await res.text();
  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .trim();
  const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
    strip(m[1]!),
  );
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
    strip(m[1]!),
  );
  return titles.slice(0, 3).map((title, i) => ({ title, url: '', snippet: snippets[i] ?? '' }));
};

try {
  await fetch(`${host}/api/tags`);
} catch {
  console.error(`No Ollama at ${host}. Start it, then: ollama pull ${model}`);
  process.exit(1);
}

const started = Date.now();
const result = await runAnswerEval(complete, args.includes('--search') ? search : undefined);
const pct = (n: number) => `${Math.round(n * 100)}%`;
for (const run of result.runs) {
  const misses = run.withHarness.misses.length ? `  (${run.withHarness.misses.join(', ')})` : '';
  console.log(
    `${run.id.padEnd(14)} with ${pct(run.withHarness.score).padStart(4)}  without ${pct(run.without.score).padStart(4)}${misses}`,
  );
}
console.log(
  `\n${model}, ${GUIDE_EVAL_CASES.length} questions, ${Math.round((Date.now() - started) / 1000)}s: with the harness ${pct(result.withHarness)}, without ${pct(result.without)}`,
);
