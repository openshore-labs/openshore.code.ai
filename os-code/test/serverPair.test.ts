// Docking a phone to a server (connect-anywhere, 2026-10-07). A daemon run by
// `osc serve` has no desktop dialog, so a request waits for an admin's answer
// (the person's SSH terminal via `osc pair --server`) and is a no when nobody
// answers. Only an admin mints a claim or answers; a member cannot. /health
// says whether the daemon is a server or a desktop.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type DaemonOptions, type RunningDaemon } from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { mintCredential } from '../src/core/security/credentials.js';
import {
  ServerPairClient,
  isYes,
  serverPairingLink,
  tailnetAddress,
} from '../src/connect/serverPair.js';
import { _resetRoutineScheduler } from '../src/routines/scheduler.js';
import {
  portUnavailable,
  restoreHome,
  saveHome,
  setHome,
  type SavedHome,
} from './helpers/portable.js';

let home: string;
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

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  realHome = saveHome();
  setHome(home);
  _resetRoutineScheduler();
});

afterEach(() => {
  daemon?.close();
  daemon = undefined;
  _resetRoutineScheduler();
  restoreHome(realHome);
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

async function claimAsPhone(
  base: string,
  claim: string,
): Promise<{ request: string; secret: string; code: string }> {
  const res = await fetch(`${base}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claim, deviceName: 'Test phone' }),
  });
  expect(res.status).toBe(202);
  return (await res.json()) as { request: string; secret: string; code: string };
}

async function collect(
  base: string,
  pending: { request: string; secret: string },
): Promise<Response> {
  return fetch(`${base}/pair/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pending),
  });
}

describe('docking a phone to a server', () => {
  it('a request waits for the terminal, and only a yes there mints the credential', async () => {
    daemon = await start({ pairingConsole: true, kind: 'server' });
    const base = `http://127.0.0.1:${daemon.port}`;
    const shared = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
    const terminal = new ServerPairClient(base, shared);

    expect((await terminal.health()).kind).toBe('server');
    const { claim } = await terminal.mintClaim();
    const pending = await claimAsPhone(base, claim);

    // Nobody has answered: still waiting, never a credential.
    await new Promise((r) => setTimeout(r, 20));
    expect((await collect(base, pending)).status).toBe(202);

    const waiting = await terminal.pending();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.code).toBe(pending.code);
    expect(waiting[0]!.label).toBe('Test phone');
    // The phone's secret never shows up in the admin's list.
    expect(JSON.stringify(waiting)).not.toContain(pending.secret);

    expect((await terminal.answer(waiting[0]!.id, true)).state).toBe('approved');
    const got = await collect(base, pending);
    expect(got.status).toBe(200);
    const grant = (await got.json()) as { token: string };
    expect(
      (await fetch(`${base}/health`, { headers: { authorization: `Bearer ${grant.token}` } }))
        .status,
    ).toBe(200);

    // A second answer to the same request changes nothing.
    await expect(terminal.answer(waiting[0]!.id, true)).rejects.toThrow(/no longer waiting/);
  });

  it('a no at the terminal hands out nothing', async () => {
    daemon = await start({ pairingConsole: true, kind: 'server' });
    const base = `http://127.0.0.1:${daemon.port}`;
    const terminal = new ServerPairClient(
      base,
      readFileSync(join(home, 'daemon.token'), 'utf8').trim(),
    );
    const pending = await claimAsPhone(base, (await terminal.mintClaim()).claim);
    const [req] = await terminal.pending();
    expect((await terminal.answer(req!.id, false)).state).toBe('denied');
    expect((await collect(base, pending)).status).toBe(403);
  });

  it('a member credential can neither mint a claim nor answer a request', async () => {
    daemon = await start({ pairingConsole: true, kind: 'server' });
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token } = mintCredential({ role: 'member', label: 'Teammate' });
    const member = new ServerPairClient(base, token);
    await expect(member.mintClaim()).rejects.toThrow(/admin/);
    await expect(member.pending()).rejects.toThrow(/admin/);
  });

  it('a daemon with neither a dialog nor the console still refuses at once (F3)', async () => {
    daemon = await start({});
    const base = `http://127.0.0.1:${daemon.port}`;
    const pending = await claimAsPhone(base, daemon.mintPairClaim().claim);
    await new Promise((r) => setTimeout(r, 20));
    expect((await collect(base, pending)).status).toBe(403);
  });

  it('osc serve runs as a server with the console on; the desktop says desktop', () => {
    const serve = readFileSync(join(__dirname, '..', 'src', 'commands', 'serve.ts'), 'utf8');
    expect(serve).toContain("pairingConsole: true, kind: 'server'");
    const host = readFileSync(
      join(__dirname, '..', '..', 'app', 'electron', 'engineHost.ts'),
      'utf8',
    );
    expect(host).toContain("kind: 'desktop'");
    expect(host).not.toContain('pairingConsole');
  });
});

describe('the server pairing helpers', () => {
  it('builds the same link shape the desktop QR uses, on the tailnet address', () => {
    expect(tailnetAddress(undefined, 4816)).toBeUndefined();
    const address = tailnetAddress('100.64.1.2', 4816)!;
    expect(address).toBe('http://100.64.1.2:4816');
    expect(serverPairingLink(address, 'pc_abc')).toBe(
      'oscode://pair?u=http%3A%2F%2F100.64.1.2%3A4816&c=pc_abc',
    );
  });

  it('only a plain yes allows', () => {
    for (const y of ['y', 'Y', 'yes', ' YES ']) expect(isYes(y)).toBe(true);
    for (const n of ['', 'n', 'no', 'yep', 'y y', 'sure']) expect(isYes(n)).toBe(false);
  });
});
