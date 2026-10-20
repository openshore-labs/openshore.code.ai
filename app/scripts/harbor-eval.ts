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
//   pnpm --filter oscode-app eval:harbor --sections code --think-budget 1024
//
// A coding request thinks first with a capped thought, as on the phone
// (harborThinks, HARBOR_THINK_BUDGET). --think-budget <n> tries another
// budget; 0 answers every turn at once, the way Harbor did before.
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
import {
  HARBOR_CONTEXT_TOKENS,
  HARBOR_SAMPLING,
  HARBOR_THOUGHT_CUTOFF,
} from '../src/lib/harbor.js';
import type { DeviceTurnShape } from '../src/drivers/deviceModel.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flagValues = new Set(
  ['--sections', '--cases', '--out', '--replies', '--resume', '--think-budget']
    .map(flag)
    .filter(Boolean),
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
const thinkBudget = flag('--think-budget');
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

interface ChatDone {
  content: string;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** One streamed /api/chat answer, read to its end: the words, and the last
 *  line's counts. An error line mid-stream (a runner that died) is a failure
 *  like an error status. */
async function chat(
  body: unknown,
): Promise<{ ok: true; data: ChatDone } | { ok: false; status: number; text: string }> {
  const res = await post('/api/chat', body);
  if (!res.ok) return { ok: false, status: res.status, text: await res.text() };
  let content = '';
  let done: Omit<ChatDone, 'content'> = {};
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim()) continue;
    const chunk = JSON.parse(line) as Omit<ChatDone, 'content'> & {
      error?: string;
      done?: boolean;
      message?: { content?: string };
    };
    if (chunk.error) return { ok: false, status: 500, text: chunk.error };
    content += chunk.message?.content ?? '';
    if (chunk.done) done = chunk;
  }
  return { ok: true, data: { ...done, content } };
}

/** Ollama's names for a turn's sampling. */
function ollamaSampling(shape: DeviceTurnShape) {
  const s = shape.sampling;
  return {
    temperature: s.temperature,
    top_k: s.topK,
    top_p: s.topP,
    min_p: s.minP,
    repeat_penalty: s.repeatPenalty,
  };
}

