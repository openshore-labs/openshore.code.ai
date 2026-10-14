// Undo what push-register and push-grant did for the signed-in user, so a
// device that signs out, or forgets a computer, stops being reachable by push.
//
// The phone POSTs with the caller's access token (verify_jwt=true), the same
// auth as push-register. Every delete is scoped to the caller's own user id,
// so nobody can unregister another person's device or grant:
//
//   { token }      this device's APNs token: its push_devices row goes, if it
//                  is the caller's. A token that has since moved to another
//                  account is left alone.
//   { grantIds }   the push_grants this device minted (push-grant returns each
//                  one's id, and the phone keeps them per computer): they go,
//                  so the grant a computer holds stops working at once.
//   { all: true }  every push_devices row and every push_grants row the caller
//                  has, for "Sign out everywhere".
//
// push_sends rows are rate accounting, keyed by a hash of the session id
// (0029), and the retention job deletes them after 2 days (0027); they stay
// until then so the daily ceiling still counts them.
//
// The client never deletes push rows directly (RLS has no delete policy on
// either table), so the deletes run with the service role, each filtered by
// the caller's id.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected), SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { parseUnregister } from '../_shared/push.ts';

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

    const asked = parseUnregister(await req.json().catch(() => ({})));
    if (!asked.ok) return json({ error: asked.error }, 400, req);
    const { token, grantIds: ids, all: everything } = asked;

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    let devices = 0;
    let grants = 0;
    if (everything) {
      const d = await admin
        .from('push_devices')
        .delete({ count: 'exact' })
        .eq('user_id', user.id);
      if (d.error) throw new Error(`push_devices delete failed: ${d.error.message}`);
      const g = await admin
        .from('push_grants')
        .delete({ count: 'exact' })
        .eq('user_id', user.id);
      if (g.error) throw new Error(`push_grants delete failed: ${g.error.message}`);
      devices = d.count ?? 0;
      grants = g.count ?? 0;
    } else {
      if (typeof token === 'string') {
        const d = await admin
          .from('push_devices')
          .delete({ count: 'exact' })
          .eq('device_token', token)
          .eq('user_id', user.id);
        if (d.error) throw new Error(`push_devices delete failed: ${d.error.message}`);
        devices = d.count ?? 0;
      }
      if (ids.length) {
        const g = await admin
          .from('push_grants')
          .delete({ count: 'exact' })
          .in('id', ids)
          .eq('user_id', user.id);
        if (g.error) throw new Error(`push_grants delete failed: ${g.error.message}`);
        grants = g.count ?? 0;
      }
    }

    return json({ ok: true, devices, grants }, 200, req);
  } catch (err) {
    console.error('push-unregister error', err);
    return json({ error: 'Could not turn off notifications for this device.' }, 500, req);
  }
});
