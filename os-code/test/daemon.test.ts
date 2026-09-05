// The daemon's authorization and request-hygiene surface: a member device
// credential must NOT be able to open a session outside an admin-provisioned
// workspace or touch another user's session (D1), and a malformed or
// under-specified request body must fail loudly rather than resolve as a silent
// empty object (P2-7). These start a real loopback daemon and drive it over
// HTTP, the way a paired phone would.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isAdminProvisionedWorkspace,
  isOutboxAllowedPath,
  startDaemon,
  type DaemonOptions,
  type RunningDaemon,
} from '../src/daemon/serve.js';
import {
  TerminalManager,
  TerminalUnavailable,
  type PtyFactory,
  type TerminalPty,
} from '../src/daemon/terminal.js';

// The test daemon runs with node-pty simulated ABSENT, whether or not the
// native module is built on this machine, so the 503 path is reproducible
// everywhere (it used to pass only because the sandbox had no native build).
function noPtyTerminals(): TerminalManager {
  return new TerminalManager({
    spawn: async () => {
      throw new TerminalUnavailable();
    },
  });
}
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';

let home: string;
let daemon: RunningDaemon;
let base: string;
let adminToken: string;

async function startOnFreePort(extra: Partial<DaemonOptions> = {}): Promise<RunningDaemon> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 20000);
    try {
      return await startDaemon({
        config: defaultConfig(),
        bind: 'loopback',
        port,
        terminals: noPtyTerminals(),
        ...extra,
      });
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

describe('box-run model, reached from the phone', () => {
  it('reports the configured stack so the phone can label "My computer"', async () => {
    // The phone reads /stack (daemonStack) to show which model the box runs.
    // Start a daemon configured with an orchestrator so the report is non-empty.
    const cfg = defaultConfig();
    cfg.stack.orchestrator = { provider: 'ollama', model: 'qwen' };
    let box: RunningDaemon | undefined;
    for (let attempt = 0; attempt < 30 && !box; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000);
      try {
        box = await startDaemon({ config: cfg, bind: 'loopback', port });
      } catch (err) {
        if (!String(err).includes('EADDRINUSE')) throw err;
      }
    }
    try {
      const res = await fetch(`http://127.0.0.1:${box!.port}/stack`, { headers: auth(adminToken) });
      expect(res.status).toBe(200);
      const stack = (await res.json()) as { orchestrator?: { model: string } };
      expect(stack.orchestrator?.model).toBe('qwen');
    } finally {
      box!.close();
    }
  });

  it('opens a box-run session with no cwd (the "My computer" pick)', async () => {
    // Picking "My computer" starts a desktop session with no repo; the daemon
    // runs the loop in its own working directory. Admin (the box owner) is
    // unrestricted, so this must succeed.
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBeTruthy();
  });
});

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

// The workspace predicates resolve BOTH sides through realpath, so a symlink
// planted inside ~/OSCode that points outside it cannot pass as provisioned
// (the P0-1 escape). HOME is pointed at the scratch dir so ~/OSCode is ours.
describe('workspace predicates follow symlinks (P0-1 prep)', () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  it('a symlink under ~/OSCode that points outside is neither provisioned nor an outbox target', () => {
    process.env.HOME = home;
    const managed = join(home, 'OSCode');
    const outside = join(home, 'elsewhere');
    mkdirSync(managed, { recursive: true });
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(managed, 'real'), { recursive: true });
    symlinkSync(outside, join(managed, 'escape'));

    expect(isAdminProvisionedWorkspace(join(managed, 'real'))).toBe(true);
    expect(isAdminProvisionedWorkspace(join(managed, 'escape'))).toBe(false);
    expect(isOutboxAllowedPath(join(managed, 'escape'), defaultConfig())).toBe(false);
    expect(isOutboxAllowedPath(join(managed, 'real'), defaultConfig())).toBe(true);
    // A configured outbox root is held to the same rule.
    const cfg = defaultConfig();
    cfg.daemon.outboxAllowedRoots = [join(home, 'allowed')];
    mkdirSync(join(home, 'allowed'), { recursive: true });
    symlinkSync(outside, join(home, 'allowed', 'escape'));
    expect(isOutboxAllowedPath(join(home, 'allowed', 'escape'), cfg)).toBe(false);
  });
});

