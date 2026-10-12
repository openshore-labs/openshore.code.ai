// Keys on your server, the app's side (2026-10-09;
// docs/design/byok-any-provider-plan.md, part 3): the daemon calls, the pure choices
// and copy, the lifecycle (forgetting a server deletes its keys before this
// device's credential is revoked, re-pairing only revokes, and a disconnected
// provider's key leaves every server that keeps it), and Cloud Connections'
// rows and sheets. A server is stood in by a fetch
// that answers the way os-code/src/daemon/keyRoutes.ts does. Mounted in a real
// DOM (test/support/dom.ts) so the taps are the ones a person makes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonProviderKey, DaemonStackInfo } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';

const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
  dataUnlockState: async () => 'ok',
  openExternal: () => {},
  openInAppBrowser: () => {},
  storeGetJson: async () => undefined,
  storeSetJson: async () => {},
  storeGet: async () => null,
  storeSet: async () => {},
  storeDelete: async () => {},
  sealExistingKeys: async () => {},
  secretGet: async (k: string) => secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => {
    secrets.set(k, v);
  },
  secretDelete: async (k: string) => {
    secrets.delete(k);
  },
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

// The DOM comes first: React DOM decides whether it has one when it loads.
const dom: TestDom = await mountDom();
const { useApp, hubSecretKey } = await import('../src/state/store.js');
const driver = await import('../src/drivers/remoteDriver.js');
const lib = await import('../src/lib/serverKeys.js');
const ops = await import('../src/state/serverKeysOps.js');
const { serverKeyRemoveCommand, serverStackUseCommand, SERVER_KEY_LIST_COMMAND } =
  await import('../src/lib/docking.js');
const { PROVIDERS } = await import('../src/lib/providers.js');
const { act } = await import('react');
const { sheetExitMs } = await import('../src/lib/motion.js');

const SERVER = { baseUrl: 'http://100.64.0.9:4816', token: 'osc_admin', kind: 'server' as const };
const COMPUTER = { baseUrl: 'http://100.64.0.2:4816', token: 'osc_mac', kind: 'desktop' as const };

interface Call {
  url: string;
  path: string;
  method: string;
  body?: Record<string, unknown>;
  auth?: string;
  signal?: AbortSignal | null;
}

/** A docked server as keyRoutes.ts answers: what it keeps, its stack, and
 *  how it answers this device. `down` answers nothing at all. */
interface FakeServer {
  keys: DaemonProviderKey[];
  stack: DaemonStackInfo;
  role: 'admin' | 'member';
  keysOnServer: boolean;
  down: boolean;
  /** Answer key routes with this status instead (a 503, a 429), every one
   *  or only those of one method. */
  refuse?: { status: number; error: string; method?: string };
}

let calls: Call[] = [];
let server: FakeServer;
const realFetch = globalThis.fetch;

function freshServer(extra: Partial<FakeServer> = {}): FakeServer {
  return {
    keys: [],
    stack: { description: 'not set up yet', specialists: [] },
    role: 'admin',
    keysOnServer: true,
    down: false,
    ...extra,
  };
}

const answer = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function stubServer(): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url,
      path,
      method,
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
      auth: headers.authorization,
      signal: init?.signal,
    };
    calls.push(call);
    if (!url.startsWith(SERVER.baseUrl) || server.down) throw new TypeError('fetch failed');
    if (path === '/health') {
      return answer(200, {
        ok: true,
        role: server.role,
        kind: 'server',
        ...(server.keysOnServer ? { keysOnServer: true } : {}),
      });
    }
    if (path === '/stack' && method === 'GET') return answer(200, server.stack);
    if (path === '/pair/self' && method === 'DELETE') return answer(200, { ok: true });
    const keyRoute =
      path === '/keys' || path.startsWith('/keys/') || path === '/stack/orchestrator';
    if (!keyRoute) return answer(404, { error: 'Not found.' });
    if (!server.keysOnServer) return answer(404, { error: 'Not found.' });
    if (server.role !== 'admin') {
      return answer(403, { error: 'This needs an admin credential. Ask a company admin.' });
    }
    if (server.refuse && (!server.refuse.method || server.refuse.method === method)) {
      return answer(server.refuse.status, { error: server.refuse.error });
    }
    if (path === '/keys' && method === 'GET') return answer(200, { keys: server.keys });
    if (path === '/keys' && method === 'DELETE') {
      const removed = server.keys.map((k) => k.id);
      server.keys = [];
      return answer(200, { ok: true, removed, slotsCleared: [] });
    }
    if (path === '/stack/orchestrator' && method === 'POST') {
      const body = call.body as { provider: string; model: string; contextTokens?: number };
      if (!server.keys.some((k) => k.id === body.provider)) {
        return answer(404, { error: `No key for ${body.provider} on this server.` });
      }
      server.stack = {
        description: body.model,
        orchestrator: { provider: body.provider, model: body.model, kind: 'cloud' },
        specialists: [],
      };
      return answer(200, {
        ok: true,
        orchestrator: {
          provider: body.provider,
          model: body.model,
          kind: 'cloud',
          ...(body.contextTokens ? { contextTokens: body.contextTokens } : {}),
        },
      });
    }
    const id = decodeURIComponent(path.slice('/keys/'.length));
    if (method === 'PUT') {
      const label =
        (call.body?.label as string | undefined) ?? (id === 'anthropic' ? 'Claude' : id);
      const host =
        id === 'anthropic' ? 'api.anthropic.com' : new URL(String(call.body?.baseUrl)).host;
      server.keys = [...server.keys.filter((k) => k.id !== id), { id, label, host }];
      return answer(200, { ok: true, provider: { id, label, host } });
    }
    if (method === 'DELETE') {
      const held = server.keys.some((k) => k.id === id);
      server.keys = server.keys.filter((k) => k.id !== id);
      const ran = server.stack.orchestrator?.provider === id;
      if (ran) server.stack = { description: 'not set up yet', specialists: [] };
      return answer(200, {
        ok: true,
        removed: held ? [id] : [],
        slotsCleared: ran ? ['orchestrator'] : [],
      });
    }
    return answer(405, { error: 'No.' });
  }) as unknown as typeof fetch;
}

