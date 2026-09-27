// The daemon's authorization and request-hygiene surface: a member device
// credential must NOT be able to open a session outside an admin-provisioned
// workspace or touch another user's session (D1), and a malformed or
// under-specified request body must fail loudly rather than resolve as a silent
// empty object (P2-7). These start a real loopback daemon and drive it over
// HTTP, the way a paired phone would.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  desktopChatSystem,
  isAdminProvisionedWorkspace,
  isOutboxAllowedPath,
  startDaemon,
  type DaemonOptions,
  type RunningDaemon,
} from '../src/daemon/serve.js';
import { SEARCH_PROTOCOL_NOTE } from '../src/harness/localSearch.js';
import { memorySegment } from '../src/core/agent/projectMemory.js';
import {
  TerminalManager,
  TerminalUnavailable,
  type PtyFactory,
  type TerminalPty,
} from '../src/daemon/terminal.js';
import { HOME_SHELL_ID } from '../src/daemon/homeShellId.js';

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

// Every session the daemon boots, with the tools it registered, its vault
// root, its workspace, and the project it carries, so a test can check what a
// member's agent was handed and what a rehydrate kept. The real bootstrap runs
// untouched; this only records its result.
const booted = vi.hoisted(
  () =>
    [] as Array<{
      id: string;
      tools: string[];
      vaultRoot: string | undefined;
      cwd: string;
      projectName: string | undefined;
      instructions: string | undefined;
    }>,
);
vi.mock('../src/core/agent/bootstrap.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/agent/bootstrap.js')>();
  return {
    ...real,
    bootstrapSession: (options: Parameters<typeof real.bootstrapSession>[0]) => {
      const result = real.bootstrapSession(options);
      booted.push({
        id: result.driver.id,
        tools: result.tools.specs().map((spec) => spec.name),
        vaultRoot: result.toolContext.vaultRoot,
        cwd: result.toolContext.cwd,
        projectName: result.toolContext.projectName,
        // The standing instructions the agent will send (a private field).
        instructions: (result.agent as unknown as { instructions?: string }).instructions,
      });
      return result;
    },
  };
});

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

// Project trust from a paired phone: the owner's tap trusts the session's
// folder on the computer; a member on a shared hub cannot, since trusting lets
// a folder's own settings loosen OpenShore on that machine.
describe('POST /sessions/:id/trust (project trust)', () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  it("the owner trusts the session's folder; a member is refused", async () => {
    process.env.HOME = home;
    const provisioned = join(home, 'OSCode', 'repo');
    mkdirSync(provisioned, { recursive: true });
    writeFileSync(
      join(provisioned, 'os-code.config.json'),
      JSON.stringify({ harness: { verify: { command: 'npm test' } } }),
    );

    const member = mintCredential({ role: 'member', label: 'Phone', userId: 'u_trust' });
    const memberRes = await createSessionAs(member.token, provisioned);
    expect(memberRes.status).toBe(201);
    const { id: memberId } = (await memberRes.json()) as { id: string };
    const refused = await fetch(`${base}/sessions/${memberId}/trust`, {
      method: 'POST',
      headers: auth(member.token),
      body: '{}',
    });
    expect(refused.status).toBe(403);
    expect(existsSync(join(home, 'trust.json'))).toBe(false);

    const ownerRes = await createSessionAs(adminToken, provisioned);
    const { id: ownerId } = (await ownerRes.json()) as { id: string };
    const trusted = await fetch(`${base}/sessions/${ownerId}/trust`, {
      method: 'POST',
      headers: auth(adminToken),
      body: '{}',
    });
    expect(trusted.status).toBe(200);
    const store = JSON.parse(readFileSync(join(home, 'trust.json'), 'utf8')) as {
      folders: Record<string, { trust?: unknown }>;
    };
    expect(Object.values(store.folders).some((f) => Boolean(f.trust))).toBe(true);
  });
});

