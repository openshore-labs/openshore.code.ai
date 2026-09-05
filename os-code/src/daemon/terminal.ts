// The interactive PTY host (Phase 2 of the chat-to-terminal bridge). A
// TerminalManager owns one or more real pseudo-terminals per session, each a
// full login shell with colors, cursor addressing, and stdin, so the phone can
// drive a live terminal over the daemon exactly like a desktop one.
//
// Two properties shape the design:
//
//   - PTYs OUTLIVE client connections. A dropped phone does not kill the shell;
//     a long build keeps running and the phone reattaches to it. This is the
//     tmux property the founder wanted, without a second auth surface.
//   - Reattach is OFFSET-BASED, not journal-based. Raw terminal bytes are ANSI
//     control streams that cannot be redacted line-wise and must never enter the
//     sealed event journal (that is the runShell/command lane's job). Instead
//     each terminal keeps a ring buffer of its recent raw output with ABSOLUTE
//     byte offsets, and a reattaching client replays from the last offset it saw.
//
// The actual PTY spawn sits behind an injectable factory so the manager is
// fully testable without the native node-pty module: tests inject a fake pty
// that emits data and accepts writes. The default factory lazy-imports node-pty
// and, when it is absent, throws TerminalUnavailable so the routes answer a
// clean error instead of crashing the daemon.
import { randomUUID } from 'node:crypto';

/** The narrow slice of a pty the manager drives. node-pty's IPty satisfies it,
 *  and so does the fake pty the tests inject. */
export interface TerminalPty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (info: { exitCode: number }) => void): void;
}

export interface PtySpawnOptions {
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}

/** Spawns a pty. The default lazy-imports node-pty; tests inject a fake. */
export type PtyFactory = (opts: PtySpawnOptions) => Promise<TerminalPty>;

/** Thrown when the pty backend (node-pty) is not installed on this machine. The
 *  routes translate it into a 503-style JSON error rather than a crash. */
export class TerminalUnavailable extends Error {
  constructor() {
    super('Terminal support is not installed on this machine.');
    this.name = 'TerminalUnavailable';
  }
}

/**
 * A fixed-size window over a byte stream, addressed by ABSOLUTE offsets. Bytes
 * are appended as the pty produces them; once the window is full the oldest
 * bytes fall off the front and the base offset advances. A client that saw up
 * to offset N asks for everything since N: if N is still inside the window it
 * gets the exact tail, and if it fell behind (N is older than the base) it gets
 * the whole window, never a crash and never a gap it cannot detect (the end
 * offset always advances past what it receives).
 */
export class RingBuffer {
  private buf: Buffer = Buffer.alloc(0);
  // Absolute offset of buf[0]: how many bytes have already scrolled off.
  private base = 0;

  constructor(private readonly cap: number) {}

  /** Absolute offset one past the last byte held (total bytes ever appended). */
  get end(): number {
    return this.base + this.buf.length;
  }

  append(data: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    if (this.buf.length > this.cap) {
      const drop = this.buf.length - this.cap;
      this.buf = this.buf.subarray(drop);
      this.base += drop;
    }
  }

  /** Bytes from absolute offset `since` to the current end, clamped to whatever
   *  is still retained, plus the new end offset for the caller to remember. */
  since(since: number): { data: Buffer; endOffset: number } {
    const from = Math.max(since, this.base);
    const rel = from - this.base;
    const data = rel >= this.buf.length ? Buffer.alloc(0) : this.buf.subarray(rel);
    return { data, endOffset: this.end };
  }

  /** The last `bytes` bytes still retained (for the readTerminal tool). */
  tail(bytes: number): Buffer {
    return bytes >= this.buf.length ? this.buf : this.buf.subarray(this.buf.length - bytes);
  }
}

/** Told once when the shell exits: the exit code and the ring's end offset, so
 *  a client can tell whether it saw every byte before the end (DAE-5). */
export type ExitListener = (exitCode: number, endOffset: number) => void;

interface TerminalEntry {
  termId: string;
  sessionId: string;
  pty: TerminalPty;
  ring: RingBuffer;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode?: number;
  listeners: Set<(data: Buffer, endOffset: number) => void>;
  exitListeners: Set<ExitListener>;
  dropTimer?: NodeJS.Timeout;
}

const DEFAULT_RING_BYTES = 200 * 1024;
// How long an exited terminal stays addressable, so a client that was
// disconnected at the moment of exit can still replay the tail and read the
// exit frame; after that the entry is dropped and the routes answer 404.
const DEFAULT_EXIT_GRACE_MS = 30_000;

