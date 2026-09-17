// Per-device pairing (engine half). The desktop's QR no longer carries a
// credential at all: it carries a one-time, short-lived CLAIM code, and the
// phone trades it at POST /pair/claim (no bearer yet) for its own per-device
// credential, labeled by the phone. So a lost phone is revoked on its own, the
// clear token never sits on the desktop's disk, and a scanned QR cannot be
// replayed by a second device. These start a real loopback daemon and drive it
// over HTTP, the way the phone would.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { PAIR_CLAIM_TTL_MS, PairClaimStore } from '../src/daemon/pairClaims.js';
import { defaultConfig } from '../src/config/load.js';
import { loadCredentials, mintCredential } from '../src/core/security/credentials.js';

let home: string;
let daemon: RunningDaemon;
let base: string;

async function startOnFreePort(): Promise<RunningDaemon> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 20000);
    try {
      return await startDaemon({ config: defaultConfig(), bind: 'loopback', port });
    } catch (err) {
      if (String(err).includes('EADDRINUSE')) continue;
      throw err;
    }
  }
  throw new Error('could not find a free port for the test daemon');
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
  );
  daemon = await startOnFreePort();
  base = `http://127.0.0.1:${daemon.port}`;
});

afterEach(() => {
  daemon.close();
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

async function claim(body: unknown): Promise<Response> {
  return fetch(`${base}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PairClaimStore (pure)', () => {
  it('a claim is live until redeemed, then used; a second redeem is refused', () => {
    const store = new PairClaimStore();
    const { claim: code, expiresAt } = store.mint();
    expect(code.startsWith('pc_')).toBe(true);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(PAIR_CLAIM_TTL_MS - 2000);
    expect(store.status(code)).toBe('live');
    expect(store.redeem(code)).toEqual({ ok: true });
    expect(store.status(code)).toBe('used');
    expect(store.redeem(code)).toEqual({ ok: false, reason: 'used' });
  });

  it('a claim expires after about five minutes and cannot be redeemed after', () => {
    let now = 1_000_000;
    const store = new PairClaimStore(() => now);
    const { claim: code } = store.mint();
    now += PAIR_CLAIM_TTL_MS - 1;
    expect(store.status(code)).toBe('live');
    now += 2;
    expect(store.status(code)).toBe('expired');
    expect(store.redeem(code)).toEqual({ ok: false, reason: 'expired' });
  });

  it('an unknown code is unknown, never a near-miss', () => {
    const store = new PairClaimStore();
    const { claim: code } = store.mint();
    expect(store.status(`${code}x`)).toBe('unknown');
    expect(store.redeem(code.slice(0, -1))).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('POST /pair/claim (per-device pairing)', () => {
  it('trades a live claim for a per-device admin credential labeled by the phone', async () => {
    const { claim: code } = daemon.mintPairClaim();
    const res = await claim({ claim: code, deviceName: "Jordan's iPhone" });
    expect(res.status).toBe(200);
    // The phone's WebView must be able to read the answer.
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { token: string; label: string; role: string };
    expect(body.token.startsWith('osc_')).toBe(true);
    expect(body.label).toBe("Jordan's iPhone");
    expect(body.role).toBe('admin');
    // The minted credential authenticates normally from here on.
    const health = await fetch(`${base}/health`, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(health.status).toBe(200);
    expect(((await health.json()) as { role: string }).role).toBe('admin');
    // Exactly one credential in the store, carrying the phone's label; nothing
    // in the clear on disk.
    const creds = loadCredentials();
    expect(creds).toHaveLength(1);
    expect(creds[0]!.label).toBe("Jordan's iPhone");
    expect(existsSync(join(home, 'pairing-device.token'))).toBe(false);
  });

  it('a claim is single-use: the second phone to present it is refused', async () => {
    const { claim: code } = daemon.mintPairClaim();
    expect((await claim({ claim: code, deviceName: 'Phone A' })).status).toBe(200);
    const again = await claim({ claim: code, deviceName: 'Phone B' });
    expect(again.status).toBe(410);
    expect(((await again.json()) as { error: string }).error).toMatch(/already been used/i);
    expect(loadCredentials()).toHaveLength(1);
    expect(daemon.pairClaimStatus(code)).toBe('used');
  });

  it('a wrong or missing claim is refused and mints nothing', async () => {
    expect((await claim({ claim: 'pc_nope', deviceName: 'Phone' })).status).toBe(401);
    expect((await claim({ deviceName: 'Phone' })).status).toBe(400);
    expect(loadCredentials()).toHaveLength(0);
  });

  it('a claim is labeled honestly: the name is trimmed, bounded, and never empty', async () => {
    const { claim: code } = daemon.mintPairClaim();
    const res = await claim({ claim: code, deviceName: `  ${'x'.repeat(80)}  ` });
    expect(res.status).toBe(200);
    const { label } = (await res.json()) as { label: string };
    expect(label).toBe('x'.repeat(40));
    const { claim: second } = daemon.mintPairClaim();
    const res2 = await claim({ claim: second, deviceName: '   ' });
    expect(((await res2.json()) as { label: string }).label).toBe('Phone');
  });

  it('an already-minted per-device bearer keeps working with no claim at all', async () => {
    const { token } = mintCredential({ role: 'member', label: 'Older phone', userId: 'u1' });
    const res = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { role: string }).role).toBe('member');
  });

  it('the 401 for a missing bearer points at the desktop pair room and the doctor', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(401);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('Desktop + phone');
    expect(error).toContain('npx osc doctor');
  });

  it('a claim string presented as a bearer names the real cause: an out-of-date app', async () => {
    const { claim: code } = daemon.mintPairClaim();
    // Never redeemed at /pair/claim: a build old enough to predate per-device
    // pairing would hand this straight to the bearer header instead.
    const res = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${code}` } });
    expect(res.status).toBe(401);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('too old to trade it in');
    expect(error).toContain('Update OpenShore');
  });
});
