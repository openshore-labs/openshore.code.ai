// Agentic Currents, engine side: the handle parser drops anything malformed
// rather than refusing a session; the Hermes home reader is jailed, markdown
// only, and size-capped; each current tool self-degrades without its handle
// and speaks its protocol when it has one; and the registry only ever
// registers a tool a handle was delivered for, never under egress lockdown.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENTIC_CURRENT_IDS,
  isAgenticCurrentId,
  normalizeHermesBaseUrl,
  parseCurrentsHandles,
} from '../src/currents/model.js';
import {
  commandOnPath,
  hermesHome,
  listHermesNotes,
  probeCurrentsHost,
  readHermesNote,
  titleFor,
} from '../src/currents/host.js';
import { askHermesTool } from '../src/core/tools/askHermes.js';
import { a2aText, askAgentTool, fetchAgentCard } from '../src/core/tools/askAgent.js';
import { cliAgentTool, cliCommandLine } from '../src/core/tools/cliAgent.js';
import { buildToolRegistry } from '../src/core/agent/registry.js';
import { EgressPolicy } from '../src/core/security/egress.js';
import type { ToolContext } from '../src/core/tools/index.js';

afterEach(() => vi.unstubAllGlobals());

function ctxWith(partial: Partial<ToolContext>): ToolContext {
  return {
    egress: new EgressPolicy({ webEnabled: true, allowlist: [], blocklist: [] }),
    cwd: process.cwd(),
    ...partial,
  } as unknown as ToolContext;
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown | Promise<unknown>) {
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = await handler(String(url), init);
    if (body instanceof Response) return body;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('currents model', () => {
  it('fixes the roster of five and recognizes only those ids', () => {
    expect(AGENTIC_CURRENT_IDS).toEqual(['hermes', 'cli', 'vellum', 'openagi', 'a2a']);
    expect(isAgenticCurrentId('hermes')).toBe(true);
    expect(isAgenticCurrentId('layers')).toBe(false);
  });

  it('normalizes a Hermes base URL the way BYOM does', () => {
    expect(normalizeHermesBaseUrl(' http://box:8642/v1/ ')).toBe('http://box:8642/v1');
    expect(normalizeHermesBaseUrl('http://box:8642/v1/chat/completions')).toBe(
      'http://box:8642/v1',
    );
  });

  it('parses handles and drops anything malformed instead of refusing', () => {
    expect(parseCurrentsHandles(undefined)).toBeUndefined();
    expect(parseCurrentsHandles('nope')).toBeUndefined();
    expect(parseCurrentsHandles({ hermes: { baseUrl: 'file:///etc/passwd' } })).toBeUndefined();
    expect(parseCurrentsHandles({ cli: { command: 'rm' } })).toBeUndefined();
    expect(
      parseCurrentsHandles({
        hermes: { baseUrl: 'http://box:8642/v1/', apiKey: ' k ', model: '' },
        a2a: { agentUrl: 'https://agent.example/' },
        cli: { command: 'codex' },
      }),
    ).toEqual({
      hermes: { baseUrl: 'http://box:8642/v1', apiKey: 'k', model: undefined },
      a2a: { agentUrl: 'https://agent.example', apiKey: undefined },
      cli: { command: 'codex' },
    });
  });
});

describe('hermes home reader', () => {
  let home: string;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  function seed(): string {
    home = mkdtempSync(join(tmpdir(), 'hermes-'));
    writeFileSync(join(home, 'MEMORY.md'), '# memory\nlikes tea');
    writeFileSync(join(home, 'SOUL.md'), 'calm');
    writeFileSync(join(home, 'config.yaml'), 'api_key: secret');
    writeFileSync(join(home, '.env'), 'TOKEN=secret');
    mkdirSync(join(home, 'skills', 'deploy-notes'), { recursive: true });
    writeFileSync(join(home, 'skills', 'deploy-notes', 'SKILL.md'), '# deploy notes');
    writeFileSync(join(home, 'skills', 'deploy-notes', 'helper.py'), 'print(1)');
    mkdirSync(join(home, 'skills', '.hidden'), { recursive: true });
    writeFileSync(join(home, 'skills', '.hidden', 'SKILL.md'), 'hidden');
    return home;
  }

  it('lists only memory, identity, and SKILL.md notes, never config or secrets', () => {
    const paths = listHermesNotes(seed()).map((n) => n.path);
    expect(paths.sort()).toEqual(['MEMORY.md', 'SOUL.md', 'skills/deploy-notes/SKILL.md']);
  });

  it('reads a note with a human title and refuses anything outside the served set', () => {
    seed();
    const memory = readHermesNote(home, 'MEMORY.md');
    expect(memory?.title).toBe('Memory');
    expect(memory?.text).toContain('likes tea');
    expect(readHermesNote(home, 'skills/deploy-notes/SKILL.md')?.title).toBe('deploy-notes');
    expect(readHermesNote(home, 'config.yaml')).toBeUndefined();
    expect(readHermesNote(home, '.env')).toBeUndefined();
    expect(readHermesNote(home, 'skills/deploy-notes/helper.py')).toBeUndefined();
    expect(readHermesNote(home, 'skills/.hidden/SKILL.md')).toBeUndefined();
    expect(readHermesNote(home, '../MEMORY.md')).toBeUndefined();
    expect(readHermesNote(home, '/etc/passwd')).toBeUndefined();
  });

  it('refuses a symlink that leaves the home', () => {
    seed();
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'USER.md'), 'leak');
    try {
      symlinkSync(join(outside, 'USER.md'), join(home, 'USER.md'));
    } catch {
      return; // no symlinks on this filesystem; nothing to prove
    }
    try {
      expect(readHermesNote(home, 'USER.md')).toBeUndefined();
      expect(listHermesNotes(home).map((n) => n.path)).not.toContain('USER.md');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('lists an absent home as empty and caps an oversized note', () => {
    expect(listHermesNotes(join(tmpdir(), 'no-such-hermes-home'))).toEqual([]);
    seed();
    writeFileSync(join(home, 'USER.md'), 'x'.repeat(600 * 1024));
    const big = readHermesNote(home, 'USER.md');
    expect(big?.text).toMatch(/larger than/);
  });

  it('titles notes like a person would', () => {
    expect(titleFor('MEMORY.md')).toBe('Memory');
    expect(titleFor('skills/foo-bar/SKILL.md')).toBe('foo-bar');
    expect(titleFor('Notes.md')).toBe('Notes');
  });

  it('probes the host honestly: HERMES_HOME wins, a CLI must be on PATH', () => {
    seed();
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    const env = { HERMES_HOME: home, PATH: bin } as NodeJS.ProcessEnv;
    expect(hermesHome(env)).toBe(home);
    expect(commandOnPath('claude', env)).toBe(true);
    expect(commandOnPath('codex', env)).toBe(false);
    const probe = probeCurrentsHost(env);
    expect(probe.hermes).toEqual({ home, present: true });
    expect(probe.cli).toEqual({ claude: true, codex: false });
    expect(probeCurrentsHost({ HERMES_HOME: join(home, 'missing'), PATH: '' }).hermes.present).toBe(
      false,
    );
  });
});

describe('askHermes', () => {
  it('is a network tool that self-degrades without a handle', async () => {
    expect(askHermesTool.risk).toBe('network');
    const out = await askHermesTool.execute({ task: 'hi' }, ctxWith({}));
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/not connected/i);
  });

  it('posts a chat completion with the session header and returns the answer', async () => {
    const fn = stubFetch(() => ({ choices: [{ message: { content: 'Tea is ready.' } }] }));
    const out = await askHermesTool.execute(
      { task: 'make tea' },
      ctxWith({
        currents: { hermes: { baseUrl: 'http://box.ts.net:8642/v1', apiKey: 'k' } },
        sessionId: 'sess1',
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.content).toContain('Tea is ready.');
    const [url, init] = fn.mock.calls[0]!;
    expect(String(url)).toBe('http://box.ts.net:8642/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-hermes-session-id']).toBe('oscode-sess1');
    expect(headers.authorization).toBe('Bearer k');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.messages[0].content).toBe('make tea');
    expect(body.stream).toBe(false);
  });

  it('honors the egress policy', async () => {
    const out = await askHermesTool.execute(
      { task: 'x' },
      ctxWith({
        egress: new EgressPolicy({ webEnabled: true, allowlist: [], blocklist: ['evil.example'] }),
        currents: { hermes: { baseUrl: 'https://evil.example/v1' } },
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/egress/);
  });
});

describe('askAgent (A2A)', () => {
  it('pulls text out of every result shape', () => {
    expect(a2aText(undefined)).toBe('');
    expect(a2aText({ artifacts: [{ parts: [{ kind: 'text', text: 'A' }] }] })).toBe('A');
    expect(a2aText({ status: { message: { parts: [{ type: 'text', text: 'S' }] } } })).toBe('S');
    expect(a2aText({ parts: [{ kind: 'text', text: 'M' }] })).toBe('M');
    expect(
      a2aText({
        history: [
          { role: 'user', parts: [{ kind: 'text', text: 'q' }] },
          { role: 'agent', parts: [{ kind: 'text', text: 'H' }] },
        ],
      }),
    ).toBe('H');
  });

  it('reads the agent card from either well-known path', async () => {
    stubFetch((url) =>
      url.endsWith('/.well-known/agent-card.json')
        ? new Response('not here', { status: 404 })
        : { name: 'Vellum' },
    );
    const card = await fetchAgentCard('https://agent.example');
    expect(card?.name).toBe('Vellum');
  });

  it('sends message/send and returns the answer with its contextId', async () => {
    const fn = stubFetch((url) => {
      if (url.includes('.well-known')) return { name: 'Hermes', url: 'https://agent.example/a2a' };
      return {
        result: {
          kind: 'task',
          contextId: 'ctx9',
          status: { state: 'completed' },
          artifacts: [{ parts: [{ kind: 'text', text: 'Done.' }] }],
        },
      };
    });
    const out = await askAgentTool.execute(
      { task: 'do it' },
      ctxWith({ currents: { a2a: { agentUrl: 'https://agent.example' } } }),
    );
    expect(out.ok).toBe(true);
    expect(out.content).toContain('Hermes answered');
    expect(out.content).toContain('ctx9');
    expect(out.content).toContain('Done.');
    const send = fn.mock.calls.find(([u]) => String(u) === 'https://agent.example/a2a')!;
    const body = JSON.parse(String((send[1] as RequestInit).body));
    expect(body.method).toBe('message/send');
    expect(body.params.message.parts[0].text).toBe('do it');
  });

  it('self-degrades without a handle', async () => {
    const out = await askAgentTool.execute({ task: 'x' }, ctxWith({}));
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/not connected|No A2A/i);
  });
});

describe('cliAgent (CLI Pairing)', () => {
  it('is a shell run and self-degrades without a paired CLI', async () => {
    expect(cliAgentTool.risk).toBe('shell');
    const out = await cliAgentTool.execute({ task: 'x' }, ctxWith({}));
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/No coding CLI/);
  });

  it('builds the exact headless invocation, single-quoted', () => {
    expect(cliCommandLine('claude', "fix it's")).toBe(
      `claude -p 'fix it'\\''s' --output-format text`,
    );
    expect(cliCommandLine('codex', 'add tests')).toBe(`codex exec 'add tests'`);
  });

  it('previews the command it will run', async () => {
    const p = await cliAgentTool.preview!(
      { task: 'add tests' },
      ctxWith({ currents: { cli: { command: 'codex' } } }),
    );
    expect(p.summary).toMatch(/Codex/);
    expect(p.detail).toContain('codex exec');
  });
});

describe('registry', () => {
  const base = { stackHasVision: false, stackHasImageGen: false, stackHasSpecialists: false };

  it('registers a current tool only when its handle was delivered', () => {
    expect(buildToolRegistry(base).names()).not.toContain('askHermes');
    const names = buildToolRegistry({
      ...base,
      currents: { hermes: { baseUrl: 'http://box/v1' } },
    }).names();
    expect(names).toContain('askHermes');
    expect(names).not.toContain('askAgent');
    expect(names).not.toContain('cliAgent');
  });

  it('never registers a current tool under egress lockdown', () => {
    const names = buildToolRegistry({
      ...base,
      egressLockdown: true,
      currents: {
        hermes: { baseUrl: 'http://box/v1' },
        a2a: { agentUrl: 'http://a' },
        cli: { command: 'claude' },
      },
    }).names();
    expect(names).not.toContain('askHermes');
    expect(names).not.toContain('askAgent');
    expect(names).not.toContain('cliAgent');
  });
});
