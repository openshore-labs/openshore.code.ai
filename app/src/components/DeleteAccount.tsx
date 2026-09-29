// Delete account (Apple 5.1.1(v); CX ruling 3, 2026-09-29): a danger row in
// the Your account sheet, below the signed-in card, shown only while signed
// in, two taps from Settings. One confirm sheet, one irreversible choice; no
// "erase this device" here (that belongs beside Clear conversations). The
// work is state/accountDeletion.ts, reached through the store; this is only
// what the person sees, so it takes the call as a prop and mounts in a test.
//
// Three sheets, one at a time: the ask, "One step first" when the person owns
// a team with other people in it, and the goodbye. Each is a presence-aware
// Sheet, so the ask plays its exit while the next one arrives, and the
// goodbye outlives the signed-in state that drew the row.
import { useState } from 'react';
import type { DeleteAccountOutcome } from '../state/accountDeletion.js';
import { hapticCommit } from '../lib/haptics.js';
import { openExternal } from '../lib/platform.js';
import { Sheet } from './Sheet.js';
import { SettingsRow } from './SettingsRow.js';

/** Every word the flow shows (CX ruling 3). */
export const DELETE_ACCOUNT_COPY = {
  row: 'Delete account',
  rowSub: 'Erases your account from our server. This device keeps what it has.',
  title: 'Delete your OpenShore account?',
  body: 'This erases your account and the settings that follow you between devices. It cannot be undone. Your chats, projects, and notes on this device stay here, and chatting keeps working without an account. If you pay for Personal through Apple, Apple keeps billing until you cancel it there.',
  confirm: 'Delete account',
  keep: 'Keep my account',
  working: 'Deleting...',
  failed: 'Your account was not deleted. Check your connection and try again.',
  ownsOrgTitle: 'One step first',
  ownsOrgBody:
    'You own a team with other people in it, so this account cannot be deleted yet. Email support@openshore.ai and we will hand the team over or close it with you.',
  emailSupport: 'Email support',
  close: 'Close',
  doneTitle: 'Your account is deleted',
  doneBody: 'This device is signed out. Your chats and projects are still here.',
  appleNote:
    'Your Apple subscription is separate. Cancel it on your iPhone in Settings, then your name, then Subscriptions, or it keeps renewing.',
  done: 'Done',
} as const;

export const SUPPORT_MAILTO = 'mailto:support@openshore.ai';

type Step = 'ask' | 'owns_org' | 'done' | undefined;

export function DeleteAccount({
  signedIn,
  onDelete,
  onDone,
}: {
  signedIn: boolean;
  /** The store's deleteAccount: a result, never a throw. */
  onDelete: () => Promise<DeleteAccountOutcome>;
  /** After the goodbye: the parent may close the account sheet too. */
  onDone?: () => void;
}) {
  const [step, setStep] = useState<Step>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [appleNote, setAppleNote] = useState(false);

  const ask = () => {
    setFailed(false);
    setStep('ask');
  };
  // Nothing closes the ask while the server is at work: a dismissed sheet
  // would hide whether the account is gone.
  const closeAsk = () => {
    if (!busy) setStep(undefined);
  };
  const run = async () => {
    hapticCommit();
    setBusy(true);
    setFailed(false);
    const outcome = await onDelete().catch((): DeleteAccountOutcome => ({ kind: 'failed' }));
    setBusy(false);
    if (outcome.kind === 'deleted') {
      setAppleNote(outcome.appleNote);
      setStep('done');
    } else if (outcome.kind === 'owns_org') {
      setStep('owns_org');
    } else {
      setFailed(true);
    }
  };
  const finish = () => {
    setStep(undefined);
    onDone?.();
  };

  return (
    <>
      {signedIn ? (
        <div className="settings-card account-delete">
          <SettingsRow
            label={DELETE_ACCOUNT_COPY.row}
            sub={DELETE_ACCOUNT_COPY.rowSub}
            subWrap
            danger
            onClick={ask}
          />
        </div>
      ) : null}

      <Sheet open={step === 'ask'} onClose={closeAsk} variant="confirm">
        <h3>{DELETE_ACCOUNT_COPY.title}</h3>
        <p>{DELETE_ACCOUNT_COPY.body}</p>
        {failed ? (
          <p className="confirm-failed" role="alert">
            {DELETE_ACCOUNT_COPY.failed}
          </p>
        ) : null}
        <div className="confirm-row">
          <button type="button" className="btn ghost press-fb" disabled={busy} onClick={closeAsk}>
            {DELETE_ACCOUNT_COPY.keep}
          </button>
          <button
            type="button"
            className="btn danger press-fb"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? DELETE_ACCOUNT_COPY.working : DELETE_ACCOUNT_COPY.confirm}
          </button>
        </div>
      </Sheet>

      <Sheet open={step === 'owns_org'} onClose={() => setStep(undefined)} variant="confirm">
        <h3>{DELETE_ACCOUNT_COPY.ownsOrgTitle}</h3>
        <p>{DELETE_ACCOUNT_COPY.ownsOrgBody}</p>
        <div className="confirm-row">
          <button type="button" className="btn ghost press-fb" onClick={() => setStep(undefined)}>
            {DELETE_ACCOUNT_COPY.close}
          </button>
          <button
            type="button"
            className="btn primary press-fb"
            onClick={() => openExternal(SUPPORT_MAILTO)}
          >
            {DELETE_ACCOUNT_COPY.emailSupport}
          </button>
        </div>
      </Sheet>

      <Sheet open={step === 'done'} onClose={finish} variant="confirm">
        <h3>{DELETE_ACCOUNT_COPY.doneTitle}</h3>
        <p>{DELETE_ACCOUNT_COPY.doneBody}</p>
        {appleNote ? <p>{DELETE_ACCOUNT_COPY.appleNote}</p> : null}
        <div className="confirm-row">
          <button type="button" className="btn primary press-fb" onClick={finish}>
            {DELETE_ACCOUNT_COPY.done}
          </button>
        </div>
      </Sheet>
    </>
  );
}
