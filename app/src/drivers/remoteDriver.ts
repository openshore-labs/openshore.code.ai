// The phone's line to the desktop: the daemon's HTTP + SSE surface over the
// tailnet. Every event is journaled on the desktop and replayable from any
// sequence number, so a subway tunnel costs nothing; this driver reconnects
// with backoff and resumes from the last sequence it saw.
import type { ApprovalAnswer, DaemonSessionInfo, DriverEvent } from 'os-code/protocol';
import type { ChatDriver, DriverEventSink } from './types.js';
import { streamingFetch } from '../lib/streamingFetch.js';

export interface DaemonTarget {
  /** e.g. http://100.101.1.2:4816 (the desktop's tailnet address). */
  baseUrl: string;
  token: string;
}

function headers(target: DaemonTarget): Record<string, string> {
  return { authorization: `Bearer ${target.token}` };
}

export async function daemonHealth(target: DaemonTarget): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${target.baseUrl}/health`, {
      headers: headers(target),
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401)
      return {
        ok: false,
        detail: 'The desktop rejected the pairing token. Re-copy it from the desktop app.',
      };
    if (!res.ok) return { ok: false, detail: `The desktop answered ${res.status}.` };
    return { ok: true, detail: 'Connected to your desktop.' };
  } catch {
    return {
      ok: false,
      detail:
        'Could not reach the desktop. Check that Tailscale is on for both devices and the desktop app is open.',
    };
  }
}

export async function daemonCreateSession(target: DaemonTarget, cwd?: string): Promise<string> {
  const res = await fetch(`${target.baseUrl}/sessions`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify(cwd ? { cwd } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? `The desktop answered ${res.status}.`);
  return body.id;
}

export async function daemonListSessions(target: DaemonTarget): Promise<DaemonSessionInfo[]> {
  const res = await fetch(`${target.baseUrl}/sessions`, { headers: headers(target) });
  if (!res.ok) throw new Error(`The desktop answered ${res.status}.`);
  const body = (await res.json()) as {
    live: Array<{ id: string; cwd: string; busy: boolean }>;
    stored: Array<{ id: string; cwd: string; title: string; updatedAt: string }>;
  };
  const seen = new Set<string>();
  const rows: DaemonSessionInfo[] = [];
  for (const s of body.live) {
    seen.add(s.id);
    rows.push({ id: s.id, cwd: s.cwd, busy: s.busy });
  }
  for (const s of body.stored) {
    if (!seen.has(s.id))
      rows.push({ id: s.id, cwd: s.cwd, title: s.title, updatedAt: s.updatedAt });
  }
  return rows;
}

export async function daemonWorkspaces(target: DaemonTarget) {
  const res = await fetch(`${target.baseUrl}/workspaces`, { headers: headers(target) });
  if (!res.ok) throw new Error(`The desktop answered ${res.status}.`);
  return ((await res.json()) as { workspaces: Array<{ cwd: string; name: string }> }).workspaces;
}

export async function daemonCloneRepo(target: DaemonTarget, url: string) {
  const res = await fetch(`${target.baseUrl}/workspaces/clone`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    cwd?: string;
    name?: string;
    error?: string;
  };
  if (!res.ok || !body.cwd) throw new Error(body.error ?? `Clone failed (${res.status}).`);
  return { cwd: body.cwd, name: body.name ?? 'repo' };
}

export async function daemonStack(target: DaemonTarget) {
  const res = await fetch(`${target.baseUrl}/stack`, { headers: headers(target) });
  if (!res.ok) throw new Error(`The desktop answered ${res.status}.`);
  return (await res.json()) as import('os-code/protocol').DaemonStackInfo;
}

// ---- outbox apply (buffered commit-intents land as real commits) ----------

export interface OutboxApplyWire {
  cwd: string;
  clientOpId: string;
  itemId: string;
  deviceId: string;
  branch: string;
  message: string;
  baseCommit: string;
  files: Array<{ path: string; mode: 'upsert' | 'delete'; contentBase64?: string }>;
}

export type OutboxApplyResult =
  | { ok: true; resultCommit: string; idempotentReplay?: boolean }
  | { ok: false; conflict: true; resultCommit: string; rescueBranch: string }
  | { ok: false; error: string };

/** Ask the desktop to materialize one buffered commit-intent into a commit. */
export async function daemonApplyOutbox(
  target: DaemonTarget,
  req: OutboxApplyWire,
): Promise<OutboxApplyResult> {
  const res = await fetch(`${target.baseUrl}/outbox/apply`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  const body = (await res
    .json()
    .catch(() => ({ ok: false, error: `Apply failed (${res.status}).` }))) as OutboxApplyResult;
  return body;
}

/** Independent confirmation: does the commit exist and sit on the branch? */
export async function daemonVerifyCommit(
  target: DaemonTarget,
  cwd: string,
  commit: string,
  branch?: string,
): Promise<{ exists: boolean; onBranch: boolean }> {
  const qs = new URLSearchParams({ cwd, commit, ...(branch ? { branch } : {}) });
  const res = await fetch(`${target.baseUrl}/outbox/verify?${qs.toString()}`, {
    headers: headers(target),
  });
  if (!res.ok) return { exists: false, onBranch: false };
  return (await res.json()) as { exists: boolean; onBranch: boolean };
}

/** Parse one SSE frame ("id: N\ndata: {...}") into an event; null if not data. */
export function parseSseFrame(frame: string): { seq: number; event: DriverEvent } | null {
  let seq = 0;
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) seq = Number(line.slice(3).trim()) || 0;
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { seq, event: JSON.parse(data) as DriverEvent };
  } catch {
    return null;
  }
}

export class RemoteDriver implements ChatDriver {
  readonly kind = 'desktop' as const;
  private sinks = new Set<DriverEventSink>();
  private lastSeq: number;
  private closed = false;
  private abortStream?: AbortController;

  constructor(
    readonly sessionId: string,
    private readonly target: DaemonTarget,
    resumeFromSeq = 0,
  ) {
    this.lastSeq = resumeFromSeq;
    void this.streamLoop();
  }

  // G5: `outageBlipped` lives on the driver (outside the transcript), so an
  // outage adds the "Connection blipped" status row exactly once, no matter how
  // many reconnect attempts it takes. And a cleanly-closed stream backs off just
  // like an error would, so a daemon that closes the SSE immediately cannot spin
  // this in a zero-delay hot loop. Backoff resets only once a reconnection is
  // productive (delivers a frame), so an unproductive close keeps stepping up.
  private outageBlipped = false;
  private notFoundStreak = 0;

  // A fatal answer is not a network blip: stop retrying and tell the user what
  // to do, instead of "Connection blipped" forever on a revoked token or a
  // deleted session.
  private emitTerminal(message: string): void {
    this.closed = true;
    for (const sink of [...this.sinks]) sink({ type: 'status', message }, this.lastSeq);
  }

  private async streamLoop(): Promise<void> {
    let backoffMs = 600;
    const stepBackoff = async () => {
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 10_000);
    };
    while (!this.closed) {
      this.abortStream = new AbortController();
      try {
        const res = await streamingFetch(
          `${this.target.baseUrl}/sessions/${this.sessionId}/events?since=${this.lastSeq}`,
          { headers: headers(this.target), signal: this.abortStream.signal },
        );
        if (res.status === 401 || res.status === 403) {
          this.emitTerminal(
            'The desktop rejected this phone. Re-pair from Menu, Desktop connection.',
          );
          return;
        }
        if (res.status === 404) {
          // Tolerate a transient 404 (a session rehydrating), give up after a few.
          this.notFoundStreak += 1;
          if (this.notFoundStreak >= 3) {
            this.emitTerminal('This session no longer exists on the desktop. Start a new one.');
            return;
          }
          throw new Error('session not found yet');
        }
        this.notFoundStreak = 0;
        if (!res.ok || !res.body) throw new Error(`daemon answered ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done || this.closed) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const parsed = parseSseFrame(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
            if (!parsed) continue;
            // A productive frame: the outage (if any) is over. Clear the blip
            // flag and reset backoff so the next genuine outage gets one blip.
            this.outageBlipped = false;
            backoffMs = 600;
            this.lastSeq = Math.max(this.lastSeq, parsed.seq);
            for (const sink of [...this.sinks]) sink(parsed.event, parsed.seq);
          }
        }
      } catch {
        if (this.closed) return;
        if (!this.outageBlipped) {
          this.outageBlipped = true;
          for (const sink of [...this.sinks]) {
            sink(
              { type: 'status', message: 'Connection blipped. Reattaching to the run.' },
              this.lastSeq,
            );
          }
        }
        await stepBackoff();
        continue;
      }
      // Clean close (the daemon ended the response with no error): the run may
      // just be idle. Back off before reattaching. No blip: nothing went wrong.
      if (this.closed) return;
      await stepBackoff();
    }
  }

  subscribe(sink: DriverEventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  send(text: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/input`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      // A blackholed tailnet (Tailscale toggled off on the phone) otherwise
      // hangs this for the OS default minute with no feedback.
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      for (const sink of [...this.sinks]) {
        sink(
          {
            type: 'status',
            message: 'Could not reach the desktop to send that. It will not be lost if you retry.',
          },
          this.lastSeq,
        );
      }
    });
  }

  abort(): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/abort`, {
      method: 'POST',
      headers: headers(this.target),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  answerApproval(approvalId: string, answer: ApprovalAnswer): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/approvals/${approvalId}`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify(answer),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  // ---- chat-to-terminal bridge ----
  // Output for a started run streams back as command-* events on the same SSE
  // subscription, so these methods only kick off / drive a run. A short timeout
  // keeps a blackholed tailnet from hanging the tap.
  async runCommand(command: string): Promise<string | undefined> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/commands`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { runId?: string };
      return body.runId;
    } catch {
      return undefined;
    }
  }

  sendStdin(runId: string, data: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/commands/${runId}/stdin`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  killCommand(runId: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/commands/${runId}/kill`, {
      method: 'POST',
      headers: headers(this.target),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  dispose(): void {
    this.closed = true;
    this.abortStream?.abort();
    this.sinks.clear();
  }
}
