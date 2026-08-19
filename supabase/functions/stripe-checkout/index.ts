// Create a Stripe Checkout session for a commercial OS Code plan. The purchase
// happens on the WEB (openshore.ai), in the system browser, never inside the
// iOS app: seat-based SaaS bought in-app trips Apple 3.1.1. The app only ever
// signs in and reads the resulting entitlement.
//
// Env (Supabase function secrets):
//   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   STRIPE_PRICE_MICRO, STRIPE_PRICE_SMALL, STRIPE_PRICE_GROWTH, STRIPE_PRICE_SCALE,
//   CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' });

const PRICE_BY_TIER: Record<string, string | undefined> = {
  commercial_micro: Deno.env.get('STRIPE_PRICE_MICRO'),
  commercial_small: Deno.env.get('STRIPE_PRICE_SMALL'),
  commercial_mid: Deno.env.get('STRIPE_PRICE_GROWTH'),
  commercial_large: Deno.env.get('STRIPE_PRICE_SCALE'),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    // Resolve the caller from their JWT, never from the body.
    const { data: userData } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    const user = userData.user;
    if (!user) return json({ error: 'Sign in first.' }, 401);

    const { orgId, tierId } = (await req.json()) as { orgId: string; tierId: string };
    const price = PRICE_BY_TIER[tierId];
    if (!price) return json({ error: 'Unknown or non-purchasable tier.' }, 400);

    // The caller must be an admin of this org.
    const { data: isAdmin } = await supabase.rpc('is_org_admin', { p_org: orgId });
    if (!isAdmin) return json({ error: 'Only an org admin can buy seats.' }, 403);

    const { data: org } = await supabase.from('orgs').select('stripe_customer_id, name').eq('id', orgId).single();
    let customer = org?.stripe_customer_id as string | undefined;
    if (!customer) {
      const created = await stripe.customers.create({ email: user.email, name: org?.name, metadata: { orgId } });
      customer = created.id;
      await supabase.from('orgs').update({ stripe_customer_id: customer }).eq('id', orgId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: 1 }],
      success_url: Deno.env.get('CHECKOUT_SUCCESS_URL') ?? 'https://openshore.ai/os-code/?checkout=success',
      cancel_url: Deno.env.get('CHECKOUT_CANCEL_URL') ?? 'https://openshore.ai/os-code/',
      metadata: { orgId, tierId },
    });
    return json({ url: session.url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
