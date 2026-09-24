// The Personal upgrade sheet. Free is chat only; tapping the coding agent or the
// Marketplace opens this. Copy is the CMO's. Personal is an Apple subscription:
// bought only as an Apple In-App Purchase on iPhone or iPad (Apple 3.1.1 /
// 3.1.3, no web price named there). On web and desktop there is no purchase
// button; the sheet points the user to buy it in the app on their iPhone, then
// refresh here to unlock the same account on this computer. Chat keeps working
// behind this, so the dismiss is non-punitive.
//
// The price line carries the auto-renewal disclosure (App Store 3.1.2 and the
// California auto-renewal law): the price in the App Store's own localized
// form when StoreKit answers, who bills it, that it renews, how far ahead to
// turn renewal off, and where to cancel. The Terms of Use and Privacy Policy
// sit under the buttons. To assistive tech the card is a modal dialog; the
// app-root trap (hooks/useSheetFocusTrap.ts) moves focus in, wraps Tab, and
// hands focus back, as it does for every `.sheet`.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { iapAvailable, PERSONAL_YEARLY_PRODUCT_ID, products } from '../lib/iap.js';
import { PRIVACY_URL, TERMS_URL } from '../lib/legal.js';
import { ExternalLink } from './ExternalLink.js';

/** The set price, shown until (or unless) StoreKit returns the localized one.
 *  The founder configures the product at this price in App Store Connect. */
const FALLBACK_PRICE = '$20';

const BULLETS = [
  'Run the agent on any repo, on your machine',
  'Edits with real diffs, and tool approvals you control',
  'The full model Marketplace, rated against your hardware',
  'Your models, your keys. Model calls go straight to your provider, never through us.',
];

export function Paywall() {
  const reason = useApp((s) => s.paywall);
  const buyPersonal = useApp((s) => s.buyPersonal);
  const restorePurchases = useApp((s) => s.restorePurchases);
  const closePaywall = useApp((s) => s.closePaywall);
  // Hooks run unconditionally, before the reason gate.
  const { closing, dismiss } = useSheetExit(closePaywall);
  const [storePrice, setStorePrice] = useState<string | undefined>();
  const open = Boolean(reason);
  // Ask StoreKit for the localized price when the sheet opens on iOS. A failed
  // or empty answer keeps the set price.
  useEffect(() => {
    if (!open || !iapAvailable() || storePrice) return;
    let live = true;
    products([PERSONAL_YEARLY_PRODUCT_ID])
      .then(({ products: list }) => {
        const found = list.find((p) => p.id === PERSONAL_YEARLY_PRODUCT_ID);
        if (live && found?.displayPrice) setStorePrice(found.displayPrice);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, storePrice]);
  if (!reason) return null;

  const ios = iapAvailable();
  const price = storePrice ?? FALLBACK_PRICE;
  const headline = reason === 'marketplace' ? 'Unlock the Marketplace.' : 'Unlock the agent.';
  const subhead =
    reason === 'marketplace'
      ? 'Free covers chat with the models you already run in Harbor or Ollama. Personal adds the full catalog, rated against your hardware, and the coding agent.'
      : 'Chat is yours for free. Personal turns OpenShore into a coding agent that reads your repo, writes real edits, and runs the tools to prove them.';

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
      <div
        className={`sheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="approval-badge tool">Personal</span>
        <h2 id="paywall-title">{headline}</h2>
        <p className="sheet-sub">{subhead}</p>
        <ul className="paywall-benefits">
          {BULLETS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="paywall-price">
          {price} a year, billed through your Apple ID.{' '}
          <span className="paywall-renewal">
            It renews automatically each year unless you turn off auto-renew at least 24 hours
            before the renewal date. Manage or cancel in Settings, then your name, then
            Subscriptions.
          </span>
        </p>
        <div className="sheet-actions">
          {ios ? (
            <button className="btn primary press-fb" onClick={() => void buyPersonal()}>
              Unlock Personal · {price}/year
            </button>
          ) : (
            <p className="sheet-sub" style={{ marginTop: 0 }}>
              Personal is an in-app purchase in OS Code on iPhone or iPad. Buy it there, then
              refresh here to unlock it on this computer.
            </p>
          )}
          <button className="btn ghost press-fb" onClick={() => void restorePurchases()}>
            {ios ? 'Restore purchases' : 'I already subscribed. Check again'}
          </button>
          <button className="btn quiet press-fb" onClick={dismiss}>
            Not now. Keep chatting.
          </button>
        </div>
        <p className="paywall-legal">
          <ExternalLink href={TERMS_URL}>Terms of Use</ExternalLink>
          <span aria-hidden="true"> · </span>
          <ExternalLink href={PRIVACY_URL}>Privacy Policy</ExternalLink>
        </p>
      </div>
    </div>
  );
}
