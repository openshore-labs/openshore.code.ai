// Per-device pairing (desktop half). The QR used to carry one shared admin
// token, cached in the clear at ~/.os-code/pairing-device.token and reused for
// every scan, so "revoke just that phone" was not true. Now the QR carries a
// one-time CLAIM the daemon mints; the phone trades it for its own credential
// at POST /pair/claim. This pins the desktop side: no clear token on disk, the
// claim is held steady across polls and rotated only once it is spent or
// expired, the shared credential is retired on first start, and revoke cuts
// exactly one device.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EngineHost,
  listPairedDevices,
  retireSharedPairingCredential,
} from '../electron/engineHost.js';
import {
  loadCredentials,
  mintCredential,
  resolveDeviceCredential,
  revokeCredential,
} from 'os-code/dist/src/core/security/credentials.js';
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

/** A daemon stand-in with a real claim store, so the host's claim handling is
 *  exercised without a socket or a tailnet. */
function fakeDaemonFactory(started: Array<{ bind: string }>) {
  return async (opts: { bind: 'loopback' | 'tailscale'; port: number }) => {
    started.push({ bind: opts.bind });
    const claims = new PairClaimStore();
    return {
      host: opts.bind === 'tailscale' ? '100.64.0.9' : '127.0.0.1',
      port: opts.port,
      close() {},
      mintPairClaim: () => claims.mint(),
      pairClaimStatus: (c: string) => claims.status(c),
      redeem: (c: string) => claims.redeem(c),
    };
  };
}

function hostWith(started: Array<{ bind: string }>, tailscale = { running: false, ip: undefined }) {
  return new EngineHost(
    () => {},
    () => {},
    () => {},
    { startDaemon: fakeDaemonFactory(started) as never, tailscale: () => tailscale },
  );
}

describe('pairing claim (desktop side)', () => {
  it('daemonInfo carries a claim, never a credential, and writes no token file', async () => {
    const host = hostWith([]);
    await host.daemonStart();
    const info = host.daemonInfo();
    expect(info.running).toBe(true);
    expect(info.claim?.startsWith('pc_')).toBe(true);
    expect(Date.parse(info.claimExpiresAt ?? '')).toBeGreaterThan(Date.now());
    expect('token' in info).toBe(false);
    expect(existsSync(join(home, 'pairing-device.token'))).toBe(false);
    // A claim mints no credential by itself.
    expect(loadCredentials()).toHaveLength(0);
    host.disposeAll();
  });

  it('holds the same claim across polls, so the QR does not flicker', async () => {
    const host = hostWith([]);
    await host.daemonStart();
    const a = host.daemonInfo().claim;
    const b = host.daemonInfo().claim;
    const c = host.daemonInfo().claim;
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(c).toBe(a);
    host.disposeAll();
  });

  it('rotates the claim once it has been spent', async () => {
    const host = hostWith([]);
    await host.daemonStart();
    const first = host.daemonInfo().claim!;
    // The phone redeems it (the daemon marks it used).
    const daemon = (host as unknown as { daemon: { redeem(c: string): unknown } }).daemon;
    daemon.redeem(first);
    const next = host.daemonInfo().claim;
    expect(next).toBeTruthy();
    expect(next).not.toBe(first);
    host.disposeAll();
  });

  it('offers no claim while the hub is off, but still lists paired devices', () => {
    mintCredential({ role: 'admin', label: "Jordan's iPhone" });
    const host = hostWith([]);
    const info = host.daemonInfo();
    expect(info.running).toBe(false);
    expect(info.claim).toBeUndefined();
    expect(info.devices?.map((d) => d.label)).toEqual(["Jordan's iPhone"]);
    host.disposeAll();
  });
});

describe('retiring the shared QR credential', () => {
  it('deletes the clear-text token file and revokes the shared credential', () => {
    const { token } = mintCredential({ role: 'admin', label: 'iPhone via QR' });
    writeFileSync(join(home, 'pairing-device.token'), `${token}\n`);
    mintCredential({ role: 'admin', label: "Jordan's iPhone" });
    const result = retireSharedPairingCredential();
    expect(result).toEqual({ fileRemoved: true, revoked: 1 });
    expect(existsSync(join(home, 'pairing-device.token'))).toBe(false);
    expect(resolveDeviceCredential(token)).toBeUndefined();
    // A per-device credential minted the new way is untouched.
    expect(loadCredentials().map((c) => c.label)).toEqual(["Jordan's iPhone"]);
    // Idempotent.
    expect(retireSharedPairingCredential()).toEqual({ fileRemoved: false, revoked: 0 });
  });

  it('runs on daemon start', async () => {
    const { token } = mintCredential({ role: 'admin', label: 'iPhone via QR' });
    writeFileSync(join(home, 'pairing-device.token'), `${token}\n`);
    const host = hostWith([]);
    await host.daemonStart();
    expect(readdirSync(home)).not.toContain('pairing-device.token');
    expect(resolveDeviceCredential(token)).toBeUndefined();
    host.disposeAll();
  });
});

describe('paired devices', () => {
  it('lists each device with an id, label, and createdAt', () => {
    mintCredential({ role: 'admin', label: "Jordan's iPhone" });
    mintCredential({ role: 'admin', label: 'iPad' });
    const devices = listPairedDevices();
    expect(devices.map((d) => d.label)).toEqual(["Jordan's iPhone", 'iPad']);
    expect(devices[0]!.id).toHaveLength(64); // the token hash, the revoke handle
    expect(Date.parse(devices[0]!.createdAt)).not.toBeNaN();
  });

  it('revoking one device cuts off only that credential', () => {
    const phone = mintCredential({ role: 'admin', label: "Jordan's iPhone" });
    const tablet = mintCredential({ role: 'admin', label: 'iPad' });
    const { id } = listPairedDevices().find((d) => d.label === "Jordan's iPhone")!;
    expect(revokeCredential(id)).toBe(1);
    expect(resolveDeviceCredential(phone.token)).toBeUndefined();
    expect(resolveDeviceCredential(tablet.token)?.label).toBe('iPad');
    expect(listPairedDevices().map((d) => d.label)).toEqual(['iPad']);
  });
});
