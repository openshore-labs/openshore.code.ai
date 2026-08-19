// Stripe webhook: the single writer of org_entitlements. A completed checkout or
// a subscription change maps a Stripe price back to a tier and upserts the org's
// entitlement with the service role (bypassing RLS on purpose; no client ever
// writes entitlements). The signature is verified before anything is trusted.
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, plus the same STRIPE_PRICE_* as checkout.
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

async function upsertEntitlement(orgId: string, priceId: string, subId: string, status: string, periodEnd?: number): Promise<void> {
  const tier = TIER_BY_PRICE[priceId] ?? 'personal';
  await supabase.from('org_entitlements').upsert({
    org_id: orgId,
    tier_id: tier,
    seats: 0,
    status,
    stripe_subscription_id: subId,
    valid_until: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    issued_at: new Date().toISOString(),
  });
  await supabase.from('orgs').update({ tier_id: tier }).eq('id', orgId);
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig ?? '', Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '');
  } catch (err) {
    return new Response(`Bad signature: ${err instanceof Error ? err.message : err}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.orgId;
      if (orgId && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        const price = sub.items.data[0]?.price.id ?? '';
        await upsertEntitlement(orgId, price, sub.id, sub.status, sub.current_period_end);
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = sub.metadata?.orgId ?? (await orgIdForCustomer(String(sub.customer)));
      const price = sub.items.data[0]?.price.id ?? '';
      if (orgId) await upsertEntitlement(orgId, price, sub.id, sub.status, sub.current_period_end);
    }
    return new Response('ok', { status: 200 });
  } catch (err) {
    return new Response(`Handler error: ${err instanceof Error ? err.message : err}`, { status: 500 });
  }
});

async function orgIdForCustomer(customer: string): Promise<string | undefined> {
  const { data } = await supabase.from('orgs').select('id').eq('stripe_customer_id', customer).single();
  return data?.id;
}
