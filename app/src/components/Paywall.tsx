// The Personal upgrade sheet. Free is chat only; tapping the coding agent or the
// Marketplace opens this. Copy is the CMO's. Two variants: on iOS the purchase
// is an Apple In-App Purchase and the sheet names no web price and links out to
// nothing (Apple 3.1.1 / 3.1.3); on desktop it opens Stripe checkout in the
// browser. Chat keeps working behind this, so the dismiss is non-punitive.
import { useApp } from '../state/store.js';
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
  if (!reason) return null;

  const ios = iapAvailable();
  const headline = reason === 'marketplace' ? 'Unlock the Marketplace.' : 'Unlock the agent.';
  const subhead =
    reason === 'marketplace'
      ? 'Free covers chat with the models you already run in Harbor or Ollama. Personal adds the full catalog, rated against your hardware, and the coding agent.'
      : 'Chat is yours for free. Personal turns OS Code into a coding agent that reads your repo, writes real edits, and runs the tools to prove them.';
  // The App Store returns the localized price at purchase; $20/year is the set
  // price and the label the founder configures the product at.
  const priceLine = ios
    ? '$20 per year. One person, the whole app.'
    : '$20 per year. One person, the whole app. Same price on iPhone.';
  const primaryLabel = ios ? 'Unlock Personal · $20/year' : 'Get Personal · $20/year (opens your browser)';
  const secondaryLabel = ios ? 'Restore purchases' : 'Already bought? Refresh your license';

  return (
    <div className="sheet-scrim" onClick={() => closePaywall()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
          <button className="btn primary" onClick={() => void buyPersonal()}>
            {primaryLabel}
          </button>
          <button className="btn ghost" onClick={() => void restorePurchases()}>
            {secondaryLabel}
          </button>
          <button className="btn quiet" onClick={() => closePaywall()}>
            Not now. Keep chatting.
          </button>
        </div>
      </div>
    </div>
  );
}
