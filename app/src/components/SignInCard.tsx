// The sign-in surface. It appears only when this build has accounts configured
// (Supabase keys present); otherwise OpenShore is local-first and shows nothing
// here. It follows the conventional pattern: one primary action whose label and
// heading track a Sign in / Create account mode toggle, with a passwordless
// magic link offered underneath.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';

type Mode = 'signin' | 'signup';

export function SignInCard() {
  const { showToast } = useApp();
  const { configured, signedIn, email, role, signIn, signUp, sendMagicLink, signOut } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [addr, setAddr] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  if (!configured) return null;

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
    );
  };

  return (
    <div className="card">
      <h3>{mode === 'signin' ? 'Sign in' : 'Create account'}</h3>
      <div className="sub" style={{ marginBottom: 10 }}>
        {mode === 'signin'
          ? 'Sign in to sync your company account and role. Personal use needs no account.'
          : 'Create an account to sync your company role across your devices. Personal use needs no account.'}
      </div>
      <div className="field">
        <input
          type="email"
          placeholder="you@company.com"
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
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </div>
      <button
        className="btn primary"
        style={{ width: '100%' }}
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
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
            void run(false, () => sendMagicLink(addr), 'Check your email for a sign-in link.')
          }
        >
          Email me a link instead
        </button>
      </div>
    </div>
  );
}
