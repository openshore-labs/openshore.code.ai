// Eval v2: the spine. Where the quick three-probe `osc eval` asks a model for
// one-shot completions, this runs the REAL agent loop against fixture
// workspaces and scores the result by behavior (the edit applied, the tests
// pass, the answer is right). It is the number every harness claim is measured
// against, per tenet 2.
//
// The loop is injected as `driveTask`, so this module never imports a provider
// or the agent: the CLI wires `driveTask` to a real model through the engine,
// and the CI regression test wires it to a scripted mock provider through the
// same loop. Either way the scoring is identical, which is what makes the CI
// path a true regression guard for the harness itself with no weights.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { oscHome } from '../config/load.js';
import type { AgentEvent } from '../core/agent/types.js';
import {
  EVAL_TASKS,
  EVAL_VAULT_TASKS,
  EVAL_HANDOFF_TASKS,
  EVAL_CHECK_FILE,
  type EvalTask,
} from './tasks.js';
import { EVAL_EVERYDAY_TASKS } from './everydayTasks.js';

/** Which task set a run measures when none is named: the code suite (the
 *  default, so the code average stays comparable run to run) or the everyday
 *  suite, the jobs a person who is not a developer brings (a page, photos, a
 *  chart, a broken button). */
export type EvalSuite = 'code' | 'everyday';

/** The with-pack and without-pack variant (Vault M4, 4.8, CTO I14). 'on' asks
 *  the drive to run the context pack in full (`vault.context: 'full'`), 'off'
 *  to run with none (`vault.context: 'off'`). */
export type EvalVaultPack = 'on' | 'off';

/** The served-window variant (CTO I1): 'auto' sends Ollama's `num_ctx`, 'off'
 *  sends none. */
export type EvalNumCtx = 'auto' | 'off';

/** The prompt cache variant (Vault M5, CTO J17 and J19): 'on' sets the
 *  provider's `promptCache: 'auto'`, 'off' sets `'off'`. Only an Anthropic
 *  endpoint reads it; any other provider runs unchanged. */
export type EvalPromptCache = 'on' | 'off';

/** The handoff variant (Vault M5, CTO J13 and J19): 'on' runs the pack in
 *  full with the task's handoff in its handoff layer, 'off' runs the same pack
 *  with that layer empty, so the two runs differ by the handoff alone. */
export type EvalHandoffLayer = 'on' | 'off';

/** The page check variant (v1 Phase 1): 'on' sets
 *  `harness.verify.pageCheck: 'on'` for the run, 'off' leaves it off, so the
 *  everyday suite measures the check that needs no test suite. */
export type EvalPageCheck = 'on' | 'off';

/** The variant a run was made under, recorded on the report and on every
 *  trace so a with and a without number can never be mixed up. Absent keys
 *  mean the drive's own default. */
export interface EvalVariant {
  vaultPack?: EvalVaultPack;
  numCtx?: EvalNumCtx;
  promptCache?: EvalPromptCache;
  handoff?: EvalHandoffLayer;
  pageCheck?: EvalPageCheck;
}

/** What the loop did on one run, so a zero is a diagnosis and not just a
 *  verdict: how many turns, which tools it reached for and whether any write
 *  landed, and how the task ended. Optional, since the CI mock path does not
 *  need it; the CLI fills it from the agent's events. */
