// The one place a shell command is spawned. Both lanes share it: the agent's
// runShell tool (buffered, capped, timed out) and the user-initiated command
// lane the phone drives (streamed live, stdin-writable, killed on demand). It
// spawns `/bin/bash -c` in its own process group so a kill takes the whole
// tree, streams stdout and stderr as they arrive (each chunk secret-redacted
// before it leaves the runner), and resolves with the full redacted output.
// The child starts with a scrubbed environment (childEnv.ts), so a command the
// model wrote cannot read a provider key OpenShore's own process holds. On
// Windows, where /bin/bash does not exist, the shell is resolved (shell.ts):
// Git for Windows' bash when it is installed, else PowerShell.
import { spawn, type ChildProcess } from 'node:child_process';
import { redactSecrets } from '../security/redaction.js';
import { isSecretEnvName, scrubbedEnv } from './childEnv.js';
import { killProcessTree, shellForThisMachine } from './shell.js';

export interface CommandRunOptions {
  command: string;
  cwd: string;
  /** Live output, already secret-redacted. Called once per stdout/stderr chunk. */
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void;
  /** Kill after this many ms. Omit or 0 for no timeout (explicit kill only). */
  timeoutMs?: number;
  /** Grace between SIGTERM and SIGKILL on a kill. Default 3000ms. */
  killGraceMs?: number;
  /**
   * stdin handling. 'pipe' (default) lets the caller answer prompts via
   * write(); 'ignore' hands the child /dev/null so a command that reads stdin
   * gets immediate EOF instead of blocking. The agent's non-interactive
   * runShell uses 'ignore'; the user command lane uses 'pipe'.
   */
  stdin?: 'pipe' | 'ignore';
  /**
   * Variables the child keeps even though they look like secrets, matched by
   * exact name. Only a paired coding CLI uses it, for its own key; every
   * other command starts with the scrubbed environment.
   */
  keepEnv?: readonly string[];
  /**
   * The project's own environment variables (Project Wayfinder, founder
   * 2026-10-27), set on top of the scrubbed environment. The person typed
   * them for this project, so a secret-looking name passes here; its value is
   * redacted from the output, so the model never reads it back.
   */
  env?: Readonly<Record<string, string>>;
  /**
   * False keeps no copy of the output: onChunk still sees every chunk, and
   * the result's stdout and stderr are empty. For a program that runs for
   * hours (one the agent started with startProcess), whose whole output would
   * otherwise grow without end. Default true.
   */
  retain?: boolean;
}

export interface CommandResult {
  /** The program's own exit code; null when a signal ended it, or when this
   *  runner stopped it (kill() or the timeout), on every system. */
  exitCode: number | null;
  /** The signal that ended it, or the one the runner sent to stop it. */
  signal: NodeJS.Signals | null;
  /** Full stdout, secret-redacted. */
  stdout: string;
  /** Full stderr, secret-redacted. */
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be spawned at all. */
  startError?: string;
}

/**
 * Chunk-boundary redaction (ENG-10). A secret split across two chunks would
 * pass both per-chunk scans, so the last CARRY_CHARS of every chunk are held
 * back and re-scanned together with the next one. The hold is flushed after a
 * short silence so an interactive prompt ("Continue? ") that never gets a
 * next chunk still reaches the person, and again on exit.
 */
const CARRY_CHARS = 64;
const CARRY_FLUSH_MS = 200;

/**
 * Windows ends a tree with `taskkill /T`, which sees only the processes that
 * exist at that instant. A Stop in the first moment of a run lands while the
 * shell is still starting the program, and a program started a moment later
 * escapes: it keeps running and holds the output open, so the run never ends.
 * So on Windows a Stop that early waits until the run is this old, and then
 * ends the whole tree. POSIX signals the process group, which catches a
 * program whenever it starts.
 */
export const WINDOWS_TREE_SETTLE_MS = 750;

/** How long a Stop waits before the tree is ended: on Windows, until the run
 *  has had time to start what it runs; elsewhere, not at all. */
export function stopDelayMs(elapsedMs: number, platform: NodeJS.Platform): number {
  if (platform !== 'win32') return 0;
  return Math.max(0, WINDOWS_TREE_SETTLE_MS - elapsedMs);
}

/** After a stopped run's own process has exited, how long its output may stay
 *  open (a stray process it started still holding it) before the run ends
 *  anyway, so a card never waits on a Stop that already happened. */
export const STOPPED_OUTPUT_WAIT_MS = 2_000;

type StreamName = 'stdout' | 'stderr';

interface StreamState {
  carry: string;
  timer?: ReturnType<typeof setTimeout>;
}

/** A running command: write to its stdin, kill it, or await its result. */
export class CommandRun {
  private child?: ChildProcess;
  private stdout = '';
  private stderr = '';
  private timedOut = false;
  private settled = false;
  private timer?: ReturnType<typeof setTimeout>;
  private killTimer?: ReturnType<typeof setTimeout>;
  private stopTimer?: ReturnType<typeof setTimeout>;
  private exitWait?: ReturnType<typeof setTimeout>;
  private readonly startedAt = Date.now();
  /** The last signal kill() sent, once it has been asked to stop the run. */
  private stopSignal?: NodeJS.Signals;
  private readonly streams: Record<StreamName, StreamState> = {
    stdout: { carry: '' },
    stderr: { carry: '' },
  };
  readonly done: Promise<CommandResult>;

