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
  score: number;
  detail: string;
}

export interface EvalV2Report {
  version: 2;
  model?: string;
  provider?: string;
  ranAt: string;
  scores: EvalV2TaskScore[];
  average: number;
  byCategory: Record<string, number>;
}

export interface EvalV2Options {
  tasks?: EvalTask[];
  model?: string;
  provider?: string;
  onProgress?: (message: string) => void;
  /** Write the report to ~/.os-code/eval/ when true (the CLI does; tests do not). */
  write?: boolean;
}

export async function runEvalV2(
  drive: DriveTask,
  options: EvalV2Options = {},
): Promise<EvalV2Report> {
  const tasks = options.tasks ?? EVAL_TASKS;
  const scores: EvalV2TaskScore[] = [];

  for (const task of tasks) {
    options.onProgress?.(`Running ${task.title}...`);
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
        scores.push({
          task: task.id,
          category: task.category,
          score: 0,
          detail: `the run failed: ${(err as Error).message}`,
        });
        continue;
      }
      const result = await task.check({ cwd, finalText });
      scores.push({
        task: task.id,
        category: task.category,
        score: result.score,
        detail: result.detail,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  const average = scores.length ? scores.reduce((a, s) => a + s.score, 0) / scores.length : 0;
  const byCategory = averageByCategory(scores);

  const report: EvalV2Report = {
    version: 2,
    model: options.model,
    provider: options.provider,
    ranAt: new Date().toISOString(),
    scores,
    average,
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

function averageByCategory(scores: EvalV2TaskScore[]): Record<string, number> {
  const groups = new Map<string, number[]>();
  for (const s of scores) {
    const list = groups.get(s.category) ?? [];
    list.push(s.score);
    groups.set(s.category, list);
  }
  const out: Record<string, number> = {};
  for (const [cat, list] of groups) {
    out[cat] = list.reduce((a, n) => a + n, 0) / list.length;
  }
  return out;
}
