// Google Drive quota parsing for the capacity meter. Drive reports free of
// total (unlike iCloud), so this is the honest availability number the meter
// shows. The load-bearing cases: a capped account computes free = limit minus
// usage, an uncapped account reports unlimited rather than inventing a total,
// and any failure returns undefined so the meter shows nothing over a guess.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/gitos/gdriveAuth.js', () => ({
  gdriveAccessToken: async () => 'test-token',
}));

import { gdriveStorageQuota } from '../src/lib/gitos/gdrive.js';

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    (async () =>
      ({
        ok,
        status: ok ? 200 : 500,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as unknown as Response) as unknown as typeof fetch,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gdriveStorageQuota', () => {
  it('computes free of total for a capped account', async () => {
    stubFetch({ storageQuota: { limit: '100', usage: '30' } });
    const q = await gdriveStorageQuota();
    expect(q).toEqual({ freeBytes: 70, totalBytes: 100, usedBytes: 30, unlimited: false });
  });

  it('reports unlimited when the account has no limit', async () => {
    stubFetch({ storageQuota: { usage: '42' } });
    const q = await gdriveStorageQuota();
    expect(q).toEqual({ freeBytes: 0, totalBytes: 0, usedBytes: 42, unlimited: true });
  });

  it('never returns negative free space when usage exceeds the limit', async () => {
    stubFetch({ storageQuota: { limit: '10', usage: '15' } });
    const q = await gdriveStorageQuota();
    expect(q?.freeBytes).toBe(0);
  });

  it('returns undefined when the response has no storageQuota', async () => {
    stubFetch({});
    expect(await gdriveStorageQuota()).toBeUndefined();
  });

  it('returns undefined on a failed request rather than a guess', async () => {
    stubFetch({ error: 'nope' }, false);
    expect(await gdriveStorageQuota()).toBeUndefined();
  });
});
