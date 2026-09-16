// Ollama from inside the app (A3), engine-host half. The probes are injected
// so every state is reproducible without Ollama on the machine: installed and
// running, installed but not running (start it), and not installed (Linux runs
// the official installer in the built-in terminal; macOS and Windows open the
// download page). The command is always returned so the renderer can show it
// as a copy block.
import { describe, expect, it } from 'vitest';
import {
  OLLAMA_INSTALL_COMMAND,
  ollamaInstallPlan,
  probeOllama,
  startOllama,
} from '../electron/ollama.js';

const version = (v: string) => async () =>
  ({ ok: true, json: async () => ({ version: v }) }) as unknown as Response;
const down = async () => {
  throw new Error('ECONNREFUSED');
};

describe('probeOllama', () => {
  it('reports installed and running with the version when /api/version answers', async () => {
    const status = await probeOllama({
      baseUrl: 'http://localhost:11434',
      fetch: version('0.6.2'),
      commandExists: () => true,
    });
    expect(status).toEqual({ installed: true, running: true, version: '0.6.2' });
  });

  it('tells installed-not-running from not-installed', async () => {
    expect(
      await probeOllama({ baseUrl: 'http://x', fetch: down, commandExists: () => true }),
    ).toEqual({ installed: true, running: false });
    expect(
      await probeOllama({ baseUrl: 'http://x', fetch: down, commandExists: () => false }),
    ).toEqual({ installed: false, running: false });
  });

  it('a server that answers counts as installed even when the binary is off PATH', async () => {
    // A macOS app bundle or a Docker Ollama: the API is what the engine uses.
    const status = await probeOllama({
      baseUrl: 'http://x',
      fetch: version('0.5.0'),
      commandExists: () => false,
    });
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
  });
});

describe('startOllama', () => {
  it('spawns `ollama serve` detached and waits for the API to answer', async () => {
    const spawned: string[][] = [];
    let polls = 0;
    const ok = await startOllama({
      baseUrl: 'http://x',
      spawn: (cmd, args) => {
        spawned.push([cmd, ...args]);
        return { unref() {} };
      },
      fetch: async () => {
        polls++;
        if (polls < 3) throw new Error('not yet');
        return { ok: true, json: async () => ({ version: '0.6.2' }) } as unknown as Response;
      },
      pollEveryMs: 1,
      timeoutMs: 500,
    });
    expect(ok).toBe(true);
    expect(spawned).toEqual([['ollama', 'serve']]);
  });

  it('gives up honestly when the server never answers', async () => {
    const ok = await startOllama({
      baseUrl: 'http://x',
      spawn: () => ({ unref() {} }),
      fetch: down,
      pollEveryMs: 1,
      timeoutMs: 20,
    });
    expect(ok).toBe(false);
  });

  it('a spawn failure (no binary) is false, never a throw', async () => {
    const ok = await startOllama({
      baseUrl: 'http://x',
      spawn: () => {
        throw new Error('spawn ollama ENOENT');
      },
      fetch: down,
      pollEveryMs: 1,
      timeoutMs: 20,
    });
    expect(ok).toBe(false);
  });
});

describe('ollamaInstallPlan', () => {
  it('Linux runs the official installer in the built-in terminal', () => {
    const plan = ollamaInstallPlan('linux');
    expect(plan.mode).toBe('terminal');
    expect(plan.command).toBe(OLLAMA_INSTALL_COMMAND);
    expect(plan.command).toBe('curl -fsSL https://ollama.com/install.sh | sh');
  });

  it('macOS and Windows open the download page, and still name the command', () => {
    expect(ollamaInstallPlan('darwin')).toEqual({
      mode: 'download',
      command: 'open https://ollama.com/download/mac',
      downloadUrl: 'https://ollama.com/download/mac',
    });
    expect(ollamaInstallPlan('win32')).toEqual({
      mode: 'download',
      command: 'start https://ollama.com/download/windows',
      downloadUrl: 'https://ollama.com/download/windows',
    });
  });
});
