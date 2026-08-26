// The one driver contract every conversation brain implements: the desktop
// engine over IPC, the desktop daemon over SSE from the phone, a model running
// on the phone itself, cloud Claude, and the demo. They all emit the engine's
// DriverEvent protocol, so the chat UI has exactly one rendering path.
import type { ApprovalAnswer, DriverEvent } from 'os-code/protocol';
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
   * The chat-to-terminal bridge (desktop-backed drivers only). Run a command
   * the user asked for on the connected machine; output streams back as
   * command-* events on the same subscription. Returns the runId, or undefined
   * if this driver has no terminal. sendStdin/killCommand drive a live run.
   */
  runCommand?(command: string): Promise<string | undefined>;
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
  ): Promise<void>;
  terminalStdin?(termId: string, data: string): void;
  terminalResize?(termId: string, cols: number, rows: number): void;
  terminalKill?(termId: string): void;
}

/** The result of opening a terminal: its id and starting size, or a clean
 *  "no PTY on this machine" marker the UI shows instead of a blank panel. */
export type TerminalOpen =
  { termId: string; cols: number; rows: number } | { unavailable: true; error: string };

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
