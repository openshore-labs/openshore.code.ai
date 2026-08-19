// Where the signed-in session lives on the device. It is written through the
// sealed store, so it is AES-encrypted at rest under the device DEK (which lives
// in the Keychain), and refreshed automatically as it nears expiry.
import { storeDelete, storeGetJson, storeSetJson } from './platform.js';
import { refreshSession, type Session } from './supabase.js';

const SESSION_KEY = 'oscode.auth.session.v1';

export async function loadStoredSession(): Promise<Session | undefined> {
  return storeGetJson<Session>(SESSION_KEY);
}

export async function saveSession(session: Session): Promise<void> {
  await storeSetJson(SESSION_KEY, session);
}

export async function clearSession(): Promise<void> {
  await storeDelete(SESSION_KEY);
}

/** A session with a valid access token, refreshing when within a minute of
 *  expiry. Throws if the refresh fails (the caller then signs out). */
export async function freshSession(session: Session): Promise<Session> {
  if (Date.now() < session.expiresAt - 60_000) return session;
  const next = await refreshSession(session.refreshToken);
  await saveSession(next);
  return next;
}
