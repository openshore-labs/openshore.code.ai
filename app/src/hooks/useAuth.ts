// A thin, component-friendly view of sign-in state and actions, over the store.
// Everything degrades gracefully when accounts are not configured on this build.
import { useApp } from '../state/store.js';
import type { DeleteReauth } from '../state/accountDeletion.js';

export function useAuth() {
  const {
    authConfigured,
    authSession,
    serverRole,
    sendSignInEmail,
    verifySignInCode,
    signOutAccount,
    signOutEverywhere,
    confirmByCode,
  } = useApp();
  const email = authSession?.user.email;
  // Delete account's recent sign-in (the security review's F2): the same
  // email code as signing in, to this account's own address, renewing this
  // session only. Absent without an address to send it to.
  const deleteReauth: DeleteReauth | undefined = email
    ? { email, sendCode: () => sendSignInEmail(email), confirmCode: confirmByCode }
    : undefined;

  return {
    /** Whether this build has sign-in configured at all. */
    configured: authConfigured,
    /** Whether someone is signed in. */
    signedIn: Boolean(authSession),
    email,
    /** Server-verified org role, when known. */
    role: serverRole,
    /** Email a sign-in: a link for this device and a 6-digit code. */
    sendSignInEmail,
    /** Sign in with the code from that email. */
    verifySignInCode,
    signOut: signOutAccount,
    signOutEverywhere,
    /** How Delete account proves a recent sign-in, when the server asks. */
    deleteReauth,
  };
}
