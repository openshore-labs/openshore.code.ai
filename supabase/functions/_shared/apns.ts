// APNs provider client for the content-free completion push. This SIGNS a
// provider authentication token (ES256 JWT, iss=teamId, kid=keyId) and POSTs an
// alert to Apple's HTTP/2 APNs endpoint. It is distinct from _shared/apple.ts,
// which only VERIFIES inbound signed StoreKit data and never signs a provider
// token; the keys are different too, so this uses its OWN secrets and must not
// be pointed at the App Store Server API key.
//
// Env (Supabase function secrets):
//   APNS_AUTH_KEY_P8 - the .p8 key contents (the PEM block, newlines may be
//                      escaped as \n; both forms are accepted).
//   APNS_KEY_ID      - the 10-char Key ID of that APNs auth key.
//   APNS_TEAM_ID     - the Apple Developer Team ID (10 chars).
//   APNS_TOPIC       - the push topic, i.e. the app bundle id. Defaults to
//                      ai.openshore.oscode.
//
// Apple rejects a provider token regenerated too often (403
// TooManyProviderTokenUpdates) and accepts one for up to an hour, so the signed
// JWT is cached and reused for ~40 minutes.

const PROD_HOST = 'https://api.push.apple.com';
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';
const DEFAULT_TOPIC = 'ai.openshore.oscode';
const TOKEN_TTL_MS = 40 * 60 * 1000; // refresh well inside Apple's 1-hour ceiling

export type ApsEnvironment = 'sandbox' | 'production';

export interface ApnsResult {
  ok: boolean;
  status: number;
  // Apple's reason string on failure, e.g. "BadDeviceToken", "Unregistered".
  reason?: string;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

// Import the ES256 private key from the .p8 PEM (PKCS#8). The stored secret may
// carry real newlines or escaped "\n"; both are normalized.
async function importSigningKey(p8: string): Promise<CryptoKey> {
  const pem = p8.replace(/\\n/g, '\n');
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

interface CachedToken {
  jwt: string;
  mintedAt: number;
}
let cached: CachedToken | null = null;

// Mint (or reuse) the provider JWT. Web Crypto returns the ECDSA signature as the
// raw r||s concatenation, which is exactly what a JWS wants, so no DER unwrap.
async function providerToken(): Promise<string> {
  const now = Date.now();
  if (cached && now - cached.mintedAt < TOKEN_TTL_MS) return cached.jwt;

  const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
  const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
  const p8 = Deno.env.get('APNS_AUTH_KEY_P8') ?? '';
  if (!keyId || !teamId || !p8) {
    throw new Error('APNs is not configured (APNS_KEY_ID / APNS_TEAM_ID / APNS_AUTH_KEY_P8).');
  }

  const header = base64UrlFromString(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64UrlFromString(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
  const signingInput = `${header}.${claims}`;
  const key = await importSigningKey(p8);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  const jwt = `${signingInput}.${base64UrlFromBytes(sig)}`;
  cached = { jwt, mintedAt: now };
  return jwt;
}

export function apnsConfigured(): boolean {
  return Boolean(
    Deno.env.get('APNS_KEY_ID') && Deno.env.get('APNS_TEAM_ID') && Deno.env.get('APNS_AUTH_KEY_P8'),
  );
}

/**
 * Send one content-free alert to a device token. `environment` selects the APNs
 * host; a token minted under aps-environment development is only valid against
 * the sandbox host and vice versa. The alert body must never carry code or
 * prompt text; `data` is small and opaque (the session id and kind).
 */
export async function sendApns(options: {
  deviceToken: string;
  environment: ApsEnvironment;
  title: string;
  body: string;
  threadId?: string;
  data?: Record<string, unknown>;
}): Promise<ApnsResult> {
  const topic = Deno.env.get('APNS_TOPIC') ?? DEFAULT_TOPIC;
  const host = options.environment === 'sandbox' ? SANDBOX_HOST : PROD_HOST;
  const jwt = await providerToken();

  const payload = {
    aps: {
      alert: { title: options.title, body: options.body },
      sound: 'default',
      ...(options.threadId ? { 'thread-id': options.threadId } : {}),
    },
    ...(options.data ?? {}),
  };

  const res = await fetch(`${host}/3/device/${options.deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 200) {
    await res.body?.cancel();
    return { ok: true, status: 200 };
  }
  // Apple returns a small JSON body with a `reason` on failure.
  let reason: string | undefined;
  try {
    const body = (await res.json()) as { reason?: string };
    reason = body.reason;
  } catch {
    // no body
  }
  return { ok: false, status: res.status, reason };
}