describe('listings are owner-scoped for members (DAE-1)', () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  it("a member lists exactly its own sessions and never another user's cwd or title", async () => {
    process.env.HOME = home;
    const provisioned = join(home, 'OSCode', 'repo');
    mkdirSync(provisioned, { recursive: true });
    const adminCwd = join(home, 'admin-private');
    mkdirSync(adminCwd, { recursive: true });

    // The admin opens a session in a private path; two members open theirs.
    const adminRes = await createSessionAs(adminToken, adminCwd);
    expect(adminRes.status).toBe(201);
    const { id: adminId } = (await adminRes.json()) as { id: string };
    const a = mintCredential({ role: 'member', label: 'A', userId: 'u_a' });
    const b = mintCredential({ role: 'member', label: 'B', userId: 'u_b' });
    const aRes = await createSessionAs(a.token, provisioned);
    expect(aRes.status).toBe(201);
    const { id: aId } = (await aRes.json()) as { id: string };
    const bRes = await createSessionAs(b.token, provisioned);
    expect(bRes.status).toBe(201);
    const { id: bId } = (await bRes.json()) as { id: string };

    const listed = (await (await fetch(`${base}/sessions`, { headers: auth(a.token) })).json()) as {
      live: Array<{ id: string }>;
      stored: Array<{ id: string }>;
    };
    expect(listed.live.map((s) => s.id)).toEqual([aId]);
    expect(listed.stored.map((s) => s.id)).toEqual([aId]);

    // Workspaces: the member sees the provisioned repo, never the admin's path.
    const ws = (await (await fetch(`${base}/workspaces`, { headers: auth(a.token) })).json()) as {
      workspaces: Array<{ cwd: string }>;
    };
    expect(ws.workspaces.some((w) => w.cwd === adminCwd)).toBe(false);
    expect(ws.workspaces.some((w) => w.cwd === provisioned)).toBe(true);

    // The admin still sees everything.
    const all = (await (await fetch(`${base}/sessions`, { headers: auth(adminToken) })).json()) as {
      live: Array<{ id: string }>;
    };
    expect(all.live.map((s) => s.id).sort()).toEqual([adminId, aId, bId].sort());
  });
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
    // node-pty is an optional native module; the test daemon injects a spawn
    // that reports it absent (see noPtyTerminals), so ensure() throws
    // TerminalUnavailable and the route returns a clean 503 on every machine.
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

describe('Stack Health visibility (admin-gated on a shared hub)', () => {
  it('defaults to admins: a member is refused with a distinct reason, an admin is served', async () => {
    const { token: memberToken } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_shm' });
    const mres = await fetch(`${base}/stack-health?range=week`, { headers: auth(memberToken) });
    expect(mres.status).toBe(403);
    expect(((await mres.json()) as { error?: string }).error).toBe('restricted');

    const ares = await fetch(`${base}/stack-health?range=week`, { headers: auth(adminToken) });
    expect(ares.status).toBe(200);
  });

  it('stamps scope honestly: legacy admin is personal, a minted credential is machine', async () => {
    const legacy = await fetch(`${base}/stack-health`, { headers: auth(adminToken) });
    expect(((await legacy.json()) as { scope: string }).scope).toBe('personal');
    const { token: mintedAdmin } = mintCredential({ role: 'admin', label: 'Hub', userId: 'u_sha' });
    const minted = await fetch(`${base}/stack-health`, { headers: auth(mintedAdmin) });
    expect(((await minted.json()) as { scope: string }).scope).toBe('machine');
  });

  it('an admin opens it to everyone and the change takes effect with no restart', async () => {
    const { token: memberToken } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_shm2' });
    expect((await fetch(`${base}/stack-health`, { headers: auth(memberToken) })).status).toBe(403);
    // A member cannot change the setting.
    const denied = await fetch(`${base}/stack-health/visibility`, {
      method: 'POST',
      headers: auth(memberToken),
      body: JSON.stringify({ visibility: 'everyone' }),
    });
    expect(denied.status).toBe(403);
    // An admin can, and the same running daemon then serves the member.
    const set = await fetch(`${base}/stack-health/visibility`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ visibility: 'everyone' }),
    });
    expect(set.status).toBe(200);
    expect((await fetch(`${base}/stack-health`, { headers: auth(memberToken) })).status).toBe(200);
  });
});

