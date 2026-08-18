// runShell: default-deny with explicit approval. The approval prompt shows
// the EXACT command. Output is size-capped and secret-redacted before the
// model sees it, and a timeout kills the whole process group so nothing is
// left running unattended.
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { redactSecrets } from '../security/redaction.js';

const schema = z.object({
  command: z.string().describe('The shell command to run (bash -c)'),
  timeoutSeconds: z.number().int().min(1).max(600).optional().describe('Kill after this many seconds (default 120)'),
});

export const runShellTool: ToolDef<typeof schema> = {
  name: 'runShell',
  description:
    'Run a shell command in the workspace root and return stdout and stderr. Use for builds, tests, and anything the other tools do not cover.',
  schema,
  risk: 'shell',
  async preview(args) {
    return { summary: `Run: ${args.command}`, detail: `Working directory: workspace root. Timeout: ${args.timeoutSeconds ?? 120}s.` };
  },
  async execute(args, ctx) {
    const timeoutMs = (args.timeoutSeconds ?? 120) * 1000;
    return await new Promise((resolve) => {
      const child = spawn('/bin/bash', ['-c', args.command], {
        cwd: ctx.cwd,
        detached: true, // its own process group, so the timeout can kill the tree
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {}
        resolve({
          ok: false,
          content: redactSecrets(
            `Command timed out after ${timeoutMs / 1000}s and was killed.\nstdout so far:\n${capContent(out, 8000)}\nstderr so far:\n${capContent(err, 4000)}`,
          ),
        });
      }, timeoutMs);

      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ ok: false, content: `Could not start the command: ${e.message}` });
      });
      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const body = [
          `exit code: ${code}`,
          out.trim() ? `stdout:\n${capContent(out.trim(), 16000)}` : 'stdout: (empty)',
          err.trim() ? `stderr:\n${capContent(err.trim(), 8000)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        resolve({ ok: code === 0, content: redactSecrets(body) });
      });
    });
  },
};
