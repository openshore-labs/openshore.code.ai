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
import { EVAL_TASKS, type EvalTask } from './tasks.js';

/** Runs the agent loop on a prepared workspace and returns its final answer
 *  text. Throwing is allowed; the runner records it as a zero-scored task. */
export type DriveTask = (cwd: string, prompt: string) => Promise<string>;

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
}

export interface EvalV2Options {
  tasks?: EvalTask[];
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
}

async function runAttempt(drive: DriveTask, task: EvalTask): Promise<AttemptOutcome> {
  const cwd = mkdtempSync(join(tmpdir(), `osc-evalv2-${task.id}-`));
  try {
    for (const [rel, content] of Object.entries(task.files)) {
      const abs = join(cwd, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    let finalText = '';
    try {
      finalText = await drive(cwd, task.prompt);
    } catch (err) {
      return { score: 0, detail: `the run failed: ${(err as Error).message}` };
    }
    const result = await task.check({ cwd, finalText });
    return { score: result.score, detail: result.detail };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

export async function runEvalV2(
  drive: DriveTask,
  options: EvalV2Options = {},
): Promise<EvalV2Report> {
  const tasks = options.tasks ?? EVAL_TASKS;
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
      outcomes.push(await runAttempt(drive, task));
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
  };

  if (options.write && options.model) {
    const dir = join(oscHome(), 'eval');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `v2-${options.model.replace(/[^A-Za-z0-9._-]/g, '_')}.json`),
      JSON.stringify(report, null, 2),
    );
  }

  return report;
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
