// Delete account (Apple 5.1.1(v); next build E1): the app half. The pure
// flow first, with fakes for the session, the call, and the sign-out (the
// state/accountDeletion.ts seam, CTO ruling 9); then the store against a
// mocked Supabase, proving the wiring asks delete-account with a live session
// and leaves the device signed out with no Apple receipt waiting to link.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/lib/supabase.js';

const mem = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
  sealExistingKeys: async () => {},
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
  openExternal: () => {},
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const sb = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; token: string; body: unknown }>,
  answer: { ok: true, appleNote: false } as unknown,
  refuse: undefined as { status: number; code?: string } | undefined,
  authState: 'here' as 'here' | 'gone' | 'invalid' | Error,
  asked: [] as string[],
}));
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return {
    ...real,
    isConfigured: () => true,
    select: async () => [],
    rpc: async () => null,
    readUserPrefs: async () => undefined,
    writeUserPrefs: async () => {},
    authUserState: async (token: string) => {
      sb.asked.push(token);
      if (sb.authState instanceof Error) throw sb.authState;
      return sb.authState;
    },
    invokeFunctionWithCode: async (name: string, token: string, body: unknown) => {
      sb.calls.push({ name, token, body });
      if (sb.refuse) {
        throw new real.SupabaseRequestError('refused', sb.refuse.status, sb.refuse.code);
      }
      return sb.answer;
    },
  };
});

const { SupabaseRequestError } = await import('../src/lib/supabase.js');
const { deleteAccount } = await import('../src/state/accountDeletion.js');
const { useApp } = await import('../src/state/store.js');

function live(token = 'tok'): Session {
  return {
    accessToken: token,
    refreshToken: 'rt',
    expiresAt: Date.now() + 3_600_000,
    user: { id: 'u1', email: 'a@b.c' },
  };
}

function fakes(over: Partial<Parameters<typeof deleteAccount>[0]> = {}) {
  const seen = {
    invoked: [] as string[],
    asked: [] as string[],
    forgot: 0,
    ended: 0,
    cleared: 0,
  };
  const deps = {
    session: async () => live('fresh'),
    invoke: async (token: string) => {
      seen.invoked.push(token);
      return { ok: true, appleNote: false };
    },
    authState: async (token: string): Promise<'here' | 'gone' | 'invalid'> => {
      seen.asked.push(token);
      return 'here';
    },
    forgetSession: async () => {
      seen.forgot += 1;
    },
    endSignIn: async () => {
      seen.ended += 1;
    },
    clearPendingAppleLink: async () => {
      seen.cleared += 1;
    },
    ...over,
  };
  return { deps, seen };
}

