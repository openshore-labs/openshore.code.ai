// Delete account (Apple 5.1.1(v); next build E1, CX ruling 3). The work lives
// here, apart from the store (CTO ruling 9, the state/vaultOps.ts pattern):
// the store builds an AccountDeletionDeps from its own session door and its
// forgetSession, and wires deleteAccount to this.
//
// The server does the erasing (supabase/functions/delete-account). This side
// asks with a fresh session, reads the answer, and on success signs the device
// out the ordinary way and drops an Apple receipt still waiting to be linked
// (it belonged to the account that is gone). Nothing else on the device is
// touched: chats, local projects and notes stay, and chatting needs no
// account. Every answer is a result, never a throw, and nothing here shows a
// toast; the sheet says what happened (components/DeleteAccount.tsx).
//
// Two ways off the device. A deletion is a sign-out (forgetSession): the
// account is gone, so nothing of it is kept. A dead sign-in with the account
// perhaps still there is an involuntary end (endSignIn), the way the session
// door ends one on a dead refresh token: unsent team vault text stays sealed
// on the device for the same account to sign back in to.
//
// Two functions answer (CTO 11, package C). Production runs the privacy
// branch's 2026-09-24 function until main's merged one is deployed, and a
// build in the field must read both:
//   main's:        200 { ok: true, deleted: true, appleNote }, or
//                  { error: 'owns_org' | 'unauthorized' | 'billing' | 'failed' }
//   2026-09-24's:  200 { deleted: true }, or { error: <a sentence>, code }
//                  with code 'reauth_required', 'transfer_or_delete_org',
//                  'not_signed_in' or 'billing_failed' (500 has no code).
// A success must never read as a failure: the account is gone either way, and
// a device that stays signed in to a deleted account is the fault this fixes.
//
// Neither function can tell "signed out" from "already deleted": both ask
// the auth server who the token belongs to, and a token for an account that
// no longer exists gets no user, so main's answers 'unauthorized' and the
// 2026-09-24 one 'not_signed_in'. That is the answer on a retry after a lost
// 200, and on the second device after the person deleted the account on the
// first. So on either code this side asks the auth server once itself: an
// account that is gone reads as deleted (signed out, the goodbye), a sign-in
// that is dead ends the sign-in with a line that claims nothing about the
// account, and a live one is a plain failure. When the auth server cannot
// say (offline, a server error, an answer it gives no code for), nothing
// here knows whether the account is gone, so the device is left as it was
// and the sheet says it could not confirm, never that nothing was deleted.
import { SupabaseRequestError, type AuthUserState, type Session } from '../lib/supabase.js';

/** What a delete-account attempt came to. */
export type DeleteAccountOutcome =
  /** Gone. `appleNote`: the person pays through Apple, which only they can
   *  stop, so the success sheet says where. Undefined when the server did not
   *  say (the 2026-09-24 function never does), so the sheet says it as an
   *  if. */
  | { kind: 'deleted'; appleNote?: boolean }
  /** Refused: they own a team with other people in it. Nothing changed. */
  | { kind: 'owns_org' }
  /** Refused: the server wants a recent sign-in first (the 2026-09-24
   *  function's ten-minute check). Nothing changed. */
  | { kind: 'reauth_required' }
  /** This device's sign-in is no longer valid, so the device is signed out
   *  now, as an involuntary end (endSignIn). The account may be gone (deleted
   *  here or on another device) or not; nothing here can tell, so the sheet
   *  claims neither. */
  | { kind: 'signed_out' }
  /** Nobody can say whether the account was deleted: the server found no
   *  account for this token and the auth server could not say whether the
   *  account or only the sign-in is gone (offline, a server error, or an
   *  answer with no code to read); or the request itself broke on the way
   *  (the connection dropped, the answer came back cut short), so the
   *  function may have finished, or may still be running, while the account
   *  still reads as here. Nothing changed on the device. */
  | { kind: 'unconfirmed' }
  /** Refused: a subscription could not be stopped, so nothing was deleted
   *  (main's 'billing', the 2026-09-24 function's 'billing_failed'). */
  | { kind: 'billing' }
  /** Not deleted: the session door could not reach the server (nothing was
   *  sent), the function answered that it failed, or the auth server shows
   *  the account still here after the function said it found none. Nothing
   *  changed on the device either. */
  | { kind: 'failed' };

/** A success body from either function. */
export interface DeleteAccountAnswer {
  ok?: boolean;
  deleted?: boolean;
  appleNote?: boolean;
}