// ---- terminal exit, session scoping, body caps, close, eviction, delete ----

/** A pty stand-in the daemon drives over HTTP; the test holds it to trigger
 *  output and exit as the real shell would. */
class RoutePty implements TerminalPty {
  writes: string[] = [];
  private dataCb?: (data: string) => void;
  private exitCb?: (info: { exitCode: number }) => void;
  write(data: string): void {
    this.writes.push(data);
  }
  resize(): void {}
  kill(): void {
    this.exitCb?.({ exitCode: 0 });
  }
  onData(cb: (data: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (info: { exitCode: number }) => void): void {
    this.exitCb = cb;
  }
  emit(text: string): void {
    this.dataCb?.(text);
  }
  exit(code: number): void {
    this.exitCb?.({ exitCode: code });
  }
}

/** Collect SSE data frames until `until` matches one or the stream ends. */
async function readSse(
  res: Response,
  until: (frame: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<{ frames: Array<Record<string, unknown>>; ended: boolean }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Array<Record<string, unknown>> = [];
  let buffer = '';
  let ended = false;
  const deadline = Date.now() + timeoutMs;
  outer: while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      ended = true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        frames.push(parsed);
        if (until(parsed)) {
          // Give the server a beat to end the response, then report.
          const tail = await Promise.race([
            reader.read().then((r) => r.done),
            new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
          ]);
          ended = tail;
          break outer;
        }
      } catch {}
    }
  }
  await reader.cancel().catch(() => {});
  return { frames, ended };
}

describe('terminal exit and session scoping (DAE-5, DAE-14)', () => {
  let ptyDaemon: RunningDaemon;
  let ptyBase: string;
  let pty: RoutePty;

  beforeEach(async () => {
    pty = new RoutePty();
    const spawn: PtyFactory = async () => pty;
    ptyDaemon = await startOnFreePort({
      terminals: new TerminalManager({ spawn, exitGraceMs: 60_000 }),
    });
    ptyBase = `http://127.0.0.1:${ptyDaemon.port}`;
  });
  afterEach(() => ptyDaemon.close());

  async function openTerm(): Promise<{ id: string; termId: string }> {
    const created = await fetch(`${ptyBase}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home }),
    });
    const { id } = (await created.json()) as { id: string };
    const term = await fetch(`${ptyBase}/sessions/${id}/term`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(term.status).toBe(201);
    const { termId } = (await term.json()) as { termId: string };
    return { id, termId };
  }

  it('a shell that exits sends a final {exit, offset} frame, ends the stream, and stdin answers 409', async () => {
    const { id, termId } = await openTerm();
    const res = await fetch(`${ptyBase}/sessions/${id}/term/${termId}/stream?since=0`, {
      headers: auth(adminToken),
    });
    expect(res.status).toBe(200);
    pty.emit('bye\n');
    pty.exit(3);
    const { frames, ended } = await readSse(res, (f) => typeof f.exit === 'number');
    const exit = frames.find((f) => typeof f.exit === 'number');
    expect(exit).toEqual({ exit: 3, offset: 4 });
    expect(ended).toBe(true);

    const stdin = await fetch(`${ptyBase}/sessions/${id}/term/${termId}/stdin`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ dataBase64: Buffer.from('ls\n').toString('base64') }),
    });
    expect(stdin.status).toBe(409);
    expect(((await stdin.json()) as { error: string }).error).toMatch(/exited/i);

    // A stream opened on the dead shell still replays and ends with the frame.
    const late = await fetch(`${ptyBase}/sessions/${id}/term/${termId}/stream?since=0`, {
      headers: auth(adminToken),
    });
    const lateRead = await readSse(late, (f) => typeof f.exit === 'number');
    expect(lateRead.frames.at(-1)).toEqual({ exit: 3, offset: 4 });
  });

  it("a terminal is reachable only through its own session's routes", async () => {
    const { termId } = await openTerm();
    const other = await fetch(`${ptyBase}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home }),
    });
    const { id: otherId } = (await other.json()) as { id: string };
    const stdin = await fetch(`${ptyBase}/sessions/${otherId}/term/${termId}/stdin`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ dataBase64: Buffer.from('x').toString('base64') }),
    });
    expect(stdin.status).toBe(404);
    expect(pty.writes).toEqual([]);
    const stream = await fetch(`${ptyBase}/sessions/${otherId}/term/${termId}/stream?since=0`, {
      headers: auth(adminToken),
    });
    expect(stream.status).toBe(404);
    const killed = await fetch(`${ptyBase}/sessions/${otherId}/term/${termId}`, {
      method: 'DELETE',
      headers: auth(adminToken),
    });
    expect(killed.status).toBe(404);
  });
});

