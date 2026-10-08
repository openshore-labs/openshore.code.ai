// The sign-in surface. It appears only when this build has accounts configured
// (Supabase keys present); otherwise OpenShore is local-first and shows nothing
// here. It follows the conventional pattern: one primary action whose label and
// heading track a Sign in / Create account mode toggle, with a passwordless
// magic link offered underneath.
//
// Sign out deletes the account's unsent team vault text from this device
// (R-19: text typed under one account never replays under another's). Team
// text stashed offline does not show under Not saved, so a sign-out with any
// left asks first, and deleting it is its own button, never a silent wipe.
//
// Sign out ends this device's sign-in only (CX ruling 4). A quiet link below
// it ends every device's, after one confirm (state/signinOps.ts).
import { featureOn } from '../lib/focus.js';
import { SIGNED_IN_PERKS, accountCopy } from '../lib/accountGate.js';
import { useId, useState } from 'react';
import { useApp } from '../state/store.js';
import { PAY_GATES_ENABLED } from '../lib/payGate.js';

// The pitch for this build: what signing in opens with the pay gates off or on.
const pitch = accountCopy(PAY_GATES_ENABLED).pitch;
import { useAuth } from '../hooks/useAuth.js';
import { plainError } from '../lib/plainError.js';
import { Sheet } from './Sheet.js';
import {
  SIGNING_OUT_EVERYWHERE,
  SIGN_OUT_EVERYWHERE_BODY,
  SIGN_OUT_EVERYWHERE_LINK,
  SIGN_OUT_EVERYWHERE_TITLE,
} from '../state/signinOps.js';

type Mode = 'signin' | 'signup';

/** An address as the account knows it, so "Me@x.com " and "me@x.com" are
 *  the one address waiting on its link. */
function addressKey(addr: string): string {
  return addr.trim().toLowerCase();
}

/** Whether a refused sign-in was refused because the address is not
 *  confirmed yet, the one case where resending the link is the way in. */
export function awaitsConfirmation(err: unknown): boolean {
  return /email not confirmed/i.test(err instanceof Error ? err.message : String(err));
}

/** The sign-out ask's body, for this many unsent team vault notes. */
export function unsentTeamTextBody(n: number): string {
  const which = n === 1 ? 'One team vault note has' : `${n} team vault notes have`;
  return `${which} text that has not reached your team yet. Signing out deletes it from this device.`;
}