/** One streamed /api/generate answer on a raw prompt, read to its end. */
async function generate(
  prompt: string,
  options: Record<string, unknown>,
): Promise<{ text: string; done: Omit<ChatDone, 'content'> & { done_reason?: string } }> {
  let res = await post('/api/generate', { model, raw: true, stream: true, prompt, options });
  if (!res.ok) {
    const error = await res.text();
    // The box ran out of memory and the kernel stopped the runner: once more,
    // as a turn without a thought is.
    if (!/runner has unexpectedly stopped/i.test(error)) {
      throw new Error(`Ollama answered ${res.status}: ${error}`);
    }
    console.log('  (the model runner stopped; asking once more)');
    await new Promise((r) => setTimeout(r, 10_000));
    res = await post('/api/generate', { model, raw: true, stream: true, prompt, options });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${await res.text()}`);
  }
  let text = '';
  let done = {};
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim()) continue;
    const chunk = JSON.parse(line) as { response?: string; error?: string; done?: boolean };
    if (chunk.error) throw new Error(chunk.error);
    text += chunk.response ?? '';
    if (chunk.done) done = chunk;
  }
  return { text, done };
}

/** A turn that thinks, asked the way the phone's runner asks it (LlamaRunner,
 *  PromptFormat): the ChatML prompt ends on the open thought; the thought runs
 *  to its end tag or its budget, a cut thought is closed with the cutoff
 *  words, and the answer then gets its own cap. Ollama re-reads the prompt for
 *  the answer, which the phone does not, so that second read is not counted. */
async function thinkingTurn(
  system: string,
  messages: Array<{ role: string; content: string; images?: string[] }>,
  shape: DeviceTurnShape,
) {
  if (messages.some((m) => m.images?.length)) throw new Error('A thinking turn with pictures has no raw path here.');
  const chatml =
    `<|im_start|>system\n${system}<|im_end|>\n` +
    messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') +
    '<|im_start|>assistant\n<think>\n';
  const options = { num_ctx: HARBOR_CONTEXT_TOKENS, ...ollamaSampling(shape) };
  const thought = await generate(chatml, {
    ...options,
    num_predict: shape.thinkBudget,
    stop: ['</think>'],
  });
  const cut = thought.done.done_reason === 'length';
  const close = cut ? HARBOR_THOUGHT_CUTOFF : '\n</think>\n\n';
  const answer = await generate(chatml + thought.text + close, {
    ...options,
    num_predict: shape.maxTokens,
  });
  return {
    text: `<think>\n${thought.text}${close}${answer.text}`,
    promptTokens: thought.done.prompt_eval_count,
    promptMs: thought.done.prompt_eval_duration ? thought.done.prompt_eval_duration / 1e6 : undefined,
    outputTokens: (thought.done.eval_count ?? 0) + (answer.done.eval_count ?? 0),
    outputMs: ((thought.done.eval_duration ?? 0) + (answer.done.eval_duration ?? 0)) / 1e6,
    thoughtTokens: thought.done.eval_count,
    thoughtCut: cut,
  };
}

// Thinking stays off unless the turn's shape says it thinks (a coding request
// with the harness). A model with no thinking switch may refuse the field, so
// it is sent once and then dropped.
let thinkField = true;
const complete: HarborComplete = async ({ system, messages, harness, shape: asked }) => {
  // --think-budget: another budget for a thinking turn, or 0 for none.
  const shape =
    asked?.thinking && thinkBudget !== undefined
      ? Number(thinkBudget) > 0
        ? { ...asked, thinkBudget: Number(thinkBudget) }
        : { ...asked, thinking: false, thinkBudget: 0, sampling: { ...HARBOR_SAMPLING } }
      : asked;
  if (harness && shape?.thinking) return thinkingTurn(system, messages, shape);
  // With the harness: Harbor's window, reply cap and sampling, the phone's
  // own (lib/harbor.ts, drivers/deviceModel.ts). Without: the same window and
  // cap, and Ollama's own sampling.
  const options =
    harness && shape
      ? { num_ctx: HARBOR_CONTEXT_TOKENS, num_predict: shape.maxTokens, ...ollamaSampling(shape) }
      : { num_ctx: HARBOR_CONTEXT_TOKENS, num_predict: HARBOR_EVAL_REPLY_TOKENS };
  // Streamed, so the answer's headers arrive with its first word: fetch gives
  // up on headers after 300 s, and a slow box writing a long reply in one
  // piece takes longer. The last line carries the same counts and timings.
  const body = () => ({
    model,
    stream: true,
    ...(thinkField ? { think: false } : {}),
    options,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  let res = await chat(body());
  if (!res.ok && /runner has unexpectedly stopped/i.test(res.text)) {
    console.log('  (the model runner stopped; asking once more)');
    await new Promise((r) => setTimeout(r, 10_000));
    res = await chat(body());
  }
  if (!res.ok && thinkField && /think/i.test(res.text)) {
    thinkField = false;
    res = await chat(body());
  }
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${res.text}`);
  const data = res.data;
  return {
    text: data.content,
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
    const thought =
      reply.thoughtTokens !== undefined
        ? `  thought ${reply.thoughtTokens}${reply.thoughtCut ? ' (cut)' : ''}`
        : '';
    console.log(
      `${run.section.padEnd(9)} ${run.id.padEnd(16)} with ${pct(run.withHarness.score)}  without ${pct(run.without.score)}${speed}${thought}${misses}`,
    );
    if (replies) appendFileSync(replies, `${JSON.stringify(run)}\n`);
  },
});
const seconds = Math.round((Date.now() - started) / 1000);
// How long a coding request takes with the harness: reading the prompt,
// the thought and the answer, on this box.
const thinking = result.runs.map((r) => r.withHarness.reply).filter((r) => r.thoughtTokens !== undefined);
const codingLine = thinking.length
  ? `\nA coding request with its thought: ${(
      thinking.reduce((t, r) => t + ((r.promptMs ?? 0) + (r.outputMs ?? 0)) / 1000, 0) / thinking.length
    ).toFixed(0)}s on average, ${Math.round(
      thinking.reduce((t, r) => t + (r.thoughtTokens ?? 0), 0) / thinking.length,
    )} thought tokens, ${thinking.filter((r) => r.thoughtCut).length} of ${thinking.length} cut at the budget.`
  : '';
const table = harborEvalTable(model, result, seconds) + codingLine;
const out =
  flag('--out') ??
  `harbor-eval-${model.replace(/[^A-Za-z0-9.]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.md`;
writeFileSync(out, `${table}\n`);
console.log(`\n${table}\n\nWritten to ${out}.`);