describe('the deletion flow', () => {
  it('asks with the fresh session, then signs the device out and drops the pending receipt', async () => {
    const { deps, seen } = fakes({
      invoke: async (token) => {
        seen.invoked.push(token);
        return { ok: true, appleNote: true };
      },
    });
    expect(await deleteAccount(deps)).toEqual({ kind: 'deleted', appleNote: true });
    expect(seen.invoked).toEqual(['fresh']);
    expect(seen.forgot).toBe(1);
    expect(seen.cleared).toBe(1);
  });

  it('says owns_org and changes nothing when the person owns a team with others in it', async () => {
    const { deps, seen } = fakes({
      invoke: async () => {
        throw new SupabaseRequestError('Request failed (409).', 409, 'owns_org');
      },
    });
    expect(await deleteAccount(deps)).toEqual({ kind: 'owns_org' });
    expect(seen.forgot).toBe(0);
    expect(seen.cleared).toBe(0);
  });

  // The 2026-09-24 function (production's until main's is deployed, CTO 11
  // package C) answers { deleted: true } with no ok and no appleNote. That is
  // a deletion: the device must sign out, and never say it failed.
  it("reads the live 2026-09-24 function's { deleted: true } as deleted, and signs out", async () => {
    const { deps, seen } = fakes({ invoke: async () => ({ deleted: true }) });
    const outcome = await deleteAccount(deps);
    expect(outcome).toEqual({ kind: 'deleted' });
    expect(outcome.kind === 'deleted' && outcome.appleNote).toBeUndefined();
    expect(seen.forgot).toBe(1);
    expect(seen.cleared).toBe(1);
  });

  it("reads main's merged answer { ok, deleted, appleNote }", async () => {
    const { deps } = fakes({
      invoke: async () => ({ ok: true, deleted: true, appleNote: false }),
    });
    expect(await deleteAccount(deps)).toEqual({ kind: 'deleted', appleNote: false });
  });

  it("reads the 2026-09-24 function's team refusal as owns_org", async () => {
    const { deps, seen } = fakes({
      invoke: async () => {
        throw new SupabaseRequestError('Request failed (409).', 409, 'transfer_or_delete_org');
      },
    });
    expect(await deleteAccount(deps)).toEqual({ kind: 'owns_org' });
    expect(seen.forgot).toBe(0);
  });

  it('says a recent sign-in is needed, and changes nothing, on reauth_required', async () => {
    const { deps, seen } = fakes({
      invoke: async () => {
        throw new SupabaseRequestError('Request failed (401).', 401, 'reauth_required');
      },
    });
    expect(await deleteAccount(deps)).toEqual({ kind: 'reauth_required' });
    expect(seen.forgot).toBe(0);
    expect(seen.cleared).toBe(0);
  });

  it('reads a subscription that could not be stopped, from either function, as billing', async () => {
    for (const code of ['billing', 'billing_failed']) {
      const { deps, seen } = fakes({
        invoke: async () => {
          throw new SupabaseRequestError('Request failed (502).', 502, code);
        },
      });
      expect(await deleteAccount(deps), code).toEqual({ kind: 'billing' });
      expect(seen.forgot).toBe(0);
      expect(seen.asked).toEqual([]);
    }
  });

  it('reads every other code from either function as failed, and asks nothing more', async () => {
    for (const code of ['failed', 'not_a_code_either_sends']) {
      const { deps, seen } = fakes({
        invoke: async () => {
          throw new SupabaseRequestError('refused', 500, code);
        },
      });
      expect(await deleteAccount(deps), code).toEqual({ kind: 'failed' });
      expect(seen.forgot).toBe(0);
      expect(seen.asked).toEqual([]);
    }
  });

  // Main's 'unauthorized' and the 2026-09-24 function's 'not_signed_in' both
  // mean the server found no account for the token. That is what a retry
  // after a lost 200 gets, and what the second device gets after the person
  // deleted the account on the first (review 2026-09-30). The flow asks the
  // auth server once before it says anything.
  for (const code of ['unauthorized', 'not_signed_in']) {
    const noUser = (answer: () => Promise<'here' | 'gone' | 'invalid'>) =>
      fakes({
        invoke: async () => {
          throw new SupabaseRequestError('Request failed (401).', 401, code);
        },
        authState: answer,
      });

    it(`${code}, and the auth server says the account is gone: deleted, signed out`, async () => {
      const { deps, seen } = noUser(async () => 'gone');
      const outcome = await deleteAccount(deps);
      expect(outcome).toEqual({ kind: 'deleted' });
      expect(outcome.kind === 'deleted' && outcome.appleNote).toBeUndefined();
      // A deletion is a plain sign-out: nothing of the account is kept.
      expect(seen.forgot).toBe(1);
      expect(seen.ended).toBe(0);
      expect(seen.cleared).toBe(1);
    });

    it(`${code}, and the sign-in itself is dead: the sign-in ends, claiming nothing`, async () => {
      const { deps, seen } = noUser(async () => 'invalid');
      expect(await deleteAccount(deps)).toEqual({ kind: 'signed_out' });
      // An involuntary end, as the session door's on a dead refresh token:
      // the account may still exist, so its unsent team text stays sealed
      // and its pending Apple receipt stays.
      expect(seen.ended).toBe(1);
      expect(seen.forgot).toBe(0);
      expect(seen.cleared).toBe(0);
    });

    it(`${code}, and the account and sign-in are live: failed, still signed in`, async () => {
      const { deps, seen } = noUser(async () => 'here');
      expect(await deleteAccount(deps)).toEqual({ kind: 'failed' });
      expect(seen.forgot).toBe(0);
      expect(seen.ended).toBe(0);
    });

    it(`${code}, and the auth server cannot say: unconfirmed, the device untouched`, async () => {
      for (const cannot of [
        new TypeError('Failed to fetch'),
        new SupabaseRequestError('Request failed (503).', 503),
        new SupabaseRequestError('Request failed (403).', 403, 'bad_jwt'),
        new SupabaseRequestError('Request failed (401).', 401),
      ]) {
        const { deps, seen } = noUser(async () => {
          throw cannot;
        });
        expect(await deleteAccount(deps), cannot.message).toEqual({ kind: 'unconfirmed' });
        expect(seen.forgot).toBe(0);
        expect(seen.ended).toBe(0);
        expect(seen.cleared).toBe(0);
      }
    });
  }

  it('ends a dead sign-in involuntarily, and signs a deletion out plainly, never the other way', async () => {
    const dead = fakes({
      invoke: async () => {
        throw new SupabaseRequestError('Request failed (401).', 401, 'unauthorized');
      },
      authState: async () => 'invalid',
    });
    expect(await deleteAccount(dead.deps)).toEqual({ kind: 'signed_out' });
    expect([dead.seen.ended, dead.seen.forgot]).toEqual([1, 0]);

    const deleted = fakes();
    expect((await deleteAccount(deleted.deps)).kind).toBe('deleted');
    expect([deleted.seen.ended, deleted.seen.forgot]).toEqual([0, 1]);
  });

  it('asks the auth server about the same token it sent', async () => {
    const { deps, seen } = fakes({
      invoke: async (token) => {
        seen.invoked.push(token);
        throw new SupabaseRequestError('Request failed (401).', 401, 'unauthorized');
      },
    });
    await deleteAccount(deps);
    expect(seen.invoked).toEqual(['fresh']);
    expect(seen.asked).toEqual(['fresh']);
  });

  it('fails without touching the device when offline, refused, or answered oddly', async () => {
    for (const invoke of [
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => {
        throw new SupabaseRequestError('Request failed (500).', 500);
      },
      async () => ({ ok: false }),
      async () => ({ deleted: false }),
      async () => ({}),
      async () => null as unknown as { ok?: boolean },
    ]) {
      const { deps, seen } = fakes({ invoke });
      expect(await deleteAccount(deps)).toEqual({ kind: 'failed' });
      expect(seen.forgot).toBe(0);
    }
  });

  // The row shows only while signed in, so no session means the session door
  // found the sign-in dead and has already ended it (involuntarily).
  it('never calls the server without a session, and says the device is signed out', async () => {
    const { deps, seen } = fakes({ session: async () => undefined });
    expect(await deleteAccount(deps)).toEqual({ kind: 'signed_out' });
    expect(seen.invoked).toEqual([]);
    expect(seen.forgot).toBe(0);
    expect(seen.ended).toBe(0);
    const offline = fakes({
      session: async () => {
        throw new Error('offline');
      },
    });
    expect(await deleteAccount(offline.deps)).toEqual({ kind: 'failed' });
  });

  it('stays deleted when the local sign-out stumbles', async () => {
    const { deps } = fakes({
      forgetSession: async () => {
        throw new Error('disk');
      },
    });
    expect(await deleteAccount(deps)).toEqual({ kind: 'deleted', appleNote: false });
  });
});

