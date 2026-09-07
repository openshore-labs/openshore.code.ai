// Native auth-session plugin: ASWebAuthenticationSession on iOS, reached through
// a small Capacitor plugin (Swift side in app/plugins/oscode-authsession). This
// file is the JS contract plus a web stub that reports "unavailable", so on
// desktop and web the repo-OAuth flow keeps its system-browser + deep-link path
// (see lib/gitos/repoOAuth.ts). The session runs the provider consent and, since
// it is told the app's callback scheme, returns the oscode:// callback URL
// directly, so connecting a repo is one tap with no bounce-page press.
import { registerPlugin } from '@capacitor/core';

export interface AuthSessionStartOptions {
  /** The provider authorize URL (the same one the deep-link path opens). */
  url: string;
  /** The app's callback scheme the session intercepts, without the "://" (e.g.
   *  "oscode"). When the consent flow navigates to this scheme, the session
   *  closes and hands back the full callback URL. */
  callbackScheme: string;
  /** Use an isolated web session (no shared Safari cookies). Default false, so a
   *  person already signed in to the provider is not asked to sign in again. */
  ephemeral?: boolean;
}

export interface AuthSessionResult {
  /** The full callback URL, e.g. oscode://repo-oauth?code=...&state=... */
  url: string;
}

export interface OscodeAuthSessionContract {
  /** Is the native auth session usable here? True on iOS, false on the web stub
   *  (where the caller falls back to the system-browser + deep-link path). */
  available(): Promise<{ available: boolean }>;
  /** Run the consent flow and resolve with the callback URL. Rejects with code
   *  "canceled" when the person dismisses the sheet. */
  start(options: AuthSessionStartOptions): Promise<AuthSessionResult>;
}

class AuthSessionWeb implements OscodeAuthSessionContract {
  async available() {
    return { available: false };
  }
  async start(): Promise<AuthSessionResult> {
    // Never called on web: repoOAuth only reaches for this on iOS, and the
    // desktop/web paths use the deep-link flow instead.
    throw new Error('The native auth session is not available here.');
  }
}

export const OscodeAuthSession = registerPlugin<OscodeAuthSessionContract>('OscodeAuthSession', {
  web: () => new AuthSessionWeb() as unknown as OscodeAuthSessionContract,
});