/** The key route calls, in order, as "METHOD /path". */
const keyCalls = () =>
  calls
    .filter(
      (c) =>
        c.path.startsWith('/keys') || c.path.startsWith('/stack/orch') || c.path === '/pair/self',
    )
    .map((c) => `${c.method} ${c.path}`);

beforeEach(() => {
  calls = [];
  server = freshServer();
  secrets.clear();
  stubServer();
  useApp.setState({
    view: 'connections',
    viewTrail: [],
    toast: undefined,
    connectedProviders: {},
    connectivity: { homeReachable: false, online: true },
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      daemon: SERVER,
      daemons: [SERVER],
      hubRoles: { [SERVER.baseUrl]: 'admin' },
    },
  });
});

afterEach(async () => {
  await dom.render(null);
  globalThis.fetch = realFetch;
});

describe('the daemon calls', () => {
  const target = SERVER;

  it('reads, puts, deletes and places on the key routes, each with a timeout', async () => {
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    expect(await driver.daemonListKeys(target)).toEqual(server.keys);
    const put = await driver.daemonPutKey(target, 'openrouter', {
      key: 'sk-or-v1-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      label: 'OpenRouter',
    });
    expect(put).toEqual({ id: 'openrouter', label: 'OpenRouter', host: 'openrouter.ai' });
    expect(await driver.daemonDeleteKey(target, 'groq')).toEqual({
      ok: true,
      removed: ['groq'],
      slotsCleared: [],
    });
    const placed = await driver.daemonPlaceOrchestrator(target, {
      provider: 'openrouter',
      model: 'qwen/qwen3-coder',
      contextTokens: 262_144,
    });
    expect(placed).toEqual({
      provider: 'openrouter',
      model: 'qwen/qwen3-coder',
      kind: 'cloud',
      contextTokens: 262_144,
    });
    expect(await driver.daemonDeleteAllKeys(target)).toEqual({
      ok: true,
      removed: ['openrouter'],
      slotsCleared: [],
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /keys',
      'PUT /keys/openrouter',
      'DELETE /keys/groq',
      'POST /stack/orchestrator',
      'DELETE /keys',
    ]);
    for (const c of calls) {
      expect(c.auth).toBe('Bearer osc_admin');
      expect(c.signal).toBeInstanceOf(AbortSignal);
    }
    // The key goes in the PUT body and nowhere else.
    expect(calls[1]!.body).toEqual({
      key: 'sk-or-v1-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      label: 'OpenRouter',
    });
    for (const c of calls) expect(c.url).not.toContain('sk-or');
  });

  it('carries the server`s own words on a refusal, and says when nothing answered', async () => {
    server.refuse = { status: 429, error: 'Too many key changes at once. Try again in 6 seconds.' };
    const refused = await driver.daemonPutKey(target, 'groq', { key: 'gsk_x' }).catch((e) => e);
    expect(refused).toBeInstanceOf(driver.ServerKeyError);
    expect(refused.message).toBe('Too many key changes at once. Try again in 6 seconds.');
    expect(refused.status).toBe(429);
    expect(driver.keysNotOffered(refused)).toBe(false);
    server.down = true;
    const down = await driver.daemonListKeys(target).catch((e) => e);
    expect(down.message).toBe('Your server did not answer.');
    expect(down.status).toBeUndefined();
    expect(String(down.message)).not.toContain('gsk_x');
  });

  it('reads a member device, a desktop and an older server as nothing offered', async () => {
    server.role = 'member';
    const member = await driver.daemonListKeys(target).catch((e) => e);
    expect(member.status).toBe(403);
    expect(driver.keysNotOffered(member)).toBe(true);
    server = freshServer({ keysOnServer: false });
    const older = await driver.daemonListKeys(target).catch((e) => e);
    expect(older.status).toBe(404);
    expect(driver.keysNotOffered(older)).toBe(true);
  });

  it('the health check carries keysOnServer, and none from a daemon that does not say it', async () => {
    expect((await driver.daemonHealth(target)).keysOnServer).toBe(true);
    server.keysOnServer = false;
    expect((await driver.daemonHealth(target)).keysOnServer).toBeUndefined();
  });
});

