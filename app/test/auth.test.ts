// The store's sign-in lifecycle against a mocked Supabase: one fresh token for
// every server call (APP-1), a dead refresh token signs the device out in one
// place (APP-2), a purchase that Apple confirmed but the server never linked is
// kept and retried (UI-10), a server org is adopted only when it is mine or
// after an explicit yes (BE-1 client half), sign-out leaves no authority behind
// (APP-7), and a sign-in link is PKCE, so it signs in only on the device
// that asked, across a cold start, while the 6-digit code works anywhere
// (APP-6, passwordless 2026-10-12). Sign
// out ends this device's sign-in only, finishes here offline too, and "Sign
// out everywhere" says plainly when nothing changed (finding 20, CX 4); the
// guardrail record rides the store's one refresh (the refresh race).
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
  verifyEmailCode: vi.fn(),
  sendEmailSignIn: vi.fn(),
  exchangeAuthCode: vi.fn(),
  signOut: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
};
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return { ...real, isConfigured: () => true, ...sb };
});

const { SupabaseRequestError } = await import('../src/lib/supabase.js');
const { clearSession } = await import('../src/lib/authSession.js');
const { recordEthicsEvent } = await import('../src/lib/ethics.js');
const { useApp } = await import('../src/state/store.js');
const { SIGNED_OUT_EVERYWHERE, SIGNED_OUT_HERE, SIGN_OUT_EVERYWHERE_FAILED } =
  await import('../src/state/signinOps.js');
type Session = import('../src/lib/supabase.js').Session;

const SESSION_KEY = 'oscode.auth.session.v1';
const PENDING_AUTH_KEY = 'oscode.auth.pending.v2';
const CALLBACK = 'oscode://auth-callback?code=one-time';
const IMPLICIT = 'oscode://auth-callback#access_token=at&refresh_token=rt&expires_in=3600';
const { LINK_ELSEWHERE, LINK_EXPIRED, CODE_REFUSED } =
  await import('../src/state/emailSignInOps.js');
const { codeChallengeOf } = await import('../src/lib/pkce.js');

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

