// osc eval: probe a model with the eval harness and report whether the
// profile earns the "blessed" flag the catalog surfaces.
import { t, GLYPHS } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import { ProviderRegistry } from '../providers/registry.js';
import { getAnthropicKey } from '../auth/claude.js';
import { engineEthicsContext } from '../core/ethics/host.js';
import { runEval } from '../eval/harness.js';
import { runEvalV2, type DriveTask, type EvalV2Report } from '../eval/v2.js';
import { EVAL_TASKS } from '../eval/tasks.js';
import { classBlurb } from '../harness/profile.js';
import { resolveStack } from '../router/stack.js';
import { Router } from '../router/router.js';
import { buildToolRegistry, buildToolContext } from '../core/agent/registry.js';
import { AgentSession } from '../core/agent/loop.js';
import { PermissionEngine, type PermissionConfig } from '../core/permissions/index.js';
import { Guardrails } from '../core/guardrails/index.js';
import { profileFor } from '../core/security/profiles.js';
import { UsageTracker } from '../auth/usage.js';
import type { AgentEvent } from '../core/agent/types.js';
import type { OscConfig } from '../config/schema.js';
import { confirm, header, okLine, out, warnLine } from './util.js';

export interface EvalOptions {
  model?: string;
  provider?: string;
  /** Run the deeper eval v2: the real agent loop against fixture workspaces. */
  deep?: boolean;
  /** Deep only: independent tries per task, so the report shows pass@1 and
   *  best-of-k side by side. Commander hands this over as a string. */
  attempts?: string | number;
  /** Deep only: skip the cloud-spend confirmation for a frontier reference run
   *  (for a scripted run; the terminal still says what it costs). */
  yes?: boolean;
}