describe('the choices and the words', () => {
  it('takes Claude and every provider at an https OpenAI-compatible address', () => {
    for (const p of PROVIDERS) {
      expect(lib.serverTakes(p), p.id).toBe(
        p.id === 'anthropic' || Boolean(p.openaiBaseUrl?.startsWith('https://')),
      );
    }
    expect(lib.serverTakes({ id: 'lan', openaiBaseUrl: 'http://192.168.1.4:8000/v1' })).toBe(false);
    expect(
      lib.serverKeyProviders({ groq: true, anthropic: true, openai: false }).map((p) => p.id),
    ).toEqual(['anthropic', 'groq']);
  });

  it("sends Claude's key with its workspace only, and every other with its base and name", () => {
    const claude = PROVIDERS.find((p) => p.id === 'anthropic')!;
    const groq = PROVIDERS.find((p) => p.id === 'groq')!;
    expect(lib.serverPutBody(claude, 'sk-ant-x', ' wrkspc_1 ')).toEqual({
      key: 'sk-ant-x',
      workspaceId: 'wrkspc_1',
    });
    expect(lib.serverPutBody(claude, 'sk-ant-x')).toEqual({ key: 'sk-ant-x' });
    expect(lib.serverPutBody(groq, 'gsk_x', 'wrkspc_1')).toEqual({
      key: 'gsk_x',
      baseUrl: 'https://api.groq.com/openai/v1',
      label: 'Groq',
    });
  });

  it('offers the models this device knows for a provider the server keeps a key for', () => {
    const choices = lib.serverModelChoices(['google', 'groq', 'stray']);
    // Groq's models load live, and this device picked none, so it is left out.
    expect(choices.map((c) => c.provider)).toEqual(['google']);
    // A model that only makes images cannot run a coding session.
    expect(choices[0]!.models.map((m) => m.id)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
    expect(lib.serverModelWindow('google', 'gemini-2.5-pro')).toBe(1_048_576);
    // Claude's the server knows itself; an unlisted window sends none.
    expect(lib.serverModelWindow('anthropic', 'claude-opus-5')).toBeUndefined();
    expect(lib.serverModelWindow('google', 'gemini-2.5-flash-image')).toBeUndefined();
  });

  it('says where a docked model runs: on the machine, or at its provider on your key', () => {
    const at = (provider: string, kind: 'local' | 'cloud', model = 'm') =>
      lib.dockedModelLine({ provider, model, kind }, 'your server');
    expect(at('ollama', 'local', 'qwen3:8b')).toBe('qwen3:8b, running on your server');
    expect(at('groq', 'cloud', 'llama-3.3-70b')).toBe(
      'llama-3.3-70b, at Groq on your key, from your server',
    );
    expect(at('anthropic', 'cloud', 'claude-opus-5')).toBe(
      'claude-opus-5, at Anthropic on your key, from your server',
    );
    expect(at('google', 'cloud')).toBe('m, at Google on your key, from your server');
    // A cloud tag on the machine's own Ollama, or a name only the server has.
    expect(at('ollama', 'cloud', 'kimi-k3:cloud')).toBe(
      'kimi-k3:cloud, a cloud model reached from your server',
    );
    expect(lib.dockedRunsLine({ provider: 'ollama', model: 'qwen3:8b', kind: 'local' }, 'x')).toBe(
      'Runs qwen3:8b.',
    );
    expect(
      lib.dockedRunsLine({ provider: 'groq', model: 'llama', kind: 'cloud' }, 'your server'),
    ).toBe('Runs llama at Groq on your key, from your server.');
    // A key the server sends somewhere else (osc key add --base-url) is
    // named by where it goes, never by a company that does not get the turn.
    const groq = { provider: 'groq', model: 'llama', kind: 'cloud' as const };
    expect(lib.dockedModelLine(groq, 'your server', 'api.groq.com')).toBe(
      'llama, at Groq on your key, from your server',
    );
    expect(lib.dockedModelLine(groq, 'your server', 'llm.example.net')).toBe(
      'llama, at llm.example.net on your key, from your server',
    );
  });

  it('says how a machine with no model gets one', () => {
    expect(lib.dockedNoModelLine({ kind: 'server' }, 'admin')).toBe(
      'No model on your server yet. Choose one in Cloud Connections, under Your server.',
    );
    expect(lib.dockedNoModelLine({ kind: 'server' }, 'member')).toBe(
      'No model on your server yet. Its admin chooses one.',
    );
    expect(lib.dockedNoModelLine({ kind: 'desktop' }, 'admin')).toBe(
      'No model set up on your computer yet. Set one up in the Stack, in OpenShore on that computer.',
    );
    expect(lib.serverWhere(SERVER, 1)).toBe('your server');
    expect(lib.serverWhere(SERVER, 2)).toBe('100.64.0.9');
    expect(lib.serverWhere({ ...SERVER, name: ' Hetzner ' }, 2)).toBe('Hetzner');
    expect(lib.namesLine(['Groq', 'Claude', 'Mistral'])).toBe('Groq, Claude and Mistral');
    // Only "your server" takes a capital at a sentence's start.
    expect(lib.whereStartsSentence('your server')).toBe('Your server');
    expect(lib.whereStartsSentence('vps-1.tail1234.ts.net')).toBe('vps-1.tail1234.ts.net');
  });

  it('says how a server holds a key in the engine`s words, never encrypted', () => {
    const words = `${lib.SERVER_KEYS_LEAD} ${lib.SERVER_KEYS_HOLD}`;
    expect(words).not.toMatch(/encrypt/i);
    expect(lib.SERVER_KEYS_HOLD).toContain('a file only its OpenShore account and root can read');
    expect(lib.SERVER_KEYS_HOLD).toContain('The company you rent from can reach that disk.');
    // Routines and the free chat refuse a cloud model there (tech review 3), so the
    // words say they stop, never that they stay on a local one.
    expect(words).not.toMatch(/routine|free chat/i);
    expect(lib.SERVER_MODEL_LOCAL_ONLY).toBe(
      "Crew routines and Chat with your server run only on a local model, so they do not run while a cloud model is the server's model.",
    );
    expect(lib.SERVER_KEYS_LEAD).toContain('while this device sleeps');
    // Each way out is tried once, and the line says what happens otherwise.
    expect(lib.SERVER_KEYS_LEAD).toContain(
      'deletes it there if the server answers then; if it does not, OpenShore shows how to delete it over SSH.',
    );
    expect(words).not.toMatch(/always on|private server/i);
    // The commands run as the server's own account, as osc key --help says.
    const engine = readFileSync(
      join(process.cwd(), '..', 'os-code', 'src', 'commands', 'key.ts'),
      'utf8',
    );
    const prefix = engine.match(/SERVER_ACCOUNT_PREFIX = '([^']+)'/)![1]!;
    expect(serverKeyRemoveCommand('groq')).toBe(`${prefix} osc key remove groq`);
    expect(SERVER_KEY_LIST_COMMAND).toBe(`${prefix} osc key list`);
    expect(serverStackUseCommand('mistral')).toBe(
      `${prefix} osc stack use <model> mistral --context <tokens>`,
    );
    expect(serverStackUseCommand('ollama', 'qwen3:8b', 'served')).toBe(
      `${prefix} osc stack use qwen3:8b ollama`,
    );
  });
});