async function resetAll() {
  // A clear, as a sign-out makes one: the refresh module forgets the last
  // token it spent, since every test here reuses the same fixture tokens.
  await clearSession();
  mem.clear();
  secrets.clear();
  memberships = [];
  ownerOf = {};
  for (const fn of Object.values(sb)) fn.mockReset();
  sb.rpc.mockResolvedValue(null);
  sb.invokeFunction.mockResolvedValue({});
  sb.signOut.mockResolvedValue(undefined);
  sb.sendEmailSignIn.mockResolvedValue(undefined);
  sb.refreshSession.mockResolvedValue(live());
  sb.select.mockImplementation(async (table: string, _token: string, query: string) => {
    if (table === 'org_members' && query.includes('select=org_id')) return memberships;
    if (table === 'orgs') return [orgRow(/id=eq\.([^&]+)/.exec(query)![1]!)];
    if (table === 'org_members' && query.includes('select=*&org_id=')) {
      // The roster: the owner holds the admin seat, the signed-in user is a
      // member unless they are the owner.
      const orgId = /org_id=eq\.([^&]+)/.exec(query)![1]!;
      const owner = ownerOf[orgId] ?? 'boss';
      const row = (id: string, uid: string, email: string, role: string) => ({
        id,
        org_id: orgId,
        user_id: uid,
        email,
        role,
        status: 'active',
      });
      return owner === 'u1'
        ? [row('m1', 'u1', 'a@b.c', 'admin')]
        : [row('m0', owner, 'boss@co.com', 'admin'), row('m1', 'u1', 'a@b.c', 'member')];
    }
    return [];
  });
  useApp.setState({
    authSession: undefined,
    serverRole: undefined,
    entitlement: undefined,
    orgJoin: undefined,
    toast: undefined,
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('one fresh token for every server call (APP-1)', () => {
  beforeEach(resetAll);

  it('refreshes an expired session once and hands the new token to concurrent callers', async () => {
    useApp.setState({ authSession: expired() });
    const s = useApp.getState();
    await Promise.all([s.refreshEntitlement(), s.refreshOrgRole(), s.refreshOrgRole()]);
    expect(sb.refreshSession).toHaveBeenCalledTimes(1);
    expect(sb.select).toHaveBeenCalled();
    for (const call of sb.select.mock.calls) expect(call[1]).toBe('fresh-token');
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

describe('adopting a server org (BE-1 client half)', () => {
  beforeEach(async () => {
    await resetAll();
    sb.verifyEmailCode.mockResolvedValue(live());
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
    await useApp.getState().verifySignInCode('a@b.c', '123456');
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
    await useApp.getState().verifySignInCode('a@b.c', '123456');
    expect(useApp.getState().settings.account?.org?.serverId).toBe('org1');
    expect(useApp.getState().orgJoin).toBeUndefined();
  });

  it("asks before joining someone else's org, remembers a decline, and joins on a yes", async () => {
    memberships = [{ org_id: 'org1' }];
    await useApp.getState().verifySignInCode('a@b.c', '123456');
    expect(useApp.getState().settings.account?.org).toBeUndefined();
    expect(useApp.getState().orgJoin?.org.name).toBe('One');

    await useApp.getState().declineOrg();
    expect(useApp.getState().orgJoin).toBeUndefined();
    expect(useApp.getState().settings.declinedOrgIds).toEqual(['org1']);
    await useApp.getState().verifySignInCode('a@b.c', '123456');
    expect(useApp.getState().orgJoin).toBeUndefined();
    expect(useApp.getState().settings.account?.org).toBeUndefined();

    await useApp.getState().saveSettings({ declinedOrgIds: undefined });
    await useApp.getState().verifySignInCode('a@b.c', '123456');
    expect(useApp.getState().orgJoin?.org.serverId).toBe('org1');
    await useApp.getState().joinOrg();
    expect(useApp.getState().orgJoin).toBeUndefined();
    expect(useApp.getState().settings.account?.org?.serverId).toBe('org1');
    expect(useApp.getState().settings.account?.selfEmail).toBe('a@b.c');
  });
});

describe('sign-out leaves nothing behind (APP-7)', () => {
  beforeEach(async () => {
    await resetAll();
    sb.verifyEmailCode.mockResolvedValue(live());
  });

  it('drops the roster, the identity, local admin authority, and the pending flags', async () => {
    memberships = [{ org_id: 'org1' }];
    ownerOf = { org1: 'u1' };
    await useApp.getState().verifySignInCode('a@b.c', '123456');
    await useApp.getState().saveSettings({ declinedOrgIds: ['org9'] });
    expect(await useApp.getState().authorizeAdmin()).toBe(true);

    await useApp.getState().signOutAccount();
    const st = useApp.getState();
    expect(st.authSession).toBeUndefined();
    expect(await st.authorizeAdmin()).toBe(false);
    expect(st.settings.account?.org?.members).toEqual([]);
    expect(st.settings.account?.org?.serverId).toBe('org1');
    expect(st.settings.account?.selfEmail).toBeUndefined();
    expect(st.settings.declinedOrgIds).toBeUndefined();
  });
});

describe('a sign-in link is PKCE, bound to the device that asked (APP-6)', () => {
  beforeEach(resetAll);

  const pending = () =>
    JSON.parse(secrets.get(PENDING_AUTH_KEY)!) as { email: string; verifier: string };

  it('sends only the challenge, keeping the verifier in the secret store', async () => {
    await useApp.getState().sendSignInEmail(' A@b.c ');
    const row = pending();
    expect(row.email).toBe('a@b.c');
    expect(row.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [email, , challenge] = sb.sendEmailSignIn.mock.calls[0]!;
    expect(email).toBe('A@b.c');
    expect(challenge).toBe(await codeChallengeOf(row.verifier));
    expect(challenge).not.toBe(row.verifier);
    expect(mem.has(PENDING_AUTH_KEY)).toBe(false);
  });

  it('trades the link code with this device verifier, then forgets the request', async () => {
    sb.exchangeAuthCode.mockResolvedValue(live());
    await useApp.getState().sendSignInEmail('a@b.c');
    const { verifier } = pending();
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(true);
    expect(sb.exchangeAuthCode).toHaveBeenCalledWith('one-time', verifier);
    expect(useApp.getState().authSession?.user.email).toBe('a@b.c');
    expect(secrets.has(PENDING_AUTH_KEY)).toBe(false);
  });

  it('a link with no request here signs nobody in and points to the code', async () => {
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(sb.exchangeAuthCode).not.toHaveBeenCalled();
    expect(useApp.getState().authSession).toBeUndefined();
    expect(useApp.getState().toast).toBe(LINK_ELSEWHERE);
  });

  it('keeps the request across a cold start, for ten minutes', async () => {
    sb.exchangeAuthCode.mockResolvedValue(live());
    await useApp.getState().sendSignInEmail('a@b.c');
    const row = pending();
    // The app is killed and relaunched by the link from Mail: a fresh store.
    vi.resetModules();
    const { useApp: relaunched } = await import('../src/state/store.js');
    expect(await relaunched.getState().completeAuthCallback(CALLBACK)).toBe(true);
    expect(sb.exchangeAuthCode).toHaveBeenCalledWith('one-time', row.verifier);
    // Past the TTL the request is forgotten, so a link has nothing to trade.
    sb.exchangeAuthCode.mockClear();
    await relaunched.getState().signOutAccount();
    secrets.set(PENDING_AUTH_KEY, JSON.stringify({ ...row, at: Date.now() - 11 * 60_000 }));
    expect(await relaunched.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(sb.exchangeAuthCode).not.toHaveBeenCalled();
    expect(secrets.has(PENDING_AUTH_KEY)).toBe(false);
  });

  it('never takes session tokens from a link address (the old implicit flow)', async () => {
    await useApp.getState().sendSignInEmail('a@b.c');
    expect(await useApp.getState().completeAuthCallback(IMPLICIT)).toBe(false);
    expect(sb.getUser).not.toHaveBeenCalled();
    expect(useApp.getState().authSession).toBeUndefined();
  });

  it('says plainly when the link expired or was used', async () => {
    await useApp.getState().sendSignInEmail('a@b.c');
    const refused =
      'oscode://auth-callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(await useApp.getState().completeAuthCallback(refused)).toBe(false);
    expect(useApp.getState().toast).toBe(LINK_EXPIRED);
    sb.exchangeAuthCode.mockRejectedValue(
      new Error('invalid flow state, no valid flow state found'),
    );
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(useApp.getState().toast).toBe(LINK_EXPIRED);
  });

  it('refuses a link for another account while someone is signed in', async () => {
    useApp.setState({ authSession: live() });
    await useApp.getState().sendSignInEmail('c@d.e');
    sb.exchangeAuthCode.mockResolvedValue({ ...live(), user: { id: 'u2', email: 'c@d.e' } });
    expect(await useApp.getState().completeAuthCallback(CALLBACK)).toBe(false);
    expect(useApp.getState().toast).toBe(
      'You are signed in as a@b.c. Sign out first to sign in as c@d.e.',
    );
    expect(useApp.getState().authSession?.user.email).toBe('a@b.c');
    await tick();
  });
});

describe('the 6-digit code signs in from anywhere', () => {
  beforeEach(resetAll);

  it('takes the digits however they were pasted, for the address as the account knows it', async () => {
    sb.verifyEmailCode.mockResolvedValue(live());
    await useApp.getState().verifySignInCode(' A@b.c', '123 456');
    expect(sb.verifyEmailCode).toHaveBeenCalledWith('a@b.c', '123456');
    expect(useApp.getState().authSession?.user.email).toBe('a@b.c');
  });

  it('refuses a short code without asking the server, and a wrong one in one plain line', async () => {
    await expect(useApp.getState().verifySignInCode('a@b.c', '12345')).rejects.toThrow(
      CODE_REFUSED,
    );
    expect(sb.verifyEmailCode).not.toHaveBeenCalled();
    sb.verifyEmailCode.mockRejectedValue(new Error('Token has expired or is invalid'));
    await expect(useApp.getState().verifySignInCode('a@b.c', '654321')).rejects.toThrow(
      CODE_REFUSED,
    );
    expect(useApp.getState().authSession).toBeUndefined();
  });

  it('the first sign-in marks the passwords line done', async () => {
    sb.verifyEmailCode.mockResolvedValue(live());
    await useApp.getState().verifySignInCode('a@b.c', '123456');
    expect(useApp.getState().settings.passwordsGoneSeen).toBe(true);
  });
});

describe('sign-out ends this device only (finding 20)', () => {
  beforeEach(resetAll);

  it('ends this sign-in on the server with a live token, and no other', async () => {
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: expired() });
    await useApp.getState().signOutAccount();
    // The stored token had expired: it is refreshed first, since the server
    // refuses an expired one and the sign-in would stay alive there.
    expect(sb.refreshSession).toHaveBeenCalledTimes(1);
    expect(sb.signOut).toHaveBeenCalledTimes(1);
    expect(sb.signOut).toHaveBeenCalledWith('fresh-token', 'local');
    expect(useApp.getState().authSession).toBeUndefined();
    expect(mem.has(SESSION_KEY)).toBe(false);
    expect(useApp.getState().toast).toBe(SIGNED_OUT_HERE);
  });

  it('finishes on this device offline', async () => {
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: expired() });
    sb.refreshSession.mockRejectedValue(new TypeError('fetch failed'));
    await useApp.getState().signOutAccount();
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(useApp.getState().authSession).toBeUndefined();
    expect(mem.has(SESSION_KEY)).toBe(false);
    expect(useApp.getState().toast).toBe(SIGNED_OUT_HERE);
  });

  it('finishes on this device when the server refuses, or never answers', async () => {
    useApp.setState({ authSession: live() });
    sb.signOut.mockRejectedValue(new SupabaseRequestError('down', 503));
    await useApp.getState().signOutAccount();
    expect(useApp.getState().authSession).toBeUndefined();

    vi.useFakeTimers();
    try {
      useApp.setState({ authSession: live(), toast: undefined });
      sb.signOut.mockImplementation(() => new Promise(() => {}));
      const out = useApp.getState().signOutAccount();
      await vi.advanceTimersByTimeAsync(5000);
      await out;
      expect(useApp.getState().authSession).toBeUndefined();
      expect(useApp.getState().toast).toBe(SIGNED_OUT_HERE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a refresh that was out when the device signed out never signs it back in', async () => {
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: expired() });
    let reply!: (s: Session) => void;
    sb.refreshSession.mockImplementation(() => new Promise<Session>((r) => (reply = r)));
    const reading = useApp.getState().refreshEntitlement();
    await vi.waitFor(() => expect(sb.refreshSession).toHaveBeenCalled());
    // The server never answers the sign-out either, so it finishes here on
    // its own clock while the refresh is still out.
    sb.signOut.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const out = useApp.getState().signOutAccount();
      await vi.advanceTimersByTimeAsync(5000);
      await out;
    } finally {
      vi.useRealTimers();
    }
    expect(useApp.getState().authSession).toBeUndefined();
    reply(live());
    expect(await reading).toBe('signed-out');
    expect(useApp.getState().authSession).toBeUndefined();
    expect(mem.has(SESSION_KEY)).toBe(false);
  });
});

describe('sign out everywhere (CX 4)', () => {
  beforeEach(resetAll);

  it('ends the sign-in on every device with a live token, then here', async () => {
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: expired() });
    expect(await useApp.getState().signOutEverywhere()).toBe(true);
    expect(sb.signOut).toHaveBeenCalledWith('fresh-token', 'global');
    expect(useApp.getState().authSession).toBeUndefined();
    expect(mem.has(SESSION_KEY)).toBe(false);
    expect(useApp.getState().toast).toBe(SIGNED_OUT_EVERYWHERE);
  });

  it('says nothing changed, and changes nothing, when the server cannot be reached', async () => {
    mem.set(SESSION_KEY, JSON.stringify(live()));
    useApp.setState({ authSession: live() });
    sb.signOut.mockRejectedValue(new TypeError('fetch failed'));
    expect(await useApp.getState().signOutEverywhere()).toBe(false);
    expect(sb.signOut).toHaveBeenCalledWith('fresh-token', 'global');
    expect(useApp.getState().authSession?.accessToken).toBe('fresh-token');
    expect(mem.has(SESSION_KEY)).toBe(true);
    expect(useApp.getState().toast).toBe(SIGN_OUT_EVERYWHERE_FAILED);

    // Offline before it could even ask: the same answer, still signed in.
    sb.signOut.mockClear();
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: expired(), toast: undefined });
    sb.refreshSession.mockRejectedValue(new TypeError('fetch failed'));
    expect(await useApp.getState().signOutEverywhere()).toBe(false);
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(useApp.getState().authSession).toBeDefined();
    expect(useApp.getState().toast).toBe(SIGN_OUT_EVERYWHERE_FAILED);
  });
});

