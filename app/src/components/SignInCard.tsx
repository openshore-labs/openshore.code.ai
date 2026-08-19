// The sign-in surface. It appears only when this build has accounts configured
// (Supabase keys present); otherwise OS Code is local-first and shows nothing
// here. Email + password is the primary path; a magic link is offered too.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';

export function SignInCard() {
  const { showToast } = useApp();
  const { configured, signedIn, email, role, signIn, signUp, sendMagicLink, signOut } = useAuth();
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
          <button className="btn ghost" style={{ padding: '8px 14px' }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (!addr.trim()) {
      showToast('Enter your email.');
      return;
    }
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

  return (
    <div className="card">
      <h3>Sign in</h3>
      <div className="sub" style={{ marginBottom: 10 }}>
        Sign in to sync your company account and role. Personal use needs no account.
      </div>
      <div className="field">
        <input
          type="email"
          placeholder="you@company.com"
          autoCapitalize="none"
          autoCorrect="off"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
      </div>
      <div className="field">
        <input
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run(() => signIn(addr, pw), 'Signed in.')}
        />
      </div>
      <button
        className="btn primary"
        style={{ width: '100%' }}
        disabled={busy}
        onClick={() => void run(() => signIn(addr, pw), 'Signed in.')}
      >
        {busy ? 'Working...' : 'Sign in'}
      </button>
      <div className="suggestion-row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <button
          className="suggestion"
          disabled={busy}
          onClick={() =>
            void run(
              () => signUp(addr, pw),
              'Account created. Check your email if confirmation is required.',
            )
          }
        >
          Create account
        </button>
        <button
          className="suggestion"
          disabled={busy}
          onClick={() => void run(() => sendMagicLink(addr), 'Check your email for a sign-in link.')}
        >
          Email me a link
        </button>
      </div>
    </div>
  );
}
