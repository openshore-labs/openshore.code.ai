// Repo OAuth on the app side: connect GitHub, GitLab, or Bitbucket with a tap,
// the same way Claude Code does, instead of pasting a token. The provider's
// client secret is never here; the repo-oauth edge function holds it (see
// supabase/functions/repo-oauth/index.ts). This file only ever handles the
// public client id, a short-lived authorization `code`, and the resulting
// tokens, which land in the device Keychain exactly where the paste path put
// the personal access token, so everything downstream reads one key either way.
//
// The flow, uniform across iPhone and desktop:
//   1. Open the provider's consent page (an in-app browser sheet on the phone,
//      the system browser on desktop).
//   2. The provider redirects to the function's https /callback, which bounces
//      the `code` back into the app over the oscode://repo-oauth deep link.
//      GitHub rejects a custom scheme as its own redirect URI, so the https
//      landing is required, not a nicety.
//   3. The app posts the code to /exchange; the function trades it for tokens
//      using the secret, over TLS, and hands them back.
//
// PKCE on top of the server-side secret (BE-12): on the desktop another
// application can register the oscode:// scheme and catch the bounced code,
// and the exchange function would happily trade that code for tokens. So the
// app mints a code_verifier per attempt, sends its S256 challenge on
// authorize, and sends the verifier only to /exchange, which forwards it.
// Providers that implement PKCE bind the code to this app instance; the rest
// ignore the parameters. `state` still guards against a forged redirect.
import { Browser } from '@capacitor/browser';
import { platform, openExternal, secretGet, secretSet, secretDelete } from '../platform.js';
import { bridge } from '../electronBridge.js';
import { repoSecretKey, type RepoPlatform } from '../repos.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

interface OAuthProviderConfig {
  clientId?: string;
  authorizeUrl: string;
  /** Space-separated scopes, or undefined when the provider scopes on its app. */
  scope?: string;
  /** Provider-specific extra authorize params (e.g. GitLab response_type). */
  extraAuthParams?: Record<string, string>;
}

// Only the PUBLIC client id lives here (Vite build-time env). The secret is on
// the server. GitLab and Bitbucket scope on the authorize call; a GitHub App
// scopes through its configured permissions, so it needs no scope param.
const OAUTH: Record<RepoPlatform, OAuthProviderConfig> = {
  github: {
    clientId: import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined,
    authorizeUrl: 'https://github.com/login/oauth/authorize',
  },
  gitlab: {
    clientId: import.meta.env.VITE_GITLAB_CLIENT_ID as string | undefined,
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    scope: 'read_api read_repository write_repository',
    extraAuthParams: { response_type: 'code' },
  },
  bitbucket: {
    clientId: import.meta.env.VITE_BITBUCKET_CLIENT_ID as string | undefined,
    authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize',
    extraAuthParams: { response_type: 'code' },
  },
};

// Distinct deep-link host from auth-callback and checkout-success, so the app's
// deep-link router (useAuthDeepLink.ts) never confuses repo OAuth with sign-in.
const APP_REDIRECT_HOST = 'repo-oauth';

function functionBase(): string | undefined {
  return SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/repo-oauth` : undefined;
}

/** The one https redirect URI registered on every provider app. Must match the
 *  string the function derives from its injected SUPABASE_URL, byte for byte. */
function redirectUri(): string | undefined {
  const base = functionBase();
  return base ? `${base}/callback` : undefined;
}

/** Whether one-tap OAuth is available for this provider on this build: a public
 *  client id AND the Supabase project that hosts the exchange function. */
export function isRepoOAuthConfigured(id: RepoPlatform): boolean {
  return Boolean(OAUTH[id].clientId && SUPABASE_URL);
}

// Token storage. The access token reuses repoSecretKey(id) so the connected
// badge and any future token reader see a working credential whether it came
// from OAuth or a pasted token. The rest of the OAuth bookkeeping hangs off it.
const refreshKey = (id: RepoPlatform) => `${repoSecretKey(id)}.refresh`;
const expiryKey = (id: RepoPlatform) => `${repoSecretKey(id)}.expiresAt`;
const modeKey = (id: RepoPlatform) => `${repoSecretKey(id)}.mode`;

/** Whether this platform is connected via OAuth (vs a pasted token), which
 *  decides whether tokens can be refreshed and should be forgotten on remove. */
export async function isRepoOAuthConnected(id: RepoPlatform): Promise<boolean> {
  return (await secretGet(modeKey(id))) === 'oauth';
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes = 24): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The S256 PKCE challenge for a verifier: base64url(sha256(verifier)).
 *  Exported so the test can check the pairing the app sends. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

interface RedirectResult {
  code?: string;
  state: string;
  error?: string;
}

// Wait for the function's bounce to arrive as an oscode://repo-oauth deep link.
// Uniform across platforms via the buses the app already uses: appUrlOpen on
// iOS, the Electron main process forward on desktop. Resolves once, then tears
// its listeners down; a five-minute cap so a bailed sign-in never hangs.
function awaitRedirect(): Promise<RedirectResult> {
  return new Promise<RedirectResult>((resolve, reject) => {
    let settled = false;
    const removers: Array<() => void> = [];
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const r of removers) r();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Sign-in timed out.'))), 300_000);

    const handle = (raw: string | undefined | null) => {
      if (!raw) return;
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        return;
      }
      if (u.protocol !== 'oscode:') return;
      const host = (u.hostname || u.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
      if (host !== APP_REDIRECT_HOST) return;
      const p = u.searchParams;
      finish(() => {
        void Browser.close().catch(() => {});
        resolve({
          code: p.get('code') ?? undefined,
          state: p.get('state') ?? '',
          error: p.get('error') ?? undefined,
        });
      });
    };

    if (platform() === 'ios') {
      void (async () => {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('appUrlOpen', (e) => handle(e.url));
        if (settled) void listener.remove();
        else removers.push(() => void listener.remove());
      })();
    } else {
      const b = bridge();
      if (b) removers.push(b.onDeepLink((url) => handle(url)));
      else finish(() => reject(new Error('Repo sign-in needs the phone or desktop app.')));
    }
  });
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

async function postFunction(route: string, body: unknown): Promise<TokenSet> {
  const base = functionBase();
  if (!base) throw new Error('Sign-in is not configured on this build.');
  const res = await fetch(`${base}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
  };
  if (!res.ok || !data.accessToken) {
    // The function only ever returns fixed error codes (never provider text);
    // translate them here so nothing from the wire reaches a toast verbatim.
    throw new Error(data.error ? friendlyError(data.error) : `Sign-in failed (${res.status}).`);
  }
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
  };
}

