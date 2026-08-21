// App Store Server Notifications V2 endpoint: the Apple analog of stripe-webhook
// and the single Apple-side writer of user_entitlements. Apple POSTs a signed
// notification when a subscription renews, expires, is refunded, or is revoked;
// we verify it, resolve it to a user via apple_links, and write the entitlement.
//
// This is called by APPLE, not a signed-in user, so verify_jwt=false (like the
// Stripe webhook). Trust comes only from the JWS signature, never from a bearer.
//
// Correctness rules (mirroring stripe-webhook):
//   - The signed payload is verified before anything is trusted.
//   - status is authoritative; on expire/refund/revoke the row is written
//     'canceled' and access ends (isEntitled gates on status + validUntil).
//   - Ordering guard: last_event_at (by the transaction's signedDate) drops a
//     stale or duplicate delivery so a late renewal cannot resurrect a canceled
//     sub, and idempotency by notificationUUID drops exact re-deliveries.
//   - Every DB write error THROWS -> 500 so Apple retries.
//   - An unknown original_transaction_id returns 200 (nothing to do) so Apple
//     stops retrying, like stripe-webhook's unmatched-customer case.
//
// Env (Supabase function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APPLE_BUNDLE_ID,
//   APPLE_APP_APPLE_ID (see _shared/apple.ts).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isEntitled } from '../_shared/entitlement.ts';
import { verifyNotification, verifyTransaction } from '../_shared/apple.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

// Notification types that grant access.
const ACTIVE_TYPES = new Set(['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED']);
// Notification types that revoke access now.
const REVOKE_TYPES = new Set(['EXPIRED', 'GRACE_PERIOD_EXPIRED', 'REFUND', 'REVOKE']);

// Derive an entitlement status from a decoded transaction (refund/revocation or
// a lapsed expiry ends access; else active). Apple's 'expired' maps to
// 'canceled' because the 0006 CHECK has no 'expired' status.
function statusFromTransaction(txn: {
  expiresDate?: number;
  revocationDate?: number;
}): string {
  if (txn.revocationDate) return 'canceled';
  if (txn.expiresDate && txn.expiresDate <= Date.now()) return 'canceled';
  return 'active';
}

// Map original_transaction_id -> user_id via apple_links (written by
// link-apple-purchase after the user linked the sub). Unmatched -> undefined
// (caller returns 200 so Apple stops retrying a sub we do not track).
async function userIdForOriginalTransaction(
  originalTransactionId: string,
): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('apple_links')
    .select('user_id')
    .eq('original_transaction_id', originalTransactionId)
    .maybeSingle();
  if (error) throw new Error(`apple_links lookup failed: ${error.message}`);
  return data?.user_id;
}

