// Repo OAuth: the confidential half of connecting GitHub, GitLab, or Bitbucket,
// the same shape Claude Code uses. A provider's OAuth client secret is trusted
// on a server, never in the app bundle, so this function holds it and the app
// never sees it. Three tiny routes, no state stored anywhere:
//
//   GET  /callback   The single https redirect URI registered on all three
//                    provider apps. GitHub in particular rejects a custom
//                    scheme here, so the provider lands on this https page,
//                    which does nothing but bounce the short-lived `code` on
//                    into the app over the oscode:// deep link. It reads no
//                    secret and mints no token, exactly like checkout-return.
//   POST /exchange   The app posts the `code` back; THIS is where the secret
//                    is used, turning the code into access/refresh tokens over
//                    TLS. The code is single-use and useless without the
//                    secret, so passing it through the deep link is safe.
//   POST /refresh    Trade a refresh token for a fresh access token, again
//                    using the secret held only here.
//
// verify_jwt is false (config.toml): the provider redirect cannot carry a
// Supabase bearer, and a caller of /exchange must already hold a valid,
// single-use provider code bound to our own app to get anything back.
//
// PKCE (BE-12): the app sends a S256 code_challenge on authorize and the
// matching code_verifier on /exchange, which this function forwards. On the
// desktop another application can register the oscode:// scheme and catch the
// bounced code; without PKCE that code plus this function would mint tokens
// for it. Providers that implement PKCE enforce the pairing; the others ignore
// both parameters, and `state` still guards the redirect either way.
//
// Errors (BE-12): nothing a provider says is echoed to the app. Provider error
// text used to travel through the deep link and /exchange into a toast; both
// paths now map to fixed codes the app translates itself.
import { corsHeaders, json } from '../_shared/cors.ts';

type Provider = 'github' | 'gitlab' | 'bitbucket';

interface ProviderConfig {
  clientId?: string;
  clientSecret?: string;
  tokenUrl: string;
  /** Bitbucket authenticates the client with HTTP Basic, the others in the body. */
  basicAuth: boolean;
}

// The App/consumer/application credentials live in function secrets, set with
// `supabase secrets set` (see os-code/PROGRESS.md). Absent secrets mean the
// provider simply reports "not set up" rather than half-working.
function providerConfig(p: Provider): ProviderConfig {
  switch (p) {
    case 'github':
      return {
        clientId: Deno.env.get('GITHUB_OAUTH_CLIENT_ID'),
        clientSecret: Deno.env.get('GITHUB_OAUTH_CLIENT_SECRET'),
        tokenUrl: 'https://github.com/login/oauth/access_token',
        basicAuth: false,
      };
    case 'gitlab':
      return {
        clientId: Deno.env.get('GITLAB_OAUTH_CLIENT_ID'),
        clientSecret: Deno.env.get('GITLAB_OAUTH_CLIENT_SECRET'),
        tokenUrl: 'https://gitlab.com/oauth/token',
        basicAuth: false,
      };
    case 'bitbucket':
      return {
        clientId: Deno.env.get('BITBUCKET_OAUTH_CLIENT_ID'),
        clientSecret: Deno.env.get('BITBUCKET_OAUTH_CLIENT_SECRET'),
        tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
        basicAuth: true,
      };
  }
}

function isProvider(v: string | null): v is Provider {
  return v === 'github' || v === 'gitlab' || v === 'bitbucket';
}

// The one https redirect URI every provider app registers. Supabase injects
// SUPABASE_URL into every function, so the app (VITE_SUPABASE_URL) and this
// function derive the identical string, which OAuth requires to match between
// the authorize call and the token exchange. Trim any trailing slash so a base
// with one can never compose into a doubled-slash URL that the exchange sends
// while authorize sent the clean one; the app normalizes the same way.
function redirectUri(): string {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
  return `${base}/functions/v1/repo-oauth/callback`;
}

// The app's deep-link landing. A distinct host from auth-callback / checkout so
// the app's deep-link router never confuses the three (useAuthDeepLink.ts).
const APP_REDIRECT = 'oscode://repo-oauth';

