// The one driver contract every conversation brain implements: the desktop
// engine over IPC, the desktop daemon over SSE from the phone, a model running
// on the phone itself, cloud Claude, and the demo. They all emit the engine's
// DriverEvent protocol, so the chat UI has exactly one rendering path.
import type { ApprovalAnswer, DriverEvent } from 'os-code/protocol';
import type { Attachment } from '../lib/attachments.js';

export type DriverEventSink = (event: DriverEvent, seq: number) => void;

export interface ChatDriver {
  readonly kind: 'desktop' | 'device' | 'cloud' | 'mock' | 'stack';
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
}

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
