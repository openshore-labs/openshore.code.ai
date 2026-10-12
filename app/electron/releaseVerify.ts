// Release integrity for every desktop update (CTO rulings 1 and 2,
// 2026-09-29). A release file is trusted only when its detached Ed25519
// signature checks against a public key pinned in the app (releaseKeys.ts).
// The token that uploads release files (a GitHub PAT on Codemagic, the
// workflow token on GitHub) could also replace them, so a hash published next
// to the file proves nothing; a separate signing key turns a leaked token
// into a refused update instead of code running on every desktop.
//
// The signed message is exactly
//   openshore-release-v1\n<asset name>\n<sha256 of the file, lowercase hex>
// and the asset name must carry the version being installed, so an older
// signed build cannot be served again as the new one: its name says the old
// version, and renaming it breaks the signature. app/scripts/release-sign.mjs
// writes the `.sig` files (base64 of the 64 signature bytes) the same way,
// and app/test/releaseVerify.test.ts signs with that script and checks here.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

export const RELEASE_SIGNATURE_CONTEXT = 'openshore-release-v1';

/** The exact bytes a release signature covers. */
export function releaseMessage(assetName: string, sha256Hex: string): Buffer {
  return Buffer.from(`${RELEASE_SIGNATURE_CONTEXT}\n${assetName}\n${sha256Hex}`, 'utf8');
}

/** Whether `name` carries `version` as a whole version number:
 *  "OpenShore-0.1.5-arm64-mac.zip" carries 0.1.5, while
 *  "OpenShore-0.1.50-mac.zip" and "OpenShore-10.1.5.exe" do not. */
export function nameCarriesVersion(name: string, version: string): boolean {
  if (!/^\d+(\.\d+)*$/.test(version)) return false;
  const escaped = version.replace(/\./g, '\\.');
  return new RegExp(`(?<![0-9.])${escaped}(?![0-9]|\\.[0-9])`).test(name);
}

// An Ed25519 public key in SubjectPublicKeyInfo form is this fixed prefix
// followed by the 32 raw bytes; the pinned constant holds only the raw bytes.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const RAW_KEY = /^[A-Za-z0-9+/]{43}=$/;
const RAW_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;

function publicKeyOf(base64: string): KeyObject | undefined {
  const text = base64.trim();
  if (!RAW_KEY.test(text)) return undefined;
  try {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(text, 'base64')]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return undefined;
  }
}

/** Whether a pinned constant is a usable key (a test holds both constants to
 *  empty or this). */
export function isReleasePublicKey(base64: string): boolean {
  return publicKeyOf(base64) !== undefined;
}

/** The file's sha256, lowercase hex, read as a stream (a Mac zip is large). */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export type RefusalReason =
  'no-key' | 'bad-key' | 'no-signature' | 'wrong-version' | 'unreadable' | 'bad-signature';

export type AssetVerdict =
  { ok: true; sha256: string } | { ok: false; reason: RefusalReason; detail: string };

/**
 * A signature was there and the download failed it: the file changed after it
 * was signed, another key signed it, or it is a signed build of another
 * version. The download itself is suspect, so nothing opens it, the app or
 * the person by hand (CX cleanup 1, reconciled): on a Mac the release page
 * stays shut, since its download button serves the same file. A missing
 * `.sig`, an empty or broken pinned key, or a file that cannot be read says
 * nothing about the download, and keeps the older paths.
 */
export function signatureFailed(reason: RefusalReason): boolean {
  return reason === 'bad-signature' || reason === 'wrong-version';
}

export interface AssetToVerify {
  /** The downloaded file on disk. */
  file: string;
  /** The release's name for the file: the name the signature covers. */
  name: string;
  /** The version being installed; the name must carry it. */
  version: string;
  /** The `.sig` file's text, or undefined when the release has none. */
  signature: string | undefined;
  /** The pinned public key (releaseKeys.ts); empty when none is pinned. */
  publicKey: string;
}

const refuse = (reason: RefusalReason, detail: string): AssetVerdict => ({
  ok: false,
  reason,
  detail,
});

/**
 * The one check every download-then-run path in app/electron makes before it
 * runs anything (DOWNLOAD_THEN_EXECUTE below). Never throws: every way it can
 * fail is a refusal with a plain reason.
 */
export async function verifyAsset(a: AssetToVerify): Promise<AssetVerdict> {
  if (!a.publicKey.trim()) {
    return refuse('no-key', 'No release key is pinned in this build, so nothing can be checked.');
  }
  const signature = a.signature?.trim();
  if (!signature) {
    return refuse('no-signature', `The release has no signature for ${a.name}.`);
  }
  if (!nameCarriesVersion(a.name, a.version)) {
    return refuse('wrong-version', `${a.name} is not the file for version ${a.version}.`);
  }
  const key = publicKeyOf(a.publicKey);
  if (!key) return refuse('bad-key', 'The release key pinned in this build is not a valid key.');
  if (!RAW_SIGNATURE.test(signature)) {
    return refuse('bad-signature', `The signature for ${a.name} is not a valid signature.`);
  }
  let sha256: string;
  try {
    sha256 = await sha256File(a.file);
  } catch {
    return refuse('unreadable', `The download of ${a.name} could not be read.`);
  }
  let good = false;
  try {
    good = verify(null, releaseMessage(a.name, sha256), key, Buffer.from(signature, 'base64'));
  } catch {
    good = false;
  }
  if (!good) {
    return refuse(
      'bad-signature',
      `${a.name} does not match its signature, so it was not installed.`,
    );
  }
  return { ok: true, sha256 };
}

