// The pure parts of push-send and push-unregister, kept here so Deno tests
// reach them without a network (push.test.ts).

// push-send keeps a keyed hash of the session id, never the id (0029). Below
// this length the key is treated as unset, and push-send refuses to send.
export const MIN_SESSION_HASH_KEY_LENGTH = 32;

/** The session-hash key, or undefined when it is missing or too short. */
export function sessionHashKey(raw: string | undefined): string | undefined {
  const key = raw ?? '';
  return key.length >= MIN_SESSION_HASH_KEY_LENGTH ? key : undefined;
}

/** HMAC-SHA256 of `input` under `key`, as lowercase hex. */
export async function hmacSha256Hex(key: string, input: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// An APNs device token is 32 bytes, delivered to the app as 64 hex characters.
const APNS_TOKEN = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One phone docks to a handful of computers; anything past this is not a real
// request, so it is refused rather than run as a large delete.
export const MAX_GRANT_IDS = 50;

/** What push-unregister was asked to delete, or why the request is refused. */
export type UnregisterRequest =
  | { ok: true; token?: string; grantIds: string[]; all: boolean }
  | { ok: false; error: string };

/** Read push-unregister's body: `{ token }`, `{ grantIds }`, both, or
 *  `{ all: true }`. Anything else is refused before a delete runs. */
export function parseUnregister(body: unknown): UnregisterRequest {
  const { token, grantIds, all } = (body && typeof body === 'object' ? body : {}) as {
    token?: unknown;
    grantIds?: unknown;
    all?: unknown;
  };
  if (token !== undefined && (typeof token !== 'string' || !APNS_TOKEN.test(token))) {
    return { ok: false, error: 'That does not look like an APNs device token.' };
  }
  const ids = grantIds === undefined ? [] : grantIds;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_GRANT_IDS ||
    !ids.every((id) => typeof id === 'string' && UUID.test(id))
  ) {
    return { ok: false, error: `Send up to ${MAX_GRANT_IDS} grant ids.` };
  }
  const everything = all === true;
  if (!everything && token === undefined && ids.length === 0) {
    return {
      ok: false,
      error: 'Send {"token": "..."}, {"grantIds": ["..."]}, or {"all": true}.',
    };
  }
  return {
    ok: true,
    ...(typeof token === 'string' ? { token } : {}),
    grantIds: ids as string[],
    all: everything,
  };
}
