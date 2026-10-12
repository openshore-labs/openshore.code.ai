// A docked machine says how big it is (many machines, one person,
// 2026-10-12): its memory, cores and processor family ride /health, so a
// device docked to a 4 GB shared server and a 32 GB computer at home can tell
// them apart when a project picks where it runs. Facts only, read from the
// process: nothing about a graphics card, which a server's sandboxed engine
// cannot see.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type DaemonOptions, type RunningDaemon } from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { machineFacts } from '../src/daemon/machineFacts.js';
import { hostRamGB } from '../src/providers/hostMemory.js';
import { setLogDir } from '../src/util/log.js';
import { _resetRoutineScheduler } from '../src/routines/scheduler.js';
import {
  portUnavailable,
  restoreHome,
  saveHome,
  setHome,
  type SavedHome,
} from './helpers/portable.js';

let home: string;
let logs: string;
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

async function health(d: RunningDaemon): Promise<Record<string, unknown>> {
  const token = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
  const res = await fetch(`http://127.0.0.1:${d.port}/health`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-machine-'));
  logs = mkdtempSync(join(tmpdir(), 'osc-machine-logs-'));
  process.env.OSC_HOME = home;
  realHome = saveHome();
  setHome(home);
  mkdirSync(join(home, 'Vault'), { recursive: true });
  setLogDir(logs);
  _resetRoutineScheduler();
});

afterEach(() => {
  daemon?.close();
  daemon = undefined;
  _resetRoutineScheduler();
  restoreHome(realHome);
  delete process.env.OSC_HOME;
  for (const dir of [home, logs]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EBUSY') throw e;
    }
  }
});

describe('machine facts', () => {
  it('reads memory the way the served window does, cores, and the processor family', () => {
    const facts = machineFacts();
    expect(facts.ramGB).toBe(hostRamGB());
    expect(facts.cpus).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(facts.cpus)).toBe(true);
    expect(facts.arch).toBe(process.arch);
    expect(Object.keys(facts).sort()).toEqual(['arch', 'cpus', 'ramGB']);
  });

  it('rides /health on a server and on the desktop, beside what it is', async () => {
    daemon = await start({ pairingConsole: true, kind: 'server' });
    const server = await health(daemon);
    expect(server.kind).toBe('server');
    expect(server.machine).toEqual(machineFacts());
    daemon.close();
    daemon = await start({ kind: 'desktop' });
    expect((await health(daemon)).machine).toEqual(machineFacts());
  });
});
