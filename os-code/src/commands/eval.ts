// osc eval: probe a model with the eval harness and report whether the
// profile earns the "blessed" flag the catalog surfaces.
import { t, GLYPHS } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import { ProviderRegistry } from '../providers/registry.js';
import { getAnthropicKey } from '../auth/claude.js';
import { engineEthicsContext } from '../core/ethics/host.js';
import { runEval } from '../eval/harness.js';
import { runEvalV2, type DriveTask, type EvalV2Report } from '../eval/v2.js';
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
import { header, okLine, out, warnLine } from './util.js';

export interface EvalOptions {
  model?: string;
  provider?: string;
  /** Run the deeper eval v2: the real agent loop against fixture workspaces. */
  deep?: boolean;
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
    await runDeep(config, providers, providerId, model);
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
// with an approver that auto-approves reads and edits and refuses shell, push,
// and cloud spend, so the benchmark stays hermetic and never spends. Writes are
// allowed by config so the loop never stalls on a prompt.
async function runDeep(
  config: OscConfig,
  providers: ProviderRegistry,
  providerId: string,
  model: string,
): Promise<void> {
  header(`Deep eval of ${model} on ${providerId}`);
  out(t.muted('  Runs the real agent loop against fixture workspaces, scored by behavior.'));

  const stack = resolveStack(config, providers);
  const router = new Router(config, providers, stack);
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
    const toolContext = buildToolContext({ cwd, config, router, providers });
    const events: AgentEvent[] = [];
    const agent = new AgentSession({
      config,
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
          : {
              approve: false,
              reason: 'osc eval --deep runs hermetically: no shell, push, or cloud spend',
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
      write: true,
      onProgress: (m) => out(t.muted(`  ${m}`)),
    });
    renderV2(report);
  } catch (err) {
    warnLine(`The deep eval could not finish: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function renderV2(report: EvalV2Report): void {
  out();
  for (const score of report.scores) {
    const glyph =
      score.score >= 0.8
        ? t.ok(GLYPHS.ok)
        : score.score >= 0.5
          ? t.warn('~')
          : t.danger(GLYPHS.fail);
    out(
      `  ${glyph} ${score.task.padEnd(20)} ${(score.score * 100).toFixed(0).padStart(3)}%  ${t.muted(score.detail)}`,
    );
  }
  out();
  const pct = (report.average * 100).toFixed(0);
  if (report.average >= 0.8) {
    okLine(`${report.model} averages ${pct}% on the deep benchmark: strong end to end.`);
  } else {
    warnLine(
      `${report.model} averages ${pct}% on the deep benchmark. The per-task detail above shows where the loop lost the thread.`,
    );
  }
  const byCat = Object.entries(report.byCategory)
    .map(([cat, v]) => `${cat} ${(v * 100).toFixed(0)}%`)
    .join(', ');
  if (byCat) out(t.muted(`  By category: ${byCat}`));
  out(t.muted('  Report saved under ~/.os-code/eval/ (v2-<model>.json).'));
}