describe('the lifecycle', () => {
  it('forgetting a server deletes its keys there before the credential is revoked', async () => {
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    const keys = await useApp.getState().removeHub(SERVER.baseUrl);
    expect(keys).toEqual({ kind: 'cleared', removed: ['groq'] });
    await dom.settle();
    expect(keyCalls()).toEqual(['DELETE /keys', 'DELETE /pair/self']);
    expect(useApp.getState().settings.daemons).toEqual([]);
  });

  it('a server that does not answer is said, and the device forgets it all the same', async () => {
    server.down = true;
    const keys = await useApp.getState().removeHub(SERVER.baseUrl);
    expect(keys).toEqual({ kind: 'failed' });
    expect(useApp.getState().settings.daemons).toEqual([]);
  });

  it('only a server is asked about keys, and never from a member device', () => {
    expect(ops.dockedServers([SERVER, COMPUTER])).toEqual([SERVER]);
    expect(ops.dockedServers([SERVER], { [SERVER.baseUrl]: 'member' })).toEqual([]);
    expect(ops.dockedServers([SERVER], { [SERVER.baseUrl]: 'admin' })).toEqual([SERVER]);
  });

  it('a computer is never asked for keys, and a member clears nothing', async () => {
    expect(await ops.clearServerKeys(COMPUTER)).toEqual({ kind: 'none' });
    expect(calls).toEqual([]);
    expect(await ops.clearServerKeys(SERVER, 'member')).toEqual({ kind: 'none' });
    expect(calls).toEqual([]);
    server.role = 'member';
    expect(await ops.clearServerKeys(SERVER)).toEqual({ kind: 'none' });
  });

  it('re-pairing over a server only revokes the old credential, once the new one is saved', async () => {
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    server.stack = {
      description: 'llama',
      orchestrator: { provider: 'groq', model: 'llama', kind: 'cloud' },
      specialists: [],
    };
    // The old credential goes only once the new one is saved: the pairing
    // code is spent, so nothing may sit between it and the save.
    let savedFirst = false;
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/pair/self')) {
        savedFirst = secrets.get(hubSecretKey(SERVER.baseUrl)) === 'osc_new';
      }
      return fetchBefore(input, init);
    }) as typeof fetch;
    await useApp
      .getState()
      .saveHub({ baseUrl: SERVER.baseUrl, token: 'osc_new' }, { role: 'admin' });
    await dom.settle();
    const owned = calls.filter((c) => c.path.startsWith('/keys') || c.path === '/pair/self');
    expect(owned.map((c) => `${c.method} ${c.path} ${c.auth}`)).toEqual([
      'DELETE /pair/self Bearer osc_admin',
    ]);
    // The new credential manages the same keys and the same model.
    expect(server.keys.map((k) => k.id)).toEqual(['groq']);
    expect(server.stack.orchestrator?.model).toBe('llama');
    expect(useApp.getState().settings.daemon).toMatchObject({ token: 'osc_new', kind: 'server' });
    expect(savedFirst).toBe(true);
  });

  it('re-pairing a computer sends no key call', async () => {
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        daemon: COMPUTER,
        daemons: [COMPUTER],
        hubRoles: { [COMPUTER.baseUrl]: 'admin' },
      },
    });
    await useApp
      .getState()
      .saveHub({ baseUrl: COMPUTER.baseUrl, token: 'osc_mac2' }, { role: 'admin' });
    await dom.settle();
    expect(calls.some((c) => c.path.startsWith('/keys'))).toBe(false);
    expect(calls.map((c) => `${c.method} ${c.path} ${c.auth}`)).toEqual([
      'DELETE /pair/self Bearer osc_mac',
    ]);
  });

  it('disconnecting a provider deletes its key from each server that keeps it, and only there', async () => {
    const other = { baseUrl: 'http://100.64.0.10:4816', token: 'osc_two', kind: 'server' as const };
    useApp.setState({
      connectedProviders: { groq: true },
      settings: { ...useApp.getState().settings, daemons: [SERVER, other, COMPUTER] },
    });
    secrets.set('oscode.secret.groq', 'gsk_x');
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    const result = await useApp.getState().disconnectProvider('groq');
    expect(result.removedFrom.map((h) => h.baseUrl)).toEqual([SERVER.baseUrl]);
    // The second server is not reachable here: it may still keep one.
    expect(result.notRemoved.map((h) => h.baseUrl)).toEqual([other.baseUrl]);
    expect(secrets.has('oscode.secret.groq')).toBe(false);
    // Asked first (a list spends no write), then deleted; the computer never.
    const at = (base: string) =>
      calls.filter((c) => c.url.startsWith(base)).map((c) => `${c.method} ${c.path}`);
    expect(at(SERVER.baseUrl)).toEqual(['GET /keys', 'DELETE /keys/groq']);
    expect(at(other.baseUrl)).toEqual(['GET /keys']);
    expect(calls.some((c) => c.url.startsWith(COMPUTER.baseUrl))).toBe(false);
  });

  it('a disconnect that names its servers touches no other server', async () => {
    const other = { baseUrl: 'http://100.64.0.10:4816', token: 'osc_two', kind: 'server' as const };
    useApp.setState({
      connectedProviders: { groq: true },
      settings: { ...useApp.getState().settings, daemons: [SERVER, other, COMPUTER] },
    });
    secrets.set('oscode.secret.groq', 'gsk_x');
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    const result = await useApp.getState().disconnectProvider('groq', [SERVER]);
    expect(result.removedFrom.map((h) => h.baseUrl)).toEqual([SERVER.baseUrl]);
    // The server the question did not name is not asked, not even a list.
    expect(calls.some((c) => c.url.startsWith(other.baseUrl))).toBe(false);
  });

  it('a server that keeps no such key, or offers none to this device, is left alone', async () => {
    server.keys = [{ id: 'openrouter', label: 'OpenRouter', host: 'openrouter.ai' }];
    expect(await ops.removeKeyFromServers([SERVER], 'groq')).toEqual({
      removedFrom: [],
      modelClearedOn: [],
      notRemoved: [],
    });
    server.role = 'member';
    expect(await ops.removeKeyFromServers([SERVER], 'openrouter')).toEqual({
      removedFrom: [],
      modelClearedOn: [],
      notRemoved: [],
    });
    expect(keyCalls()).toEqual(['GET /keys', 'GET /keys']);
  });

  it('sends the key read from this device at the moment it goes, and refuses one that is gone', async () => {
    const groq = PROVIDERS.find((p) => p.id === 'groq')!;
    await expect(ops.putKeyOnServer(SERVER, groq)).rejects.toThrow(
      'The Groq key is not on this device any more. Connect it again.',
    );
    expect(calls).toEqual([]);
    secrets.set('oscode.secret.groq', ' gsk_x ');
    await ops.putKeyOnServer(SERVER, groq);
    expect(calls[0]!.body).toEqual({
      key: 'gsk_x',
      baseUrl: 'https://api.groq.com/openai/v1',
      label: 'Groq',
    });
  });
});

