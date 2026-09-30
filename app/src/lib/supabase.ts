// A thin Supabase auth + data client over fetch. No SDK dependency, so it stays
// light in the WebView, and Supabase (GoTrue + PostgREST) already sends CORS
// headers, so plain fetch works from capacitor://localhost and Electron. When
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are unset, isConfigured() is false
// and the whole auth surface no-ops: OpenShore runs local-first exactly as before.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON);
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry, ms since epoch. */
  expiresAt: number;
  user: { id: string; email?: string };
}

interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
}

function toSession(g: GoTrueSession): Session {
  return {
    accessToken: g.access_token,
    refreshToken: g.refresh_token,
    expiresAt: Date.now() + g.expires_in * 1000,
    user: { id: g.user.id, email: g.user.email },
  };
}

/** A Supabase request that came back with an HTTP error, carrying the status
 *  so a caller can tell "this session is dead" (a 400 or 401 on the refresh)
 *  from a transient failure that should leave the session alone. */
export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The fixed refusal code an Edge Function sent (`{ error: 'owns_org' }`),
     *  when it sent one. */
    // From PostgREST (`rpc`, `select`) it is the SQLSTATE a function raised
    // (OV402 and OV403 for the team vault, migration 0025; 23514 for 0023's
    // free caps) or PostgREST's own (PGRST202), when the body names one.
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SupabaseRequestError';
  }
}

function base(): string {
  if (!SUPABASE_URL) throw new Error('Sign-in is not configured on this build.');
  return SUPABASE_URL;
}

function authHeaders(accessToken?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    apikey: SUPABASE_ANON ?? '',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error_description?: string;
      msg?: string;
      message?: string;
    };
    return body.error_description ?? body.msg ?? body.message ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

/** A PostgREST failure as a SupabaseRequestError, with its `code` when the
 *  body names one. */
async function requestError(res: Response): Promise<SupabaseRequestError> {
  let body: { error_description?: string; msg?: string; message?: string; code?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // No JSON body: the status says it.
  }
  const message =
    body.error_description ?? body.msg ?? body.message ?? `Request failed (${res.status}).`;
  return new SupabaseRequestError(
    message,
    res.status,
    typeof body.code === 'string' ? body.code : undefined,
  );
}

/** Email + password sign-in. */
export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const res = await fetch(`${base()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return toSession((await res.json()) as GoTrueSession);
}

/** Create an account with email + password. Returns a session when the project
 *  does not require email confirmation, otherwise null (confirm, then sign in).
 *  redirectTo is where the confirmation link returns; passing the app's own
 *  deep-link origin means the link lands back in the app, not on a generic
 *  dashboard page. */
export async function signUp(
  email: string,
  password: string,
  redirectTo?: string,
): Promise<Session | null> {
  const url = redirectTo
    ? `${base()}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`
    : `${base()}/auth/v1/signup`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as Partial<GoTrueSession>;
  return body.access_token ? toSession(body as GoTrueSession) : null;
}

/** Send a password-reset email. The link returns to redirectTo with a recovery
 *  session in the URL, which the callback signs in so the user can set a new
 *  password (see updatePassword). */
export async function sendPasswordReset(email: string, redirectTo: string): Promise<void> {
  const res = await fetch(
    `${base()}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
}

/** Set a new password for the signed-in user (used to finish a recovery, or to
 *  change a password while signed in). */
