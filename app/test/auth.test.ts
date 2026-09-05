// The store's sign-in lifecycle against a mocked Supabase: one fresh token for
// every server call (APP-1), a dead refresh token signs the device out in one
// place (APP-2), a purchase that Apple confirmed but the server never linked is
// kept and retried (UI-10), a server org is adopted only when it is mine or
// after an explicit yes (BE-1 client half), sign-out leaves no authority behind
// (APP-7), and a sign-in link is bound to the request that asked for it,
// across a cold start, or confirmed by hand when nothing asked (APP-6).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();

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
  secretGet: async (k: string) => secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => {
    secrets.set(k, v);
  },
  secretDelete: async (k: string) => {
    secrets.delete(k);
  },
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

const sb = {
  refreshSession: vi.fn(),
  select: vi.fn(),
  rpc: vi.fn(),
  invokeFunction: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  signOut: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  updatePassword: vi.fn(),
};
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return { ...real, isConfigured: () => true, ...sb };
});

const iap = { purchase: vi.fn(), restore: vi.fn() };
vi.mock('../src/lib/iap.js', () => ({
  iapAvailable: () => true,
  PERSONAL_YEARLY_PRODUCT_ID: 'ai.openshore.oscode.personal.yearly',
  purchase: (...args: unknown[]) => iap.purchase(...args),
  restore: (...args: unknown[]) => iap.restore(...args),
}));

const { SupabaseRequestError } = await import('../src/lib/supabase.js');
const { useApp } = await import('../src/state/store.js');
type Session = import('../src/lib/supabase.js').Session;

const SESSION_KEY = 'oscode.auth.session.v1';
const PENDING_AUTH_KEY = 'oscode.auth.pending.v1';
const PENDING_LINK_KEY = 'oscode.iap.pendingLink.v1';
const CALLBACK = 'oscode://auth-callback#access_token=at&refresh_token=rt&expires_in=3600';
const RECOVERY = `${CALLBACK}&type=recovery`;

const user = { id: 'u1', email: 'a@b.c' };
const live = (): Session => ({
  accessToken: 'fresh-token',
  refreshToken: 'rt-2',
  expiresAt: Date.now() + 3_600_000,
  user,
});
const expired = (): Session => ({
  accessToken: 'old-token',
  refreshToken: 'rt-1',
  expiresAt: Date.now() - 1,
  user,
});

// The server side of an org: who owns which org, which orgs the signed-in
// user is a member of. Each test sets the two knobs.
let memberships: Array<{ org_id: string }> = [];
let ownerOf: Record<string, string> = {};
function orgRow(id: string) {
  return {
    id,
    name: id === 'org1' ? 'One' : 'Two',
    owner_uid: ownerOf[id] ?? 'boss',
    seat_count: 3,
    tier_id: 'micro',
    price_year: 0,
  };
}