describe('the store', () => {
  const PENDING = 'oscode.iap.pendingLink.v1';
  // Unsent team vault text, stashed for the signed-in account (the store's
  // VAULT_PENDING_KEY): a sign-out wipes it, an involuntary end keeps it.
  const TEAM_PENDING = 'oscode.vault.pending';
  const TEAM_KEY = 'org::org-1::plan.md';
  const stashTeamText = () =>
    mem.set(
      TEAM_PENDING,
      JSON.stringify({
        [TEAM_KEY]: {
          providerId: 'org',
          resourceId: 'org-1',
          owner: 'u1',
          path: 'plan.md',
          text: 'unsent team draft',
          at: '2026-09-30T00:00:00.000Z',
        },
      }),
    );
  const teamTextKept = () => {
    const raw = mem.get(TEAM_PENDING);
    return raw ? TEAM_KEY in (JSON.parse(raw) as Record<string, unknown>) : false;
  };

  beforeEach(() => {
    mem.clear();
    sb.calls = [];
    sb.answer = { ok: true, appleNote: false };
    sb.refuse = undefined;
    sb.authState = 'here';
    sb.asked = [];
    useApp.setState({ authSession: live(), toast: undefined });
  });

  it('calls delete-account as the signed-in person and forgets the session', async () => {
    mem.set(PENDING, JSON.stringify({ jws: 'x.y.z', at: 'now' }));
    sb.answer = { ok: true, appleNote: true };
    const outcome = await useApp.getState().deleteAccount();
    expect(outcome).toEqual({ kind: 'deleted', appleNote: true });
    expect(sb.calls).toEqual([{ name: 'delete-account', token: 'tok', body: {} }]);
    expect(useApp.getState().authSession).toBeUndefined();
    expect(mem.has(PENDING)).toBe(false);
  });

  it('keeps the person signed in when they own a team with others in it', async () => {
    sb.refuse = { status: 409, code: 'owns_org' };
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'owns_org' });
    expect(useApp.getState().authSession).toBeDefined();
  });

  it("signs out after the live 2026-09-24 function's { deleted: true }", async () => {
    sb.answer = { deleted: true };
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'deleted' });
    expect(useApp.getState().authSession).toBeUndefined();
  });

  it('keeps the person signed in when the server asks for a recent sign-in', async () => {
    sb.refuse = { status: 401, code: 'reauth_required' };
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'reauth_required' });
    expect(useApp.getState().authSession).toBeDefined();
  });

  it('keeps the person signed in when the server fails', async () => {
    sb.refuse = { status: 500, code: 'failed' };
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'failed' });
    expect(useApp.getState().authSession).toBeDefined();
  });

  it('asks nothing when nobody is signed in', async () => {
    useApp.setState({ authSession: undefined });
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'signed_out' });
    expect(sb.calls).toEqual([]);
  });

  it('signs out with the goodbye when the account was already deleted elsewhere', async () => {
    mem.set(PENDING, JSON.stringify({ jws: 'x.y.z', at: 'now' }));
    stashTeamText();
    sb.refuse = { status: 401, code: 'not_signed_in' };
    sb.authState = 'gone';
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'deleted' });
    expect(sb.asked).toEqual(['tok']);
    expect(useApp.getState().authSession).toBeUndefined();
    expect(mem.has(PENDING)).toBe(false);
    // A deletion is a plain sign-out: the gone account's team text goes too.
    expect(teamTextKept()).toBe(false);
  });

  it('wipes unsent team text on a deletion, as Sign out does', async () => {
    stashTeamText();
    sb.answer = { ok: true, deleted: true, appleNote: false };
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'deleted', appleNote: false });
    expect(teamTextKept()).toBe(false);
  });

  it('ends the sign-in involuntarily, keeping the pending receipt and the team text, when only the sign-in is dead', async () => {
    mem.set(PENDING, JSON.stringify({ jws: 'x.y.z', at: 'now' }));
    stashTeamText();
    sb.refuse = { status: 401, code: 'unauthorized' };
    sb.authState = 'invalid';
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'signed_out' });
    expect(useApp.getState().authSession).toBeUndefined();
    expect(mem.has(PENDING)).toBe(true);
    // The session door's end (forgetSession(true)), not Sign out's: the text
    // stays sealed for the same account to sign back in to.
    expect(teamTextKept()).toBe(true);
  });

  it('leaves the device as it was when nobody can confirm the deletion', async () => {
    mem.set(PENDING, JSON.stringify({ jws: 'x.y.z', at: 'now' }));
    stashTeamText();
    sb.refuse = { status: 401, code: 'not_signed_in' };
    sb.authState = new TypeError('Failed to fetch');
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'unconfirmed' });
    expect(useApp.getState().authSession).toBeDefined();
    expect(mem.has(PENDING)).toBe(true);
    expect(teamTextKept()).toBe(true);
  });

  it('keeps the person signed in when the auth server still knows them', async () => {
    sb.refuse = { status: 401, code: 'unauthorized' };
    sb.authState = 'here';
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'failed' });
    expect(useApp.getState().authSession).toBeDefined();
  });
});
