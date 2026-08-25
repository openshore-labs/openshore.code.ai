// runShell: default-deny with explicit approval. The approval prompt shows
// the EXACT command. Output is size-capped and secret-redacted before the
// model sees it, and a timeout kills the whole process group so nothing is
// left running unattended.
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { redactSecrets } from '../security/redaction.js';
import { runCommand } from '../exec/commandRunner.js';

const schema = z.object({
  command: z.string().describe('The shell command to run (bash -c)'),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(600)
    .optional()
    .describe('Kill after this many seconds (default 120)'),
});

export const runShellTool: ToolDef<typeof schema> = {
  name: 'runShell',
  description:
    'Run a shell command in the workspace root and return stdout and stderr. Use for builds, tests, and anything the other tools do not cover.',
  schema,
  risk: 'shell',
  async preview(args) {
    return {
      summary: `Run: ${args.command}`,
      detail: `Working directory: workspace root. Timeout: ${args.timeoutSeconds ?? 120}s.`,
    };
  },
  async execute(args, ctx) {
    const timeoutSeconds = args.timeoutSeconds ?? 120;
    // The agent lane is non-interactive: stdin is /dev/null so a command that
    // reads it gets EOF rather than blocking until the timeout. Output arrives
    // via the shared runner (already secret-redacted per chunk); this tool
    // buffers and caps it for the model, exactly as before.
    const result = await runCommand({
      command: args.command,
      cwd: ctx.cwd,
      stdin: 'ignore',
      timeoutMs: timeoutSeconds * 1000,
    }).done;

    if (result.startError) {
      return { ok: false, content: `Could not start the command: ${result.startError}` };
    }
    if (result.timedOut) {
      return {
        ok: false,
        content: redactSecrets(
          `Command timed out after ${timeoutSeconds}s and was killed.\nstdout so far:\n${capContent(result.stdout, 8000)}\nstderr so far:\n${capContent(result.stderr, 4000)}`,
        ),
      };
    }
    const out = result.stdout.trim();
    const err = result.stderr.trim();
    const body = [
      `exit code: ${result.exitCode}`,
      out ? `stdout:\n${capContent(out, 16000)}` : 'stdout: (empty)',
      err ? `stderr:\n${capContent(err, 8000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { ok: result.exitCode === 0, content: redactSecrets(body) };
  },
};
