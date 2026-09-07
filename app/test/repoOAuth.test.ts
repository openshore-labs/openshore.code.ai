// Repo OAuth (the GitHub App path and its GitLab/Bitbucket siblings): the app
// only ever handles the public client id, a short-lived code, and the tokens
// the server hands back. These tests pin that contract: the secret never leaves
// the server (the app posts a code, not a secret), state is verified, PKCE
// binds the code to this app instance, provider errors reach the person only
// as fixed sentences, the tokens land where the paste path stored them,
// refresh goes back through the function, and remove forgets everything.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A mutable platform + in-memory Keychain the module under test writes through.
let currentPlatform = 'electron';
const secrets = new Map<string, string>();
let deepLinkCb: ((url: string) => void) | undefined;
// Every authorize URL the module opens, so a test can inspect it (the desktop
// path records here through openExternal; the iOS path records the authorize URL
// it hands ASWebAuthenticationSession).
const opened: string[] = [];
// The iOS auth-session behavior, swappable per test: given the start options,
// return the callback URL or throw (a cancel carries code 'canceled'). Default
// mirrors a real return, echoing the state on the callback like the server does.
let authSessionStart: (opts: {
  url: string;
  callbackScheme: string;
}) => Promise<{ url: string }> = async (opts) => {
  const state = new URL(opts.url).searchParams.get('state') ?? '';
  return { url: `oscode://repo-oauth?code=code_${state}&state=${state}` };
};

vi.mock('../src/lib/platform.js', () => ({
  platform: () => currentPlatform,
  openExternal: vi.fn((url: string) => {
    // Simulate the whole provider round trip: the consent page redirects to the
    // function, which bounces the code back as the oscode://repo-oauth deep link
    // echoing the same state. A test can override this to forge a bad state.
    opened.push(url);
    const state = new URL(url).searchParams.get('state') ?? '';
    queueMicrotask(() => deepLinkCb?.(`oscode://repo-oauth?code=code_${state}&state=${state}`));
  }),
  secretGet: async (k: string) => secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => void secrets.set(k, v),
  secretDelete: async (k: string) => void secrets.delete(k),
}));

vi.mock('../src/lib/electronBridge.js', () => ({
  bridge: () => ({
    onDeepLink: (cb: (url: string) => void) => {
      deepLinkCb = cb;
      return () => {
        deepLinkCb = undefined;
      };
    },
  }),
}));

// The native iOS auth session (ASWebAuthenticationSession). The module reaches
// for this on iOS instead of a browser + deep link, so drive it here. The
// authorize URL it is handed is recorded into `opened` for lastOpenedUrl().
vi.mock('../src/lib/authSessionPlugin.js', () => ({
  OscodeAuthSession: {
    available: async () => ({ available: true }),
    start: (opts: { url: string; callbackScheme: string }) => {
      opened.push(opts.url);
      return authSessionStart(opts);
    },
  },
}));

const KEY = 'oscode.secret.repo.github';

async function loadModule() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'Iv1_testclient');
  vi.resetModules();
  return import('../src/lib/gitos/repoOAuth.js');
}

function mockFetchOnce(body: unknown, ok = true, status?: number) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    status: status ?? (ok ? 200 : 400),
    json: async () => body,
  });
}

function lastOpenedUrl(): URL {
  if (opened.length === 0) throw new Error('nothing opened');
  return new URL(opened[opened.length - 1]!);
}

beforeEach(() => {
  currentPlatform = 'electron';
  secrets.clear();
  deepLinkCb = undefined;
  opened.length = 0;
  authSessionStart = async (opts) => {
    const state = new URL(opts.url).searchParams.get('state') ?? '';
    return { url: `oscode://repo-oauth?code=code_${state}&state=${state}` };
  };
  vi.unstubAllEnvs();
  globalThis.fetch = vi.fn();
});

describe('isRepoOAuthConfigured', () => {
  it('is true only when both the client id and the Supabase URL are present', async () => {
    const mod = await loadModule();
    expect(mod.isRepoOAuthConfigured('github')).toBe(true);
    // GitLab has no client id stubbed, so it stays on the token path.
    expect(mod.isRepoOAuthConfigured('gitlab')).toBe(false);
  });
});

