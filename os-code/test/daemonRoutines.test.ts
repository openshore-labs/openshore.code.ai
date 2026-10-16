// The daemon's routine routes, driven over HTTP the way the phone drives
// them: reading is open to a member (scoped to what it owns), every change is
// admin-only, and a routine can only point at an allowed workspace on this
// machine. HOME is pointed at the scratch dir so ~/OpenShore/Projects is ours.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';
import {
  RoutineScheduler,
  _resetRoutineScheduler,
  type RoutineDriver,
} from '../src/routines/scheduler.js';
import { appendRun, createRoutine } from '../src/routines/store.js';
import type { DriverEvent } from '../src/core/agent/types.js';
import { validateRoutineInput } from '../src/routines/model.js';
import { vaultRootFor } from '../src/core/vault/memberRoots.js';
import { VAULT_NOTES_ROUTE, vaultNoteRoute } from '../src/daemon/vaultWire.js';
import {
  portUnavailable,
  restoreHome,
  saveHome,
  setHome,
  type SavedHome,
} from './helpers/portable.js';

let home: string;
let daemon: RunningDaemon;
let base: string;
let adminToken: string;
let realHome: SavedHome;

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
      if (portUnavailable(err)) continue;
      throw err;
    }
  }
  throw new Error('could not find a free port for the test daemon');
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  realHome = saveHome();
  setHome(home);
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
  );
  mkdirSync(join(home, 'OpenShore', 'Projects', 'repo'), { recursive: true });
  _resetRoutineScheduler();
  daemon = await startOnFreePort();
  base = `http://127.0.0.1:${daemon.port}`;
  adminToken = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
});

afterEach(() => {
  daemon.close();
  _resetRoutineScheduler();
  restoreHome(realHome);
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
    cwd: join(home, 'OpenShore', 'Projects', 'repo'),
    schedule: { hour: 6, minute: 0, days: [1, 2, 3, 4, 5] },
    ...overrides,
  };
}

describe('daemon routine routes', () => {
  it('starts empty, creates a routine in an allowed workspace, and refuses one outside', async () => {
    const empty = await fetch(`${base}/routines`, { headers: auth(adminToken) });
    expect(empty.status).toBe(200);
    // The clock status rides along (H1): this daemon's process holds it.
    expect(await empty.json()).toEqual({
      routines: [],
      runs: [],
      clock: { live: true },
      webSearch: false,
    });

    const outside = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody({ cwd: home })),
    });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { error: string }).error).toContain('allow this folder');

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
  it("never sends a run note's absolute path to the phone", async () => {
    const created = await fetch(`${base}/routines`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify(routineBody()),
    });
    const { routine } = (await created.json()) as { routine: { id: string } };
    appendRun({
      routineId: routine.id,
      startedAt: new Date().toISOString(),
      state: 'done',
      trigger: 'manual',
      notePath: 'Crew/Morning review/2026-09-27 0600.md',
      noteAbsPath: join(home, 'OpenShore', 'Vault', 'Crew', 'Morning review', '2026-09-27 0600.md'),
    });
    const listed = await fetch(`${base}/routines`, { headers: auth(adminToken) });
    const body = (await listed.json()) as { runs: Array<Record<string, unknown>> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]!.notePath).toBe('Crew/Morning review/2026-09-27 0600.md');
    expect(body.runs[0]).not.toHaveProperty('noteAbsPath');
  });

  it("keeps each owner's Crew notes in that owner's vault, out of every other member's reach", async () => {
    // A fake session per run, so the scheduler's own note writing is what
    // runs: the default vault root is keyed by the routine's owner.
    class FakeDriver implements RoutineDriver {
      static seq = 0;
      readonly id = `fake${++FakeDriver.seq}`;
      private listeners = new Set<(e: DriverEvent, seq: number) => void>();
      send(): void {}
      abort(): void {}
      onEvent(l: (e: DriverEvent, seq: number) => void): () => void {
        this.listeners.add(l);
        return () => this.listeners.delete(l);
      }
      answerApproval(): void {}
      emit(event: DriverEvent): void {
        for (const l of [...this.listeners]) l(event, 0);
      }
    }
    const opened: FakeDriver[] = [];
    const scheduler = new RoutineScheduler({
      autostart: false,
      allowedWorkspace: () => true,
      persistAllowedRoot: () => {},
      lock: { acquire: () => ({ pid: process.pid, startedAt: '' }), release: () => {} },
      openSession: () => {
        const driver = new FakeDriver();
        opened.push(driver);
        return { driver, warnings: [] };
      },
    });
    const finish = (text: string): void => {
      const driver = opened[opened.length - 1]!;
      driver.emit({ type: 'text-final', text });
      driver.emit({ type: 'task-done', reason: 'complete' });
    };
    const { token: one } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_one' });
    const { token: two } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_two' });
    const cwd = join(home, 'OpenShore', 'Projects', 'repo');
    const valid = (name: string) => {
      const parsed = validateRoutineInput(routineBody({ name, cwd }));
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.value;
    };
    const ownerRoutine = createRoutine(valid('Owner review'));
    const twoRoutine = createRoutine(valid('Two review'), 'u_two');
    scheduler.runNow(ownerRoutine.id);
    finish('The owner result.');
    scheduler.runNow(twoRoutine.id);
    finish('Member two result.');
    scheduler.stop();

    const ownerRun = scheduler.get(ownerRoutine.id)!.lastRun!;
    const twoRun = scheduler.get(twoRoutine.id)!.lastRun!;
    expect(ownerRun.noteAbsPath!.startsWith(join(home, 'OpenShore', 'Vault'))).toBe(true);
    const twoRoot = vaultRootFor({ userId: 'u_two', role: 'member' });
    expect(twoRun.noteAbsPath!.startsWith(twoRoot)).toBe(true);
    expect(readFileSync(twoRun.noteAbsPath!, 'utf8')).toContain('Member two result.');

    const paths = async (token: string): Promise<string[]> => {
      const res = await fetch(`${base}${VAULT_NOTES_ROUTE}`, { headers: auth(token) });
      return ((await res.json()) as { notes: Array<{ path: string }> }).notes.map((n) => n.path);
    };
    // The owner sees their own Crew note and not member two's.
    expect(await paths(adminToken)).toEqual([ownerRun.notePath]);
    // Member two sees only theirs; member one sees neither.
    expect(await paths(two)).toEqual([twoRun.notePath]);
    expect(await paths(one)).toEqual([]);
    for (const path of [ownerRun.notePath!, twoRun.notePath!]) {
      const res = await fetch(`${base}${vaultNoteRoute(path)}`, { headers: auth(one) });
      expect(res.status).toBe(404);
    }
    const ownerAsTwo = await fetch(`${base}${vaultNoteRoute(ownerRun.notePath!)}`, {
      headers: auth(two),
    });
    expect(ownerAsTwo.status).toBe(404);
    // And the run-note route stays scoped to what a member owns.
    const viaRoutine = await fetch(`${base}/routines/runs/${twoRun.id}/note`, {
      headers: auth(one),
    });
    expect(viaRoutine.status).toBe(404);
  });
});
