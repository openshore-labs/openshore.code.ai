// Mint an opaque, revocable push-capability grant for the signed-in user.
//
// The phone calls this (its access token gates the endpoint, verify_jwt=true),
// gets back a random opaque token ONCE, and hands it to its desktop daemon over
// the trusted Tailscale channel. The daemon later presents the token to
// push-send to fire a content-free completion push. Only the sha256 of the token
// is stored, so the plaintext never lives server-side after this response.
//
// This grant is the ONLY credential the daemon holds for pushing, and it can do
// nothing but cause a content-free push to THIS user's own devices. It has no
// expiry (a long run may finish hours after the app closed); the user or an
// operator revokes it by clearing the row (see push_grants RLS / a future
// settings screen).
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected), SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

    const { label } = (await req.json().catch(() => ({}))) as { label?: string };

    // 32 random bytes, url-safe. The daemon stores this sealed at rest; we store
    // only its hash.
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const token = base64Url(raw);
    const tokenSha256 = await sha256Hex(token);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error } = await admin.from('push_grants').insert({
      user_id: user.id,
      token_sha256: tokenSha256,
      label: typeof label === 'string' ? label.slice(0, 80) : null,
    });
    if (error) throw new Error(`push_grants insert failed: ${error.message}`);

    // Returned exactly once. The phone forwards it to the daemon and does not
    // need to keep it.
    return json({ grant: token }, 200, req);
  } catch (err) {
    console.error('push-grant error', err);
    return json({ error: 'Could not create a push grant. Try again.' }, 500, req);
  }
});
