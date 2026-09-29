// The desktop app's engine host, exercised hermetically: a temp OSC_HOME so no
// real config, credentials, or sessions are touched, and no Electron needed
// (the host is plain Node; only main.ts talks to Electron). This is the
// desktop coding path from the renderer's point of view: create a session for
// a folder, ask for status, send a message, and get driver events back over
// the same forwarder the IPC layer uses.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
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

// The free chat over IPC (CTO ruling 8): the host runs the engine's one free
// chat function and forwards its events to the window. A fake Ollama stands
// in for the local model, so the test reads what reached it.
describe('EngineHost free chat (the desktop window, over IPC)', () => {
  type Frame = Parameters<Parameters<InstanceType<typeof EngineHost>['freeChat']>[2]>[0];
  let ollama: Server;
  let chatHome: string;
  let held: ServerResponse[];
  let hold: boolean;
  const answer = (res: ServerResponse) => {
    res.write(
      `${JSON.stringify({ message: { content: 'A closure keeps its scope.' }, done: false })}\n`,
    );
    res.end(`${JSON.stringify({ done: true })}\n`);
  };

  beforeAll(async () => {
    held = [];
    hold = false;
    ollama = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.url === '/api/chat') {
          if (hold) held.push(res);
          else answer(res);
        } else if (req.url === '/api/version') {
          res.end(JSON.stringify({ version: '0.9.0' }));
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) => ollama.listen(0, '127.0.0.1', resolve));
    const port = (ollama.address() as AddressInfo).port;
    chatHome = mkdtempSync(join(tmpdir(), 'osc-home-chat-'));
    writeFileSync(
      join(chatHome, 'config.json'),
      JSON.stringify({
        providers: { ollama: { kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}` } },
        stack: { orchestrator: { provider: 'ollama', model: 'qwen2.5:3b' } },
      }),
    );
  });
  afterAll(() => {
    for (const res of held.splice(0)) answer(res);
    ollama.close();
  });

  it('streams one answer with no session opened', async () => {
    process.env.OSC_HOME = chatHome;
    const host = makeHost([]);
    const frames: Frame[] = [];
    const bootsBefore = booted.length;
    await host.freeChat(
      'r1',
      { messages: [{ role: 'user', content: 'What is a closure?' }] },
      (f) => frames.push(f),
    );
    expect(frames).toEqual([
      { type: 'text', delta: 'A closure keeps its scope.' },
      { type: 'done' },
    ]);
    // Nothing was booted, stored, or left to resume.
    expect(booted.length).toBe(bootsBefore);
    expect(host.listStoredSessions()).toEqual([]);
    host.disposeAll();
  });

  it('refuses a model that leaves this network, as its one error', async () => {
    const remoteHome = mkdtempSync(join(tmpdir(), 'osc-home-remote-'));
    writeFileSync(
      join(remoteHome, 'config.json'),
      JSON.stringify({
        providers: { far: { kind: 'openai-compatible', baseUrl: 'https://models.example.com/v1' } },
        stack: { orchestrator: { provider: 'far', model: 'big-model' } },
      }),
    );
    process.env.OSC_HOME = remoteHome;
    const host = makeHost([]);
    const frames: Frame[] = [];
    await host.freeChat('r2', { messages: [{ role: 'user', content: 'hi' }] }, (f) =>
      frames.push(f),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'error' });
    expect((frames[0] as { message: string }).message).toMatch(/local models/);
    host.disposeAll();
  });

  it('with no model at all, says so as its one error', async () => {
    process.env.OSC_HOME = emptyHome;
    const host = makeHost([]);
    const frames: Frame[] = [];
    await host.freeChat('r3', { messages: [{ role: 'user', content: 'hi' }] }, (f) =>
      frames.push(f),
    );
    expect(frames).toEqual([{ type: 'error', message: expect.stringMatching(/No local model/) }]);
    host.disposeAll();
  });

  it('answers one message at a time, and a Stop frees the window for the next', async () => {
    process.env.OSC_HOME = chatHome;
    hold = true;
    const host = makeHost([]);
    const first: Frame[] = [];
    const running = host.freeChat('r4', { messages: [{ role: 'user', content: 'hi' }] }, (f) =>
      first.push(f),
    );
    for (let i = 0; i < 200 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    const second: Frame[] = [];
    await host.freeChat('r5', { messages: [{ role: 'user', content: 'hi' }] }, (f) =>
      second.push(f),
    );
    expect(second).toEqual([{ type: 'error', message: expect.stringMatching(/still answering/) }]);
    hold = false;
    host.freeChatAbort('r4');
    await running;
    expect(['done', 'error']).toContain(first.at(-1)?.type);
    const third: Frame[] = [];
    await host.freeChat('r6', { messages: [{ role: 'user', content: 'hi' }] }, (f) =>
      third.push(f),
    );
    expect(third.at(-1)).toEqual({ type: 'done' });
    host.disposeAll();
  });
});
