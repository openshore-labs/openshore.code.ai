// Create a Stripe Checkout session for a commercial OS Code plan. The purchase
// happens on the WEB (openshore.ai), in the system browser, never inside the
// iOS app: seat-based SaaS bought in-app trips Apple 3.1.1. The app only ever
// signs in and reads the resulting entitlement.
//
// Auth (P0-1): the admin check runs on a CALLER-SCOPED anon client that forwards
// the caller's Authorization header, so auth.uid() inside is_org_admin is the
// caller, not the service role. Privileged reads/writes (stripe_customer_id) go
// through a separate service-role client. Never authorize with the service role
// standing in for the caller.
//
// Env (Supabase function secrets):
//   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected),
//   SUPABASE_SERVICE_ROLE_KEY,
//   STRIPE_PRICE_MICRO, STRIPE_PRICE_SMALL, STRIPE_PRICE_GROWTH, STRIPE_PRICE_SCALE,
//   CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL, PORTAL_RETURN_URL
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { isEntitled, tierCoversSeats } from '../_shared/entitlement.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' });

const PRICE_BY_TIER: Record<string, string | undefined> = {
  commercial_micro: Deno.env.get('STRIPE_PRICE_MICRO'),
  commercial_small: Deno.env.get('STRIPE_PRICE_SMALL'),
  commercial_mid: Deno.env.get('STRIPE_PRICE_GROWTH'),
  commercial_large: Deno.env.get('STRIPE_PRICE_SCALE'),
  // The individual Personal unlock ($20/yr). Bought on the web/desktop here; on
  // iOS the same unlock is an Apple IAP (Apple 3.1.1), never this endpoint.
  personal: Deno.env.get('STRIPE_PRICE_PERSONAL'),
};

const SUCCESS_URL = Deno.env.get('CHECKOUT_SUCCESS_URL') ?? 'https://openshore.ai/os-code/?checkout=success';
const CANCEL_URL = Deno.env.get('CHECKOUT_CANCEL_URL') ?? 'https://openshore.ai/os-code/';
const PORTAL_RETURN = Deno.env.get('PORTAL_RETURN_URL') ?? 'https://openshore.ai/os-code/';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  try {
    // Caller-scoped client: auth.uid() = the signed-in user for the RPC check.
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

    const { orgId, tierId } = (await req.json()) as { orgId?: string; tierId: string };
    const price = PRICE_BY_TIER[tierId];
    if (!price) return json({ error: 'Unknown or non-purchasable tier.' }, 400, req);

    // Privileged client for reads/writes (customer ids).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Individual Personal purchase: no org, the buyer pays for themselves. No
    // admin check (there is nobody to be an admin of); identity is the caller.
    if (!orgId) {
      if (tierId !== 'personal') {
        return json({ error: 'Only the Personal plan is an individual purchase.' }, 400, req);
      }
      return await checkoutIndividual(user.id, user.email, price, req, admin);
    }

    // The caller must be an admin of this org (checked as the caller, not the
    // service role, so auth.uid() resolves inside is_org_admin).
    const { data: isAdmin, error: adminErr } = await asUser.rpc('is_org_admin', { p_org: orgId });
    if (adminErr || !isAdmin) return json({ error: 'Only an org admin can buy seats.' }, 403, req);

    const { data: org, error: orgErr } = await admin
      .from('orgs')
      .select('stripe_customer_id, name, seat_count')
      .eq('id', orgId)
      .maybeSingle();
    if (orgErr || !org) return json({ error: 'Could not load your company. Try again.' }, 500, req);

    // A4: the chosen plan must cover the org's seat count. A 500-seat org cannot
    // buy Micro. Seat count is read server-side, never trusted from the body.
    if (!tierCoversSeats(tierId, org.seat_count)) {
      return json(
        { error: 'That plan is too small for your team. Pick a plan that covers your seats.' },
        400,
        req,
      );
    }

    let customer = org.stripe_customer_id as string | undefined;
    if (!customer) {
      const created = await stripe.customers.create({
        email: user.email,
        name: org.name,
        metadata: { orgId },
      });
      customer = created.id;
      const { error: custErr } = await admin
        .from('orgs')
        .update({ stripe_customer_id: customer })
        .eq('id', orgId);
      if (custErr) return json({ error: 'Could not start checkout. Try again.' }, 500, req);
    }

    // A3: never create a second subscription. If one is already active, send the
    // admin to the billing portal instead of double-charging.
    const active = await stripe.subscriptions.list({ customer, status: 'active', limit: 1 });
    if (active.data.length > 0) {
      const portal = await stripe.billingPortal.sessions.create({
        customer,
        return_url: PORTAL_RETURN,
      });
      return json({ url: portal.url, alreadySubscribed: true }, 200, req);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      metadata: { orgId, tierId },
      // Stamp the subscription too, so subscription.* webhooks carry orgId
      // directly (the webhook still falls back to the customer map).
      subscription_data: { metadata: { orgId, tierId } },
    });
    return json({ url: session.url }, 200, req);
  } catch (err) {
    console.error('stripe-checkout error', err);
    return json({ error: 'Could not start checkout. Try again.' }, 500, req);
  }
});

