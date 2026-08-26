// TS-P2-4: the desktop mints a per-device credential for the QR instead of
// handing out the shared admin token, so a lost phone can be revoked on its
// own. This pins the mint-once behavior (the Pair screen polls daemonInfo every
// few seconds, so a poll must reuse the credential, never spawn a new one) and
// the revoke-then-remint flow.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePairingCredential, listPairedDevices } from '../electron/engineHost.js';
import {
  loadCredentials,
  resolveDeviceCredential,
  revokeCredential,
} from 'os-code/dist/src/core/security/credentials.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
});
afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('pairing credential (TS-P2-4)', () => {
  it('mints an admin credential the phone token resolves to', () => {
    const { token } = ensurePairingCredential();
    const ctx = resolveDeviceCredential(token);
    expect(ctx?.role).toBe('admin');
    expect(ctx?.label).toBe('iPhone via QR');
    expect(ctx?.source).toBe('device');
    // The QR token is a minted credential, not the shared daemon.token.
    expect(existsSync(join(home, 'daemon.token'))).toBe(false);
  });

  it('mints ONCE and reuses across polls (no credential spam)', () => {
    const first = ensurePairingCredential();
    const second = ensurePairingCredential();
    const third = ensurePairingCredential();
    expect(second.token).toBe(first.token);
    expect(third.token).toBe(first.token);
    // One credential in the store, not one per call.
    expect(loadCredentials()).toHaveLength(1);
  });

  it('lists paired devices with an id, label, and createdAt', () => {
    ensurePairingCredential();
    const devices = listPairedDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.label).toBe('iPhone via QR');
    expect(devices[0]!.id).toHaveLength(64); // the token hash, the revoke handle
    expect(Date.parse(devices[0]!.createdAt)).not.toBeNaN();
  });

  it('revoking a device cuts off only that credential; the next call re-mints', () => {
    const first = ensurePairingCredential();
    const { id } = listPairedDevices()[0]!;
    expect(revokeCredential(id)).toBe(1);
    // The revoked token no longer resolves.
    expect(resolveDeviceCredential(first.token)).toBeUndefined();
    // A fresh poll finds no live credential and mints a new one (rotating the QR).
    const next = ensurePairingCredential();
    expect(next.token).not.toBe(first.token);
    expect(resolveDeviceCredential(next.token)?.role).toBe('admin');
    expect(loadCredentials()).toHaveLength(1);
  });
});
