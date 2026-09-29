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
  const seen = { invoked: [] as string[], forgot: 0, cleared: 0 };
  const deps = {
    session: async () => live('fresh'),
    invoke: async (token: string) => {
      seen.invoked.push(token);
      return { ok: true, appleNote: false };
    },
    forgetSession: async () => {
      seen.forgot += 1;
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

  it('fails without touching the device when offline, refused, or answered oddly', async () => {
    for (const invoke of [
      async () => {
        throw new TypeError('Failed to fetch');
      },
      async () => {
        throw new SupabaseRequestError('Request failed (502).', 502, 'billing');
      },
      async () => ({ ok: false }),
    ]) {
      const { deps, seen } = fakes({ invoke });
      expect(await deleteAccount(deps)).toEqual({ kind: 'failed' });
      expect(seen.forgot).toBe(0);
    }
  });

  it('never calls the server without a session', async () => {
    const { deps, seen } = fakes({ session: async () => undefined });
    expect(await deleteAccount(deps)).toEqual({ kind: 'failed' });
    expect(seen.invoked).toEqual([]);
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

  beforeEach(() => {
    mem.clear();
    sb.calls = [];
    sb.answer = { ok: true, appleNote: false };
    sb.refuse = undefined;
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

  it('keeps the person signed in when the server fails', async () => {
    sb.refuse = { status: 500, code: 'failed' };
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'failed' });
    expect(useApp.getState().authSession).toBeDefined();
  });

  it('asks nothing when nobody is signed in', async () => {
    useApp.setState({ authSession: undefined });
    expect(await useApp.getState().deleteAccount()).toEqual({ kind: 'failed' });
    expect(sb.calls).toEqual([]);
  });
});
