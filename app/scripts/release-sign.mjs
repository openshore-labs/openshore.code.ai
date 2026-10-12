// Sign release files for OpenShore's updater (CTO rulings 1 and 2,
// 2026-09-29; the maintainer release-signing runbook). Run by the release builds after
// packaging:
//
//   node app/scripts/release-sign.mjs --key-env OPENSHORE_MAC_SIGNING_KEY \
//     [--version 0.1.7] <files...>
//
// The private key (base64 of its PKCS#8 DER, from release-keygen.mjs) is read
// from the environment variable named by --key-env, never from an argument,
// so it stays out of the process list and the build log. For each file this
// writes <file>.sig beside it: the base64 of the Ed25519 signature over
//
//   openshore-release-v1\n<file name>\n<sha256 of the file, lowercase hex>
//
// the exact message app/electron/releaseVerify.ts checks before an update
// runs. With --version, a file whose name does not carry that version is
// refused here, since every installed app would refuse it too.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_SIGNATURE_CONTEXT = 'openshore-release-v1';

/** The exact bytes a release signature covers (releaseVerify.ts has the twin;
 *  app/test/releaseVerify.test.ts holds them equal). */
export function releaseMessage(name, sha256Hex) {
  return Buffer.from(`${RELEASE_SIGNATURE_CONTEXT}\n${name}\n${sha256Hex}`, 'utf8');
}

/** GitHub keeps a release file's name only when it uses these characters (it
 *  turns a space into a dot), and the signature covers the name the app
 *  downloads, so any other name could never check. */
export function isGithubSafeName(name) {
  return /^[0-9A-Za-z._-]+$/.test(name);
}

/** Whether a file name carries the version as a whole number (the twin of
 *  releaseVerify.ts's nameCarriesVersion). */
export function nameCarriesVersion(name, version) {
  if (!/^\d+(\.\d+)*$/.test(version)) return false;
  const escaped = version.replace(/\./g, '\\.');
  return new RegExp(`(?<![0-9.])${escaped}(?![0-9]|\\.[0-9])`).test(name);
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function privateKeyOf(base64) {
  const key = createPrivateKey({
    key: Buffer.from(base64.trim(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The key is not an Ed25519 key.');
  return key;
}

/** The public half of a private key, as the app pins it (base64 of the 32
 *  raw bytes), so a build log shows which key signed. */
export function publicKeyOf(privateKeyBase64) {
  const spki = createPublicKey(privateKeyOf(privateKeyBase64)).export({
    format: 'der',
    type: 'spki',
  });
  return spki.subarray(spki.length - 32).toString('base64');
}

/** Sign one file; returns its name, hash and the `.sig` text. Checks its own
 *  signature before returning, so a damaged key fails here, not on every
 *  desktop. */
export async function signFile(file, privateKeyBase64) {
  const key = privateKeyOf(privateKeyBase64);
  const name = basename(file);
  const sha256 = await sha256File(file);
  const message = releaseMessage(name, sha256);
  const signature = sign(null, message, key);
  if (!verify(null, message, createPublicKey(key), signature)) {
    throw new Error(`The signature for ${name} did not check against its own key.`);
  }
  return { name, sha256, signature: signature.toString('base64') };
}

async function main(argv) {
  let keyEnv;
  let version;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--key-env') keyEnv = argv[++i];
    else if (arg === '--version') version = argv[++i];
    else files.push(arg);
  }
  if (!keyEnv) {
    console.error('Name the variable that holds the private key: --key-env <NAME>.');
    return 2;
  }
  const privateKey = process.env[keyEnv]?.trim();
  if (!privateKey) {
    console.error(`${keyEnv} is empty. Set it to a private key from release-keygen.mjs.`);
    return 1;
  }
  if (files.length === 0) {
    console.error('Name the files to sign.');
    return 2;
  }
  let publicKey;
  try {
    publicKey = publicKeyOf(privateKey);
  } catch (err) {
    console.error(`${keyEnv} is not a usable private key: ${err.message}`);
    return 1;
  }
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`${file} does not exist.`);
      return 1;
    }
    if (!isGithubSafeName(basename(file))) {
      console.error(
        `${basename(file)} would be renamed by GitHub on upload, so its signature could never check. Give it a name of letters, digits, dots, dashes and underscores.`,
      );
      return 1;
    }
    if (version && !nameCarriesVersion(basename(file), version)) {
      console.error(
        `${basename(file)} does not carry version ${version}, so the app would refuse it.`,
      );
      return 1;
    }
  }
  for (const file of files) {
    const { name, sha256, signature } = await signFile(file, privateKey);
    writeFileSync(`${file}.sig`, `${signature}\n`);
    console.log(`Signed ${name} (sha256 ${sha256}).`);
  }
  console.log(`Public key of the signing key: ${publicKey}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