function clampDim(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(1000, Math.floor(value)));
}

/**
 * Owns the live PTYs for the daemon, keyed by termId, grouped by session so the
 * agent's readTerminal tool can find "this session's terminal" without a
 * screenshot. The spawn is injected (default lazy node-pty) so every path here
 * unit-tests with a fake pty.
 */
export class TerminalManager {
  private terminals = new Map<string, TerminalEntry>();
  // sessionId -> its termIds in creation order (the last is the most recent).
  private bySession = new Map<string, string[]>();
  private readonly spawnFactory: PtyFactory;
  private readonly ringCap: number;
  private readonly exitGraceMs: number;

  constructor(opts: { spawn?: PtyFactory; ringBytes?: number; exitGraceMs?: number } = {}) {
    this.spawnFactory = opts.spawn ?? lazyNodePtyFactory;
    this.ringCap = opts.ringBytes ?? DEFAULT_RING_BYTES;
    this.exitGraceMs = opts.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS;
  }

  /** The entry for termId, and only when it belongs to sessionId if one is
   *  given: a terminal is addressable through its own session's routes alone
   *  (DAE-14), so the audit markers land on the right journal. */
  private lookup(termId: string, sessionId?: string): TerminalEntry | undefined {
    const entry = this.terminals.get(termId);
    if (!entry) return undefined;
    if (sessionId !== undefined && entry.sessionId !== sessionId) return undefined;
    return entry;
  }

  private drop(entry: TerminalEntry): void {
    if (entry.dropTimer) clearTimeout(entry.dropTimer);
    entry.dropTimer = undefined;
    this.terminals.delete(entry.termId);
    const list = this.bySession.get(entry.sessionId);
    if (list)
      this.bySession.set(
        entry.sessionId,
        list.filter((t) => t !== entry.termId),
      );
  }

  /**
   * Create a terminal, or return an existing one by termId (resizing it to the
   * caller's viewport). Throws TerminalUnavailable when node-pty is absent, so
   * the route can answer a clean 503 instead of crashing.
   */
  async ensure(opts: {
    sessionId: string;
    termId?: string;
    cols?: number;
    rows?: number;
    cwd: string;
    shell?: string;
  }): Promise<{ termId: string; cols: number; rows: number }> {
    const cols = clampDim(opts.cols, 80);
    const rows = clampDim(opts.rows, 24);

    if (opts.termId) {
      const existing = this.terminals.get(opts.termId);
      if (existing && !existing.exited) {
        this.resize(opts.termId, cols, rows);
        return { termId: existing.termId, cols: existing.cols, rows: existing.rows };
      }
    }

    const termId = opts.termId ?? randomUUID().slice(0, 8);
    const shell = opts.shell || process.env.SHELL || '/bin/bash';
    const pty = await this.spawnFactory({ shell, cwd: opts.cwd, cols, rows, env: process.env });

    const entry: TerminalEntry = {
      termId,
      sessionId: opts.sessionId,
      pty,
      ring: new RingBuffer(this.ringCap),
      cols,
      rows,
      exited: false,
      listeners: new Set(),
      exitListeners: new Set(),
    };
    pty.onData((data) => {
      const buf = Buffer.from(data, 'utf8');
      entry.ring.append(buf);
      const endOffset = entry.ring.end;
      for (const listener of entry.listeners) listener(buf, endOffset);
    });
    pty.onExit((info) => {
      if (entry.exited) return;
      entry.exited = true;
      entry.exitCode = info.exitCode;
      // Tell every attached stream, then keep the entry for a grace so a
      // client that reattaches right after still gets the tail and the frame.
      for (const listener of entry.exitListeners) listener(info.exitCode, entry.ring.end);
      entry.exitListeners.clear();
      entry.dropTimer = setTimeout(() => this.drop(entry), this.exitGraceMs);
      entry.dropTimer.unref?.();
    });

    this.terminals.set(termId, entry);
    const list = this.bySession.get(opts.sessionId) ?? [];
    list.push(termId);
    this.bySession.set(opts.sessionId, list);
    return { termId, cols, rows };
  }

  has(termId: string, sessionId?: string): boolean {
    return this.lookup(termId, sessionId) !== undefined;
  }

  /** True when the terminal exists but its shell has exited (DAE-5): the
   *  routes answer 409 "exited" rather than 404 "no terminal". */
  isExited(termId: string, sessionId?: string): boolean {
    return this.lookup(termId, sessionId)?.exited === true;
  }

