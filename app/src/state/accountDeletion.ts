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
import { SupabaseRequestError, type Session } from '../lib/supabase.js';

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
  /** Not deleted: offline, signed out underneath, or the server failed.
   *  Nothing changed on the device either. */
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
  /** Sign this device out, as Sign out does. */
  forgetSession: () => Promise<unknown>;
  /** Drop the Apple receipt still waiting to be linked, if any. */
  clearPendingAppleLink: () => Promise<void>;
}

/** The refusal codes either function sends that mean something other than
 *  "failed". Every other code, and none, is a failure. */
const REFUSALS: Record<string, DeleteAccountOutcome['kind']> = {
  owns_org: 'owns_org',
  transfer_or_delete_org: 'owns_org',
  reauth_required: 'reauth_required',
};

/** Read a refusal: a SupabaseRequestError's code, mapped; anything else,
 *  including a network error, is a failure. */
export function refusalOutcome(err: unknown): DeleteAccountOutcome {
  const kind = err instanceof SupabaseRequestError && err.code ? REFUSALS[err.code] : undefined;
  if (kind === 'owns_org') return { kind: 'owns_org' };
  if (kind === 'reauth_required') return { kind: 'reauth_required' };
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
  if (!session) return { kind: 'failed' };

  let outcome: DeleteAccountOutcome;
  try {
    outcome = answerOutcome(await deps.invoke(session.accessToken));
  } catch (err) {
    return refusalOutcome(err);
  }
  if (outcome.kind !== 'deleted') return outcome;

  // The account is gone on the server whatever happens next, so a local
  // cleanup that stumbles never turns this into a failure.
  await deps.forgetSession().catch(() => {});
  await deps.clearPendingAppleLink().catch(() => {});
  return outcome;
}
