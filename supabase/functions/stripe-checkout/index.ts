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
import { tierCoversSeats } from '../_shared/entitlement.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' });

const PRICE_BY_TIER: Record<string, string | undefined> = {
  commercial_micro: Deno.env.get('STRIPE_PRICE_MICRO'),
  commercial_small: Deno.env.get('STRIPE_PRICE_SMALL'),
  commercial_mid: Deno.env.get('STRIPE_PRICE_GROWTH'),
  commercial_large: Deno.env.get('STRIPE_PRICE_SCALE'),
};

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

    const { orgId, tierId } = (await req.json()) as { orgId: string; tierId: string };
    const price = PRICE_BY_TIER[tierId];
    if (!price) return json({ error: 'Unknown or non-purchasable tier.' }, 400, req);

    // The caller must be an admin of this org (checked as the caller, not the
    // service role, so auth.uid() resolves inside is_org_admin).
    const { data: isAdmin, error: adminErr } = await asUser.rpc('is_org_admin', { p_org: orgId });
    if (adminErr || !isAdmin) return json({ error: 'Only an org admin can buy seats.' }, 403, req);

    // Privileged client for reads/writes on orgs (stripe_customer_id).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

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
        return_url: Deno.env.get('PORTAL_RETURN_URL') ?? 'https://openshore.ai/os-code/',
      });
      return json({ url: portal.url, alreadySubscribed: true }, 200, req);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: 1 }],
      success_url: Deno.env.get('CHECKOUT_SUCCESS_URL') ?? 'https://openshore.ai/os-code/?checkout=success',
      cancel_url: Deno.env.get('CHECKOUT_CANCEL_URL') ?? 'https://openshore.ai/os-code/',
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
