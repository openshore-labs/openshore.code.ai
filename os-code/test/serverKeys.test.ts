// Keys on your server (2026-10-09; docs/design/byok-any-provider-plan.md,
// part 3), the daemon's half: the routes answer only on a server and only to
// an admin device; a key goes in once and never comes back out, in an answer
// or a log line; removing one clears the stack slots that named it; and a
// key on the server serves coding sessions only, never a routine or the free
// chat, which run only on a local model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SERVER_NO_MODEL,
  startDaemon,
  type DaemonOptions,
  type RunningDaemon,
} from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';
import { _setFakeKeychain, getCredential } from '../src/auth/store.js';
import { placeOrchestrator, putProviderKey } from '../src/auth/providerKeys.js';
import { _resetRoutineScheduler, defaultOpenSession } from '../src/routines/scheduler.js';
import { ROUTINE_NEEDS_LOCAL_MODEL } from '../src/routines/model.js';
import * as routineStore from '../src/routines/store.js';
import type { RoutineSchedule } from '../src/routines/model.js';
import { bootstrapSession } from '../src/core/agent/bootstrap.js';
import { freeChat, type FreeChatEvent } from '../src/daemon/freeChat.js';
import { setLogDir } from '../src/util/log.js';
import { KEY_HELP, SERVER_ACCOUNT_PREFIX } from '../src/commands/key.js';
import {
  portUnavailable,
  restoreHome,
  saveHome,
  setHome,
  type SavedHome,
} from './helpers/portable.js';

const KEY = 'sk-or-v1-feedfacefeedfacefeedfacefeedface';
const PLAIN_KEY = 'mistralplainkeywithnoprefix0123';

let home: string;
let logs: string;
let workspace: string;
let realHome: SavedHome;
let daemon: RunningDaemon | undefined;

async function start(extra: Partial<DaemonOptions>): Promise<RunningDaemon> {
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
        ...extra,
      });
    } catch (err) {
      if (portUnavailable(err)) continue;
      throw err;
    }
  }
  throw new Error('no free port');
}

const server = (): Promise<RunningDaemon> => start({ pairingConsole: true, kind: 'server' });

function client(d: RunningDaemon, token = readFileSync(join(home, 'daemon.token'), 'utf8').trim()) {
  const base = `http://127.0.0.1:${d.port}`;
  const call = async (method: string, path: string, body?: unknown, raw?: string) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(raw !== undefined
        ? { body: raw }
        : body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? (JSON.parse(text) as any) : undefined };
  };
  return { base, call };
}

function globalFile(): Record<string, any> {
  return JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-srvkeys-'));
  logs = mkdtempSync(join(tmpdir(), 'osc-srvkeys-logs-'));
  workspace = mkdtempSync(join(tmpdir(), 'osc-srvkeys-ws-'));
  process.env.OSC_HOME = home;
  realHome = saveHome();
  setHome(home);
  mkdirSync(join(home, 'Vault'), { recursive: true });
  setLogDir(logs);
  _setFakeKeychain({});
  _resetRoutineScheduler();
});

afterEach(() => {
  daemon?.close();
  daemon = undefined;
  _resetRoutineScheduler();
  _setFakeKeychain(undefined);
  restoreHome(realHome);
  delete process.env.OSC_HOME;
  // On Windows a session's last child process can hold its workspace for a
  // moment after the daemon closes (EBUSY on CI, 2026-10-09), so the
  // removals retry the way Node's own rm does for that case.
  const gone = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 };
  // Past the retries a leftover temp directory is the runner's to sweep, not
  // a failed test, so only a busy or locked directory is let go.
  for (const dir of [home, logs, workspace]) {
    try {
      rmSync(dir, gone);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EBUSY') throw e;
    }
  }
});

