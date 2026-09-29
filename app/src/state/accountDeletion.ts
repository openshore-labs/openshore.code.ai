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
import { SupabaseRequestError, type Session } from '../lib/supabase.js';

/** What a delete-account attempt came to. */
export type DeleteAccountOutcome =
  /** Gone. `appleNote`: the person pays through Apple, which only they can
   *  stop, so the success sheet says where. */
  | { kind: 'deleted'; appleNote: boolean }
  /** Refused: they own a team with other people in it. Nothing changed. */
  | { kind: 'owns_org' }
  /** Not deleted: offline, signed out underneath, or the server failed.
   *  Nothing changed on the device either. */
  | { kind: 'failed' };

export interface AccountDeletionDeps {
  /** The store's one door for server calls (freshAuth): a session with a live
   *  access token, or undefined when nobody is signed in. */
  session: () => Promise<Session | undefined>;
  /** POST delete-account as that session. Throws a SupabaseRequestError
   *  carrying the refusal code when the server says no. */
  invoke: (accessToken: string) => Promise<{ ok?: boolean; appleNote?: boolean }>;
  /** Sign this device out, as Sign out does. */
  forgetSession: () => Promise<unknown>;
  /** Drop the Apple receipt still waiting to be linked, if any. */
  clearPendingAppleLink: () => Promise<void>;
}

export async function deleteAccount(deps: AccountDeletionDeps): Promise<DeleteAccountOutcome> {
  let session: Session | undefined;
  try {
    session = await deps.session();
  } catch {
    return { kind: 'failed' };
  }
  if (!session) return { kind: 'failed' };

  let answer: { ok?: boolean; appleNote?: boolean };
  try {
    answer = await deps.invoke(session.accessToken);
  } catch (err) {
    if (err instanceof SupabaseRequestError && err.code === 'owns_org') return { kind: 'owns_org' };
    return { kind: 'failed' };
  }
  if (answer?.ok !== true) return { kind: 'failed' };

  // The account is gone on the server whatever happens next, so a local
  // cleanup that stumbles never turns this into a failure.
  await deps.forgetSession().catch(() => {});
  await deps.clearPendingAppleLink().catch(() => {});
  return { kind: 'deleted', appleNote: answer.appleNote === true };
}
