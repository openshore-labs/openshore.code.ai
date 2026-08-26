// Desktop driver: the engine lives in Electron's main process; events arrive
// over IPC already in DriverEvent shape, so this is a thin adapter.
import type { ApprovalAnswer, DriverEvent } from 'os-code/protocol';
import { requireBridge } from '../lib/electronBridge.js';
import type { ChatDriver, DriverEventSink } from './types.js';

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

  // ---- chat-to-terminal bridge ----
  // Output for a started run streams back as command-* events on the same
  // onEvent channel the main process already forwards, so these only kick off /
  // drive a run. runCommand returns the runId the store drives with stdin/kill.
  async runCommand(command: string): Promise<string | undefined> {
    return requireBridge().runCommand(this.sessionId, command);
  }

  sendStdin(runId: string, data: string): void {
    void requireBridge().sendCommandStdin(this.sessionId, runId, data);
  }

  killCommand(runId: string): void {
    void requireBridge().killCommand(this.sessionId, runId);
  }

  dispose(): void {
    this.offEvents();
    this.sinks.clear();
  }
}