describe('the guardrail record rides the store session (the refresh race)', () => {
  beforeEach(resetAll);

  const blocked = {
    category: 'weapons-uplift',
    tier: 1,
    timestamp: '2026-09-29T12:00:00.000Z',
    requestHash: 'a'.repeat(64),
    modelPath: 'local',
    action: 'blocked',
    side: 'input',
    signals: [],
  } as never;

  it('uploads with the store token, and never refreshes a spent one of its own', async () => {
    // The device's stored copy is behind the store's (its save still on the
    // way). The old path read it and spent its refresh token a second time.
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: live() });
    await recordEthicsEvent(blocked);
    expect(sb.refreshSession).not.toHaveBeenCalled();
    expect(sb.insert).toHaveBeenCalledWith('guardrail_events', 'fresh-token', expect.anything());
  });

  it('rides the one refresh in flight, and sends nothing signed out', async () => {
    mem.set(SESSION_KEY, JSON.stringify(expired()));
    useApp.setState({ authSession: expired() });
    await Promise.all([useApp.getState().refreshEntitlement(), recordEthicsEvent(blocked)]);
    expect(sb.refreshSession).toHaveBeenCalledTimes(1);
    expect(sb.insert).toHaveBeenCalledWith('guardrail_events', 'fresh-token', expect.anything());

    sb.insert.mockClear();
    useApp.setState({ authSession: undefined });
    await recordEthicsEvent(blocked);
    expect(sb.insert).not.toHaveBeenCalled();
  });
});
