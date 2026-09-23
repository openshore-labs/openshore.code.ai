// The macOS in-place update. The Mac build ships unsigned outside the App Store
// (codemagic.yaml), so electron-updater's Squirrel.Mac path, which checks the
// new build's code signature against the running one, cannot be used. Instead,
// on the person's click: download the release's zip (or dmg) for this Mac,
// unpack it (or mount the dmg and copy the app out) with ditto (which keeps the bundle's symlinks and permissions intact), clear
// the quarantine flag, then hand off to a tiny detached script that waits for
// this app to quit, swaps the old bundle for the new one, and opens it again.
//
// It only runs where it can finish: a bundle it can write over (not a mounted
// disk image, not a folder the person cannot write to). Anywhere else, or on
// any failure, the caller falls back to opening the release page, so the
// person always has a way forward.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, constants, mkdtemp, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReleaseAsset } from './updateVersion.js';

function run(cmd: string, args: string[]): Promise<void> {
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

/**
 * Download, unpack, and stage the new bundle, then start the swap script.
 * Resolves once the script is running; the caller then quits the app, and the
 * script relaunches the new version. `onProgress` gets 0..100.
 */
export async function installMacUpdate(
  asset: ReleaseAsset,
  bundle: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), 'openshore-update-'));
  const isDmg = /\.dmg$/i.test(asset.name);
  const zip = join(work, isDmg ? 'update.dmg' : 'update.zip');

  const res = await fetch(asset.browser_download_url, { redirect: 'follow' });
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
      onProgress(pct);
    }
  });
  await pipeline(body, createWriteStream(zip));

  const unpacked = join(work, 'unpacked');
  if (isDmg) {
    // A disk image (a release built on the founder's own Mac may carry only
    // this): mount it quietly, copy the app out with ditto, and detach.
    const mnt = join(work, 'mnt');
    await run('/usr/bin/hdiutil', [
      'attach',
      '-nobrowse',
      '-noautoopen',
      '-readonly',
      '-mountpoint',
      mnt,
      zip,
    ]);
    try {
      const inImage = (await readdir(mnt)).find((n) => n.endsWith('.app'));
      if (!inImage) throw new Error('The disk image did not contain the app.');
      await run('/usr/bin/ditto', [join(mnt, inImage), join(unpacked, inImage)]);
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mnt, '-force']).catch(() => {});
    }
  } else {
    await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
  }
  const app = (await readdir(unpacked)).find((n) => n.endsWith('.app'));
  if (!app) throw new Error('The download did not contain the app.');
  const staged = join(unpacked, app);
  // Downloads made by the app itself are not normally quarantined; clear it
  // anyway so the relaunch never stops on a Gatekeeper prompt for our own file.
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {});
  await rm(zip, { force: true });

  // The swap runs after this process has exited, so it is a detached script:
  // wait for the pid to go, move the old bundle aside, move the new one in
  // (restoring the old one if that fails), relaunch, then clean up.
  const script = join(work, 'swap.sh');
  await writeFile(
    script,
    [
      '#!/bin/sh',
      `PID=${process.pid}`,
      `OLD=${JSON.stringify(bundle)}`,
      `NEW=${JSON.stringify(staged)}`,
      `WORK=${JSON.stringify(work)}`,
      'while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done',
      'mv "$OLD" "$OLD.old" || exit 1',
      'if mv "$NEW" "$OLD"; then rm -rf "$OLD.old"; else mv "$OLD.old" "$OLD"; fi',
      'open "$OLD"',
      'rm -rf "$WORK"',
      '',
    ].join('\n'),
  );
  await chmod(script, 0o755);
  onProgress(100);
  const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' });
  child.unref();
}
