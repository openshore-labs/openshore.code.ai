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
// The iOS deep-link and browser-dismiss callbacks the module registers, so a
// test can drive the iOS path (Capacitor App appUrlOpen, Browser browserFinished).
let iosUrlOpenCb: ((e: { url: string }) => void) | undefined;
let browserFinishedCb: (() => void) | undefined;
// Every authorize URL the module opens, so a test can inspect it.
const opened: string[] = [];

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

vi.mock('@capacitor/browser', () => ({
  Browser: {
    // On iOS the authorize URL opens here (not through openExternal), so record
    // it into the same `opened` list the desktop path uses, for lastOpenedUrl().
    open: vi.fn(async (opts: { url: string }) => {
      opened.push(opts.url);
    }),
    close: vi.fn(async () => {}),
    // The module listens for the in-app browser being dismissed so a bailed
    // sign-in resets instead of hanging. Capture the handler for the test.
    addListener: vi.fn(async (_event: string, cb: () => void) => {
      browserFinishedCb = cb;
      return {
        remove: () => {
          browserFinishedCb = undefined;
        },
      };
    }),
  },
}));

// The iOS deep-link bus. Dynamically imported by the module, so vi.mock still
// intercepts it. Capture the appUrlOpen handler so a test can drive it.
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, cb: (e: { url: string }) => void) => {
      iosUrlOpenCb = cb;
      return {
        remove: () => {
          iosUrlOpenCb = undefined;
        },
      };
    }),
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
  iosUrlOpenCb = undefined;
  browserFinishedCb = undefined;
  opened.length = 0;
  vi.unstubAllEnvs();
  globalThis.fetch = vi.fn();
});

/** Wait until a condition holds, letting the module's async listener setup
 *  (the dynamic import of @capacitor/app plus the awaited addListener calls)
 *  settle. Polls on the macrotask queue so a real dynamic import resolves. */
async function waitFor(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
}

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

  it('resets instead of hanging when the iOS in-app browser is closed without finishing', async () => {
    // The founder's report: the provider showed an error page, they tapped Done,
    // and the button stayed on "Connecting..." No deep link arrives on a bailed
    // sign-in, so the dismissal must end the flow. Drive the iOS path directly.
    currentPlatform = 'ios';
    const mod = await loadModule();
    const pending = mod.connectRepoOAuth('github');
    await waitFor(() => typeof browserFinishedCb === 'function');
    expect(browserFinishedCb, 'browserFinished listener was not registered').toBeTypeOf('function');

    // The person closes the in-app browser; no oscode:// deep link ever fires.
    browserFinishedCb!();
    const res = await pending;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not finish/i);
    expect(secrets.has(KEY)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('still completes on iOS when the deep link arrives after the browser opens', async () => {
    // The success path must survive the new dismiss listener: a real return
    // resolves with the code, and our own Browser.close() firing browserFinished
    // afterward is a no-op because the flow has already settled.
    currentPlatform = 'ios';
    const mod = await loadModule();
    mockFetchOnce({ accessToken: 'gho_ok' });
    const pending = mod.connectRepoOAuth('github');
    await waitFor(() => typeof iosUrlOpenCb === 'function');
    const state = lastOpenedUrl().searchParams.get('state') ?? '';
    iosUrlOpenCb!({ url: `oscode://repo-oauth?code=code_${state}&state=${state}` });
    // A late dismissal (our Browser.close, or the person) must not un-settle it.
    browserFinishedCb?.();
    const res = await pending;
    expect(res.ok).toBe(true);
    expect(secrets.get(KEY)).toBe('gho_ok');
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