describe('connectRepoOAuth', () => {
  it('exchanges the code through the function and stores the tokens', async () => {
    const mod = await loadModule();
    mockFetchOnce({
      accessToken: 'gho_abc',
      refreshToken: 'ghr_xyz',
      expiresAt: Date.now() + 3600_000,
    });

    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(true);

    // The access token lands under the shared repo key, so the connected badge
    // and any token reader work whether OAuth or paste connected it.
    expect(secrets.get(KEY)).toBe('gho_abc');
    expect(secrets.get(`${KEY}.mode`)).toBe('oauth');
    expect(secrets.get(`${KEY}.refresh`)).toBe('ghr_xyz');
    expect(await mod.isRepoOAuthConnected('github')).toBe(true);

    // The one network call is a POST to /exchange carrying the code, NEVER a
    // secret: the app never holds the client secret.
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/repo-oauth/exchange');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.provider).toBe('github');
    expect(sent.code).toMatch(/^code_github\./);
    expect(sent).not.toHaveProperty('client_secret');
  });

  it('sends a S256 PKCE challenge on authorize and the matching verifier on exchange', async () => {
    const mod = await loadModule();
    mockFetchOnce({ accessToken: 'gho_abc' });

    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(true);

    const authUrl = lastOpenedUrl();
    const challenge = authUrl.searchParams.get('code_challenge');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    // RFC 7636: 43..128 unreserved characters, and never on the authorize URL.
    expect(sent.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(authUrl.searchParams.has('code_verifier')).toBe(false);
    expect(await mod.pkceChallenge(sent.codeVerifier)).toBe(challenge);
  });

  it('mints a fresh verifier per attempt', async () => {
    const mod = await loadModule();
    mockFetchOnce({ accessToken: 'a' });
    mockFetchOnce({ accessToken: 'b' });
    await mod.connectRepoOAuth('github');
    await mod.connectRepoOAuth('github');
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const v1 = JSON.parse((calls[0][1] as RequestInit).body as string).codeVerifier;
    const v2 = JSON.parse((calls[1][1] as RequestInit).body as string).codeVerifier;
    expect(v1).not.toBe(v2);
  });

  it('completes on iOS in one tap through the native auth session', async () => {
    // ASWebAuthenticationSession returns the oscode:// callback straight back, so
    // there is no bounce-page tap and no deep-link round trip. The default mock
    // echoes the state on the callback like the server does.
    currentPlatform = 'ios';
    const mod = await loadModule();
    mockFetchOnce({ accessToken: 'gho_ios', refreshToken: 'ghr_ios' });
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(true);
    expect(secrets.get(KEY)).toBe('gho_ios');
    expect(secrets.get(`${KEY}.mode`)).toBe('oauth');
    // The authorize URL was handed to the session, and the exchange carried the
    // code from the callback the session returned.
    expect(lastOpenedUrl().searchParams.get('code_challenge_method')).toBe('S256');
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/repo-oauth/exchange');
    expect(JSON.parse((init as RequestInit).body as string).code).toMatch(/^code_github\./);
    // Nothing was left pending after a warm iOS connect.
    expect(secrets.has('oscode.repo.oauth.pending')).toBe(false);
  });

  it('reports "did not finish" when the iOS auth session is cancelled', async () => {
    currentPlatform = 'ios';
    const mod = await loadModule();
    // The plugin rejects with code 'canceled' when the person closes the sheet.
    authSessionStart = async () => {
      throw Object.assign(new Error('Sign-in was cancelled.'), { code: 'canceled' });
    };
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not finish/i);
    expect(secrets.has(KEY)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an iOS callback whose state does not match', async () => {
    currentPlatform = 'ios';
    const mod = await loadModule();
    authSessionStart = async () => ({ url: 'oscode://repo-oauth?code=x&state=forged' });
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/could not be verified/);
    expect(secrets.has(KEY)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a redirect whose state does not match', async () => {
    const mod = await loadModule();
    const { openExternal } = await import('../src/lib/platform.js');
    (openExternal as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      queueMicrotask(() => deepLinkCb?.('oscode://repo-oauth?code=x&state=forged'));
    });
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/could not be verified/);
    expect(secrets.has(KEY)).toBe(false);
  });

  it('surfaces a provider error carried on the redirect', async () => {
    const mod = await loadModule();
    const { openExternal } = await import('../src/lib/platform.js');
    (openExternal as ReturnType<typeof vi.fn>).mockImplementationOnce((url: string) => {
      const state = new URL(url).searchParams.get('state') ?? '';
      queueMicrotask(() => deepLinkCb?.(`oscode://repo-oauth?error=access_denied&state=${state}`));
    });
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cancelled/i);
  });

  it('never renders wire text: an unknown redirect error becomes a fixed sentence', async () => {
    const mod = await loadModule();
    const { openExternal } = await import('../src/lib/platform.js');
    const injected = 'Please <b>reinstall</b> from evil.example';
    (openExternal as ReturnType<typeof vi.fn>).mockImplementationOnce((url: string) => {
      const state = new URL(url).searchParams.get('state') ?? '';
      queueMicrotask(() =>
        deepLinkCb?.(`oscode://repo-oauth?error=${encodeURIComponent(injected)}&state=${state}`),
      );
    });
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toContain('evil.example');
      expect(res.error).toBe('Sign-in failed. Try again.');
    }
  });

  it("maps the function's fixed exchange error to its own sentence, not the wire text", async () => {
    const mod = await loadModule();
    mockFetchOnce({ error: 'exchange_failed' }, false, 502);
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('The provider did not accept the sign-in. Try again.');
    expect(secrets.has(KEY)).toBe(false);
  });

  it('collapses an unexpected function error string to the generic sentence', async () => {
    const mod = await loadModule();
    mockFetchOnce({ error: 'bad_verification_code: the code passed is incorrect' }, false, 502);
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Sign-in failed. Try again.');
  });
});

