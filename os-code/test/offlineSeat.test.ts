// Desktop Offline follow-ups (2026-10-08): a room names what will actually
// answer. The engine's offline seat is read through one helper,
// offlineSeatFor, the same rule as Router.localSeat, judging every configured
// provider by address, never by its label. The daemon tells a paired phone
// whether this computer works offline and why (GET /health and GET /stack),
// and which model answers here meanwhile, additively: online it says nothing
// new, so an older phone reads it as before.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { defaultConfig } from '../src/config/load.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { offlineSeatFor } from '../src/router/router.js';
import { setMachineOffline } from '../src/core/agent/offline.js';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import type { DaemonStackInfo } from '../src/protocol.js';
import { portUnavailable } from './helpers/portable.js';

/** A model server on this computer that answers as Ollama does, and counts
 *  every request it is asked. */
async function fakeOllama(
  models: string[],
): Promise<{ url: string; asked: string[]; server: Server }> {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/version') return void res.end(JSON.stringify({ version: '0.6.0' }));
    if (req.url === '/api/tags') {
      return void res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, asked, server };
}

// An OpenAI-compatible server on the internet: its kind label says local, its
// address says it leaves this network. The name never resolves, so nothing is
// sent if a rule ever forgets to skip it.
const HOSTED = { kind: 'openai-compatible', baseUrl: 'https://models.example.invalid/v1' };

let servers: Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
  setMachineOffline(undefined);
});

