// The stored session's refresh (APP-1, APP-2): one refresh in flight at a
// time, a dead refresh token clears the session and says so in a typed error
// the store catches in one place, and a network failure leaves the session
// alone so an offline launch stays signed in. A refresh token is spent once,
// so a caller holding an older copy is handed the newer session, never a
// second refresh (the refresh race, build 2026-09-29 E2), and a refresh that
// was out at a sign-out never signs the device back in.
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

const { AuthExpiredError, clearSession, freshSession, loadStoredSession, saveSession } =
  await import('../src/lib/authSession.js');
const { signOut } = await import('../src/lib/supabase.js');
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

const answer = (refreshToken: string, accessToken = 'new') => ({
  access_token: accessToken,
  refresh_token: refreshToken,
  expires_in: 3600,
  user: { id: 'u1', email: 'a@b.c' },
});

beforeEach(async () => {
  // A clear first, as a sign-out makes one: the module forgets the last token
  // it spent, since each test here starts from the same fixture.
  await clearSession();
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

describe('freshSession and a spent refresh token', () => {
  it('takes a newer session of the same person from the store, with no refresh', async () => {
    const fn = fetchAnswering(200, answer('rt-3'));
    const newer = { ...expired, accessToken: 'newer', refreshToken: 'rt-2' };
    newer.expiresAt = Date.now() + 3_600_000;
    await saveSession(newer);
    expect(await freshSession(expired)).toEqual(newer);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refreshes the newer stored token when that one is due too, never the spent one', async () => {
    const fn = fetchAnswering(200, answer('rt-3'));
    await saveSession({ ...expired, refreshToken: 'rt-2' });
    const next = await freshSession(expired);
    expect(fn).toHaveBeenCalledTimes(1);
    const init = (fn.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body)).refresh_token).toBe('rt-2');
    expect(next.refreshToken).toBe('rt-3');
    expect(await loadStoredSession()).toMatchObject({ refreshToken: 'rt-3' });
  });

  it('hands a caller still holding a spent token the session that replaced it', async () => {
    const fn = fetchAnswering(200, answer('rt-2'));
    const first = await freshSession(expired);
    // Nothing is stored to read (a store that has not caught up), and still
    // the spent token never goes out again.
    mem.clear();
    expect(await freshSession(expired)).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a refresh that was out when the device signed out never writes it back', async () => {
    let reply!: (r: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => (reply = resolve)),
    ) as unknown as typeof fetch;
    const pending = freshSession(expired);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await clearSession();
    reply(new Response(JSON.stringify(answer('rt-2')), { status: 200 }));
    await pending;
    expect(await loadStoredSession()).toBeUndefined();
    // Nor does a caller with the old copy get the new one after the sign-out.
    fetchAnswering(400, { error: 'invalid_grant' });
    await expect(freshSession(expired)).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('never writes over another person signed in here since', async () => {
    fetchAnswering(200, answer('rt-2'));
    const other = { ...expired, refreshToken: 'rt-x', user: { id: 'u2', email: 'x@y.z' } };
    await saveSession(other);
    await freshSession(expired);
    expect(await loadStoredSession()).toEqual(other);
  });
});

describe('logout', () => {
  function logoutAnswering(status: number) {
    const fn = vi.fn(async () =>
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify({ msg: 'down' }), { status }),
    );
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  it('always names its scope, since the server defaults to every device', async () => {
    const fn = logoutAnswering(204);
    await signOut('tok', 'local');
    await signOut('tok', 'global');
    const urls = fn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toEqual([
      'https://sb.test/auth/v1/logout?scope=local',
      'https://sb.test/auth/v1/logout?scope=global',
    ]);
  });

  it('throws when the server did not confirm, so nothing claims it did', async () => {
    logoutAnswering(503);
    await expect(signOut('tok', 'global')).rejects.toThrow('down');
  });
});
