// Fire a content-free completion push. The desktop daemon calls this when a run
// finishes while idle, or blocks on an approval, and no phone is watching.
//
// Trust comes from the opaque grant in the body (verify_jwt=false, like the
// Stripe/Apple webhooks). The target user and device tokens are derived SOLELY
// from the grant, never from the request, so a leaked grant cannot be aimed at
// another user: the worst it can do is content-free banners to its own owner's
// devices, rate-limited, until the grant is revoked.
//
// The request carries only { grant, sessionId, kind, seq }. No code, no prompt,
// no titles from the run ever reach this function or Apple.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the APNS_* secrets used by
// _shared/apns.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { apnsConfigured, sendApns, type ApsEnvironment } from '../_shared/apns.ts';

// A wedged daemon must not hammer APNs, and a leaked grant must not be able to
// notification-bomb the owner.
const DONE_COOLDOWN_MS = 15_000; // per session, for terminal "finished" pushes
const DAILY_CEILING = 200; // per user, across all sessions

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function messageFor(kind: 'approval' | 'done'): { title: string; body: string } {
  if (kind === 'approval') {
    return { title: 'OS Code', body: 'A session needs your approval to keep going.' };
  }
  return { title: 'OS Code', body: 'Your session finished.' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  try {
    if (!apnsConfigured()) {
      return json({ error: 'Push is not configured on the server yet.' }, 503, req);
    }

    const { grant, sessionId, kind, seq } = (await req.json().catch(() => ({}))) as {
      grant?: string;
      sessionId?: string;
      kind?: string;
      seq?: number;
    };
    if (!grant || !sessionId || (kind !== 'approval' && kind !== 'done')) {
      return json({ error: 'grant, sessionId and a valid kind are required.' }, 400, req);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Resolve the grant. A missing or revoked grant is a 403, and the response
    // deliberately reveals nothing about which.
    const tokenSha256 = await sha256Hex(grant);
    const { data: grantRow, error: grantErr } = await admin
      .from('push_grants')
      .select('id, user_id, sent_count, revoked_at')
      .eq('token_sha256', tokenSha256)
      .maybeSingle();
    if (grantErr) throw new Error(`push_grants read failed: ${grantErr.message}`);
    if (!grantRow || grantRow.revoked_at) {
      return json({ error: 'That push grant is not valid.' }, 403, req);
    }
    const userId = grantRow.user_id as string;

    // Daily ceiling across all of this user's sessions.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: sentToday, error: countErr } = await admin
      .from('push_sends')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', dayAgo);
    if (countErr) throw new Error(`push_sends count failed: ${countErr.message}`);
    if ((sentToday ?? 0) >= DAILY_CEILING) {
      return json({ ok: true, throttled: true }, 200, req);
    }

    // Per-session cooldown for terminal "finished" pushes. Approvals are the run
    // blocking on the user and bypass the cooldown, but still de-dupe below.
    if (kind === 'done') {
      const coolAgo = new Date(Date.now() - DONE_COOLDOWN_MS).toISOString();
      const { count: recent, error: recentErr } = await admin
        .from('push_sends')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .gte('created_at', coolAgo);
      if (recentErr) throw new Error(`push_sends cooldown check failed: ${recentErr.message}`);
      if ((recent ?? 0) > 0) return json({ ok: true, cooled: true }, 200, req);
    }

    // Idempotency: one row per (user, dedupe_key). If the insert conflicts, an
    // identical push already went out (a push-send retry), so do not buzz again.
    const dedupeKey = `${sessionId}:${kind}:${seq ?? 'na'}`;
    const { error: dedupeErr } = await admin
      .from('push_sends')
      .insert({ user_id: userId, session_id: sessionId, dedupe_key: dedupeKey });
    if (dedupeErr) {
      // 23505 = unique_violation: already sent this exact push.
      if ((dedupeErr as { code?: string }).code === '23505') {
        return json({ ok: true, deduped: true }, 200, req);
      }
      throw new Error(`push_sends insert failed: ${dedupeErr.message}`);
    }

    // Target devices come only from the grant's user, never from the request.
    const { data: devices, error: devErr } = await admin
      .from('push_devices')
      .select('device_token, aps_environment')
      .eq('user_id', userId);
    if (devErr) throw new Error(`push_devices read failed: ${devErr.message}`);

    const { title, body } = messageFor(kind);
    let sent = 0;
    for (const device of devices ?? []) {
      const result = await sendApns({
        deviceToken: device.device_token as string,
        environment: device.aps_environment as ApsEnvironment,
        title,
        body,
        threadId: sessionId,
        data: { sessionId, kind },
      });
      if (result.ok) {
        sent += 1;
        continue;
      }
      // A dead token (the app was deleted, or the token rotated): drop it so it
      // is not retried forever. Everything else is left in place.
      if (result.status === 410 || result.reason === 'Unregistered' || result.reason === 'BadDeviceToken') {
        await admin.from('push_devices').delete().eq('device_token', device.device_token);
      } else {
        console.error('apns send failed', result.status, result.reason);
      }
    }

    await admin
      .from('push_grants')
      .update({ last_sent_at: new Date().toISOString(), sent_count: Number(grantRow.sent_count ?? 0) + 1 })
      .eq('id', grantRow.id);

    return json({ ok: true, sent }, 200, req);
  } catch (err) {
    console.error('push-send error', err);
    return json({ error: 'Could not send that push.' }, 500, req);
  }
});