export async function evalCommand(options: EvalOptions): Promise<void> {
  const { config } = loadConfig();
  const providers = new ProviderRegistry(config, getAnthropicKey, engineEthicsContext());
  const providerId = options.provider ?? config.stack.orchestrator?.provider ?? 'ollama';
  const model = options.model ?? config.stack.orchestrator?.model;
  if (!model) {
    warnLine('No model to evaluate. Pass --model <name> or set up a stack with osc init.');
    process.exitCode = 1;
    return;
  }
  if (!providers.has(providerId)) {
    warnLine(`No provider "${providerId}" in your config.`);
    process.exitCode = 1;
    return;
  }

  if (options.deep) {
    const attempts = Math.max(1, Math.floor(Number(options.attempts ?? 1)) || 1);
    await runDeep(config, providers, providerId, model, attempts, options.yes === true);
    return;
  }

  header(`Evaluating ${model} on ${providerId}`);
  out(
    t.muted('  Three probes: tool-call formatting, edit-block discipline, instruction following.'),
  );
  try {
    const report = await runEval(providers.get(providerId), model, (message) =>
      out(t.muted(`  ${message}`)),
    );
    out();
    for (const score of report.scores) {
      const glyph =
        score.score >= 0.8
          ? t.ok(GLYPHS.ok)
          : score.score >= 0.5
            ? t.warn('~')
            : t.danger(GLYPHS.fail);
      out(
        `  ${glyph} ${score.task.padEnd(24)} ${(score.score * 100).toFixed(0).padStart(3)}%  ${t.muted(score.detail)}`,
      );
    }
    out();
    if (report.blessed) {
      okLine(
        `${model} averages ${(report.average * 100).toFixed(0)}%: a blessed profile. It will hold up as an orchestrator.`,
      );
    } else {
      warnLine(
        `${model} averages ${(report.average * 100).toFixed(0)}%. It will work, with more repair passes; a stronger orchestrator (osc market) will feel much better.`,
      );
    }
    out(t.muted(`  Class: ${report.modelClass}. ${classBlurb(report.modelClass)}`));
    out(t.muted('  Report saved under ~/.os-code/eval/.'));
  } catch (err) {
    warnLine(`The eval could not finish: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// osc eval --deep: eval v2, the real agent loop against fixture workspaces,
// scored by behavior. The loop is wired here the way the engine wires it (real
// providers behind the ethics guard, the real tool set, a jail per workspace),
// with an approver that auto-approves reads and edits and refuses shell and
// push, so the benchmark stays hermetic. Writes are allowed by config so the
// loop never stalls on a prompt.
//
// Cloud spend: a local run never spends. A frontier reference run (the person
// names a cloud provider and model on the command line, to draw the ceiling
// line the local numbers are measured against) is a deliberate tap, so it asks
// once up front, on the terminal, with the count of tasks and tries, default
// No; only then does the approver say yes to the loop's cloud-spend prompts.
async function runDeep(
  config: OscConfig,
  providers: ProviderRegistry,
  providerId: string,
  model: string,
  attempts: number,
  assumeYes: boolean,
): Promise<void> {
  header(`Deep eval of ${model} on ${providerId}`);
  out(t.muted('  Runs the real agent loop against fixture workspaces, scored by behavior.'));
  if (attempts > 1) {
    out(
      t.muted(
        `  ${attempts} independent tries per task: the report shows one try and best of ${attempts}.`,
      ),
    );
  }

  const provider = providers.get(providerId);
  let cloudApproved = false;
  if (provider.kind === 'cloud') {
    const runs = EVAL_TASKS.length * attempts;
    out();
    out(
      t.cloud(
        `  This is a frontier reference run: ${runs} agent runs on ${model} through ${providerId}, spent on your key. It draws the ceiling line your local numbers are measured against.`,
      ),
    );
    cloudApproved = assumeYes || (await confirm('  Spend on this reference run?', false));
    if (!cloudApproved) {
      warnLine('Nothing was sent. Run again and answer y to draw the reference line.');
      return;
    }
  }

  // The model under test sits in the orchestrator seat for this run, whatever
  // the person's stack says, so --model and --provider mean what they say
  // (before this, the deep eval always drove the configured orchestrator).
  // Cloud escalation is off for the run: a benchmark measures one model.
  const evalConfig: OscConfig = {
    ...config,
    stack: { ...config.stack, orchestrator: { provider: providerId, model } },
    routing: {
      ...config.routing,
      escalation: { ...config.routing.escalation, enabled: false },
    },
  };
  const stack = resolveStack(evalConfig, providers);
  const router = new Router(evalConfig, providers, stack);
  const tools = buildToolRegistry({
    stackHasVision: false,
    stackHasImageGen: false,
    stackHasSpecialists: false,
  });
  const profile = profileFor('local-interactive');
  const permConfig = {
    ...config.permissions,
    defaults: { ...config.permissions.defaults, write: 'allow' as const },
  } as PermissionConfig;

  const drive: DriveTask = async (cwd, prompt) => {
    const toolContext = buildToolContext({ cwd, config: evalConfig, router, providers });
    const events: AgentEvent[] = [];
    const agent = new AgentSession({
      config: evalConfig,
      router,
      tools,
      toolContext,
      permissions: new PermissionEngine(permConfig, profile),
      guardrails: new Guardrails(config.guardrails),
      usage: new UsageTracker(),
      profile,
      approver: async (req) =>
        req.risk === 'read' || req.risk === 'write' || req.risk === 'network'
          ? { approve: true }
          : req.kind === 'cloud-spend' && cloudApproved
            ? { approve: true }
            : {
                approve: false,
                reason:
                  'osc eval --deep runs hermetically: no shell, no push, and no cloud spend beyond a reference run you approved up front',
              },
      onEvent: (e) => events.push(e),
      persistRule: () => false,
    });
    await agent.run(prompt);
    const finals = events.filter((e) => e.type === 'text-final') as Array<{ text: string }>;
    return finals.length ? finals[finals.length - 1]!.text : '';
  };

  try {
    const report = await runEvalV2(drive, {
      model,
      provider: providerId,
      attempts,
      write: true,
      onProgress: (m) => out(t.muted(`  ${m}`)),
    });
    renderV2(report, provider.kind);
  } catch (err) {
    warnLine(`The deep eval could not finish: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function renderV2(report: EvalV2Report, kind: 'local' | 'cloud'): void {
  const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;
  const many = report.attempts > 1;
  out();
  if (many)
    out(
      t.muted(
        `  ${'task'.padEnd(22)} ${'1 try'.padStart(6)} ${`best/${report.attempts}`.padStart(7)}`,
      ),
    );
  for (const score of report.scores) {
    const glyph =
      score.score >= 0.8
        ? t.ok(GLYPHS.ok)
        : score.score >= 0.5
          ? t.warn('~')
          : t.danger(GLYPHS.fail);
    const cols = many
      ? `${pct(score.score).padStart(6)} ${pct(score.best).padStart(7)}`
      : pct(score.score);
    out(`  ${glyph} ${score.task.padEnd(20)} ${cols}  ${t.muted(score.detail)}`);
  }
  out();
  const avg = (report.average * 100).toFixed(0);
  if (report.average >= 0.8) {
    okLine(`${report.model} averages ${avg}% on the deep benchmark: strong end to end.`);
  } else {
    warnLine(
      `${report.model} averages ${avg}% on the deep benchmark. The per-task detail above shows where the loop lost the thread.`,
    );
  }
  if (many) {
    const best = (report.bestAverage * 100).toFixed(0);
    const gain = Math.round((report.bestAverage - report.average) * 100);
    out(
      t.muted(
        `  One try ${avg}%, best of ${report.attempts} ${best}%: ${
          gain > 0
            ? `a best-of-${report.attempts} picker judged by tests would add about ${gain} points on this model.`
            : 'more tries do not help this model here; the misses are systematic, not luck.'
        }`,
      ),
    );
  }
  const byCat = Object.entries(report.byCategory)
    .map(([cat, v]) => `${cat} ${(v * 100).toFixed(0)}%`)
    .join(', ');
  if (byCat) out(t.muted(`  By category: ${byCat}`));
  if (kind === 'cloud') {
    out(
      t.muted('  This is a reference line: the ceiling your local numbers are measured against.'),
    );
  } else {
    out(
      t.muted(
        '  For the ceiling line, run the same eval on a frontier model you hold a key for: osc eval --deep --provider anthropic --model <model>.',
      ),
    );
  }
  out(t.muted('  Report saved under ~/.os-code/eval/ (v2-<model>.json).'));
}
