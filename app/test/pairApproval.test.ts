// Pairing needs the computer's yes (tech review security review 2026-10-01, F3): a
// spent claim answers 202 with a short code, the phone shows it and asks
// until the computer allows or denies. Only an Allow gives it a token.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redeemPairClaim } from '../src/drivers/remoteDriver.js';

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the phone waits for the computer to allow it', () => {
  it('shows the code, keeps asking, and collects the token on Allow', async () => {
    const answers = [
      reply(202, { pending: true, request: 'pr_1', secret: 's', code: '0427' }),
      reply(202, { state: 'pending' }),
      reply(200, { state: 'approved', token: 'osc_tok', role: 'admin' }),
    ];
    const fetchMock = vi.fn(async () => answers.shift()!);
    vi.stubGlobal('fetch', fetchMock);
    const shown: string[] = [];
    const out = await redeemPairClaim('http://100.64.0.1:7878', 'pc_x', 'iPhone', {
      onPending: (c) => shown.push(c),
      pollMs: 1,
    });
    expect(shown).toEqual(['0427']);
    expect(out).toEqual({ ok: true, token: 'osc_tok', role: 'admin' });
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.slice(1).every((u) => u.endsWith('/pair/request'))).toBe(true);
  });

  it('says so plainly on Deny, with no token', async () => {
    const answers = [
      reply(202, { pending: true, request: 'pr_1', secret: 's', code: '1111' }),
      reply(403, { state: 'denied', error: 'Your computer did not allow this device.' }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answers.shift()!),
    );
    const out = await redeemPairClaim('http://100.64.0.1:7878', 'pc_x', 'iPhone', { pollMs: 1 });
    expect(out).toEqual({ ok: false, detail: 'Your computer did not allow this device.' });
  });

  it('gives up when nobody answers in time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(202, { pending: true, request: 'pr_1', secret: 's', code: '1' })),
    );
    const out = await redeemPairClaim('http://100.64.0.1:7878', 'pc_x', 'iPhone', {
      pollMs: 1,
      waitMs: 10,
    });
    expect(out.ok).toBe(false);
  });
});

describe('the computer asks in a native dialog', () => {
  it('wires the Allow dialog, Deny by default, into the daemon', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const host = readFileSync(join(process.cwd(), 'electron', 'engineHost.ts'), 'utf8');
    expect(main).toMatch(/host\.pairingApprover = async/);
    const dialog = main.slice(main.indexOf('host.pairingApprover'));
    expect(dialog).toMatch(/buttons: \['Allow', 'Deny'\]/);
    expect(dialog).toMatch(/defaultId: 1,\s*cancelId: 1/);
    expect(dialog).toMatch(/the code \$\{code\}/);
    expect(host.match(/approvePairing: this\.approvePairing/g)).toHaveLength(2);
  });
});
