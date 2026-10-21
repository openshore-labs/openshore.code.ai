// Delete account (Apple 5.1.1(v); UX review ruling 3, 2026-09-29): a danger row in
// the Your account sheet, below the signed-in card, shown only while signed
// in, two taps from Settings. One confirm sheet, one irreversible choice; no
// "erase this device" here (that belongs beside Clear conversations). The
// work is state/accountDeletion.ts, reached through the store; this is only
// what the person sees, so it takes the call as a prop and mounts in a test.
//
// Five sheets, one at a time: the ask, "Confirm it is you" when the server
// wants a recent sign-in, "One step first" when the person owns a team with
// other people in it, the goodbye, and "This device is signed out" when the
// sign-in died underneath (the account deleted, here on an earlier try or on
// another device, or signed out everywhere). Each is a presence-aware Sheet,
// so the ask plays its exit while the next one arrives, and the goodbye and
// the signed-out note outlive the signed-in state that drew the row. A
// failure, a subscription that could not be stopped, or an answer nobody
// could confirm (the server found no account and the auth server could not
// say why), is a line in the sheet itself, with the choice left open. Only
// the lines for a refusal the server named say "was not deleted"; the
// unconfirmed one never does.
//
// A recent sign-in (the security review's F2, 2026-10-21): delete-account
// answers reauth_required when its DELETE_REQUIRE_RECENT_SIGN_IN secret is on
// and this session last signed in more than ten minutes ago. The ask then
// gives way to the code sheet, which emails a fresh 6-digit code to the
// account's own address (the sign-in email), trades it for a new session for
// the same account (the store's confirmByCode), and deletes with that. The
// server decides; this side never asks first, so with the secret off nothing
// here changes, and nothing waits on an email. Without a way to send a code
// (no address on the session), the old line stands: sign out, sign back in.
//
// The support address is the one published address (SUPPORT_EMAIL, maintainer
// decision F1), read from the engine's constant so the app, the Terms and the
// server's ladder cannot drift apart (app/test/contactAddress.test.ts).
import { useEffect, useId, useState } from 'react';
import { SUPPORT_EMAIL } from 'os-code/protocol';
import type { DeleteAccountOutcome, DeleteReauth } from '../state/accountDeletion.js';
import {
  CODE_LABEL,
  CODE_LENGTH,
  CODE_REFUSED,
  NEW_CODE_SENT,
  RATE_LIMITED,
  RESEND_WAIT_S,
  SEND_NEW_CODE,
  SENDING,
  codeDigits,
  rateLimited,
  resendIn,
} from '../state/emailSignInOps.js';
import { hapticCommit } from '../lib/haptics.js';
import { openExternal } from '../lib/platform.js';
import { plainError } from '../lib/plainError.js';
import { Sheet } from './Sheet.js';
import { SettingsRow } from './SettingsRow.js';

/** Every word the flow shows (UX review ruling 3). */
export const DELETE_ACCOUNT_COPY = {
  row: 'Delete account',
  rowSub: 'Erases your account from our server. This device keeps what it has.',
  title: 'Delete your OpenShore account?',
  body: 'This erases your account and the settings that follow you between devices. It cannot be undone. Your chats, projects, and notes on this device stay here, and chatting keeps working without an account. If an operator ever ended this account for abuse, we keep a one-way hash of its email, and any record under a legal hold until the hold ends, as the privacy policy explains.',
  confirm: 'Delete account',
  keep: 'Keep my account',
  working: 'Deleting...',
  failed: 'Your account was not deleted. Check your connection and try again.',
  unconfirmed:
    'We could not confirm whether your account was deleted. Check your connection and try again.',
  billing: `Your account was not deleted: a subscription could not be stopped. Try again, or write to ${SUPPORT_EMAIL}.`,
  reauth:
    'Your account was not deleted. For your safety, this needs a recent sign-in: sign out, sign back in, then delete your account within ten minutes.',
  codeTitle: 'Confirm it is you',
  codeConfirm: 'Confirm and delete',
  codeSendFailed: `We could not send a code. Check your connection, then send a new code. If it keeps failing, write to ${SUPPORT_EMAIL}.`,
  codeAgain:
    'Your account was not deleted. The sign-in was not recent enough, so send a new code and try again.',
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
  done: 'Done',
} as const;

/** The code sheet's body: where the code went, and why it is asked. */
export function deleteCodeBody(email: string): string {
  return `For your safety, deleting your account needs a recent sign-in. We sent a 6-digit code to ${email}. Type it here to delete your account. The code works for 10 minutes.`;
}

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