// The workspace predicates resolve BOTH sides through realpath, so a symlink
// planted inside ~/OSCode that points outside it cannot pass as provisioned
// (the P0-1 escape). HOME is pointed at the scratch dir so ~/OSCode is ours.
// Interim isolation on a shared hub: the vault is the machine owner's one
// folder, so a member's agent gets no vault tool at all until each member has
// a root of their own. The owner's sessions keep theirs.
describe('a member session gets no vault tools on a shared hub', () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });
  const VAULT_TOOLS = [
    'vaultSearch',
    'vaultRead',
    'vaultBacklinks',
    'vaultList',
    'vaultLookup',
    'vaultWrite',
  ];
  const bootOf = (id: string) => booted.filter((b) => b.id === id).at(-1)!;

  it("a member's tool list has no vault tool, and the owner's is unchanged", async () => {
    process.env.HOME = home;
    const provisioned = join(home, 'OSCode', 'repo');
    mkdirSync(provisioned, { recursive: true });
    const ownerRes = await createSessionAs(adminToken, provisioned);
    expect(ownerRes.status).toBe(201);
    const { id: ownerId } = (await ownerRes.json()) as { id: string };
    const member = mintCredential({ role: 'member', label: 'Phone', userId: 'u_vault' });
    const memberRes = await createSessionAs(member.token, provisioned);
    expect(memberRes.status).toBe(201);
    const { id: memberId } = (await memberRes.json()) as { id: string };

    const owner = bootOf(ownerId);
    expect(owner.tools).toEqual(expect.arrayContaining(VAULT_TOOLS));
    expect(owner.vaultRoot).toBe(join(home, 'OSCode', 'Vault'));
    const mine = bootOf(memberId);
    expect(mine.tools.filter((name) => name.startsWith('vault'))).toEqual([]);
    expect(mine.vaultRoot).toBeUndefined();
    // Nothing else moves: the member keeps every other tool the owner has.
    expect(mine.tools).toEqual(owner.tools.filter((name) => !VAULT_TOOLS.includes(name)));
  });

  it('stays off when an admin reopens the member session after a restart', async () => {
    process.env.HOME = home;
    const provisioned = join(home, 'OSCode', 'repo');
    mkdirSync(provisioned, { recursive: true });
    const member = mintCredential({ role: 'member', label: 'Phone', userId: 'u_vault2' });
    const { id: memberId } = (await (await createSessionAs(member.token, provisioned)).json()) as {
      id: string;
    };
    const { id: ownerId } = (await (await createSessionAs(adminToken, provisioned)).json()) as {
      id: string;
    };

    // A restart drops every live driver; the next touch rehydrates from disk.
    daemon.close();
    daemon = await startOnFreePort();
    base = `http://127.0.0.1:${daemon.port}`;
    for (const id of [memberId, ownerId]) {
      const res = await fetch(`${base}/sessions/${id}/files?q=`, { headers: auth(adminToken) });
      expect(res.status).toBe(200);
    }
    // Booted twice: at create, then the rehydrate the admin's touch caused.
    expect(booted.filter((b) => b.id === memberId)).toHaveLength(2);
    expect(bootOf(memberId).tools.filter((name) => name.startsWith('vault'))).toEqual([]);
    expect(bootOf(memberId).vaultRoot).toBeUndefined();
    expect(bootOf(ownerId).tools).toEqual(expect.arrayContaining(VAULT_TOOLS));
  });

  // Taking the vault tools away is not enough on its own: a member session
  // whose workspace IS the vault (or holds it) reads the owner's notes with
  // readFile and grep, which never ask. So a member cannot open one there.
  it('a member cannot open a session in the vault or in a folder that holds it', async () => {
    process.env.HOME = home;
    const managed = join(home, 'OSCode');
    const vault = join(managed, 'Vault');
    mkdirSync(join(vault, 'Private'), { recursive: true });
    writeFileSync(join(vault, 'Private', 'Diary.md'), 'owner secret diary');
    mkdirSync(join(managed, 'repo'), { recursive: true });
    // A link under ~/OSCode that points at the vault is the vault.
    symlinkSync(vault, join(managed, 'notes-link'));
    const member = mintCredential({ role: 'member', label: 'Phone', userId: 'u_vault3' });
    const before = booted.length;
    for (const cwd of [vault, join(vault, 'Private'), managed, join(managed, 'notes-link')]) {
      const res = await createSessionAs(member.token, cwd);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toMatch(/vault/);
    }
    // Nothing booted for the refused member, so no tool ever held the path.
    expect(booted.length).toBe(before);
    // A provisioned repo beside the vault still opens for the member.
    expect((await createSessionAs(member.token, join(managed, 'repo'))).status).toBe(201);
    // The owner is unrestricted, as before.
    for (const cwd of [vault, managed]) {
      expect((await createSessionAs(adminToken, cwd)).status).toBe(201);
    }
  });

  it('a vault configured inside a provisioned repo keeps members out of that repo', async () => {
    process.env.HOME = home;
    const repo = join(home, 'OSCode', 'repo');
    const other = join(home, 'OSCode', 'other');
    mkdirSync(join(repo, 'notes'), { recursive: true });
    mkdirSync(other, { recursive: true });
    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as object;
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ ...config, vault: { dir: '~/OSCode/repo/notes' } }),
    );
    const member = mintCredential({ role: 'member', label: 'Phone', userId: 'u_vault4' });
    expect((await createSessionAs(member.token, repo)).status).toBe(403);
    expect((await createSessionAs(member.token, other)).status).toBe(201);
  });

  it("a member's stored session in the vault is not revived", async () => {
    process.env.HOME = home;
    const vault = join(home, 'OSCode', 'Vault');
    mkdirSync(vault, { recursive: true });
    // A session a member opened in the vault before the gate existed.
    const id = 'oldvault1';
    mkdirSync(join(home, 'sessions', id), { recursive: true });
    const stamp = new Date().toISOString();
    writeFileSync(
      join(home, 'sessions', id, 'info.json'),
      JSON.stringify({
        id,
        cwd: vault,
        title: 'Old',
        createdAt: stamp,
        updatedAt: stamp,
        ownerUserId: 'u_vault5',
      }),
    );
    const member = mintCredential({ role: 'member', label: 'Phone', userId: 'u_vault5' });
    const res = await fetch(`${base}/sessions/${id}/files?q=Diary`, {
      headers: auth(member.token),
    });
    expect(res.status).toBe(403);
    expect(booted.some((b) => b.id === id)).toBe(false);
  });
});

