// Google Drive OAuth: the first real OAuth flow in this app (every other
// cloud connection is paste-an-API-key, see ../providers.ts). PKCE end to
// end, per Google's native-app rules. Two OAuth clients are required by
// Google's own platform rules, not a choice: an "iOS" client for the phone,
// redirected back through the app's own oscode:// scheme on a path distinct
// from the Supabase auth callback, and a "Desktop app" client for Electron,
// redirected through a loopback server the main process opens for exactly
// one request (electron/main.ts, osc:gdriveOAuth*). Neither client secret is
// confidential for a public PKCE client (RFC 8252); the desktop secret
// Google still issues ships as a build constant here, never through
// secretSet, because it is not per-user data.
//
// Scope is drive.file only (CFO ruling, os-code/DECISIONS.md): the app can
// only see files and folders it creates itself, never the user's whole
// Drive. gdrive.ts's blurb discloses the corollary (files added outside
// OpenShore may not appear) per the founder's call on that decision point.
import { Browser } from '@capacitor/browser';
import { platform, openExternal, secretGet, secretSet, secretDelete } from '../platform.js';
import { bridge } from '../electronBridge.js';

const IOS_CLIENT_ID = import.meta.env.VITE_GDRIVE_IOS_CLIENT_ID as string | undefined;
const DESKTOP_CLIENT_ID = import.meta.env.VITE_GDRIVE_DESKTOP_CLIENT_ID as string | undefined;
const DESKTOP_CLIENT_SECRET = import.meta.env.VITE_GDRIVE_DESKTOP_CLIENT_SECRET as
  | string
  | undefined;

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
// Distinct from oscode://auth-callback (useAuthDeepLink.ts), so the two
// appUrlOpen listeners never compete over the same redirect.
const IOS_REDIRECT = 'oscode://oauth2redirect';

const ACCESS_KEY = 'oscode.secret.gdrive.access';
const REFRESH_KEY = 'oscode.secret.gdrive.refresh';
const EXPIRY_KEY = 'oscode.secret.gdrive.expiresAt';

/** Whether this build has the OAuth client id(s) for the current platform. */
export function isGdriveConfigured(): boolean {
  const p = platform();
  if (p === 'ios') return Boolean(IOS_CLIENT_ID);
  if (p === 'electron') return Boolean(DESKTOP_CLIENT_ID && DESKTOP_CLIENT_SECRET);
  return false;
}

/** Whether a Google account is connected right now (a refresh token exists). */
export async function isGdriveConnected(): Promise<boolean> {
  return Boolean(await secretGet(REFRESH_KEY));
}

// ------------------------------------------------------------------- PKCE

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes = 32): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toB64Url(new Uint8Array(digest));
}

function googleErrorMessage(code: string): string {
  if (code === 'access_denied') return 'Sign-in was cancelled.';
  if (code === 'disallowed_useragent') return 'Google blocked this sign-in window. Try again.';
  return `Google sign-in failed (${code}).`;
}

function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  // Forces a refresh token on every connect, not just the first ever grant.
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

interface RedirectResult {
  code: string;
  state: string;
}

async function awaitIosRedirect(): Promise<RedirectResult> {
  const { App } = await import('@capacitor/app');
  return new Promise<RedirectResult>((resolve, reject) => {
    let settled = false;
    let remove: (() => void) | undefined;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      remove?.();
      void Browser.close().catch(() => {});
      reject(new Error('Sign-in timed out.'));
    }, 300_000);

    void App.addListener('appUrlOpen', (e) => {
      if (settled || !e.url.includes('oauth2redirect')) return;
      let url: URL;
      try {
        url = new URL(e.url);
      } catch {
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      settled = true;
      clearTimeout(timeout);
      remove?.();
      void Browser.close().catch(() => {});
      if (error) reject(new Error(googleErrorMessage(error)));
      else if (code && state) resolve({ code, state });
      else reject(new Error('The sign-in response was missing required data.'));
    }).then((listener) => {
      remove = () => void listener.remove();
      if (settled) remove();
    });
  });
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

async function exchangeCode(opts: {
  clientId: string;
  clientSecret: string | undefined;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: opts.verifier,
  });
  if (opts.clientSecret) body.set('client_secret', opts.clientSecret);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(googleErrorMessage(json.error_description ?? json.error ?? String(res.status)));
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

async function storeTokens(tokens: TokenSet): Promise<void> {
  await secretSet(ACCESS_KEY, tokens.accessToken);
  await secretSet(EXPIRY_KEY, String(tokens.expiresAt));
  if (tokens.refreshToken) await secretSet(REFRESH_KEY, tokens.refreshToken);
}

