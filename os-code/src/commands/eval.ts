// osc eval: probe a model with the eval harness and report whether the
// profile earns the "blessed" flag the catalog surfaces.
import { t, GLYPHS } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import { ProviderRegistry } from '../providers/registry.js';
import { getAnthropicKey } from '../auth/claude.js';
import { runEval } from '../eval/harness.js';
import { header, okLine, out, warnLine } from './util.js';

export interface EvalOptions {
  model?: string;
  provider?: string;
}

export async function evalCommand(options: EvalOptions): Promise<void> {
  const { config } = loadConfig();
  const providers = new ProviderRegistry(config, getAnthropicKey);
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
    out(t.muted('  Report saved under ~/.os-code/eval/.'));
  } catch (err) {
    warnLine(`The eval could not finish: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