/** The ledger rows on screen, by their label. */
function rows(scope = ''): Array<{ label: string; sub: string; el: HTMLElement }> {
  return [...dom.container.querySelectorAll<HTMLElement>(`${scope} .settings-row`)].map((el) => ({
    label: el.querySelector('.settings-row-label')?.textContent ?? '',
    sub: el.querySelector('.settings-row-sub')?.textContent ?? '',
    el,
  }));
}

async function tap(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

async function tapRow(label: string, scope = ''): Promise<void> {
  const row = rows(scope).find((r) => r.label === label);
  if (!row) throw new Error(`No "${label}" row in: ${rows(scope).map((r) => r.label)}`);
  await tap(row.el);
}

async function waitOut(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, sheetExitMs() + 40));
  });
}

const OPEN = '.sheet:not(.closing)';
const CONFIRM = '.confirm-card:not(.closing)';
const sheetTitle = () => dom.container.querySelector(`${OPEN} .mode-head h2`)?.textContent ?? '';
const switchFor = (name: string) =>
  dom.container.querySelector<HTMLButtonElement>(
    `${OPEN} [role="switch"][aria-label="Keep the ${name} key on your server"]`,
  );

async function openRoom(): Promise<void> {
  const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
  await dom.render(<ConnectionsScreen />);
  for (let i = 0; i < 4; i++) await dom.settle();
}