// A session outlives a daemon restart. The rehydrate used to boot it with no
// project, so its memory notes fell back to the workspace's folder name (the
// split 0.16 set out to end) and the project's standing instructions dropped.
describe('a revived session keeps its project', () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  it('keeps the project name and instructions across a restart', async () => {
    process.env.HOME = home;
    const cwd = join(home, 'OSCode', 'my-app');
    mkdirSync(cwd, { recursive: true });
    const created = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd, projectName: 'My App', instructions: 'Keep every screen calm.' }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const first = booted.filter((b) => b.id === id).at(-1)!;
    expect(first.projectName).toBe('My App');

    // The project rides in info.json sealed, like the title: never plain text.
    const info = readFileSync(join(home, 'sessions', id, 'info.json'), 'utf8');
    expect(info).not.toContain('Keep every screen calm.');
    expect(info).not.toContain('My App');

    daemon.close();
    daemon = await startOnFreePort();
    base = `http://127.0.0.1:${daemon.port}`;
    expect(
      (await fetch(`${base}/sessions/${id}/files?q=`, { headers: auth(adminToken) })).status,
    ).toBe(200);
    const revived = booted.filter((b) => b.id === id);
    expect(revived).toHaveLength(2);
    expect(revived[1]!.projectName).toBe('My App');
    expect(memorySegment(revived[1]!.projectName, revived[1]!.cwd)).toBe(
      memorySegment(first.projectName, first.cwd),
    );
    expect(revived[1]!.instructions).toBe('Keep every screen calm.');
    // The listing stays as it was: no project or instructions on the wire.
    const listing = (await (
      await fetch(`${base}/sessions`, { headers: auth(adminToken) })
    ).json()) as {
      stored: Array<Record<string, unknown>>;
    };
    const row = listing.stored.find((s) => s.id === id)!;
    expect(row).not.toHaveProperty('instructions');
    expect(row).not.toHaveProperty('projectName');
  });

  it('keeps instructions the person changed mid-session', async () => {
    process.env.HOME = home;
    const cwd = join(home, 'OSCode', 'my-app');
    mkdirSync(cwd, { recursive: true });
    const created = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd, projectName: 'My App', instructions: 'Old rule.' }),
    });
    const { id } = (await created.json()) as { id: string };
    const set = await fetch(`${base}/sessions/${id}/instructions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ text: 'New rule.' }),
    });
    expect(set.status).toBe(200);

    daemon.close();
    daemon = await startOnFreePort();
    base = `http://127.0.0.1:${daemon.port}`;
    await fetch(`${base}/sessions/${id}/files?q=`, { headers: auth(adminToken) });
    expect(booted.filter((b) => b.id === id).at(-1)!.instructions).toBe('New rule.');
  });
});

