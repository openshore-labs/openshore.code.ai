// Desktop driver: the engine lives in Electron's main process; events arrive
// over IPC already in DriverEvent shape, so this is a thin adapter.
import type { ApprovalAnswer } from 'os-code/protocol';
import { requireBridge } from '../lib/electronBridge.js';
import type { ChatDriver, DriverEventSink } from './types.js';

export class ElectronDriver implements ChatDriver {
  readonly kind = 'desktop' as const;
  private offEvents: () => void;
  // Fan out with the main process's sequence numbers preserved.
  private sinks = new Set<DriverEventSink>();

  constructor(readonly sessionId: string) {
    const bridgeApi = requireBridge();
    this.offEvents = bridgeApi.onEvent(({ sessionId, seq, event }) => {
      if (sessionId !== this.sessionId) return;
      for (const sink of [...this.sinks]) sink(event, seq);
    });
  }

  subscribe(sink: DriverEventSink): () => void {
    this.sinks.add(sink);
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

  dispose(): void {
    this.offEvents();
    this.sinks.clear();
  }
}
