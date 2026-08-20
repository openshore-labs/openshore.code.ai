// Shared CORS for the OS Code edge functions. Auth is the bearer token, never
// the origin, and no credentialed cookies are used, so a wildcard origin is safe
// (a cross-site page cannot read a response without the user's bearer token).
//
// P2-18: the wildcard is the default, but set CORS_ALLOWED_ORIGINS (a comma-
// separated list, e.g. "https://openshore.ai") as a function secret to tighten
// to an allowlist. When set, only a listed Origin is echoed back; anything else
// gets a non-matching origin and the browser blocks the read. Leaving it unset
// preserves today's behavior exactly, so this can be turned on without a code
// change when the founder is ready.
const ALLOWED = (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function allowOrigin(req?: Request): string {
  if (ALLOWED.length === 0) return '*';
  const origin = req?.headers.get('Origin') ?? '';
  return ALLOWED.includes(origin) ? origin : ALLOWED[0];
}

export function corsHeaders(req?: Request): Record<string, string> {
  return {
    'access-control-allow-origin': allowOrigin(req),
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json' },
  });
}
