// Link an Apple In-App Purchase to the signed-in user (iOS Personal unlock).
// The app captures a signed StoreKit transaction (JWS) right after a purchase or
// a restore and POSTs it here with the caller's access token. We verify the JWS
// against Apple, bind original_transaction_id -> user_id in apple_links
// (move-not-duplicate), and upsert the buyer's user_entitlements row (source
// 'apple'). The client's claim is NEVER trusted without verification.
//
// Auth (mirrors stripe-checkout): a CALLER-SCOPED anon client resolves
// auth.getUser() as the caller; the entitlement + link writes go through a
// SEPARATE service-role client (the sole writer of entitlements; RLS denies
// client writes). verify_jwt=true in config.toml gates the endpoint too.
//
// Env (Supabase function secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected), SUPABASE_SERVICE_ROLE_KEY,
//   APPLE_BUNDLE_ID, APPLE_APP_APPLE_ID (see _shared/apple.ts).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { isEntitled } from '../_shared/entitlement.ts';
import { verifyTransaction } from '../_shared/apple.ts';

// Derive an entitlement status from a decoded transaction. A refund/revocation
// ends access now; a lapsed expiry ends it too. Apple's notion of "expired" maps
// to 'canceled' because the 0006 CHECK has no 'expired' status (do not widen it).
// Everything else is 'active'. trialing is not distinguished here (StoreKit
// intro offers still grant access; validUntil gates the window).
function statusFromTransaction(txn: {
  expiresDate?: number;
  revocationDate?: number;
}): string {
  if (txn.revocationDate) return 'canceled';
  if (txn.expiresDate && txn.expiresDate <= Date.now()) return 'canceled';
  return 'active';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  try {
    // Caller-scoped client: auth.uid() = the signed-in user.
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Sign in first.' }, 401, req);

    const { jws } = (await req.json()) as { jws?: string };
    if (!jws) return json({ error: 'Missing transaction.' }, 400, req);

    // Trust boundary: verify the signed transaction against Apple. Any failure
    // (bad signature, wrong bundle, untrusted chain) is a 400; we never trust a
    // client-supplied original_transaction_id without this.
    let txn;
    try {
      txn = await verifyTransaction(jws);
    } catch (err) {
      console.error('link-apple-purchase verify failed', err);
      return json({ error: 'Could not verify that purchase.' }, 400, req);
    }

    const originalTransactionId = txn.originalTransactionId;
    if (!originalTransactionId) {
      return json({ error: 'Purchase is missing its transaction id.' }, 400, req);
    }
    const status = statusFromTransaction(txn);
    const validUntil = txn.expiresDate ? new Date(txn.expiresDate).toISOString() : null;
    // Event time for the ordering guard: when Apple signed this transaction,
    // falling back to the purchase time. Both are UNIX ms.
    const eventMs = txn.signedDate ?? txn.purchaseDate ?? Date.now();
    const entitledNow = isEntitled({ status, validUntil });

    // Service-role client for the privileged writes (bypasses RLS on purpose).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Who holds this sub now, if anyone, before we move the link.
    const { data: priorLink, error: priorErr } = await admin
      .from('apple_links')
      .select('user_id')
      .eq('original_transaction_id', originalTransactionId)
      .maybeSingle();
    if (priorErr) throw new Error(`apple_links read failed: ${priorErr.message}`);

    // Bind original_transaction_id -> this caller. MOVE-NOT-DUPLICATE: the PK is
    // original_transaction_id, so a restore under a new account overwrites the
    // user_id (one Apple sub -> exactly one account). Throw on error -> 500.
    const { error: linkErr } = await admin.from('apple_links').upsert(
      {
        original_transaction_id: originalTransactionId,
        user_id: user.id,
        linked_at: new Date().toISOString(),
      },
      { onConflict: 'original_transaction_id' },
    );
    if (linkErr) throw new Error(`apple_links upsert failed: ${linkErr.message}`);

    // F3: if the sub just MOVED off another account, revoke that prior holder's
    // Apple entitlement, so one $20 sub cannot leave two accounts entitled. Only
    // an apple-sourced row is touched (a Stripe sub on the old account is their
    // own separate purchase and must stay). Best-effort revoke; throw on error.
    if (priorLink?.user_id && priorLink.user_id !== user.id) {
      const { error: revErr } = await admin
        .from('user_entitlements')
        .update({ status: 'canceled', last_event_at: new Date(eventMs).toISOString() })
        .eq('user_id', priorLink.user_id)
        .eq('source', 'apple');
      if (revErr) throw new Error(`prior holder revoke failed: ${revErr.message}`);
    }

    // Read the caller's existing entitlement to apply two guards before writing.
    const { data: existing, error: readErr } = await admin
      .from('user_entitlements')
      .select('status, source, valid_until, last_event_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readErr) throw new Error(`user entitlement read failed: ${readErr.message}`);

    // Ordering guard (mirrors stripe-webhook): never apply an event older than or
    // equal to the one already recorded, so a stale/duplicate replay of an older
    // transaction cannot resurrect a lapsed row or downgrade a newer one.
    if (
      existing?.last_event_at &&
      new Date(existing.last_event_at).getTime() >= eventMs
    ) {
      return json({ ok: true, entitled: isEntitled({ status: existing.status, validUntil: existing.valid_until }) }, 200, req);
    }

    // Cross-rail safety: do not clobber a Stripe-sourced ACTIVE entitlement with
    // an Apple row unless the Apple entitlement runs at least as long. The buyer
    // should never lose the coverage they already paid for on the other rail. If
    // the existing Stripe row is entitled and its window ends later than this
    // Apple transaction's, leave it and just report entitled. (A signed-in user
    // holding both is an edge case the double-purchase guard tries to prevent; if
    // it happens, keep the longer window.)
    if (existing && existing.source === 'stripe' && isEntitled({ status: existing.status, validUntil: existing.valid_until })) {
      const stripeUntil = existing.valid_until ? new Date(existing.valid_until).getTime() : Infinity;
      const appleUntil = validUntil ? new Date(validUntil).getTime() : Infinity;
      if (stripeUntil >= appleUntil) {
        return json({ ok: true, entitled: true }, 200, req);
      }
      // else the Apple window is longer; fall through and take it over.
    }

    // Upsert the Apple entitlement. Only the columns we own are written, so the
    // upsert never clobbers stripe_customer_id / stripe_subscription_id on an
    // existing row (ON CONFLICT DO UPDATE touches only provided columns).
    const { error: upErr } = await admin.from('user_entitlements').upsert({
      user_id: user.id,
      tier_id: 'personal',
      status,
      source: 'apple',
      valid_until: validUntil,
      apple_original_transaction_id: originalTransactionId,
      last_event_at: new Date(eventMs).toISOString(),
      issued_at: new Date().toISOString(),
    });
    if (upErr) throw new Error(`user entitlement upsert failed: ${upErr.message}`);

    return json({ ok: true, entitled: entitledNow }, 200, req);
  } catch (err) {
    console.error('link-apple-purchase error', err);
    return json({ error: 'Could not link that purchase. Try again.' }, 500, req);
  }
});