type Step = 'ask' | 'code' | 'owns_org' | 'done' | 'signed_out' | undefined;
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
  reauth,
  onDone,
}: {
  signedIn: boolean;
  /** The store's deleteAccount: a result, never a throw. */
  onDelete: () => Promise<DeleteAccountOutcome>;
  /** How to prove a recent sign-in by email code (hooks/useAuth.ts). When
   *  absent, a reauth_required answer is the sign-out-and-back-in line. */
  reauth?: DeleteReauth;
  /** After the goodbye: the parent may close the account sheet too. */
  onDone?: () => void;
}) {
  const [step, setStep] = useState<Step>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(undefined);
  // true: the server says the person pays through Apple; undefined: it did
  // not say (the 2026-09-24 function), so the note is an if.
  const [appleNote, setAppleNote] = useState<boolean | undefined>(false);
  // The code sheet: what is typed, its one line (a refusal or a failure, in
  // the warning ink), whether a new code was just sent, the email in flight,
  // when the newest one went (0: none yet, so a new one may be asked for at
  // once), and whether this session is already renewed, so a retry after a
  // failed delete does not ask for a second code.
  const [code, setCode] = useState('');
  const [codeProblem, setCodeProblem] = useState<string | undefined>();
  const [resent, setResent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [verified, setVerified] = useState(false);
  const fieldId = useId();
  // A clock for the resend countdown, ticking only while it counts.
  const [now, setNow] = useState(() => Date.now());
  const waitLeft =
    step === 'code' && sentAt > 0
      ? Math.max(0, RESEND_WAIT_S - Math.floor((now - sentAt) / 1000))
      : 0;
  useEffect(() => {
    if (waitLeft <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitLeft]);

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
      if (reauth) openCode();
      else setNotice('reauth');
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

  // ---- the code sheet (a recent sign-in)
  const sendCode = async (again: boolean) => {
    if (!reauth || sending) return;
    setSending(true);
    setCodeProblem(undefined);
    setResent(false);
    try {
      await reauth.sendCode();
      setSentAt(Date.now());
      setNow(Date.now());
      setResent(again);
    } catch (err) {
      setCodeProblem(rateLimited(err) ? RATE_LIMITED : DELETE_ACCOUNT_COPY.codeSendFailed);
    } finally {
      setSending(false);
    }
  };
  // The ask gives way to the code sheet, and the first code goes out at once:
  // the person has already chosen to delete.
  const openCode = () => {
    setCode('');
    setCodeProblem(undefined);
    setResent(false);
    setVerified(false);
    setSentAt(0);
    setStep('code');
    void sendCode(false);
  };
  // As with the ask, nothing closes the code sheet while the server is at work.
  const closeCode = () => {
    if (!busy) setStep(undefined);
  };
  const confirmAndDelete = async () => {
    if (!reauth || busy) return;
    if (!verified) {
      const digits = codeDigits(code);
      if (!digits) {
        setCodeProblem(CODE_REFUSED);
        return;
      }
      hapticCommit();
      setBusy(true);
      setCodeProblem(undefined);
      setResent(false);
      try {
        await reauth.confirmCode(digits);
      } catch (err) {
        setCode('');
        setCodeProblem(
          rateLimited(err) ? RATE_LIMITED : err instanceof Error ? err.message : plainError(err),
        );
        setBusy(false);
        return;
      }
      setVerified(true);
    } else {
      hapticCommit();
      setBusy(true);
      setCodeProblem(undefined);
    }
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
      // Still not recent enough (a clock far off, or a code from an older
      // email): a new code, from the top.
      setVerified(false);
      setCode('');
      setCodeProblem(DELETE_ACCOUNT_COPY.codeAgain);
    } else {
      setCodeProblem(NOTICE_COPY[outcome.kind]);
    }
  };
  const codeReady = verified || Boolean(codeDigits(code));

  return (
    <>
      {signedIn ? (
        <div className="settings-card account-delete">
          <SettingsRow
            label={DELETE_ACCOUNT_COPY.row}
            sub={DELETE_ACCOUNT_COPY.rowSub}
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

      <Sheet open={step === 'code'} onClose={closeCode} variant="confirm">
        <h3>{DELETE_ACCOUNT_COPY.codeTitle}</h3>
        <p>{deleteCodeBody(reauth?.email ?? '')}</p>
        {verified ? null : (
          <div className="field">
            <label htmlFor={`${fieldId}-code`}>{CODE_LABEL}</label>
            <input
              id={`${fieldId}-code`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={CODE_LENGTH + 2}
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void confirmAndDelete()}
            />
          </div>
        )}
        {codeProblem ? (
          <p className="confirm-failed" role="alert">
            {codeProblem}
          </p>
        ) : resent ? (
          <p role="status">{NEW_CODE_SENT}</p>
        ) : null}
        {verified ? null : (
          <p>
            {sending ? (
              <span>{SENDING}</span>
            ) : waitLeft > 0 ? (
              <span>{resendIn(waitLeft)}</span>
            ) : (
              <button
                type="button"
                className="linklike press-fb"
                disabled={busy}
                onClick={() => void sendCode(true)}
              >
                {SEND_NEW_CODE}
              </button>
            )}
          </p>
        )}
        <div className="confirm-row">
          <button type="button" className="btn ghost press-fb" disabled={busy} onClick={closeCode}>
            {DELETE_ACCOUNT_COPY.keep}
          </button>
          <button
            type="button"
            className="btn danger press-fb"
            disabled={busy || !codeReady}
            onClick={() => void confirmAndDelete()}
          >
            {busy ? DELETE_ACCOUNT_COPY.working : DELETE_ACCOUNT_COPY.codeConfirm}
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
        <div className="confirm-row">
          <button type="button" className="btn primary press-fb" onClick={finish}>
            {DELETE_ACCOUNT_COPY.done}
          </button>
        </div>
      </Sheet>
    </>
  );
}
