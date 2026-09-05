// The confirm step for a sign-in link this app did not ask for: a cold start
// from Mail with no request on record, or a link something else opened. It
// names the account the link is for and waits for a deliberate yes, so a
// crafted oscode:// link can never sign this device into an account the
// person never requested (APP-6, CTO ruling 2026-09-05). Presence-aware
// through Sheet, so it leaves the way it came.
import { Sheet } from './Sheet.js';
import { useApp } from '../state/store.js';

export function AuthConfirmSheet() {
  const confirm = useApp((s) => s.authConfirm);
  const confirmAuthCallback = useApp((s) => s.confirmAuthCallback);
  const dismissAuthCallback = useApp((s) => s.dismissAuthCallback);
  const recovery = Boolean(confirm?.recovery);
  const email = confirm?.email ?? '';

  return (
    <Sheet open={Boolean(confirm)} onClose={dismissAuthCallback} variant="confirm">
      {confirm ? (
        <>
          <h3>{recovery ? `Reset the password for ${email}?` : `Sign in as ${email}?`}</h3>
          <p>
            {recovery
              ? 'A password reset link opened OpenShore. Continue only if you asked for it.'
              : 'A sign-in link opened OpenShore. Continue only if you asked for it.'}
          </p>
          <div className="confirm-row">
            <button className="btn ghost press-fb" onClick={dismissAuthCallback}>
              Not me
            </button>
            <button className="btn primary press-fb" onClick={() => void confirmAuthCallback()}>
              {recovery ? 'Continue' : 'Sign in'}
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