describe('Cloud Connections, under Your server', () => {
  it('shows what the server keeps and runs, for its admin', async () => {
    server.keys = [
      { id: 'groq', label: 'Groq', host: 'api.groq.com' },
      { id: 'anthropic', label: 'Claude', host: 'api.anthropic.com' },
    ];
    server.stack = {
      description: 'llama',
      orchestrator: { provider: 'groq', model: 'llama-3.3-70b-versatile', kind: 'cloud' },
      specialists: [],
    };
    await openRoom();
    const labels = rows().map((r) => r.label);
    expect(labels.slice(0, 4)).toEqual([
      '100.64.0.9',
      'Keys on your server',
      'Model on your server',
      'Dock another server',
    ]);
    expect(rows().find((r) => r.label === 'Keys on your server')!.sub).toBe(
      'Keeps Groq and Claude.',
    );
    expect(rows().find((r) => r.label === 'Model on your server')!.sub).toBe(
      'llama-3.3-70b-versatile, at Groq on your key, from your server',
    );
  });

  it('shows nothing new to a member, on an older server, or when it does not answer', async () => {
    for (const s of [
      freshServer({ role: 'member' }),
      freshServer({ keysOnServer: false }),
      freshServer({ down: true }),
    ]) {
      server = s;
      calls = [];
      await openRoom();
      expect(rows().map((r) => r.label)).not.toContain('Keys on your server');
      expect(rows().map((r) => r.label)).not.toContain('Model on your server');
      // Nothing beyond the health check was asked.
      expect(keyCalls()).toEqual([]);
      await dom.render(null);
    }
  });

  it('the lead says the one exception plainly', async () => {
    await openRoom();
    expect(dom.container.querySelector('.lead')?.textContent).toContain(
      'Keys are stored only on this device and sent only to their provider, except a key you turn on for your server, which goes to it once and is kept there.',
    );
  });

  it('the keys sheet: a switch per provider it can take, the words said once', async () => {
    useApp.setState({ connectedProviders: { anthropic: true, groq: true, openai: true } });
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    await openRoom();
    await tapRow('Keys on your server');
    expect(sheetTitle()).toBe('Keys on your server');
    const text = dom.container.querySelector(OPEN)!.textContent ?? '';
    expect(text).toContain(lib.SERVER_KEYS_LEAD);
    expect(text).toContain(lib.SERVER_KEYS_HOLD);
    expect(rows(OPEN).map((r) => r.label)).toEqual(['Claude', 'OpenAI', 'Groq', 'Its model']);
    expect(switchFor('Groq')!.getAttribute('aria-checked')).toBe('true');
    expect(switchFor('Claude')!.getAttribute('aria-checked')).toBe('false');
    // The server says which providers it keeps a key for, never whose.
    expect(rows(OPEN).find((r) => r.label === 'Groq')!.sub).toBe('Your server keeps a Groq key.');
    expect(rows(OPEN).find((r) => r.label === 'OpenAI')!.sub).toBe('Only on this device.');
  });

  it('on sends the key once, with Claude`s workspace; off deletes it there', async () => {
    useApp.setState({
      connectedProviders: { anthropic: true, groq: true },
      settings: { ...useApp.getState().settings, anthropicWorkspaceId: 'wrkspc_1' },
    });
    secrets.set('oscode.secret.anthropic', 'sk-ant-test');
    secrets.set('oscode.secret.groq', 'gsk_test');
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    await openRoom();
    await tapRow('Keys on your server');
    calls = [];
    await tap(switchFor('Claude')!);
    await dom.settle();
    expect(keyCalls()).toEqual(['PUT /keys/anthropic', 'GET /keys']);
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      key: 'sk-ant-test',
      workspaceId: 'wrkspc_1',
    });
    expect(useApp.getState().toast).toBe('Claude key kept on your server.');
    expect(switchFor('Claude')!.getAttribute('aria-checked')).toBe('true');

    calls = [];
    await tap(switchFor('Groq')!);
    await dom.settle();
    expect(keyCalls()).toEqual(['DELETE /keys/groq', 'GET /keys']);
    expect(useApp.getState().toast).toBe('Groq key deleted from your server.');
    expect(switchFor('Groq')!.getAttribute('aria-checked')).toBe('false');
  });

  it('a key only the server keeps can be deleted, after a word', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    server.keys = [{ id: 'mistral', label: 'Mistral', host: 'api.mistral.ai' }];
    await openRoom();
    await tapRow('Keys on your server');
    const only = rows(OPEN).find((r) => r.label === 'Mistral')!;
    expect(only.sub).toBe(
      'Your server keeps it; this device has no key for it. It goes to api.mistral.ai.',
    );
    calls = [];
    const del = only.el.querySelector('button')!;
    expect(del.getAttribute('aria-label')).toBe('Delete the Mistral key from your server');
    await tap(del);
    expect(sheetTitle()).toBe('Delete the Mistral key?');
    expect(keyCalls()).toEqual([]);
    await dom.click('Delete');
    await dom.settle();
    expect(keyCalls()).toEqual(['DELETE /keys/mistral', 'GET /keys']);
    expect(server.keys).toEqual([]);
  });

  it('chooses the server`s model from what this device knows, with its window', async () => {
    useApp.setState({ connectedProviders: { google: true } });
    server.keys = [
      { id: 'google', label: 'Gemini', host: 'generativelanguage.googleapis.com' },
      { id: 'mistral', label: 'Mistral', host: 'api.mistral.ai' },
    ];
    await openRoom();
    expect(rows().find((r) => r.label === 'Model on your server')!.sub).toBe(
      'No model yet. Choose one from a provider it keeps a key for.',
    );
    await tapRow('Model on your server');
    expect(sheetTitle()).toBe('Model on your server');
    expect(dom.container.querySelector(`${OPEN} .sheet-sub`)?.textContent).toBe(
      'No model on your server yet. Choose one of the models this device knows for a provider it keeps a key for.',
    );
    expect(rows(OPEN).map((r) => r.label)).toEqual(['Gemini 2.5 Pro', 'Gemini 2.5 Flash']);
    // A provider whose models this device does not know is named, with the way.
    expect(dom.container.querySelector(OPEN)!.textContent).toContain(
      "For Mistral, this device knows no models. Choose one over SSH, as the server's account, with the window its model page lists:",
    );
    expect(dom.container.querySelector(`${OPEN} .dock-command-text`)?.textContent).toBe(
      serverStackUseCommand('mistral'),
    );
    expect(dom.container.querySelector(OPEN)!.textContent).toContain(lib.SERVER_MODEL_LOCAL_ONLY);
    calls = [];
    await tapRow('Gemini 2.5 Pro', OPEN);
    await dom.settle();
    expect(calls.find((c) => c.path === '/stack/orchestrator')!.body).toEqual({
      provider: 'google',
      model: 'gemini-2.5-pro',
      contextTokens: 1_048_576,
    });
    expect(useApp.getState().toast).toBe('Gemini 2.5 Pro is the model on your server now.');
    await waitOut();
    expect(rows().find((r) => r.label === 'Model on your server')!.sub).toBe(
      'gemini-2.5-pro, at Google on your key, from your server',
    );
  });

  it('the keys sheet hands over to the model sheet, never stacking', async () => {
    server.keys = [{ id: 'google', label: 'Gemini', host: 'x' }];
    await openRoom();
    await tapRow('Keys on your server');
    await tapRow('Its model', OPEN);
    await waitOut();
    expect(sheetTitle()).toBe('Model on your server');
    expect(dom.container.querySelectorAll(OPEN)).toHaveLength(1);
  });

  it('the disconnect question says when the server keeps the key too, and the key leaves it', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    secrets.set('oscode.secret.groq', 'gsk_test');
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    await openRoom();
    await tapRow('Groq');
    expect(dom.text()).toContain(
      'Its API key is removed from this device, and its models leave your bench and every stack. To keep its models, replace its key instead. Your server keeps a Groq key too, and it is deleted there as well.',
    );
    await dom.click('Disconnect');
    for (let i = 0; i < 3; i++) await dom.settle();
    expect(server.keys).toEqual([]);
    expect(useApp.getState().toast).toBe(
      'Groq disconnected, and its key was deleted from your server.',
    );
  });

  it('a server that did not answer a disconnect gets a note with the SSH way', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    secrets.set('oscode.secret.groq', 'gsk_test');
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    await openRoom();
    server.down = true;
    await tapRow('Groq');
    await dom.click('Disconnect');
    for (let i = 0; i < 3; i++) await dom.settle();
    await waitOut();
    expect(sheetTitle()).toBe('The Groq key may still be on your server');
    expect(dom.container.querySelector(`${OPEN} .dock-command-text`)?.textContent).toBe(
      serverKeyRemoveCommand('groq'),
    );
  });
});

