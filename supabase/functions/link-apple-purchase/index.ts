// Link an Apple In-App Purchase to the signed-in user (iOS Personal unlock).
// The app captures a signed StoreKit transaction (JWS) right after a purchase or
// a restore and POSTs it here with the caller's access token. We verify the JWS
// against Apple, bind original_transaction_id -> user_id in apple_links
// (move-not-duplicate), and apply the buyer's user_entitlements row (source
// 'apple'). The client's claim is NEVER trusted without verification.
//
// Auth (mirrors stripe-checkout): a CALLER-SCOPED anon client resolves
// auth.getUser() as the caller; the entitlement + link writes go through a
// SEPARATE service-role client (the sole writer of entitlements; RLS denies
// client writes). verify_jwt=true in config.toml gates the endpoint too.
//
// Replay defence (BE-4, CTO ruling option (a)). A JWS is a bearer artifact: a
// purchase-time JWS captured through Web Inspector could be replayed from a
// fresh account after a refund. So a JWS is linked only when:
//   - it was signed within the last 48 hours (a restore always yields a fresh
//     one; a captured stale one is refused outright),
//   - the link is not refunded or revoked (apple-notifications records that),
//   - it is newer than the last event Apple told us about for that link.
// Follow-up: the App Store Server API (the .p8 the README reserves) would give
// live status and close the window between notifications.
//
// Env (Supabase function secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected), SUPABASE_SERVICE_ROLE_KEY,
//   APPLE_BUNDLE_ID, APPLE_APP_APPLE_ID (see _shared/apple.ts), APPLE_PRODUCT_IDS.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  appleLinkRefusal,
  appleTransactionAccepted,
  isEntitled,
  parseProductIds,
  shouldApplyRailWrite,
  statusFromTransaction,
} from '../_shared/entitlement.ts';
import { verifyTransaction } from '../_shared/apple.ts';