describe('request bodies are capped (DAE-8)', () => {
  it('a 20 MB body is a 413 and the daemon stays up', async () => {
    const big = JSON.stringify({ cwd: home, instructions: 'x'.repeat(20 * 1024 * 1024) });
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: big,
    });
    expect(res.status).toBe(413);
    const health = await fetch(`${base}/health`, { headers: auth(adminToken) });
    expect(health.status).toBe(200);
  });
});

describe('close drops live streams (DAE-11)', () => {
  it('an open SSE stream ends when the daemon closes', async () => {
    const own = await startOnFreePort();
    const ownBase = `http://127.0.0.1:${own.port}`;
    const created = await fetch(`${ownBase}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home }),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`${ownBase}/sessions/${id}/events?since=0`, {
      headers: auth(adminToken),
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    own.close();
    // The read settles (done or an error) instead of hanging on a half-open socket.
    const settled = await Promise.race([
      reader.read().then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise<string>((r) => setTimeout(() => r('hung'), 3000)),
    ]);
    expect(settled).toBe('settled');
  });
});

describe('session lifecycle: eviction and delete (DAE-12)', () => {
  it('an idle driver with no listeners is evicted and rehydrates on the next touch', async () => {
    const own = await startOnFreePort({ idleEviction: { afterMs: 50, everyMs: 20 } });
    const ownBase = `http://127.0.0.1:${own.port}`;
    try {
      const created = await fetch(`${ownBase}/sessions`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ cwd: home }),
      });
      const { id } = (await created.json()) as { id: string };
      const live = async (): Promise<number> =>
        ((await (await fetch(`${ownBase}/health`, { headers: auth(adminToken) })).json()) as {
          sessions: number;
        }).sessions;
      expect(await live()).toBe(1);
      const deadline = Date.now() + 3000;
      while ((await live()) !== 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(await live()).toBe(0);
      // Still listed, and reachable: touching it rehydrates from the journal.
      const stored = (await (
        await fetch(`${ownBase}/sessions`, { headers: auth(adminToken) })
      ).json()) as { stored: Array<{ id: string }> };
      expect(stored.stored.map((s) => s.id)).toContain(id);
      const files = await fetch(`${ownBase}/sessions/${id}/files?q=`, {
        headers: auth(adminToken),
      });
      expect(files.status).toBe(200);
      expect(await live()).toBe(1);
    } finally {
      own.close();
    }
  });

  it('DELETE /sessions/:id removes the stored session for its owner, 403 for another member', async () => {
    const realHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const provisioned = join(home, 'OSCode', 'repo');
      mkdirSync(provisioned, { recursive: true });
      const a = mintCredential({ role: 'member', label: 'A', userId: 'u_del_a' });
      const b = mintCredential({ role: 'member', label: 'B', userId: 'u_del_b' });
      const created = await createSessionAs(a.token, provisioned);
      const { id } = (await created.json()) as { id: string };

      const denied = await fetch(`${base}/sessions/${id}`, {
        method: 'DELETE',
        headers: auth(b.token),
      });
      expect(denied.status).toBe(403);

      const ok = await fetch(`${base}/sessions/${id}`, {
        method: 'DELETE',
        headers: auth(a.token),
      });
      expect(ok.status).toBe(200);
      expect(existsSync(join(home, 'sessions', id))).toBe(false);
      const gone = await fetch(`${base}/sessions/${id}`, {
        method: 'DELETE',
        headers: auth(adminToken),
      });
      expect(gone.status).toBe(404);
      const listed = (await (await fetch(`${base}/sessions`, { headers: auth(a.token) })).json()) as {
        live: unknown[];
        stored: unknown[];
      };
      expect(listed.live).toEqual([]);
      expect(listed.stored).toEqual([]);
    } finally {
      process.env.HOME = realHome;
    }
  });

  it('DELETE /sessions/:id refuses a path-shaped id', async () => {
    const res = await fetch(`${base}/sessions/..`, { method: 'DELETE', headers: auth(adminToken) });
    expect(res.status).toBe(404);
    expect(existsSync(join(home, 'daemon.token'))).toBe(true);
  });
});

