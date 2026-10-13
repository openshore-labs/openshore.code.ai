// The published catalog's signature (security review of the model library,
// 2026-10-12, L7). Whoever holds the token that publishes the catalog could
// otherwise change it, and with it every download's address and pinned
// SHA-256. So the catalog builds in CI and is signed there with an Ed25519
// key whose private half lives only in the catalog job's secret; the engine
// and the app take a fetched catalog only when its detached signature checks
// against the public half pinned here, the way every desktop update is
// checked (app/electron/releaseVerify.ts).
//
// The signed message is exactly
//   openshore-catalog-v1\n<file name>\n<sha256 of the file, lowercase hex>
// and `os-code/scripts/build-catalog/sign.ts` writes `<file>.sig` (base64 of
// the 64 signature bytes) the same way. Pure and Node-free (WebCrypto), so
// the iPhone checks it as the engine does; through os-code/protocol.

/** The public half of the catalog signing key: base64 of its 32 raw bytes,
 *  as `node app/scripts/release-keygen.mjs catalog` prints it. Empty until
 *  the founder runs that and saves the private half as the catalog job's
 *  CATALOG_SIGNING_KEY secret: an empty key is a state the code handles (a
 *  catalog is taken unsigned, as before). Once a key is pinned, every
 *  published catalog must carry a signature from its private half, or
 *  installed apps keep the last catalog they verified. */
export const CATALOG_PUBLIC_KEY = '';

export const CATALOG_SIGNATURE_CONTEXT = 'openshore-catalog-v1';

/** The file the signature names: the library catalog. */
export const SIGNED_CATALOG_FILE = 'catalog.v2.json';

/** The exact text a catalog signature covers. */
export function catalogMessage(sha256Hex: string, file = SIGNED_CATALOG_FILE): string {
  return `${CATALOG_SIGNATURE_CONTEXT}\n${file}\n${sha256Hex}`;
}

export type CatalogVerdict =
  | { verdict: 'verified' }
  /** No key is pinned yet, so the catalog is taken as before. */
  | { verdict: 'unpinned' }
  | { verdict: 'refused'; reason: string };

function fromBase64(text: string): Uint8Array | undefined {
  try {
    const raw = atob(text.trim());
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Subtle = NonNullable<typeof globalThis.crypto>['subtle'];

/** Check a fetched catalog's bytes against its detached signature. Refused
 *  when a key is pinned and the signature is missing, malformed, or does not
 *  match, and when this device cannot check Ed25519 at all (fail closed). */
export async function verifyCatalogBytes(
  bytes: Uint8Array,
  signature: string | undefined,
  publicKey: string = CATALOG_PUBLIC_KEY,
  subtle: Subtle | undefined = globalThis.crypto?.subtle,
): Promise<CatalogVerdict> {
  if (!publicKey.trim()) return { verdict: 'unpinned' };
  const refused = (reason: string): CatalogVerdict => ({ verdict: 'refused', reason });
  if (!signature?.trim()) return refused('the catalog carries no signature');
  if (!subtle) return refused('this device cannot check signatures');
  const key = fromBase64(publicKey);
  if (!key || key.length !== 32) return refused('the pinned catalog key is not an Ed25519 key');
  const sig = fromBase64(signature);
  if (!sig || sig.length !== 64) return refused('the catalog signature is malformed');
  try {
    const digest = await subtle.digest('SHA-256', bytes);
    const message = new TextEncoder().encode(catalogMessage(hex(digest)));
    const imported = await subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    const ok = await subtle.verify({ name: 'Ed25519' }, imported, sig, message);
    return ok ? { verdict: 'verified' } : refused('the catalog signature does not match');
  } catch {
    return refused('this device cannot check Ed25519 signatures');
  }
}

/** Whether a catalog is older than the one already trusted, by its
 *  `updated` date: a signed catalog from last month cannot be served again
 *  in place of this week's. */
export function olderThanTrusted(
  next: { updated: string },
  trusted?: { updated: string },
): boolean {
  return trusted !== undefined && next.updated < trusted.updated;
}
