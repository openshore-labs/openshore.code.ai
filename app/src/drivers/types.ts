// The one driver contract every conversation brain implements: the desktop
// engine over IPC, the desktop daemon over SSE from the phone, a model running
// on the phone itself, cloud Claude, and the demo. They all emit the engine's
// DriverEvent protocol, so the chat UI has exactly one rendering path.
import type { ApprovalAnswer, DriverEvent, PermissionMode } from 'os-code/protocol';
import type { Attachment } from '../lib/attachments.js';

export type DriverEventSink = (event: DriverEvent, seq: number) => void;

export interface ChatDriver {
  readonly kind: 'desktop' | 'desktop-chat' | 'device' | 'cloud' | 'mock' | 'stack';
  /** Attachments are optional and only used by vision-capable drivers (cloud
   *  Claude today). Drivers that cannot use them ignore the argument, so a
   *  plain `send(text)` implementation still satisfies the contract. */
  send(text: string, attachments?: Attachment[]): void;
  abort(): void;
  answerApproval(approvalId: string, answer: ApprovalAnswer): void;
  /** Subscribe to the event stream; returns an unsubscribe function. */
  subscribe(sink: DriverEventSink): () => void;
  /** Release sockets, native handles, timers. */
  dispose(): void;
  /**
   * The person's controls over a live engine session (Claude Code parity;
   * engine-backed drivers only). setMode switches the permission mode for the
   * rest of the session; setInstructions replaces the project's standing
   * instructions; compact folds the history now (an optional focus keeps what
   * matters); listFiles ranks repo paths for an @ mention. Chat brains omit
   * them, so the composer hides the affordances there.
   */
  setMode?(mode: PermissionMode): void;
  setInstructions?(text?: string): void;
  compact?(focus?: string): Promise<{ before: number; after: number } | { error: string }>;
  listFiles?(query: string): Promise<string[]>;
  /**
   * The chat-to-terminal bridge (desktop-backed drivers only). Run a command
   * the user asked for on the connected machine; output streams back as
   * command-* events on the same subscription. Returns the runId, or undefined
   * if this driver has no terminal. sendStdin/killCommand drive a live run.
   */
  runCommand?(command: string): Promise<RunCommandResult>;
  sendStdin?(runId: string, data: string): void;
  killCommand?(runId: string): void;
  /**
   * Phase 2 interactive PTY terminal (desktop-backed drivers only). openTerminal
   * ensures a real terminal on the connected machine and returns its id and
   * size, or an unavailable marker when the machine has no PTY support.
   * terminalStream replays the ring buffer from a byte offset and then streams
   * live raw bytes (with the running end offset, for resume) until the signal
   * aborts. The rest drive a live terminal. Non-desktop drivers omit these, so
   * the terminal entry point stays hidden for them.
   */
  openTerminal?(opts: { cols: number; rows: number }): Promise<TerminalOpen>;
  terminalStream?(
    termId: string,
    sinceOffset: number,
    onChunk: (bytes: Uint8Array, endOffset: number) => void,
    signal: AbortSignal,
    onExit?: (info: TerminalExit) => void,
  ): Promise<void>;
  /** Fire-and-forget on hosts that cannot answer; a hub answers with whether
   *  the bytes landed, and in particular whether the shell has exited. */
  terminalStdin?(termId: string, data: string): void | Promise<TerminalWrite>;
  terminalResize?(termId: string, cols: number, rows: number): void;
  terminalKill?(termId: string): void;
}

/** The result of opening a terminal: its id and starting size, or a clean
 *  "no PTY on this machine" marker the UI shows instead of a blank panel. */
export type TerminalOpen =
  { termId: string; cols: number; rows: number } | { unavailable: true; error: string };

/** The shell's final frame: its exit code and the byte offset it ended at. */
export interface TerminalExit {
  exit: number;
  offset: number;
}

/** What became of a stdin write. `exited` is the daemon's 409: the shell is
 *  over, which is different from a terminal that does not exist. */
export type TerminalWrite = { ok: true } | { ok: false; exited: boolean; error: string };

/** Starting a command on the connected machine: the run to follow, the hub's
 *  own refusal (P0-1, a member device on a shared hub), or undefined when
 *  this host has no terminal or did not answer. */
export type RunCommandResult = { runId: string } | { refused: string } | undefined;

/** What a shared hub lets this device do. Absent on a hub that predates roles. */
export type HubRole = 'admin' | 'member';

/** Shared helper: a tiny fan-out emitter drivers can compose. */
export class DriverEmitter {
  private sinks = new Set<DriverEventSink>();
  private seq = 0;

  emit(event: DriverEvent): void {
    const seq = ++this.seq;
    for (const sink of this.sinks) sink(event, seq);
  }

  subscribe(sink: DriverEventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  clear(): void {
    this.sinks.clear();
  }
}
