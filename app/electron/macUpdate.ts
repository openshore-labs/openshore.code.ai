// The macOS in-place update. The Mac build ships unsigned outside the App Store
// (codemagic.yaml), so electron-updater's Squirrel.Mac path, which checks the
// new build's code signature against the running one, cannot be used. Instead,
// on the person's click: download the release's zip (or dmg) for this Mac and
// its `.sig`, check the signature against the Mac key pinned in the app
// (releaseVerify.ts, CTO ruling 1), and only then unpack it (or mount the dmg
// and copy the app out) with ditto, which keeps the bundle's symlinks and
// permissions intact. Then clear the quarantine flag on the verified bundle
// and hand off to a tiny detached script that waits for this app to quit,
// swaps the old bundle for the new one, opens it, and keeps the old one until
// the new version proves it started.
//
// It only runs where it can finish: a bundle it can write over (not a mounted
// disk image, not a folder the person cannot write to), a key pinned in this
// build, and a release that carries a signature for the file. Anywhere else
// it opens the release page instead, so the person always has a way forward
// and macOS checks what they download themselves. The one exception is a
// signature that is there and fails (reconciliation 2): the page's download
// button serves the same file, so nothing opens, and the bar says the
// download failed its safety check.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { access, chmod, constants, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  fetchSignatureText,
  signatureFailed,
  verifyAsset,
  type RefusalReason,
} from './releaseVerify.js';
import type { ReleaseAsset } from './updateVersion.js';

function runTool(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    );
  });
}

/** Whether this bundle can be replaced in place: it is a real .app outside a
 *  mounted disk image, and its folder is writable. */
