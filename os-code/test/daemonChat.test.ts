// The desktop chat's vault pack (Vault M5, CTO J6): `/chat` builds the pack
// on the daemon over the caller's own root, sized for the orchestrator's
// served window, places it last in the system line, and streams the card
// before the first text. A fake Ollama stands in for the local model, so the
// test reads exactly what the model was sent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';
import { closeEngineVaultIndexes } from '../src/core/vault/engineIndex.js';
import { buildChatPack } from '../src/daemon/vaultRoutes.js';
import { compileVaultPrivacy } from '../src/harness/vault/privacy.js';
import { _resetRoutineScheduler } from '../src/routines/scheduler.js';
import type { PreparedVaultContext } from '../src/harness/vaultContext.js';
import {
  portUnavailable,
  restoreHome,
  saveHome,
  setHome,
  type SavedHome,
} from './helpers/portable.js';

let home: string;
let realHome: SavedHome;
let daemon: RunningDaemon;
let base: string;
let admin: string;
let ollama: Server;
let sent: Array<{ messages: Array<{ role: string; content: string }> }>;

const CURRENT_STATE = 'We are shipping the login screen this week. The zeppelin flag stays off.';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

async function startOnFreePort(): Promise<RunningDaemon> {
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
      });
    } catch (err) {
      if (portUnavailable(err)) continue;
      throw err;
    }
  }
  throw new Error('could not find a free port for the test daemon');
}

beforeEach(async () => {
  sent = [];
  ollama = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/api/version') {
        res.end(JSON.stringify({ version: '0.9.0' }));
      } else if (req.url === '/api/show') {
        res.end(JSON.stringify({ model_info: { 'qwen2.context_length': 32768 } }));
      } else if (req.url === '/api/chat') {
        sent.push(JSON.parse(raw));
        res.write(`${JSON.stringify({ message: { content: 'Hello there.' }, done: false })}\n`);
        res.end(`${JSON.stringify({ done: true })}\n`);
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  const port = await listen(ollama);
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  realHome = saveHome();
  setHome(home);
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      providers: { ollama: { kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}` } },
      stack: { orchestrator: { provider: 'ollama', model: 'qwen2.5:7b' } },
    }),
  );
  // A project under ~/OSCode with its Current State in the repo.
  const repo = join(home, 'OSCode', 'repo');
  mkdirSync(join(repo, 'OpenShore Project Login MDs'), { recursive: true });
  writeFileSync(join(repo, 'OpenShore Project Login MDs', 'Current State.md'), CURRENT_STATE);
  // And one outside it, which a member may not name.
  const loose = join(home, 'loose');
  mkdirSync(join(loose, 'OpenShore Project Login MDs'), { recursive: true });
  writeFileSync(join(loose, 'OpenShore Project Login MDs', 'Current State.md'), CURRENT_STATE);
  _resetRoutineScheduler();
  daemon = await startOnFreePort();
  base = `http://127.0.0.1:${daemon.port}`;
  admin = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
});

afterEach(async () => {
  daemon.close();
  ollama.close();
  await closeEngineVaultIndexes();
  _resetRoutineScheduler();
  restoreHome(realHome);
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

async function chat(
  token: string,
  extra: Record<string, unknown>,
): Promise<{ lines: Array<Record<string, unknown>>; system: string }> {
  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'What ships this week?' }],
      ...extra,
    }),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  const lines = text
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  const system = sent[sent.length - 1]!.messages[0]!;
  expect(system.role).toBe('system');
  return { lines, system: system.content };
}

