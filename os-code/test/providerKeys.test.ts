// Keys on your server (founder, 2026-10-09; docs/byok-any-provider-plan.md,
// part 3): the module the daemon's key routes and `osc key` share, the
// schema's provider-key namespace, and how a stored key reaches a request.
// A key is put once, listed by provider only, and removed with every stack
// slot that named its provider; a provider this module did not write is never
// touched; and nothing here calls a provider.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWN_PROVIDERS,
  ProviderKeyError,
  cleanBaseUrl,
  listProviderKeys,
  placeOrchestrator,
  putProviderKey,
  removeAllProviderKeys,
  removeProviderKey,
  scrubSecrets,
} from '../src/auth/providerKeys.js';
import { _setFakeKeychain, getCredential, setCredential } from '../src/auth/store.js';
import { loadConfig, loadGlobalConfig } from '../src/config/load.js';
import { ConfigSchema } from '../src/config/schema.js';
import { PROJECT_POLICY } from '../src/config/projectPolicy.js';
import { trustProjectFolder } from '../src/config/load.js';
import { endpointApiKey, keyFromRef } from '../src/providers/openaiCompatible.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { getAnthropicKey } from '../src/auth/claude.js';
import { deriveModelClass } from '../src/harness/profile.js';
import { Router } from '../src/router/router.js';
import { resolveStack } from '../src/router/stack.js';

let home: string;
let project: string;
const SECRET = 'sk-or-v1-0123456789abcdef0123456789abcdef';

function globalFile(): Record<string, any> {
  return JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
}

function writeGlobal(value: unknown): void {
  writeFileSync(join(home, 'config.json'), JSON.stringify(value));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-keys-'));
  project = mkdtempSync(join(tmpdir(), 'osc-keys-project-'));
  process.env.OSC_HOME = home;
  _setFakeKeychain({});
});

