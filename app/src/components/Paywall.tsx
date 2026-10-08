// The Personal sheet, sold as OpenShore Plus (CTO, CFO, CX, 2026-09-30; the
// founder widened Plus the same day). Chats, Projects, the Stack, Cloud
// Connections and Settings stay free; every other room, and the paid moments
// inside the free ones, open this when asked for (lib/payGate.ts), and so
// does the free sidebar's Upgrade banner. Copy is CX's, widened for the
// founder's scope. Two rails, one price ($49.99 a year):
//
// - iPhone and iPad buy through the App Store only (App Store 3.1.1): the
//   StoreKit price, Start Personal, and Restore purchases. That branch never
//   names another way to pay, a web price, or an address (a test holds it).
// - The desktop and the web buy through Stripe Checkout in the system
//   browser, then come back through the checkout-return link or "I already
//   paid", which re-reads the account.
//
// Someone whose Personal year ended keeps everything they made; the sheet
// only says so and offers Renew. Chat keeps working behind it, so the
// dismiss is non-punitive.
import { useEffect, useState } from 'react';
import { PAY_GATES_ENABLED, useApp } from '../state/store.js';
import { personalLapsed } from '../state/payOps.js';
import { PERSONAL_WEB_PRICE } from '../lib/payGate.js';
import { ROUTINE_NOTES_PLACE } from '../lib/vaultCopy.js';
import { Sheet } from './Sheet.js';
import { SheetTitle } from './SheetHead.js';
import { PERSONAL_YEARLY_PRODUCT_ID, iapAvailable, products } from '../lib/iap.js';
import { openExternal } from '../lib/platform.js';

/** Apple requires the terms and the privacy policy on a subscription screen
 *  (guideline 3.1.2); both live on the site. */
export { PRIVACY_URL, TERMS_URL } from '../lib/legalLinks.js';
import { PRIVACY_URL, TERMS_URL } from '../lib/legalLinks.js';

export const PAYWALL_HEADLINE = 'Let OpenShore build it.';
/** Pairing's own headline: the person asked for exactly that. */
export const PAYWALL_PAIRING_HEADLINE = 'Reach your computer from your phone.';
/** A Plus room (Terminal, Repositories, Vault) or the Upgrade banner. */
export const PAYWALL_PLUS_HEADLINE = 'All of OpenShore, with Plus.';
export const PAYWALL_LAPSED_HEADLINE = 'Your Plus year has ended.';
export const PAYWALL_BODY =
  'Chats, Projects, the Stack and Cloud Connections stay free. Plus opens the rest, and the agent works on your computer: it reads your project and makes real changes you approve.';

// CX's second bullet names where a routine's note really lands (the Vault
// copy rule, lib/vaultCopy.ts): the vault folder on the computer. The rooms
// follow (founder, 2026-09-30). Docking a phone to a computer is free since
// 2026-10-07, so it is not sold here.
export const BULLETS = [
  'Build and fix in your projects',
  `Routines that leave a note in ${ROUTINE_NOTES_PLACE}`,
  'Terminal, Repositories, and Vault',
  'Your models, your keys. Your prompts never pass through us.',
];

/** Where an App Store subscriber stops the renewal (Apple 3.1.2 asks the
 *  sheet to say it renews; CX's path, since iOS has no "Apple ID" step). */
export const RENEWAL_LINE =
  'Cancel any time on your iPhone in Settings, then your name, then Subscriptions.';
/** Where a web subscriber stops it: the Stripe portal, from Settings. */
export const WEB_RENEWAL_LINE = 'Cancel any time in Settings, under Manage subscription.';

/** What the sheet says about money. Nothing while the pay gates are off: no
 *  price, no renewal line, and no buy button. With them on, iOS shows only
 *  the App Store's own price (until StoreKit answers, where to see it), and
 *  the desktop the one web price. */