export async function updatePassword(accessToken: string, password: string): Promise<void> {
  const res = await fetch(`${base()}/auth/v1/user`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Resend the sign-up confirmation email, for a link that was lost or expired. */
export async function resendConfirmation(email: string, redirectTo: string): Promise<void> {
  const res = await fetch(
    `${base()}/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type: 'signup', email }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
}

/** Send a magic-link / OTP email. The link returns to redirectTo (the app's own
 *  deep-link origin), where handleAuthCallback parses the tokens. */
export async function signInWithOtp(email: string, redirectTo: string): Promise<void> {
  const res = await fetch(`${base()}/auth/v1/otp`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, create_user: true, options: { email_redirect_to: redirectTo } }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Exchange a refresh token for a fresh session. */
export async function refreshSession(refreshToken: string): Promise<Session> {
  const res = await fetch(`${base()}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new SupabaseRequestError(await readError(res), res.status);
  return toSession((await res.json()) as GoTrueSession);
}

/** Where a sign-out reaches: 'local' ends this device's sign-in only, and
 *  'global' ends it on every device. */
export type SignOutScope = 'local' | 'global';

/** End a sign-in on the server. The scope is always named, since GoTrue's own
 *  default is global, which would sign out the person's other devices too.
 *  Throws when the server did not confirm, so the caller can tell "done" from
 *  "nothing changed". */
export async function signOut(accessToken: string, scope: SignOutScope): Promise<void> {
  const res = await fetch(`${base()}/auth/v1/logout?scope=${scope}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new SupabaseRequestError(await readError(res), res.status);
}

/** Parse the tokens a magic-link callback URL carries (hash or query). */
export function parseAuthCallback(url: string): Session | null {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.search);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const expires_in = Number(params.get('expires_in') ?? '3600');
    if (!access_token || !refresh_token) return null;
    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
      user: { id: '', email: undefined }, // filled by getUser after the callback
    };
  } catch {
    return null;
  }
}

/** The GoTrue link type a callback URL carries ('recovery', 'signup', ...), so
 *  a recovery link can be told apart from an ordinary sign-in. */
export function authCallbackType(url: string): string | null {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.search);
    return params.get('type');
  } catch {
    return null;
  }
}

/** The signed-in user (used to fill id/email after a magic-link callback). */
export async function getUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${base()}/auth/v1/user`, { headers: authHeaders(accessToken) });
  if (!res.ok) return null;
  const u = (await res.json()) as { id: string; email?: string };
  return { id: u.id, email: u.email };
}

/** What the auth server says about an access token's account, asked once:
 *  'here' (the account and this sign-in are live), 'gone' (the token names an
 *  account that no longer exists), or 'invalid' (the sign-in itself is dead:
 *  its session was ended, here or everywhere). GoTrue (checked on the local
 *  stack's gotrue v2.197.0) answers a deleted account with 403 and error_code
 *  `user_not_found`, and looks the account up before the session, so only
 *  that code means gone; a live account whose session was ended gets 403
 *  `session_not_found`, and only that code means the sign-in is dead.
 *  Anything else throws, because nothing here can tell: offline, a server
 *  error, `bad_jwt` (a token it could not read, which says nothing about the
 *  account or the session), or a 401 or 403 with no GoTrue code at all (a
 *  gateway or proxy in the way). A caller must never sign the device out on
 *  a throw. */
export type AuthUserState = 'here' | 'gone' | 'invalid';

export async function authUserState(accessToken: string): Promise<AuthUserState> {
  const res = await fetch(`${base()}/auth/v1/user`, { headers: authHeaders(accessToken) });
  if (res.ok) return 'here';
  let code: unknown = res.headers.get('x-sb-error-code');
  try {
    const body = (await res.json()) as { error_code?: unknown } | null;
    code = body?.error_code ?? code;
  } catch {
    // Not JSON: the header, if any, is all there is.
  }
  if (code === 'user_not_found') return 'gone';
  if (code === 'session_not_found') return 'invalid';
  throw new SupabaseRequestError(
    `Request failed (${res.status}).`,
    res.status,
    typeof code === 'string' && code ? code : undefined,
  );
}

/** The preferences that follow a signed-in person (lib/settingsReach.ts) ride
 *  on the account's own user record, under one key, so they need no table of
 *  their own. What is written is only the allowlisted preferences and when
 *  they changed; the settings blob never leaves the device. */
const PREFS_KEY = 'oscode_prefs';

/** The account's copy of the preferences, raw (settingsReach reads it). */
export async function readUserPrefs(accessToken: string): Promise<unknown> {
  const res = await fetch(`${base()}/auth/v1/user`, { headers: authHeaders(accessToken) });
  if (!res.ok) throw new SupabaseRequestError(await readError(res), res.status);
  const u = (await res.json()) as { user_metadata?: Record<string, unknown> };
  return u.user_metadata?.[PREFS_KEY];
}

/** Replace the account's copy of the preferences. */
export async function writeUserPrefs(accessToken: string, record: unknown): Promise<void> {
  const res = await fetch(`${base()}/auth/v1/user`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ data: { [PREFS_KEY]: record } }),
  });
  if (!res.ok) throw new SupabaseRequestError(await readError(res), res.status);
}