afterEach(() => {
  _setFakeKeychain(undefined);
  vi.unstubAllGlobals();
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('putting a key', () => {
  it('stores the key under its own name and writes the provider beside the default Ollama', () => {
    const row = putProviderKey('openrouter', { key: SECRET });
    expect(row).toMatchObject({ id: 'openrouter', label: 'OpenRouter', host: 'openrouter.ai' });
    expect(getCredential('provider-key:openrouter')).toBe(SECRET);
    const file = globalFile();
    expect(file.providers.openrouter).toEqual({
      kind: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyRef: 'provider-key:openrouter',
      label: 'OpenRouter',
      versionedBase: true,
    });
    // A fresh server has no config file: the first key keeps the model server
    // every stack starts on, so `osc stack use` still finds 'ollama'.
    expect(file.providers.ollama).toEqual({
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:11434',
    });
    // The key is in the store only, never in the config file.
    expect(readFileSync(join(home, 'config.json'), 'utf8')).not.toContain(SECRET);
  });

  it('takes any provider at an address it is given, and replaces its own key', () => {
    putProviderKey('fireworks', {
      key: 'fw-first-key-123456',
      baseUrl: 'https://api.fireworks.ai/inference/v1/',
      label: 'Fireworks',
    });
    putProviderKey('fireworks', {
      key: 'fw-second-key-123456',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
    });
    expect(getCredential('provider-key:fireworks')).toBe('fw-second-key-123456');
    expect(globalFile().providers.fireworks.baseUrl).toBe('https://api.fireworks.ai/inference/v1');
  });

  it('never overwrites a provider it did not write', () => {
    writeGlobal({
      providers: {
        ollama: { kind: 'openai-compatible', baseUrl: 'http://localhost:11434' },
        openai: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com',
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        mine: { kind: 'openai-compatible', baseUrl: 'https://llm.example.org/v1' },
      },
    });
    for (const id of ['ollama', 'openai', 'mine']) {
      expect(() =>
        putProviderKey(id, { key: 'some-key-123456', baseUrl: 'https://x.test/v1' }),
      ).toThrow(/set up another way/);
    }
    expect(getCredential('provider-key:openai')).toBeUndefined();
    // And with no file at all, the default Ollama is just as much not ours.
    rmSync(join(home, 'config.json'));
    expect(() =>
      putProviderKey('ollama', { key: 'k-123456789', baseUrl: 'https://x.test' }),
    ).toThrow(/set up another way/);
  });

  it('refuses a bad id, an empty or spaced key, plain http off this network, and credentials in the address', () => {
    const bad: Array<[unknown, Record<string, unknown>, RegExp]> = [
      ['Open Router', { key: SECRET }, /lower-case/],
      ['-x', { key: SECRET }, /lower-case/],
      ['a'.repeat(42), { key: SECRET }, /lower-case/],
      ['openrouter', { key: '' }, /Send the API key/],
      ['openrouter', { key: 'two words here' }, /no spaces/],
      ['openrouter', { key: 42 }, /Send the API key/],
      ['unknownco', { key: SECRET }, /does not know where unknownco answers/],
      ['unknownco', { key: SECRET, baseUrl: 'http://api.example.org/v1' }, /https/],
      ['unknownco', { key: SECRET, baseUrl: 'https://me:pw@api.example.org/v1' }, /no name/],
      ['unknownco', { key: SECRET, baseUrl: 'https://api.example.org/v1?key=1' }, /query/],
      ['unknownco', { key: SECRET, baseUrl: 'not a url' }, /not an address/],
      ['openrouter', { key: SECRET, workspaceId: 'wrkspc_1' }, /only with a Claude key/],
      ['openrouter', { key: SECRET, label: 'bad‮label' }, /control or direction/],
    ];
    for (const [id, input, why] of bad) {
      expect(() => putProviderKey(id, input as never), String(id)).toThrow(why);
    }
    expect(globalFileExists()).toBe(false);
  });

  it('takes plain http only for an address on this network', () => {
    expect(cleanBaseUrl('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1');
    expect(cleanBaseUrl('http://192.168.1.20:8000/v1')).toBe('http://192.168.1.20:8000/v1');
    expect(() => cleanBaseUrl('http://203.0.113.9/v1')).toThrow(ProviderKeyError);
  });

  it('keeps the Claude key where osc login keeps it, with its workspace, at Anthropic only', () => {
    const row = putProviderKey('anthropic', {
      key: 'sk-ant-api03-abcdefghijklmnop',
      workspaceId: 'wrkspc_01ABC',
    });
    expect(row).toMatchObject({ id: 'anthropic', label: 'Claude', host: 'api.anthropic.com' });
    expect(getCredential('anthropic-api-key')).toBe('sk-ant-api03-abcdefghijklmnop');
    expect(getCredential('anthropic-workspace-id')).toBe('wrkspc_01ABC');
    expect(globalFile().providers.anthropic).toEqual({ kind: 'anthropic' });
    expect(globalFile().providers.ollama).toBeDefined();
    expect(getAnthropicKey()).toBe('sk-ant-api03-abcdefghijklmnop');
    // A later key with no workspace clears the old one, as osc login does.
    putProviderKey('anthropic', { key: 'sk-ant-api03-zzzzzzzzzzzzzz' });
    expect(getCredential('anthropic-workspace-id')).toBeUndefined();
    expect(() => putProviderKey('anthropic', { key: 'not-a-claude-key' })).toThrow(/sk-ant-/);
    expect(() =>
      putProviderKey('anthropic', {
        key: 'sk-ant-api03-zzzzzzzzzzzzzz',
        baseUrl: 'https://gateway.example.org',
      }),
    ).toThrow(/Anthropic's own address/);
  });

  it('leaves a Claude record pointed at another address alone', () => {
    writeGlobal({ providers: { anthropic: { kind: 'anthropic', baseUrl: 'https://gw.test' } } });
    expect(() => putProviderKey('anthropic', { key: 'sk-ant-api03-abcdefghijklmnop' })).toThrow(
      /osc login --logout/,
    );
    expect(getCredential('anthropic-api-key')).toBeUndefined();
  });

  it('puts the old key back when the config cannot be written', () => {
    putProviderKey('groq', { key: 'gsk_first_key_123456' });
    // A config that no longer parses is refused, never overwritten.
    writeFileSync(join(home, 'config.json'), '{not json');
    expect(() => putProviderKey('groq', { key: 'gsk_second_key_123456' })).toThrow();
    expect(getCredential('provider-key:groq')).toBe('gsk_first_key_123456');
  });

  it('refuses to write while the keychain is locked, and says so without the key', () => {
    _setFakeKeychain({ locked: true });
    let message = '';
    try {
      putProviderKey('groq', { key: 'gsk_locked_key_123456' });
    } catch (err) {
      message = (err as Error).message;
      expect((err as ProviderKeyError).status).toBe(503);
    }
    expect(message).toMatch(/locked/);
    expect(message).not.toContain('gsk_locked_key_123456');
  });
});

function globalFileExists(): boolean {
  try {
    readFileSync(join(home, 'config.json'));
    return true;
  } catch {
    return false;
  }
}

describe('listing keys', () => {
  it('answers which providers hold a key, never the key, a fingerprint, or a date', () => {
    putProviderKey('openrouter', { key: SECRET });
    putProviderKey('groq', { key: 'gsk_list_key_123456' });
    putProviderKey('anthropic', { key: 'sk-ant-api03-abcdefghijklmnop' });
    const rows = listProviderKeys();
    expect(rows).toEqual([
      { id: 'openrouter', label: 'OpenRouter', host: 'openrouter.ai' },
      { id: 'groq', label: 'Groq', host: 'api.groq.com' },
      { id: 'anthropic', label: 'Claude', host: 'api.anthropic.com' },
    ]);
    const text = JSON.stringify(rows);
    for (const secret of [SECRET, 'gsk_list_key_123456', 'sk-ant-api03', 'provider-key']) {
      expect(text).not.toContain(secret);
    }
  });

  it('leaves out a hand-written endpoint and a provider whose key is gone', () => {
    writeGlobal({
      providers: {
        mine: { kind: 'openai-compatible', baseUrl: 'https://llm.example.org/v1' },
        anthropic: { kind: 'anthropic' },
      },
    });
    putProviderKey('groq', { key: 'gsk_list_key_123456' });
    setCredential('provider-key:mine', 'stray');
    expect(listProviderKeys().map((r) => r.id)).toEqual(['groq']);
  });
});

describe('removing keys', () => {
  it('deletes the key and the provider, and clears every slot that named it', () => {
    putProviderKey('openrouter', { key: SECRET });
    placeOrchestrator({ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' });
    const file = globalFile();
    file.stack.specialists = {
      coding: { provider: 'openrouter', model: 'qwen/qwen3-coder' },
      vision: { provider: 'ollama', model: 'llava:7b' },
    };
    writeGlobal(file);

    const gone = removeProviderKey('openrouter');
    expect(gone).toEqual({ removed: ['openrouter'], slotsCleared: ['orchestrator', 'coding'] });
    expect(getCredential('provider-key:openrouter')).toBeUndefined();
    const after = globalFile();
    expect(after.providers.openrouter).toBeUndefined();
    expect(after.providers.ollama).toBeDefined();
    expect(after.stack.orchestrator).toBeUndefined();
    expect(after.stack.specialists).toEqual({ vision: { provider: 'ollama', model: 'llava:7b' } });
    // A later session meets no missing provider: the vision slot still resolves.
    const config = loadGlobalConfig();
    expect(() => resolveStack(config, new ProviderRegistry(config, getAnthropicKey))).toThrow(
      /No orchestrator/,
    );
  });

  it('refuses a provider it did not write, and answers nothing removed for one never added', () => {
    writeGlobal({ providers: { mine: { kind: 'openai-compatible', baseUrl: 'https://a.test' } } });
    expect(() => removeProviderKey('mine')).toThrow(/set up another way/);
    expect(globalFile().providers.mine).toBeDefined();
    expect(removeProviderKey('groq')).toEqual({ removed: [], slotsCleared: [] });
  });

  it('removes a key left in the store with no provider pointing at it', () => {
    setCredential('provider-key:groq', 'gsk_orphan_123456');
    expect(removeProviderKey('groq').removed).toEqual(['groq']);
    expect(getCredential('provider-key:groq')).toBeUndefined();
  });

  it('removes every key it keeps, the Claude key too, for forgetting a server', () => {
    writeGlobal({
      providers: { mine: { kind: 'openai-compatible', baseUrl: 'https://a.test' } },
      stack: { orchestrator: { provider: 'mine', model: 'm' } },
    });
    putProviderKey('openrouter', { key: SECRET });
    putProviderKey('groq', { key: 'gsk_all_key_123456' });
    putProviderKey('anthropic', { key: 'sk-ant-api03-abcdefghijklmnop', workspaceId: 'wrkspc_1' });
    placeOrchestrator({ provider: 'groq', model: 'openai/gpt-oss-120b' });

    const gone = removeAllProviderKeys();
    expect(gone.removed.sort()).toEqual(['anthropic', 'groq', 'openrouter']);
    expect(gone.slotsCleared).toEqual(['orchestrator']);
    for (const name of [
      'provider-key:openrouter',
      'provider-key:groq',
      'anthropic-api-key',
      'anthropic-workspace-id',
    ]) {
      expect(getCredential(name), name).toBeUndefined();
    }
    const after = globalFile();
    // The file named its own providers, so nothing was added to them.
    expect(Object.keys(after.providers)).toEqual(['mine']);
    expect(listProviderKeys()).toEqual([]);
  });

  it('changes nothing while the keychain is locked', () => {
    putProviderKey('groq', { key: 'gsk_locked_key_123456' });
    _setFakeKeychain({ entries: new Map([['provider-key:groq', 'x']]), locked: true });
    expect(() => removeProviderKey('groq')).toThrow(/locked/);
    expect(globalFile().providers.groq).toBeDefined();
  });
});

describe('placing the orchestrator', () => {
  it('places a configured model, and keeps the window only for a provider off this network', () => {
    putProviderKey('deepseek', { key: 'sk-deepseek-key-0123456789abcdef' });
    expect(
      placeOrchestrator({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        contextTokens: 1_000_000,
      }),
    ).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      kind: 'cloud',
      contextTokens: 1_000_000,
    });
    const file = globalFile();
    expect(file.stack.orchestrator).toEqual({ provider: 'deepseek', model: 'deepseek-v4-pro' });
    expect(file.providers.deepseek.contextWindows).toEqual({ 'deepseek-v4-pro': 1_000_000 });

    // A model on this network is served the window its server sets.
    expect(
      placeOrchestrator({ provider: 'ollama', model: 'qwen2.5:7b', contextTokens: 131072 }),
    ).toEqual({ provider: 'ollama', model: 'qwen2.5:7b', kind: 'local' });
    expect(globalFile().providers.ollama.contextWindows).toBeUndefined();
  });

  it('refuses a provider that is not configured, an empty model, and a window out of range', () => {
    expect(() => placeOrchestrator({ provider: 'nope', model: 'm' })).toThrow(/no provider "nope"/);
    putProviderKey('groq', { key: 'gsk_place_key_123456' });
    expect(() => placeOrchestrator({ provider: 'groq', model: '' })).toThrow(/model/);
    expect(() => placeOrchestrator({ provider: 'groq', model: 'm', contextTokens: 12.5 })).toThrow(
      /whole number/,
    );
    expect(() => placeOrchestrator({ provider: 'groq', model: 'm', contextTokens: 10 })).toThrow(
      /whole number/,
    );
  });

  it('keeps a bounded set of windows, newest last', () => {
    putProviderKey('groq', { key: 'gsk_window_key_123456' });
    for (let i = 0; i < 40; i++) {
      placeOrchestrator({ provider: 'groq', model: `m${i}`, contextTokens: 131072 });
    }
    const windows = globalFile().providers.groq.contextWindows;
    expect(Object.keys(windows)).toHaveLength(32);
    expect(Object.keys(windows).at(-1)).toBe('m39');
    expect(windows.m0).toBeUndefined();
  });
});

describe('the provider-key namespace', () => {
  it('the schema takes only a provider-key name for apiKeyRef', () => {
    const endpoint = (apiKeyRef: string) => ({
      providers: { x: { kind: 'openai-compatible', baseUrl: 'https://a.test', apiKeyRef } },
    });
    expect(ConfigSchema.safeParse(endpoint('provider-key:groq')).success).toBe(true);
    for (const ref of [
      'anthropic-api-key',
      'anthropic-workspace-id',
      'github-token',
      'data-key',
      'openai-api-key',
      'session-key:abc:jev',
      'provider-key:',
      'provider-key:Groq',
      'provider-key:groq extra',
    ]) {
      expect(ConfigSchema.safeParse(endpoint(ref)).success, ref).toBe(false);
      expect(
        ConfigSchema.safeParse({
          providers: { a: { kind: 'anthropic', apiKeyRef: ref } },
        }).success,
        ref,
      ).toBe(false);
    }
  });

  it('the read checks the namespace again, so no other credential is ever read', () => {
    const asked: string[] = [];
    const read = (n: string) => (asked.push(n), 'value');
    expect(keyFromRef('anthropic-api-key', read)).toBeUndefined();
    expect(keyFromRef('github-token', read)).toBeUndefined();
    expect(keyFromRef('session-key:s:jev', read)).toBeUndefined();
    expect(asked).toEqual([]);
    expect(keyFromRef('provider-key:groq', read)).toBe('value');
    expect(asked).toEqual(['provider-key:groq']);
  });

  it('endpointApiKey reads the variable, then its stand-in, then the reference', () => {
    const store: Record<string, string> = {
      'openai-api-key': 'sk-stand-in',
      'provider-key:groq': 'gsk_ref',
    };
    const read = (n: string) => store[n];
    expect(
      endpointApiKey(
        { apiKeyEnv: 'GROQ_KEY', apiKeyRef: 'provider-key:groq' },
        { GROQ_KEY: 'env' },
        read,
      ),
    ).toBe('env');
    expect(
      endpointApiKey({ apiKeyEnv: 'OPENAI_API_KEY', apiKeyRef: 'provider-key:groq' }, {}, read),
    ).toBe('sk-stand-in');
    expect(
      endpointApiKey({ apiKeyEnv: 'UNSET_VAR', apiKeyRef: 'provider-key:groq' }, {}, read),
    ).toBe('gsk_ref');
    expect(endpointApiKey({ apiKeyRef: 'provider-key:groq' }, {}, read)).toBe('gsk_ref');
    expect(endpointApiKey({}, {}, read)).toBeUndefined();
  });

  it('every new endpoint key is machine config: a project file cannot set one, trusted or not', () => {
    expect(PROJECT_POLICY.providers).toBe('machine');
    putProviderKey('groq', { key: 'gsk_project_key_123456' });
    writeFileSync(
      join(project, 'os-code.config.json'),
      JSON.stringify({
        providers: {
          ollama: {
            kind: 'openai-compatible',
            baseUrl: 'http://localhost:11434',
            apiKeyRef: 'provider-key:groq',
            versionedBase: true,
            contextWindows: { 'qwen2.5:7b': 1_000_000 },
          },
          groq: {
            kind: 'openai-compatible',
            baseUrl: 'https://evil.example.org/v1',
            apiKeyRef: 'provider-key:groq',
          },
        },
      }),
    );
    trustProjectFolder(project);
    const { config, warnings } = loadConfig(project);
    expect(config.providers.ollama).toEqual({
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:11434',
    });
    expect(config.providers.groq).toMatchObject({ baseUrl: 'https://api.groq.com/openai/v1' });
    expect(warnings.join('\n')).toMatch(/providers settings are machine config/);
  });
});

describe('a stored key at runtime', () => {
  function captureFetch(answer: (url: string) => unknown = () => ({ data: [{ id: 'm1' }] })) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(answer(url)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    return calls;
  }

  it('a keyed provider API gets its own key on the versioned paths, and none of the four probes', async () => {
    putProviderKey('groq', { key: 'gsk_runtime_key_123456' });
    const calls = captureFetch();
    const config = loadGlobalConfig();
    const registry = new ProviderRegistry(config, getAnthropicKey);
    expect(await registry.rawProvider('groq')!.listModels()).toEqual(['m1']);
    expect(calls.map((c) => c.url)).toEqual(['https://api.groq.com/openai/v1/models']);
    expect(calls[0]!.headers.authorization).toBe('Bearer gsk_runtime_key_123456');
  });

  it('a chat on a versioned base goes to its own /chat/completions, with no /v1 added', async () => {
    putProviderKey('deepseek', { key: 'sk-deepseek-key-0123456789abcdef' });
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      const sse = [
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
        '',
      ].join('\n\n');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const provider = new ProviderRegistry(loadGlobalConfig(), getAnthropicKey).get('deepseek');
    let text = '';
    for await (const e of provider.chat({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      if (e.type === 'text') text += e.delta;
    }
    expect(text).toBe('Hi');
    expect(seen).toEqual(['https://api.deepseek.com/chat/completions']);
  });

  it('a provider off this network is budgeted against the window it was placed with, and is not small', async () => {
    putProviderKey('deepseek', { key: 'sk-deepseek-key-0123456789abcdef' });
    placeOrchestrator({ provider: 'deepseek', model: 'deepseek-v4-pro', contextTokens: 1_000_000 });
    const calls = captureFetch();
    const config = loadGlobalConfig();
    const provider = new ProviderRegistry(config, getAnthropicKey).get('deepseek');
    const caps = await provider.capabilities('deepseek-v4-pro');
    expect(caps.contextTokens).toBe(1_000_000);
    // Knowing that sent nothing: no probe, no model list.
    expect(calls).toEqual([]);
    expect(deriveModelClass({ model: 'deepseek-v4-pro', kind: provider.kind, caps })).toBe('mid');
    // Without a window it stays the cautious guess, as before.
    const unknown = await provider.capabilities('some-model');
    expect(unknown.contextTokens).toBe(8192);
  });

  it('a local server never reads a listed window: it is budgeted against what it serves', async () => {
    writeGlobal({
      providers: {
        lan: {
          kind: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:9',
          contextWindows: { 'mystery-model': 1_000_000 },
        },
      },
    });
    const { _setProbeResult } = await import('../src/providers/capabilities.js');
    _setProbeResult('http://127.0.0.1:9', {
      flavor: 'vllm',
      grammar: true,
      nativeTools: true,
      label: 'vLLM',
    });
    const provider = new ProviderRegistry(loadGlobalConfig(), getAnthropicKey).get('lan');
    expect((await provider.capabilities('mystery-model')).contextTokens).toBe(8192);
    _setProbeResult('http://127.0.0.1:9', undefined);
  });

  it('an Anthropic-compatible host with its own key never gets the Claude key or workspace', async () => {
    setCredential('anthropic-api-key', 'sk-ant-api03-claude-key-000');
    setCredential('anthropic-workspace-id', 'wrkspc_PERSON');
    setCredential('provider-key:minimax', 'mm-own-key-123456');
    writeGlobal({
      providers: {
        anthropic: { kind: 'anthropic' },
        minimax: {
          kind: 'anthropic',
          baseUrl: 'https://api.minimax.io/anthropic',
          apiKeyRef: 'provider-key:minimax',
        },
        gateway: { kind: 'anthropic', baseUrl: 'https://gateway.example.org' },
      },
    });
    const calls = captureFetch();
    const registry = new ProviderRegistry(loadGlobalConfig(), getAnthropicKey);
    for (const id of ['anthropic', 'minimax', 'gateway']) {
      expect(registry.rawProvider(id)).toBeInstanceOf(AnthropicProvider);
      await registry.rawProvider(id)!.listModels();
    }
    const [claude, minimax, gateway] = calls;
    expect(claude!.url).toMatch(/^https:\/\/api\.anthropic\.com\//);
    expect(claude!.headers['x-api-key']).toBe('sk-ant-api03-claude-key-000');
    expect(claude!.headers['anthropic-workspace-id']).toBe('wrkspc_PERSON');
    expect(minimax!.headers['x-api-key']).toBe('mm-own-key-123456');
    expect(minimax!.headers['anthropic-workspace-id']).toBeUndefined();
    // A hand-written gateway keeps the Claude key it always used, never the
    // person's workspace.
    expect(gateway!.headers['x-api-key']).toBe('sk-ant-api03-claude-key-000');
    expect(gateway!.headers['anthropic-workspace-id']).toBeUndefined();
  });

  it('an Anthropic-compatible host with its own key is never the escalation target', () => {
    setCredential('provider-key:minimax', 'mm-own-key-123456');
    setCredential('anthropic-api-key', 'sk-ant-api03-claude-key-000');
    const config = ConfigSchema.parse({
      providers: {
        ollama: { kind: 'openai-compatible', baseUrl: 'http://localhost:11434' },
        minimax: {
          kind: 'anthropic',
          baseUrl: 'https://api.minimax.io/anthropic',
          apiKeyRef: 'provider-key:minimax',
          model: 'MiniMax-M3',
        },
      },
      stack: { orchestrator: { provider: 'ollama', model: 'qwen2.5:7b' } },
    });
    const registry = new ProviderRegistry(config, getAnthropicKey);
    const router = new Router(config, registry, resolveStack(config, registry));
    expect(router.escalationTarget()).toBeUndefined();
    const withClaude = ConfigSchema.parse({
      ...config,
      providers: { ...config.providers, anthropic: { kind: 'anthropic' } },
    });
    const reg2 = new ProviderRegistry(withClaude, getAnthropicKey);
    const router2 = new Router(withClaude, reg2, resolveStack(withClaude, reg2));
    expect(router2.escalationTarget()?.provider.id).toBe('anthropic');
  });
});

describe('the base table agrees with the app', () => {
  // Every provider the app names with an OpenAI-compatible base (and Claude)
  // is one `osc key add` knows, at the same address.
  it('names every app provider, at the same base', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'app', 'src', 'lib', 'providers.ts'),
      'utf8',
    );
    const start = source.indexOf('export const PROVIDERS');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);
    const ids = [...body.matchAll(/^ {4}id: '([^']+)'/gm)];
    expect(ids.length).toBeGreaterThan(5);
    const app: Record<string, string | undefined> = {};
    ids.forEach((m, i) => {
      const end = ids[i + 1]?.index ?? body.length;
      const entry = body.slice(m.index, end);
      app[m[1]!] = /^ {4}openaiBaseUrl: '([^']+)'/m.exec(entry)?.[1];
    });
    for (const [id, base] of Object.entries(app)) {
      if (id === 'anthropic') {
        expect(KNOWN_PROVIDERS.anthropic).toBeDefined();
        continue;
      }
      if (!base) continue;
      expect(KNOWN_PROVIDERS[id]?.baseUrl, id).toBe(base);
    }
  });
});

describe('scrubbing', () => {
  it('replaces the exact key and anything shaped like one', () => {
    expect(scrubSecrets('failed for mistral-plain-key-abc here', 'mistral-plain-key-abc')).toBe(
      'failed for [redacted] here',
    );
    expect(scrubSecrets('saw sk-ant-api03-abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
  });
});