describe('redirect URI', () => {
  async function loadWithUrl(url: string) {
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'Iv1_testclient');
    vi.resetModules();
    return import('../src/lib/gitos/repoOAuth.js');
  }

  it('exposes the exact Callback URL the authorize call sends', async () => {
    const mod = await loadWithUrl('https://proj.supabase.co');
    expect(mod.repoOAuthCallbackUrl()).toBe(
      'https://proj.supabase.co/functions/v1/repo-oauth/callback',
    );
  });

  it('strips a trailing slash so the redirect_uri never doubles it (GitHub rejects that)', async () => {
    // A trailing slash on the build var used to compose into `host//functions`,
    // which a GitHub App refuses as "redirect_uri is not associated with this
    // application". The exposed Callback URL and the value that actually rides on
    // authorize and exchange are all the single-slash string.
    const mod = await loadWithUrl('https://proj.supabase.co/');
    expect(mod.repoOAuthCallbackUrl()).toBe(
      'https://proj.supabase.co/functions/v1/repo-oauth/callback',
    );

    mockFetchOnce({ accessToken: 'gho_abc' });
    const res = await mod.connectRepoOAuth('github');
    expect(res.ok).toBe(true);
    const authUrl = lastOpenedUrl();
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://proj.supabase.co/functions/v1/repo-oauth/callback',
    );
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/repo-oauth/exchange');
  });

  it('is undefined when the build carries no Supabase URL', async () => {
    const mod = await loadWithUrl('');
    expect(mod.repoOAuthCallbackUrl()).toBeUndefined();
    expect(mod.isRepoOAuthConfigured('github')).toBe(false);
  });
});

