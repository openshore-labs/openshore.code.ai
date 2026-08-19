// Open the Stripe billing portal for an org's admin, so they can change or
// cancel the plan on the web. Same rule as checkout: this is a web surface, not
// an in-app purchase. Env: STRIPE_SECRET_KEY, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, PORTAL_RETURN_URL.
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-06-20' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: userData } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    if (!userData.user) return json({ error: 'Sign in first.' }, 401);

    const { orgId } = (await req.json()) as { orgId: string };
    const { data: isAdmin } = await supabase.rpc('is_org_admin', { p_org: orgId });
    if (!isAdmin) return json({ error: 'Only an org admin can manage billing.' }, 403);

    const { data: org } = await supabase.from('orgs').select('stripe_customer_id').eq('id', orgId).single();
    if (!org?.stripe_customer_id) return json({ error: 'No billing customer yet.' }, 400);

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: Deno.env.get('PORTAL_RETURN_URL') ?? 'https://openshore.ai/os-code/',
    });
    return json({ url: session.url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
