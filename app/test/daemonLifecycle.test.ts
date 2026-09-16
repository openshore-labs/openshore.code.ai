// The daemon's life inside the desktop shell (A2), against the engine host
// with an injected daemon factory and tailnet probe, since the sandbox has no
// Tailscale and no display: bind the tailnet when it is up, else loopback;
// re-bind from loopback to the tailnet when Tailscale appears (the old start
// short-circuited on "already running" and never moved); a paused hub stays
// paused; and the active-run count that drives the power-save blocker.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineHost } from '../electron/engineHost.js';
import { PairClaimStore } from 'os-code/dist/src/daemon/pairClaims.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
});
afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

interface Started {
  bind: string;
  closed: boolean;
}

function harness(opts: { tailscaleFails?: boolean } = {}) {
  const started: Started[] = [];
  const tailscale = { running: false, ip: undefined as string | undefined };
  const startDaemon = async (o: { bind: 'loopback' | 'tailscale'; port: number }) => {
    if (o.bind === 'tailscale' && (!tailscale.ip || opts.tailscaleFails)) {
      throw new Error('No Tailscale interface found.');
    }
    const entry: Started = { bind: o.bind, closed: false };
    started.push(entry);
    const claims = new PairClaimStore();
    return {
      host: o.bind === 'tailscale' ? tailscale.ip! : '127.0.0.1',
      port: o.port,
      close() {
        entry.closed = true;
      },
      mintPairClaim: () => claims.mint(),
      pairClaimStatus: (c: string) => claims.status(c),
    };
  };
  const host = new EngineHost(
    () => {},
    () => {},
    () => {},
    { startDaemon: startDaemon as never, tailscale: () => ({ ...tailscale }) },
  );
  return { host, started, tailscale };
}

describe('daemon lifecycle in the shell', () => {
  it('binds loopback when Tailscale is down, and reports the mode honestly', async () => {
    const { host, started } = harness();
    const info = await host.daemonStart();
    expect('error' in info).toBe(false);
    expect(started.map((s) => s.bind)).toEqual(['loopback']);
    expect(host.daemonInfo().mode).toBe('loopback');
    expect(host.daemonInfo().tailscaleUp).toBe(false);
    host.disposeAll();
  });

  it('binds the tailnet when Tailscale is up', async () => {
    const { host, started, tailscale } = harness();
    tailscale.running = true;
    tailscale.ip = '100.64.0.9';
    await host.daemonStart();
    expect(started.map((s) => s.bind)).toEqual(['tailscale']);
    expect(host.daemonInfo().mode).toBe('tailscale');
    expect(host.daemonInfo().host).toBe('100.64.0.9');
    host.disposeAll();
  });

  it('re-binds a loopback daemon onto the tailnet once Tailscale comes up', async () => {
    const { host, started, tailscale } = harness();
    await host.daemonStart();
    expect(host.daemonInfo().mode).toBe('loopback');
    // Nothing to do while the tailnet is still down.
    expect(await host.daemonRebind()).toBe(false);
    tailscale.running = true;
    tailscale.ip = '100.64.0.9';
    expect(await host.daemonRebind()).toBe(true);
    expect(started.map((s) => s.bind)).toEqual(['loopback', 'tailscale']);
    expect(started[0]!.closed).toBe(true);
    expect(host.daemonInfo().mode).toBe('tailscale');
    // Settled: a second poll is a no-op.
    expect(await host.daemonRebind()).toBe(false);
    host.disposeAll();
  });

  it('a second daemonStart while on loopback also moves to the tailnet (no short-circuit)', async () => {
    const { host, started, tailscale } = harness();
    await host.daemonStart();
    tailscale.running = true;
    tailscale.ip = '100.64.0.9';
    await host.daemonStart();
    expect(started.map((s) => s.bind)).toEqual(['loopback', 'tailscale']);
    host.disposeAll();
  });

  it('a failed re-bind falls back to a fresh loopback daemon, never to nothing', async () => {
    const { host, started, tailscale } = harness({ tailscaleFails: true });
    await host.daemonStart();
    tailscale.running = true;
    tailscale.ip = '100.64.0.9';
    expect(await host.daemonRebind()).toBe(false);
    expect(host.daemonInfo().running).toBe(true);
    expect(host.daemonInfo().mode).toBe('loopback');
    expect(started.map((s) => s.bind)).toEqual(['loopback', 'loopback']);
    host.disposeAll();
  });

  it('a stopped hub stays stopped: no re-bind, no claim', async () => {
    const { host, started, tailscale } = harness();
    await host.daemonStart();
    await host.daemonStop();
    tailscale.running = true;
    tailscale.ip = '100.64.0.9';
    expect(await host.daemonRebind()).toBe(false);
    expect(started).toHaveLength(1);
    expect(host.daemonInfo().running).toBe(false);
    expect(host.daemonInfo().claim).toBeUndefined();
    host.disposeAll();
  });

  it('counts no active runs on an idle host', () => {
    const { host } = harness();
    expect(host.activeRuns()).toBe(0);
    host.disposeAll();
  });
});

describe('hardware over the bridge', () => {
  it('answers structured numbers, not prose', () => {
    const { host } = harness();
    const hw = host.hardware();
    expect(typeof hw.ramGB).toBe('number');
    expect(hw.ramGB).toBeGreaterThan(0);
    expect(typeof hw.gpu).toBe('boolean');
    expect(hw.platform).toBe(process.platform);
    expect(typeof hw.maxModelGB).toBe('number');
    expect(typeof hw.summary).toBe('string');
    host.disposeAll();
  });
});
