// The desktop app's engine host, exercised hermetically: a temp OSC_HOME so no
// real config, credentials, or sessions are touched, and no Electron needed
// (the host is plain Node; only main.ts talks to Electron). This is the
// desktop coding path from the renderer's point of view: create a session for
// a folder, ask for status, send a message, and get driver events back over
// the same forwarder the IPC layer uses.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

// Every session the host boots, with the project it carries and the Memory
// switch it was handed, so a test can check what a resume kept and what the
// bridge passed on. The real bootstrap runs untouched.
const booted = vi.hoisted(
  () => [] as Array<{ id: string; projectName?: string; instructions?: string; memory?: boolean }>,
);
vi.mock('os-code/dist/src/core/agent/bootstrap.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('os-code/dist/src/core/agent/bootstrap.js')>();
  return {
    ...real,
    bootstrapSession: (options: Parameters<typeof real.bootstrapSession>[0]) => {
      const result = real.bootstrapSession(options);
      booted.push({
        id: result.driver.id,
        projectName: result.toolContext.projectName,
        instructions: (result.agent as unknown as { instructions?: string }).instructions,
        memory: (options as { memory?: boolean }).memory,
      });
      return result;
    },
  };
});

// Two engine homes: one empty (fresh install), one with a model configured that
// points at a dead port (a machine whose Ollama is not running). OSC_HOME is
// read on every config load, so switching it between tests is enough.
const emptyHome = mkdtempSync(join(tmpdir(), 'osc-home-empty-'));
const configuredHome = mkdtempSync(join(tmpdir(), 'osc-home-cfg-'));
mkdirSync(configuredHome, { recursive: true });
writeFileSync(
  join(configuredHome, 'config.json'),
  JSON.stringify({
    providers: { ollama: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1' } },
    stack: { orchestrator: { provider: 'ollama', model: 'test-model' } },
  }),
);
process.env.OSC_HOME = emptyHome;

let EngineHost: typeof import('../electron/engineHost.js').EngineHost;

beforeAll(async () => {
  ({ EngineHost } = await import('../electron/engineHost.js'));
});

afterAll(() => {
  delete process.env.OSC_HOME;
});

function makeHost(events: DriverEvent[]) {
  return new EngineHost(
    (p) => events.push(p.event),
    () => {},
    () => {},
  );
}

describe('EngineHost (desktop coding path, hermetic)', () => {
  it('a fresh install reports no model configured, and refuses to open a session', async () => {
    process.env.OSC_HOME = emptyHome;
    const host = makeHost([]);
    const status = await host.status();
    // The app must gate on this (sourceReady) and route to the Stack, because
    // the engine itself will not start a session without an orchestrator.
    expect(status.stack.configured).toBe(false);
    expect(typeof status.hardwareSummary).toBe('string');

    const cwd = mkdtempSync(join(tmpdir(), 'osc-repo-'));
    await expect(host.createSession(cwd)).rejects.toThrow(/orchestrator/i);
    host.disposeAll();
  });

  it('with a model configured, opens a session for a folder', async () => {
    process.env.OSC_HOME = configuredHome;
    const host = makeHost([]);
    const cwd = mkdtempSync(join(tmpdir(), 'osc-repo-'));
    writeFileSync(join(cwd, 'README.md'), '# hello\n');
    const created = await host.createSession(cwd);
    expect(created.id).toBeTruthy();
    expect(created.cwd).toBe(cwd);
    const status = await host.status();
    expect(status.stack.configured).toBe(true);
    expect(status.stack.orchestrator?.model).toBe('test-model');
    host.disposeAll();
  });

  it('a message with no reachable model ends the turn with an honest error, not a hang', async () => {
    process.env.OSC_HOME = configuredHome;
    const events: DriverEvent[] = [];
    const host = makeHost(events);
    const cwd = mkdtempSync(join(tmpdir(), 'osc-repo-'));
    const { id } = await host.createSession(cwd);

    host.send(id, 'hello');
    const done = await new Promise<DriverEvent | undefined>((resolve) => {
      const started = Date.now();
      const tick = () => {
        const end = events.find((e) => e.type === 'task-done');
        if (end) return resolve(end);
        if (Date.now() - started > 20_000) return resolve(undefined);
        setTimeout(tick, 50);
      };
      tick();
    });

    expect(done, 'the loop must finish the turn').toBeDefined();
    expect(events.some((e) => e.type === 'task-start')).toBe(true);
    // Ollama is down (dead port), so the turn must end in an error a person can
    // act on, never a fabricated answer and never a silent hang.
    expect((done as { reason?: string }).reason).toBe('error');
    expect(String((done as { message?: string }).message ?? '')).not.toContain('(demo)');
    host.disposeAll();
  }, 30_000);

  // A conversation reopened after the app restarts resumes its stored session.
  // The resume used to boot it with no project, so its memory notes fell back
  // to the folder's name and the project's standing instructions dropped.
  it('a resumed session keeps its project name and instructions', async () => {
    process.env.OSC_HOME = configuredHome;
    const cwd = join(mkdtempSync(join(tmpdir(), 'osc-repo-')), 'my-app');
    mkdirSync(cwd);
    const first = makeHost([]);
    const { id } = await first.createSession(cwd, {
      projectName: 'My App',
      instructions: 'Keep every screen calm.',
    });
    first.disposeAll();

    // A new host is the app after a restart: nothing is live, so it rehydrates.
    const second = makeHost([]);
    const resumed = await second.resumeSession(id);
    expect(resumed).toMatchObject({ id, cwd });
    const boots = booted.filter((b) => b.id === id);
    expect(boots).toHaveLength(2);
    expect(boots[1]).toMatchObject({
      projectName: 'My App',
      instructions: 'Keep every screen calm.',
    });
    second.disposeAll();
  });

  // The Wayfinding Memory switch (plan 1.5) reaches the engine's bootstrap as
  // BootstrapOptions.memory, where memoryEnabled lets it only turn memory off.
  it('hands the Memory switch to the engine as the session opens', async () => {
    process.env.OSC_HOME = configuredHome;
    const cwd = mkdtempSync(join(tmpdir(), 'osc-repo-'));
    const host = makeHost([]);
    const off = await host.createSession(cwd, { memory: false });
    const untouched = await host.createSession(cwd);
    expect(booted.find((b) => b.id === off.id)?.memory).toBe(false);
    expect(booted.find((b) => b.id === untouched.id)?.memory).toBeUndefined();
    host.disposeAll();
  });
});