export interface DriveTrace {
  turns: number;
  toolCalls: string[];
  wrote: boolean;
  doneReason?: string;
  message?: string;
  /** Every failed tool call's own message, in order (truncated per entry so a
   *  looping task does not bloat the report). A repeated failure at the exact
   *  same tool and detail is what "the model is looping" looks like from the
   *  outside; a change in detail across attempts, or none at all, is itself
   *  the diagnosis, which "no write landed" alone cannot distinguish (was it a
   *  content mismatch, a format problem, something else). */
  toolFailures?: Array<{ name: string; detail: string }>;
  /** Verify in the loop, when the task carries its own check: how many times
   *  the check ran this task and whether the last run passed. Absent when it
   *  never ran (no write landed, or the task has no check). */
  verify?: { rounds: number; passed: boolean };
  /** How many independent attempts the loop's own best-of-N picker made
   *  this run (1 when it never had to start over). Distinct from the eval's
   *  `--attempts`, which are whole separate runs. */
  attempts?: number;
  /** Every input token the run sent, summed over its model requests (the
   *  loop's `usage` events). The prefill cost the reference box pays. On an
   *  Anthropic seat this is the uncached rest (`input_tokens`): tokens read
   *  from or written to the prompt cache are counted in the two fields
   *  below, never here, so the three add up to what the prompt carried. */
  promptTokens?: number;
  /** Input tokens served from the provider's prompt cache, summed over the
   *  run's `usage` events (Anthropic's `cache_read_input_tokens`). Absent
   *  when no event carried the field, so "no cache" and "cache read 0"
   *  stay apart. */
  cacheReadTokens?: number;
  /** Input tokens written to the provider's prompt cache, summed the same
   *  way (Anthropic's `cache_creation_input_tokens`). */
  cacheWriteTokens?: number;
  /** Each turn's served prompt against the loop's own estimate of it (C1),
   *  in order: `read` is what the server said it took in (cache reads and
   *  writes included), `estimated` what the loop counted it sent. A turn
   *  read under `TRUNCATION_RATIO` of its estimate was cut by the server
   *  (`looksTruncated`). Absent when no turn carried an estimate. The served
   *  window gate (`--num-ctx auto|off`) closes on these. */
  promptWindow?: Array<{ read: number; estimated: number }>;
  /** Tokens the context pack took, summed over its `context-pack` events.
   *  0 when the pack ran and was empty; absent when no pack event came. */
  packTokens?: number;
  /** The vault notes the pack used, by path, deduplicated, in first-use order
   *  (pins, search hits and links; never the map, handoff or Current State). */
  packNotes?: string[];
  /** Wall-clock milliseconds for the drive, measured by the runner. */
  wallMs?: number;
  /** The variant this run was made under. */
  variant?: EvalVariant;
}

/** Where a task's fixture landed and which variant to run it under, handed to
 *  the drive so it can point the loop at the vault and set the pack and the
 *  served window. `vaultDir` is set only for a task that carries a vault. */
export interface DriveContext {
  vaultDir?: string;
  vaultPack?: EvalVaultPack;
  numCtx?: EvalNumCtx;
  promptCache?: EvalPromptCache;
  handoff?: EvalHandoffLayer;
  pageCheck?: EvalPageCheck;
}

/** A drive may return just the final text, or the text plus a trace of what
 *  happened. Both are accepted so the CI mock path stays a one-liner. */
export interface DriveOutcome {
  finalText: string;
  trace?: DriveTrace;
}

/** Runs the agent loop on a prepared workspace and returns its final answer
 *  text (or that plus a trace). Throwing is allowed; the runner records it as
 *  a zero-scored task. The task rides along so a drive can wire the task's
 *  own check as the loop's verify command (`verifyCommandFor`). */
export type DriveTask = (
  cwd: string,
  prompt: string,
  task: EvalTask,
  context: DriveContext,
) => Promise<string | DriveOutcome>;

export interface EvalV2TaskScore {
  task: string;
  category: string;
  /** The mean over attempts: what one try gets you (pass@1 when attempts is 1). */
  score: number;
  /** The best attempt: what best-of-k judged by the task's own check gets you.
   *  Equal to `score` when attempts is 1. */
  best: number;
  /** Every attempt's score, in order, so the spread is visible. */
  attempts: number[];
  /** The detail of the best attempt (or the only one). */
  detail: string;
  /** What the loop did on the reported attempt, when the drive supplied it. */
  trace?: DriveTrace;
}