  /**
   * Replay the ring buffer from `sinceOffset`, then stream live output. Returns
   * an unsubscribe function, or undefined when there is no such terminal. Each
   * call to onChunk carries the raw bytes and the new absolute end offset. The
   * optional onExit fires once with the exit code and end offset; on a shell
   * that already exited it fires right after the replay, so a stream opened on
   * a dead shell ends instead of looking frozen.
   */
  subscribe(
    termId: string,
    sinceOffset: number,
    onChunk: (data: Buffer, endOffset: number) => void,
    onExit?: ExitListener,
    sessionId?: string,
  ): (() => void) | undefined {
    const entry = this.lookup(termId, sessionId);
    if (!entry) return undefined;
    const replay = entry.ring.since(sinceOffset);
    if (replay.data.length) onChunk(replay.data, replay.endOffset);
    if (entry.exited) {
      onExit?.(entry.exitCode ?? 0, entry.ring.end);
      return () => {};
    }
    entry.listeners.add(onChunk);
    if (onExit) entry.exitListeners.add(onExit);
    return () => {
      entry.listeners.delete(onChunk);
      if (onExit) entry.exitListeners.delete(onExit);
    };
  }

  /** Feed keystrokes to a terminal. Never journaled or logged: sudo passwords
   *  and other secrets flow through here. */
  write(termId: string, data: string, sessionId?: string): boolean {
    const entry = this.lookup(termId, sessionId);
    if (!entry || entry.exited) return false;
    entry.pty.write(data);
    return true;
  }

  resize(termId: string, cols: number, rows: number, sessionId?: string): boolean {
    const entry = this.lookup(termId, sessionId);
    if (!entry || entry.exited) return false;
    entry.cols = clampDim(cols, entry.cols);
    entry.rows = clampDim(rows, entry.rows);
    try {
      entry.pty.resize(entry.cols, entry.rows);
    } catch {}
    return true;
  }

  kill(termId: string, sessionId?: string): boolean {
    const entry = this.lookup(termId, sessionId);
    if (!entry) return false;
    try {
      entry.pty.kill();
    } catch {}
    if (!entry.exited) {
      // The pty did not report an exit synchronously: settle the streams now.
      entry.exited = true;
      for (const listener of entry.exitListeners) listener(entry.exitCode ?? 0, entry.ring.end);
      entry.exitListeners.clear();
    }
    this.drop(entry);
    return true;
  }

  /** Kill every terminal of a session (the session is being deleted). */
  killSession(sessionId: string): number {
    const ids = [...(this.bySession.get(sessionId) ?? [])];
    for (const termId of ids) this.kill(termId, sessionId);
    return ids.length;
  }

  /**
   * Raw last-N-lines of a session's terminal for the readTerminal tool. Returns
   * the bytes still in the ring (ANSI intact); the tool strips ANSI, redacts
   * secrets, and caps the length. undefined when the session has no terminal.
   * A termId targets one terminal; otherwise the session's most recent is used.
   */
  readForSession(sessionId: string, lines: number, termId?: string): string | undefined {
    let entry: TerminalEntry | undefined;
    if (termId) {
      entry = this.terminals.get(termId);
    } else {
      const list = this.bySession.get(sessionId);
      const last = list && list.length ? list[list.length - 1] : undefined;
      entry = last ? this.terminals.get(last) : undefined;
    }
    if (!entry || entry.sessionId !== sessionId) return undefined;
    // Drop one trailing newline so the line count is intuitive (a shell prompt
    // ends output with a newline, which would otherwise read as a blank line).
    const raw = entry.ring.tail(this.ringCap).toString('utf8').replace(/\n$/, '');
    const split = raw.split('\n');
    const wanted = Math.max(1, Math.floor(lines));
    return split.slice(Math.max(0, split.length - wanted)).join('\n');
  }
}

/**
 * The default factory: lazy-import node-pty and adapt its IPty to TerminalPty.
 * node-pty is optional and native, so the import is wrapped: its absence throws
 * TerminalUnavailable, which the routes turn into a clean error. This code path
 * never runs in tests (they inject a fake factory), so the missing module never
 * fails the build or the suite.
 */
const lazyNodePtyFactory: PtyFactory = async (opts) => {
  let mod: typeof import('node-pty');
  try {
    mod = await import('node-pty');
  } catch {
    throw new TerminalUnavailable();
  }
  const proc = mod.spawn(opts.shell, [], {
    name: 'xterm-color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env as { [key: string]: string },
  });
  return {
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    onData: (callback) => proc.onData(callback),
    onExit: (callback) => proc.onExit((event) => callback({ exitCode: event.exitCode })),
  };
};