describe('clone target names (DAE-16)', () => {
  it('rejects a url whose basename is . or ..', async () => {
    for (const url of ['https://github.com/owner/..', 'https://github.com/owner/.', 'https://github.com/owner/.git']) {
      const res = await fetch(`${base}/workspaces/clone`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ url }),
      });
      expect(res.status, url).toBe(400);
    }
  });
});

describe('the user command lane is admin-only (P0-1)', () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  it('a member gets a distinct 403 restricted on commands, stdin, and kill', async () => {
    process.env.HOME = home;
    const provisioned = join(home, 'OSCode', 'repo');
    mkdirSync(provisioned, { recursive: true });
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_cmd' });
    const created = await createSessionAs(token, provisioned);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const run = await fetch(`${base}/sessions/${id}/commands`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ command: 'id' }),
    });
    expect(run.status).toBe(403);
    const body = (await run.json()) as { error: string; message?: string };
    expect(body.error).toBe('restricted');
    expect(body.message).toMatch(/admin/i);

    for (const tail of ['stdin', 'kill']) {
      const res = await fetch(`${base}/sessions/${id}/commands/r1/${tail}`, {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ data: 'x' }),
      });
      expect(res.status, tail).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('restricted');
    }
    // The health probe still tells the phone its role, so it can hide the lane.
    const health = (await (await fetch(`${base}/health`, { headers: auth(token) })).json()) as {
      role: string;
    };
    expect(health.role).toBe('member');
  });
});

describe('CORS posture (DAE-15)', () => {
  it('keeps * for authorized answers, never sends allow-credentials, and stays opaque on 401', async () => {
    const preflight = await fetch(`${base}/sessions`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();

    const ok = await fetch(`${base}/health`, { headers: auth(adminToken) });
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();

    const unauthorized = await fetch(`${base}/health`, {
      headers: { authorization: 'Bearer osc_wrong' },
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('access-control-allow-origin')).toBeNull();
    expect(unauthorized.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('daemon settings come from the global config only (DAE-9)', () => {
  it('a project os-code.config.json in the daemon cwd cannot widen the outbox roots', async () => {
    const cwdBefore = process.cwd();
    const repo = join(home, 'project-repo');
    mkdirSync(repo, { recursive: true });
    const daemonCwd = join(home, 'daemon-cwd');
    mkdirSync(daemonCwd, { recursive: true });
    writeFileSync(
      join(daemonCwd, 'os-code.config.json'),
      JSON.stringify({ daemon: { outboxAllowedRoots: [repo] } }),
    );
    process.chdir(daemonCwd);
    try {
      const res = await fetch(`${base}/outbox/apply`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({
          cwd: repo,
          clientOpId: 'op-9',
          itemId: 'itm-9',
          deviceId: 'dev-9',
          branch: 'main',
          baseCommit: 'abc123',
          files: [],
        }),
      });
      expect(res.status).toBe(403);
      // The same root in the GLOBAL config is honored (fresh read, no restart).
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({
          stack: { orchestrator: { provider: 'ollama', model: 'qwen' } },
          daemon: { outboxAllowedRoots: [repo] },
        }),
      );
      const allowed = await fetch(`${base}/outbox/apply`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({
          cwd: repo,
          clientOpId: 'op-9',
          itemId: 'itm-9',
          deviceId: 'dev-9',
          branch: 'main',
          baseCommit: 'abc123',
          files: [],
        }),
      });
      // Past the allowlist gate now: the repo is not a git repo, so apply says so.
      expect(allowed.status).not.toBe(403);
    } finally {
      process.chdir(cwdBefore);
    }
  });
});

describe('permission mode on a remote-attached session (ENG-1, daemon half)', () => {
  it('bypassPermissions is downgraded to acceptEdits with an announced note', async () => {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home, permissionMode: 'bypassPermissions' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { mode: string; warnings: string[] };
    expect(body.mode).toBe('acceptEdits');
    expect(body.warnings.join('\n')).toMatch(/bypassPermissions/);
    const plain = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home, permissionMode: 'plan' }),
    });
    expect(((await plain.json()) as { mode: string }).mode).toBe('plan');
  });
});
