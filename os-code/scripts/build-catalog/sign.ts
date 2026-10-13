// Sign the built library catalog (security review of the model library,
// 2026-10-12, L7). CI ONLY, after the builder writes build/catalog.v2.json:
//
//   pnpm --filter os-code sign:catalog
//
// The private key (base64 of its PKCS#8 DER, from
// `node app/scripts/release-keygen.mjs catalog`) is read from the environment
// variable CATALOG_SIGNING_KEY, never from an argument, so it stays out of the
// process list and the build log. This writes <file>.sig beside the catalog:
// the base64 of the Ed25519 signature over
//
//   openshore-catalog-v1\n<file name>\n<sha256 of the file, lowercase hex>
//
// the exact message src/market/catalogSignature.ts checks. Before writing it
// checks the signature itself against the pinned public key, so a key that
// does not match what installed apps pin fails the job instead of every app
// refusing the catalog. With no key pinned and no secret, it signs nothing;
// with a key pinned and no secret, it fails, since apps would refuse the
// unsigned catalog.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_PUBLIC_KEY,
  catalogMessage,
  verifyCatalogBytes,
} from '../../src/market/catalogSignature.js';

function privateKeyOf(base64: string) {
  const key = createPrivateKey({
    key: Buffer.from(base64.trim(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The key is not an Ed25519 key.');
  return key;
}

/** The public half of a private key, as the code pins it (base64 of the 32
 *  raw bytes). */
export function publicKeyOf(privateKeyBase64: string): string {
  const spki = createPublicKey(privateKeyOf(privateKeyBase64)).export({
    format: 'der',
    type: 'spki',
  });
  return spki.subarray(spki.length - 32).toString('base64');
}

/** The signature for a catalog file's bytes: base64 of the 64 bytes. */
export function signCatalog(bytes: Uint8Array, privateKeyBase64: string, file: string): string {
  const sha = createHash('sha256').update(bytes).digest('hex');
  return sign(
    null,
    Buffer.from(catalogMessage(sha, file), 'utf8'),
    privateKeyOf(privateKeyBase64),
  ).toString('base64');
}

/** Sign `path` with the key in `env`, checked against `pinned`. Returns what
 *  happened, for the build log; throws when the job must fail. */
export async function signCatalogFile(
  path: string,
  env: Record<string, string | undefined> = process.env,
  pinned: string = CATALOG_PUBLIC_KEY,
): Promise<string> {
  const secret = env.CATALOG_SIGNING_KEY?.trim();
  if (!secret) {
    if (pinned.trim()) {
      throw new Error(
        'A catalog key is pinned but CATALOG_SIGNING_KEY is not set, so installed apps would refuse this catalog. Nothing was signed.',
      );
    }
    return 'No catalog key is pinned and no CATALOG_SIGNING_KEY is set: the catalog is published unsigned, as before.';
  }
  if (!existsSync(path)) throw new Error(`There is no catalog at ${path} to sign.`);
  const key = publicKeyOf(secret);
  if (!pinned.trim()) {
    throw new Error(
      `CATALOG_SIGNING_KEY is set but no key is pinned. Paste ${key} into CATALOG_PUBLIC_KEY in os-code/src/market/catalogSignature.ts first.`,
    );
  }
  if (key !== pinned.trim()) {
    throw new Error(
      `CATALOG_SIGNING_KEY's public half (${key}) is not the pinned key, so installed apps would refuse this catalog.`,
    );
  }
  const bytes = new Uint8Array(readFileSync(path));
  const signature = signCatalog(bytes, secret, basename(path));
  const check = await verifyCatalogBytes(bytes, signature, pinned);
  if (check.verdict !== 'verified') {
    throw new Error(
      `The new signature did not check (${'reason' in check ? check.reason : check.verdict}).`,
    );
  }
  writeFileSync(`${path}.sig`, `${signature}\n`);
  return `Signed ${basename(path)} with the pinned key ${key}.`;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(resolve(HERE, '..', '..'), 'build', 'catalog.v2.json');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  signCatalogFile(process.argv[2] ?? DEFAULT_PATH)
    .then((line) => console.log(line))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
