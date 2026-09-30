// Delete account (Apple 5.1.1(v); CX ruling 3, 2026-09-29): a danger row in
// the Your account sheet, below the signed-in card, shown only while signed
// in, two taps from Settings. One confirm sheet, one irreversible choice; no
// "erase this device" here (that belongs beside Clear conversations). The
// work is state/accountDeletion.ts, reached through the store; this is only
// what the person sees, so it takes the call as a prop and mounts in a test.
//
// Four sheets, one at a time: the ask, "One step first" when the person owns
// a team with other people in it, the goodbye, and "This device is signed
// out" when the sign-in died underneath (the account deleted, here on an
// earlier try or on another device, or signed out everywhere). Each is a
// presence-aware Sheet, so the ask plays its exit while the next one
// arrives, and the goodbye and the signed-out note outlive the signed-in
// state that drew the row. A failure, a subscription that could not be
// stopped, the live 2026-09-24 function asking for a recent sign-in, or an
// answer nobody could confirm (the server found no account and the auth
// server could not say why), is a line in the ask itself, with the choice
// left open. Only the lines for a refusal the server named say "was not
// deleted"; the unconfirmed one never does.
//
// The support address is the one published address (SUPPORT_EMAIL, founder
// decision F1), read from the engine's constant so the app, the Terms and the
// server's ladder cannot drift apart (app/test/contactAddress.test.ts).
import { useState } from 'react';
import { SUPPORT_EMAIL } from 'os-code/protocol';
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
  unconfirmed:
    'We could not confirm whether your account was deleted. Check your connection and try again.',
  billing: `Your account was not deleted: a subscription could not be stopped. Try again, or write to ${SUPPORT_EMAIL}.`,
  reauth:
    'Your account was not deleted. For your safety, this needs a recent sign-in: sign out, sign back in, then delete your account within ten minutes.',
  ownsOrgTitle: 'One step first',
  ownsOrgBody: `You own a team with other people in it, so this account cannot be deleted yet. Email ${SUPPORT_EMAIL} and we will hand the team over or close it with you.`,
  emailSupport: 'Email support',
  close: 'Close',
  signedOutTitle: 'This device is signed out',
  signedOutBody:
    "This device's sign-in is no longer valid, so it has been signed out. If your account was already deleted, here or on another device, it is gone. If not, sign in again and try once more.",
  doneTitle: 'Your account is deleted',
  doneBody: 'This device is signed out. Your chats and projects are still here.',
  appleNote:
    'Your Apple subscription is separate. Cancel it on your iPhone in Settings, then your name, then Subscriptions, or it keeps renewing.',
  appleNoteIf:
    'If you pay for Personal through Apple, that subscription is separate. Cancel it on your iPhone in Settings, then your name, then Subscriptions, or it keeps renewing.',
  done: 'Done',
} as const;

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

type Step = 'ask' | 'owns_org' | 'done' | 'signed_out' | undefined;
/** A line in the ask after a try that did not delete. */
type Notice = 'failed' | 'unconfirmed' | 'billing' | 'reauth' | undefined;

const NOTICE_COPY: Record<NonNullable<Notice>, string> = {
  failed: DELETE_ACCOUNT_COPY.failed,
  unconfirmed: DELETE_ACCOUNT_COPY.unconfirmed,
  billing: DELETE_ACCOUNT_COPY.billing,
  reauth: DELETE_ACCOUNT_COPY.reauth,
};

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
  const [notice, setNotice] = useState<Notice>(undefined);
  // true: the server says the person pays through Apple; undefined: it did
  // not say (the 2026-09-24 function), so the note is an if.
  const [appleNote, setAppleNote] = useState<boolean | undefined>(false);

  const ask = () => {
    setNotice(undefined);
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
    setNotice(undefined);
    const outcome = await onDelete().catch((): DeleteAccountOutcome => ({ kind: 'failed' }));
    setBusy(false);
    if (outcome.kind === 'deleted') {
      setAppleNote(outcome.appleNote);
      setStep('done');
    } else if (outcome.kind === 'owns_org') {
      setStep('owns_org');
    } else if (outcome.kind === 'signed_out') {
      setStep('signed_out');
    } else if (outcome.kind === 'reauth_required') {
      setNotice('reauth');
    } else if (outcome.kind === 'billing') {
      setNotice('billing');
    } else if (outcome.kind === 'unconfirmed') {
      setNotice('unconfirmed');
    } else {
      setNotice('failed');
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
        {notice ? (
          <p className="confirm-failed" role="alert">
            {NOTICE_COPY[notice]}
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

      <Sheet open={step === 'signed_out'} onClose={() => setStep(undefined)} variant="confirm">
        <h3>{DELETE_ACCOUNT_COPY.signedOutTitle}</h3>
        <p>{DELETE_ACCOUNT_COPY.signedOutBody}</p>
        <div className="confirm-row">
          <button type="button" className="btn primary press-fb" onClick={() => setStep(undefined)}>
            {DELETE_ACCOUNT_COPY.close}
          </button>
        </div>
      </Sheet>

      <Sheet open={step === 'done'} onClose={finish} variant="confirm">
        <h3>{DELETE_ACCOUNT_COPY.doneTitle}</h3>
        <p>{DELETE_ACCOUNT_COPY.doneBody}</p>
        {appleNote === true ? <p>{DELETE_ACCOUNT_COPY.appleNote}</p> : null}
        {appleNote === undefined ? <p>{DELETE_ACCOUNT_COPY.appleNoteIf}</p> : null}
        <div className="confirm-row">
          <button type="button" className="btn primary press-fb" onClick={finish}>
            {DELETE_ACCOUNT_COPY.done}
          </button>
        </div>
      </Sheet>
    </>
  );
}
