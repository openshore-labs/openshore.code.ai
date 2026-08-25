// Register (or re-register) the signed-in user's APNs device token.
//
// The phone POSTs its token and aps-environment with the caller's access token
// (verify_jwt=true). A service-role upsert binds device_token -> this user,
// overwriting any prior owner so a device that switches accounts maps to exactly
// one current user. The client never writes push_devices directly (RLS denies
// it): only this function and push-send (which prunes dead tokens) touch it.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected), SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

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

    const { token, environment } = (await req.json().catch(() => ({}))) as {
      token?: string;
      environment?: string;
    };
    if (!token || (environment !== 'sandbox' && environment !== 'production')) {
      return json({ error: 'Send {"token": "...", "environment": "sandbox|production"}.' }, 400, req);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error } = await admin.from('push_devices').upsert(
      {
        device_token: token,
        user_id: user.id,
        aps_environment: environment,
        platform: 'ios',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'device_token' },
    );
    if (error) throw new Error(`push_devices upsert failed: ${error.message}`);

    return json({ ok: true }, 200, req);
  } catch (err) {
    console.error('push-register error', err);
    return json({ error: 'Could not register for notifications.' }, 500, req);
  }
});