function resetAll() {
  mem.clear();
  secrets.clear();
  memberships = [];
  ownerOf = {};
  for (const fn of Object.values(sb)) fn.mockReset();
  for (const fn of Object.values(iap)) fn.mockReset();
  sb.rpc.mockResolvedValue(null);
  sb.invokeFunction.mockResolvedValue({});
  sb.signOut.mockResolvedValue(undefined);
  sb.signInWithOtp.mockResolvedValue(undefined);
  sb.refreshSession.mockResolvedValue(live());
  sb.select.mockImplementation(async (table: string, _token: string, query: string) => {
    if (table === 'org_members' && query.includes('select=org_id')) return memberships;
    if (table === 'orgs') return [orgRow(/id=eq\.([^&]+)/.exec(query)![1]!)];
    return [];
  });
  useApp.setState({
    authSession: undefined,
    serverRole: undefined,
    entitlement: undefined,
    userEntitlement: undefined,
    passwordRecovery: undefined,
    authConfirm: undefined,
    orgJoin: undefined,
    toast: undefined,
    paywall: undefined,
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('one fresh token for every server call (APP-1)', () => {
  beforeEach(resetAll);

  it('refreshes an expired session once and hands the new token to concurrent callers', async () => {
    useApp.setState({ authSession: expired() });
    iap.purchase.mockResolvedValue({ state: 'purchased', jws: 'JWS1' });
    const s = useApp.getState();
    await Promise.all([s.refreshEntitlement(), s.buyPersonal()]);
    expect(sb.refreshSession).toHaveBeenCalledTimes(1);
    expect(sb.select).toHaveBeenCalled();
    for (const call of sb.select.mock.calls) expect(call[1]).toBe('fresh-token');
    expect(sb.invokeFunction).toHaveBeenCalledWith('link-apple-purchase', 'fresh-token', {
      jws: 'JWS1',
    });
    expect(useApp.getState().authSession?.accessToken).toBe('fresh-token');
  });
});

describe('a dead refresh token signs the device out (APP-2)', () => {
  beforeEach(resetAll);

  it('clears the session, the stored copy, and says so once', async () => {
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: expired() });
    sb.refreshSession.mockRejectedValue(new SupabaseRequestError('Invalid Refresh Token', 400));
    await useApp.getState().refreshEntitlement();
    const st = useApp.getState();
    expect(st.authSession).toBeUndefined();
    expect(mem.has(SESSION_KEY)).toBe(false);
    expect(st.toast).toBe('Your sign-in expired. Sign in again.');
    expect(sb.select).not.toHaveBeenCalled();
  });

  it('a network failure keeps the session (an offline launch stays signed in)', async () => {
    useApp.setState({ authSession: expired() });
    sb.refreshSession.mockRejectedValue(new TypeError('fetch failed'));
    await useApp.getState().refreshEntitlement();
    expect(useApp.getState().authSession?.refreshToken).toBe('rt-1');
    expect(useApp.getState().toast).toBeUndefined();
  });
});

describe('an Apple purchase the server could not link (UI-10)', () => {
  beforeEach(resetAll);

  it('keeps the receipt, names the recovery, and retries on the next foreground', async () => {
    useApp.setState({ authSession: live() });
    iap.purchase.mockResolvedValue({ state: 'purchased', jws: 'JWS1' });
    sb.invokeFunction.mockRejectedValueOnce(new TypeError('fetch failed'));
    await useApp.getState().buyPersonal();
    expect(useApp.getState().toast).toBe(
      'Apple confirmed your purchase. OpenShore could not reach its server to unlock it. Tap Restore purchases when you are back online.',
    );
    expect(mem.get(PENDING_LINK_KEY)).toContain('JWS1');

    sb.invokeFunction.mockClear();
    await useApp.getState().reconcileEntitlementOnForeground();
    expect(sb.invokeFunction).toHaveBeenCalledWith('link-apple-purchase', 'fresh-token', {
      jws: 'JWS1',
    });
    expect(mem.has(PENDING_LINK_KEY)).toBe(false);
  });
});

describe('adopting a server org (BE-1 client half)', () => {
  beforeEach(() => {
    resetAll();
    sb.signInWithPassword.mockResolvedValue(live());
  });

  it('pulls memberships in creation order and prefers the org this device already references', async () => {
    memberships = [{ org_id: 'org1' }, { org_id: 'org2' }];
    useApp.setState({
      settings: {
        onboarded: true,
        claudeModel: 'x',
        deviceModels: {},
        account: {
          type: 'commercial',
          org: {
            id: 'local',
            serverId: 'org2',
            name: 'Two',
            seatCount: 3,
            tierId: 'micro',
            priceYear: 0,
            members: [],
            createdAt: 't',
          },
        },
      },
    });
    await useApp.getState().signIn('a@b.c', 'pw');
    const membershipQuery = sb.select.mock.calls.find(
      (c) => c[0] === 'org_members' && String(c[2]).includes('select=org_id'),
    );
    expect(String(membershipQuery![2])).toContain('order=created_at.asc');
    expect(String(membershipQuery![2])).not.toContain('limit=1');
    expect(useApp.getState().settings.account?.org?.serverId).toBe('org2');
    expect(useApp.getState().orgJoin).toBeUndefined();
  });

  it('adopts silently when I own the org', async () => {
    memberships = [{ org_id: 'org1' }];
    ownerOf = { org1: 'u1' };
    await useApp.getState().signIn('a@b.c', 'pw');
    expect(useApp.getState().settings.account?.org?.serverId).toBe('org1');
    expect(useApp.getState().orgJoin).toBeUndefined();
  });

  it("asks before joining someone else's org, remembers a decline, and joins on a yes", async () => {
    memberships = [{ org_id: 'org1' }];
    await useApp.getState().signIn('a@b.c', 'pw');
    expect(useApp.getState().settings.account?.org).toBeUndefined();
    expect(useApp.getState().orgJoin?.org.name).toBe('One');

    await useApp.getState().declineOrg();
    expect(useApp.getState().orgJoin).toBeUndefined();
    expect(useApp.getState().settings.declinedOrgIds).toEqual(['org1']);
    await useApp.getState().signIn('a@b.c', 'pw');
    expect(useApp.getState().orgJoin).toBeUndefined();
    expect(useApp.getState().settings.account?.org).toBeUndefined();

    await useApp.getState().saveSettings({ declinedOrgIds: undefined });
    await useApp.getState().signIn('a@b.c', 'pw');
    expect(useApp.getState().orgJoin?.org.serverId).toBe('org1');
    await useApp.getState().joinOrg();
    expect(useApp.getState().orgJoin).toBeUndefined();
    expect(useApp.getState().settings.account?.org?.serverId).toBe('org1');
    expect(useApp.getState().settings.account?.selfEmail).toBe('a@b.c');
  });
});

describe('sign-out leaves nothing behind (APP-7)', () => {
  beforeEach(() => {
    resetAll();
    sb.signInWithPassword.mockResolvedValue(live());
  });

  it('drops the roster, the identity, local admin authority, and the pending flags', async () => {
    memberships = [{ org_id: 'org1' }];
    ownerOf = { org1: 'u1' };
    await useApp.getState().signIn('a@b.c', 'pw');
    await useApp.getState().saveSettings({ declinedOrgIds: ['org9'] });
    useApp.setState({ passwordRecovery: true });
    expect(await useApp.getState().authorizeAdmin()).toBe(true);

    await useApp.getState().signOutAccount();
    const st = useApp.getState();
    expect(st.authSession).toBeUndefined();
    expect(await st.authorizeAdmin()).toBe(false);
    expect(st.settings.account?.org?.members).toEqual([]);
    expect(st.settings.account?.org?.serverId).toBe('org1');
    expect(st.settings.account?.selfEmail).toBeUndefined();
    expect(st.settings.declinedOrgIds).toBeUndefined();
    expect(st.passwordRecovery).toBeFalsy();
  });
});

describe('a sign-in link is bound to the request that asked for it (APP-6)', () => {
  beforeEach(resetAll);

  it('signs in silently when the link matches the address we sent it to', async () => {
    sb.getUser.mockResolvedValue(user);
    await useApp.getState().sendMagicLink('A@b.c');
    expect(mem.get(PENDING_AUTH_KEY)).toContain('a@b.c');
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(true);
    expect(useApp.getState().authSession?.user.email).toBe('a@b.c');
    expect(useApp.getState().authConfirm).toBeUndefined();
    expect(mem.has(PENDING_AUTH_KEY)).toBe(false);
  });

  it('refuses a link for a different account than the one we asked for', async () => {
    sb.getUser.mockResolvedValue({ id: 'u2', email: 'x@y.z' });
    await useApp.getState().sendMagicLink('a@b.c');
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(useApp.getState().authSession).toBeUndefined();
    expect(useApp.getState().toast).toBe(
      'That link is for a different account. Request a new one from here.',
    );
  });

  it('keeps the binding across a cold start, for fifteen minutes', async () => {
    await useApp.getState().sendMagicLink('a@b.c');
    // The app is killed and relaunched by the link from Mail: a fresh store.
    vi.resetModules();
    const { useApp: relaunched } = await import('../src/state/store.js');
    sb.getUser.mockResolvedValue({ id: 'u2', email: 'x@y.z' });
    expect(await relaunched.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(relaunched.getState().authConfirm).toBeUndefined();
    expect(relaunched.getState().toast).toBe(
      'That link is for a different account. Request a new one from here.',
    );
    // Past the TTL the request is forgotten, so the link is treated as unsolicited.
    mem.set(PENDING_AUTH_KEY, JSON.stringify({ email: 'a@b.c', at: Date.now() - 16 * 60_000 }));
    expect(await relaunched.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(relaunched.getState().authConfirm).toEqual({ email: 'x@y.z', recovery: false });
  });

  it('asks before signing in on a link nothing here requested', async () => {
    sb.getUser.mockResolvedValue(user);
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(useApp.getState().authSession).toBeUndefined();
    expect(useApp.getState().authConfirm).toEqual({ email: 'a@b.c', recovery: false });
    useApp.getState().dismissAuthCallback();
    expect(useApp.getState().authConfirm).toBeUndefined();
    expect(useApp.getState().authSession).toBeUndefined();

    await useApp.getState().completeAuthCallback(CALLBACK);
    await useApp.getState().confirmAuthCallback();
    expect(useApp.getState().authConfirm).toBeUndefined();
    expect(useApp.getState().authSession?.user.email).toBe('a@b.c');
  });

  it('a recovery link sets the password prompt only once confirmed', async () => {
    sb.getUser.mockResolvedValue(user);
    expect(await useApp.getState().completeAuthCallback(RECOVERY)).toBe(false);
    expect(useApp.getState().authConfirm).toEqual({ email: 'a@b.c', recovery: true });
    expect(useApp.getState().passwordRecovery).toBeFalsy();
    await useApp.getState().confirmAuthCallback();
    expect(useApp.getState().passwordRecovery).toBe(true);
    expect(useApp.getState().authSession?.user.email).toBe('a@b.c');
  });

  it('refuses a link for another account while someone is signed in', async () => {
    useApp.setState({ authSession: live() });
    sb.getUser.mockResolvedValue({ id: 'u2', email: 'c@d.e' });
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(useApp.getState().toast).toBe(
      'You are signed in as a@b.c. Sign out first to use a link for c@d.e.',
    );
    expect(useApp.getState().authSession?.user.email).toBe('a@b.c');
    expect(useApp.getState().authConfirm).toBeUndefined();
    await tick();
  });
});
