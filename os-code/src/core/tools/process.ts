// startProcess, readProcess, stopProcess: "run my app" (build 2026-09-29,
// P1). A dev server or a watcher never exits on its own, so runShell waits out
// its timeout and then kills it. These start a command that keeps running on
// the session's command lane (the same card, with Stop, the person's own
// commands get), read the tail of its output later, and stop it. Starting one
// is a shell step: it asks like runShell, and under the secrets lockdown every
// time. Reading and stopping reach only the processes this agent started, so
// they never ask.
import { z } from 'zod';
import { capContent, type ProcessView, type ToolContext, type ToolDef } from './index.js';

/** Config's switch for these tools: unset reads on (a hand-built config
 *  without the key included); only 'off' turns them off. */
export function processesOn(config: { tools?: { processes?: 'on' | 'off' } }): boolean {
  return config.tools?.processes !== 'off';
}

/** What a session without a process host says (a bare context, a test). */
const NOT_HERE =
  'Starting a program that keeps running is not available in this session. Use runShell for a command that finishes on its own.';

const DEFAULT_READY_SECONDS = 10;
const START_LINES = 40;
const DEFAULT_READ_LINES = 50;
/** The most output one observation carries; the loop also fits it to the
 *  seat's window. */
const OUTPUT_CAP_CHARS = 12_000;

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusOf(view: ProcessView): string {
  if (view.startError) return `could not start: ${view.startError}`;
  if (view.running) return `running for ${duration(view.elapsedMs)}`;
  if (view.exitCode === null || view.exitCode === undefined) {
    return `stopped after ${duration(view.elapsedMs)}`;
  }
  return `exited with code ${view.exitCode} after ${duration(view.elapsedMs)}`;
}

/** The observation for one process: what it is, how it is, where it
 *  serves, and its latest output. */
function report(view: ProcessView): string {
  const lines = [`Process ${view.runId} (\`${view.command}\`): ${statusOf(view)}.`];
  if (view.addresses.length) lines.push(`Address: ${view.addresses.join(', ')}`);
  lines.push(
    view.output.trim()
      ? `Latest output${view.dropped ? ' (earlier output was dropped)' : ''}:\n${capContent(view.output, OUTPUT_CAP_CHARS)}`
      : 'No output yet.',
  );
  return lines.join('\n');
}

/** The agent's live processes, for a refusal to name. */
function liveList(ctx: ToolContext): string {
  const live = ctx.processes?.live() ?? [];
  if (!live.length) return 'None of the processes you started is running.';
  return `Running now: ${live.map((p) => `${p.runId} (\`${p.command}\`)`).join(', ')}.`;
}

const startSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe('The command that keeps running, such as npm run dev or python3 -m http.server'),
  readySeconds: z
    .number()
    .int()
    .min(0)
    .max(30)
    .optional()
    .describe(
      'Wait up to this many seconds for it to start before reading its output (default 10, at most 30). It returns sooner once the program prints a local address or exits.',
    ),
});

export const startProcessTool: ToolDef<typeof startSchema> = {
  name: 'startProcess',
  description:
    'Start a program that keeps running, such as a dev server or a file watcher, in the workspace root, and leave it running. Returns its process id, the local address it serves at when it prints one, and its first output. Use this instead of runShell for anything that does not finish on its own. At most three at a time; stop one with stopProcess.',
  schema: startSchema,
  risk: 'shell',
  commandOf: (args) => args.command,
  async preview(args) {
    return {
      summary: `Start: ${args.command}`,
      detail:
        'Working directory: workspace root. It keeps running after this step until it is stopped, from its card or by OpenShore.',
    };
  },
  async execute(args, ctx) {
    const host = ctx.processes;
    if (!host) return { ok: false, content: NOT_HERE };
    const started = host.start(args.command);
    if ('error' in started) return { ok: false, content: started.error };
    const readyMs = (args.readySeconds ?? DEFAULT_READY_SECONDS) * 1000;
    await host.settle(started.runId, readyMs, ctx.signal);
    const view = host.read(started.runId, START_LINES);
    if (!view) return { ok: false, content: `Process ${started.runId} could not be read.` };
    const body = report(view);
    if (view.running) {
      return {
        ok: true,
        content: `${body}\nIt keeps running. Read more of its output with readProcess and stop it with stopProcess when it is no longer needed.`,
      };
    }
    // It ended within the wait: a program that finished cleanly was a
    // one-shot command, and one that failed says why in its output.
    const clean = !view.startError && view.exitCode === 0;
    return {
      ok: clean,
      content: clean
        ? `${body}\nIt finished on its own, so nothing is left running. For a command that ends by itself, runShell is the tool.`
        : `${body}\nIt is not running.`,
    };
  },
};

const readSchema = z.object({
  runId: z.string().min(1).describe('The process id startProcess returned'),
  lines: z
    .number()
    .int()
    .min(1)
    .max(400)
    .optional()
    .describe('How many of the latest output lines to read (default 50)'),
});

export const readProcessTool: ToolDef<typeof readSchema> = {
  name: 'readProcess',
  description:
    'Read the latest output of a program you started with startProcess, and whether it is still running. Only processes you started in this chat.',
  schema: readSchema,
  risk: 'read',
  async execute(args, ctx) {
    const host = ctx.processes;
    if (!host) return { ok: false, content: NOT_HERE };
    const view = host.read(args.runId, args.lines ?? DEFAULT_READ_LINES);
    if (!view) {
      return {
        ok: false,
        content: `No process ${args.runId} that you started in this chat. ${liveList(ctx)}`,
      };
    }
    return { ok: true, content: report(view) };
  },
};

const stopSchema = z.object({
  runId: z.string().min(1).describe('The process id startProcess returned'),
});

export const stopProcessTool: ToolDef<typeof stopSchema> = {
  name: 'stopProcess',
  description:
    'Stop a program you started with startProcess, and everything it started. Only processes you started in this chat.',
  schema: stopSchema,
  // It ends only what this agent itself started, the undo of its own step,
  // so it runs without asking (the read class's default).
  risk: 'read',
  async execute(args, ctx) {
    const host = ctx.processes;
    if (!host) return { ok: false, content: NOT_HERE };
    const view = host.read(args.runId, 1);
    if (!view) {
      return {
        ok: false,
        content: `No process ${args.runId} that you started in this chat. ${liveList(ctx)}`,
      };
    }
    if (!host.stop(args.runId)) {
      return { ok: true, content: `Process ${args.runId} (\`${view.command}\`) is not running.` };
    }
    return { ok: true, content: `Stopped process ${args.runId} (\`${view.command}\`).` };
  },
};

/** The three, in the order they register (after gitCommit). */
export const PROCESS_TOOLS = [startProcessTool, readProcessTool, stopProcessTool] as const;
