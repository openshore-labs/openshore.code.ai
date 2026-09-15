// osc eval: probe a model with the eval harness and report whether the
// profile earns the "blessed" flag the catalog surfaces.
import { t, GLYPHS } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import { ProviderRegistry } from '../providers/registry.js';
import { getAnthropicKey } from '../auth/claude.js';
import { engineEthicsContext } from '../core/ethics/host.js';
import { runEval } from '../eval/harness.js';
import { runEvalV2, type DriveTask, type DriveTrace, type EvalV2Report } from '../eval/v2.js';
import { EVAL_TASKS } from '../eval/tasks.js';
import { classBlurb } from '../harness/profile.js';
import { configureStreamIdle } from '../providers/streamIdle.js';
import { resolveStack } from '../router/stack.js';
import { Router } from '../router/router.js';
import { buildToolRegistry, buildToolContext } from '../core/agent/registry.js';
import { AgentSession } from '../core/agent/loop.js';
import { PermissionEngine, type PermissionConfig } from '../core/permissions/index.js';
import { Guardrails } from '../core/guardrails/index.js';
import { profileFor } from '../core/security/profiles.js';
import { UsageTracker } from '../auth/usage.js';
import type { AgentEvent } from '../core/agent/types.js';
import type { ToolRegistry } from '../core/tools/index.js';
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
  // The deep eval wires sessions by hand rather than through bootstrapSession,
  // so apply the stream idle windows here too: a cold local model reading the
  // full agent-loop prompt on a modest box can take minutes to first token, and
  // the default 120s inter-token window would kill it during prefill.
  configureStreamIdle({
    idleSeconds: config.resourceBudget.streamIdleSeconds,
    firstByteSeconds: config.resourceBudget.streamFirstByteSeconds,
  });

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
    return { finalText: lastFinalText(events), trace: traceFrom(events, tools) };
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

// The last plain-text answer the loop produced, or '' when it never got there.
function lastFinalText(events: AgentEvent[]): string {
  const finals = events.filter((e) => e.type === 'text-final') as Array<{ text: string }>;
  return finals.length ? finals[finals.length - 1]!.text : '';
}

// A compact account of what the loop did, so a zero score reads as a diagnosis:
// how many turns, which tools it reached for, whether a WRITE-risk tool landed
// (not just any successful call, so a read-only answer task never misreports
// "a write landed"), how it ended, and every failed call's own message. That
// last part matters: "no write landed" alone cannot tell a content mismatch
// from a format problem from something else, and guessing at the difference
// wastes a round trip on a slow box. This is what turns "0%, empty" into
// "ended after 1 turn on a parse error, never called a tool".
export function traceFrom(events: AgentEvent[], tools: ToolRegistry): DriveTrace {
  const turns = events.filter((e) => e.type === 'turn-start').length;
  const toolCalls = (
    events.filter((e) => e.type === 'tool-start') as Array<{
      call: { name: string };
    }>
  ).map((e) => e.call.name);
  const ends = events.filter((e) => e.type === 'tool-end') as Array<{
    call: { name: string };
    result: { ok: boolean; content: string };
  }>;
  const wrote = ends.some((e) => e.result.ok && tools.get(e.call.name)?.risk === 'write');
  const toolFailures = ends
    .filter((e) => !e.result.ok)
    .map((e) => ({ name: e.call.name, detail: truncate(e.result.content, 900) }));
  const done = events.find((e) => e.type === 'task-done') as
    { reason: string; message?: string } | undefined;
  return {
    turns,
    toolCalls,
    wrote,
    doneReason: done?.reason,
    message: done?.message,
    toolFailures: toolFailures.length ? toolFailures : undefined,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// Consecutive failures with the same tool and the same message collapse to one
// line with a count: that IS "the model is looping", and printing it four
// times over would bury the report instead of explaining it.
function dedupeFailures(
  failures: DriveTrace['toolFailures'],
): Array<{ name: string; detail: string; count: number }> {
  if (!failures?.length) return [];
  const out: Array<{ name: string; detail: string; count: number }> = [];
  for (const f of failures) {
    const last = out[out.length - 1];
    if (last && last.name === f.name && last.detail === f.detail) last.count += 1;
    else out.push({ name: f.name, detail: f.detail, count: 1 });
  }
  return out;
}

// One line that says why a task scored what it did: turns, tool calls (deduped
// with counts), whether a write landed, and the stop reason with its message.
// A failed call's own detail follows on its own indented line, so a report
// answers "content mismatch or format problem?" without another eval run.
export function traceLine(trace: DriveTrace): string {
  const counts = new Map<string, number>();
  for (const name of trace.toolCalls) counts.set(name, (counts.get(name) ?? 0) + 1);
  const tools = counts.size
    ? [...counts].map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(', ')
    : 'no tools called';
  const wrote = trace.toolCalls.length ? (trace.wrote ? 'a write landed' : 'no write landed') : '';
  const done = trace.doneReason
    ? `done: ${trace.doneReason}${trace.message ? ` (${trace.message})` : ''}`
    : 'no stop recorded';
  const summary = [`${trace.turns} turn${trace.turns === 1 ? '' : 's'}`, tools, wrote, done]
    .filter(Boolean)
    .join('; ');
  const failureLines = dedupeFailures(trace.toolFailures).map(
    (f) =>
      `\n      ${f.name} failed${f.count > 1 ? ` x${f.count}` : ''}: ${truncate(f.detail, 500)}`,
  );
  return summary + failureLines.join('');
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
    // On anything short of a clean pass, say what the loop actually did, so the
    // number reads as a diagnosis and not a shrug.
    if (score.best < 1 && score.trace) out(t.muted(`      ${traceLine(score.trace)}`));
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
