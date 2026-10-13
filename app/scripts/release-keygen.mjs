// Make OpenShore's release signing keys (tech review rulings 1 and 2, 2026-09-29;
// the maintainer release-signing runbook). One command, run once by a maintainer:
//
//   node app/scripts/release-keygen.mjs            # both key pairs
//   node app/scripts/release-keygen.mjs mac        # only the Mac pair
//   node app/scripts/release-keygen.mjs desktop    # only the Windows and Linux pair
//   node app/scripts/release-keygen.mjs catalog    # the published catalog's pair
//
// Each pair is a new Ed25519 key. The private half (base64 of its PKCS#8 DER)
// goes into a build service's secret and nowhere else; the public half
// (base64 of its 32 raw bytes) is pasted into app/electron/releaseKeys.ts, so
// the app can check every update it downloads. Nothing is written to disk.
import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** A new release key pair: `privateKey` for the secret, `publicKey` for the
 *  constant in releaseKeys.ts. */
export function makeReleaseKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKey: spki.subarray(spki.length - 32).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

export const RELEASE_KEYS = {
  mac: {
    title: 'Mac',
    secret: 'OPENSHORE_MAC_SIGNING_KEY',
    where:
      "Codemagic: the app's settings, Environment variables. Group: openshore-mac-signing. Tick Secure.",
    constant: 'MAC_RELEASE_PUBLIC_KEY',
    file: 'app/electron/releaseKeys.ts',
  },
  desktop: {
    title: 'Windows and Linux',
    secret: 'OPENSHORE_DESKTOP_SIGNING_KEY',
    where:
      'GitHub: the repository Settings, Environments, release, Environment secrets, Add environment secret.',
    constant: 'DESKTOP_RELEASE_PUBLIC_KEY',
    file: 'app/electron/releaseKeys.ts',
  },
  // The model library's published catalog (security review, 2026-10-12):
  // its signature is checked by the engine and the app before a catalog is
  // trusted (os-code/src/market/catalogSignature.ts).
  catalog: {
    title: 'Published catalog',
    secret: 'CATALOG_SIGNING_KEY',
    where:
      'GitHub: the repository Settings, Secrets and variables, Actions, New repository secret.',
    constant: 'CATALOG_PUBLIC_KEY',
    file: 'os-code/src/market/catalogSignature.ts',
  },
};

/** The text the command prints for the chosen pairs. */
export function keygenReport(which = ['mac', 'desktop'], make = makeReleaseKeyPair) {
  const lines = [
    'New OpenShore release signing keys. Each private key goes into one secret',
    'and nowhere else: do not save it in a file, a note, or the repository.',
    '',
  ];
  for (const id of which) {
    const k = RELEASE_KEYS[id];
    const pair = make();
    lines.push(
      `== ${k.title} ==`,
      '',
      `1. Private key. Add it as the secret ${k.secret}.`,
      `   Where: ${k.where}`,
      '',
      `   ${pair.privateKey}`,
      '',
      `2. Public key. Paste it between the quotes of ${k.constant}`,
      `   in ${k.file}, then commit and push.`,
      '',
      `   ${pair.publicKey}`,
      '',
    );
  }
  lines.push(
    'When the secrets are saved and the public keys are pushed, the next release',
    'is signed, and every build from then on checks its updates. Clear this',
    'terminal once you are done. Full steps: the maintainer release-signing runbook.',
  );
  return lines.join('\n');
}

function main(argv) {
  const arg = argv[0];
  if (arg && !(arg in RELEASE_KEYS)) {
    console.error(
      `Unknown key "${arg}". Use mac, desktop, catalog, or nothing for mac and desktop.`,
    );
    process.exit(2);
  }
  console.log(keygenReport(arg ? [arg] : ['mac', 'desktop']));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
