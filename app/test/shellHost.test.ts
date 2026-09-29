// The engine host's secrets and child processes (the D2 shell package),
// against the real host with a fake pty and a temp engine home: the OpenAI key
// never lands in process.env (every shell inherited it) yet the provider still
// finds it after a relaunch; a session's terminal reopens its running shell
// instead of stacking a new one per visit, and quitting ends every shell; the
// Linux install runs nothing; and a device revoke cuts exactly one device.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineHost } from '../electron/engineHost.js';
import {
  TerminalManager,
  type PtySpawnOptions,
  type TerminalPty,
} from 'os-code/dist/src/daemon/terminal.js';
import { _setFakeKeychain, getCredential } from 'os-code/dist/src/auth/store.js';
import { endpointApiKey } from 'os-code/dist/src/providers/openaiCompatible.js';
import {
  loadCredentials,
  mintCredential,
  resolveDeviceCredential,
} from 'os-code/dist/src/core/security/credentials.js';

let home: string;
const savedKey = process.env.OPENAI_API_KEY;

beforeAll(() => {
  delete process.env.OPENAI_API_KEY;
});
afterAll(() => {
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  // A model pointed at a dead port: sessions open, nothing is ever called.
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      providers: { ollama: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1' } },
      stack: { orchestrator: { provider: 'ollama', model: 'test-model' } },
    }),
  );
  _setFakeKeychain({});
});
afterEach(() => {
  _setFakeKeychain(undefined);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

interface Spawned {
  opts: PtySpawnOptions;
  killed: boolean;
}

function hostWithPty(platform: NodeJS.Platform = 'linux') {
  const spawned: Spawned[] = [];
  const terminals = new TerminalManager({
    spawn: async (opts) => {
      const entry: Spawned = { opts, killed: false };
      spawned.push(entry);
      const pty: TerminalPty = {
        write() {},
        resize() {},
        kill() {
          entry.killed = true;
        },
        onData() {},
        onExit() {},
      };
      return pty;
    },
  });
  const host = new EngineHost(
    () => {},
    () => {},
    () => {},
    { terminals, platform, tailscale: () => ({ running: false, ip: undefined }) },
  );
  return { host, spawned };
}

describe('the OpenAI key stays out of process.env', () => {
  it('Connect ChatGPT stores the key and the provider reads it back after a relaunch', async () => {
    const { host } = hostWithPty();
    const key = 'sk-test-connect-0123456789';
    const result = await host.setOpenAIKey(key);
    expect(result.ok).toBe(true);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(getCredential('openai-api-key')).toBe(key);
    // What the provider sends with nothing in the environment.
    expect(endpointApiKey('OPENAI_API_KEY')).toBe(key);
    host.disposeAll();
  });
});

describe("a session's terminal", () => {
  it('reopens the shell it left running, and quitting ends every shell', async () => {
    const { host, spawned } = hostWithPty();
    const cwd = mkdtempSync(join(tmpdir(), 'osc-repo-'));
    const { id } = await host.createSession(cwd);
    // A key this process holds (launched from a terminal that exported one).
    process.env.OPENAI_API_KEY = 'sk-planted-in-process';
    const first = await host.openTerminal(id, 80, 24);
    const again = await host.openTerminal(id, 100, 30);
    expect('termId' in first && 'termId' in again).toBe(true);
    expect((again as { termId: string }).termId).toBe((first as { termId: string }).termId);
    expect(spawned).toHaveLength(1);
    // It never reaches the shell.
    expect(spawned[0]!.opts.env.OPENAI_API_KEY).toBeUndefined();
    // PATH passes through. Windows spells the variable "Path" and reads names
    // in any case, so the copy is looked up the way the shell will read it.
    const pathVar = Object.entries(spawned[0]!.opts.env).find(
      ([name]) => name.toUpperCase() === 'PATH',
    );
    expect(pathVar?.[1]).toBe(process.env.PATH);

    host.disposeAll();
    expect(spawned.every((s) => s.killed)).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe('installing Ollama on Linux', () => {
  it('runs nothing: the command comes back for the person to run', async () => {
    const { host, spawned } = hostWithPty('linux');
    const plan = await host.ollamaInstall();
    expect(plan).toMatchObject({
      mode: 'terminal',
      started: false,
      command: 'curl -fsSL https://ollama.com/install.sh | sh',
    });
    expect(plan.termId).toBeUndefined();
    expect(spawned).toEqual([]);
    host.disposeAll();
  });
});

describe('revoking a paired device from the desktop', () => {
  it('cuts exactly the device whose whole hash it names, and nothing for less', () => {
    const { host } = hostWithPty();
    const phone = mintCredential({ role: 'admin', label: 'Phone' });
    const tablet = mintCredential({ role: 'admin', label: 'Tablet' });
    const hash = phone.credential.tokenHash;
    expect(host.revokeDeviceCredential('')).toEqual({ removed: 0 });
    expect(host.revokeDeviceCredential(hash.slice(0, 12))).toEqual({ removed: 0 });
    expect(host.revokeDeviceCredential('Phone')).toEqual({ removed: 0 });
    expect(loadCredentials()).toHaveLength(2);
    expect(host.revokeDeviceCredential(hash)).toEqual({ removed: 1 });
    expect(resolveDeviceCredential(phone.token)).toBeUndefined();
    expect(resolveDeviceCredential(tablet.token)?.label).toBe('Tablet');
    host.disposeAll();
  });
});
