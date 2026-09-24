// The sign-in surface. It appears only when this build has accounts configured
// (Supabase keys present); otherwise OpenShore is local-first and shows nothing
// here. It follows the conventional pattern: one primary action whose label and
// heading track a Sign in / Create account mode toggle, with a passwordless
// magic link offered underneath. Creating an account asks the person to state
// they are 18 or older (self-declared, no ID, advisory org ruling) and says,
// under the button, which terms they agree to by creating it.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { MINIMUM_AGE, PRIVACY_URL, TERMS_URL } from '../lib/legal.js';
import { ExternalLink } from './ExternalLink.js';

type Mode = 'signin' | 'signup';

export function SignInCard() {
  const { showToast } = useApp();
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
  } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [addr, setAddr] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPw, setNewPw] = useState('');
  // Create-account only: the self-declared age line. Never pre-checked.
  const [adult, setAdult] = useState(false);

  if (!configured) return null;

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
        showToast(err instanceof Error ? err.message : String(err));
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
          <input
            type="password"
            placeholder="New password"
            aria-label="New password"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveNewPw()}
          />
        </div>
        <button
          className="btn primary"
          style={{ width: '100%' }}
          disabled={busy}
          onClick={() => void saveNewPw()}
        >
          {busy ? 'Working...' : 'Save new password'}
        </button>
      </div>
    );
  }

  if (signedIn) {
    return (
      <div className="card">
        <div className="card-row">
          <div className="grow">
            <h3>Signed in</h3>
            <div className="sub">
              {email}
              {role ? ` · ${role}` : ''}
            </div>
          </div>
          <button
            className="btn ghost"
            style={{ padding: '8px 14px' }}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // Field validation up front so the primary action never fails silently.
  // `creating` marks the paths that can make a new account (the create button,
  // and the magic link from create mode); only those ask for the age line.
  const guard = (needPassword: boolean, creating = false): boolean => {
    if (!addr.trim()) {
      showToast('Enter your email.');
      return false;
    }
    if (creating && !adult) {
      showToast(`Confirm you're ${MINIMUM_AGE} or older to create an account.`);
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

  const run = async (
    needPassword: boolean,
    fn: () => Promise<unknown>,
    done: string,
    creating = false,
  ) => {
    if (!guard(needPassword, creating)) return;
    setBusy(true);
    try {
      await fn();
      showToast(done);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (mode === 'signin') {
      return run(true, () => signIn(addr, pw), 'Signed in.');
    }
    return run(
      true,
      async () => {
        const { needsConfirmation } = await signUp(addr, pw);
        showToast(
          needsConfirmation
            ? 'Account created. Check your email to confirm.'
            : 'Account created. You are signed in.',
        );
      },
      '',
      true,
    );
  };

  return (
    <div className="card">
      <h3>{mode === 'signin' ? 'Sign in' : 'Create account'}</h3>
      <div className="sub" style={{ marginBottom: 10 }}>
        {mode === 'signin'
          ? 'Sign in to sync your company account and role. Chat needs no account. Personal, sync, and teams do.'
          : 'Create an account to sync your company role across your devices. Chat needs no account. Personal, sync, and teams do.'}
      </div>
      <div className="field">
        <input
          type="email"
          placeholder="you@company.com"
          aria-label="Email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
      </div>
      <div className="field">
        <input
          type="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </div>
      {mode === 'signup' ? (
        <label className="consent-check">
          <input
            type="checkbox"
            required
            checked={adult}
            onChange={(e) => setAdult(e.target.checked)}
          />
          <span>I'm {MINIMUM_AGE} or older.</span>
        </label>
      ) : null}
      <button
        className="btn primary"
        style={{ width: '100%' }}
        disabled={busy || (mode === 'signup' && !adult)}
        onClick={() => void submit()}
      >
        {busy ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
      {mode === 'signup' ? (
        <p className="sub consent-terms">
          By creating an account you agree to the{' '}
          <ExternalLink href={TERMS_URL}>Terms of Use</ExternalLink> and the{' '}
          <ExternalLink href={PRIVACY_URL}>Privacy Policy</ExternalLink>.
        </p>
      ) : null}
      <div className="sub" style={{ marginTop: 10, textAlign: 'center' }}>
        {mode === 'signin' ? (
          <>
            New to OpenShore?{' '}
            <button className="linklike" disabled={busy} onClick={() => setMode('signup')}>
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button className="linklike" disabled={busy} onClick={() => setMode('signin')}>
              Sign in
            </button>
          </>
        )}
      </div>
      <div className="sub" style={{ marginTop: 6, textAlign: 'center' }}>
        <button
          className="linklike"
          disabled={busy}
          onClick={() =>
            void run(
              false,
              // Only create mode (past the 18+ checkbox) may create an account.
              () => sendMagicLink(addr, { createAccount: mode === 'signup' }),
              'Check your email for a sign-in link.',
              mode === 'signup',
            )
          }
        >
          Email me a link instead
        </button>
      </div>
      {mode === 'signin' ? (
        <div className="sub" style={{ marginTop: 6, textAlign: 'center' }}>
          <button
            className="linklike"
            disabled={busy}
            onClick={() =>
              void run(false, () => sendPasswordReset(addr), 'Check your email for a reset link.')
            }
          >
            Forgot your password?
          </button>
        </div>
      ) : (
        <div className="sub" style={{ marginTop: 6, textAlign: 'center' }}>
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
        </div>
      )}
    </div>
  );
}