describe('the seat a room names offline', () => {
  it('a cloud orchestrator: the best model a server on this network serves, never a hosted one', async () => {
    const local = await fakeOllama(['nomic-embed-text', 'qwen3:4b', 'qwen2.5-coder:7b']);
    servers.push(local.server);
    const config = ConfigSchema.parse({
      // The hosted server comes first, so a rule by label would pick it.
      providers: {
        hosted: HOSTED,
        anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' },
        ollama: { kind: 'openai-compatible', baseUrl: local.url },
      },
      stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    });
    const registry = new ProviderRegistry(config, () => 'sk-ant-test');
    expect(await offlineSeatFor(config, registry)).toEqual({
      model: 'qwen2.5-coder:7b',
      provider: 'ollama',
    });
  });

  it('a local orchestrator is its own seat, and a placed local specialist stands in first', async () => {
    const local = await fakeOllama(['qwen3:4b']);
    servers.push(local.server);
    const providers = {
      anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' },
      ollama: { kind: 'openai-compatible', baseUrl: local.url },
    };
    const own = ConfigSchema.parse({
      providers,
      stack: { orchestrator: { provider: 'ollama', model: 'qwen2.5-coder:14b' } },
    });
    expect(await offlineSeatFor(own, new ProviderRegistry(own, () => undefined))).toEqual({
      model: 'qwen2.5-coder:14b',
      provider: 'ollama',
    });
    // Neither asks the server for its list: the stack already names the seat.
    expect(local.asked).toEqual([]);

    const placed = ConfigSchema.parse({
      providers,
      stack: {
        orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' },
        specialists: { coding: { provider: 'ollama', model: 'qwen2.5-coder:7b' } },
      },
    });
    expect(await offlineSeatFor(placed, new ProviderRegistry(placed, () => undefined))).toEqual({
      model: 'qwen2.5-coder:7b',
      provider: 'ollama',
    });
  });

  it('an Ollama cloud tag is never the seat: it answers on ollama.com (privacy review, 2026-10-08)', async () => {
    // Coders first, then size: by name alone a 480b cloud coder would win.
    const local = await fakeOllama(['qwen3-coder:480b-cloud', 'kimi-k3:cloud', 'qwen2.5-coder:7b']);
    servers.push(local.server);
    const providers = { ollama: { kind: 'openai-compatible', baseUrl: local.url } };
    const tagged = ConfigSchema.parse({
      providers,
      stack: { orchestrator: { provider: 'ollama', model: 'kimi-k3:cloud' } },
    });
    expect(await offlineSeatFor(tagged, new ProviderRegistry(tagged, () => undefined))).toEqual({
      model: 'qwen2.5-coder:7b',
      provider: 'ollama',
    });

    const onlyCloud = await fakeOllama(['kimi-k3:cloud', 'gpt-oss:120b-cloud']);
    servers.push(onlyCloud.server);
    const none = ConfigSchema.parse({
      providers: { ollama: { kind: 'openai-compatible', baseUrl: onlyCloud.url } },
      stack: { orchestrator: { provider: 'ollama', model: 'gpt-oss:120b-cloud' } },
    });
    expect(await offlineSeatFor(none, new ProviderRegistry(none, () => undefined))).toBeUndefined();
  });

  it('none when nothing here can answer, and none before a stack is set up', async () => {
    const cloudOnly = ConfigSchema.parse({
      providers: { hosted: HOSTED, anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' } },
      stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    });
    expect(
      await offlineSeatFor(cloudOnly, new ProviderRegistry(cloudOnly, () => undefined)),
    ).toBeUndefined();
    const empty = defaultConfig();
    expect(
      await offlineSeatFor(empty, new ProviderRegistry(empty, () => undefined)),
    ).toBeUndefined();
  });
});

describe('the daemon tells a paired phone', () => {
  let home: string;
  let daemon: RunningDaemon;
  let base: string;
  let token: string;

  async function start(config: Record<string, unknown>): Promise<void> {
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    for (let attempt = 0; attempt < 30; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000);
      try {
        daemon = await startDaemon({ config: defaultConfig(), bind: 'loopback', port });
        break;
      } catch (err) {
        if (!portUnavailable(err)) throw err;
      }
    }
    base = `http://127.0.0.1:${daemon.port}`;
    token = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
  }
  const get = async <T>(path: string): Promise<T> =>
    (await (
      await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as T;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'osc-offline-seat-'));
    process.env.OSC_HOME = home;
  });
  afterEach(() => {
    daemon?.close();
    delete process.env.OSC_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  it('health: nothing new while online, then offline and why', async () => {
    await start({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } });
    const online = await get<Record<string, unknown>>('/health');
    expect(online.ok).toBe(true);
    expect('offline' in online).toBe(false);

    setMachineOffline('chosen');
    expect((await get<{ offline?: string }>('/health')).offline).toBe('chosen');
    setMachineOffline('network');
    expect((await get<{ offline?: string }>('/health')).offline).toBe('network');
  });

  it('stack: offline, why, and the model that answers here meanwhile', async () => {
    const local = await fakeOllama(['qwen3:4b', 'qwen2.5-coder:7b']);
    servers.push(local.server);
    await start({
      providers: {
        anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' },
        ollama: { kind: 'openai-compatible', baseUrl: local.url },
      },
      stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    });
    const online = await get<DaemonStackInfo>('/stack');
    expect(online.orchestrator).toEqual({
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      kind: 'cloud',
    });
    expect(online.offline).toBeUndefined();
    expect(online.offlineSeat).toBeUndefined();
    // Online, the seat costs no model list.
    expect(local.asked).toEqual([]);

    setMachineOffline('network');
    const offline = await get<DaemonStackInfo>('/stack');
    expect(offline.offline).toBe('network');
    expect(offline.offlineSeat).toEqual({ model: 'qwen2.5-coder:7b', provider: 'ollama' });
  });

  it('stack: with no model here, offline names no seat', async () => {
    await start({
      providers: { anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' } },
      stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    });
    setMachineOffline('chosen');
    const stack = await get<DaemonStackInfo>('/stack');
    expect(stack.offline).toBe('chosen');
    expect(stack.offlineSeat).toBeUndefined();
  });

  it("stack: a cloud tag on this computer's Ollama is cloud, and offline names a seat here", async () => {
    const local = await fakeOllama(['kimi-k3:cloud', 'qwen2.5-coder:7b']);
    servers.push(local.server);
    await start({
      providers: { ollama: { kind: 'openai-compatible', baseUrl: local.url } },
      stack: { orchestrator: { provider: 'ollama', model: 'kimi-k3:cloud' } },
    });
    expect((await get<DaemonStackInfo>('/stack')).orchestrator).toEqual({
      model: 'kimi-k3:cloud',
      provider: 'ollama',
      kind: 'cloud',
    });
    setMachineOffline('chosen');
    expect((await get<DaemonStackInfo>('/stack')).offlineSeat).toEqual({
      model: 'qwen2.5-coder:7b',
      provider: 'ollama',
    });
  });

  it("stack: the orchestrator's kind is judged by address, and read fresh", async () => {
    await start({
      providers: { hosted: HOSTED },
      stack: { orchestrator: { provider: 'hosted', model: 'big-model' } },
    });
    expect((await get<DaemonStackInfo>('/stack')).orchestrator?.kind).toBe('cloud');
    // A stack changed on the desktop since the daemon started is the one
    // reported, the way each session reads it.
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
    );
    // Ollama's default address is this computer itself, so the chip may say
    // so (hostIsLoopback, CX and CMO 2026-10-08, B).
    expect((await get<DaemonStackInfo>('/stack')).orchestrator).toEqual({
      model: 'qwen',
      provider: 'ollama',
      kind: 'local',
      onThisComputer: true,
    });
    // A config that no longer reads keeps the one the daemon started with,
    // rather than failing the room.
    writeFileSync(join(home, 'config.json'), JSON.stringify({ stack: 42 }));
    const res = await fetch(`${base}/stack`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DaemonStackInfo).description).toBe('not set up yet');
  });
});
