// The sign-in surface. It appears only when this build has accounts configured
// (Supabase keys present); otherwise OpenShore is local-first and shows nothing
// here. There are no passwords (founder, 2026-10-12): one email field and one
// button send an email with a 6-digit code and a link, and the code is typed
// here, the way in from any device. The same step makes a new account, so
// there is no Sign in / Create account toggle, and no copy that would tell
// anyone whether an address has an account (CX, 2026-10-12).
//
// Sign out deletes the account's unsent team vault text from this device
// (R-19: text typed under one account never replays under another's). Team
// text stashed offline does not show under Not saved, so a sign-out with any
// left asks first, and deleting it is its own button, never a silent wipe.
//
// Sign out ends this device's sign-in only (UX review ruling 4). A quiet link below
// it ends every device's, after one confirm (state/signinOps.ts).
import { featureOn } from '../lib/focus.js';
import { ACCOUNT_PITCH, SIGNED_IN_PERKS } from '../lib/accountGate.js';
import { useEffect, useId, useState } from 'react';
import { useApp } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { plainError } from '../lib/plainError.js';
import { isDesktop, openExternal } from '../lib/platform.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';
import { PRIVACY_URL, TERMS_URL } from '../lib/legalLinks.js';
import { Sheet } from './Sheet.js';
import {
  SIGN_IN_WITH_EMAIL,
  SIGN_IN_WITH_PASSKEY,
  passkeyProblem,
  passkeysAvailable,
} from '../lib/passkeys.js';
import {
  SIGNING_OUT_EVERYWHERE,
  SIGN_OUT_EVERYWHERE_BODY,
  SIGN_OUT_EVERYWHERE_LINK,
  SIGN_OUT_EVERYWHERE_TITLE,
} from '../state/signinOps.js';
import {
  CHECK_TITLE,
  CODE_LABEL,
  CODE_LENGTH,
  CODE_REFUSED,
  CONSENT_LEAD,
  DIFFERENT_EMAIL,
  EMAIL_STEP_SUB,
  NEW_CODE_SENT,
  PASSWORDS_GONE,
  RATE_LIMITED,
  RESEND_WAIT_S,
  SEND_CODE,
  SEND_NEW_CODE,
  SENDING,
  SIGNED_IN,
  SIGNING_IN,
  SIGN_IN,
  checkBody,
  codeDigits,
  rateLimited,
  resendIn,
} from '../state/emailSignInOps.js';

/** The sign-out ask's body, for this many unsent team vault notes. */
export function unsentTeamTextBody(n: number): string {
  const which = n === 1 ? 'One team vault note has' : `${n} team vault notes have`;
  return `${which} text that has not reached your team yet. Signing out deletes it from this device.`;
}

