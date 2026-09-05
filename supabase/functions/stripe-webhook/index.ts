// Stripe webhook: the single Stripe-side writer of org_entitlements and of the
// Stripe rail of user_entitlements. A completed checkout or a subscription
// change maps a Stripe price back to a tier and applies the entitlement with
// the service role (bypassing RLS on purpose; no client ever writes
// entitlements). The signature is verified before anything is trusted.
//
// Correctness rules (P0-2, P0-4, A2, A4, P2-15, and the 2026-09-05 review):
//   - status is authoritative. On cancel / delete / payment failure the row is
//     written with the revoked status and orgs.tier_id drops to 'personal'
//     (display only) so access ends. Nothing gates on orgs.tier_id.
//   - Every DB write's error is checked; any failure THROWS -> 500 so Stripe
//     retries (supabase-js does not throw on its own).
//   - An unmapped price THROWS (never a silent 'personal' downgrade of a payer),
//     UNLESS the founder listed it in STRIPE_IGNORED_PRICES (BE-13): that one
//     is logged and acked, so a legacy price cannot wedge the whole endpoint.
//   - Ordering guard (BE-8): the apply_*_entitlement_event RPCs compare
//     last_event_at inside the write itself, so a late or duplicate delivery
//     can never resurrect a canceled sub, even under parallel deliveries.
//   - Cross-rail guard (BE-3): shouldApplyRailWrite keeps a live Apple
//     Personal year from being revoked by an old Stripe sub's period-end
//     `deleted` event, mirroring what the Apple writers already did.
//   - Real seats are written from orgs.seat_count while entitled, else 0.
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, the same STRIPE_PRICE_* as checkout, and the
//      optional STRIPE_IGNORED_PRICES (comma-separated price ids).
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  effectiveTier,
  ENTITLED,
  isIgnoredPrice,
  parseIdList,
  shouldApplyRailWrite,
} from '../_shared/entitlement.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const TIER_BY_PRICE: Record<string, string> = {};
for (const [tier, env] of [
  ['commercial_micro', 'STRIPE_PRICE_MICRO'],
  ['commercial_small', 'STRIPE_PRICE_SMALL'],
  ['commercial_mid', 'STRIPE_PRICE_GROWTH'],
  ['commercial_large', 'STRIPE_PRICE_SCALE'],
] as const) {
  const id = Deno.env.get(env);
  if (id) TIER_BY_PRICE[id] = tier;
}

// The individual Personal price (web/desktop Stripe rail). Apple purchases take
// the apple-notifications function instead; both write user_entitlements.
const PERSONAL_PRICE = Deno.env.get('STRIPE_PRICE_PERSONAL');

// Prices this backend deliberately does not track (BE-13). Log and ack.
const IGNORED_PRICES = parseIdList(Deno.env.get('STRIPE_IGNORED_PRICES'));

/** Returns (so the caller acks without a write) only for a price the founder
 *  listed in STRIPE_IGNORED_PRICES. Throws for any other unmapped price, so
 *  Stripe keeps retrying and emails the owner rather than stranding a payer. */
function unmappedPrice(priceId: string, what: string): void {
  if (isIgnoredPrice(priceId, IGNORED_PRICES)) {
    console.warn(`stripe-webhook: ignoring ${what} price ${priceId} (STRIPE_IGNORED_PRICES)`);
    return;
  }
  throw new Error(`Unmapped ${what} Stripe price ${priceId}`);
}

// Apply the org's entitlement from a Stripe subscription state. Throws on any
// write error or unmapped price so the caller returns 500 and Stripe retries.
// `eventCreatedMs` is the webhook event's own timestamp; the RPC drops the
// write when the row already carries a newer event.
async function upsertEntitlement(
  orgId: string,
  priceId: string,
  subId: string,
  status: string,
  periodEnd: number | undefined,
  eventCreatedMs: number,
): Promise<void> {
  const tier = TIER_BY_PRICE[priceId];
  if (!tier) {
    unmappedPrice(priceId, 'org');
    return;
  }

  const entitled = ENTITLED.has(status);

  // Real seats from the org while entitled; zero once revoked.
  let seats = 0;
  if (entitled) {
    const { data: org, error: orgErr } = await supabase
      .from('orgs')
      .select('seat_count')
      .eq('id', orgId)
      .maybeSingle();
    if (orgErr) throw new Error(`orgs read failed: ${orgErr.message}`);
    seats = org?.seat_count ?? 0;
  }

  const { data: applied, error } = await supabase.rpc('apply_org_entitlement_event', {
    p_org: orgId,
    p_tier: tier, // the purchased tier; access is decided by status, not this.
    p_seats: seats,
    p_status: status,
    p_valid_until: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    p_stripe_subscription_id: subId,
    p_event_at: new Date(eventCreatedMs).toISOString(),
    // orgs.tier_id is DISPLAY only: the real tier while entitled, else 'personal'.
    p_display_tier: effectiveTier(tier, status),
  });
  if (error) throw new Error(`org entitlement apply failed: ${error.message}`);
  if (!applied) console.log('stripe-webhook: stale org event dropped', { orgId, eventCreatedMs });
}