type SignatureFetch = (
  url: string,
  init: { redirect: 'follow'; signal: AbortSignal },
) => Promise<Response>;

/** A release's `.sig` file, or undefined when it is missing, too big to be a
 *  signature, or out of reach (all refusals once a key is pinned). */
export async function fetchSignatureText(
  url: string,
  fetchImpl: SignatureFetch = fetch,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return undefined;
    if (Number(res.headers.get('content-length')) > 4096) return undefined;
    const text = await res.text();
    return text.length <= 4096 ? text : undefined;
  } catch {
    return undefined;
  }
}

/** What electron-updater downloaded (its update-downloaded event). */
export interface DownloadedUpdate {
  file: string;
  version: string;
}

/**
 * Windows and Linux: the step between electron-updater's download and
 * `quitAndInstall`. With a desktop key pinned, the downloaded file installs
 * only when its `.sig` from the same release checks; a missing or bad one is
 * refused. With no key pinned, it installs as before and says so in the log,
 * since the founder has not run the keygen yet (the maintainer release-signing runbook).
 */
export async function installIfVerified(opts: {
  downloaded: DownloadedUpdate | undefined;
  publicKey: string;
  /** Where the release keeps the `.sig` for a file of this name. */
  signatureUrl: (name: string, version: string) => string;
  fetchSignature?: (url: string) => Promise<string | undefined>;
  install: () => void;
  /** `failed` is true when a signature was there and the download failed it
   *  (`signatureFailed`), so the bar can say so. */
  refuse: (detail: string, failed: boolean) => void;
  log?: (line: string) => void;
}): Promise<'installed' | 'installed-unchecked' | 'refused'> {
  const log = opts.log ?? ((line: string) => console.log(line));
  if (!opts.publicKey.trim()) {
    log(
      '[update] No desktop release key is pinned in this build, so the update installs without a signature check (the maintainer release-signing runbook).',
    );
    opts.install();
    return 'installed-unchecked';
  }
  const downloaded = opts.downloaded;
  if (!downloaded?.file) {
    log('[update] The downloaded update could not be found, so it was not installed.');
    opts.refuse('The downloaded update could not be found, so it was not installed.', false);
    return 'refused';
  }
  const name = basename(downloaded.file);
  const signature = await (opts.fetchSignature ?? fetchSignatureText)(
    opts.signatureUrl(name, downloaded.version),
  );
  const verdict = await verifyAsset({
    file: downloaded.file,
    name,
    version: downloaded.version,
    signature,
    publicKey: opts.publicKey,
  });
  if (!verdict.ok) {
    log(`[update] Refused ${name}: ${verdict.reason}. ${verdict.detail}`);
    opts.refuse(verdict.detail, signatureFailed(verdict.reason));
    return 'refused';
  }
  log(`[update] ${name} matches its signature (sha256 ${verdict.sha256}); installing.`);
  opts.install();
  return 'installed';
}

/** A place in app/electron that saves a download and then runs or opens it. */
export interface DownloadThenRun {
  /** The file (under app/electron) that saves the download. */
  file: string;
  /** What runs or opens the saved file, in plain words. */
  runs: string;
  /** verifyAsset: checked against a pinned key before anything runs. none:
   *  there is nothing to check against, and `why` says what protects it. */
  check: 'verifyAsset' | 'none';
  why: string;
}

/**
 * Every download-then-run path in app/electron. A new one is not done until it
 * is listed here: app/test/releaseVerify.test.ts fails on a file that saves a
 * download and is missing, and on a 'verifyAsset' entry that runs something
 * before the check.
 */
export const DOWNLOAD_THEN_RUN: readonly DownloadThenRun[] = [
  {
    file: 'macUpdate.ts',
    runs: 'The Mac update: hdiutil attach or ditto -x, then the swapped-in app.',
    check: 'verifyAsset',
    why: 'Checked against MAC_RELEASE_PUBLIC_KEY before it is unpacked. No key, no .sig or a bad signature opens the release page instead.',
  },
  {
    file: 'main.ts',
    runs: "electron-updater's quitAndInstall on Windows and Linux.",
    check: 'verifyAsset',
    why: 'Checked against DESKTOP_RELEASE_PUBLIC_KEY before it installs. Skipped, and logged, while no desktop key is pinned.',
  },
  {
    file: 'ollama.ts',
    runs: "Ollama's own installer, opened by main.ts (osc:ollamaInstall).",
    check: 'none',
    why: "Ollama publishes no signature for OpenShore to check. It comes over TLS from ollama.com and keeps its downloaded-from-the-internet mark (quarantine on macOS, the Mark of the Web on Windows), so Gatekeeper or SmartScreen checks Ollama's own code signature when it opens.",
  },
];