// Vault v1, 1.5: the app's Memory switch rides the session body. Only an
// explicit false turns project memory off; anything else leaves config in
// charge, and a malformed value never refuses the session.
describe('POST /sessions carries the Memory switch', () => {
  async function toolsFor(body: Record<string, unknown>): Promise<string[]> {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home, ...body }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    return booted.filter((b) => b.id === id).at(-1)!.tools;
  }

  it('memory false leaves projectMemoryWrite out; true, absent, or junk keep it', async () => {
    expect(await toolsFor({ memory: false })).not.toContain('projectMemoryWrite');
    expect(await toolsFor({ memory: true })).toContain('projectMemoryWrite');
    expect(await toolsFor({})).toContain('projectMemoryWrite');
    expect(await toolsFor({ memory: 'off' })).toContain('projectMemoryWrite');
  });
});

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
  it("carries the chat's own context below the fixed system line, capped", () => {
    const bare = desktopChatSystem(undefined);
    expect(desktopChatSystem('  ')).toBe(bare);
    expect(desktopChatSystem({ role: 'system' })).toBe(bare);
    const withContext = desktopChatSystem('Project brief: ship the login screen.');
    expect(withContext.startsWith(bare)).toBe(true);
    expect(withContext).toContain('Project brief: ship the login screen.');
    expect(desktopChatSystem('x'.repeat(50_000)).length).toBeLessThan(bare.length + 8100);
  });

  it('adds the search instruction only when the phone asks for it', () => {
    expect(desktopChatSystem(undefined)).not.toContain(SEARCH_PROTOCOL_NOTE);
    const withSearch = desktopChatSystem('Project brief.', true);
    expect(withSearch).toContain(SEARCH_PROTOCOL_NOTE);
    expect(withSearch).toContain('Project brief.');
  });

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

  it('still streams when the phone asks for the search instruction', async () => {
    const res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], search: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/"type":"(error|done|text)"/);
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
    const { token: memberToken } = mintCredential({
      role: 'member',
      label: 'Phone',
      userId: 'u_shm',
    });
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
    const { token: memberToken } = mintCredential({
      role: 'member',
      label: 'Phone',
      userId: 'u_shm2',
    });
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

