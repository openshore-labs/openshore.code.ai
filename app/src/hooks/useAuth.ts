// A thin, component-friendly view of sign-in state and actions, over the store.
// Everything degrades gracefully when accounts are not configured on this build.
import { useApp } from '../state/store.js';

export function useAuth() {
  const {
    authConfigured,
    authSession,
    serverRole,
    sendSignInEmail,
    verifySignInCode,
    signOutAccount,
    signOutEverywhere,
  } = useApp();

  return {
    /** Whether this build has sign-in configured at all. */
    configured: authConfigured,
    /** Whether someone is signed in. */
    signedIn: Boolean(authSession),
    email: authSession?.user.email,
    /** Server-verified org role, when known. */
    role: serverRole,
    /** Email a sign-in: a link for this device and a 6-digit code. */
    sendSignInEmail,
    /** Sign in with the code from that email. */
    verifySignInCode,
    signOut: signOutAccount,
    signOutEverywhere,
  };
}
