// osc eval: probe a model with the eval harness and report whether the
// profile earns the "blessed" flag the catalog surfaces.
import { t, GLYPHS } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import { ProviderRegistry } from '../providers/registry.js';
import { getAnthropicKey } from '../auth/claude.js';
import { engineEthicsContext } from '../core/ethics/host.js';
import { runEval } from '../eval/harness.js';
import {
  defaultTasks,
  runEvalV2,
  variantSuffix,
  vaultTraceFields,
  type DriveTask,
  type DriveTrace,
  type EvalHandoffLayer,
  type EvalNumCtx,
  type EvalPromptCache,
  type EvalV2Report,
  type EvalVariant,
  type EvalVaultPack,
} from '../eval/v2.js';
import { verifyCommandFor } from '../eval/tasks.js';
import { buildHandoff, HANDOFF_MAX_TOKENS } from '../harness/handoff.js';
import { classBlurb } from '../harness/profile.js';
import { configureStreamIdle } from '../providers/streamIdle.js';
import { resolveStack } from '../router/stack.js';
import { Router } from '../router/router.js';
import {
  buildToolRegistry,
  buildToolContext,
  lazyVaultPrivacy,
  vaultPrivacyConfig,
} from '../core/agent/registry.js';
import { AgentSession } from '../core/agent/loop.js';
import { PermissionEngine, type PermissionConfig } from '../core/permissions/index.js';
import { Guardrails } from '../core/guardrails/index.js';
import { profileFor } from '../core/security/profiles.js';
import { UsageTracker } from '../auth/usage.js';
import { createVaultContextSource, currentStateReader } from '../core/vault/contextSource.js';
import { closeEngineVaultIndex, engineVaultIndex } from '../core/vault/engineIndex.js';
import { deleteVaultIndexFile } from '../core/vault/indexFile.js';
import type { AgentEvent, Approver } from '../core/agent/types.js';
import type { VaultContextSource } from '../harness/vaultContext.js';
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
  /** Deep only: run the vault tasks with the full context pack ('on') or none
   *  ('off'), the with and without pair of Vault M4's founder gate (CTO I14). */
  vaultPack?: string;
  /** Deep only: send Ollama's `num_ctx` ('auto') or not ('off') (CTO I1). */
  numCtx?: string;
  /** Deep only: Anthropic prompt caching on or off for the run (CTO J17,
   *  J19), so input tokens, cache reads and writes, and dollars per completed
   *  task can be set side by side. */
  promptCache?: string;
  /** Deep only: run the handoff task with its handoff layer ('on') or with
   *  that layer empty ('off') (CTO J13, J19). */
  handoff?: string;
}

