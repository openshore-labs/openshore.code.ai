// Let the agent read the user's interactive terminal (the Phase 2 PTY bridge)
// with no screenshot. "Look at my terminal and fix the error" resolves to the
// last N lines of the live terminal's ring buffer, with ANSI control sequences
// stripped, secrets redacted, and the length capped for the model's context.
//
// This tool READS only. There is deliberately no writeTerminal counterpart:
// injecting keystrokes into a live user shell must never be silent, so the
// agent drives the shell through the approval-gated runShell lane, never here.
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { redactSecrets } from '../security/redaction.js';

// Strip ANSI escape sequences (colors, cursor addressing) so the model reads
// clean text, matching how the phone's command card cleans its output.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const schema = z.object({
  lines: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe('How many trailing lines of the terminal to read. Defaults to 200.'),
  termId: z
    .string()
    .optional()
    .describe('A specific terminal id. Omit to read the most recent terminal on this session.'),
});

/** Clean the raw terminal tail for the model: strip ANSI, redact, cap. Exposed
 *  so the transform is testable on its own with a known buffer. */
export function cleanTerminalOutput(raw: string): string {
  return capContent(redactSecrets(raw.replace(ANSI, '')), 8000);
}

export const readTerminalTool: ToolDef<typeof schema> = {
  name: 'readTerminal',
  description:
    'Read the recent output of the interactive terminal the user has open on this machine (the last lines they see), so you can diagnose an error or check a result without a screenshot. Read-only: you cannot type into the terminal.',
  schema,
  risk: 'read',
  async execute(args, ctx) {
    if (!ctx.terminal) {
      return {
        ok: false,
        content:
          'There is no interactive terminal on this session. Ask the user to open the terminal, or run a command through the command lane instead.',
      };
    }
    const raw = ctx.terminal(args.lines ?? 200, args.termId);
    if (raw === undefined) {
      return {
        ok: false,
        content:
          'No terminal is open on this session yet. Ask the user to open the terminal panel first.',
      };
    }
    const cleaned = cleanTerminalOutput(raw);
    if (!cleaned.trim()) {
      return { ok: true, content: 'The terminal is open but has produced no output yet.' };
    }
    return { ok: true, content: cleaned };
  },
};
