// The Personal upgrade sheet. Free is chat only; tapping the coding agent or the
// Marketplace opens this. Copy is the CMO's. Personal is an Apple subscription:
// bought only as an Apple In-App Purchase on iPhone or iPad (Apple 3.1.1 /
// 3.1.3, no web price named there). On web and desktop there is no purchase
// button; the sheet points the user to buy it in the app on their iPhone, then
// refresh here to unlock the same account on this computer. Chat keeps working
// behind this, so the dismiss is non-punitive.
import { useApp } from '../state/store.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { iapAvailable } from '../lib/iap.js';

const BULLETS = [
  'Run the agent on any repo, on your machine',
  'Edits with real diffs, and tool approvals you control',
  'The full model Marketplace, rated against your hardware',
  'Your models, your keys. Nothing routes through us.',
];

export function Paywall() {
  const reason = useApp((s) => s.paywall);
  const buyPersonal = useApp((s) => s.buyPersonal);
  const restorePurchases = useApp((s) => s.restorePurchases);
  const closePaywall = useApp((s) => s.closePaywall);
  // Hooks run unconditionally, before the reason gate.
  const { closing, dismiss } = useSheetExit(closePaywall);
  if (!reason) return null;

  const ios = iapAvailable();
  const headline = reason === 'marketplace' ? 'Unlock the Marketplace.' : 'Unlock the agent.';
  const subhead =
    reason === 'marketplace'
      ? 'Free covers chat with the models you already run in Harbor or Ollama. Personal adds the full catalog, rated against your hardware, and the coding agent.'
      : 'Chat is yours for free. Personal turns OpenShore into a coding agent that reads your repo, writes real edits, and runs the tools to prove them.';
  // The App Store returns the localized price at purchase; $20/year is the set
  // price and the label the founder configures the product at.
  const priceLine = ios
    ? '$20 per year. One person, the whole app.'
    : '$20 per year. One person, the whole app. Bought on your iPhone.';

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
      <div className={`sheet${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <span className="approval-badge tool">Personal</span>
        <h2>{headline}</h2>
        <p className="sheet-sub">{subhead}</p>
        <ul className="paywall-benefits">
          {BULLETS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="paywall-price">{priceLine}</p>
        <div className="sheet-actions">
          {ios ? (
            <button className="btn primary press-fb" onClick={() => void buyPersonal()}>
              Unlock Personal · $20/year
            </button>
          ) : (
            <p className="sheet-sub" style={{ marginTop: 0 }}>
              Personal is an in-app purchase in OS Code on iPhone or iPad. Buy it there, then
              refresh here to unlock it on this computer.
            </p>
          )}
          <button className="btn ghost press-fb" onClick={() => void restorePurchases()}>
            {ios ? 'Restore purchases' : 'I bought it. Unlock'}
          </button>
          <button className="btn quiet press-fb" onClick={dismiss}>
            Not now. Keep chatting.
          </button>
        </div>
      </div>
    </div>
  );
}