export interface AccountDeletionDeps {
  /** The store's one door for server calls (freshAuth): a session with a live
   *  access token, or undefined when nobody is signed in. */
  session: () => Promise<Session | undefined>;
  /** POST delete-account as that session. Throws a SupabaseRequestError
   *  carrying the refusal code when the server says no. */
  invoke: (accessToken: string) => Promise<DeleteAccountAnswer>;
  /** Ask the auth server, once, what it makes of this access token (lib/
   *  supabase.ts authUserState). Throws when it cannot say (offline, a
   *  server error, `bad_jwt`, a 401 or 403 with no code). */
  authState: (accessToken: string) => Promise<AuthUserState>;
  /** Sign this device out, as Sign out does: the account is deleted. */
  forgetSession: () => Promise<unknown>;
  /** End this device's sign-in involuntarily, as the session door does on a
   *  dead refresh token (the store's forgetSession(true)): unsent team vault
   *  text stays sealed for the same account. The sign-in is dead and the
   *  account may still exist. */
  endSignIn: () => Promise<unknown>;
  /** Drop the Apple receipt still waiting to be linked, if any. */
  clearPendingAppleLink: () => Promise<void>;
}

/** How a refusal code from either function reads. 'no_user' is not an
 *  outcome: the server found no account for the token, which deleteAccount
 *  settles by asking the auth server itself. Every other code, and none, is
 *  a failure. */
type Refusal = 'owns_org' | 'reauth_required' | 'billing' | 'no_user';
const REFUSALS: Record<string, Refusal> = {
  owns_org: 'owns_org',
  transfer_or_delete_org: 'owns_org',
  reauth_required: 'reauth_required',
  billing: 'billing',
  billing_failed: 'billing',
  unauthorized: 'no_user',
  not_signed_in: 'no_user',
};

function refusalOf(err: unknown): Refusal | undefined {
  return err instanceof SupabaseRequestError && err.code && Object.hasOwn(REFUSALS, err.code)
    ? REFUSALS[err.code]
    : undefined;
}

/** Read a refusal that needs no second question: a SupabaseRequestError's
 *  code, mapped; anything else, including a network error, is a failure. A
 *  no-user code reads as failed here; deleteAccount asks before it settles. */
export function refusalOutcome(err: unknown): DeleteAccountOutcome {
  const kind = refusalOf(err);
  if (kind === 'owns_org') return { kind: 'owns_org' };
  if (kind === 'reauth_required') return { kind: 'reauth_required' };
  if (kind === 'billing') return { kind: 'billing' };
  return { kind: 'failed' };
}

/** Read a 200: success when either function's success field is true. */
export function answerOutcome(
  answer: DeleteAccountAnswer | null | undefined,
): DeleteAccountOutcome {
  if (answer?.ok !== true && answer?.deleted !== true) return { kind: 'failed' };
  return typeof answer.appleNote === 'boolean'
    ? { kind: 'deleted', appleNote: answer.appleNote }
    : { kind: 'deleted' };
}

export async function deleteAccount(deps: AccountDeletionDeps): Promise<DeleteAccountOutcome> {
  let session: Session | undefined;
  try {
    session = await deps.session();
  } catch {
    return { kind: 'failed' };
  }
  // The row shows only while signed in, so no session here means the sign-in
  // ended underneath: the session door found the refresh token dead (the
  // account deleted on another device, or signed out everywhere) and has
  // already signed the device out. Nothing more to forget.
  if (!session) return { kind: 'signed_out' };

  let outcome: DeleteAccountOutcome;
  try {
    outcome = answerOutcome(await deps.invoke(session.accessToken));
  } catch (err) {
    if (err instanceof SupabaseRequestError) {
      // The function (or its gateway) answered: a coded refusal is what it
      // says, and a no-user code is settled by asking the auth server.
      if (refusalOf(err) !== 'no_user') return refusalOutcome(err);
      outcome = await askAuth(deps, session.accessToken, { kind: 'failed' });
    } else {
      // The request broke on the way (a dropped connection, an answer cut
      // short): the function may have finished, since deleting the user is
      // its last step, or may still be running. Only the auth server can
      // say it is gone; an account still here is unconfirmed, not "not
      // deleted".
      outcome = await askAuth(deps, session.accessToken, { kind: 'unconfirmed' });
    }
    if (outcome.kind === 'signed_out') await deps.endSignIn().catch(() => {});
  }
  if (outcome.kind !== 'deleted') return outcome;

  // The account is gone on the server whatever happens next, so a local
  // cleanup that stumbles never turns this into a failure.
  await deps.forgetSession().catch(() => {});
  await deps.clearPendingAppleLink().catch(() => {});
  return outcome;
}

/** Ask the auth server once what it makes of this token: gone is a deletion
 *  (the Apple note as an if, since nobody said), a dead sign-in is signed
 *  out, and a live account reads as `live` (failed when the function said it
 *  found no account, unconfirmed when the request broke on the way). When
 *  the auth server cannot say either, it is unconfirmed: the account may be
 *  gone, so it is never read as "not deleted". */
async function askAuth(
  deps: AccountDeletionDeps,
  accessToken: string,
  live: DeleteAccountOutcome,
): Promise<DeleteAccountOutcome> {
  let state: AuthUserState;
  try {
    state = await deps.authState(accessToken);
  } catch {
    return { kind: 'unconfirmed' };
  }
  if (state === 'gone') return { kind: 'deleted' };
  if (state === 'invalid') return { kind: 'signed_out' };
  return live;
}
