// Email sign-in, with no passwords (founder, 2026-10-12). One email carries a
// link and a 6-digit code. The link is PKCE: this device keeps the verifier
// and sends only its hash, so the link signs in only here, and a crafted or
// forwarded oscode:// link has nothing to trade. The code is typed into the
// app, which is the way in from any other device. The rules live here, apart
// from the store (CTO ruling 9); the store wires them in. Tests:
// app/test/auth.test.ts and app/test/emailSignIn.test.ts.
import { codeChallengeOf, newCodeVerifier } from '../lib/pkce.js';
import { secretDelete, secretGet, secretSet, storeDelete } from '../lib/platform.js';
import type { Session } from '../lib/supabase.js';

/** The request this device has open: who the email went to, the PKCE
 *  verifier its link needs, and when. One at a time, in the platform's secret
 *  store (CTO, 2026-10-12), because the link usually launches the app cold
 *  from Mail (APP-6); kept only as long as the email's link and code live,
 *  and deleted once used. */
export const PENDING_AUTH_KEY = 'oscode.auth.pending.v2';
/** The row the pre-PKCE build kept (an address only); deleted on sight. */
export const RETIRED_PENDING_AUTH_KEY = 'oscode.auth.pending.v1';
/** As long as the code and link live: supabase/config.toml otp_expiry. */
export const PENDING_AUTH_TTL_MS = 10 * 60_000;

export interface PendingSignIn {
  email: string;
  verifier: string;
  at: number;
}

/** An address as the account knows it. */
export function addressKey(addr: string): string {
  return addr.trim().toLowerCase();
}

export async function readPendingSignIn(): Promise<PendingSignIn | undefined> {
  const raw = await secretGet(PENDING_AUTH_KEY);
  if (!raw) return undefined;
  let row: Partial<PendingSignIn> | undefined;
  try {
    row = JSON.parse(raw) as Partial<PendingSignIn>;
  } catch {
    row = undefined;
  }
  if (
    !row?.email ||
    !row.verifier ||
    typeof row.at !== 'number' ||
    Date.now() - row.at > PENDING_AUTH_TTL_MS
  ) {
    await secretDelete(PENDING_AUTH_KEY);
    return undefined;
  }
  return { email: row.email, verifier: row.verifier, at: row.at };
}

export async function clearPendingSignIn(): Promise<void> {
  await secretDelete(PENDING_AUTH_KEY);
  await storeDelete(RETIRED_PENDING_AUTH_KEY);
}

/** Open a request: a fresh verifier saved before the email is asked for, so
 *  a link that beats the network answer still finds it. Returns the
 *  challenge to send. A second request replaces the first, so only the
 *  newest email's link works here. */
export async function openPendingSignIn(email: string): Promise<string> {
  const verifier = newCodeVerifier();
  const row: PendingSignIn = { email: addressKey(email), verifier, at: Date.now() };
  await secretSet(PENDING_AUTH_KEY, JSON.stringify(row));
  return codeChallengeOf(verifier);
}

/** The digits of a typed or pasted code, or undefined when it is not six. */
export function codeDigits(typed: string): string | undefined {
  const digits = typed.replace(/\D/g, '');
  return digits.length === CODE_LENGTH ? digits : undefined;
}

/** The code's length, as supabase/config.toml sets otp_length. */
export const CODE_LENGTH = 6;

/** Whether a session is for someone other than the person signed in here, in
 *  which case a sign-in must never switch accounts underneath them. */
export function switchesAccount(current: Session | undefined, next: Session): boolean {
  const a = current?.user.email;
  const b = next.user.email;
  return Boolean(a && b && addressKey(a) !== addressKey(b));
}

/** How long before another email can be asked for, as supabase/config.toml
 *  sets max_frequency. */
export const RESEND_WAIT_S = 60;

// The words, as CX ruled them (2026-10-12).
export const SIGNED_IN = 'Signed in.';
export const EMAIL_STEP_SUB = 'Enter your email. New here? The same step makes your free account.';
export const PASSWORDS_GONE = 'Passwords are gone. Enter your email and we will send a code.';
export const SEND_CODE = 'Email me a code';
export const SENDING = 'Sending...';
export const CHECK_TITLE = 'Check your email';
/** The check step's body. `device` is "this computer" on the desktop, or the
 *  phone's own noun (lib/deviceNoun.ts). */
export function checkBody(email: string, device: string): string {
  return `We sent a 6-digit code and a link to ${email}. Type the code here, or open the link on ${device}. Both work for 10 minutes.`;
}
export const CODE_LABEL = '6-digit code';
export const SIGN_IN = 'Sign in';
export const SIGNING_IN = 'Signing in...';
export function resendIn(seconds: number): string {
  return `Send a new code in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}
export const SEND_NEW_CODE = 'Send a new code';
export const NEW_CODE_SENT = 'New code sent. Use the newest email.';
export const DIFFERENT_EMAIL = 'Use a different email';
export const CODE_REFUSED = 'That code did not work. Check the newest email, or send a new code.';
export const RATE_LIMITED = 'Too many tries. Wait a minute, then send a new code.';
export const CONSENT_LEAD = 'Continuing means you accept the';
export const LINK_ELSEWHERE =
  'That link only works on the device that asked for it. Type the code from the email instead.';
export const LINK_EXPIRED = 'That link has expired or was already used. Send a new email.';
export function signedInAsSomeoneElse(current: string, next: string): string {
  return `You are signed in as ${current}. Sign out first to sign in as ${next}.`;
}

/** Whether the auth server refused for asking too often. */
export function rateLimited(err: unknown): boolean {
  const said = err instanceof Error ? err.message : String(err);
  return /rate limit|too many|only request this after|429/i.test(said);
}
