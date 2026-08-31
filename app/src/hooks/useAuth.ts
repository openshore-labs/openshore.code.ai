// A thin, component-friendly view of sign-in state and actions, over the store.
// Everything degrades gracefully when accounts are not configured on this build.
import { useApp } from '../state/store.js';

export function useAuth() {
  const {
    authConfigured,
    authSession,
    serverRole,
    passwordRecovery,
    signIn,
    signUpAccount,
    sendMagicLink,
    sendPasswordReset,
    resendConfirmation,
    updateMyPassword,
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
    /** True while a password-reset link is signing the user in to set a new one. */
    passwordRecovery: Boolean(passwordRecovery),
    signIn,
    signUp: signUpAccount,
    sendMagicLink,
    sendPasswordReset,
    resendConfirmation,
    updateMyPassword,
    signOut: signOutAccount,
  };
}
