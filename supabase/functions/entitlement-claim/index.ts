// Return a SIGNED entitlement claim for the caller's org. The app caches it and
// honors it offline within a grace window, and verifies the Ed25519 signature
// against a public key baked into the bundle (VITE_ENTITLEMENT_PUBLIC_KEY), so a
// user cannot hand-edit a cached claim to forge a higher tier. This mirrors the
// signed-claim-with-grace shape of the desktop license (os-code/src/license).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      ENTITLEMENT_SIGNING_KEY (Ed25519 private key, PKCS8 base64),
//      ENTITLEMENT_GRACE_DAYS (optional, default 14).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

function b64urlToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(claim: string): Promise<string> {
  const pkcs8 = b64urlToBytes(Deno.env.get('ENTITLEMENT_SIGNING_KEY') ?? '');
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(claim));
  return bytesToB64url(new Uint8Array(sig));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: userData } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
    const user = userData.user;
    if (!user) return json({ error: 'Sign in first.' }, 401);

    const { orgId } = (await req.json()) as { orgId: string };
    const { data: isMember } = await supabase.rpc('is_org_member', { p_org: orgId });
    if (!isMember) return json({ error: 'Not a member of this org.' }, 403);

    const { data: ent } = await supabase
      .from('org_entitlements')
      .select('tier_id, seats, status, valid_until')
      .eq('org_id', orgId)
      .single();

    const graceDays = Number(Deno.env.get('ENTITLEMENT_GRACE_DAYS') ?? '14');
    const claimObj = {
      orgId,
      tier: ent?.tier_id ?? 'personal',
      seats: ent?.seats ?? 0,
      status: ent?.status ?? 'active',
      validUntil: ent?.valid_until ?? null,
      graceDays,
      issuedAt: new Date().toISOString(),
    };
    // Canonical JSON: stable key order so the client verifies the same bytes.
    const claim = JSON.stringify(claimObj);
    const signature = await sign(claim);
    return json({ claim, signature });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
