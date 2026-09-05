// Where the signed-in session lives on the device. It is written through the
// sealed store, so it is AES-encrypted at rest under the device DEK (which lives
// in the Keychain), and refreshed automatically as it nears expiry.
import { storeDelete, storeGetJson, storeSetJson } from './platform.js';
import { refreshSession, SupabaseRequestError, type Session } from './supabase.js';

const SESSION_KEY = 'oscode.auth.session.v1';

/** The refresh token was rejected outright: the session is dead and has been
 *  cleared from the device. The store catches this in one place and signs the
 *  person out with one honest line. */
export class AuthExpiredError extends Error {
  constructor() {
    super('Your sign-in expired. Sign in again.');
    this.name = 'AuthExpiredError';
  }
}

export async function loadStoredSession(): Promise<Session | undefined> {
  return storeGetJson<Session>(SESSION_KEY);
}

export async function saveSession(session: Session): Promise<void> {
  await storeSetJson(SESSION_KEY, session);
}

export async function clearSession(): Promise<void> {
  await storeDelete(SESSION_KEY);
}

// GoTrue answers a revoked, reused, or unknown refresh token with a 400
// (invalid_grant) or a 401. Anything else (a network failure, a 5xx) says
// nothing about the session and must leave it alone.
function isDeadRefreshToken(err: unknown): boolean {
  return err instanceof SupabaseRequestError && (err.status === 400 || err.status === 401);
}

// One refresh in flight at a time per refresh token: the store asks for a fresh
// session from several places at once (entitlement, role, projects, a purchase),
// and each of them must ride the same request rather than race the token
// endpoint with the same refresh token.
let inflight: { refreshToken: string; promise: Promise<Session> } | undefined;

/** A session with a valid access token, refreshing when within a minute of
 *  expiry. Throws AuthExpiredError (session already cleared) when the refresh
 *  token is dead; rethrows any other failure with the session left intact. */
export async function freshSession(session: Session): Promise<Session> {
  if (Date.now() < session.expiresAt - 60_000) return session;
  if (inflight?.refreshToken === session.refreshToken) return inflight.promise;
  const promise = (async () => {
    try {
      const next = await refreshSession(session.refreshToken);
      await saveSession(next);
      return next;
    } catch (err) {
      if (isDeadRefreshToken(err)) {
        await clearSession();
        throw new AuthExpiredError();
      }
      throw err;
    } finally {
      if (inflight?.promise === promise) inflight = undefined;
    }
  })();
  inflight = { refreshToken: session.refreshToken, promise };
  return promise;
}