// Upsert the user's Apple entitlement with the ordering guard. Throws on any
// write error so the caller returns 500 and Apple retries.
async function upsertUserEntitlement(
  userId: string,
  originalTransactionId: string,
  status: string,
  validUntil: string | null,
  eventMs: number,
): Promise<void> {
  const { data: existing, error: readErr } = await supabase
    .from('user_entitlements')
    .select('last_event_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw new Error(`user entitlement read failed: ${readErr.message}`);
  if (existing?.last_event_at && new Date(existing.last_event_at).getTime() >= eventMs) {
    return; // stale or duplicate delivery; the current state is newer.
  }

  // Only the columns we own are written, so an existing Stripe row keeps its
  // stripe_customer_id / stripe_subscription_id (ON CONFLICT DO UPDATE touches
  // only provided columns). source flips to 'apple' because a live Apple
  // notification is now the authority for this user's individual entitlement.
  const { error: upErr } = await supabase.from('user_entitlements').upsert({
    user_id: userId,
    tier_id: 'personal',
    status,
    source: 'apple',
    valid_until: validUntil,
    apple_original_transaction_id: originalTransactionId,
    last_event_at: new Date(eventMs).toISOString(),
    issued_at: new Date().toISOString(),
  });
  if (upErr) throw new Error(`user entitlement upsert failed: ${upErr.message}`);
}

Deno.serve(async (req) => {
  const { signedPayload } = (await req.json().catch(() => ({}))) as { signedPayload?: string };
  if (!signedPayload) return new Response('Missing signedPayload', { status: 400 });

  // Trust boundary: verify the notification against Apple. A bad signature is a
  // 400 (Apple does not retry a malformed/forged payload).
  let notification;
  try {
    notification = await verifyNotification(signedPayload);
  } catch (err) {
    console.error('apple-notifications verify failed', err);
    return new Response('Bad signature', { status: 400 });
  }

  const uuid = notification.notificationUUID;
  if (!uuid) return new Response('Missing notificationUUID', { status: 400 });

  // Idempotency: record the uuid FIRST; a unique-violation means we already
  // processed this exact delivery, so no-op with 200. If processing then fails
  // and we throw for a retry, we DELETE the uuid first so the retry reprocesses
  // (otherwise the recorded uuid would make Apple's retry a silent no-op and the
  // update would be lost).
  const { error: seenErr } = await supabase
    .from('apple_notifications_seen')
    .insert({ notification_uuid: uuid });
  if (seenErr) {
    if (seenErr.code === '23505') {
      return new Response('ok', { status: 200 }); // already processed.
    }
    // Any other insert error is a real DB failure: retry.
    console.error('apple-notifications seen insert error', seenErr);
    return new Response('Handler error', { status: 500 });
  }

  try {
    // The transaction inside the notification is itself a JWS; verify it to
    // trust its fields (originalTransactionId, expiresDate, revocationDate).
    const signedTxn = notification.data?.signedTransactionInfo;
    if (!signedTxn) {
      // Non-transaction notifications (e.g. TEST) carry nothing to write; the
      // uuid stays recorded and we ack so Apple does not retry.
      return new Response('ok', { status: 200 });
    }
    const txn = await verifyTransaction(signedTxn);

    const originalTransactionId = txn.originalTransactionId;
    if (!originalTransactionId) return new Response('ok', { status: 200 });

    const userId = await userIdForOriginalTransaction(originalTransactionId);
    if (!userId) {
      // We do not track this sub (never linked to an account). Ack so Apple
      // stops retrying; the uuid stays recorded.
      return new Response('ok', { status: 200 });
    }

    const type = String(notification.notificationType ?? '');
    // Status by notification type:
    //   active types  -> 'active'
    //   revoke types  -> 'canceled' (access ends now)
    //   DID_CHANGE_RENEWAL_STATUS -> auto-renew was toggled; the sub stays
    //     entitled until its expiry, so derive from the transaction (validUntil
    //     gates the natural end). Same for any other type we do not special-case.
    let status: string;
    if (ACTIVE_TYPES.has(type)) status = 'active';
    else if (REVOKE_TYPES.has(type)) status = 'canceled';
    else status = statusFromTransaction(txn);

    const validUntil = txn.expiresDate ? new Date(txn.expiresDate).toISOString() : null;
    // Ordering guard time: the notification's signedDate (when Apple emitted the
    // event), falling back to the transaction's signedDate. Both UNIX ms.
    const eventMs = notification.signedDate ?? txn.signedDate ?? Date.now();

    await upsertUserEntitlement(userId, originalTransactionId, status, validUntil, eventMs);

    // A harmless log to confirm the resolved state during sandbox validation.
    console.log('apple-notifications processed', {
      type,
      subtype: notification.subtype ?? null,
      entitled: isEntitled({ status, validUntil }),
    });
    return new Response('ok', { status: 200 });
  } catch (err) {
    // Roll back the idempotency marker so Apple's retry reprocesses this event.
    const { error: delErr } = await supabase
      .from('apple_notifications_seen')
      .delete()
      .eq('notification_uuid', uuid);
    if (delErr) console.error('apple-notifications seen rollback failed', delErr);
    console.error('apple-notifications handler error', err);
    return new Response('Handler error', { status: 500 });
  }
});
