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

// Counts every clear, so a refresh that was out when the device signed out
// never writes the old session back over the sign-out (or over the next
// person's sign-in).
let clears = 0;

export async function clearSession(): Promise<void> {
  clears++;
  spent = undefined;
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

// The last refresh made here: the token it spent and the session that took
// its place, so a caller still holding the old copy is handed the new one
// even when nothing is stored. A sign-out forgets it.
let spent: { refreshToken: string; next: Session } | undefined;

const live = (s: Session) => Date.now() < s.expiresAt - 60_000;

/** A refresh of this token already under way, or already made. */
function already(refreshToken: string): Promise<Session> | undefined {
  if (inflight?.refreshToken === refreshToken) return inflight.promise;
  if (spent?.refreshToken === refreshToken) return freshSession(spent.next);
  return undefined;
}

/** A session with a valid access token, refreshing when within a minute of
 *  expiry. Throws AuthExpiredError (the stored session already cleared, when
 *  it was this one) when the refresh token is dead; rethrows any other
 *  failure with the session left intact. */
export async function freshSession(session: Session): Promise<Session> {
  if (live(session)) return session;
  const joined = already(session.refreshToken);
  if (joined) return joined;
  // A refresh token is spent once, and the caller's copy may be older than
  // the device's: another caller may already have refreshed and saved the
  // next one. So the sealed store is read first. A newer session of the same
  // person there is used as it is, or refreshed in its turn, and the spent
  // token never reaches the token endpoint (which answers a reuse with a
  // sign-out).
  const clearsAtStart = clears;
  let stored: Session | undefined;
  let unreadable = false;
  try {
    stored = await loadStoredSession();
  } catch {
    unreadable = true;
  }
  const same = stored?.user.id === session.user.id;
  if (stored && same && stored.refreshToken !== session.refreshToken) {
    if (live(stored)) return stored;
    session = stored;
  }
  const late = already(session.refreshToken);
  if (late) return late;
  // Only this person's own stored session is written or cleared. Nothing
  // stored means the device signed out (a sign-in always saves first): the
  // refresh still answers its caller, but never signs the device back in.
  const ours = unreadable || (Boolean(stored) && same);
  const refreshToken = session.refreshToken;
  const flight = { refreshToken, promise: undefined as Promise<Session> | undefined };
  flight.promise = (async () => {
    try {
      const next = await refreshSession(refreshToken);
      if (clears === clearsAtStart) {
        spent = { refreshToken, next };
        if (ours) await saveSession(next);
      }
      return next;
    } catch (err) {
      if (isDeadRefreshToken(err)) {
        if (ours && clears === clearsAtStart) await clearSession();
        throw new AuthExpiredError();
      }
      throw err;
    } finally {
      if (inflight?.promise === flight.promise) inflight = undefined;
    }
  })();
  inflight = { refreshToken, promise: flight.promise };
  return flight.promise;
}
