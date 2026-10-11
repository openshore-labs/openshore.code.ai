// The sign-in sheet for a feature that needs an account (lib/accountGate.ts).
// It opens where the person tapped, says in one line what needs the account
// and what signing in gives, and holds the sign-in card itself, so nobody is
// sent off to Settings to find it. Signing in closes it and carries on to the
// room that was asked for (store.onSignedIn). "Not now" leaves them where they
// were, with chat still open: the dismiss costs nothing.
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { SignInCard } from './SignInCard.js';
import { useApp } from '../state/store.js';
import { ACCOUNT_GATE_BODY, ACCOUNT_GATE_TITLE } from '../lib/accountGate.js';

export function AccountGateSheet() {
  const feature = useApp((s) => s.accountGate);
  const close = useApp((s) => s.closeAccountGate);
  return (
    <Sheet open={Boolean(feature)} onClose={close} className="account-gate">
      {feature ? (
        <>
          <SheetHead title={ACCOUNT_GATE_TITLE[feature]} onClose={close} />
          <p className="sheet-sub">{ACCOUNT_GATE_BODY}</p>
          <SignInCard />
          <div className="sheet-actions">
            <button type="button" className="btn ghost press-fb" onClick={close}>
              Not now
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
