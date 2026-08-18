// Remote attach: a thin SessionDriver over the daemon's HTTP surface. The
// SSE stream resumes from the last seen sequence number, so a phone that
// loses signal for a minute reattaches and misses nothing. Reconnection is
// automatic with backoff; the UI just keeps rendering.
import { join } from 'node:path';
import { oscHome } from '../config/load.js';
import { loadOrCreateToken } from '../core/security/daemonAuth.js';
import type { ApprovalAnswer } from '../core/agent/types.js';
import type { DriverEvent, SessionDriver } from './session.js';
import { logger } from '../util/log.js';

const log = logger('attach');

export interface RemoteTarget {
  baseUrl: string;
  token: string;
}

export function defaultTarget(port: number, host = '127.0.0.1'): RemoteTarget {
  return {
    baseUrl: `http://${host}:${port}`,
    token: loadOrCreateToken(join(oscHome(), 'daemon.token')),
  };
}

export async function createRemoteSession(target: RemoteTarget, cwd: string): Promise<string> {
  const res = await fetch(`${target.baseUrl}/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ cwd }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `The daemon answered ${res.status}.`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function listRemoteSessions(target: RemoteTarget): Promise<{
  live: Array<{ id: string; cwd: string; busy: boolean }>;
  stored: Array<{ id: string; cwd: string; title: string; updatedAt: string }>;
}> {
  const res = await fetch(`${target.baseUrl}/sessions`, {
    headers: { authorization: `Bearer ${target.token}` },
  });
  if (!res.ok) throw new Error(`The daemon answered ${res.status}. Is osc serve running?`);
  return (await res.json()) as any;
}

export class RemoteDriver implements SessionDriver {
  readonly cwd: string;
  private sinks = new Set<(event: DriverEvent, seq: number) => void>();
  private lastSeq = 0;
  private closed = false;
  private model = { model: '(remote)', kind: 'local' as 'local' | 'cloud' };
  private busyFlag = false;

  constructor(
    readonly id: string,
    private readonly target: RemoteTarget,
    cwd = '(remote workspace)',
  ) {
    this.cwd = cwd;
    void this.streamLoop();
  }

  get busy(): boolean {
    return this.busyFlag;
  }

  private async streamLoop(): Promise<void> {
    let backoffMs = 500;
    while (!this.closed) {
      try {
        const res = await fetch(
          `${this.target.baseUrl}/sessions/${this.id}/events?since=${this.lastSeq}`,
          { headers: { authorization: `Bearer ${this.target.token}` } },
        );
        if (!res.ok || !res.body) throw new Error(`daemon answered ${res.status}`);
        backoffMs = 500;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done || this.closed) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            this.handleFrame(frame);
          }
        }
      } catch (err) {
        if (this.closed) return;
        log.debug('stream dropped, reconnecting', { err: String(err), backoffMs });
        for (const sink of this.sinks) {
          sink(
            { type: 'status', message: 'Connection blipped; reattaching to the run.' },
            this.lastSeq,
          );
        }
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 10_000);
      }
    }
  }

  private handleFrame(frame: string): void {
    let seq = this.lastSeq;
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('id:')) seq = Number(line.slice(3).trim());
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let event: DriverEvent;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    this.lastSeq = Math.max(this.lastSeq, seq);
    if (event.type === 'task-start') this.busyFlag = true;
    if (event.type === 'task-done') this.busyFlag = false;
    if (event.type === 'turn-start') this.model = { model: event.model, kind: event.providerKind };
    for (const sink of this.sinks) sink(event, seq);
  }

  send(text: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.id}/input`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch((err) => {
      for (const sink of this.sinks) {
        sink(
          { type: 'status', message: `Could not reach the daemon to send that: ${err.message}` },
          this.lastSeq,
        );
      }
    });
  }

  abort(): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.id}/abort`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.target.token}` },
    }).catch(() => {});
  }

  answerApproval(id: string, answer: ApprovalAnswer): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.id}/approvals/${id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        approve: answer.approve,
        alwaysThisSession: answer.alwaysThisSession,
      }),
    }).catch(() => {});
  }

  subscribe(sink: (event: DriverEvent, seq: number) => void, _sinceSeq?: number): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  describeModel(): { model: string; kind: 'local' | 'cloud' } {
    return this.model;
  }

  close(): void {
    this.closed = true;
  }
}
