// Open the Stripe billing portal for an org's admin, so they can change or
// cancel the plan on the web. Same rule as checkout: this is a web surface, not
// an in-app purchase.
//
// Auth (P0-1): the admin check runs on a caller-scoped anon client so
// auth.uid() = the caller inside is_org_admin; a service-role client reads the
// customer id. Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
// (auto-injected), SUPABASE_SERVICE_ROLE_KEY, PORTAL_RETURN_URL.
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  try {
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

    const { orgId } = (await req.json()) as { orgId?: string };

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Individual Personal billing: no org, the buyer manages their own sub. The
    // customer id lives on their user_entitlements row (written at checkout).
    let customerId: string | undefined;
    if (!orgId) {
      const { data: ent, error: entErr } = await admin
        .from('user_entitlements')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (entErr) return json({ error: 'Could not open billing. Try again.' }, 500, req);
      customerId = ent?.stripe_customer_id ?? undefined;
    } else {
      // Org billing: the caller must be an admin of this org.
      const { data: isAdmin, error: adminErr } = await asUser.rpc('is_org_admin', { p_org: orgId });
      if (adminErr || !isAdmin) return json({ error: 'Only an org admin can manage billing.' }, 403, req);
      const { data: org, error: orgErr } = await admin
        .from('orgs')
        .select('stripe_customer_id')
        .eq('id', orgId)
        .maybeSingle();
      if (orgErr) return json({ error: 'Could not open billing. Try again.' }, 500, req);
      customerId = org?.stripe_customer_id ?? undefined;
    }
    if (!customerId) return json({ error: 'No billing customer yet.' }, 400, req);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: Deno.env.get('PORTAL_RETURN_URL') ?? 'https://openshore.ai/os-code/',
    });
    return json({ url: session.url }, 200, req);
  } catch (err) {
    console.error('stripe-portal error', err);
    return json({ error: 'Could not open billing. Try again.' }, 500, req);
  }
});
