// Both delete-account functions, through the real client (CTO 11 package C,
// the interim app fix). Production runs the privacy branch's 2026-09-24
// function until main's merged one is deployed; a build from main must read
// either one's answers correctly, so a deletion that succeeded never reads as
// failed and never leaves the device signed in to a deleted account. The
// bodies below are the ones each function sends
// (supabase/functions/delete-account/index.ts, and d3d4bb7's).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.test');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');

const { invokeFunctionWithCode, SupabaseRequestError } = await import('../src/lib/supabase.js');
const { deleteAccount } = await import('../src/state/accountDeletion.js');
type Answer = import('../src/state/accountDeletion.js').DeleteAccountAnswer;

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

async function run(status: number, body: unknown) {
  answer(status, body);
  const seen = { forgot: 0 };
  const outcome = await deleteAccount({
    session: async () => ({
      accessToken: 'tok',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3_600_000,
      user: { id: 'u1', email: 'a@b.c' },
    }),
    invoke: (token) => invokeFunctionWithCode<Answer>('delete-account', token, {}),
    forgetSession: async () => {
      seen.forgot += 1;
    },
    clearPendingAppleLink: async () => {},
  });
  return { outcome, signedOut: seen.forgot === 1 };
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

  it('502 billing_failed and a bare 500 are failures that change nothing', async () => {
    for (const [status, body] of [
      [
        502,
        {
          error: 'Could not stop your subscription from renewing. Nothing was deleted. Try again.',
          code: 'billing_failed',
        },
      ],
      [500, { error: 'Could not delete the account. Try again.' }],
      [401, { error: 'Sign in first.', code: 'not_signed_in' }],
    ] as const) {
      expect(await run(status, body)).toEqual({ outcome: { kind: 'failed' }, signedOut: false });
    }
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
    expect((await run(502, { error: 'billing' })).outcome).toEqual({ kind: 'failed' });
    expect((await run(500, { error: 'failed' })).outcome).toEqual({ kind: 'failed' });
  });
});