/** Run the full connect flow: consent screen, redirect capture, code
 *  exchange, token storage. Never throws; failures come back as {ok:false}
 *  so the caller can show a toast instead of an unhandled rejection. */
export async function connectGdrive(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isGdriveConfigured()) {
    return { ok: false, error: 'Google Drive is not set up on this build yet.' };
  }
  const p = platform();
  const verifier = randomToken();
  const challenge = await codeChallenge(verifier);
  const state = randomToken(16);

  try {
    let redirect: RedirectResult;
    let redirectUri: string;
    let clientId: string;

    if (p === 'ios') {
      clientId = IOS_CLIENT_ID!;
      redirectUri = IOS_REDIRECT;
      const authUrl = buildAuthUrl({ clientId, redirectUri, state, challenge });
      const waiting = awaitIosRedirect();
      await Browser.open({ url: authUrl });
      redirect = await waiting;
    } else if (p === 'electron') {
      const b = bridge();
      if (!b) throw new Error('The desktop bridge is not available in this shell.');
      clientId = DESKTOP_CLIENT_ID!;
      const { port } = await b.gdriveOAuthListen();
      redirectUri = `http://127.0.0.1:${port}/oauth2redirect`;
      const authUrl = buildAuthUrl({ clientId, redirectUri, state, challenge });
      openExternal(authUrl);
      const result = await b.gdriveOAuthWait();
      if ('error' in result) throw new Error(googleErrorMessage(result.error));
      redirect = result;
    } else {
      throw new Error('Google Drive sign-in needs the iPhone app or the desktop app.');
    }

    if (redirect.state !== state) {
      throw new Error('The sign-in response could not be verified.');
    }

    const tokens = await exchangeCode({
      clientId,
      clientSecret: p === 'electron' ? DESKTOP_CLIENT_SECRET : undefined,
      code: redirect.code,
      redirectUri,
      verifier,
    });
    await storeTokens(tokens);
    return { ok: true };
  } catch (err) {
    if (p === 'electron') void bridge()?.gdriveOAuthCancel();
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A valid access token, refreshing first if the cached one is stale or
 *  near expiry. Undefined when not connected, unconfigured, or the refresh
 *  itself fails (a network blip, a revoked grant). */
export async function gdriveAccessToken(): Promise<string | undefined> {
  const [access, expiresAtRaw, refresh] = await Promise.all([
    secretGet(ACCESS_KEY),
    secretGet(EXPIRY_KEY),
    secretGet(REFRESH_KEY),
  ]);
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : 0;
  if (access && expiresAt - Date.now() > 60_000) return access;
  if (!refresh || !isGdriveConfigured()) return undefined;

  try {
    const p = platform();
    const clientId = p === 'ios' ? IOS_CLIENT_ID! : DESKTOP_CLIENT_ID!;
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    });
    if (p === 'electron' && DESKTOP_CLIENT_SECRET) body.set('client_secret', DESKTOP_CLIENT_SECRET);
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      // A revoked grant or an expired refresh token (invalid_grant) is
      // permanent: clear the stored tokens so isGdriveConnected() reports the
      // truth and the UI prompts a reconnect, instead of showing Drive as
      // healthy while every call fails. A transient network error keeps them.
      if (json.error === 'invalid_grant') {
        await Promise.all([
          secretDelete(ACCESS_KEY),
          secretDelete(REFRESH_KEY),
          secretDelete(EXPIRY_KEY),
        ]);
      }
      return undefined;
    }
    const next: TokenSet = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    await storeTokens(next);
    return next.accessToken;
  } catch {
    return undefined;
  }
}

/** Revoke at Google first, then forget the tokens locally, so a device
 *  backup or an already-copied Keychain entry cannot keep using them. */
export async function disconnectGdrive(): Promise<void> {
  const [access, refresh] = await Promise.all([secretGet(ACCESS_KEY), secretGet(REFRESH_KEY)]);
  const token = refresh ?? access;
  if (token) {
    try {
      // The token goes in the POST body, never the URL query, so it cannot land
      // in a proxy or server access log.
      await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(token)}`,
      });
    } catch {
      // Best-effort: the local tokens are cleared below regardless, so this
      // device stops using them even if the revoke call itself is offline.
    }
  }
  await Promise.all([
    secretDelete(ACCESS_KEY),
    secretDelete(REFRESH_KEY),
    secretDelete(EXPIRY_KEY),
  ]);
}
