// The daemon's routine routes, driven over HTTP the way the phone drives
// them: reading is open to a member (scoped to what it owns), every change is
// admin-only, and a routine can only point at an allowed workspace on this
// machine. HOME is pointed at the scratch dir so ~/OSCode is ours.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';
import { _resetRoutineScheduler } from '../src/routines/scheduler.js';

let home: string;
let daemon: RunningDaemon;
let base: string;
let adminToken: string;
let realHome: string | undefined;

async function startOnFreePort(): Promise<RunningDaemon> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 20000);
    try {
      return await startDaemon({
        config: defaultConfig(),
        bind: 'loopback',
        port,
        terminals: new TerminalManager({
          spawn: async () => {
            throw new TerminalUnavailable();
          },
        }),
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
  realHome = process.env.HOME;
  process.env.HOME = home;
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
  );
  mkdirSync(join(home, 'OSCode', 'repo'), { recursive: true });
  _resetRoutineScheduler();
  daemon = await startOnFreePort();
  base = `http://127.0.0.1:${daemon.port}`;
  adminToken = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
});

afterEach(() => {
  daemon.close();
  _resetRoutineScheduler();
  process.env.HOME = realHome;
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function routineBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Morning review',
    agentName: 'Reviewer',
    persona: 'A calm reviewer.',
    task: 'Review what changed.',
    cwd: join(home, 'OSCode', 'repo'),
    schedule: { hour: 6, minute: 0, days: [1, 2, 3, 4, 5] },
    ...overrides,
  };
}

describe('daemon routine routes', () => {
  it('starts empty, creates a routine in an allowed workspace, and refuses one outside', async () => {
    const empty = await fetch(`${base}/routines`, { headers: auth(adminToken) });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ routines: [], runs: [] });

    const outside = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody({ cwd: home })),
    });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { error: string }).error).toContain('workspace');

    const badClock = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody({ schedule: { hour: 24, minute: 0, days: [] } })),
    });
    expect(badClock.status).toBe(400);

    const created = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody()),
    });
    expect(created.status).toBe(201);
    const { routine } = (await created.json()) as {
      routine: { id: string; presence: string; nextRunAt?: string; access: string };
    };
    expect(routine.presence).toBe('idle');
    expect(routine.access).toBe('read-only');
    expect(routine.nextRunAt).toBeDefined();

    const listed = await fetch(`${base}/routines`, { headers: auth(adminToken) });
    const body = (await listed.json()) as { routines: Array<{ id: string }> };
    expect(body.routines.map((r) => r.id)).toEqual([routine.id]);
  });

  it('is admin-only to change, and a member reads only what it owns', async () => {
    const { token: member } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_m' });
    const refused = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(member),
      body: JSON.stringify(routineBody()),
    });
    expect(refused.status).toBe(403);

    const created = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody()),
    });
    const { routine } = (await created.json()) as { routine: { id: string } };

    const memberList = await fetch(`${base}/routines`, { headers: auth(member) });
    expect(((await memberList.json()) as { routines: unknown[] }).routines).toEqual([]);
    const memberGet = await fetch(`${base}/routines/${routine.id}`, {
      method: 'POST',
      headers: auth(member),
      body: JSON.stringify({ enabled: false }),
    });
    expect(memberGet.status).toBe(404);
  });

  it('patches a routine as a whole (pause, reschedule), and validates the result', async () => {
    const created = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody()),
    });
    const { routine } = (await created.json()) as { routine: { id: string; nextRunAt: string } };

    const paused = await fetch(`${base}/routines/${routine.id}`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ enabled: false }),
    });
    expect(paused.status).toBe(200);
    const pausedBody = (await paused.json()) as {
      routine: { presence: string; nextRunAt?: string; enabled: boolean };
    };
    expect(pausedBody.routine.enabled).toBe(false);
    expect(pausedBody.routine.presence).toBe('paused');
    expect(pausedBody.routine.nextRunAt).toBeUndefined();

    const bad = await fetch(`${base}/routines/${routine.id}`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ maxMinutes: 1 }),
    });
    expect(bad.status).toBe(400);

    const moved = await fetch(`${base}/routines/${routine.id}`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ cwd: home }),
    });
    expect(moved.status).toBe(400);
  });

  it('answers 404 for a missing note, and deletes a routine with its runs', async () => {
    const created = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody()),
    });
    const { routine } = (await created.json()) as { routine: { id: string } };
    const note = await fetch(`${base}/routines/runs/nope/note`, { headers: auth(adminToken) });
    expect(note.status).toBe(404);

    const gone = await fetch(`${base}/routines/${routine.id}`, {
      method: 'DELETE',
      headers: auth(adminToken),
    });
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual({ deleted: true });
    const listed = await fetch(`${base}/routines`, { headers: auth(adminToken) });
    expect(((await listed.json()) as { routines: unknown[] }).routines).toEqual([]);
  });
});