export async function canReplace(bundle: string | undefined): Promise<boolean> {
  if (!bundle || bundle.startsWith('/Volumes/')) return false;
  try {
    await access(dirname(bundle), constants.W_OK);
    await access(bundle, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// ---- the launch marker -------------------------------------------------------
// Every start on macOS writes this app's version into a small file in
// userData (main.ts, at ready). The swap script clears it before it opens the
// new version and waits for the new version's number to appear; with no
// marker after LAUNCH_WAIT_SECONDS, the new version never came up, so the old
// one goes back and opens again. Every later version must keep writing it.

export const LAUNCH_MARKER = 'launched-version';
export const LAUNCH_WAIT_SECONDS = 120;

export function launchMarkerPath(userData: string): string {
  return join(userData, LAUNCH_MARKER);
}

/** Record that this version started. Never throws: a marker that cannot be
 *  written only means a later swap restores the old app after two minutes. */
export function writeLaunchMarker(userData: string, version: string): boolean {
  try {
    mkdirSync(userData, { recursive: true });
    writeFileSync(launchMarkerPath(userData), version);
    return true;
  } catch {
    return false;
  }
}

// ---- a version the watchdog rolled back ---------------------------------------
// When the swap script puts the old app back (the new version never wrote its
// marker), it leaves the version it gave up on beside the marker. The old app
// then skips that version on every check, so it is not offered again; a newer
// release is offered as usual.

export const ROLLED_BACK = 'rolled-back-version';

export function rolledBackPath(userData: string): string {
  return join(userData, ROLLED_BACK);
}

/** The version the watchdog last rolled back, or undefined. Never throws. */
export function rolledBackVersion(userData: string): string | undefined {
  try {
    const v = readFileSync(rolledBackPath(userData), 'utf8').trim();
    return /^[0-9A-Za-z.+-]{1,64}$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** One shell word, whatever the path holds. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The detached swap script. It waits for `pid` to exit, moves the old bundle
 * aside as `<bundle>.old`, moves the new one in (putting the old one back if
 * that fails), and opens it. The old bundle stays until the marker says the
 * new version started; after `waitSeconds` with no marker, it stops a hung
 * new version, restores the old bundle, records the version in
 * `rolledBackPath` (beside the marker) so it is not offered again, and opens
 * the old bundle instead.
 */
export function swapScript(o: {
  pid: number;
  bundle: string;
  staged: string;
  work: string;
  marker: string;
  version: string;
  waitSeconds?: number;
  /** The command that opens an app; a test passes a stand-in. */
  open?: string;
}): string {
  const wait = Math.max(1, Math.floor(o.waitSeconds ?? LAUNCH_WAIT_SECONDS));
  return [
    '#!/bin/sh',
    `PID=${Math.floor(o.pid)}`,
    `OLD=${shQuote(o.bundle)}`,
    `NEW=${shQuote(o.staged)}`,
    `WORK=${shQuote(o.work)}`,
    `MARKER=${shQuote(o.marker)}`,
    `ROLLED=${shQuote(join(dirname(o.marker), ROLLED_BACK))}`,
    `VERSION=${shQuote(o.version)}`,
    `OPEN=${shQuote(o.open ?? '/usr/bin/open')}`,
    `WAIT=${wait}`,
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done',
    'rm -f "$MARKER"',
    'rm -rf "$OLD.old"',
    'mv "$OLD" "$OLD.old" || exit 1',
    'if ! mv "$NEW" "$OLD"; then',
    '  mv "$OLD.old" "$OLD"',
    '  "$OPEN" "$OLD"',
    '  rm -rf "$WORK"',
    '  exit 1',
    'fi',
    '"$OPEN" "$OLD"',
    'i=0',
    'while [ "$i" -lt "$WAIT" ]; do',
    '  if [ "$(cat "$MARKER" 2>/dev/null)" = "$VERSION" ]; then',
    '    rm -rf "$OLD.old" "$WORK"',
    '    exit 0',
    '  fi',
    '  sleep 1',
    '  i=$((i + 1))',
    'done',
    '/usr/bin/pkill -f "$OLD/Contents/MacOS/" 2>/dev/null',
    'rm -rf "$OLD"',
    'mv "$OLD.old" "$OLD"',
    'printf \'%s\' "$VERSION" > "$ROLLED" 2>/dev/null',
    '"$OPEN" "$OLD"',
    'rm -rf "$WORK"',
    '',
  ].join('\n');
}

// ---- the update itself ------------------------------------------------------

export interface MacUpdateDeps {
  fetch: (url: string, init?: { redirect?: 'follow'; signal?: AbortSignal }) => Promise<Response>;
  /** Runs one of macOS's own tools (hdiutil, ditto, xattr) to completion. */
  run: (cmd: string, args: string[]) => Promise<void>;
  /** Starts the swap script, detached, so it outlives this process. */
  spawnDetached: (cmd: string, args: string[]) => void;
  shell: { openExternal(url: string): Promise<void> };
  tmpRoot: string;
  pid: number;
}

const defaultDeps = (): Omit<MacUpdateDeps, 'shell'> => ({
  fetch: (url, init) => fetch(url, { redirect: 'follow', ...init }),
  run: runTool,
  spawnDetached: (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(),
  tmpRoot: tmpdir(),
  pid: process.pid,
});

export type MacUpdateOutcome =
  /** The swap script is running; the caller quits the app. */
  | { kind: 'swapping' }
  /** The download's signature was there and it failed (`signatureFailed`).
   *  Nothing opens, not even the release page, which serves the same file. */
  | { kind: 'refused'; reason: RefusalReason; detail: string }
  /** The release page opened instead. `downloaded` is true when the refusal
   *  came after the download (a signature that did not match). */
  | {
      kind: 'release-page';
      reason: RefusalReason | 'cannot-replace';
      detail: string;
      downloaded: boolean;
    };

/**
 * Download, verify, unpack, and stage the new bundle, then start the swap
 * script. Resolves `swapping` once the script is running (the caller quits
 * the app, and the script opens the new version), `refused` when the
 * download failed its signature, or `release-page` after opening the release
 * page for any other refusal. Nothing is unpacked, mounted, or
 * cleared of quarantine before verifyAsset has passed. `onProgress` gets
 * 0..100. A tool that fails after the check throws; the caller opens the
 * release page then too.
 */
export async function updateMacInPlace(opts: {
  version: string;
  asset: ReleaseAsset | undefined;
  signature: ReleaseAsset | undefined;
  bundle: string | undefined;
  releasePage: string;
  publicKey: string;
  userData: string;
  onProgress: (percent: number) => void;
  /** Electron's shell (it opens the release page), plus any stand-ins. */
  deps: Partial<MacUpdateDeps> & Pick<MacUpdateDeps, 'shell'>;
}): Promise<MacUpdateOutcome> {
  const deps: MacUpdateDeps = { ...defaultDeps(), ...opts.deps };
  const toReleasePage = async (
    reason: RefusalReason | 'cannot-replace',
    detail: string,
    downloaded = false,
  ): Promise<MacUpdateOutcome> => {
    await deps.shell.openExternal(opts.releasePage);
    return { kind: 'release-page', reason, detail, downloaded };
  };

  const { asset, bundle } = opts;
  if (!asset || !bundle || !(await canReplace(bundle))) {
    return toReleasePage(
      'cannot-replace',
      'This copy of OpenShore cannot be replaced where it is.',
    );
  }
  // CTO ruling 1: no pinned key means no in-place swap.
  if (!opts.publicKey.trim()) {
    return toReleasePage('no-key', 'No Mac release key is pinned in this build.');
  }
  if (!opts.signature) {
    return toReleasePage('no-signature', `The release has no signature for ${asset.name}.`);
  }
  const signature = await fetchSignatureText(opts.signature.browser_download_url, deps.fetch);
  if (!signature) {
    return toReleasePage(
      'no-signature',
      `The signature for ${asset.name} could not be downloaded.`,
    );
  }

  const work = await mkdtemp(join(deps.tmpRoot, 'openshore-update-'));
  const isDmg = /\.dmg$/i.test(asset.name);
  const download = join(work, isDmg ? 'update.dmg' : 'update.zip');

  opts.onProgress(0);
  const res = await deps.fetch(asset.browser_download_url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  let received = 0;
  let lastReported = -1;
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (!total) return;
    const pct = Math.min(99, Math.floor((received / total) * 100));
    if (pct !== lastReported) {
      lastReported = pct;
      opts.onProgress(pct);
    }
  });
  await pipeline(body, createWriteStream(download));

  // The check comes before anything reads the file as an archive or an image.
  const verdict = await verifyAsset({
    file: download,
    name: asset.name,
    version: opts.version,
    signature,
    publicKey: opts.publicKey,
  });
  if (!verdict.ok) {
    await rm(work, { recursive: true, force: true });
    if (signatureFailed(verdict.reason)) {
      return { kind: 'refused', reason: verdict.reason, detail: verdict.detail };
    }
    return toReleasePage(verdict.reason, verdict.detail, true);
  }

  const unpacked = join(work, 'unpacked');
  if (isDmg) {
    // A disk image (a release built on the founder's own Mac may carry only
    // this): mount it quietly, copy the app out with ditto, and detach.
    const mnt = join(work, 'mnt');
    await deps.run('/usr/bin/hdiutil', [
      'attach',
      '-nobrowse',
      '-noautoopen',
      '-readonly',
      '-mountpoint',
      mnt,
      download,
    ]);
    try {
      const inImage = (await readdir(mnt)).find((n) => n.endsWith('.app'));
      if (!inImage) throw new Error('The disk image did not contain the app.');
      await deps.run('/usr/bin/ditto', [join(mnt, inImage), join(unpacked, inImage)]);
    } finally {
      await deps.run('/usr/bin/hdiutil', ['detach', mnt, '-force']).catch(() => {});
    }
  } else {
    await deps.run('/usr/bin/ditto', ['-x', '-k', download, unpacked]);
  }
  const app = (await readdir(unpacked)).find((n) => n.endsWith('.app'));
  if (!app) throw new Error('The download did not contain the app.');
  const staged = join(unpacked, app);
  // Only a verified bundle reaches this line. An ad-hoc signed build that
  // still carries quarantine is blocked by Gatekeeper on the relaunch, which
  // would strand the person between versions, so the flag is cleared here and
  // nowhere else.
  await deps.run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {});
  await rm(download, { force: true });

  const script = join(work, 'swap.sh');
  await writeFile(
    script,
    swapScript({
      pid: deps.pid,
      bundle,
      staged,
      work,
      marker: launchMarkerPath(opts.userData),
      version: opts.version,
    }),
  );
  await chmod(script, 0o755);
  opts.onProgress(100);
  deps.spawnDetached('/bin/sh', [script]);
  return { kind: 'swapping' };
}