describe('the plain home shell (no session behind it)', () => {
  let shellDaemon: RunningDaemon;
  let shellBase: string;
  let pty: RoutePty;
  let spawnCwds: string[];

  beforeEach(async () => {
    pty = new RoutePty();
    spawnCwds = [];
    const spawn: PtyFactory = async (opts) => {
      spawnCwds.push(opts.cwd);
      return pty;
    };
    shellDaemon = await startOnFreePort({
      terminals: new TerminalManager({ spawn, exitGraceMs: 60_000 }),
    });
    shellBase = `http://127.0.0.1:${shellDaemon.port}`;
  });
  afterEach(() => shellDaemon.close());

  async function openHome(token = adminToken): Promise<Response> {
    return fetch(`${shellBase}/sessions/${HOME_SHELL_ID}/term`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
  }

  it('opens a shell in the home folder with no session, and reopening lands in the same one', async () => {
    const first = await openHome();
    expect(first.status).toBe(201);
    const { termId } = (await first.json()) as { termId: string };
    expect(spawnCwds).toEqual([homedir()]);

    const again = await openHome();
    expect(again.status).toBe(201);
    expect(((await again.json()) as { termId: string }).termId).toBe(termId);
    expect(spawnCwds).toHaveLength(1);

    const stdin = await fetch(`${shellBase}/sessions/${HOME_SHELL_ID}/term/${termId}/stdin`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ dataBase64: Buffer.from('ls\n').toString('base64') }),
    });
    expect(stdin.status).toBe(200);
    expect(pty.writes).toEqual(['ls\n']);
  });

  it('a shell that exited is replaced by a fresh one on the next open', async () => {
    const first = await openHome();
    const { termId } = (await first.json()) as { termId: string };
    pty.exit(0);
    const next = await openHome();
    expect(((await next.json()) as { termId: string }).termId).not.toBe(termId);
    expect(spawnCwds).toHaveLength(2);
  });

  it('a member cannot open the home shell', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const res = await openHome(token);
    expect(res.status).toBe(403);
    expect(spawnCwds).toEqual([]);
  });

  it('answers only its terminal routes, and a session cannot reach its shell', async () => {
    const events = await fetch(`${shellBase}/sessions/${HOME_SHELL_ID}/events?since=0`, {
      headers: auth(adminToken),
    });
    expect(events.status).toBe(404);

    const opened = await openHome();
    const { termId } = (await opened.json()) as { termId: string };
    const created = await fetch(`${shellBase}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home }),
    });
    const { id } = (await created.json()) as { id: string };
    const stdin = await fetch(`${shellBase}/sessions/${id}/term/${termId}/stdin`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ dataBase64: Buffer.from('x').toString('base64') }),
    });
    expect(stdin.status).toBe(404);
    expect(pty.writes).toEqual([]);
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
        (
          (await (await fetch(`${ownBase}/health`, { headers: auth(adminToken) })).json()) as {
            sessions: number;
          }
        ).sessions;
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
      const listed = (await (
        await fetch(`${base}/sessions`, { headers: auth(a.token) })
      ).json()) as {
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
    for (const url of [
      'https://github.com/owner/..',
      'https://github.com/owner/.',
      'https://github.com/owner/.git',
    ]) {
      const res = await fetch(`${base}/workspaces/clone`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ url }),
      });
      expect(res.status, url).toBe(400);
    }
  });
});

describe('the phone sees what is on this computer, and clones land once', () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  function plantClone(name: string, origin: string): string {
    const dir = join(home, 'OSCode', name);
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'config'), `[remote "origin"]\n\turl = ${origin}\n`);
    return dir;
  }

  it('lists a clone under ~/OSCode before its first chat, with its origin and no credentials', async () => {
    process.env.HOME = home;
    const dir = plantClone(
      'openshore-hq',
      'https://x-access-token:ghu_leak@github.com/o/openshore-hq.git',
    );
    const ws = (await (
      await fetch(`${base}/workspaces`, { headers: auth(adminToken) })
    ).json()) as {
      workspaces: Array<{ cwd: string; name: string; remote?: string }>;
    };
    expect(ws.workspaces).toContainEqual({
      cwd: dir,
      name: 'openshore-hq',
      remote: 'https://github.com/o/openshore-hq.git',
    });
    expect(JSON.stringify(ws)).not.toContain('ghu_leak');
  });

  it('answers a clone of a repository already there with its folder, and refuses a name clash', async () => {
    process.env.HOME = home;
    const dir = plantClone('site', 'git@github.com:o/site.git');
    const same = await fetch(`${base}/workspaces/clone`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ url: 'https://github.com/o/site.git', token: 'ghu_tok' }),
    });
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ cwd: dir, name: 'site' });

    const clash = await fetch(`${base}/workspaces/clone`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ url: 'https://github.com/someone-else/site.git', token: 'ghu_tok' }),
    });
    expect(clash.status).toBe(400);
    const body = (await clash.json()) as { error: string };
    expect(body.error).toMatch(/A different repository already uses the folder OSCode\/site/);
    expect(body.error).not.toContain('ghu_tok');
  });

  it('keeps cloning admin-only: a member cannot provision the computer', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_clone' });
    const res = await fetch(`${base}/workspaces/clone`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ url: 'https://github.com/o/r.git', token: 'ghu_tok' }),
    });
    expect(res.status).toBe(403);
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
    expect(body.warnings.join('\n')).toMatch(/bypass permissions is not available/i);
    const plain = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home, permissionMode: 'plan' }),
    });
    expect(((await plain.json()) as { mode: string }).mode).toBe('plan');
    // The mode-change route answers with the effective mode and the note too.
    const created = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home }),
    });
    const { id } = (await created.json()) as { id: string };
    const changed = await fetch(`${base}/sessions/${id}/mode`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ mode: 'bypassPermissions' }),
    });
    expect(changed.status).toBe(200);
    const change = (await changed.json()) as { mode: string; note?: string };
    expect(change.mode).toBe('acceptEdits');
    expect(change.note).toMatch(/bypass permissions is not available/i);
  });
});
