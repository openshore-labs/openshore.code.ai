// Both delete-account functions, through the real client (CTO 11 package C,
// the interim app fix). Production runs the privacy branch's 2026-09-24
// function until main's merged one is deployed; a build from main must read
// either one's answers correctly, so a deletion that succeeded does not read
// as failed and does not leave the device signed in to a deleted account.
// That includes the answer an account already gone gets (a retry after a
// lost 200, or the second device): neither function can tell it from a dead
// sign-in, so the app asks the auth server, and the auth answers below are
// the ones the local stack's gotrue v2.197.0 sends. Only `user_not_found`
// says the account is gone and only `session_not_found` says the sign-in is
// dead; when the auth server cannot say (offline, a 5xx, `bad_jwt`, a 401 or
// 403 with no code), the flow says it could not confirm whether the account
// was deleted and leaves the device as it was, never "was not deleted"
// (os-code/PROGRESS.md, What remains, Accounts). The function bodies are the
// ones each function sends (supabase/functions/delete-account/index.ts, and
// d3d4bb7's).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.test');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');

const { authUserState, invokeFunctionWithCode, SupabaseRequestError } =
  await import('../src/lib/supabase.js');
const { deleteAccount } = await import('../src/state/accountDeletion.js');
type Answer = import('../src/state/accountDeletion.js').DeleteAccountAnswer;

/** GoTrue's GET /auth/v1/user answers (gotrue v2.197.0, the local stack). */
const AUTH = {
  here: { status: 200, body: { id: 'u1', email: 'a@b.c' } },
  gone: {
    status: 403,
    body: {
      code: 403,
      error_code: 'user_not_found',
      msg: 'User from sub claim in JWT does not exist',
    },
  },
  signedOutEverywhere: {
    status: 403,
    body: {
      code: 403,
      error_code: 'session_not_found',
      msg: 'Session from session_id claim in JWT does not exist',
    },
  },
  badJwt: {
    status: 403,
    body: {
      code: 403,
      error_code: 'bad_jwt',
      msg: 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired',
    },
  },
  /** A 401 or 403 with no GoTrue code: a gateway or proxy answered, not GoTrue. */
  noCode401: { status: 401, body: { message: 'Invalid authentication credentials' } },
  noCode403: { status: 403, body: { message: 'Forbidden' } },
  down: { status: 503, body: { message: 'upstream unavailable' } },
} as const;
type Auth = (typeof AUTH)[keyof typeof AUTH];

let asked: string[] = [];