describe('/chat builds its pack on the daemon', () => {
  it('carries Current State last in the system line and streams the card before the text', async () => {
    const { lines, system } = await chat(admin, {
      vaultPack: { cwd: join(home, 'OSCode', 'repo'), projectName: 'Login' },
    });
    expect(lines[0]!.type).toBe('context-pack');
    expect(lines[0]).toMatchObject({ seat: 'local', mode: 'current-state', withheld: 0 });
    const sources = lines[0]!.sources as Array<{ layer: string }>;
    expect(sources.map((s) => s.layer)).toEqual(['current-state']);
    const firstText = lines.findIndex((l) => l.type === 'text');
    expect(firstText).toBeGreaterThan(0);
    expect(system).toContain(CURRENT_STATE);
    // The pack trails every fixed part of the system line.
    expect(system.indexOf(CURRENT_STATE)).toBeGreaterThan(system.indexOf('Never use em dashes.'));
    // Sized for the served window: well under the pack's ceiling.
    expect(lines[0]!.tokens as number).toBeLessThanOrEqual(lines[0]!.budgetTokens as number);
  });

  it('builds no pack when Memory is off or the app did not ask', async () => {
    const off = await chat(admin, {
      vaultPack: { cwd: join(home, 'OSCode', 'repo'), projectName: 'Login' },
      memory: false,
    });
    expect(off.lines.some((l) => l.type === 'context-pack')).toBe(false);
    expect(off.system).not.toContain(CURRENT_STATE);
    const old = await chat(admin, {});
    expect(old.lines.some((l) => l.type === 'context-pack')).toBe(false);
    expect(old.system).not.toContain(CURRENT_STATE);
  });

  it('reads Current State for a member only from an admin-provisioned workspace', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Phone', userId: 'u_member' });
    const loose = await chat(token, {
      vaultPack: { cwd: join(home, 'loose'), projectName: 'Login' },
    });
    expect(loose.system).not.toContain(CURRENT_STATE);
    expect(loose.lines.some((l) => l.type === 'context-pack')).toBe(false);
    const repo = await chat(token, {
      vaultPack: { cwd: join(home, 'OSCode', 'repo'), projectName: 'Login' },
    });
    expect(repo.system).toContain(CURRENT_STATE);
    // The admin may name any folder on the computer, as with a session.
    const adminLoose = await chat(admin, {
      vaultPack: { cwd: join(home, 'loose'), projectName: 'Login' },
    });
    expect(adminLoose.system).toContain(CURRENT_STATE);
  });

  it('scales the budget by Room for notes, capped by the machine (Vault M7, L13)', async () => {
    const privacy = compileVaultPrivacy({ exclude: [], localOnly: { paths: [], tags: [] } });
    const prepared: PreparedVaultContext = {
      index: null,
      bodies: new Map(),
      currentState: { path: 'cs.md', text: CURRENT_STATE },
      pins: [],
      privacy,
    };
    const root = mkdtempSync(join(tmpdir(), 'osc-chatpack-size-'));
    try {
      const budget = async (o: {
        packSize?: 'small' | 'normal' | 'large';
        packMaxTokens?: number;
      }) =>
        (
          await buildChatPack({
            root,
            privacy,
            task: 'What ships?',
            model: 'qwen2.5:7b',
            kind: 'local',
            caps: { contextTokens: 32768, supportsGrammar: false },
            setting: 'auto',
            ...o,
            source: { prepare: async () => prepared },
          })
        ).event!.budgetTokens;
      const normal = await budget({});
      expect(await budget({ packSize: 'normal' })).toBe(normal);
      expect(await budget({ packSize: 'small' })).toBeLessThan(normal);
      expect(await budget({ packSize: 'large' })).toBeGreaterThanOrEqual(normal);
      expect(await budget({ packSize: 'large', packMaxTokens: 500 })).toBeLessThanOrEqual(500);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders once per prepare for the served window, and not at all when off', async () => {
    const privacy = compileVaultPrivacy({
      exclude: [],
      localOnly: { paths: ['Private/**'], tags: [] },
    });
    const prepared: PreparedVaultContext = {
      index: null,
      bodies: new Map(),
      currentState: { path: 'cs.md', text: CURRENT_STATE },
      pins: [],
      privacy,
    };
    const tasks: string[] = [];
    const root = mkdtempSync(join(tmpdir(), 'osc-chatpack-'));
    try {
      const out = await buildChatPack({
        root,
        privacy,
        task: 'What ships?',
        model: 'qwen2.5:7b',
        kind: 'local',
        caps: { contextTokens: 4096, supportsGrammar: false },
        setting: 'auto',
        source: {
          prepare: async (task) => {
            tasks.push(task);
            return prepared;
          },
        },
      });
      expect(tasks).toEqual(['What ships?']);
      expect(out.text).toContain('zeppelin');
      expect(out.event?.seat).toBe('local');
      // A small served window gives a small budget, and the pack fits it.
      expect(out.event!.budgetTokens).toBeLessThan(1000);
      expect(out.event!.tokens).toBeLessThanOrEqual(out.event!.budgetTokens);
      const none = await buildChatPack({
        root,
        privacy,
        task: 'x',
        model: 'qwen2.5:7b',
        kind: 'local',
        caps: { contextTokens: 4096, supportsGrammar: false },
        setting: 'off',
        source: { prepare: async () => prepared },
      });
      expect(none).toEqual({});
      // Plain Current State: the line does not say local-only.
      expect(out.event?.localOnly).toBeUndefined();
      // A project pin from a local-only folder rides (this seat stays here),
      // and the line says so, so the phone marks the reply (I5).
      const pinned = await buildChatPack({
        root,
        privacy,
        task: 'What ships?',
        model: 'qwen2.5:7b',
        kind: 'local',
        caps: { contextTokens: 4096, supportsGrammar: false },
        setting: 'auto',
        source: {
          prepare: async () => ({
            ...prepared,
            projectPins: ['Private/Plan.md'],
            bodies: new Map([['Private/Plan.md', '# Plan\nThe launch word is marmot.']]),
          }),
        },
      });
      expect(pinned.text).toContain('marmot');
      expect(pinned.event?.localOnly).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