export function paywallMoney(
  gates: boolean,
  ios: boolean,
  storePrice: string | undefined,
  lapsed = false,
): { priceLine: string | null; renewal: string | null; buy: string | null } {
  if (!gates) return { priceLine: null, renewal: null, buy: null };
  const buy = lapsed ? 'Renew Plus' : 'Get Plus';
  if (ios) {
    return {
      priceLine: storePrice
        ? `${storePrice} per year. Renews yearly.`
        : 'Renews yearly. See the price in the App Store.',
      renewal: RENEWAL_LINE,
      buy,
    };
  }
  return {
    priceLine: `${PERSONAL_WEB_PRICE} a year. Renews yearly.`,
    renewal: WEB_RENEWAL_LINE,
    buy,
  };
}

/** The App Store's buttons: the purchase and Restore (Apple 3.1.1). Only
 *  StoreKit words here, never another way to pay. */
function AppStoreActions({ buy }: { buy: string | null }) {
  const buyPersonal = useApp((s) => s.buyPersonal);
  const restorePurchases = useApp((s) => s.restorePurchases);
  return (
    <>
      {buy ? (
        <button className="btn primary press-fb" onClick={() => void buyPersonal()}>
          {buy}
        </button>
      ) : null}
      <button className="btn ghost press-fb" onClick={() => void restorePurchases()}>
        Restore purchases
      </button>
    </>
  );
}

/** The desktop and web buttons: Stripe Checkout in the browser, then the
 *  account re-read by hand when the person comes back some other way. */
function CheckoutActions({ buy }: { buy: string | null }) {
  const buyPersonal = useApp((s) => s.buyPersonal);
  const recheckPersonal = useApp((s) => s.recheckPersonal);
  return (
    <>
      {buy ? (
        <button className="btn primary press-fb" onClick={() => void buyPersonal()}>
          {buy}
        </button>
      ) : null}
      <button className="btn ghost press-fb" onClick={() => void recheckPersonal()}>
        I already paid
      </button>
    </>
  );
}

export function Paywall() {
  const reason = useApp((s) => s.paywall);
  const closePaywall = useApp((s) => s.closePaywall);
  const signedIn = useApp((s) => Boolean(s.authSession));
  const lapsed = useApp((s) => personalLapsed(s.userEntitlement));
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

  // One headline for building (the sheet never sells the Marketplace),
  // Pairing's own, and the whole of Plus for a room or the banner;
  // a lapsed subscriber hears that their year ended.
  const headline = lapsed
    ? PAYWALL_LAPSED_HEADLINE
    : reason === 'pairing'
      ? PAYWALL_PAIRING_HEADLINE
      : reason === 'plus'
        ? PAYWALL_PLUS_HEADLINE
        : PAYWALL_HEADLINE;
  // No price, renewal line, or buy button while the pay gates are off; with
  // them on, never an App Store price StoreKit did not give.
  const { priceLine, renewal, buy } = paywallMoney(PAY_GATES_ENABLED, ios, storePrice, lapsed);

  // The house sheet owns the exit, the drag, Escape, and the dialog role, so
  // the paywall closes the way every other sheet does.
  return (
    <Sheet open={Boolean(reason)} onClose={closePaywall}>
      <span className="approval-badge tool">Plus</span>
      <SheetTitle>{headline}</SheetTitle>
      <p className="sheet-sub">{PAYWALL_BODY}</p>
      <ul className="paywall-benefits">
        {BULLETS.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {priceLine ? <p className="paywall-price">{priceLine}</p> : null}
      {renewal ? <p className="sheet-sub">{renewal}</p> : null}
      {!signedIn ? (
        <p className="sheet-sub">
          Chatting needs no account. Buying Plus does, so it follows you to every device you sign in
          on.
        </p>
      ) : null}
      <div className="sheet-actions">
        {ios ? <AppStoreActions buy={buy} /> : <CheckoutActions buy={buy} />}
        <button className="btn quiet press-fb" onClick={closePaywall}>
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
    </Sheet>
  );
}