export interface EvalV2Report {
  version: 2;
  model?: string;
  provider?: string;
  ranAt: string;
  /** Independent tries per task, each in a fresh workspace. */
  attempts: number;
  scores: EvalV2TaskScore[];
  /** Mean of per-task means: the single-try number. */
  average: number;
  /** Mean of per-task bests: the best-of-k number. Same as average when
   *  attempts is 1. The gap between the two is what a best-of-N picker judged
   *  by tests would buy on this model, measured, not believed. */
  bestAverage: number;
  byCategory: Record<string, number>;
  /** The variant the whole run was made under. */
  variant: EvalVariant;
  /** The suite, when it was not the code suite. */
  suite?: EvalSuite;
  /** Who drove the loop, when it was not OpenShore's own engine (the
   *  head-to-head baseline: the same model through another agent). */
  driver?: string;
}

export interface EvalV2Options {
  /** The tasks to run. Defaults to the handoff task when `handoff` is set
   *  and `vaultPack` is not, to the vault tasks when `vaultPack` is set (those
   *  flags are what the with and without runs measure), otherwise to the
   *  code tasks, so the code average stays comparable run to run. */
  tasks?: EvalTask[];
  /** Run with the context pack ('on') or without it ('off'). */
  vaultPack?: EvalVaultPack;
  /** Run with the served window set ('auto') or unset ('off'). */
  numCtx?: EvalNumCtx;
  /** Run with the provider's prompt cache on or off. */
  promptCache?: EvalPromptCache;
  /** Run the handoff task with its handoff layer ('on') or without ('off'). */
  handoff?: EvalHandoffLayer;
  /** Run with the page check on or off. */
  pageCheck?: EvalPageCheck;
  /** The suite to run when `tasks` is not given. */
  suite?: EvalSuite;
  /** Who drives the loop, recorded on the report and in its file name when
   *  it is not the engine (the baseline). */
  driver?: string;
  model?: string;
  provider?: string;
  /** Independent tries per task (default 1). Each try gets a fresh fixture
   *  workspace and a fresh drive, so tries never see one another. */
  attempts?: number;
  onProgress?: (message: string) => void;
  /** Write the report to ~/.os-code/eval/ when true (the CLI does; tests do not). */
  write?: boolean;
}

interface AttemptOutcome {
  score: number;
  detail: string;
  trace?: DriveTrace;
}

