// The daemon's Agentic Currents routes: the host probe is open to any member,
// a Hermes home's notes are admin-only and jailed to that home, and a session
// created with a current handle accepts it (a malformed one is dropped, never
// refused). HOME is pointed at a scratch dir; HERMES_HOME at a seeded folder.
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
let hermes: string;
let daemon: RunningDaemon;
let base: string;
let adminToken: string;
let realHome: string | undefined;
let realHermesHome: string | undefined;

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
  hermes = mkdtempSync(join(tmpdir(), 'hermes-'));
  writeFileSync(join(hermes, 'MEMORY.md'), '# memory\nlikes tea');
  mkdirSync(join(hermes, 'skills', 'notes'), { recursive: true });
  writeFileSync(join(hermes, 'skills', 'notes', 'SKILL.md'), '# notes');
  writeFileSync(join(hermes, 'config.yaml'), 'api_key: secret');
  process.env.OSC_HOME = home;
  realHome = process.env.HOME;
  realHermesHome = process.env.HERMES_HOME;
  process.env.HOME = home;
  process.env.HERMES_HOME = hermes;
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
  if (realHermesHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = realHermesHome;
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(hermes, { recursive: true, force: true });
});

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('daemon currents routes', () => {
  it('probes the host for any member', async () => {
    const { token: member } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_m' });
    const res = await fetch(`${base}/currents`, { headers: auth(member) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hermes: { home: string; present: boolean }; cli: object };
    expect(body.hermes).toEqual({ home: hermes, present: true });
    expect(body.cli).toEqual({ claude: expect.any(Boolean), codex: expect.any(Boolean) });
  });

  it('serves Hermes notes to an admin only, markdown only, jailed', async () => {
    const { token: member } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_m' });
    expect((await fetch(`${base}/currents/hermes/notes`, { headers: auth(member) })).status).toBe(
      403,
    );

    const list = await fetch(`${base}/currents/hermes/notes`, { headers: auth(adminToken) });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { home: string; notes: Array<{ path: string }> };
    expect(body.home).toBe(hermes);
    expect(body.notes.map((n) => n.path).sort()).toEqual(['MEMORY.md', 'skills/notes/SKILL.md']);

    const note = await fetch(`${base}/currents/hermes/notes/MEMORY.md`, {
      headers: auth(adminToken),
    });
    expect(note.status).toBe(200);
    expect(((await note.json()) as { text: string }).text).toContain('likes tea');

    const skill = await fetch(`${base}/currents/hermes/notes/skills/notes/SKILL.md`, {
      headers: auth(adminToken),
    });
    expect(skill.status).toBe(200);

    for (const bad of ['config.yaml', '..%2FMEMORY.md', 'skills/notes/helper.py']) {
      const res = await fetch(`${base}/currents/hermes/notes/${bad}`, {
        headers: auth(adminToken),
      });
      expect(res.status, bad).toBe(404);
    }
  });

  it('accepts a current handle on session create and drops a malformed one', async () => {
    const good = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({
        cwd: join(home, 'OSCode', 'repo'),
        currents: { hermes: { baseUrl: 'http://box:8642/v1/' } },
      }),
    });
    expect(good.status).toBe(201);

    const malformed = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({
        cwd: join(home, 'OSCode', 'repo'),
        currents: { hermes: { baseUrl: 'file:///etc' }, cli: { command: 'rm' } },
      }),
    });
    expect(malformed.status).toBe(201);
  });
});
