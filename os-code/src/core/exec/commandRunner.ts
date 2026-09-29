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
import { scrubbedEnv } from './childEnv.js';
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
          env: scrubbedEnv(process.env, opts.keepEnv),
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
    const merged = redactSecrets(state.carry + raw);
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
    if (pid === undefined || this.settled) return;
    this.stopSignal ??= 'SIGTERM';
    killProcessTree(pid, 'SIGTERM');
    const grace = this.opts.killGraceMs ?? 3000;
    this.killTimer = setTimeout(() => {
      if (this.settled) return;
      this.stopSignal = 'SIGKILL';
      killProcessTree(pid, 'SIGKILL');
    }, grace);
  }
}

export function runCommand(opts: CommandRunOptions): CommandRun {
  return new CommandRun(opts);
}
