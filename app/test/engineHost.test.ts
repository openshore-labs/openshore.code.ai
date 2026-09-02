// The desktop app's engine host, exercised hermetically: a temp OSC_HOME so no
// real config, credentials, or sessions are touched, and no Electron needed
// (the host is plain Node; only main.ts talks to Electron). This is the
// desktop coding path from the renderer's point of view: create a session for
// a folder, ask for status, send a message, and get driver events back over
// the same forwarder the IPC layer uses.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

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
});