async function storeTokens(id: RepoPlatform, tokens: TokenSet): Promise<void> {
  await secretSet(repoSecretKey(id), tokens.accessToken);
  await secretSet(modeKey(id), 'oauth');
  if (tokens.refreshToken) await secretSet(refreshKey(id), tokens.refreshToken);
  if (tokens.expiresAt) await secretSet(expiryKey(id), String(tokens.expiresAt));
}

/** Run the full connect flow. Never throws: a failure comes back as
 *  {ok:false} so the caller shows a toast, not an unhandled rejection. */
export async function connectRepoOAuth(
  id: RepoPlatform,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = OAUTH[id];
  const redirect = redirectUri();
  if (!cfg.clientId || !redirect) {
    return { ok: false, error: 'One-tap sign-in is not set up on this build yet.' };
  }
  if (platform() !== 'ios' && platform() !== 'electron') {
    return { ok: false, error: 'Repo sign-in needs the iPhone app or the desktop app.' };
  }

  const state = `${id}.${randomToken(16)}`;
  // PKCE: 32 random bytes gives a 43-character base64url verifier, inside the
  // 43..128 range RFC 7636 requires. A fresh one per attempt; never stored.
  const codeVerifier = randomToken(32);
  const authUrl = new URL(cfg.authorizeUrl);
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', redirect);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', await pkceChallenge(codeVerifier));
  authUrl.searchParams.set('code_challenge_method', 'S256');
  if (cfg.scope) authUrl.searchParams.set('scope', cfg.scope);
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) authUrl.searchParams.set(k, v);

  try {
    const waiting = awaitRedirect();
    if (platform() === 'ios') await Browser.open({ url: authUrl.toString() });
    else openExternal(authUrl.toString());
    const result = await waiting;

    if (result.state !== state) throw new Error('The sign-in response could not be verified.');
    if (result.error) throw new Error(friendlyError(result.error));
    if (!result.code) throw new Error('The sign-in response was missing its code.');

    const tokens = await postFunction('exchange', {
      provider: id,
      code: result.code,
      codeVerifier,
    });
    await storeTokens(id, tokens);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// The fixed error codes the function and the deep link can carry, each with
// its own sentence. Anything unrecognized gets a generic line and never its
// own text: the wire is not trusted to write copy.
const FRIENDLY: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  no_code: 'The provider did not return a sign-in code.',
  exchange_failed: 'The provider did not accept the sign-in. Try again.',
  refresh_failed: 'The provider did not renew the sign-in. Connect again.',
  provider_error: 'The provider reported a problem. Try again in a moment.',
  server_error: 'The provider reported a problem. Try again in a moment.',
  temporarily_unavailable: 'The provider is busy right now. Try again in a moment.',
  not_configured: 'One-tap sign-in is not set up on this server yet.',
  invalid_scope: 'This app asked for access the provider does not allow.',
  unauthorized_client: 'This app is not authorized with the provider.',
  invalid_request: 'The sign-in request was malformed. Update the app and try again.',
  unsupported_response_type: 'The sign-in request was malformed. Update the app and try again.',
  unknown_provider: 'That provider is not supported.',
  missing_code: 'The sign-in response was missing its code.',
  missing_refresh: 'There is no saved sign-in to renew. Connect again.',
};

export function friendlyError(code: string): string {
  return FRIENDLY[code] ?? 'Sign-in failed. Try again.';
}

/** A valid access token, refreshing through the function first if the cached
 *  one is near expiry. Undefined when not OAuth-connected or a refresh fails
 *  (a revoked grant, a network blip). Tokens that never expire (a classic
 *  GitHub App user token) are returned as is. */
export async function repoAccessToken(id: RepoPlatform): Promise<string | undefined> {
  if (!(await isRepoOAuthConnected(id))) return undefined;
  const [access, expiryRaw, refresh] = await Promise.all([
    secretGet(repoSecretKey(id)),
    secretGet(expiryKey(id)),
    secretGet(refreshKey(id)),
  ]);
  const expiresAt = expiryRaw ? Number(expiryRaw) : 0;
  if (access && (!expiresAt || expiresAt - Date.now() > 60_000)) return access;
  if (!refresh) return access ?? undefined;

  try {
    const tokens = await postFunction('refresh', { provider: id, refreshToken: refresh });
    await storeTokens(id, tokens);
    return tokens.accessToken;
  } catch {
    return access ?? undefined;
  }
}

/** Forget the OAuth tokens for a platform. The provider grant itself is revoked
 *  from the provider's own settings; there is no server secret on the device to
 *  revoke with, so this clears the local credential and its bookkeeping. */
export async function disconnectRepoOAuth(id: RepoPlatform): Promise<void> {
  await Promise.all([
    secretDelete(repoSecretKey(id)),
    secretDelete(refreshKey(id)),
    secretDelete(expiryKey(id)),
    secretDelete(modeKey(id)),
  ]);
}