function answer(status: number, body: unknown, auth: Auth = AUTH.here) {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      asked.push(path);
      if (path === '/auth/v1/user') {
        return new Response(JSON.stringify(auth.body), {
          status: auth.status,
          headers:
            'error_code' in auth.body ? { 'x-sb-error-code': auth.body.error_code } : undefined,
        });
      }
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

/** How the last run left the device: signed out plainly (a deletion),
 *  ended involuntarily (a dead sign-in), or neither. */
let last = { forgot: 0, ended: 0 };

async function run(status: number, body: unknown, auth?: Auth) {
  answer(status, body, auth);
  const seen = { forgot: 0, ended: 0 };
  last = seen;
  const outcome = await deleteAccount({
    session: async () => ({
      accessToken: 'tok',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3_600_000,
      user: { id: 'u1', email: 'a@b.c' },
    }),
    invoke: (token) => invokeFunctionWithCode<Answer>('delete-account', token, {}),
    authState: (token) => authUserState(token),
    forgetSession: async () => {
      seen.forgot += 1;
    },
    endSignIn: async () => {
      seen.ended += 1;
    },
    clearPendingAppleLink: async () => {},
  });
  return { outcome, signedOut: seen.forgot + seen.ended === 1 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('invokeFunctionWithCode', () => {
  it('reads code before error, and only a snake_case word as a code', async () => {
    const codeOf = async (body: unknown) => {
      answer(401, body);
      try {
        await invokeFunctionWithCode('delete-account', 'tok', {});
      } catch (err) {
        return err instanceof SupabaseRequestError ? (err.code ?? null) : 'not a request error';
      }
      return 'no throw';
    };
    expect(
      await codeOf({
        error: 'For your safety, sign in again, then delete your account.',
        code: 'reauth_required',
      }),
    ).toBe('reauth_required');
    expect(await codeOf({ error: 'owns_org' })).toBe('owns_org');
    expect(await codeOf({ error: 'Could not delete the account. Try again.' })).toBeNull();
    expect(await codeOf({ code: 'Not A Code', error: 'failed' })).toBe('failed');
    expect(await codeOf(null)).toBeNull();
  });
});

describe('the live 2026-09-24 function', () => {
  it('200 { deleted: true } is a deletion, and the device signs out', async () => {
    expect(await run(200, { deleted: true })).toEqual({
      outcome: { kind: 'deleted' },
      signedOut: true,
    });
  });

  it('401 reauth_required asks for a recent sign-in and keeps the device signed in', async () => {
    expect(
      await run(401, {
        error: 'For your safety, sign in again, then delete your account.',
        code: 'reauth_required',
      }),
    ).toEqual({ outcome: { kind: 'reauth_required' }, signedOut: false });
  });

  it('409 transfer_or_delete_org is the team step, not a failure', async () => {
    expect(
      await run(409, {
        error: 'You own a team with other people in it. Choose what happens to it first.',
        code: 'transfer_or_delete_org',
        orgs: [{ id: 'o1', name: 'Team', members: 2, paid: false }],
      }),
    ).toEqual({ outcome: { kind: 'owns_org' }, signedOut: false });
  });

  it('502 billing_failed says a subscription could not be stopped, and changes nothing', async () => {
    expect(
      await run(502, {
        error: 'Could not stop your subscription from renewing. Nothing was deleted. Try again.',
        code: 'billing_failed',
      }),
    ).toEqual({ outcome: { kind: 'billing' }, signedOut: false });
  });

  it('a bare 500 is a failure that changes nothing', async () => {
    expect(await run(500, { error: 'Could not delete the account. Try again.' })).toEqual({
      outcome: { kind: 'failed' },
      signedOut: false,
    });
  });

  it('401 not_signed_in for an account already gone is a deletion, and the device signs out', async () => {
    expect(await run(401, { error: 'Sign in first.', code: 'not_signed_in' }, AUTH.gone)).toEqual({
      outcome: { kind: 'deleted' },
      signedOut: true,
    });
    expect(asked).toEqual(['/functions/v1/delete-account', '/auth/v1/user']);
  });

  it('401 not_signed_in for a live account is a failure, and the device stays signed in', async () => {
    expect(await run(401, { error: 'Sign in first.', code: 'not_signed_in' }, AUTH.here)).toEqual({
      outcome: { kind: 'failed' },
      signedOut: false,
    });
  });
});

describe("main's merged function", () => {
  it('200 { ok, deleted, appleNote } is a deletion with its Apple note', async () => {
    expect(await run(200, { ok: true, deleted: true, appleNote: true })).toEqual({
      outcome: { kind: 'deleted', appleNote: true },
      signedOut: true,
    });
  });

  it('409 owns_org is the team step; 502 billing and 500 failed are failures', async () => {
    expect(await run(409, { error: 'owns_org' })).toEqual({
      outcome: { kind: 'owns_org' },
      signedOut: false,
    });
    expect((await run(502, { error: 'billing' })).outcome).toEqual({ kind: 'billing' });
    expect((await run(500, { error: 'failed' })).outcome).toEqual({ kind: 'failed' });
  });

  it('401 unauthorized for an account already gone is a deletion, and the device signs out', async () => {
    expect(await run(401, { error: 'unauthorized' }, AUTH.gone)).toEqual({
      outcome: { kind: 'deleted' },
      signedOut: true,
    });
  });

  it('401 unauthorized after a sign-out everywhere ends the sign-in involuntarily, claiming nothing', async () => {
    expect(await run(401, { error: 'unauthorized' }, AUTH.signedOutEverywhere)).toEqual({
      outcome: { kind: 'signed_out' },
      signedOut: true,
    });
    expect(last).toEqual({ forgot: 0, ended: 1 });
  });

  it('401 unauthorized with the auth server down is unconfirmed, still signed in', async () => {
    expect(await run(401, { error: 'unauthorized' }, AUTH.down)).toEqual({
      outcome: { kind: 'unconfirmed' },
      signedOut: false,
    });
  });

  it('401 unauthorized with an answer the auth server gives no reason for is unconfirmed, still signed in', async () => {
    for (const auth of [AUTH.badJwt, AUTH.noCode401, AUTH.noCode403]) {
      expect(await run(401, { error: 'unauthorized' }, auth), JSON.stringify(auth.body)).toEqual({
        outcome: { kind: 'unconfirmed' },
        signedOut: false,
      });
    }
  });

  it('401 not_signed_in offline at the auth server is unconfirmed, still signed in', async () => {
    const offline = vi.fn(async (url: string) => {
      if (new URL(url).pathname === '/auth/v1/user') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ error: 'Sign in first.', code: 'not_signed_in' }), {
        status: 401,
      });
    });
    vi.stubGlobal('fetch', offline);
    const seen = { forgot: 0, ended: 0 };
    const outcome = await deleteAccount({
      session: async () => ({
        accessToken: 'tok',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3_600_000,
        user: { id: 'u1', email: 'a@b.c' },
      }),
      invoke: (token) => invokeFunctionWithCode<Answer>('delete-account', token, {}),
      authState: (token) => authUserState(token),
      forgetSession: async () => {
        seen.forgot += 1;
      },
      endSignIn: async () => {
        seen.ended += 1;
      },
      clearPendingAppleLink: async () => {},
    });
    expect(outcome).toEqual({ kind: 'unconfirmed' });
    expect(seen).toEqual({ forgot: 0, ended: 0 });
  });
});

describe('authUserState', () => {
  it('reads only user_not_found as gone and session_not_found as a dead sign-in, and throws otherwise', async () => {
    const stateOf = async (auth: Auth) => {
      answer(200, {}, auth);
      try {
        return await authUserState('tok');
      } catch (err) {
        return err instanceof SupabaseRequestError
          ? `threw ${err.status}${err.code ? ` ${err.code}` : ''}`
          : 'threw';
      }
    };
    expect(await stateOf(AUTH.here)).toBe('here');
    expect(await stateOf(AUTH.gone)).toBe('gone');
    expect(await stateOf(AUTH.signedOutEverywhere)).toBe('invalid');
    // bad_jwt, and a 401 or 403 with no GoTrue code, cannot tell a dead
    // sign-in from anything else, so they never read as one.
    expect(await stateOf(AUTH.badJwt)).toBe('threw 403 bad_jwt');
    expect(await stateOf(AUTH.noCode401)).toBe('threw 401');
    expect(await stateOf(AUTH.noCode403)).toBe('threw 403');
    expect(await stateOf(AUTH.down)).toBe('threw 503');
  });
});
