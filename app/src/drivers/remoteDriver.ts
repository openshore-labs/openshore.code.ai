// The phone's line to the desktop: the daemon's HTTP + SSE surface over the
// tailnet. Every event is journaled on the desktop and replayable from any
// sequence number, so a subway tunnel costs nothing; this driver reconnects
// with backoff and resumes from the last sequence it saw.
import type {
  ApprovalAnswer,
  DaemonSessionInfo,
  DriverEvent,
  PermissionMode,
} from 'os-code/protocol';
import type { ChatDriver, DriverEventSink, TerminalOpen } from './types.js';
import { streamingFetch } from '../lib/streamingFetch.js';

/** Base64 -> raw bytes, for a terminal stream frame. atob exists in the WebView
 *  and every browser build target. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Raw text -> base64, for terminal stdin (keystrokes). Handles multi-byte
 *  characters by encoding utf8 first. */
function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface DaemonTarget {
  /** e.g. http://100.101.1.2:4816 (the desktop's tailnet address). */
  baseUrl: string;
  token: string;
  /** A friendly name for the hub, shown when more than one is saved. Optional;
   *  the tailnet host stands in when it is absent. */
  name?: string;
}

function headers(target: DaemonTarget): Record<string, string> {
  return { authorization: `Bearer ${target.token}` };
}

export interface DaemonInstallProgress {
  line: string;
  percent?: number;
  completed?: number;
  total?: number;
  done: boolean;
  ok?: boolean;
  detail?: string;
}

/** Start a model install on the paired desktop (MP-F2). Output is polled. */
export async function daemonInstallModel(target: DaemonTarget, modelId: string): Promise<void> {
  const res = await fetch(`${target.baseUrl}/models/install`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify({ modelId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `The desktop answered ${res.status}.`);
  }
}

/** Poll a desktop install's progress; undefined once it is no longer tracked. */
export async function daemonInstallProgress(
  target: DaemonTarget,
  modelId: string,
): Promise<DaemonInstallProgress | undefined> {
  const res = await fetch(
    `${target.baseUrl}/models/install/${encodeURIComponent(modelId)}/progress`,
    { headers: headers(target), signal: AbortSignal.timeout(10_000) },
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`The desktop answered ${res.status}.`);
  return (await res.json()) as DaemonInstallProgress;
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

export async function daemonCreateSession(
  target: DaemonTarget,
  cwd?: string,
  opts: { instructions?: string; permissionMode?: PermissionMode } = {},
): Promise<string> {
  const res = await fetch(`${target.baseUrl}/sessions`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(cwd ? { cwd } : {}),
      ...(opts.instructions ? { instructions: opts.instructions } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
    }),
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
  // A non-OK response is not proof the commit is missing (the lookup itself
  // failed, or the path is not yet allowed). Throw so the caller keeps the item
  // buffered for a retry, rather than reading it as "commit not found".
  if (!res.ok) throw new Error(`Verify failed (${res.status}).`);
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
        // A successful reconnect (even before the first frame, and even on an
        // idle session that only sends keepalives) means the outage is over.
        // Reset here so backoff and the blip flag do not stay degraded on an
        // idle stream that never emits a productive frame (TS-P2-3).
        this.outageBlipped = false;
        backoffMs = 600;
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

  // ---- the person's session controls ----
  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/${path}`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  setMode(mode: PermissionMode): void {
    void this.post('mode', { mode }).catch(() => {});
  }

  setInstructions(text?: string): void {
    void this.post('instructions', { text }).catch(() => {});
  }

  async compact(focus?: string): Promise<{ before: number; after: number } | { error: string }> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/compact`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify(focus ? { focus } : {}),
        // Compaction is a model turn of its own; give it real time.
        signal: AbortSignal.timeout(120_000),
      });
      return (await res.json()) as { before: number; after: number } | { error: string };
    } catch {
      return { error: 'Could not reach the desktop to compact.' };
    }
  }

  async listFiles(query: string): Promise<string[]> {
    try {
      const res = await fetch(
        `${this.target.baseUrl}/sessions/${this.sessionId}/files?q=${encodeURIComponent(query)}`,
        { headers: headers(this.target), signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { files?: string[] };
      return body.files ?? [];
    } catch {
      return [];
    }
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

  // ---- interactive PTY terminal (Phase 2 bridge) ----
  // Its own SSE endpoint with offset-based replay, completely separate from the
  // session event journal above. Raw bytes go base64 on the wire.
  async openTerminal(opts: { cols: number; rows: number }): Promise<TerminalOpen> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/term`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify({ cols: opts.cols, rows: opts.rows }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          unavailable: true,
          error: body.error ?? 'Terminal support is not installed on the desktop.',
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        termId?: string;
        cols?: number;
        rows?: number;
        error?: string;
      };
      if (!res.ok || !body.termId) {
        return {
          unavailable: true,
          error: body.error ?? `The desktop answered ${res.status}.`,
        };
      }
      return { termId: body.termId, cols: body.cols ?? opts.cols, rows: body.rows ?? opts.rows };
    } catch {
      return { unavailable: true, error: 'Could not reach the desktop to open a terminal.' };
    }
  }

  async terminalStream(
    termId: string,
    sinceOffset: number,
    onChunk: (bytes: Uint8Array, endOffset: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const res = await streamingFetch(
      `${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}/stream?since=${sinceOffset}`,
      { headers: headers(this.target), signal },
    );
    if (!res.ok || !res.body) throw new Error(`daemon answered ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const payload = JSON.parse(dataLine.slice(5).trim()) as { b64?: string; offset?: number };
          if (payload.b64) onChunk(b64ToBytes(payload.b64), payload.offset ?? sinceOffset);
        } catch {}
      }
    }
  }

  terminalStdin(termId: string, data: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}/stdin`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify({ dataBase64: textToB64(data) }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  terminalResize(termId: string, cols: number, rows: number): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}/resize`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  terminalKill(termId: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}`, {
      method: 'DELETE',
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
