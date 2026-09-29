// The Personal upgrade sheet. Free is chat only; tapping the coding agent or the
// Marketplace opens this. Copy is the CMO's. Personal is an Apple subscription:
// bought only as an Apple In-App Purchase on iPhone or iPad (Apple 3.1.1 /
// 3.1.3, no web price named there). On web and desktop there is no purchase
// button; the sheet points the user to buy it in the app on their iPhone, then
// refresh here to unlock the same account on this computer. Chat keeps working
// behind this, so the dismiss is non-punitive.
import { useEffect, useState } from 'react';
import { PAY_GATES_ENABLED, useApp } from '../state/store.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { PERSONAL_YEARLY_PRODUCT_ID, iapAvailable, products } from '../lib/iap.js';
import { openExternal } from '../lib/platform.js';

/** Apple requires the terms and the privacy policy on a subscription screen
 *  (guideline 3.1.2); both live on the site. */
export const TERMS_URL = 'https://openshore.ai/terms/';
export const PRIVACY_URL = 'https://openshore.ai/privacy/';

const BULLETS = [
  'Run the agent on any repository, on your computer',
  'Edits with real diffs, and tool approvals you control',
  'Your models, your API keys. Your prompts never pass through us.',
];

/** Where a subscriber stops the renewal (Apple 3.1.2 asks the sheet to say
 *  it renews; CX's path, since iOS has no "Apple ID" step). */
export const RENEWAL_LINE =
  'Renews yearly. Cancel any time on your iPhone in Settings, then your name, then Subscriptions.';

/** What the sheet says about money. Nothing while the pay gates are off: no
 *  price, no renewal line, and no buy button. With them on, only the App
 *  Store's own price is ever shown; until StoreKit answers (or on a computer,
 *  where it never does) the sheet says where to see it instead of guessing. */
export function paywallMoney(
  gates: boolean,
  ios: boolean,
  storePrice: string | undefined,
): { priceLine: string | null; renewal: string | null; buy: string | null } {
  if (!gates) return { priceLine: null, renewal: null, buy: null };
  const whole = 'One person, the whole app.';
  const priceLine = storePrice
    ? `${storePrice} per year. ${whole}${ios ? '' : ' Bought on your iPhone.'}`
    : `${whole}${ios ? '' : ' Bought on your iPhone.'} See the price in the App Store.`;
  const buy = ios
    ? storePrice
      ? `Unlock Personal · ${storePrice}/year`
      : 'Unlock Personal'
    : null;
  return { priceLine, renewal: RENEWAL_LINE, buy };
}

export function Paywall() {
  const reason = useApp((s) => s.paywall);
  const buyPersonal = useApp((s) => s.buyPersonal);
  const restorePurchases = useApp((s) => s.restorePurchases);
  const closePaywall = useApp((s) => s.closePaywall);
  const signedIn = useApp((s) => Boolean(s.authSession));
  // Hooks run unconditionally, before the reason gate.
  const { closing, dismiss } = useSheetExit(closePaywall);
  const ios = iapAvailable();
  // The App Store's localized price (the one the person is charged), asked
  // for once the sheet opens; the fallback label covers a slow or failed ask.
  const [storePrice, setStorePrice] = useState<string | undefined>();
  useEffect(() => {
    if (!reason || !ios || !PAY_GATES_ENABLED) return;
    let live = true;
    products([PERSONAL_YEARLY_PRODUCT_ID])
      .then(({ products: found }) => {
        const price = found.find((p) => p.id === PERSONAL_YEARLY_PRODUCT_ID)?.displayPrice;
        if (live && price) setStorePrice(price);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [reason, ios]);
  if (!reason) return null;

  // The Marketplace is Coming soon, so the sheet never sells it (brand sweep
  // 2026-09-24): one headline for either reason.
  const headline = 'Unlock the agent.';
  const subhead =
    'Chat is yours for free. Personal turns OpenShore into a coding agent that reads your repository, writes real edits, and runs the tools to prove them.';
  // No price, renewal line, or buy button while the pay gates are off
  // (pricing is a Board gate); with them on, never a price StoreKit did not
  // give (next build E0).
  const { priceLine, renewal, buy } = paywallMoney(PAY_GATES_ENABLED, ios, storePrice);

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
        {priceLine ? <p className="paywall-price">{priceLine}</p> : null}
        {renewal ? <p className="sheet-sub">{renewal}</p> : null}
        {!signedIn ? (
          <p className="sheet-sub">
            Chatting needs no account. Buying Personal does, so it follows you from your iPhone to
            your computer.
          </p>
        ) : null}
        <div className="sheet-actions">
          {ios ? (
            buy ? (
              <button className="btn primary press-fb" onClick={() => void buyPersonal()}>
                {buy}
              </button>
            ) : null
          ) : (
            <p className="sheet-sub" style={{ marginTop: 0 }}>
              Personal is an in-app purchase in OpenShore on iPhone or iPad. Buy it there, then
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
        <p className="paywall-legal">
          <button
            type="button"
            className="link-quiet press-fb"
            onClick={() => openExternal(TERMS_URL)}
          >
            Terms of Use
          </button>
          <button
            type="button"
            className="link-quiet press-fb"
            onClick={() => openExternal(PRIVACY_URL)}
          >
            Privacy Policy
          </button>
        </p>
      </div>
    </div>
  );
}
