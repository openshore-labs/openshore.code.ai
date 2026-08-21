// Stripe webhook: the single writer of org_entitlements. A completed checkout or
// a subscription change maps a Stripe price back to a tier and upserts the org's
// entitlement with the service role (bypassing RLS on purpose; no client ever
// writes entitlements). The signature is verified before anything is trusted.
//
// Correctness rules (P0-2, P0-4, A2, A4, P2-15):
//   - status is authoritative. On cancel / delete / payment failure the row is
//     written with the revoked status and orgs.tier_id drops to 'personal'
//     (display only) so access ends. Nothing gates on orgs.tier_id.
//   - Every DB write's error is checked; any failure THROWS -> 500 so Stripe
//     retries (supabase-js does not throw on its own).
//   - An unmapped price THROWS (never a silent 'personal' downgrade of a payer).
//   - Ordering guard: last_event_at drops a stale or duplicate delivery, so a
//     late subscription.updated(active) can never resurrect a canceled sub.
//   - Real seats are written from orgs.seat_count while entitled, else 0.
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, plus the same STRIPE_PRICE_* as checkout.
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { effectiveTier, ENTITLED } from '../_shared/entitlement.ts';

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

// Upsert the org's entitlement from a Stripe subscription state. Throws on any
// write error or unmapped price so the caller returns 500 and Stripe retries.
// `eventCreatedMs` is the webhook event's own timestamp, used to drop stale/dup
// deliveries (Stripe is at-least-once and unordered).
async function upsertEntitlement(
  orgId: string,
  priceId: string,
  subId: string,
  status: string,
  periodEnd: number | undefined,
  eventCreatedMs: number,
): Promise<void> {
  const tier = TIER_BY_PRICE[priceId];
  if (!tier) throw new Error(`Unmapped Stripe price ${priceId}`);

  const entitled = ENTITLED.has(status);

  // Ordering guard: never apply an event older than the one already recorded.
  const { data: existing, error: readErr } = await supabase
    .from('org_entitlements')
    .select('last_event_at')
    .eq('org_id', orgId)
    .maybeSingle();
  if (readErr) throw new Error(`entitlement read failed: ${readErr.message}`);
  if (existing?.last_event_at && new Date(existing.last_event_at).getTime() >= eventCreatedMs) {
    return; // stale or duplicate delivery; the current state is newer.
  }

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

  const { error: upErr } = await supabase.from('org_entitlements').upsert({
    org_id: orgId,
    tier_id: tier, // the purchased tier; access is decided by status, not this.
    seats,
    status,
    stripe_subscription_id: subId,
    valid_until: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    last_event_at: new Date(eventCreatedMs).toISOString(),
    issued_at: new Date().toISOString(),
  });
  if (upErr) throw new Error(`entitlement upsert failed: ${upErr.message}`);

  // orgs.tier_id is DISPLAY only: the real tier while entitled, else 'personal'.
  const { error: orgUpErr } = await supabase
    .from('orgs')
    .update({ tier_id: effectiveTier(tier, status) })
    .eq('id', orgId);
  if (orgUpErr) throw new Error(`orgs tier update failed: ${orgUpErr.message}`);
}

// Upsert an INDIVIDUAL Personal entitlement from a Stripe subscription state.
// Mirrors upsertEntitlement's rules (throw on unmapped price / write error;
// ordering guard) but writes user_entitlements keyed by user_id. There is no
// seat concept for an individual.
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
    throw new Error(`Unmapped individual Stripe price ${priceId}`);
  }

  const { data: existing, error: readErr } = await supabase
    .from('user_entitlements')
    .select('last_event_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw new Error(`user entitlement read failed: ${readErr.message}`);
  if (existing?.last_event_at && new Date(existing.last_event_at).getTime() >= eventCreatedMs) {
    return; // stale or duplicate delivery; the current state is newer.
  }

  const { error: upErr } = await supabase.from('user_entitlements').upsert({
    user_id: userId,
    tier_id: 'personal',
    status,
    source: 'stripe',
    stripe_customer_id: customer,
    stripe_subscription_id: subId,
    valid_until: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    last_event_at: new Date(eventCreatedMs).toISOString(),
    issued_at: new Date().toISOString(),
  });
  if (upErr) throw new Error(`user entitlement upsert failed: ${upErr.message}`);
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