export function SignInCard({ variant }: { variant?: 'profile' | 'sheet' } = {}) {
  const { showToast, unsentTeamTextCount, settings } = useApp();
  const {
    configured,
    signedIn,
    email,
    role,
    sendSignInEmail,
    verifySignInCode,
    signOut,
    signOutEverywhere,
  } = useAuth();
  const [addr, setAddr] = useState('');
  // The address the newest email went to, and when: set, the card is on its
  // check step, with the code field.
  const [sentTo, setSentTo] = useState<string | undefined>();
  const [sentAt, setSentAt] = useState(0);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // Passkeys, where this device can make and use one (lib/passkeys.ts). A
  // device that has used one leads with it; email is a link under it then.
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [emailChosen, setEmailChosen] = useState(false);
  useEffect(() => {
    if (!signedIn) void passkeysAvailable().then(setPasskeyOk);
  }, [signedIn]);
  // A clock for the resend countdown, ticking only while it counts.
  const [now, setNow] = useState(() => Date.now());
  const waitLeft = sentTo ? Math.max(0, RESEND_WAIT_S - Math.floor((now - sentAt) / 1000)) : 0;
  useEffect(() => {
    if (waitLeft <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitLeft]);
  // Unsent team vault notes a sign-out would delete; above zero, the ask is open.
  const [unsent, setUnsent] = useState(0);
  // Which sign-out the ask stands in front of, and the confirm before every
  // device signs out.
  const [unsentFor, setUnsentFor] = useState<'here' | 'everywhere'>('here');
  const [everywhere, setEverywhere] = useState(false);
  // "Sign out everywhere" waits on the server (UX review cleanup 7): while it does,
  // both controls hold and a status line takes the link's place, so a second
  // tap cannot fire and the wait is visible. The toasts say how it ended.
  const [leaving, setLeaving] = useState(false);
  // Each field's label names it (useId: the card can sit in more than one
  // sheet, so a fixed id could repeat).
  const fieldId = useId();

  if (!configured) return null;

  // The ask before a sign-out that would delete unsent team text. It sits in
  // the same place whether signed in or not, so when "Sign out and delete"
  // lands the sheet keeps playing its exit instead of vanishing with the
  // signed-in card.
  const signOutAsk = (
    <Sheet open={unsent > 0} onClose={() => setUnsent(0)} variant="confirm">
      {unsent > 0 ? (
        <>
          <h3>Team text not sent yet</h3>
          <p>{unsentTeamTextBody(unsent)}</p>
          <div className="confirm-row">
            <button type="button" className="btn primary press-fb" onClick={() => setUnsent(0)}>
              Stay signed in
            </button>
            <button
              type="button"
              className="btn danger press-fb"
              onClick={() => {
                setUnsent(0);
                void (unsentFor === 'everywhere' ? everywhereNow() : signOut());
              }}
            >
              Sign out and delete
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );

  // The confirm before every device signs out. Outside the signed-in card for
  // the same reason as the ask above: its exit plays after the card is gone.
  const everywhereAsk = (
    <Sheet open={everywhere} onClose={() => setEverywhere(false)} variant="confirm">
      <h3>{SIGN_OUT_EVERYWHERE_TITLE}</h3>
      <p>{SIGN_OUT_EVERYWHERE_BODY}</p>
      <div className="confirm-row">
        <button type="button" className="btn ghost press-fb" onClick={() => setEverywhere(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn danger press-fb"
          onClick={() => {
            setEverywhere(false);
            void askSignOut('everywhere');
          }}
        >
          {SIGN_OUT_EVERYWHERE_LINK}
        </button>
      </div>
    </Sheet>
  );

  const everywhereNow = async () => {
    setLeaving(true);
    try {
      await signOutEverywhere();
    } finally {
      setLeaving(false);
    }
  };

  // With nothing unsent, each sign-out goes ahead, as it always has.
  const askSignOut = async (scope: 'here' | 'everywhere') => {
    const n = await unsentTeamTextCount().catch(() => 0);
    setUnsentFor(scope);
    if (n > 0) setUnsent(n);
    else await (scope === 'everywhere' ? everywhereNow() : signOut());
  };

  if (signedIn) {
    return (
      <>
        <div className="card">
          <div className="card-row">
            <div className="grow">
              {/* The profile already names the account and lists what
                  follows you (UX review, 2026-10-02), so there the card is only
                  the way out. */}
              {variant === 'profile' ? (
                <div className="sub">Signing out keeps everything on this device.</div>
              ) : (
                <>
                  <h3>Signed in</h3>
                  <div className="sub">
                    {email}
                    {role ? ` · ${role}` : ''}
                  </div>
                  <div className="sub">{SIGNED_IN_PERKS}</div>
                </>
              )}
            </div>
            <button
              type="button"
              className="btn ghost sm press-fb"
              disabled={leaving}
              onClick={() => void askSignOut('here')}
            >
              Sign out
            </button>
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            {leaving ? (
              <span role="status">{SIGNING_OUT_EVERYWHERE}</span>
            ) : (
              <button type="button" className="linklike" onClick={() => setEverywhere(true)}>
                {SIGN_OUT_EVERYWHERE_LINK}
              </button>
            )}
          </div>
        </div>
        {signOutAsk}
        {everywhereAsk}
      </>
    );
  }

  const send = async (again: boolean) => {
    const to = addr.trim();
    if (!to) {
      setProblem('Enter your email.');
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await sendSignInEmail(to);
      setSentTo(to);
      setSentAt(Date.now());
      setNow(Date.now());
      setCode('');
      if (again) showToast(NEW_CODE_SENT);
    } catch (err) {
      setProblem(rateLimited(err) ? RATE_LIMITED : plainError(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (typed: string) => {
    if (!sentTo || busy) return;
    if (!codeDigits(typed)) {
      setProblem(CODE_REFUSED);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await verifySignInCode(sentTo, typed);
      showToast(SIGNED_IN);
    } catch (err) {
      setCode('');
      setProblem(
        rateLimited(err) ? RATE_LIMITED : err instanceof Error ? err.message : plainError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const withPasskey = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      await useApp.getState().signInWithPasskey();
      showToast(SIGNED_IN);
    } catch (err) {
      setProblem(passkeyProblem(err));
    } finally {
      setBusy(false);
    }
  };
  const passkeyFirst = passkeyOk && settings.passkeyUsedHere === true && !emailChosen;

  // The one line under the email button: making an account is now a side
  // effect of the first email, so the notice says what continuing accepts.
  const consent = (
    <div className="sub sign-in-consent">
      {CONSENT_LEAD}{' '}
      <button type="button" className="linklike" onClick={() => openExternal(TERMS_URL)}>
        Terms of Use
      </button>{' '}
      and{' '}
      <button type="button" className="linklike" onClick={() => openExternal(PRIVACY_URL)}>
        Privacy Policy
      </button>
      .
    </div>
  );

  const problemLine = problem ? (
    <p className="hint sign-in-problem" role="alert">
      {problem}
    </p>
  ) : null;

  // In a sheet the sheet's own head names it, so the form sits on the sheet
  // itself: no card inside a card, and no second title.
  const inSheet = variant === 'sheet';

  if (sentTo) {
    const device = isDesktop() ? 'this computer' : thisDeviceNoun();
    return (
      <>
        <div className={inSheet ? undefined : 'card'}>
          {inSheet ? null : <h3>{CHECK_TITLE}</h3>}
          <p className={inSheet ? 'sheet-sub' : 'sub'}>
            {inSheet ? <strong>{CHECK_TITLE}. </strong> : null}
            {checkBody(sentTo, device)}
          </p>
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
              onChange={(e) => {
                const next = e.target.value;
                setCode(next);
                // The sixth digit is the submit: nothing else to tap.
                if (codeDigits(next)) void verify(next);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void verify(code)}
            />
          </div>
          {problemLine}
          <button
            type="button"
            className="btn primary block"
            disabled={busy}
            onClick={() => void verify(code)}
          >
            {busy ? SIGNING_IN : SIGN_IN}
          </button>
          <div className="sub sign-in-doors">
            {waitLeft > 0 ? (
              <span>{resendIn(waitLeft)}</span>
            ) : (
              <button
                type="button"
                className="linklike"
                disabled={busy}
                onClick={() => void send(true)}
              >
                {SEND_NEW_CODE}
              </button>
            )}
          </div>
          <div className="sub sign-in-doors">
            <button
              type="button"
              className="linklike"
              disabled={busy}
              onClick={() => {
                setSentTo(undefined);
                setCode('');
                setProblem(undefined);
              }}
            >
              {DIFFERENT_EMAIL}
            </button>
          </div>
        </div>
        {signOutAsk}
        {everywhereAsk}
      </>
    );
  }

  // Someone who signed in on this device before passwords went is told once,
  // here, until their first email sign-in (CX Q4).
  const passwordsGone = Boolean(settings.prefsOwner) && !settings.passwordsGoneSeen;
  const pitchLine = [
    passwordsGone ? PASSWORDS_GONE : EMAIL_STEP_SUB,
    featureOn('teams') ? 'Your company account and role sync once you are in.' : '',
    inSheet ? '' : ACCOUNT_PITCH,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className={inSheet ? undefined : 'card'}>
        {inSheet ? (
          <p className="sheet-sub">{pitchLine}</p>
        ) : (
          <>
            <h3>{SIGN_IN}</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              {pitchLine}
            </div>
          </>
        )}
        {passkeyFirst ? (
          <>
            {problemLine}
            <button
              type="button"
              className="btn primary block"
              disabled={busy}
              onClick={() => void withPasskey()}
            >
              {SIGN_IN_WITH_PASSKEY}
            </button>
            <div className="sub sign-in-doors">
              <button
                type="button"
                className="linklike"
                disabled={busy}
                onClick={() => setEmailChosen(true)}
              >
                {SIGN_IN_WITH_EMAIL}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`${fieldId}-email`}>Email</label>
              <input
                id={`${fieldId}-email`}
                type="email"
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="email"
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void send(false)}
              />
            </div>
            {problemLine}
            <button
              type="button"
              className="btn primary block"
              disabled={busy}
              onClick={() => void send(false)}
            >
              {busy ? SENDING : SEND_CODE}
            </button>
            {passkeyOk ? (
              <div className="sub sign-in-doors">
                <button
                  type="button"
                  className="linklike"
                  disabled={busy}
                  onClick={() => void withPasskey()}
                >
                  {SIGN_IN_WITH_PASSKEY}
                </button>
              </div>
            ) : null}
          </>
        )}
        {consent}
      </div>
      {signOutAsk}
      {everywhereAsk}
    </>
  );
}
