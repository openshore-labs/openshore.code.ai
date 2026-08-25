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
 *  does not require email confirmation, otherwise null (confirm, then sign in). */
export async function signUp(email: string, password: string): Promise<Session | null> {
  const res = await fetch(`${base()}/auth/v1/signup`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as Partial<GoTrueSession>;
  return body.access_token ? toSession(body as GoTrueSession) : null;
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
  if (!res.ok) throw new Error(await readError(res));
  return toSession((await res.json()) as GoTrueSession);
}

export async function signOut(accessToken: string): Promise<void> {
  await fetch(`${base()}/auth/v1/logout`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  }).catch(() => {});
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

/** The signed-in user (used to fill id/email after a magic-link callback). */
export async function getUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${base()}/auth/v1/user`, { headers: authHeaders(accessToken) });
  if (!res.ok) return null;
  const u = (await res.json()) as { id: string; email?: string };
  return { id: u.id, email: u.email };
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
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/** A minimal PostgREST select. Pass a query string like "select=*&org_id=eq.123". */
export async function select<T>(table: string, accessToken: string, query: string): Promise<T[]> {
  const res = await fetch(`${base()}/rest/v1/${table}?${query}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T[];
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