function bounce(params: Record<string, string>): Response {
  const url = new URL(APP_REDIRECT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // A tiny page that fires the deep link and offers a manual button, so a
  // browser that blocks the auto-redirect never strands the person.
  const link = url.toString();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connecting to OpenShore</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f6f4ef; color:#1c1b19;
    font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  @media (prefers-color-scheme: dark){ body{ background:#14130f; color:#ece9e2; } }
  .card{ max-width:26rem; padding:2rem 1.5rem; text-align:center; }
  h1{ font-size:1.3rem; margin:0 0 .5rem; }
  p{ margin:0 0 1.25rem; opacity:.85; }
  a.btn{ display:inline-block; padding:.8rem 1.4rem; border-radius:.7rem;
    background:#1c1b19; color:#f6f4ef; text-decoration:none; font-weight:600; }
  @media (prefers-color-scheme: dark){ a.btn{ background:#ece9e2; color:#14130f; } }
</style></head>
<body><div class="card">
  <h1>Returning to OpenShore</h1>
  <p>You can close this window if it does not switch back on its own.</p>
  <a class="btn" href="${link}">Back to OpenShore</a>
</div>
<script>try{ window.location.href=${JSON.stringify(link)}; }catch(e){}</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

// The only error strings this function ever returns to the app. Anything a
// provider says is logged here and replaced by one of these.
const FIXED_ERRORS = new Set([
  'access_denied',
  'invalid_request',
  'unauthorized_client',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  'no_code',
  'provider_error',
  'exchange_failed',
  'refresh_failed',
]);

/** Map a provider's `error` query value to a fixed code. Standard OAuth codes
 *  pass through by name (they carry no free text); everything else collapses
 *  to provider_error. */
function fixedProviderError(raw: string | null): string {
  return raw && FIXED_ERRORS.has(raw) ? raw : 'provider_error';
}

class TokenError extends Error {
  constructor(public readonly code: 'exchange_failed' | 'refresh_failed') {
    super(code);
  }
}

async function callTokenEndpoint(
  cfg: ProviderConfig,
  form: Record<string, string>,
): Promise<TokenResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  };
  const body = new URLSearchParams(form);
  if (cfg.basicAuth) {
    headers.authorization = `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`;
  } else {
    body.set('client_id', cfg.clientId ?? '');
    body.set('client_secret', cfg.clientSecret ?? '');
  }
  const res = await fetch(cfg.tokenUrl, { method: 'POST', headers, body: body.toString() });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    // The provider's words go to the function log only; the caller gets a
    // fixed code (see FIXED_ERRORS).
    console.warn('repo-oauth token endpoint refused', {
      status: res.status,
      error: data.error ?? null,
      description: data.error_description ?? null,
    });
    throw new TokenError(
      form.grant_type === 'refresh_token' ? 'refresh_failed' : 'exchange_failed',
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  // --- GET /callback: bounce the provider's code into the app, no secret used.
  if (path.endsWith('/callback')) {
    // Only the provider's error CODE travels on, mapped to a fixed set; the
    // free-text error_description stays here (it would otherwise be rendered
    // into a toast verbatim).
    const err = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? '';
    if (err) return bounce({ state, error: fixedProviderError(err) });
    if (!code) return bounce({ state, error: 'no_code' });
    return bounce({ state, code });
  }

  // --- POST /exchange and /refresh: the secret is used here, over TLS only.
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, req);
  }

  const payload = (await req.json().catch(() => ({}))) as {
    provider?: string;
    code?: string;
    /** PKCE verifier (camelCase like the rest of this API; snake_case accepted). */
    codeVerifier?: string;
    code_verifier?: string;
    refreshToken?: string;
  };
  if (!isProvider(payload.provider ?? null)) {
    return json({ error: 'unknown_provider' }, 400, req);
  }
  const provider = payload.provider as Provider;
  const cfg = providerConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret) {
    return json({ error: 'not_configured' }, 501, req);
  }

  try {
    if (path.endsWith('/exchange')) {
      if (!payload.code) return json({ error: 'missing_code' }, 400, req);
      const form: Record<string, string> = {
        grant_type: 'authorization_code',
        code: payload.code,
        redirect_uri: redirectUri(),
      };
      const verifier = payload.codeVerifier ?? payload.code_verifier;
      if (typeof verifier === 'string' && verifier) form.code_verifier = verifier;
      const tokens = await callTokenEndpoint(cfg, form);
      return json(tokens, 200, req);
    }
    if (path.endsWith('/refresh')) {
      if (!payload.refreshToken) return json({ error: 'missing_refresh' }, 400, req);
      const tokens = await callTokenEndpoint(cfg, {
        grant_type: 'refresh_token',
        refresh_token: payload.refreshToken,
      });
      return json(tokens, 200, req);
    }
    return json({ error: 'not_found' }, 404, req);
  } catch (e) {
    // A network failure reaching the provider and a refusal both surface as a
    // fixed code; the detail is in the log.
    const code = e instanceof TokenError ? e.code : 'provider_error';
    if (!(e instanceof TokenError)) console.error('repo-oauth upstream error', e);
    return json({ error: code }, 502, req);
  }
});
