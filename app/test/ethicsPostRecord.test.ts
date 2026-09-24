// What the ethics layer sends to the account (DECISIONS.md 2026-09-24,
// "Guardrail data has retention limits and a keyed hash"): blocks only, never
// an allowed-with-assertion record, and never a subject name. The device keeps
// its own copy of every record either way.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EthicsRecord } from 'os-code/protocol';

const { insert, rpc } = vi.hoisted(() => ({ insert: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/lib/supabase.js', () => ({
  insert: (...args: unknown[]) => insert(...args),
  rpc: (...args: unknown[]) => rpc(...args),
  isConfigured: () => true,
}));
vi.mock('../src/lib/authSession.js', () => ({
  loadStoredSession: async () => ({
    accessToken: 'tok',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
    user: { id: 'u1' },
  }),
  freshSession: async (s: unknown) => s,
}));

import { knownRecords, recordEthicsEvent, serverRowFor } from '../src/lib/ethics.js';

const HASH = 'a'.repeat(64);

function record(over: Partial<EthicsRecord>): EthicsRecord {
  return {
    category: 'likeness',
    tier: 2,
    timestamp: '2026-09-24T00:00:00.000Z',
    requestHash: HASH,
    modelPath: 'local',
    action: 'blocked',
    side: 'input',
    signals: ['named-person'],
    ...over,
  };
}

beforeEach(() => {
  insert.mockReset();
  rpc.mockReset();
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
});

describe('serverRowFor', () => {
  it('keeps an allowed-with-assertion record on the device', () => {
    expect(
      serverRowFor(record({ action: 'allowed-with-assertion', subject: 'jordan ellis' })),
    ).toBeUndefined();
  });

  it('sends a block without any subject, even when the record carries one', () => {
    const row = serverRowFor(record({ subject: 'jordan ellis' }));
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('subject');
    expect(JSON.stringify(row)).not.toContain('jordan');
    expect(row).toEqual({
      category: 'likeness',
      tier: 2,
      occurred_at: '2026-09-24T00:00:00.000Z',
      request_hash: HASH,
      model_path: 'local',
      action: 'blocked',
      side: 'input',
      signals: ['named-person'],
    });
  });
});

describe('recordEthicsEvent', () => {
  it('never posts an allowed-with-assertion record, but still keeps it on the device', async () => {
    await recordEthicsEvent(record({ action: 'allowed-with-assertion', subject: 'jordan ellis' }));
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(knownRecords().at(-1)?.action).toBe('allowed-with-assertion');
  });

  it('posts a block with no subject and asks the server to run the ladder', async () => {
    await recordEthicsEvent(
      record({ category: 'csam', tier: 1, subject: 'someone', signals: ['minor'] }),
    );
    expect(insert).toHaveBeenCalledTimes(1);
    const [table, token, row] = insert.mock.calls[0]!;
    expect(table).toBe('guardrail_events');
    expect(token).toBe('tok');
    expect(row).not.toHaveProperty('subject');
    expect(row).toMatchObject({ action: 'blocked', category: 'csam' });
    expect(rpc).toHaveBeenCalledWith('record_enforcement', 'tok', {});
  });

  it('posts a check-failed block but never drives enforcement with it', async () => {
    await recordEthicsEvent(record({ category: 'check-failed', tier: 1 }));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });
});