// Individual Personal checkout. The customer id persists on the buyer's
// user_entitlements row so repeat checkouts reuse one Stripe customer and the
// portal can find it; the row is created here with a revoked status (no access)
// and flipped to active by the webhook when payment completes. Access is never
// granted here, only by the webhook (the sole entitlement writer).
async function checkoutIndividual(
  userId: string,
  email: string | undefined,
  price: string,
  req: Request,
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<Response> {
  const { data: ent, error: entErr } = await admin
    .from('user_entitlements')
    .select('stripe_customer_id, status, source')
    .eq('user_id', userId)
    .maybeSingle();
  if (entErr) return json({ error: 'Could not start checkout. Try again.' }, 500, req);

  // Already entitled by EITHER rail: never start a second purchase. An Apple sub
  // is managed on the device (no Stripe portal); a Stripe sub opens the portal.
  // This also protects an active Apple row from being clobbered to
  // incomplete/stripe by the customer-create upsert below.
  if (ent && isEntitled({ status: ent.status })) {
    if (ent.source === 'apple' || !ent.stripe_customer_id) {
      return json(
        { error: 'You already have Personal. Manage it on your iPhone (Settings > your name > Subscriptions).' },
        409,
        req,
      );
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: ent.stripe_customer_id,
      return_url: PORTAL_RETURN,
    });
    return json({ url: portal.url, alreadySubscribed: true }, 200, req);
  }

  let customer = ent?.stripe_customer_id as string | undefined;
  if (!customer) {
    const created = await stripe.customers.create({ email, metadata: { userId } });
    customer = created.id;
    // Persist the customer id so a second checkout reuses it and the portal can
    // open. If a row already exists (e.g. a lapsed/incomplete one), UPDATE only
    // the customer id so we never clobber another rail's source/status; else
    // insert a fresh revoked row ('incomplete' = no access) that the webhook
    // flips to active when payment resolves.
    const write = ent
      ? admin.from('user_entitlements').update({ stripe_customer_id: customer }).eq('user_id', userId)
      : admin.from('user_entitlements').insert({
          user_id: userId,
          tier_id: 'personal',
          status: 'incomplete',
          source: 'stripe',
          stripe_customer_id: customer,
          issued_at: new Date().toISOString(),
        });
    const { error: upErr } = await write;
    if (upErr) return json({ error: 'Could not start checkout. Try again.' }, 500, req);
  }

  // A3: never double-charge. An already-active sub goes to the portal.
  const active = await stripe.subscriptions.list({ customer, status: 'active', limit: 1 });
  if (active.data.length > 0) {
    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: PORTAL_RETURN,
    });
    return json({ url: portal.url, alreadySubscribed: true }, 200, req);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    metadata: { userId, tierId: 'personal' },
    subscription_data: { metadata: { userId, tierId: 'personal' } },
  });
  return json({ url: session.url }, 200, req);
}