/** Parse a two-value flag; undefined when unset, an error string when bad. */
function parseChoice<T extends string>(
  flag: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined | { error: string } {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(v)) return v as T;
  return { error: `${flag} takes ${allowed.join(' or ')}, not "${value}".` };
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

  const vaultPack = parseChoice<EvalVaultPack>('--vault-pack', options.vaultPack, ['on', 'off']);
  const numCtx = parseChoice<EvalNumCtx>('--num-ctx', options.numCtx, ['auto', 'off']);
  const promptCache = parseChoice<EvalPromptCache>('--prompt-cache', options.promptCache, [
    'on',
    'off',
  ]);
  const handoff = parseChoice<EvalHandoffLayer>('--handoff', options.handoff, ['on', 'off']);
  for (const parsed of [vaultPack, numCtx, promptCache, handoff]) {
    if (typeof parsed === 'object') {
      warnLine(parsed.error);
      process.exitCode = 1;
      return;
    }
  }
  if ((vaultPack || numCtx || promptCache || handoff) && !options.deep) {
    warnLine(
      '--vault-pack, --num-ctx, --prompt-cache and --handoff measure the agent loop, so they go with --deep.',
    );
    process.exitCode = 1;
    return;
  }

  if (options.deep) {
    const attempts = Math.max(1, Math.floor(Number(options.attempts ?? 1)) || 1);
    const variant: EvalVariant = {};
    if (typeof vaultPack === 'string') variant.vaultPack = vaultPack;
    if (typeof numCtx === 'string') variant.numCtx = numCtx;
    if (typeof promptCache === 'string') variant.promptCache = promptCache;
    if (typeof handoff === 'string') variant.handoff = handoff;
    await runDeep(config, providers, providerId, model, attempts, options.yes === true, variant);
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
  variant: EvalVariant = {},
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
  const variantText = describeVariant(variant);
  if (variantText) out(t.muted(`  Variant: ${variantText}.`));

  const provider = providers.get(providerId);
  let cloudApproved = false;
  if (provider.kind === 'cloud') {
    // A variant run runs its own suite (runEvalV2's default), so the spend
    // line counts that one.
    const tasks = defaultTasks(variant);
    const runs = tasks.length * attempts;
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

  const drive = deepDrive({
    config: evalConfig,
    providers,
    providerId,
    cloudApproved: () => cloudApproved,
  });

  try {
    const report = await runEvalV2(drive, {
      model,
      provider: providerId,
      attempts,
      write: true,
      ...variant,
      onProgress: (m) => out(t.muted(`  ${m}`)),
    });
    renderV2(report, provider.kind);
  } catch (err) {
    warnLine(`The deep eval could not finish: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

export interface DeepDriveOptions {
  /** The eval's config: the model under test in the orchestrator seat. */
  config: OscConfig;
  /** The registry for a run with no `numCtx` variant. */
  providers: ProviderRegistry;
  /** The provider under test, whose `numCtx` a variant sets. */
  providerId: string;
  cloudApproved: () => boolean;
  /** A fresh registry over a config (the `numCtx` and `promptCache`
   *  variants). Defaults to the engine's own; a test hands in one holding a
   *  mock. */
  makeProviders?: (config: OscConfig) => ProviderRegistry;
  /** Builds a handoff task's handoff from its scripted chat. Defaults to the
   *  harness's own `buildHandoff`, the code a real session end runs. */
  buildHandoff?: typeof buildHandoff;
}

/**
 * The deep eval's drive: one fresh session per task, wired the way the engine
 * wires one (the real tools, a jail per workspace, the vault context source),
 * with the variant applied (Vault M4, CTO I14):
 * - the task's vault folder is the session's vault root, for the tools and
 *   the pack alike; a run with a vault-pack variant and no task vault gets no
 *   vault at all, so the person's own notes never enter a benchmark;
 * - `vaultPack` 'on' sets `vault.context: 'full'` (the full pack on every
 *   class), 'off' sets `'off'`; either way Memory stays on, so the two runs
 *   differ by the pack alone;
 * - `numCtx` sets `providers.<id>.numCtx` on a fresh registry, built once per
 *   value so Ollama keeps one window for the whole run;
 * - `promptCache` sets `providers.<id>.promptCache` ('on' is 'auto') on an
 *   Anthropic endpoint, on a fresh registry the same way;
 * - a task with a handoff (Vault M5, CTO J13) gets it built from its scripted
 *   chat and placed in the pack's handoff layer; `handoff` 'off' leaves that
 *   layer empty, and a `handoff` variant without `vaultPack` runs the pack in
 *   full so the handoff layer can render at all. The person's own handoffs are
 *   never read: the layer holds the task's handoff or nothing.
 * The index of a task's vault is built before the run starts (a person's
 * vault is indexed in the background long before a task), then closed and
 * its saved file removed, since the folder is gone after the run.
 */
export function deepDrive(options: DeepDriveOptions): DriveTask {
  const { config: evalConfig, providerId } = options;
  const registries = new Map<string, ProviderRegistry>();
  const makeProviders =
    options.makeProviders ??
    ((cfg: OscConfig) => new ProviderRegistry(cfg, getAnthropicKey, engineEthicsContext()));
  const profile = profileFor('local-interactive');
  const permConfig = {
    ...evalConfig.permissions,
    defaults: { ...evalConfig.permissions.defaults, write: 'allow' as const },
  } as PermissionConfig;

  return async (cwd, prompt, task, context) => {
    // Verify in the loop: the task's own test runs after a change, the way a
    // project's tests would, and a failure goes back to the model for another
    // go (harness.verify.maxRetries). It is the harness feature under
    // measurement; the score still comes from the task's independent check.
    const verifyCommand = verifyCommandFor(task);
    // A variant or a handoff task is hermetic about the vault: the task's
    // own folder or none, so the person's own notes never enter a benchmark.
    const hermetic =
      context.vaultPack !== undefined || context.handoff !== undefined || !!task.handoff;
    let driveConfig: OscConfig = verifyCommand
      ? {
          ...evalConfig,
          harness: {
            ...evalConfig.harness,
            verify: { ...evalConfig.harness.verify, command: verifyCommand, timeoutSeconds: 30 },
          },
        }
      : evalConfig;
    // The handoff layer is a full-mode layer, so a handoff run with no pack
    // variant runs the pack in full; the two handoff runs then differ by the
    // handoff alone.
    const packContext = context.vaultPack ?? (context.handoff ? 'on' : undefined);
    if (packContext) {
      driveConfig = {
        ...driveConfig,
        vault: { ...driveConfig.vault, context: packContext === 'on' ? 'full' : 'off' },
        memory: { ...driveConfig.memory, enabled: true },
      };
    }
    let providers = options.providers;
    if (context.numCtx || context.promptCache) {
      const endpoint = driveConfig.providers[providerId];
      if (context.numCtx && endpoint?.kind === 'openai-compatible') {
        driveConfig = {
          ...driveConfig,
          providers: {
            ...driveConfig.providers,
            [providerId]: { ...endpoint, numCtx: context.numCtx },
          },
        };
      }
      if (context.promptCache && endpoint?.kind === 'anthropic') {
        driveConfig = {
          ...driveConfig,
          providers: {
            ...driveConfig.providers,
            [providerId]: {
              ...endpoint,
              promptCache: context.promptCache === 'on' ? 'auto' : 'off',
            },
          },
        };
      }
      const key = `${context.numCtx ?? '-'}/${context.promptCache ?? '-'}`;
      let fresh = registries.get(key);
      if (!fresh) {
        fresh = makeProviders(driveConfig);
        registries.set(key, fresh);
      }
      providers = fresh;
    }
    const handoffText =
      task.handoff && context.handoff !== 'off'
        ? (options.buildHandoff ?? buildHandoff)(task.handoff.turns, HANDOFF_MAX_TOKENS, {
            from: task.handoff.from,
            date: task.handoff.date,
          }).text
        : undefined;

    const stack = resolveStack(driveConfig, providers);
    const router = new Router(driveConfig, providers, stack);
    const hasVault = context.vaultDir !== undefined || !hermetic;
    const tools = buildToolRegistry({
      stackHasVision: false,
      stackHasImageGen: false,
      stackHasSpecialists: false,
      memory: driveConfig.memory?.enabled !== false,
      vault: hasVault,
    });
    const toolContext = buildToolContext({
      cwd,
      config: driveConfig,
      router,
      providers,
      vault: hasVault,
    });
    if (context.vaultDir) toolContext.vaultRoot = context.vaultDir;
    const privacy = toolContext.vaultPrivacy ?? lazyVaultPrivacy(vaultPrivacyConfig(driveConfig));
    if (context.vaultDir) {
      toolContext.vaultPrivacy = privacy;
      const handle = await engineVaultIndex(context.vaultDir);
      await handle.whenReconciled(60_000);
    }
    const source = createVaultContextSource({
      vaultRoot: toolContext.vaultRoot,
      privacy,
      currentState: currentStateReader(cwd, undefined),
      lockdown: { egress: false, secrets: false },
    });
    // The handoff layer holds the task's handoff or nothing, whatever the
    // source would read on its own, so a benchmark never sees the person's.
    const vaultContext: VaultContextSource = {
      async prepare(taskText, signal) {
        const prepared = { ...(await source.prepare(taskText, signal)) };
        delete prepared.handoff;
        if (handoffText) prepared.handoff = handoffText;
        return prepared;
      },
    };

    const events: AgentEvent[] = [];
    const agent = new AgentSession({
      config: driveConfig,
      router,
      tools,
      toolContext,
      permissions: new PermissionEngine(permConfig, profile),
      guardrails: new Guardrails(driveConfig.guardrails),
      usage: new UsageTracker(),
      profile,
      approver: evalApprover(options.cloudApproved),
      onEvent: (e) => events.push(e),
      persistRule: () => false,
      vaultContext,
    });
    try {
      await agent.run(prompt);
    } finally {
      if (context.vaultDir) {
        await closeEngineVaultIndex(context.vaultDir);
        await deleteVaultIndexFile(context.vaultDir).catch(() => false);
      }
    }
    return {
      finalText: lastFinalText(events),
      trace: { ...traceFrom(events, tools), ...vaultTraceFields(events) },
    };
  };
}

/** The variant in words, for the header and the report ('' for none). */
export function describeVariant(variant: EvalVariant): string {
  const parts: string[] = [];
  if (variant.vaultPack) parts.push(`vault pack ${variant.vaultPack}`);
  if (variant.numCtx) parts.push(`num_ctx ${variant.numCtx}`);
  if (variant.promptCache) parts.push(`prompt cache ${variant.promptCache}`);
  if (variant.handoff) parts.push(`handoff ${variant.handoff}`);
  return parts.join(', ');
}

// A plain `node ...` invocation and nothing else: no chaining, no redirection
// (an arrow function's `=>` is fine, a bare `>` is not), no substitution, no
// climbing out of the workspace. The same trust the verify step already
// extends by running the task's own check with node.
function plainNodeCommand(summary: string): boolean {
  if (!/^Run: node(\s|$)/.test(summary)) return false;
  const cmd = summary.slice('Run: '.length);
  if (/[;&|`<]|\$\(/.test(cmd)) return false;
  if (/(^|[^=])>/.test(cmd)) return false;
  return !cmd.includes('..');
}

/** The deep eval's approver. Reads, edits, and web fetches run; a plain node
 *  invocation runs, because a coding agent asked what code returns should
 *  run it rather than reason about it (tenet 3, and the seat's arithmetic is
 *  not the harness's to fix); everything else (any other shell, push) is
 *  refused so the benchmark stays hermetic; cloud spend only on a reference
 *  run approved up front. */
export function evalApprover(cloudApproved: () => boolean): Approver {
  return async (req) => {
    if (req.risk === 'read' || req.risk === 'write' || req.risk === 'network') {
      return { approve: true };
    }
    if (req.kind === 'tool' && req.toolName === 'runShell' && plainNodeCommand(req.summary)) {
      return { approve: true };
    }
    if (req.kind === 'cloud-spend' && cloudApproved()) return { approve: true };
    return {
      approve: false,
      reason:
        'osc eval --deep runs hermetically: no shell beyond a plain node command in the workspace, no push, and no cloud spend beyond a reference run you approved up front',
    };
  };
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
  const verifies = events.filter((e) => e.type === 'verify') as Array<{ passed: boolean }>;
  const attempts = events.filter((e) => e.type === 'attempt').length + 1;
  return {
    attempts: attempts > 1 ? attempts : undefined,
    turns,
    toolCalls,
    wrote,
    doneReason: done?.reason,
    message: done?.message,
    toolFailures: toolFailures.length ? toolFailures : undefined,
    verify: verifies.length
      ? { rounds: verifies.length, passed: verifies[verifies.length - 1]!.passed }
      : undefined,
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
  const verify = trace.verify
    ? `verify ${trace.verify.passed ? 'passed' : 'failed'} after ${trace.verify.rounds} check${trace.verify.rounds === 1 ? '' : 's'}`
    : '';
  const attempts = trace.attempts && trace.attempts > 1 ? `${trace.attempts} attempts` : '';
  const summary = [
    `${trace.turns} turn${trace.turns === 1 ? '' : 's'}`,
    attempts,
    tools,
    wrote,
    verify,
    done,
    costLine(trace),
  ]
    .filter(Boolean)
    .join('; ');
  const failureLines = dedupeFailures(trace.toolFailures).map(
    (f) =>
      `\n      ${f.name} failed${f.count > 1 ? ` x${f.count}` : ''}: ${truncate(f.detail, 500)}`,
  );
  return summary + failureLines.join('');
}

/** What a run cost, when the drive measured it (Vault M4, CTO I14): input
 *  tokens sent, the prompt cache's reads and writes (Vault M5, CTO J19), the
 *  pack's share and its notes, and wall time. '' when none. */
export function costLine(trace: DriveTrace): string {
  const parts: string[] = [];
  if (trace.promptTokens !== undefined) parts.push(`${trace.promptTokens} input tokens`);
  if (trace.cacheReadTokens !== undefined || trace.cacheWriteTokens !== undefined) {
    parts.push(`cache read ${trace.cacheReadTokens ?? 0}, written ${trace.cacheWriteTokens ?? 0}`);
  }
  if (trace.packTokens !== undefined) {
    const notes = trace.packNotes?.length ?? 0;
    parts.push(`pack ${trace.packTokens} tokens, ${notes} note${notes === 1 ? '' : 's'}`);
  }
  if (trace.wallMs !== undefined) parts.push(`${(trace.wallMs / 1000).toFixed(1)}s`);
  return parts.join(', ');
}

function renderV2(report: EvalV2Report, kind: 'local' | 'cloud'): void {
  const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;
  const many = report.attempts > 1;
  const variantText = describeVariant(report.variant ?? {});
  out();
  if (variantText) out(t.muted(`  Variant: ${variantText}.`));
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
    // number reads as a diagnosis and not a shrug. A variant run says it for
    // every task: its input tokens and wall time are half of what it measures.
    if (score.trace && (score.best < 1 || variantText)) {
      out(t.muted(`      ${traceLine(score.trace)}`));
    }
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
  out(
    t.muted(
      `  Report saved under ~/.os-code/eval/ (v2-<model>${variantSuffix(report.variant ?? {})}.json).`,
    ),
  );
}
