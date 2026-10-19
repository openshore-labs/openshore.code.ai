// Harbor's eval, run on the reference box against the real weights. The phone
// runs Qwen3.5 4B through llama.cpp; Ollama carries the same model as
// qwen3.5:4b, so the number measured here is the phone's model on the
// lowest-common-denominator machine (tenet 2). See src/lib/harborEval.ts.
//
//   ollama pull qwen3.5:4b
//   pnpm --filter oscode-app eval:harbor                      # qwen3.5:4b
//   pnpm --filter oscode-app eval:harbor qwen3:4b-instruct-2507-q4_K_M
//   pnpm --filter oscode-app eval:harbor --sections code,pictures
//   pnpm --filter oscode-app eval:harbor --cases bar-chart,fix-sum
//   pnpm --filter oscode-app eval:harbor --replies replies.jsonl
//   pnpm --filter oscode-app eval:harbor --harness-only --sections code
//
// --harness-only runs only the harness half (the bare half reads "not run"),
// the quicker pass while one lever is tried; the number that is recorded
// comes from a whole run.
// Prints each case's score with the harness and without it, then writes one
// markdown table (harbor-eval-<model>-<date>.md, or --out <file>). --replies
// also writes every reply, both halves of each case, one JSON line per case,
// so a miss can be read before a rule or a lever changes. --resume <file>
// keeps the cases a replies file already holds (a run the box cut short) and
// asks only the rest, appending to the same file. A request whose model
// runner died (the box ran out of memory) is asked once more after Ollama
// reloads it; that is the machine failing, not the model's answer. A model
// without vision skips the picture cases, so the text-only Harbor it replaces
// is compared on what it can do. Each reply's code runs in a fresh V8 context
// in a process with no file system or child processes (scripts/harborEvalCode.ts).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HARBOR_EVAL_CASES,
  HARBOR_EVAL_REPLY_TOKENS,
  harborEvalTable,
  runHarborEval,
  type HarborComplete,
  type HarborRun,
  type HarborSection,
} from '../src/lib/harborEval.js';
import { runCodeInVm as runCode } from './harborEvalCode.js';
import { HARBOR_CONTEXT_TOKENS, HARBOR_SAMPLING } from '../src/lib/harbor.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flagValues = new Set(
  ['--sections', '--cases', '--out', '--replies', '--resume'].map(flag).filter(Boolean),
);
const resume = flag('--resume');
const prior: HarborRun[] = resume
  ? readFileSync(resume, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HarborRun)
  : [];
const replies = flag('--replies') ?? resume;
if (replies && replies !== resume) writeFileSync(replies, '');
const model = args.find((a) => !a.startsWith('--') && !flagValues.has(a)) ?? 'qwen3.5:4b';
const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const sections = flag('--sections')?.split(',') as HarborSection[] | undefined;
const ids = flag('--cases')?.split(',');
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'harbor-eval');

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${host}${path}`, {
    signal: AbortSignal.timeout(900_000),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Whether Ollama says this model reads pictures. */
async function seesPictures(): Promise<boolean> {
  const res = await post('/api/show', { model });
  if (!res.ok) throw new Error(`Ollama has no ${model}: ${await res.text()}. Pull it first.`);
  const info = (await res.json()) as { capabilities?: string[] };
  return info.capabilities?.includes('vision') ?? false;
}

// Thinking stays off, as Harbor runs with Chain of Thought off. A model with no
// thinking switch may refuse the field, so it is sent once and then dropped.
let thinkField = true;
const complete: HarborComplete = async ({ system, messages, harness }) => {
  // With the harness: Harbor's window, reply cap and sampling
  // (lib/harbor.ts, drivers/onDeviceDriver.ts). Without: the same window and
  // cap, and Ollama's own sampling.
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
  const body = () => ({
    model,
    stream: false,
    ...(thinkField ? { think: false } : {}),
    options,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  let res = await post('/api/chat', body());
  if (res.status === 500) {
    const text = await res.text();
    if (!/runner has unexpectedly stopped/i.test(text))
      throw new Error(`Ollama answered 500: ${text}`);
    console.log('  (the model runner stopped; asking once more)');
    await new Promise((r) => setTimeout(r, 10_000));
    res = await post('/api/chat', body());
  }
  if (!res.ok && thinkField) {
    const text = await res.text();
    if (!/think/i.test(text)) throw new Error(`Ollama answered ${res.status}: ${text}`);
    thinkField = false;
    res = await post('/api/chat', body());
  }
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
  };
  return {
    text: data.message?.content ?? '',
    promptTokens: data.prompt_eval_count,
    promptMs: data.prompt_eval_duration ? data.prompt_eval_duration / 1e6 : undefined,
    outputTokens: data.eval_count,
    outputMs: data.eval_duration ? data.eval_duration / 1e6 : undefined,
  };
};

try {
  await fetch(`${host}/api/tags`);
} catch {
  console.error(`No Ollama at ${host}. Start it, then: ollama pull ${model}`);
  process.exit(1);
}

const sees = await seesPictures();
const cases = HARBOR_EVAL_CASES.filter(
  (c) => (!sections || sections.includes(c.section)) && (!ids || ids.includes(c.id)),
);
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
const started = Date.now();
console.log(`${model}: ${sees ? 'reads pictures' : 'text only, picture cases skipped'}\n`);
const result = await runHarborEval({
  complete,
  picture: (name) => readFileSync(join(fixtures, `${name}.png`)).toString('base64'),
  runCode,
  seesPictures: sees,
  cases,
  prior,
  without: !args.includes('--harness-only'),
  onRun: (run) => {
    const misses = run.withHarness.misses.length ? `  (${run.withHarness.misses.join('; ')})` : '';
    const reply = run.withHarness.reply;
    const speed =
      reply.outputTokens && reply.outputMs
        ? `  ${(reply.outputTokens / (reply.outputMs / 1000)).toFixed(1)} tok/s`
        : '';
    console.log(
      `${run.section.padEnd(9)} ${run.id.padEnd(16)} with ${pct(run.withHarness.score)}  without ${pct(run.without.score)}${speed}${misses}`,
    );
    if (replies) appendFileSync(replies, `${JSON.stringify(run)}\n`);
  },
});
const seconds = Math.round((Date.now() - started) / 1000);
const table = harborEvalTable(model, result, seconds);
const out =
  flag('--out') ??
  `harbor-eval-${model.replace(/[^A-Za-z0-9.]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.md`;
writeFileSync(out, `${table}\n`);
console.log(`\n${table}\n\nWritten to ${out}.`);