describe('the key routes on a server', () => {
  it('puts a key once, lists the provider, and never answers or logs the key', async () => {
    daemon = await server();
    const { call } = client(daemon);
    const texts: string[] = [];

    expect((await call('GET', '/health')).json.keysOnServer).toBe(true);
    const empty = await call('GET', '/keys');
    expect(empty.json).toEqual({ keys: [] });

    const put = await call('PUT', '/keys/xai', { key: KEY });
    texts.push(put.text);
    expect(put.status).toBe(200);
    expect(put.json).toEqual({
      ok: true,
      provider: { id: 'xai', label: 'xAI', host: 'api.x.ai' },
    });
    expect(getCredential('provider-key:xai')).toBe(KEY);
    expect(globalFile().providers.ollama).toBeDefined();

    const custom = await call('PUT', '/keys/mistral', {
      key: PLAIN_KEY,
      baseUrl: 'https://api.mistral.ai/v1',
      label: 'Mistral',
    });
    texts.push(custom.text);
    expect(custom.status).toBe(200);

    const listed = await call('GET', '/keys');
    texts.push(listed.text);
    expect(listed.json.keys.map((k: { id: string }) => k.id)).toEqual(['xai', 'mistral']);

    // Every refusal on the way names no key, even one whose shape the
    // redactor does not know.
    for (const [path, body] of [
      ['/keys/ollama', { key: PLAIN_KEY, baseUrl: 'https://x.test/v1' }],
      ['/keys/unknownco', { key: PLAIN_KEY }],
      ['/keys/unknownco', { key: PLAIN_KEY, baseUrl: `http://${PLAIN_KEY}.example.org` }],
      ['/keys/unknownco', { key: PLAIN_KEY, baseUrl: `not a url ${PLAIN_KEY}` }],
      ['/keys/xai', { key: PLAIN_KEY, workspaceId: 'wrkspc_1' }],
      ['/keys/Bad%20Id', { key: PLAIN_KEY }],
    ] as const) {
      const refused = await call('PUT', path, body);
      texts.push(refused.text);
      expect(refused.status, path).toBeGreaterThanOrEqual(400);
      expect(refused.status, path).toBeLessThan(500);
    }
    const locked = await (async () => {
      _setFakeKeychain({ locked: true });
      const r = await call('PUT', '/keys/groq', { key: PLAIN_KEY });
      _setFakeKeychain({});
      return r;
    })();
    texts.push(locked.text);
    expect(locked.status).toBe(503);

    for (const text of texts) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(PLAIN_KEY);
    }
    const log = existsSync(join(logs, 'osc.log'))
      ? readFileSync(join(logs, 'osc.log'), 'utf8')
      : '';
    expect(log).toContain('stored a provider key');
    expect(log).not.toContain(KEY);
    expect(log).not.toContain(PLAIN_KEY);
  });

  // A gateway on the server's own network (LiteLLM passing turns to a cloud)
  // would read as local, so routines, the free chat and private notes would
  // reach it (tech review 3, D5): the key door takes only an address off it.
  it('refuses an address on the server own network', async () => {
    daemon = await server();
    const { call } = client(daemon);
    for (const baseUrl of [
      'https://127.0.0.1:4000/v1',
      'https://192.168.1.20:4000/v1',
      'http://localhost:4000/v1',
    ]) {
      const refused = await call('PUT', '/keys/gw', { key: PLAIN_KEY, baseUrl });
      expect(refused.status, baseUrl).toBe(400);
      expect(refused.text).not.toContain(PLAIN_KEY);
    }
    expect(getCredential('provider-key:gw')).toBeUndefined();
    expect(existsSync(join(home, 'config.json'))).toBe(false);
  });

  it('refuses a body over the cap and a body that is not JSON', async () => {
    daemon = await server();
    const { call } = client(daemon);
    const big = await call('PUT', '/keys/groq', { key: 'k'.repeat(10 * 1024) });
    expect(big.status).toBe(413);
    const bad = await call('PUT', '/keys/groq', undefined, '{"key": ');
    expect(bad.status).toBe(400);
    expect(getCredential('provider-key:groq')).toBeUndefined();
  });

  it('slows a burst of key writes from one device', async () => {
    daemon = await server();
    const { call } = client(daemon);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call('PUT', '/keys/groq', { key: `gsk_burst_${i}_123456` })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('a member device can neither read, put, place nor remove a key', async () => {
    daemon = await server();
    const { token } = mintCredential({ role: 'member', label: 'Teammate' });
    const { call } = client(daemon, token);
    for (const [method, path, body] of [
      ['GET', '/keys', undefined],
      ['PUT', '/keys/groq', { key: PLAIN_KEY }],
      ['DELETE', '/keys/groq', undefined],
      ['DELETE', '/keys', undefined],
      ['POST', '/stack/orchestrator', { provider: 'ollama', model: 'qwen2.5:7b' }],
    ] as const) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect(getCredential('provider-key:groq')).toBeUndefined();
  });

  it('places a model, removes its key with the slot, and then a session says how to choose one', async () => {
    daemon = await server();
    const { call } = client(daemon);
    await call('PUT', '/keys/deepseek', { key: 'sk-deepseek-0123456789abcdef0123' });
    const placed = await call('POST', '/stack/orchestrator', {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      contextTokens: 1_000_000,
    });
    expect(placed.status).toBe(200);
    expect(placed.json).toEqual({
      ok: true,
      orchestrator: {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        kind: 'cloud',
        contextTokens: 1_000_000,
      },
    });
    expect((await call('GET', '/stack')).json.orchestrator).toMatchObject({
      model: 'deepseek-v4-pro',
      kind: 'cloud',
    });
    expect(
      (await call('POST', '/stack/orchestrator', { provider: 'nope', model: 'm' })).status,
    ).toBe(404);
    expect(
      (
        await call('POST', '/stack/orchestrator', {
          provider: 'deepseek',
          model: 'm',
          contextTokens: 'big',
        })
      ).status,
    ).toBe(400);

    const gone = await call('DELETE', '/keys/deepseek');
    expect(gone.json).toEqual({ ok: true, removed: ['deepseek'], slotsCleared: ['orchestrator'] });
    expect(getCredential('provider-key:deepseek')).toBeUndefined();
    expect(globalFile().providers.deepseek).toBeUndefined();

    const session = await call('POST', '/sessions', { cwd: workspace });
    expect(session.status).toBe(400);
    expect(session.json.error).toBe(SERVER_NO_MODEL);
    expect(SERVER_NO_MODEL).toContain(
      `${SERVER_ACCOUNT_PREFIX} osc stack use <model> <provider> --context <tokens>`,
    );
    // The app's door is named first, the SSH way second.
    expect(SERVER_NO_MODEL).toMatch(/Cloud Connections, Your server, Model on your server/);
  });

  it('a session runs on the key kept here: it asks first, then sends that key to the provider itself', async () => {
    daemon = await server();
    const { base, call } = client(daemon);
    const token = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
    await call('PUT', '/keys/groq', { key: 'gsk_session_key_0123456789' });
    await call('POST', '/stack/orchestrator', {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      contextTokens: 131072,
    });
    const real = globalThis.fetch;
    const sent: Array<{ url: string; auth: string | undefined }> = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('http://127.0.0.1:')) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sent.push({ url, auth: headers.authorization });
        const sse = [
          'data: {"choices":[{"delta":{"content":"Hello from Groq."},"finish_reason":"stop"}]}',
          'data: [DONE]',
          '',
        ].join('\n\n');
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return real(input, init);
    });
    try {
      const session = await call('POST', '/sessions', { cwd: workspace });
      expect(session.status).toBe(201);
      const id = session.json.id as string;
      expect((await call('POST', `/sessions/${id}/input`, { text: 'hello' })).status).toBe(202);

      const res = await real(`${base}/sessions/${id}/events?since=0`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let card: { id: string; kind: string; summary: string } | undefined;
      let done = false;
      let sentBeforeYes = -1;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !done) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!data) continue;
          const event = JSON.parse(data.slice(5).trim());
          if (event.type === 'approval-request' && event.request.kind === 'cloud-spend') {
            card = event.request;
            sentBeforeYes = sent.length;
            await call('POST', `/sessions/${id}/approvals/${card!.id}`, { approve: true });
          }
          if (event.type === 'task-done') done = true;
        }
      }
      await reader.cancel();
      expect(card?.summary).toContain("a model server off this computer's network");
      expect(sentBeforeYes).toBe(0);
      expect(sent.map((s) => s.url)).toContain('https://api.groq.com/openai/v1/chat/completions');
      expect(sent.every((s) => s.url.startsWith('https://api.groq.com/openai/v1/'))).toBe(true);
      expect(sent.every((s) => s.auth === 'Bearer gsk_session_key_0123456789')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('forgetting the server removes every key it keeps', async () => {
    daemon = await server();
    const { call } = client(daemon);
    await call('PUT', '/keys/groq', { key: 'gsk_forget_key_123456' });
    await call('PUT', '/keys/anthropic', { key: 'sk-ant-api03-forgetforgetforget' });
    await call('POST', '/stack/orchestrator', { provider: 'groq', model: 'openai/gpt-oss-120b' });
    const gone = await call('DELETE', '/keys');
    expect(gone.status).toBe(200);
    expect(gone.json.removed.sort()).toEqual(['anthropic', 'groq']);
    expect(gone.json.slotsCleared).toEqual(['orchestrator']);
    expect(getCredential('provider-key:groq')).toBeUndefined();
    expect(getCredential('anthropic-api-key')).toBeUndefined();
    expect((await call('GET', '/keys')).json).toEqual({ keys: [] });
  });
});

