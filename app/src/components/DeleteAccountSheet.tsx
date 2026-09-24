// The account deletion confirm (compliance pass two, part A). A centered
// confirm card on the presence-aware Sheet, so it animates out the way it came
// in. Its steps come from the pure reducer in lib/accountDeletion.ts: type the
// account email to unlock Delete; a stale sign-in asks for a fresh one; a team
// the person owns with other people in it asks for a choice (delete the team,
// keep it, or on the desktop and web, cancel its renewal instead).
//
// Nothing here deletes anything on the device. The parent, on success, signs
// out, forgets the session and the pending Apple link, and offers the existing
// clear-conversations confirm.
import { useEffect, useReducer, useState } from 'react';
import { Sheet } from './Sheet.js';
import type { Session } from '../lib/supabase.js';
import {
  canSubmitDeletion,
  deletionReducer,
  hasAppleSubscription,
  initialDeletionState,
  openTeamBillingPortal,
  requestAccountDeletion,
  type TeamChoice,
} from '../lib/accountDeletion.js';
import { APPLE_SUBSCRIPTIONS_URL } from '../lib/legal.js';
import { isPhone, openExternal } from '../lib/platform.js';
import { hapticApproval } from '../lib/haptics.js';

export const DELETE_TITLE = 'Delete your OpenShore account?';
export const DELETE_BODY =
  "This removes your account, your reviews, your team memberships, your push devices, and your guardrail history from OpenShore's servers. Chats and keys on this device are not touched; you can clear them below. This cannot be undone.";
export const APPLE_NOTE =
  'Deleting your account does not cancel your Apple subscription. Cancel it in Settings, then your name, then Subscriptions.';
export const NO_TRANSFER_LINE =
  "Transfer isn't available yet; delete the team or keep your account.";

export function DeleteAccountSheet({
  open,
  session,
  email,
  onClose,
  onDeleted,
  onSignInAgain,
  onOpenAdmin,
  showToast,
}: {
  open: boolean;
  session: Session | undefined;
  email: string | undefined;
  onClose: () => void;
  /** The server deleted the account. */
  onDeleted: () => void;
  /** The sign-in was too old: sign out and bring back the sign-in card. */
  onSignInAgain: () => void;
  onOpenAdmin: () => void;
  showToast: (msg: string) => void;
}) {
  const [state, dispatch] = useReducer(deletionReducer, initialDeletionState);
  const [apple, setApple] = useState(false);

  // A fresh start each time the sheet opens, and a server read of whether an
  // Apple subscription needs the person's own cancel.
  useEffect(() => {
    if (!open) return;
    dispatch({ type: 'reset' });
    setApple(false);
    if (!session) return;
    let live = true;
    void hasAppleSubscription(session).then((has) => {
      if (live) setApple(has);
    });
    return () => {
      live = false;
    };
  }, [open, session]);

  const send = async (deleteOrgs: string[]) => {
    if (!session) return;
    const outcome = await requestAccountDeletion(session, deleteOrgs);
    dispatch({ type: 'result', outcome });
    if (outcome.kind === 'deleted') onDeleted();
  };

  const submit = () => {
    if (!canSubmitDeletion(state, email)) return;
    hapticApproval();
    dispatch({ type: 'submit' });
    void send(state.deleteOrgs);
  };

  const deleteTeam = (team: TeamChoice) => {
    hapticApproval();
    const next = state.deleteOrgs.includes(team.id)
      ? state.deleteOrgs
      : [...state.deleteOrgs, team.id];
    dispatch({ type: 'deleteTeam', id: team.id });
    void send(next);
  };

  const cancelRenewal = async (team: TeamChoice) => {
    if (!session) return;
    try {
      await openTeamBillingPortal(session, team.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open billing.');
    }
  };

  const working = state.phase === 'working';

  return (
    <Sheet open={open} onClose={working ? () => {} : onClose} variant="confirm">
      {state.phase === 'reauth' ? (
        <>
          <h3>Sign in again to continue</h3>
          <p>{state.error}</p>
          <div className="confirm-row">
            <button className="btn ghost press-fb" onClick={onClose}>
              Not now
            </button>
            <button className="btn primary press-fb" onClick={onSignInAgain}>
              Sign in again
            </button>
          </div>
        </>
      ) : state.phase === 'orgs' || (working && state.orgs.length > 0) ? (
        <>
          <h3>You own a team with other people in it</h3>
          <p>
            Deleting a team removes it for everyone in it and cancels its plan now. A charge from
            the last 14 days is refunded in full.
          </p>
          <div className="delete-teams">
            {state.orgs.map((team) => (
              <div className="delete-team" key={team.id}>
                <div className="delete-team-name">{team.name}</div>
                <div className="hint">
                  {team.members === 1 ? '1 other person' : `${team.members} other people`}
                </div>
                <div className="confirm-row">
                  <button
                    className="btn ghost press-fb"
                    disabled={working}
                    onClick={() => dispatch({ type: 'keepTeam', id: team.id })}
                  >
                    Keep the team
                  </button>
                  <button
                    className="btn danger press-fb"
                    disabled={working}
                    onClick={() => deleteTeam(team)}
                  >
                    {working ? 'Deleting' : 'Delete the team'}
                  </button>
                </div>
                {team.paid && !isPhone() ? (
                  <button
                    className="btn quiet press-fb delete-team-renewal"
                    disabled={working}
                    onClick={() => void cancelRenewal(team)}
                  >
                    Cancel renewal instead
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : state.phase === 'kept' ? (
        <>
          <h3>Your account stays</h3>
          <p>
            You kept {state.keptTeam}, so nothing was deleted. {NO_TRANSFER_LINE}
          </p>
          <div className="confirm-row">
            <button className="btn ghost press-fb" onClick={onClose}>
              Done
            </button>
            <button className="btn primary press-fb" onClick={onOpenAdmin}>
              Open Admin
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h3>{DELETE_TITLE}</h3>
          <p>{DELETE_BODY}</p>
          {apple ? (
            <div className="delete-apple">
              <p>{APPLE_NOTE}</p>
              <button
                type="button"
                className="btn quiet press-fb"
                onClick={() => openExternal(APPLE_SUBSCRIPTIONS_URL)}
              >
                Manage subscription
              </button>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="delete-account-email">
              Type {email ?? 'your account email'} to confirm
            </label>
            <input
              id="delete-account-email"
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={state.typed}
              disabled={working}
              onChange={(e) => dispatch({ type: 'type', value: e.target.value })}
            />
          </div>
          {state.phase === 'error' && state.error ? (
            <p className="delete-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="confirm-row">
            <button
              type="button"
              className="btn ghost press-fb"
              disabled={working}
              onClick={onClose}
            >
              Keep my account
            </button>
            <button
              type="submit"
              className="btn danger press-fb"
              disabled={!canSubmitDeletion(state, email)}
            >
              {working ? 'Deleting' : 'Delete account'}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