describe('resumeRepoOAuthFromLink (cold-start recovery)', () => {
  const PENDING = 'oscode.repo.oauth.pending';

  it('clears the pending record after a warm connect completes', async () => {
    const mod = await loadModule();
    mockFetchOnce({ accessToken: 'gho_abc' });
    await mod.connectRepoOAuth('github');
    expect(secrets.has(PENDING)).toBe(false);
  });

  it('finishes a pending OAuth from a cold-start deep link and stores the tokens', async () => {
    const mod = await loadModule();
    // A prior process persisted the attempt, then iOS evicted the app; the
    // return cold-starts it, so only this record survives.
    secrets.set(
      PENDING,
      JSON.stringify({
        provider: 'github',
        state: 'github.abc',
        codeVerifier: 'verifier123',
        ts: Date.now(),
      }),
    );
    mockFetchOnce({ accessToken: 'gho_resumed', refreshToken: 'ghr_r' });

    const res = await mod.resumeRepoOAuthFromLink(
      'oscode://repo-oauth?code=thecode&state=github.abc',
    );
    expect(res.handled).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.provider).toBe('github');
    expect(secrets.get(KEY)).toBe('gho_resumed');
    expect(secrets.get(`${KEY}.mode`)).toBe('oauth');

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/repo-oauth/exchange');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.code).toBe('thecode');
    expect(sent.codeVerifier).toBe('verifier123');
    // The record is consumed, so a re-delivered launch URL cannot re-run it.
    expect(secrets.has(PENDING)).toBe(false);
  });

  it('does nothing when there is no pending attempt to resume', async () => {
    const mod = await loadModule();
    const res = await mod.resumeRepoOAuthFromLink('oscode://repo-oauth?code=x&state=github.abc');
    expect(res.handled).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses a resume whose state does not match, and still consumes the record', async () => {
    const mod = await loadModule();
    secrets.set(
      PENDING,
      JSON.stringify({
        provider: 'github',
        state: 'github.expected',
        codeVerifier: 'v',
        ts: Date.now(),
      }),
    );
    const res = await mod.resumeRepoOAuthFromLink('oscode://repo-oauth?code=x&state=github.forged');
    expect(res.handled).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be verified/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(secrets.has(PENDING)).toBe(false);
  });

  it('ignores (and clears) a stale pending attempt', async () => {
    const mod = await loadModule();
    secrets.set(
      PENDING,
      JSON.stringify({
        provider: 'github',
        state: 'github.abc',
        codeVerifier: 'v',
        ts: Date.now() - 20 * 60_000,
      }),
    );
    const res = await mod.resumeRepoOAuthFromLink('oscode://repo-oauth?code=x&state=github.abc');
    expect(res.handled).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(secrets.has(PENDING)).toBe(false);
  });

  it('is a silent no-op for a link that is not a repo-oauth return', async () => {
    const mod = await loadModule();
    secrets.set(
      PENDING,
      JSON.stringify({
        provider: 'github',
        state: 'github.abc',
        codeVerifier: 'v',
        ts: Date.now(),
      }),
    );
    const res = await mod.resumeRepoOAuthFromLink('oscode://auth-callback#access_token=zzz');
    expect(res.handled).toBe(false);
    // A different route must not consume a pending repo attempt.
    expect(secrets.has(PENDING)).toBe(true);
  });
});

describe('friendlyError', () => {
  it('has a sentence for every code the function can return', async () => {
    const mod = await loadModule();
    for (const code of [
      'access_denied',
      'no_code',
      'exchange_failed',
      'refresh_failed',
      'provider_error',
      'not_configured',
      'server_error',
      'temporarily_unavailable',
      'invalid_scope',
      'unauthorized_client',
      'invalid_request',
      'unsupported_response_type',
      'unknown_provider',
      'missing_code',
      'missing_refresh',
    ]) {
      const text = mod.friendlyError(code);
      expect(text).not.toContain(code);
      expect(text).toMatch(/[.]$/);
    }
  });
});

describe('repoAccessToken', () => {
  it('returns the cached token when it is not near expiry', async () => {
    const mod = await loadModule();
    secrets.set(KEY, 'gho_live');
    secrets.set(`${KEY}.mode`, 'oauth');
    secrets.set(`${KEY}.expiresAt`, String(Date.now() + 3600_000));
    expect(await mod.repoAccessToken('github')).toBe('gho_live');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refreshes through the function when the token is stale', async () => {
    const mod = await loadModule();
    secrets.set(KEY, 'gho_old');
    secrets.set(`${KEY}.mode`, 'oauth');
    secrets.set(`${KEY}.refresh`, 'ghr_old');
    secrets.set(`${KEY}.expiresAt`, String(Date.now() - 1000));
    mockFetchOnce({
      accessToken: 'gho_new',
      refreshToken: 'ghr_new',
      expiresAt: Date.now() + 3600_000,
    });

    expect(await mod.repoAccessToken('github')).toBe('gho_new');
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/repo-oauth/refresh');
    expect(secrets.get(KEY)).toBe('gho_new');
  });

  it('returns nothing for a platform that was not OAuth-connected', async () => {
    const mod = await loadModule();
    secrets.set(KEY, 'a_pasted_token'); // no mode marker
    expect(await mod.repoAccessToken('github')).toBeUndefined();
  });
});

describe('disconnectRepoOAuth', () => {
  it('forgets the token and all its bookkeeping', async () => {
    const mod = await loadModule();
    secrets.set(KEY, 'gho_abc');
    secrets.set(`${KEY}.mode`, 'oauth');
    secrets.set(`${KEY}.refresh`, 'ghr_xyz');
    secrets.set(`${KEY}.expiresAt`, '123');
    await mod.disconnectRepoOAuth('github');
    expect([...secrets.keys()]).toHaveLength(0);
  });
});
