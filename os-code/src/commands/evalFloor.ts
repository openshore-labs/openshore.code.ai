// osc eval --floor: every number the founder's box owes the v1 plan, in one
// command (tenet 2: nothing is claimed without eval, and the floor is measured
// on the reference box first). For each floor model it runs:
//
//   - the code suite with Ollama's num_ctx off and on ('auto'), the with and
//     without pair that decides whether `numCtx: 'auto'` becomes the default;
//   - the everyday suite (a page, photos, a chart, a broken button) plain,
//     with num_ctx on, and with the page check on, since those are the
//     first-time person's jobs and the page check is their test suite;
//   - the head-to-head baseline: the everyday suite through Claude Code on the
//     same model, when Claude Code is installed here.
//
// The default models are the shipped floor (qwen2.5-coder:3b, under a
// non-commercial license) and its Apache candidate (qwen3:4b), so one run
// settles both the floor model and the license question. A model that is not
// pulled yet is a download the person approves, never a silent pull.
//
// It ends with one markdown table written beside the reports, ready to paste
// into DECISIONS and PROGRESS. This is an overnight run on a CPU-only box.
import { cpus, platform, arch, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../brand/theme.js';
import { loadConfig, oscHome } from '../config/load.js';
import { ProviderRegistry } from '../providers/registry.js';
import { getAnthropicKey } from '../auth/claude.js';
import { engineEthicsContext } from '../core/ethics/host.js';
import { installOllamaRef } from '../market/install.js';
import { claudeCodeVersion, ollamaRoot } from '../eval/baseline.js';
import type { EvalNumCtx, EvalPageCheck, EvalSuite, EvalV2Report } from '../eval/v2.js';
import { runBaseline, runDeep, type EvalOptions } from './eval.js';
import { confirm, header, okLine, out, warnLine } from './util.js';

/** The shipped floor and its Apache candidate. */
export const FLOOR_MODELS = ['qwen2.5-coder:3b', 'qwen3:4b'] as const;

/** One planned run of the floor. */
export interface FloorRun {
  model: string;
  suite: EvalSuite;
  /** 'engine' with a served-window setting, or the Claude Code baseline. */
  driver: 'engine' | 'claude-code';
  numCtx?: EvalNumCtx;
  pageCheck?: EvalPageCheck;
}

/** Every run the floor makes, in order, per model: the code suite with
 *  num_ctx off then auto; the everyday suite plain, with num_ctx auto, and
 *  with the page check on (each against the plain run, one change at a time);
 *  then the baseline. */
export function floorPlan(models: readonly string[], withBaseline: boolean): FloorRun[] {
  const runs: FloorRun[] = [];
  for (const model of models) {
    runs.push({ model, suite: 'code', driver: 'engine', numCtx: 'off' });
    runs.push({ model, suite: 'code', driver: 'engine', numCtx: 'auto' });
    runs.push({ model, suite: 'everyday', driver: 'engine', numCtx: 'off', pageCheck: 'off' });
    runs.push({ model, suite: 'everyday', driver: 'engine', numCtx: 'auto', pageCheck: 'off' });
    runs.push({ model, suite: 'everyday', driver: 'engine', numCtx: 'off', pageCheck: 'on' });
    if (withBaseline) runs.push({ model, suite: 'everyday', driver: 'claude-code' });
  }
  return runs;
}

/** The run in words, for the table. */
export function describeRun(run: FloorRun): string {
  if (run.driver === 'claude-code') return `${run.suite}, Claude Code baseline`;
  const page = run.pageCheck ? `, page check ${run.pageCheck}` : '';
  return `${run.suite}, OpenShore, num_ctx ${run.numCtx}${page}`;
}

export interface FloorRow {
  run: FloorRun;
  report?: EvalV2Report;
}

/** The machine in one line: the reference box is the point of the run. */
export function machineLine(): string {
  const cpu = cpus()[0]?.model?.trim() ?? 'unknown CPU';
  const ram = Math.round(totalmem() / 1024 ** 3);
  return `${platform()} ${arch()}, ${cpu} x${cpus().length}, ${ram} GB RAM`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function minutes(report: EvalV2Report): string {
  const ms = report.scores.reduce((sum, s) => sum + (s.trace?.wallMs ?? 0), 0);
  return ms ? `${(ms / 60_000).toFixed(1)} min` : '-';
}

/** The markdown summary: one row per run, ready for DECISIONS. */
export function floorMarkdown(
  rows: FloorRow[],
  date: string,
  machine: string,
  attempts: number,
): string {
  const lines = [
    `# Floor run, ${date}`,
    '',
    `Machine: ${machine}. Tries per task: ${attempts} (one try and best of ${attempts}).`,
    '',
    '| Model | Run | One try | Best | Wall time |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const { run, report } of rows) {
    if (!report) {
      lines.push(`| ${run.model} | ${describeRun(run)} | did not finish | | |`);
      continue;
    }
    lines.push(
      `| ${run.model} | ${describeRun(run)} | ${pct(report.average)} | ${pct(report.bestAverage)} | ${minutes(report)} |`,
    );
  }
  lines.push('');
  lines.push('Per-task detail and traces are in the v2-*.json reports beside this file.');
  lines.push(
    'Record these in os-code/DECISIONS.md before numCtx defaults to auto, the page check defaults on, or the floor model changes (tenet 2).',
  );
  lines.push('');
  return lines.join('\n');
}

async function pulledModels(baseUrl: string): Promise<Set<string> | undefined> {
  try {
    const res = await fetch(`${ollamaRoot(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return new Set((body.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean));
  } catch {
    return undefined;
  }
}

export async function floorCommand(options: EvalOptions): Promise<void> {
  const { config } = loadConfig();
  const providerId = options.provider ?? 'ollama';
  const endpoint = config.providers[providerId];
  if (endpoint?.kind !== 'openai-compatible') {
    warnLine(`The floor runs on a local Ollama. "${providerId}" is not one; pass --provider.`);
    process.exitCode = 1;
    return;
  }
  const models = options.model
    ? options.model
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    : [...FLOOR_MODELS];
  const attempts = Math.max(1, Math.floor(Number(options.attempts ?? 2)) || 2);

  header('The floor run');
  const machine = machineLine();
  out(t.muted(`  ${machine}`));
  out(t.muted(`  Models: ${models.join(', ')}. ${attempts} tries per task.`));

  const pulled = await pulledModels(endpoint.baseUrl);
  if (!pulled) {
    warnLine(`Nothing is answering at ${endpoint.baseUrl}. Start Ollama, then run this again.`);
    process.exitCode = 1;
    return;
  }
  const missing = models.filter((m) => !pulled.has(m) && !pulled.has(`${m}:latest`));
  if (missing.length) {
    out();
    out(`  Not downloaded yet: ${missing.join(', ')}. The weights come from the Ollama library.`);
    const go = options.yes === true || (await confirm('  Download them now?', false));
    if (!go) {
      warnLine(
        `Nothing was downloaded. Pull them yourself (ollama pull ${missing[0]}), then run this again.`,
      );
      process.exitCode = 1;
      return;
    }
    for (const ref of missing) {
      let last = -1;
      const result = await installOllamaRef(
        ref,
        (p) => {
          const step = p.percent === undefined ? -1 : Math.floor(p.percent / 10);
          if (step !== last && step >= 0) {
            last = step;
            out(t.muted(`  ${ref}: ${step * 10}%`));
          }
        },
        { baseUrl: ollamaRoot(endpoint.baseUrl) },
      );
      if (!result.ok) {
        warnLine(result.detail);
        process.exitCode = 1;
        return;
      }
      okLine(result.detail);
    }
  }

  const withBaseline = claudeCodeVersion() !== undefined;
  if (!withBaseline) {
    out(t.muted('  Claude Code is not installed here, so the baseline rows are skipped.'));
  }
  const plan = floorPlan(models, withBaseline);
  out(t.muted(`  ${plan.length} runs. On a CPU-only box this is an overnight job.`));

  const providers = new ProviderRegistry(config, getAnthropicKey, engineEthicsContext());
  const rows: FloorRow[] = [];
  for (const run of plan) {
    const report =
      run.driver === 'claude-code'
        ? await runBaseline(config, providerId, run.model, attempts, run.suite)
        : await runDeep(
            config,
            providers,
            providerId,
            run.model,
            attempts,
            false,
            {
              ...(run.numCtx ? { numCtx: run.numCtx } : {}),
              ...(run.pageCheck ? { pageCheck: run.pageCheck } : {}),
            },
            run.suite,
          );
    rows.push({ run, report });
  }

  const date = new Date().toISOString().slice(0, 10);
  const dir = join(oscHome(), 'eval');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `floor-${date}.md`);
  writeFileSync(path, floorMarkdown(rows, date, machine, attempts));
  out();
  okLine(`The floor run is done. The table is at ${path}.`);
  out(t.muted('  Paste it into os-code/DECISIONS.md and PROGRESS before any default changes.'));
}
