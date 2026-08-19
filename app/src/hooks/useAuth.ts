// A thin, component-friendly view of sign-in state and actions, over the store.
// Everything degrades gracefully when accounts are not configured on this build.
import { useApp } from '../state/store.js';

export function useAuth() {
  const {
    authConfigured,
    authSession,
    serverRole,
    signIn,
    signUpAccount,
    sendMagicLink,
    signOutAccount,
  } = useApp();

  return {
    /** Whether this build has sign-in configured at all. */
    configured: authConfigured,
    /** Whether someone is signed in. */
    signedIn: Boolean(authSession),
    email: authSession?.user.email,
    /** Server-verified org role, when known. */
    role: serverRole,
    signIn,
    signUp: signUpAccount,
    sendMagicLink,
    signOut: signOutAccount,
  };
}
