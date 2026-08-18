// The demo driver: a scripted little session so anyone can feel the app
// (streaming, a tool card, an approval, citations) before any model is set
// up. Honest about being a demo in every line it says.
import type { ApprovalAnswer, DriverEvent } from 'os-code/protocol';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';

const DIFF = [
  '--- a/src/math.js',
  '+++ b/src/math.js',
  '@@ -1,3 +1,3 @@',
  ' export function add(a, b) {',
  '-  return a - b;',
  '+  return a + b;',
  '}',
].join('\n');

export class MockDriver implements ChatDriver {
  readonly kind = 'mock' as const;
  private emitter = new DriverEmitter();
  private aborted = false;
  private pendingApproval?: string;

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string): void {
    void this.run(text);
  }

  private emit(event: DriverEvent): void {
    this.emitter.emit(event);
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  private async streamText(text: string): Promise<void> {
    for (const word of text.split(' ')) {
      if (this.aborted) return;
      this.emit({ type: 'text-delta', text: `${word} ` });
      await this.wait(30);
    }
  }

  private async run(input: string): Promise<void> {
    this.aborted = false;
    this.emit({ type: 'task-start', input });
    this.emit({ type: 'turn-start', turn: 1, model: 'demo-model', providerKind: 'local' });
    await this.wait(350);

    const intro =
      'This is the demo session, so let me show you the moves. First I read the file, then I fix it, and you approve the change before it lands.';
    await this.streamText(intro);
    this.emit({ type: 'text-final', text: intro });

    this.emit({
      type: 'tool-start',
      call: { id: 'demo1', name: 'readFile', args: { path: 'src/math.js' } },
    });
    await this.wait(700);
    this.emit({
      type: 'tool-end',
      call: { id: 'demo1', name: 'readFile', args: { path: 'src/math.js' } },
      result: { ok: true, content: 'src/math.js (lines 1-3 of 3)' },
      durationMs: 640,
    });

    await this.wait(300);
    this.pendingApproval = 'demo-approval-1';
    this.emit({
      type: 'approval-request',
      request: {
        id: this.pendingApproval,
        kind: 'tool',
        toolName: 'editFile',
        risk: 'write',
        summary: 'Edit src/math.js (+1 -1)',
        detail: DIFF,
      },
    });
  }

  answerApproval(approvalId: string, answer: ApprovalAnswer): void {
    if (approvalId !== this.pendingApproval) return;
    this.pendingApproval = undefined;
    this.emit({ type: 'approval-resolved', id: approvalId, approved: answer.approve });
    void this.finish(answer.approve);
  }

  private async finish(approved: boolean): Promise<void> {
    if (approved) {
      this.emit({
        type: 'tool-start',
        call: { id: 'demo2', name: 'editFile', args: { path: 'src/math.js' } },
      });
      await this.wait(600);
      this.emit({
        type: 'tool-end',
        call: { id: 'demo2', name: 'editFile', args: { path: 'src/math.js' } },
        result: { ok: true, content: 'Applied 1 edit to src/math.js (+1 -1).', diffText: DIFF },
        durationMs: 580,
      });
      this.emit({
        type: 'citations',
        citations: [
          { title: 'MDN: Addition (+)', url: 'https://developer.mozilla.org/docs/addition' },
        ],
      });
      await this.wait(250);
      const outro =
        'Fixed and verified. In a real session this runs on YOUR models: your desktop stack over Tailscale, a pocket model on this device, or Claude on your own key. Set one up from the menu.';
      await this.streamText(outro);
      this.emit({ type: 'text-final', text: outro });
    } else {
      const outro =
        'Declined, so nothing changed. That is the whole point of approvals. Set up a real model from the menu when you are ready.';
      await this.streamText(outro);
      this.emit({ type: 'text-final', text: outro });
    }
    this.emit({ type: 'task-done', reason: 'complete' });
  }

  abort(): void {
    this.aborted = true;
    this.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
  }

  dispose(): void {
    this.aborted = true;
    this.emitter.clear();
  }
}
