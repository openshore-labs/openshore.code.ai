// Desktop driver: the engine lives in Electron's main process; events arrive
// over IPC already in DriverEvent shape, so this is a thin adapter.
import type { ApprovalAnswer, DriverEvent, PermissionMode } from 'os-code/protocol';
import { requireBridge } from '../lib/electronBridge.js';
import type { ChatDriver, DriverEventSink, RunCommandResult, TerminalOpen } from './types.js';

/** Base64 -> raw bytes, for a terminal output chunk arriving over IPC. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class ElectronDriver implements ChatDriver {
  readonly kind = 'desktop' as const;
  private offEvents: () => void;
  // Fan out with the main process's sequence numbers preserved.
  private sinks = new Set<DriverEventSink>();

  // G1: on resume the main process returns the session journal instead of
  // pushing it (the renderer's IPC listener is not attached yet), so we hold it
  // and replay it into each sink on subscribe, ahead of any live event.
  constructor(
    readonly sessionId: string,
    private readonly journal: Array<{ seq: number; event: DriverEvent }> = [],
  ) {
    const bridgeApi = requireBridge();
    this.offEvents = bridgeApi.onEvent(({ sessionId, seq, event }) => {
      if (sessionId !== this.sessionId) return;
      for (const sink of [...this.sinks]) sink(event, seq);
    });
  }

  subscribe(sink: DriverEventSink): () => void {
    this.sinks.add(sink);
    // Replay the resume journal so a reopened conversation rebuilds its
    // transcript. Live events (via onEvent) are strictly after the journal.
    for (const { event, seq } of this.journal) sink(event, seq);
    return () => this.sinks.delete(sink);
  }

  send(text: string): void {
    void requireBridge().send(this.sessionId, text);
  }

  abort(): void {
    void requireBridge().abort(this.sessionId);
  }

  answerApproval(approvalId: string, answer: ApprovalAnswer): void {
    void requireBridge().answerApproval(this.sessionId, approvalId, answer);
  }

  // ---- the person's session controls ----
  setMode(mode: PermissionMode): void {
    void requireBridge().setMode(this.sessionId, mode);
  }

  setInstructions(text?: string): void {
    void requireBridge().setInstructions(this.sessionId, text);
  }

  compact(focus?: string): Promise<{ before: number; after: number } | { error: string }> {
    return requireBridge().compact(this.sessionId, focus);
  }

  listFiles(query: string): Promise<string[]> {
    return requireBridge().listFiles(this.sessionId, query);
  }

  // ---- chat-to-terminal bridge ----
  // Output for a started run streams back as command-* events on the same
  // onEvent channel the main process already forwards, so these only kick off /
  // drive a run. runCommand returns the runId the store drives with stdin/kill.
  async runCommand(command: string): Promise<RunCommandResult> {
    const runId = await requireBridge().runCommand(this.sessionId, command);
    return runId ? { runId } : undefined;
  }

  sendStdin(runId: string, data: string): void {
    void requireBridge().sendCommandStdin(this.sessionId, runId, data);
  }

  killCommand(runId: string): void {
    void requireBridge().killCommand(this.sessionId, runId);
  }

  // ---- interactive terminal (Phase 2) ----
  // The PTY lives in the main process (the same TerminalManager the daemon
  // uses). openTerminal ensures one; terminalStream registers for the output
  // events the main process forwards, then asks it to start (ring replay from
  // the offset, then live), until the caller's signal aborts.
  async openTerminal(opts: { cols: number; rows: number }): Promise<TerminalOpen> {
    return requireBridge().openTerminal(this.sessionId, opts.cols, opts.rows);
  }

  terminalStream(
    termId: string,
    sinceOffset: number,
    onChunk: (bytes: Uint8Array, endOffset: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const bridgeApi = requireBridge();
    return new Promise<void>((resolve) => {
      // Register the listener BEFORE subscribing, so the ring replay (sent right
      // after subscribe) is never missed.
      const off = bridgeApi.onTerminalData((payload) => {
        if (payload.termId !== termId) return;
        onChunk(b64ToBytes(payload.b64), payload.offset);
      });
      const cleanup = (): void => {
        off();
        void bridgeApi.terminalUnsubscribe(termId);
        resolve();
      };
      if (signal.aborted) {
        cleanup();
        return;
      }
      signal.addEventListener('abort', cleanup, { once: true });
      void bridgeApi.terminalSubscribe(termId, sinceOffset);
    });
  }

  terminalStdin(termId: string, data: string): void {
    void requireBridge().terminalStdin(termId, data);
  }

  terminalResize(termId: string, cols: number, rows: number): void {
    void requireBridge().terminalResize(termId, cols, rows);
  }

  terminalKill(termId: string): void {
    void requireBridge().terminalKill(termId);
  }

  dispose(): void {
    this.offEvents();
    this.sinks.clear();
  }
}