export function SignInCard({
  variant,
  onModeChange,
}: {
  variant?: 'profile' | 'sheet';
  /** Told when the form switches between Sign in and Create account, so a
   *  sheet's own head can follow it. */
  onModeChange?: (mode: Mode) => void;
} = {}) {
  const { showToast, unsentTeamTextCount } = useApp();
  const {
    configured,
    signedIn,
    email,
    role,
    passwordRecovery,
    signIn,
    signUp,
    sendMagicLink,
    sendPasswordReset,
    resendConfirmation,
    updateMyPassword,
    signOut,
    signOutEverywhere,
  } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const switchMode = (m: Mode) => {
    setMode(m);
    onModeChange?.(m);
  };
  const [addr, setAddr] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPw, setNewPw] = useState('');
  // Unsent team vault notes a sign-out would delete; above zero, the ask is open.
  const [unsent, setUnsent] = useState(0);
  // Which sign-out the ask stands in front of, and the confirm before every
  // device signs out.
  const [unsentFor, setUnsentFor] = useState<'here' | 'everywhere'>('here');
  const [everywhere, setEverywhere] = useState(false);
  // "Sign out everywhere" waits on the server (CX cleanup 7): while it does,
  // both controls hold and a status line takes the link's place, so a second
  // tap cannot fire and the wait is visible. The toasts say how it ended.
  const [leaving, setLeaving] = useState(false);
  // The address that waits on its confirmation link: a sign-up sent one, or a
  // sign-in was refused until it is confirmed. While the field still holds
  // it, Resend confirmation takes the magic link's line, so the sheet offers
  // two doors under its button, never three.
  const [awaiting, setAwaiting] = useState<string | undefined>();
  const awaitingHere = awaiting !== undefined && awaiting === addressKey(addr);
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

  // A password-reset link signs the user in with a recovery session. Prompt for
  // a new password before anything else, so the reset actually completes.
  if (signedIn && passwordRecovery) {
    const saveNewPw = async () => {
      if (newPw.length < 8) {
        showToast('Use at least 8 characters for your password.');
        return;
      }
      setBusy(true);
      try {
        await updateMyPassword(newPw);
        setNewPw('');
      } catch (err) {
        showToast(plainError(err));
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="card">
        <h3>Set a new password</h3>
        <div className="sub" style={{ marginBottom: 10 }}>
          You are signed in from the reset link. Choose a new password to finish.
        </div>
        <div className="field">
          <label htmlFor={`${fieldId}-new-password`}>New password</label>
          <input
            id={`${fieldId}-new-password`}
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveNewPw()}
          />
        </div>
        <button className="btn primary block" disabled={busy} onClick={() => void saveNewPw()}>
          {busy ? 'Saving...' : 'Save new password'}
        </button>
      </div>
    );
  }

  if (signedIn) {
    return (
      <>
        <div className="card">
          <div className="card-row">
            <div className="grow">
              {/* The profile already names the account and lists what
                  follows you (CX, 2026-10-02), so there the card is only
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

  // Field validation up front so the primary action never fails silently.
  const guard = (needPassword: boolean): boolean => {
    if (!addr.trim()) {
      showToast('Enter your email.');
      return false;
    }
    if (needPassword && !pw) {
      showToast('Enter your password.');
      return false;
    }
    if (needPassword && mode === 'signup' && pw.length < 8) {
      showToast('Use at least 8 characters for your password.');
      return false;
    }
    return true;
  };

  const run = async (needPassword: boolean, fn: () => Promise<unknown>, done: string) => {
    if (!guard(needPassword)) return;
    setBusy(true);
    try {
      await fn();
      showToast(done);
    } catch (err) {
      showToast(plainError(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (mode === 'signin') {
      return run(
        true,
        async () => {
          try {
            await signIn(addr, pw);
          } catch (err) {
            if (awaitsConfirmation(err)) setAwaiting(addressKey(addr));
            throw err;
          }
        },
        'Signed in.',
      );
    }
    return run(
      true,
      async () => {
        const { needsConfirmation } = await signUp(addr, pw);
        if (needsConfirmation) setAwaiting(addressKey(addr));
        showToast(
          needsConfirmation
            ? 'Account created. Check your email to confirm.'
            : 'Account created. You are signed in.',
        );
      },
      '',
    );
  };

  const pitchLine =
    mode === 'signin'
      ? featureOn('teams')
        ? `Sign in to sync your company account and role. ${pitch}`
        : pitch
      : featureOn('teams')
        ? `Create an account to sync your company role across your devices. ${pitch}`
        : `Creating an account is free. ${pitch}`;
  // In a sheet the sheet's own head names the mode, so the form sits on the
  // sheet itself: no card inside a card, and no second title.
  const inSheet = variant === 'sheet';

  return (
    <>
      <div className={inSheet ? undefined : 'card'}>
        {inSheet ? (
          <p className="sheet-sub">{pitchLine}</p>
        ) : (
          <>
            <h3>{mode === 'signin' ? 'Sign in' : 'Create account'}</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              {pitchLine}
            </div>
          </>
        )}
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
          />
        </div>
        <div className="field">
          <div className="field-label-row">
            <label htmlFor={`${fieldId}-password`}>Password</label>
            {mode === 'signin' ? (
              <button
                type="button"
                className="linklike"
                disabled={busy}
                onClick={() =>
                  void run(
                    false,
                    () => sendPasswordReset(addr),
                    'Check your email for a reset link.',
                  )
                }
              >
                Forgot your password?
              </button>
            ) : null}
          </div>
          <input
            id={`${fieldId}-password`}
            type="password"
            placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        <button className="btn primary block" disabled={busy} onClick={() => void submit()}>
          {busy
            ? mode === 'signin'
              ? 'Signing in...'
              : 'Creating account...'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
        </button>
        <div className="sub" style={{ marginTop: 10, textAlign: 'center' }}>
          {mode === 'signin' ? (
            <>
              New to OpenShore?{' '}
              <button className="linklike" disabled={busy} onClick={() => switchMode('signup')}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button className="linklike" disabled={busy} onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </>
          )}
        </div>
        <div className="sub" style={{ marginTop: 6, textAlign: 'center' }}>
          {awaitingHere ? (
            <button
              className="linklike"
              disabled={busy}
              onClick={() =>
                void run(
                  false,
                  () => resendConfirmation(addr),
                  'Confirmation email sent again. Check your inbox.',
                )
              }
            >
              Resend confirmation email
            </button>
          ) : (
            <button
              className="linklike"
              disabled={busy}
              onClick={() =>
                void run(false, () => sendMagicLink(addr), 'Check your email for a sign-in link.')
              }
            >
              Email me a link instead
            </button>
          )}
        </div>
      </div>
      {signOutAsk}
      {everywhereAsk}
    </>
  );
}
