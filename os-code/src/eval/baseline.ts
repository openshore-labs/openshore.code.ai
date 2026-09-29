// The head-to-head baseline: the same tasks, the same local model, the same
// checkers, driven by Claude Code pointed at the person's own Ollama instead
// of by OpenShore's engine. It answers the one question the everyday suite
// exists for: does OpenShore finish more of these jobs on a small local model
// than setting up Claude Code with Ollama yourself (Ollama's own guide,
// docs.ollama.com/integrations/claude-code). An internal number, never a
// claim in copy on its own (tenet 2).
//
// Fairness: Claude Code gets the same doors the engine's eval approver opens
// (read, edit, write, a plain node command, and moving or copying files in
// the workspace), no more. It runs hermetic: a scratch config folder, so the
// person's own Claude Code settings, hooks, and MCP servers never enter a
// benchmark, and nonessential traffic off. The model reaches Ollama through
// its Anthropic-compatible endpoint, the way the guide sets it up.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriveOutcome, DriveTask, DriveTrace } from './v2.js';

/** The name a baseline run carries on its report and in its file name. */
export const CLAUDE_CODE_BASELINE = 'claude-code';

/** The tools Claude Code may use without asking, matching the eval approver:
 *  reads, edits, writes, a plain node command, and file moves in the folder. */
export const BASELINE_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'MultiEdit',
  'Write',
  'Glob',
  'Grep',
  'LS',
  'Bash(node:*)',
  'Bash(mv:*)',
  'Bash(cp:*)',
  'Bash(mkdir:*)',
  'Bash(ls:*)',
];

const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** Claude Code's version, or undefined when it is not installed here. */
export function claudeCodeVersion(command = 'claude'): string | undefined {
  try {
    const run = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 20_000 });
    if (run.status !== 0) return undefined;
    return run.stdout.trim() || 'installed';
  } catch {
    return undefined;
  }
}

/** Ollama's root for the Anthropic-compatible endpoint: the provider's base
 *  URL without the OpenAI-compatible `/v1` suffix. */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** The environment a baseline run gets: Claude Code pointed at Ollama with
 *  every model slot on the model under test, and a scratch config folder. */
export function baselineEnv(
  base: NodeJS.ProcessEnv,
  options: { ollamaUrl: string; model: string; configDir: string },
): NodeJS.ProcessEnv {
  return {
    ...base,
    ANTHROPIC_BASE_URL: ollamaRoot(options.ollamaUrl),
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: options.model,
    ANTHROPIC_SMALL_FAST_MODEL: options.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: options.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: options.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: options.model,
    CLAUDE_CONFIG_DIR: options.configDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

/** The command line (after `claude`). The prompt goes in on stdin, so the
 *  variadic tool list can never swallow it. */
export function baselineArgs(model: string): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    BASELINE_ALLOWED_TOOLS.join(','),
  ];
}

interface StreamBlock {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

/** Read Claude Code's stream-json output into the eval's outcome: the final
 *  answer, and a trace of turns, tool calls, whether a write landed, and each
 *  failed call's message. Lenient: a line it cannot read is skipped. */
export function parseStreamJson(stdout: string): DriveOutcome {
  const toolCalls: string[] = [];
  const names = new Map<string, string>();
  const failures: Array<{ name: string; detail: string }> = [];
  const failedIds = new Set<string>();
  let finalText = '';
  let turns = 0;
  let doneReason: string | undefined;
  let message: string | undefined;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const content = (obj.message as { content?: unknown } | undefined)?.content;
    const blocks = Array.isArray(content) ? (content as StreamBlock[]) : [];
    if (obj.type === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'tool_use' && block.name) {
          toolCalls.push(block.name);
          if (block.id) names.set(block.id, block.name);
        }
      }
    } else if (obj.type === 'user') {
      for (const block of blocks) {
        if (block.type !== 'tool_result' || !block.is_error || !block.tool_use_id) continue;
        failedIds.add(block.tool_use_id);
        const detail =
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
        failures.push({
          name: names.get(block.tool_use_id) ?? 'tool',
          detail: detail.slice(0, 900),
        });
      }
    } else if (obj.type === 'result') {
      if (typeof obj.result === 'string') finalText = obj.result;
      if (typeof obj.num_turns === 'number') turns = obj.num_turns;
      if (typeof obj.subtype === 'string') doneReason = obj.subtype;
      if (obj.is_error === true && typeof obj.result === 'string')
        message = obj.result.slice(0, 300);
    }
  }
  const wrote = [...names].some(([id, name]) => WRITE_TOOLS.has(name) && !failedIds.has(id));
  const trace: DriveTrace = { turns, toolCalls, wrote };
  if (doneReason) trace.doneReason = doneReason;
  if (message) trace.message = message;
  if (failures.length) trace.toolFailures = failures;
  return { finalText, trace };
}

export interface ClaudeCodeDriveOptions {
  model: string;
  /** The Ollama base URL from the person's provider config. */
  ollamaUrl: string;
  /** Per-task wall clock before the run is stopped (default 30 minutes: a
   *  cold 3B on the CPU-only reference box can spend minutes on prefill). */
  timeoutSeconds?: number;
  /** The command to run (a test hands in a stand-in). */
  command?: string;
}

/** A drive that runs each task through Claude Code against the local model. */
export function claudeCodeDrive(options: ClaudeCodeDriveOptions): DriveTask {
  const timeoutMs = (options.timeoutSeconds ?? 1800) * 1000;
  const command = options.command ?? 'claude';
  return (cwd, prompt) =>
    new Promise<DriveOutcome>((resolve, reject) => {
      const configDir = mkdtempSync(join(tmpdir(), 'osc-eval-claude-'));
      const child = spawn(command, baselineArgs(options.model), {
        cwd,
        env: baselineEnv(process.env, {
          ollamaUrl: options.ollamaUrl,
          model: options.model,
          configDir,
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const cleanup = () => {
        clearTimeout(timer);
        rmSync(configDir, { recursive: true, force: true });
      };
      child.on('error', (err) => {
        cleanup();
        reject(err);
      });
      child.on('close', (code) => {
        cleanup();
        const outcome = parseStreamJson(stdout);
        if (timedOut) {
          outcome.trace = {
            ...(outcome.trace ?? { turns: 0, toolCalls: [], wrote: false }),
            doneReason: 'timeout',
            message: `stopped after ${Math.round(timeoutMs / 60_000)} minutes`,
          };
        } else if (code !== 0 && !outcome.finalText && !outcome.trace?.turns) {
          reject(new Error(`Claude Code exited ${code}: ${stderr.trim().slice(0, 300)}`));
          return;
        }
        resolve(outcome);
      });
      child.stdin.end(prompt);
    });
}