/** Call a Postgres RPC (SECURITY DEFINER function) as the signed-in user. */
export async function rpc<T>(
  fn: string,
  accessToken: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${base()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(args),
  });
  // The status rides along so a caller can tell a refusal (a raised P0001
  // arrives as a 400) from a failure worth retrying.
  if (!res.ok) throw await requestError(res);
  return readRpcBody<T>(res);
}

/** An RPC's answer. PostgREST answers a function that returns void with 204
 *  and no body (postgrest v16.3, the CLI's pinned image), and `res.json()` on
 *  an empty body throws, so a call that worked would read as a failure. No
 *  body is no value. */
async function readRpcBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A minimal PostgREST select. Pass a query string like "select=*&org_id=eq.123". */
export async function select<T>(table: string, accessToken: string, query: string): Promise<T[]> {
  const res = await fetch(`${base()}/rest/v1/${table}?${query}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw await requestError(res);
  return (await res.json()) as T[];
}

/** A PostgREST select as the ANON role (no session), for public-read tables
 *  whose RLS grants anon. When a token is present it is used, so a signed-in
 *  reader still gets their own row-level view (e.g. their blocks applied). */
export async function selectPublic<T>(
  table: string,
  query: string,
  accessToken?: string,
): Promise<T[]> {
  const res = await fetch(`${base()}/rest/v1/${table}?${query}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T[];
}

/** Call a Postgres RPC as ANON (or as the signed-in user when a token is given).
 *  For an aggregate function whose RLS-safe result is public. */
export async function rpcPublic<T>(
  fn: string,
  args: Record<string, unknown> = {},
  accessToken?: string,
): Promise<T> {
  const res = await fetch(`${base()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(await readError(res));
  return readRpcBody<T>(res);
}

/** Insert one or more rows, returning the inserted representation. */
export async function insert<T>(
  table: string,
  accessToken: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<T[]> {
  const res = await fetch(`${base()}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T[];
}

/** Insert or, on a unique-constraint conflict, merge into the existing row.
 *  `onConflict` names the conflicting columns (e.g. "user_id,model_id"), so a
 *  second submit updates the same row rather than failing. */
export async function upsert<T>(
  table: string,
  accessToken: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  onConflict: string,
): Promise<T[]> {
  const res = await fetch(
    `${base()}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T[];
}

/** Patch rows matching the query. Pass a query like "id=eq.123". */
export async function update<T>(
  table: string,
  accessToken: string,
  query: string,
  patch: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(`${base()}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T[];
}

/** Delete rows matching the query. Pass a query like "id=eq.123". */
export async function del(table: string, accessToken: string, query: string): Promise<void> {
  const res = await fetch(`${base()}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** The full URL of an Edge Function, for a caller that is not the signed-in user
 *  (e.g. the desktop daemon posting to push-send). Undefined when unconfigured. */
export function functionUrl(name: string): string | undefined {
  return SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/${name}` : undefined;
}

/** Invoke a Supabase Edge Function (POST JSON) as the signed-in user. */
export async function invokeFunction<T>(
  name: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${base()}/functions/v1/${name}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/** A refusal code: a short snake_case word. */
function asCode(sent: unknown): string | undefined {
  return typeof sent === 'string' && /^[a-z_]{1,40}$/.test(sent) ? sent : undefined;
}

/** Invoke an Edge Function that refuses with a fixed code, keeping the status
 *  and the code on a SupabaseRequestError so the caller can say the right
 *  thing. Two shapes carry a code: `{ code, error: <a sentence> }` (the
 *  2026-09-24 delete-account, still live in production) and
 *  `{ error: 'owns_org' }` (main's). `code` is read before `error`. Only a
 *  short snake_case word counts as a code; anything else is dropped, never
 *  shown. */
export async function invokeFunctionWithCode<T>(
  name: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${base()}/functions/v1/${name}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code: string | undefined;
    try {
      const sent = (await res.json()) as { code?: unknown; error?: unknown } | null;
      code = asCode(sent?.code) ?? asCode(sent?.error);
    } catch {
      // Not JSON: no code.
    }
    throw new SupabaseRequestError(`Request failed (${res.status}).`, res.status, code);
  }
  return (await res.json()) as T;
}
