// The stored session's refresh (APP-1, APP-2): one refresh in flight at a
// time, a dead refresh token clears the session and says so in a typed error
// the store catches in one place, and a network failure leaves the session
// alone so an offline launch stays signed in.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.mock('../src/lib/platform.js', () => ({
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
}));

vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.test');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');

const { AuthExpiredError, freshSession, loadStoredSession, saveSession } =
  await import('../src/lib/authSession.js');
type Session = import('../src/lib/supabase.js').Session;

const expired: Session = {
  accessToken: 'old',
  refreshToken: 'rt-1',
  expiresAt: Date.now() - 1,
  user: { id: 'u1', email: 'a@b.c' },
};

function fetchAnswering(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(async () => {
  mem.clear();
  await saveSession(expired);
});

describe('freshSession', () => {
  it('a live session passes through without a network call', async () => {
    const fn = fetchAnswering(200, {});
    const live = { ...expired, expiresAt: Date.now() + 3_600_000 };
    expect(await freshSession(live)).toBe(live);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a dead refresh token clears the stored session and throws AuthExpiredError', async () => {
    fetchAnswering(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
    await expect(freshSession(expired)).rejects.toBeInstanceOf(AuthExpiredError);
    expect(await loadStoredSession()).toBeUndefined();
  });

  it('a 401 on the refresh counts as dead too', async () => {
    fetchAnswering(401, { msg: 'JWT expired' });
    await expect(freshSession(expired)).rejects.toBeInstanceOf(AuthExpiredError);
    expect(await loadStoredSession()).toBeUndefined();
  });

  it('a network failure keeps the stored session and rethrows a plain error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(freshSession(expired)).rejects.toThrow('fetch failed');
    await expect(freshSession(expired)).rejects.not.toBeInstanceOf(AuthExpiredError);
    expect(await loadStoredSession()).toMatchObject({ refreshToken: 'rt-1' });
  });

  it('concurrent refreshes of the same session share one flight', async () => {
    const fn = fetchAnswering(200, {
      access_token: 'new',
      refresh_token: 'rt-2',
      expires_in: 3600,
      user: { id: 'u1', email: 'a@b.c' },
    });
    const [a, b] = await Promise.all([freshSession(expired), freshSession(expired)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a.accessToken).toBe('new');
    expect(b).toBe(a);
    expect(await loadStoredSession()).toMatchObject({ accessToken: 'new', refreshToken: 'rt-2' });
  });
});
