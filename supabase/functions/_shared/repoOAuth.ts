// The pure part of repo-oauth, kept here so Deno tests reach it without a
// network (repoOAuth.test.ts).

/** Whether repo-oauth's POST routes need a signed-in caller: only when the
 *  REPO_OAUTH_REQUIRE_SIGN_IN secret is "true" or "1". Anything else, unset
 *  included, leaves them as they were, so the builds already installed (which
 *  send no token) keep connecting until the maintainers turn it on. */
export function requireSignIn(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Whether the Authorization header carries a live Supabase session: the
 *  auth server's own /auth/v1/user answers 200 for one and refuses anything
 *  else. No client library and no database, so repo-oauth still keeps
 *  nothing; a network failure reads as not signed in (the app says sign in). */
export async function signedIn(
  authorization: string | null,
  supabaseUrl: string,
  anonKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization.trim())) return false;
  const base = supabaseUrl.trim().replace(/\/+$/, '');
  if (!base || !anonKey) return false;
  try {
    const res = await fetchFn(`${base}/auth/v1/user`, {
      headers: { authorization: authorization.trim(), apikey: anonKey },
    });
    await res.body?.cancel();
    return res.status === 200;
  } catch {
    return false;
  }
}