function writeTree(root: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** The eval's own vault folder for one attempt: a sibling of the workspace,
 *  never inside it, so the agent reaches the notes through the vault tools
 *  and the pack, not by reading the workspace. */
export const EVAL_VAULT_DIR = 'vault';
/** The workspace folder for one attempt, beside the vault. */
export const EVAL_WORKSPACE_DIR = 'workspace';

async function runAttempt(
  drive: DriveTask,
  task: EvalTask,
  variant: EvalVariant,
): Promise<AttemptOutcome> {
  const root = mkdtempSync(join(tmpdir(), `osc-evalv2-${task.id}-`));
  const cwd = join(root, EVAL_WORKSPACE_DIR);
  try {
    writeTree(cwd, task.files);
    let vaultDir: string | undefined;
    if (task.vault) {
      vaultDir = join(root, EVAL_VAULT_DIR);
      writeTree(vaultDir, task.vault);
    }
    // The task's own test sits in the workspace like a project's test file
    // would, so the harness can run it after a change (verify in the loop).
    if (task.verifyScript) writeFileSync(join(cwd, EVAL_CHECK_FILE), task.verifyScript);
    let finalText = '';
    let trace: DriveTrace | undefined;
    const started = Date.now();
    try {
      const outcome = await drive(cwd, task.prompt, task, { vaultDir, ...variant });
      if (typeof outcome === 'string') {
        finalText = outcome;
      } else {
        finalText = outcome.finalText;
        trace = outcome.trace;
      }
    } catch (err) {
      return { score: 0, detail: `the run failed: ${(err as Error).message}` };
    }
    const wallMs = Date.now() - started;
    if (trace) {
      trace = { ...trace, wallMs: trace.wallMs ?? wallMs };
      if (hasVariant(variant)) trace.variant = { ...variant };
    }
    const result = await task.check({ cwd, finalText });
    return { score: result.score, detail: result.detail, trace };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function runEvalV2(
  drive: DriveTask,
  options: EvalV2Options = {},
): Promise<EvalV2Report> {
  const variant: EvalVariant = {};
  if (options.vaultPack) variant.vaultPack = options.vaultPack;
  if (options.numCtx) variant.numCtx = options.numCtx;
  if (options.promptCache) variant.promptCache = options.promptCache;
  if (options.handoff) variant.handoff = options.handoff;
  if (options.pageCheck) variant.pageCheck = options.pageCheck;
  const tasks = options.tasks ?? defaultTasks(variant, options.suite);
  const attempts = Math.max(1, Math.floor(options.attempts ?? 1));
  const scores: EvalV2TaskScore[] = [];

  for (const task of tasks) {
    const outcomes: AttemptOutcome[] = [];
    for (let i = 0; i < attempts; i += 1) {
      options.onProgress?.(
        attempts > 1
          ? `Running ${task.title} (try ${i + 1} of ${attempts})...`
          : `Running ${task.title}...`,
      );
      outcomes.push(await runAttempt(drive, task, variant));
    }
    const attemptScores = outcomes.map((o) => o.score);
    const bestOutcome = outcomes.reduce((a, b) => (b.score > a.score ? b : a));
    scores.push({
      task: task.id,
      category: task.category,
      score: mean(attemptScores),
      best: bestOutcome.score,
      attempts: attemptScores,
      detail: bestOutcome.detail,
      trace: bestOutcome.trace,
    });
  }

  const average = mean(scores.map((s) => s.score));
  const bestAverage = mean(scores.map((s) => s.best));
  const byCategory = averageByCategory(scores);

  const report: EvalV2Report = {
    version: 2,
    model: options.model,
    provider: options.provider,
    ranAt: new Date().toISOString(),
    attempts,
    scores,
    average,
    bestAverage,
    byCategory,
    variant,
  };
  if (options.suite && options.suite !== 'code') report.suite = options.suite;
  if (options.driver) report.driver = options.driver;

  if (options.write && options.model) {
    const dir = join(oscHome(), 'eval');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(
        dir,
        `v2-${options.model.replace(/[^A-Za-z0-9._-]/g, '_')}${variantSuffix(variant)}${runSuffix(report)}.json`,
      ),
      JSON.stringify(report, null, 2),
    );
  }

  return report;
}

/** The suite a variant measures when no tasks are named: the everyday suite
 *  when asked for, the handoff task for a handoff run, the vault suite for a
 *  vault-pack run, the code suite otherwise (a prompt cache or served-window
 *  run measures the code suite, or the everyday suite when asked). */
export function defaultTasks(variant: EvalVariant, suite?: EvalSuite): EvalTask[] {
  if (suite === 'everyday') return EVAL_EVERYDAY_TASKS;
  if (variant.vaultPack) return EVAL_VAULT_TASKS;
  if (variant.handoff) return EVAL_HANDOFF_TASKS;
  return EVAL_TASKS;
}

function hasVariant(variant: EvalVariant): boolean {
  return (
    variant.vaultPack !== undefined ||
    variant.numCtx !== undefined ||
    variant.promptCache !== undefined ||
    variant.handoff !== undefined ||
    variant.pageCheck !== undefined
  );
}

/** A with run and a without run write separate report files, so the second
 *  never overwrites the first. Empty for a run with no variant, so the plain
 *  report keeps its old name. */
export function variantSuffix(variant: EvalVariant): string {
  let out = '';
  if (variant.vaultPack) out += `-pack-${variant.vaultPack}`;
  if (variant.numCtx) out += `-numctx-${variant.numCtx}`;
  if (variant.promptCache) out += `-cache-${variant.promptCache}`;
  if (variant.handoff) out += `-handoff-${variant.handoff}`;
  if (variant.pageCheck) out += `-page-${variant.pageCheck}`;
  return out;
}

/** The suite and the driver in a report's file name, so an everyday run and
 *  a baseline run never overwrite the engine's code-suite report. Empty for a
 *  plain run. */
export function runSuffix(report: Pick<EvalV2Report, 'suite' | 'driver'>): string {
  let out = '';
  if (report.suite && report.suite !== 'code') out += `-${report.suite}`;
  if (report.driver) out += `-${report.driver.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  return out;
}

/** The pack layers that name a vault note. */
const VAULT_NOTE_LAYERS: ReadonlySet<string> = new Set(['pin', 'search', 'link']);

/** The trace fields `vaultTraceFields` reads. */
export type VaultTraceFields = Pick<
  DriveTrace,
  | 'promptTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'packTokens'
  | 'packNotes'
  | 'promptWindow'
>;

/** The vault trace fields read off a run's events, for a drive to merge into
 *  its trace: every input token sent (summed over `usage` events), the prompt
 *  cache's reads and writes (summed over the `usage` events that carry them),
 *  each turn's served prompt against its estimate (C1), the pack's tokens
 *  (summed over `context-pack` events) and the notes it used. Pure, so the CLI and the tests read the events the same way. */
export function vaultTraceFields(events: readonly AgentEvent[]): VaultTraceFields {
  let promptTokens = 0;
  let sawUsage = false;
  let cacheRead: number | undefined;
  let cacheWrite: number | undefined;
  let packTokens = 0;
  let sawPack = false;
  const notes: string[] = [];
  const promptWindow: Array<{ read: number; estimated: number }> = [];
  for (const e of events) {
    if (e.type === 'usage') {
      sawUsage = true;
      promptTokens += e.promptTokens;
      if (e.cacheReadTokens !== undefined) cacheRead = (cacheRead ?? 0) + e.cacheReadTokens;
      if (e.cacheWriteTokens !== undefined) cacheWrite = (cacheWrite ?? 0) + e.cacheWriteTokens;
      if (e.estimatedPromptTokens !== undefined) {
        const read = e.promptTokens + (e.cacheReadTokens ?? 0) + (e.cacheWriteTokens ?? 0);
        promptWindow.push({ read, estimated: e.estimatedPromptTokens });
      }
    } else if (e.type === 'context-pack') {
      sawPack = true;
      packTokens += e.tokens;
      for (const source of e.sources) {
        // Vault notes only: the map and the handoff carry no path, and Current
        // State is the project's own file in the repo, not a vault note.
        if (!VAULT_NOTE_LAYERS.has(source.layer) || !source.path) continue;
        if (!notes.includes(source.path)) notes.push(source.path);
      }
    }
  }
  const out: VaultTraceFields = {};
  if (sawUsage) out.promptTokens = promptTokens;
  if (cacheRead !== undefined) out.cacheReadTokens = cacheRead;
  if (cacheWrite !== undefined) out.cacheWriteTokens = cacheWrite;
  if (promptWindow.length) out.promptWindow = promptWindow;
  if (sawPack) {
    out.packTokens = packTokens;
    out.packNotes = notes;
  }
  return out;
}

function mean(list: number[]): number {
  return list.length ? list.reduce((a, n) => a + n, 0) / list.length : 0;
}

function averageByCategory(scores: EvalV2TaskScore[]): Record<string, number> {
  const groups = new Map<string, number[]>();
  for (const s of scores) {
    const list = groups.get(s.category) ?? [];
    list.push(s.score);
    groups.set(s.category, list);
  }
  const out: Record<string, number> = {};
  for (const [cat, list] of groups) {
    out[cat] = mean(list);
  }
  return out;
}