describe('Cloud Connections, the review fixes', () => {
  it('the two late rows step in on the shared stagger', async () => {
    await openRoom();
    for (const label of ['Keys on your server', 'Model on your server']) {
      const row = rows().find((r) => r.label === label)!.el;
      expect(row.classList.contains('stagger-in'), label).toBe(true);
      expect(row.style.getPropertyValue('--i'), label).toBe(label.startsWith('Keys') ? '0' : '1');
    }
    expect(rows().find((r) => r.label === 'Dock another server')!.el.classList).not.toContain(
      'stagger-in',
    );
  });

  it('opening a sheet reads the server again, so a key added over SSH shows', async () => {
    await openRoom();
    server.keys = [{ id: 'mistral', label: 'Mistral', host: 'api.mistral.ai' }];
    calls = [];
    await tapRow('Keys on your server');
    await dom.settle();
    expect(keyCalls()).toContain('GET /keys');
    expect(rows(OPEN).map((r) => r.label)).toContain('Mistral');
  });

  it("a refusal shows the server's own words, and the switch goes back", async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    secrets.set('oscode.secret.groq', 'gsk_test');
    await openRoom();
    await tapRow('Keys on your server');
    server.refuse = {
      status: 409,
      error: 'Groq is set up another way on this server. Remove it there first.',
      method: 'PUT',
    };
    await tap(switchFor('Groq')!);
    await dom.settle();
    expect(useApp.getState().toast).toBe(
      'Groq is set up another way on this server. Remove it there first.',
    );
    expect(switchFor('Groq')!.getAttribute('aria-checked')).toBe('false');
    expect(server.keys).toEqual([]);
  });

  it('the tapped switch moves at the tap, before the server answers', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    secrets.set('oscode.secret.groq', 'gsk_test');
    await openRoom();
    await tapRow('Keys on your server');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PUT') await gate;
      return fetchBefore(input, init);
    }) as typeof fetch;
    await tap(switchFor('Groq')!);
    expect(switchFor('Groq')!.getAttribute('aria-checked')).toBe('true');
    expect(switchFor('Groq')!.disabled).toBe(true);
    release();
    await dom.settle();
    await dom.settle();
    expect(switchFor('Groq')!.getAttribute('aria-checked')).toBe('true');
    expect(switchFor('Groq')!.disabled).toBe(false);
  });

  it('turning off the key the server`s model runs on asks first, naming the model', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    server.stack = {
      description: 'llama',
      orchestrator: { provider: 'groq', model: 'llama-3.3-70b-versatile', kind: 'cloud' },
      specialists: [],
    };
    await openRoom();
    await tapRow('Keys on your server');
    calls = [];
    await tap(switchFor('Groq')!);
    expect(keyCalls()).toEqual([]);
    expect(sheetTitle()).toBe('Delete the Groq key from your server?');
    expect(dom.container.querySelector(`${OPEN} .sheet-sub`)?.textContent).toBe(
      'The model on your server, llama-3.3-70b-versatile, runs on it, so the server has none until you choose another. The key stays on this device.',
    );
    await dom.click('Delete');
    await dom.settle();
    expect(keyCalls()).toEqual(['DELETE /keys/groq', 'GET /keys']);
    expect(useApp.getState().toast).toBe(
      'Groq key deleted from your server. Its model ran on it, so choose another.',
    );
  });

  it('placing a cloud model over a local one asks first, with the way back', async () => {
    useApp.setState({ connectedProviders: { google: true } });
    server.keys = [{ id: 'google', label: 'Gemini', host: 'generativelanguage.googleapis.com' }];
    server.stack = {
      description: 'qwen',
      orchestrator: { provider: 'ollama', model: 'qwen3:8b', kind: 'local' },
      specialists: [],
    };
    await openRoom();
    await tapRow('Model on your server');
    calls = [];
    await tapRow('Gemini 2.5 Pro', OPEN);
    expect(calls.some((c) => c.path === '/stack/orchestrator')).toBe(false);
    expect(sheetTitle()).toBe('Make Gemini 2.5 Pro the model on your server?');
    expect(dom.container.querySelector(`${OPEN} .sheet-sub`)?.textContent).toBe(
      `qwen3:8b runs on your server now. ${lib.SERVER_MODEL_LOCAL_ONLY} To put qwen3:8b back, run this over SSH:`,
    );
    expect(dom.container.querySelector(`${OPEN} .dock-command-text`)?.textContent).toBe(
      serverStackUseCommand('ollama', 'qwen3:8b', 'served'),
    );
    await dom.click('Use Gemini 2.5 Pro');
    await dom.settle();
    expect(calls.find((c) => c.path === '/stack/orchestrator')!.body).toMatchObject({
      provider: 'google',
      model: 'gemini-2.5-pro',
    });
  });

  it("a model the server will not place shows the server's words", async () => {
    useApp.setState({ connectedProviders: { google: true } });
    server.keys = [{ id: 'google', label: 'Gemini', host: 'generativelanguage.googleapis.com' }];
    await openRoom();
    await tapRow('Model on your server');
    // The key went from the server (another admin device) after this read.
    server.keys = [];
    await tapRow('Gemini 2.5 Pro', OPEN);
    await dom.settle();
    expect(useApp.getState().toast).toBe('No key for google on this server.');
    expect(sheetTitle()).toBe('Model on your server');
  });

  it('disconnecting the provider the server`s model runs on says the model stopped', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    secrets.set('oscode.secret.groq', 'gsk_test');
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    server.stack = {
      description: 'llama',
      orchestrator: { provider: 'groq', model: 'llama', kind: 'cloud' },
      specialists: [],
    };
    await openRoom();
    await tapRow('Groq');
    expect(dom.text()).toContain(
      'Your server keeps a Groq key too, and it is deleted there as well. The model on your server runs on it, so it stops until you choose another.',
    );
    await dom.click('Disconnect');
    for (let i = 0; i < 3; i++) await dom.settle();
    expect(useApp.getState().toast).toBe(
      'Groq disconnected, and its key was deleted from your server. The model on your server ran on it, so choose another.',
    );
  });

  it('a server that offers this device no keys gets no note when it is down at disconnect', async () => {
    server = freshServer({ keysOnServer: false });
    useApp.setState({ connectedProviders: { groq: true } });
    secrets.set('oscode.secret.groq', 'gsk_test');
    await openRoom();
    server.down = true;
    await tapRow('Groq');
    await dom.click('Disconnect');
    for (let i = 0; i < 3; i++) await dom.settle();
    await waitOut();
    expect(useApp.getState().toast).toBe('Groq disconnected.');
    expect(dom.container.querySelector(OPEN)).toBeNull();
  });

  it('a key replaced here is offered to the server that keeps one, and sent on a yes', async () => {
    useApp.setState({ connectedProviders: { groq: true } });
    secrets.set('oscode.secret.groq', 'gsk_old');
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    await openRoom();
    await tapRow('Groq');
    await dom.click('replace its key');
    await waitOut();
    const groq = PROVIDERS.find((p) => p.id === 'groq')!;
    await dom.type(groq.keyHint, 'gsk_new');
    calls = [];
    await dom.click('Save');
    for (let i = 0; i < 3; i++) await dom.settle();
    await waitOut();
    // Saving here changed nothing there.
    expect(keyCalls()).toEqual([]);
    expect(dom.container.querySelector(`${CONFIRM} h3`)?.textContent).toBe(
      'Send the new Groq key?',
    );
    expect(dom.container.querySelector(CONFIRM)!.textContent).toContain(
      'Your server keeps a Groq key of its own, which a key saved here does not change.',
    );
    await dom.click('Send');
    for (let i = 0; i < 3; i++) await dom.settle();
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ key: 'gsk_new' });
    expect(useApp.getState().toast).toBe('The new Groq key is on your server now.');
  });
});