// The Personal product ids this backend grants for (BE-9). Unset = nothing.
const PRODUCT_IDS = parseProductIds(Deno.env.get('APPLE_PRODUCT_IDS'));

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

    // BE-9: only the Personal auto-renewable product can unlock Personal.
    if (!appleTransactionAccepted(txn, PRODUCT_IDS)) {
      console.warn('link-apple-purchase: refused transaction for an unlisted product', {
        productId: txn.productId ?? null,
        type: txn.type ?? null,
        configured: PRODUCT_IDS.size > 0,
      });
      return json({ error: 'That purchase is not the Personal subscription.' }, 400, req);
    }

    const originalTransactionId = txn.originalTransactionId;
    if (!originalTransactionId) {
      return json({ error: 'Purchase is missing its transaction id.' }, 400, req);
    }
    const status = statusFromTransaction(txn);
    const validUntil = txn.expiresDate ? new Date(txn.expiresDate).toISOString() : null;
    // Event time for the ordering guards: when Apple signed this JWS, falling
    // back to the purchase time. Both are UNIX ms. A JWS with neither is not
    // datable and is refused by the freshness check below.
    const eventMs = txn.signedDate ?? txn.purchaseDate ?? 0;
    const entitledNow = isEntitled({ status, validUntil });

    // Service-role client for the privileged writes (bypasses RLS on purpose).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Who holds this sub now, if anyone, and what Apple last said about it.
    const { data: priorLink, error: priorErr } = await admin
      .from('apple_links')
      .select('user_id, status, last_event_at')
      .eq('original_transaction_id', originalTransactionId)
      .maybeSingle();
    if (priorErr) throw new Error(`apple_links read failed: ${priorErr.message}`);

    // BE-4: refuse a stale, replayed, or dead subscription record before any
    // write. Fixed messages; nothing from the JWS is echoed.
    const refusal = appleLinkRefusal(priorLink, eventMs);
    if (refusal === 'too-old') {
      return json(
        { error: 'That purchase record is too old to link. Tap Restore Purchases for a fresh one.' },
        400,
        req,
      );
    }
    if (refusal === 'revoked') {
      return json({ error: 'That subscription was refunded or revoked.' }, 409, req);
    }
    if (refusal === 'stale') {
      // Apple has told us something newer about this subscription. For the
      // account that already holds the link, report its current state without
      // writing; for anyone else, refuse the move (a replay must never take
      // over a link).
      if (priorLink?.user_id === user.id) {
        const { data: mine, error: mineErr } = await admin
          .from('user_entitlements')
          .select('status, valid_until')
          .eq('user_id', user.id)
          .maybeSingle();
        if (mineErr) throw new Error(`user entitlement read failed: ${mineErr.message}`);
        return json(
          { ok: true, entitled: isEntitled({ status: mine?.status ?? 'canceled', validUntil: mine?.valid_until }) },
          200,
          req,
        );
      }
      return json(
        { error: 'A newer record of this subscription exists. Restore Purchases on the device that holds it.' },
        409,
        req,
      );
    }

    // Bind original_transaction_id -> this caller. MOVE-NOT-DUPLICATE: the PK is
    // original_transaction_id, so a restore under a new account overwrites the
    // user_id (one Apple sub -> exactly one account). The link's own state is
    // recorded from this JWS so the next call has an ordering baseline. Throw
    // on error -> 500.
    const linkStatus = txn.revocationDate ? 'revoked' : status === 'active' ? 'active' : 'expired';
    const { error: linkErr } = await admin.from('apple_links').upsert(
      {
        original_transaction_id: originalTransactionId,
        user_id: user.id,
        linked_at: new Date().toISOString(),
        status: linkStatus,
        valid_until: validUntil,
        last_event_at: new Date(eventMs).toISOString(),
      },
      { onConflict: 'original_transaction_id' },
    );
    if (linkErr) throw new Error(`apple_links upsert failed: ${linkErr.message}`);

    // F3: if the sub just MOVED off another account, revoke that prior holder's
    // Apple entitlement, so one $20 sub cannot leave two accounts entitled. Only
    // an apple-sourced row is touched (a Stripe sub on the old account is their
    // own separate purchase and must stay). Throw on error.
    if (priorLink?.user_id && priorLink.user_id !== user.id) {
      const { error: revErr } = await admin
        .from('user_entitlements')
        .update({ status: 'canceled', last_event_at: new Date(eventMs).toISOString() })
        .eq('user_id', priorLink.user_id)
        .eq('source', 'apple');
      if (revErr) throw new Error(`prior holder revoke failed: ${revErr.message}`);
    }

    // Read the caller's existing entitlement for the ordering and cross-rail
    // guards (BE-3, BE-8): a stale replay cannot resurrect a lapsed row or
    // downgrade a newer one, and a live Stripe row with at least as long a
    // window is kept (the buyer never loses coverage they paid for). When the
    // guard says no, report the current state honestly.
    const { data: existing, error: readErr } = await admin
      .from('user_entitlements')
      .select('status, source, valid_until, last_event_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readErr) throw new Error(`user entitlement read failed: ${readErr.message}`);

    if (!shouldApplyRailWrite(existing, { source: 'apple', validUntil, eventMs })) {
      return json(
        {
          ok: true,
          entitled: isEntitled({ status: existing?.status ?? 'canceled', validUntil: existing?.valid_until }),
        },
        200,
        req,
      );
    }

    // Apply the Apple entitlement. The RPC compares last_event_at inside the
    // write and keeps the other rail's columns on an existing row.
    const { error: upErr } = await admin.rpc('apply_user_entitlement_event', {
      p_user: user.id,
      p_status: status,
      p_source: 'apple',
      p_valid_until: validUntil,
      p_event_at: new Date(eventMs).toISOString(),
      p_stripe_customer_id: null,
      p_stripe_subscription_id: null,
      p_apple_original_transaction_id: originalTransactionId,
    });
    if (upErr) throw new Error(`user entitlement apply failed: ${upErr.message}`);

    return json({ ok: true, entitled: entitledNow }, 200, req);
  } catch (err) {
    console.error('link-apple-purchase error', err);
    return json({ error: 'Could not link that purchase. Try again.' }, 500, req);
  }
});
