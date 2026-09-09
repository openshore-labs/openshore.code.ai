// cliAgent (CLI Pairing): hand a coding task to Claude Code or Codex installed
// on this computer, run headless in the workspace, and return what it printed.
// The engine's own path stays the default; this exists for the person who
// already lives in one of those CLIs and wants it as a placeable specialist.
//
// It is a shell run, so it wears risk 'shell' and exposes the exact command
// through commandOf: the approval prompt shows it, prefix rules can scope it,
// and on the headless and remote profiles it always asks. The child inherits
// the workspace cwd only, stdin closed, output capped and secret-redacted like
// runShell. Registered only when the CLI current handed the session a command
// that is actually on PATH.
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { redactSecrets } from '../security/redaction.js';
import { runCommand } from '../exec/commandRunner.js';
import { CURRENTS_LIMITS, type CliAgentCommand } from '../../currents/model.js';

const schema = z.object({
  task: z
    .string()
    .min(1)
    .max(CURRENTS_LIMITS.askChars)
    .describe(
      'The complete coding task for the paired CLI, in plain words, with any context it needs.',
    ),
  timeoutSeconds: z
    .number()
    .int()
    .min(30)
    .max(1800)
    .optional()
    .describe('Kill after this many seconds (default 600).'),
});

/** The exact headless invocation per CLI. Single-quoted so the task is one
 *  argument; a single quote inside it is escaped the POSIX way. */
export function cliCommandLine(command: CliAgentCommand, task: string): string {
  const quoted = `'${task.replace(/'/g, `'\\''`)}'`;
  if (command === 'claude') return `claude -p ${quoted} --output-format text`;
  return `codex exec ${quoted}`;
}

export const cliAgentTool: ToolDef<typeof schema> = {
  name: 'cliAgent',
  description:
    'Hand a coding task to the coding CLI the person paired on this computer (Claude Code or Codex), run headless in the workspace root, and return its output. Use it when the person asked for that CLI, or for a self-contained coding subtask it is well suited to. It edits files under its own rules inside this workspace; review its changes with gitDiff afterwards.',
  schema,
  risk: 'shell',
  async preview(args, ctx) {
    const cli = ctx.currents?.cli?.command ?? 'claude';
    return {
      summary: `Run ${cli === 'claude' ? 'Claude Code' : 'Codex'}: ${args.task.slice(0, 80)}`,
      detail: `Command: ${cliCommandLine(cli, args.task.slice(0, 200))}\nWorking directory: workspace root. Timeout: ${args.timeoutSeconds ?? 600}s.`,
    };
  },
  async execute(args, ctx) {
    const cli = ctx.currents?.cli?.command;
    if (!cli) {
      return {
        ok: false,
        content:
          'No coding CLI is paired on this session. Ask the person to turn on CLI Pairing in Settings on a computer with Claude Code or Codex installed.',
      };
    }
    const timeoutSeconds = args.timeoutSeconds ?? 600;
    const result = await runCommand({
      command: cliCommandLine(cli, args.task),
      cwd: ctx.cwd,
      stdin: 'ignore',
      timeoutMs: timeoutSeconds * 1000,
    }).done;
    if (result.startError) {
      return { ok: false, content: `Could not start ${cli}: ${result.startError}` };
    }
    if (result.timedOut) {
      return {
        ok: false,
        content: redactSecrets(
          `${cli} timed out after ${timeoutSeconds}s and was killed.\noutput so far:\n${capContent(result.stdout, 8000)}\n${capContent(result.stderr, 4000)}`,
        ),
      };
    }
    const out = result.stdout.trim();
    const err = result.stderr.trim();
    const body = [
      `${cli} exit code: ${result.exitCode}`,
      out ? `output:\n${capContent(out, 16000)}` : 'output: (empty)',
      err ? `stderr:\n${capContent(err, 6000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { ok: result.exitCode === 0, content: redactSecrets(body) };
  },
};