describe('the key routes on a desktop', () => {
  it('answer nothing: a desktop takes its keys from its own app', async () => {
    daemon = await start({ approvePairing: async () => false, kind: 'desktop' });
    const { call } = client(daemon);
    expect((await call('GET', '/health')).json.keysOnServer).toBeUndefined();
    for (const [method, path, body] of [
      ['GET', '/keys', undefined],
      ['PUT', '/keys/groq', { key: PLAIN_KEY }],
      ['DELETE', '/keys/groq', undefined],
      ['DELETE', '/keys', undefined],
      ['POST', '/stack/orchestrator', { provider: 'ollama', model: 'qwen2.5:7b' }],
    ] as const) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(404);
    }
    expect(getCredential('provider-key:groq')).toBeUndefined();
    // And a session with no model says what it always said there.
    const session = await call('POST', '/sessions', { cwd: workspace });
    expect(session.json.error).toMatch(/osc init/);
  });
});

describe('a key on the server serves coding sessions only', () => {
  function cloudOrchestrator(): void {
    putProviderKey('groq', { key: 'gsk_routine_key_123456' });
    placeOrchestrator({ provider: 'groq', model: 'openai/gpt-oss-120b', contextTokens: 131072 });
  }

  it('a routine still refuses an orchestrator on a server key (tech review 3)', () => {
    cloudOrchestrator();
    const routine = routineStore.createRoutine({
      name: 'Morning review',
      agentName: 'Reviewer',
      persona: 'A calm reviewer.',
      task: 'Review what changed.',
      cwd: workspace,
      schedule: { hour: 6, minute: 0, days: [] } as RoutineSchedule,
    });
    expect(() =>
      defaultOpenSession(routine, 'plan', (options) =>
        bootstrapSession({ ...options, persist: false }),
      ),
    ).toThrow(ROUTINE_NEEDS_LOCAL_MODEL);
  });

  it('the free chat still refuses it', async () => {
    cloudOrchestrator();
    const events: FreeChatEvent[] = [];
    for await (const e of freeChat(
      { messages: [{ role: 'user', content: 'hello' }] },
      { signal: new AbortController().signal },
    )) {
      events.push(e);
    }
    expect(events).toEqual([
      {
        type: 'refused',
        status: 400,
        error: 'Free desktop chat runs your local models. Set a local orchestrator in your stack.',
      },
    ]);
  });

  it('the CLI help says so, and names the server account', () => {
    expect(KEY_HELP).toContain(`${SERVER_ACCOUNT_PREFIX} osc key add groq`);
    expect(KEY_HELP).toMatch(/Crew routines and the free chat run only on a local model/);
  });
});
