// The OpenAI-compatible provider's key after a relaunch (the D2 shell
// package). The desktop's Connect ChatGPT stored the key in the credential
// store and also wrote it into process.env, which every child shell
// inherited; the provider read only the environment. With the environment
// write gone, a relaunch left status() saying connected while the provider
// sent no key. The provider now falls back to the store, for the one variable
// the desktop fills there.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { endpointApiKey, OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import { _setFakeKeychain, _setSecretTool, setCredential } from '../src/auth/store.js';

let home: string;
let server: Server | undefined;
const savedKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  delete process.env.OPENAI_API_KEY;
  _setFakeKeychain({});
});
afterEach(async () => {
  _setFakeKeychain(undefined);
  _setSecretTool(undefined);
  delete process.env.OSC_HOME;
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server!.close(() => r(undefined)));
    server = undefined;
  }
  rmSync(home, { recursive: true, force: true });
});

describe('endpointApiKey', () => {
  it('reads the credential store when the variable is absent', () => {
    expect(
      endpointApiKey('OPENAI_API_KEY', {}, (n) => (n === 'openai-api-key' ? 'sk-s' : undefined)),
    ).toBe('sk-s');
  });

  it('the environment wins when the variable is set', () => {
    expect(endpointApiKey('OPENAI_API_KEY', { OPENAI_API_KEY: 'sk-env' }, () => 'sk-s')).toBe(
      'sk-env',
    );
  });

  it('a variable with no store entry of its own never reads the store', () => {
    const asked: string[] = [];
    const read = (n: string) => (asked.push(n), 'sk-other');
    expect(endpointApiKey('GITHUB_TOKEN', {}, read)).toBeUndefined();
    expect(endpointApiKey('ANTHROPIC_API_KEY', {}, read)).toBeUndefined();
    expect(endpointApiKey(undefined, {}, read)).toBeUndefined();
    expect(asked).toEqual([]);
  });
});

describe('the provider after a relaunch', () => {
  it('sends the stored key when nothing is in the environment', async () => {
    const seen: Array<string | undefined> = [];
    server = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    _setProbeResult(baseUrl, { flavor: 'vllm', grammar: false, nativeTools: true, label: 'test' });

    // What Connect ChatGPT leaves behind: the key in the store, the provider
    // pointed at the variable, and (now) nothing in process.env.
    setCredential('openai-api-key', 'sk-stored-after-relaunch');
    const provider = new OpenAICompatibleProvider('openai', {
      kind: 'openai-compatible',
      baseUrl,
      apiKeyEnv: 'OPENAI_API_KEY',
    });
    expect(await provider.listModels()).toEqual(['gpt-test']);
    expect(seen).toEqual(['Bearer sk-stored-after-relaunch']);
    _setProbeResult(baseUrl, undefined);
  });
});