describe('forgetting a server from Computer', () => {
  async function openComputer(): Promise<void> {
    const { PairScreen } = await import('../src/screens/PairScreen.js');
    await dom.render(<PairScreen />);
    for (let i = 0; i < 3; i++) await dom.settle();
  }

  it('says the keys go first, then deletes them and says so', async () => {
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    await openComputer();
    await dom.click('Forget this server');
    expect(dom.container.querySelector(`${CONFIRM} p`)?.textContent).toBe(
      'This device stops reaching it. If the server answers, every provider key it keeps is deleted there first, then it drops this device from its list. To use it again, scan a new QR.',
    );
    calls = [];
    await dom.click('Forget');
    for (let i = 0; i < 3; i++) await dom.settle();
    expect(keyCalls()).toEqual(['DELETE /keys', 'DELETE /pair/self']);
    expect(useApp.getState().toast).toBe(
      'Your server forgotten on this device, and the provider keys it kept were deleted there.',
    );
  });

  it('a server that is down opens the SSH note, only once the confirm has left', async () => {
    server.keys = [{ id: 'groq', label: 'Groq', host: 'api.groq.com' }];
    await openComputer();
    server.down = true;
    await dom.click('Forget this server');
    await dom.click('Forget');
    for (let i = 0; i < 3; i++) await dom.settle();
    expect(useApp.getState().toast).toBe('Your server forgotten on this device.');
    // Sheets never stack: nothing rises while the confirm is leaving.
    expect(dom.container.querySelectorAll(OPEN)).toHaveLength(0);
    expect(dom.container.querySelectorAll('.confirm-card.closing')).toHaveLength(1);
    await waitOut();
    expect(sheetTitle()).toBe('Keys may stay on 100.64.0.9');
    expect(dom.container.querySelector(`${OPEN} .sheet-sub`)?.textContent).toContain(
      'OpenShore could not delete the provider keys 100.64.0.9 may keep.',
    );
    expect(
      [...dom.container.querySelectorAll(`${OPEN} .dock-command-text`)].map((c) => c.textContent),
    ).toEqual([SERVER_KEY_LIST_COMMAND, serverKeyRemoveCommand('<provider>')]);
  });
});

describe('what leaves this device says so', () => {
  it('lists a key sent to your own server: what, to whom, and when', async () => {
    const { EGRESS } = await import('../src/lib/egressManifest.js');
    const entry = EGRESS.find((e) => e.id === 'server-keys')!;
    expect(entry.recipient).toBe('Services you connect');
    expect(entry.start).toBe('off');
    expect(entry.hosts).toEqual([]);
    expect(entry.what).toContain(
      "A provider's API key and its provider's address (for Claude, its workspace ID instead), to a server you dock, over your private Tailscale network",
    );
    expect(entry.what).toContain('Nothing goes through us.');
    expect(entry.what).not.toMatch(/encrypt/i);
    expect(entry.when).toMatch(
      /^Only when you turn a provider on for that server in Cloud Connections, or say yes to sending it a key you replaced here\./,
    );
    expect(entry.when).toContain('names only, never a key');
  });
});

describe('the copy that a cloud model on a server would make false', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), 'src', f), 'utf8');

  it('the model menu and the Stack say where a docked model runs, and how to choose one', () => {
    const sheet = src('components/ModelSheet.tsx');
    expect(sheet).not.toContain('${boxModel}, running on');
    expect(sheet).toContain('dockedModelLine(boxStack.orchestrator, dockedNounLower(daemon))');
    expect(sheet).toContain('dockedNoModelLine(daemon, settings.hubRoles?.[daemon.baseUrl])');
    const stack = src('components/StackManager.tsx');
    expect(stack).not.toContain('`Runs ${model}.');
    expect(stack).toContain('dockedRunsLine(model, dockedNounLower(daemon))');
    expect(stack).toContain('dockedNoModelLine(daemon, role)');
  });

  it('forgetting never says keys go first to a member', () => {
    const pair = src('screens/PairScreen.tsx').replace(/\s+/g, ' ');
    expect(pair).toContain("return hub.kind === 'server' && roles?.[hub.baseUrl] !== 'member';");
  });
});
