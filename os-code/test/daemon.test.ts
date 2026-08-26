// The daemon's authorization and request-hygiene surface: a member device
// credential must NOT be able to open a session outside an admin-provisioned
// workspace or touch another user's session (D1), and a malformed or
// under-specified request body must fail loudly rather than resolve as a silent
// empty object (P2-7). These start a real loopback daemon and drive it over
// HTTP, the way a paired phone would.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';

let home: string;
let daemon: RunningDaemon;
let base: string;
let adminToken: string;

async function startOnFreePort(): Promise<RunningDaemon> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 20000);
    try {
      return await startDaemon({ config: defaultConfig(), bind: 'loopback', port });
    } catch (err) {
      if (String(err).includes('EADDRINUSE')) continue;
      throw err;
    }
  }
  throw new Error('could not find a free port for the test daemon');
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  // A disk config with a configured (local) orchestrator so a session can
  // actually bootstrap. The `ollama` provider is the schema default, so only
  // the stack pointer is needed; no network is touched at construction.
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
  );
  daemon = await startOnFreePort();
  base = `http://127.0.0.1:${daemon.port}`;
  adminToken = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
});

afterEach(() => {
  daemon.close();
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function createSessionAs(token: string, cwd: string): Promise<Response> {
  return fetch(`${base}/sessions`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ cwd }),
  });
}

describe('daemon RBAC (D1)', () => {
  it('a member cannot open a session outside an admin-provisioned workspace', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    // `home` is a scratch dir, not under ~/OSCode: a member must be refused.
    const res = await createSessionAs(token, home);
    expect(res.status).toBe(403);
  });

  it('an admin (legacy shared token) may open a session anywhere', async () => {
    const res = await createSessionAs(adminToken, home);
    expect(res.status).toBe(201);
  });

  it("a member cannot answer approvals on another user's session", async () => {
    const created = await createSessionAs(adminToken, home);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await fetch(`${base}/sessions/${id}/approvals/whatever`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ approve: true }),
    });
    expect(res.status).toBe(403);
  });

  it("a member cannot send input to another user's session", async () => {
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await fetch(`${base}/sessions/${id}/input`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ text: 'do a thing' }),
    });
    expect(res.status).toBe(403);
  });

  // Outbox path-allowlist gating is covered by the "daemon outbox path
  // allowlist (SEC-2)" suite below (main's config-driven isOutboxAllowedPath,
  // which applies to every caller, superseded an earlier role-based gate).
});

describe('free desktop chat (/chat, read-only)', () => {
  it('rejects a chat with no messages', async () => {
    const res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('opens an SSE stream for a valid chat against the local orchestrator', async () => {
    const res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // The test config's Ollama is not running, so the provider errors fast and
    // the stream ends with an error frame. The point is the endpoint streams.
    const text = await res.text();
    expect(text).toMatch(/"type":"(error|done|text)"/);
  });

  it('a member may open free chat (not admin-gated)', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    await res.text();
  });
});

describe('model install from a paired phone (MP-F2)', () => {
  it('rejects an install with no modelId', async () => {
    const res = await fetch(`${base}/models/install`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('404s an install for an unknown model', async () => {
    const res = await fetch(`${base}/models/install`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ modelId: 'no-such-model-xyz' }),
    });
    expect(res.status).toBe(404);
  });

  it('a member cannot start an install (admin-gated)', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await fetch(`${base}/models/install`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ modelId: 'qwen2.5-coder-7b' }),
    });
    expect(res.status).toBe(403);
  });

  it('404s progress for a model with no install running', async () => {
    const res = await fetch(`${base}/models/install/qwen2.5-coder-7b/progress`, {
      headers: auth(adminToken),
    });
    expect(res.status).toBe(404);
  });
});

describe('command lane (chat-to-terminal bridge)', () => {
  it('runs a user command and streams its output over the session SSE', async () => {
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };

    const started = await fetch(`${base}/sessions/${id}/commands`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ command: 'printf "bridge-works\\n"' }),
    });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    expect(runId).toBeTruthy();

    // Read the session event stream and collect command-* frames until end.
    const res = await fetch(`${base}/sessions/${id}/events?since=0`, {
      headers: auth(adminToken),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    let sawStart = false;
    let sawEnd: { exitCode: number | null } | undefined;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !sawEnd) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const event = JSON.parse(dataLine.slice(5).trim());
          if (event.type === 'command-start' && event.runId === runId) sawStart = true;
          if (event.type === 'command-output' && event.runId === runId) output += event.chunk;
          if (event.type === 'command-end' && event.runId === runId) sawEnd = event;
        } catch {}
      }
    }
    await reader.cancel();
    expect(sawStart).toBe(true);
    expect(output).toContain('bridge-works');
    expect(sawEnd?.exitCode).toBe(0);
  });

  it('rejects an empty command', async () => {
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`${base}/sessions/${id}/commands`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ command: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s a stdin write to an unknown run', async () => {
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`${base}/sessions/${id}/commands/nope/stdin`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ data: 'x\n' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('interactive terminal (Phase 2 PTY bridge)', () => {
  it('a member cannot create a terminal (admin + owner only)', async () => {
    // Admin owns a session; a member device must be refused the PTY surface,
    // which is admin-only because a PTY is an unjailed interactive shell.
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await fetch(`${base}/sessions/${id}/term`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(res.status).toBe(403);
  });

  it('answers 503 (not a crash) when node-pty is not installed', async () => {
    // node-pty is an optional native module and is absent in this environment,
    // so ensure() throws TerminalUnavailable and the route returns a clean 503.
    // The daemon must keep serving after it.
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`${base}/sessions/${id}/term`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not installed/i);
    // The daemon is still alive.
    const health = await fetch(`${base}/health`, { headers: auth(adminToken) });
    expect(health.status).toBe(200);
  });

  it('404s a stream for an unknown terminal id', async () => {
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`${base}/sessions/${id}/term/nope/stream?since=0`, {
      headers: auth(adminToken),
    });
    expect(res.status).toBe(404);
  });
});

describe('daemon outbox path allowlist (SEC-2)', () => {
  const applyBody = {
    cwd: '',
    clientOpId: 'op-1',
    itemId: 'itm-1',
    deviceId: 'dev-1',
    branch: 'main',
    baseCommit: 'abc123',
    files: [{ path: 'x.txt', mode: 'upsert', contentBase64: 'aGk=' }],
  };

  it('rejects an apply to a repo outside the allowed roots, even for an admin', async () => {
    // `home` exists but is not under ~/OSCode and is not a configured root.
    const res = await fetch(`${base}/outbox/apply`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ ...applyBody, cwd: home }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a verify for a repo outside the allowed roots', async () => {
    const qs = new URLSearchParams({ cwd: home, commit: 'abc123' });
    const res = await fetch(`${base}/outbox/verify?${qs.toString()}`, {
      headers: auth(adminToken),
    });
    expect(res.status).toBe(403);
  });
});

describe('daemon request hygiene (P2-7)', () => {
  it('a malformed JSON body is a 400, not a silent empty object', async () => {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: '{ this is not json',
    });
    expect(res.status).toBe(400);
  });

  it('an approval without an explicit boolean approve is a 400', async () => {
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`${base}/sessions/${id}/approvals/x`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ alwaysThisSession: true }),
    });
    expect(res.status).toBe(400);
  });

  it('answering an unknown approval id is a 404, not a 200 no-op', async () => {
    const created = await createSessionAs(adminToken, home);
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`${base}/sessions/${id}/approvals/nope`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ approve: true }),
    });
    expect(res.status).toBe(404);
  });
});
