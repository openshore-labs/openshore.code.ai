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

  it('a member cannot apply an outbox commit into an arbitrary repo path', async () => {
    // The apply pushes with the desktop's credentials, so an un-provisioned
    // path (here the scratch home) must be refused before any git work.
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await fetch(`${base}/outbox/apply`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        cwd: home,
        clientOpId: 'op1',
        itemId: 'it1',
        branch: 'main',
        baseCommit: 'HEAD',
        files: [],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('a member cannot verify an outbox commit in an arbitrary repo path', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await fetch(
      `${base}/outbox/verify?cwd=${encodeURIComponent(home)}&commit=deadbeef&branch=main`,
      { headers: auth(token) },
    );
    expect(res.status).toBe(403);
  });

  it('an admin may reach the outbox routes (past the path gate)', async () => {
    // The scratch home is not a git repo, so apply fails downstream, but the
    // admin is never stopped by the 403 path gate: the status is not 403.
    const res = await fetch(`${base}/outbox/apply`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({
        cwd: home,
        clientOpId: 'op2',
        itemId: 'it2',
        branch: 'main',
        baseCommit: 'HEAD',
        files: [],
      }),
    });
    expect(res.status).not.toBe(403);
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