  constructor(private readonly opts: CommandRunOptions) {
    this.done = new Promise<CommandResult>((resolve) => {
      let child: ChildProcess;
      try {
        const shell = shellForThisMachine();
        const windows = process.platform === 'win32';
        child = spawn(shell.file, shell.args(opts.command), {
          cwd: opts.cwd,
          env: { ...scrubbedEnv(process.env, opts.keepEnv), ...opts.env },
          // Its own process group on POSIX, so a kill reaches the tree. On
          // Windows a detached child would open its own console window, and
          // the tree kill (taskkill /T) does not need a group.
          detached: !windows,
          windowsHide: true,
          stdio: [opts.stdin ?? 'pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        resolve({
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          startError: (err as Error).message,
        });
        return;
      }
      this.child = child;

      const settle = (result: Omit<CommandResult, 'stdout' | 'stderr'>): void => {
        if (this.settled) return;
        this.settled = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.killTimer) clearTimeout(this.killTimer);
        if (this.stopTimer) clearTimeout(this.stopTimer);
        if (this.exitWait) clearTimeout(this.exitWait);
        // Every data event has fired by now: release the held tails.
        this.flush('stdout');
        this.flush('stderr');
        resolve({ ...result, stdout: this.stdout, stderr: this.stderr });
      };

      if (opts.timeoutMs && opts.timeoutMs > 0) {
        this.timer = setTimeout(() => {
          this.timedOut = true;
          this.kill();
        }, opts.timeoutMs);
      }

      child.stdout?.on('data', (d: Buffer) => this.ingest('stdout', d.toString()));
      child.stderr?.on('data', (d: Buffer) => this.ingest('stderr', d.toString()));
      child.on('error', (e) => {
        settle({
          exitCode: null,
          signal: null,
          timedOut: this.timedOut,
          startError: e.message,
        });
      });
      // A stopped run ends when its own process has exited, even if a stray
      // process it started still holds the output: the output is closed, and
      // what was said so far is kept.
      child.on('exit', () => {
        if (!this.stopSignal || this.settled) return;
        this.exitWait = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          settle({ exitCode: null, signal: this.stopSignal ?? null, timedOut: this.timedOut });
        }, STOPPED_OUTPUT_WAIT_MS);
      });
      child.on('close', (code, signal) => {
        // A run this runner stopped resolves as stopped on every system: no
        // exit code, and the signal that ended it. POSIX ends the tree with a
        // signal, but Windows ends it with taskkill /F, which leaves exit code
        // 1 as though the program had failed; and a program that catches the
        // signal and exits on its own was still stopped, not finished.
        if (this.stopSignal) {
          settle({ exitCode: null, signal: signal ?? this.stopSignal, timedOut: this.timedOut });
        } else {
          settle({ exitCode: code, signal, timedOut: this.timedOut });
        }
      });
    });
  }

  /** Scan the held tail together with the new chunk, deliver all but the new
   *  tail, and arm the silence flush for what is held. */
  private ingest(stream: StreamName, raw: string): void {
    const state = this.streams[stream];
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const merged = redactProjectEnv(redactSecrets(state.carry + raw), this.opts.env);
    const hold = Math.min(CARRY_CHARS, merged.length);
    const ready = merged.slice(0, merged.length - hold);
    state.carry = merged.slice(merged.length - hold);
    if (ready) this.deliver(stream, ready);
    if (state.carry) state.timer = setTimeout(() => this.flush(stream), CARRY_FLUSH_MS);
  }

  /** Deliver whatever is held for the stream, now. */
  private flush(stream: StreamName): void {
    const state = this.streams[stream];
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    if (!state.carry) return;
    const text = state.carry;
    state.carry = '';
    this.deliver(stream, text);
  }

  private deliver(stream: StreamName, text: string): void {
    if (this.opts.retain !== false) {
      if (stream === 'stdout') this.stdout += text;
      else this.stderr += text;
    }
    this.opts.onChunk?.(stream, text);
  }

  /** Feed the process stdin (answers a y/N or a prompt). No-op once settled. */
  write(data: string): void {
    if (this.settled) return;
    this.child?.stdin?.write(data);
  }

  /** Ask the process tree to stop: SIGTERM, then SIGKILL after the grace. */
  kill(): void {
    const pid = this.child?.pid;
    if (pid === undefined || this.settled || this.stopTimer || this.killTimer) return;
    this.stopSignal ??= 'SIGTERM';
    const end = () => {
      this.stopTimer = undefined;
      if (this.settled) return;
      killProcessTree(pid, 'SIGTERM');
      const grace = this.opts.killGraceMs ?? 3000;
      this.killTimer = setTimeout(() => {
        if (this.settled) return;
        this.stopSignal = 'SIGKILL';
        killProcessTree(pid, 'SIGKILL');
      }, grace);
    };
    const wait = stopDelayMs(Date.now() - this.startedAt, process.platform);
    if (wait > 0) this.stopTimer = setTimeout(end, wait);
    else end();
  }
}

/** The values of a project's secret-looking variables, cut from a command's
 *  output (a value of four characters or fewer is left, it would only cut
 *  ordinary words). A value split across two chunks wider than the held tail
 *  can still slip through; the variable's name is what the model should use. */
export function redactProjectEnv(
  text: string,
  env: Readonly<Record<string, string>> | undefined,
): string {
  if (!env) return text;
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    if (value.length > 4 && isSecretEnvName(name)) out = out.split(value).join(`[${name}]`);
  }
  return out;
}

export function runCommand(opts: CommandRunOptions): CommandRun {
  return new CommandRun(opts);
}