// Apply an INDIVIDUAL Personal entitlement from a Stripe subscription state.
// Mirrors upsertEntitlement's rules but writes user_entitlements keyed by
// user_id, through the same cross-rail guard the Apple writers run.
async function upsertUserEntitlement(
  userId: string,
  priceId: string,
  subId: string,
  status: string,
  periodEnd: number | undefined,
  customer: string,
  eventCreatedMs: number,
): Promise<void> {
  if (!PERSONAL_PRICE || priceId !== PERSONAL_PRICE) {
    unmappedPrice(priceId, 'individual');
    return;
  }

  const validUntil = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  const { data: existing, error: readErr } = await supabase
    .from('user_entitlements')
    .select('status, source, valid_until, last_event_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw new Error(`user entitlement read failed: ${readErr.message}`);

  // BE-3: stale delivery, or a live Apple row with at least as long a window.
  if (!shouldApplyRailWrite(existing, { source: 'stripe', validUntil, eventMs: eventCreatedMs })) {
    console.log('stripe-webhook: user event not applied', {
      userId,
      existingSource: existing?.source,
      eventCreatedMs,
    });
    return;
  }

  const { data: applied, error } = await supabase.rpc('apply_user_entitlement_event', {
    p_user: userId,
    p_status: status,
    p_source: 'stripe',
    p_valid_until: validUntil,
    p_event_at: new Date(eventCreatedMs).toISOString(),
    p_stripe_customer_id: customer,
    p_stripe_subscription_id: subId,
    p_apple_original_transaction_id: null,
  });
  if (error) throw new Error(`user entitlement apply failed: ${error.message}`);
  if (!applied) console.log('stripe-webhook: stale user event dropped', { userId, eventCreatedMs });
}

function priceOf(sub: Stripe.Subscription): string {
  return sub.items.data[0]?.price.id ?? '';
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig ?? '',
      Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '',
    );
  } catch (err) {
    console.error('stripe-webhook bad signature', err);
    return new Response('Bad signature', { status: 400 });
  }

  const eventCreatedMs = event.created * 1000;
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        // Individual vs org, decided by which id the checkout stamped.
        const userId = session.metadata?.userId;
        const orgId = session.metadata?.orgId;
        if (userId) {
          await upsertUserEntitlement(userId, priceOf(sub), sub.id, sub.status, sub.current_period_end, String(sub.customer), eventCreatedMs);
        } else if (orgId) {
          await upsertEntitlement(orgId, priceOf(sub), sub.id, sub.status, sub.current_period_end, eventCreatedMs);
        }
      }
    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const sub = event.data.object as Stripe.Subscription;
      // A deletion is a revocation regardless of the object's status field.
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
      const userId = sub.metadata?.userId ?? (await userIdForCustomer(String(sub.customer)));
      if (userId) {
        await upsertUserEntitlement(userId, priceOf(sub), sub.id, status, sub.current_period_end, String(sub.customer), eventCreatedMs);
      } else {
        const orgId = sub.metadata?.orgId ?? (await orgIdForCustomer(String(sub.customer)));
        if (orgId) await upsertEntitlement(orgId, priceOf(sub), sub.id, status, sub.current_period_end, eventCreatedMs);
      }
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.subscription;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(String(subId));
        // sub.status is past_due / unpaid after a failed payment; that revokes.
        const userId = sub.metadata?.userId ?? (await userIdForCustomer(String(sub.customer)));
        if (userId) {
          await upsertUserEntitlement(userId, priceOf(sub), sub.id, sub.status, sub.current_period_end, String(sub.customer), eventCreatedMs);
        } else {
          const orgId = sub.metadata?.orgId ?? (await orgIdForCustomer(String(sub.customer)));
          if (orgId) await upsertEntitlement(orgId, priceOf(sub), sub.id, sub.status, sub.current_period_end, eventCreatedMs);
        }
      }
    }
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('stripe-webhook handler error', err);
    return new Response('Handler error', { status: 500 });
  }
});

// Map a Stripe customer back to an org. Unmatched -> undefined (return 200 so
// Stripe does not retry forever on a customer we do not track). P2-15.
async function orgIdForCustomer(customer: string): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('orgs')
    .select('id')
    .eq('stripe_customer_id', customer)
    .maybeSingle();
  if (error) throw new Error(`orgIdForCustomer failed: ${error.message}`);
  return data?.id;
}

// Map a Stripe customer back to an individual buyer (user_entitlements holds the
// customer id, written at checkout). Unmatched -> undefined.
async function userIdForCustomer(customer: string): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('user_entitlements')
    .select('user_id')
    .eq('stripe_customer_id', customer)
    .maybeSingle();
  if (error) throw new Error(`userIdForCustomer failed: ${error.message}`);
  return data?.user_id;
}
