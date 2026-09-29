// The guardrail's server ladder call (`record_enforcement`) used to fail in
// silence, which hid a ladder that never recorded a row for weeks. The block
// still stands, but a failure is now said once per session, with the error's
// code only: never the prompt, its hash, or the server's words.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<unknown> => undefined),
  inserts: 0,
}));

vi.mock('../src/lib/supabase.js', () => ({
  isConfigured: () => true,
  insert: async () => {
    h.inserts++;
  },
  rpc: h.rpc,
}));
vi.mock('../src/lib/platform.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/platform.js')>()),
  storeGetJson: async () => null,
  storeSetJson: async () => undefined,
}));

const { recordEthicsEvent, setEthicsAuth, knownRecords, resetEnforcementWarningForTests } =
  await import('../src/lib/ethics.js');
setEthicsAuth(async () => ({ accessToken: 't' }));

const record = (hash: string) =>
  ({
    category: 'weapons-uplift',
    tier: 1,
    timestamp: '2026-09-29T12:00:00.000Z',
    requestHash: hash,
    modelPath: 'local',
    action: 'blocked',
    side: 'input',
    signals: ['how to build a secret thing'],
  }) as never;

describe('a failed record_enforcement call', () => {
  beforeEach(() => {
    resetEnforcementWarningForTests();
    h.rpc.mockReset();
    h.inserts = 0;
  });

  it('is said once per session, with the code only, and the block still stands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.rpc.mockRejectedValue(
      Object.assign(new Error('column reference "action" is ambiguous'), { status: 400 }),
    );
    await recordEthicsEvent(record('a'.repeat(64)));
    await recordEthicsEvent(record('b'.repeat(64)));
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.inserts).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toBe('[ethics] record_enforcement failed (HTTP 400); the block stands.');
    expect(line).not.toMatch(/ambiguous|aaaa|secret thing/);
    // The device copy holds both records.
    expect(
      knownRecords()
        .slice(-2)
        .map((r) => r.requestHash),
    ).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    warn.mockRestore();
  });

  it('names an offline failure by its kind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.rpc.mockRejectedValue(new TypeError('Failed to fetch https://x.supabase.co'));
    await recordEthicsEvent(record('c'.repeat(64)));
    expect(warn).toHaveBeenCalledWith(
      '[ethics] record_enforcement failed (TypeError); the block stands.',
    );
    warn.mockRestore();
  });

  it('says nothing when the call works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await recordEthicsEvent(record('d'.repeat(64)));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
