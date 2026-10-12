// The Mac in-place update under tech review ruling 1 (the D1 release package,
// 2026-09-29): verify before hdiutil or ditto, open the release page on a
// missing key or signature, open nothing on a signature that is there and
// fails (reconciliation 2, the cleanup package), clear quarantine only on a
// verified bundle, keep the old app until the new version writes its launch
// marker, and never offer again a version the watchdog rolled back. The
// tools, the swap, and the shell are stand-ins; the files are real, under a
// temporary folder.
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LAUNCH_WAIT_SECONDS,
  launchMarkerPath,
  rolledBackPath,
  rolledBackVersion,
  swapScript,
  updateMacInPlace,
  writeLaunchMarker,
} from '../electron/macUpdate.js';
import { newestMacUpdate } from '../electron/updateVersion.js';
import * as signer from '../scripts/release-sign.mjs';
import * as keygen from '../scripts/release-keygen.mjs';

const keys = keygen.makeReleaseKeyPair();
const RELEASES = 'https://github.com/openshore-labs/openshore.code.ai/releases';
const PAGE = `${RELEASES}/tag/v0.1.5`;

async function signatureFor(name: string, body: string, privateKey = keys.privateKey) {
  const file = join(mkdtempSync(join(tmpdir(), 'osc-sign-')), name);
  writeFileSync(file, body);
  return (await signer.signFile(file, privateKey)).signature as string;
}

interface Setup {
  name?: string;
  body?: string;
  /** What the release serves for the file (defaults to `body`). */
  served?: string;
  /** The `.sig` text; 'none' leaves the asset out, '404' lists it but it is gone. */
  signature?: string | 'none' | '404';
  publicKey?: string;
  bundle?: string | null;
}

async function setup(s: Setup = {}) {
  const root = mkdtempSync(join(tmpdir(), 'osc-macup-'));
  const bundle = join(root, 'Applications', 'OpenShore.app');
  mkdirSync(bundle, { recursive: true });
  const tmpRoot = join(root, 'tmp');
  mkdirSync(tmpRoot);
  const userData = join(root, 'userData');
  const name = s.name ?? 'OpenShore-0.1.5-arm64-mac.zip';
  const body = s.body ?? 'the signed new app';
  const url = `${RELEASES}/download/v0.1.5/${name}`;
  const sigText =
    s.signature === undefined ? `${await signatureFor(name, body)}\n` : (s.signature as string);
  const fetched: string[] = [];
  const fetch = vi.fn(async (u: string) => {
    fetched.push(u);
    if (u === url) return new Response(s.served ?? body);
    if (u === `${url}.sig` && s.signature !== '404') return new Response(sigText);
    return new Response('not found', { status: 404 });
  });
  const ran: string[][] = [];
  const run = vi.fn(async (cmd: string, args: string[]) => {
    ran.push([cmd, ...args]);
    // Stand-ins for what the tools leave behind.
    if (cmd === '/usr/bin/ditto' && args[0] === '-x') {
      mkdirSync(join(args[3]!, 'OpenShore.app'), { recursive: true });
    } else if (cmd === '/usr/bin/hdiutil' && args[0] === 'attach') {
      mkdirSync(join(args[5]!, 'OpenShore.app'), { recursive: true });
    } else if (cmd === '/usr/bin/ditto') {
      mkdirSync(args[1]!, { recursive: true });
    }
  });
  const spawned: string[][] = [];
  const spawnDetached = vi.fn((cmd: string, args: string[]) => void spawned.push([cmd, ...args]));
  const openExternal = vi.fn(async () => {});
  const progress: number[] = [];
  const outcome = await updateMacInPlace({
    version: '0.1.5',
    asset: { name, browser_download_url: url, size: body.length },
    signature:
      s.signature === 'none'
        ? undefined
        : { name: `${name}.sig`, browser_download_url: `${url}.sig` },
    bundle: s.bundle === null ? undefined : (s.bundle ?? bundle),
    releasePage: PAGE,
    publicKey: s.publicKey ?? keys.publicKey,
    userData,
    onProgress: (p) => progress.push(p),
    deps: { fetch, run, spawnDetached, shell: { openExternal }, tmpRoot, pid: 4242 },
  });
  return { outcome, ran, spawned, openExternal, fetched, progress, tmpRoot, url, userData, bundle };
}

describe('the Mac in-place update refuses anything it cannot verify', () => {
  it('swaps in a verified zip: ditto -x after the check, quarantine cleared, the swap started', async () => {
    const r = await setup();
    expect(r.outcome).toEqual({ kind: 'swapping' });
    expect(r.openExternal).not.toHaveBeenCalled();
    expect(r.ran.map((c) => c.slice(0, 2))).toEqual([
      ['/usr/bin/ditto', '-x'],
      ['/usr/bin/xattr', '-dr'],
    ]);
    expect(r.ran[1]).toContain('com.apple.quarantine');
    expect(r.spawned).toHaveLength(1);
    expect(r.spawned[0]![0]).toBe('/bin/sh');
    const script = readFileSync(r.spawned[0]![1]!, 'utf8');
    expect(script).toContain(`MARKER='${launchMarkerPath(r.userData)}'`);
    expect(script).toContain("VERSION='0.1.5'");
    expect(script).toContain(`WAIT=${LAUNCH_WAIT_SECONDS}`);
    expect(LAUNCH_WAIT_SECONDS).toBe(120);
    expect(r.progress.at(0)).toBe(0);
    expect(r.progress.at(-1)).toBe(100);
  });

  it('opens the release page, and downloads nothing, while no Mac key is pinned', async () => {
    const r = await setup({ publicKey: '' });
    expect(r.outcome).toMatchObject({ kind: 'release-page', reason: 'no-key', downloaded: false });
    expect(r.openExternal).toHaveBeenCalledWith(PAGE);
    expect(r.fetched).toEqual([]);
    expect(r.ran).toEqual([]);
    expect(r.spawned).toEqual([]);
  });

  it('opens the release page when the release has no .sig for the file', async () => {
    const r = await setup({ signature: 'none' });
    expect(r.outcome).toMatchObject({ kind: 'release-page', reason: 'no-signature' });
    expect(r.openExternal).toHaveBeenCalledWith(PAGE);
    expect(r.fetched).toEqual([]);
    expect(r.ran).toEqual([]);
  });

  it('opens the release page when the .sig cannot be fetched, before the big download', async () => {
    const r = await setup({ signature: '404' });
    expect(r.outcome).toMatchObject({ kind: 'release-page', reason: 'no-signature' });
    expect(r.openExternal).toHaveBeenCalledWith(PAGE);
    expect(r.fetched).not.toContain(r.url);
    expect(r.ran).toEqual([]);
  });

  it('refuses a changed zip, opens nothing, and never runs ditto or xattr on it', async () => {
    const r = await setup({ served: 'the signed new app, and a payload' });
    expect(r.outcome).toMatchObject({ kind: 'refused', reason: 'bad-signature' });
    // The release page's download button serves the same file.
    expect(r.openExternal).not.toHaveBeenCalled();
    expect(r.fetched).toContain(r.url);
    expect(r.ran).toEqual([]);
    expect(r.spawned).toEqual([]);
    // The refused download does not stay on disk.
    expect(readdirSync(r.tmpRoot)).toEqual([]);
  });

  it('refuses a changed dmg, opens nothing, and never mounts it', async () => {
    const r = await setup({
      name: 'OpenShore-0.1.5-arm64.dmg',
      served: 'a different image',
    });
    expect(r.outcome).toMatchObject({ kind: 'refused', reason: 'bad-signature' });
    expect(r.openExternal).not.toHaveBeenCalled();
    expect(r.ran.filter((c) => c[0] === '/usr/bin/hdiutil')).toEqual([]);
    expect(r.ran).toEqual([]);
  });

  it('mounts a verified dmg, copies the app out, and detaches, all after the check', async () => {
    const r = await setup({ name: 'OpenShore-0.1.5-arm64.dmg' });
    expect(r.outcome).toEqual({ kind: 'swapping' });
    expect(r.ran.map((c) => c.slice(0, 2))).toEqual([
      ['/usr/bin/hdiutil', 'attach'],
      ['/usr/bin/ditto', expect.stringContaining('OpenShore.app')],
      ['/usr/bin/hdiutil', 'detach'],
      ['/usr/bin/xattr', '-dr'],
    ]);
  });

  it('refuses an older signed build put up as the new version, and opens nothing', async () => {
    const oldName = 'OpenShore-0.1.4-arm64-mac.zip';
    const r = await setup({
      name: oldName,
      body: 'the old app',
      signature: `${await signatureFor(oldName, 'the old app')}\n`,
    });
    expect(r.outcome).toMatchObject({ kind: 'refused', reason: 'wrong-version' });
    expect(r.openExternal).not.toHaveBeenCalled();
    expect(r.ran).toEqual([]);
  });

  it('refuses a signature from another key, and opens nothing', async () => {
    const other = keygen.makeReleaseKeyPair();
    const r = await setup({
      signature: `${await signatureFor('OpenShore-0.1.5-arm64-mac.zip', 'the signed new app', other.privateKey)}\n`,
    });
    expect(r.outcome).toMatchObject({ kind: 'refused', reason: 'bad-signature' });
    expect(r.openExternal).not.toHaveBeenCalled();
    expect(r.ran).toEqual([]);
  });

  it('still opens the release page for an empty .sig (nothing to check, not a failed check)', async () => {
    const r = await setup({ signature: '\n' });
    expect(r.outcome).toMatchObject({ kind: 'release-page', reason: 'no-signature' });
    expect(r.openExternal).toHaveBeenCalledWith(PAGE);
    expect(r.ran).toEqual([]);
  });

  it('opens the release page where the app cannot be replaced', async () => {
    for (const bundle of [null, '/Volumes/OpenShore/OpenShore.app']) {
      const r = await setup({ bundle });
      expect(r.outcome).toMatchObject({ kind: 'release-page', reason: 'cannot-replace' });
      expect(r.openExternal).toHaveBeenCalledWith(PAGE);
      expect(r.fetched).toEqual([]);
    }
  });

  it("finds the file's .sig in the release, and only its own", () => {
    const asset = (name: string) => ({ name, browser_download_url: `${RELEASES}/${name}` });
    const next = newestMacUpdate(
      [
        {
          tag_name: 'v0.1.5',
          assets: [
            asset('OpenShore-0.1.5-arm64-mac.zip'),
            asset('OpenShore-0.1.5-arm64-mac.zip.sig'),
            asset('OpenShore-0.1.5-mac.zip.sig'),
          ],
        },
      ],
      '0.1.4',
      'arm64',
    );
    expect(next?.asset.name).toBe('OpenShore-0.1.5-arm64-mac.zip');
    expect(next?.signature?.name).toBe('OpenShore-0.1.5-arm64-mac.zip.sig');
    const unsigned = newestMacUpdate(
      [{ tag_name: 'v0.1.5', assets: [asset('OpenShore-0.1.5-mac.zip')] }],
      '0.1.4',
      'x64',
    );
    expect(unsigned?.asset.name).toBe('OpenShore-0.1.5-mac.zip');
    expect(unsigned?.signature).toBeUndefined();
  });

  it('skips a version the watchdog rolled back, and still offers a newer one', () => {
    const asset = (name: string) => ({ name, browser_download_url: `${RELEASES}/${name}` });
    const releases = [
      { tag_name: 'v0.1.5', assets: [asset('OpenShore-0.1.5-arm64-mac.zip')] },
      { tag_name: 'v0.1.6', assets: [asset('OpenShore-0.1.6-arm64-mac.zip')] },
    ];
    expect(newestMacUpdate(releases, '0.1.4', 'arm64')?.version).toBe('0.1.6');
    expect(newestMacUpdate(releases, '0.1.4', 'arm64', '0.1.6')?.version).toBe('0.1.5');
    expect(newestMacUpdate(releases.slice(1), '0.1.4', 'arm64', '0.1.6')).toBeUndefined();
    expect(newestMacUpdate(releases, '0.1.4', 'arm64', '0.1.7')?.version).toBe('0.1.6');
  });

  it('main.ts refuses a failed signature on the bar, and never opens a page for it', () => {
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const at = main.indexOf("if (outcome.kind === 'refused') {");
    expect(at).toBeGreaterThan(-1);
    const branch = main.slice(at, main.indexOf('return;', at));
    expect(branch).toMatch(
      /applyUpdate\(\{ type: 'error', detail: outcome\.detail, refused: true \}\)/,
    );
    expect(branch).not.toMatch(/openExternal/);
    // The Mac check reads the rolled-back version before it picks a release.
    const check = main.slice(main.indexOf('async function checkMacUpdate'));
    expect(check.slice(0, check.indexOf('\n}\n'))).toMatch(
      /newestMacUpdate\([\s\S]*rolledBackVersion\(app\.getPath\('userData'\)\)/,
    );
  });

  it('main.ts pins the Mac key, hands over the signature, and quits only on a swap', () => {
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const at = main.indexOf('await updateMacInPlace({');
    expect(at).toBeGreaterThan(-1);
    const call = main.slice(at, main.indexOf('});', at));
    expect(call).toMatch(/publicKey: MAC_RELEASE_PUBLIC_KEY/);
    expect(call).toMatch(/signature: macSignature/);
    expect(call).toMatch(/deps: \{ shell \}/);
    expect(main).toMatch(/if \(outcome\.kind === 'swapping'\) \{\s*app\.quit\(\);/);
    expect(main).not.toMatch(/installMacUpdate/);
  });
});

describe('the launch marker', () => {
  it('holds the version that started', () => {
    const userData = join(mkdtempSync(join(tmpdir(), 'osc-ud-')), 'OpenShore');
    expect(writeLaunchMarker(userData, '0.1.5')).toBe(true);
    expect(readFileSync(launchMarkerPath(userData), 'utf8')).toBe('0.1.5');
    expect(writeLaunchMarker(userData, '0.1.6')).toBe(true);
    expect(readFileSync(launchMarkerPath(userData), 'utf8')).toBe('0.1.6');
  });

  it('reads back a rolled-back version, and nothing from a missing or odd file', () => {
    const userData = mkdtempSync(join(tmpdir(), 'osc-ud-'));
    expect(rolledBackVersion(userData)).toBeUndefined();
    writeFileSync(rolledBackPath(userData), '0.1.5');
    expect(rolledBackVersion(userData)).toBe('0.1.5');
    writeFileSync(rolledBackPath(userData), '0.1.5; rm -rf /');
    expect(rolledBackVersion(userData)).toBeUndefined();
  });

  it('is written at every Mac start, once the app is ready', () => {
    const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
    const ready = main.indexOf('void app.whenReady().then(');
    const write = main.indexOf(
      "if (process.platform === 'darwin') writeLaunchMarker(app.getPath('userData'), app.getVersion());",
    );
    expect(ready).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(ready);
  });
});

// The swap script itself, run for real with /bin/sh against folders standing
// in for the two app bundles, and a stand-in `open` that logs what it opened.
describe.skipIf(process.platform === 'win32')(
  'the swap script keeps the old app until the new one starts',
  () => {
    function stage(opts: { launches: boolean; staleMarker?: string }) {
      // A folder name with a space, a quote and a dollar sign, so the script's
      // quoting is proven too.
      const root = mkdtempSync(join(tmpdir(), "osc swap 'q' $HOME-"));
      const bundle = join(root, 'Applications', 'OpenShore.app');
      mkdirSync(bundle, { recursive: true });
      writeFileSync(join(bundle, 'version'), 'old');
      const work = join(root, 'work');
      const staged = join(work, 'unpacked', 'OpenShore.app');
      mkdirSync(staged, { recursive: true });
      writeFileSync(join(staged, 'version'), 'new');
      const userData = join(root, 'userData');
      mkdirSync(userData);
      const marker = launchMarkerPath(userData);
      if (opts.staleMarker) writeFileSync(marker, opts.staleMarker);
      const log = join(root, 'opened.log');
      const open = join(root, 'open.sh');
      writeFileSync(
        open,
        [
          '#!/bin/sh',
          `printf '%s\\n' "$1" >> '${log.replace(/'/g, `'\\''`)}'`,
          opts.launches ? `printf '0.1.5' > '${marker.replace(/'/g, `'\\''`)}'` : ':',
          '',
        ].join('\n'),
      );
      chmodSync(open, 0o755);
      // A process that has already exited, so the script does not wait.
      const pid = spawnSync('true').pid!;
      const script = join(root, 'swap.sh');
      writeFileSync(
        script,
        swapScript({ pid, bundle, staged, work, marker, version: '0.1.5', waitSeconds: 1, open }),
      );
      const done = spawnSync('/bin/sh', [script], { timeout: 20_000, encoding: 'utf8' });
      const opened = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
      return { done, bundle, work, opened, marker, userData };
    }

    it('restores the old app and opens it when no launch marker appears', () => {
      const r = stage({ launches: false });
      expect(r.done.status).toBe(0);
      expect(readFileSync(join(r.bundle, 'version'), 'utf8')).toBe('old');
      expect(existsSync(`${r.bundle}.old`)).toBe(false);
      expect(r.opened).toEqual([r.bundle, r.bundle]);
      expect(existsSync(r.work)).toBe(false);
      // And remembers the version it gave up on, so it is not offered again.
      expect(rolledBackVersion(r.userData)).toBe('0.1.5');
    });

    it('keeps the new app and drops the old one once the new version writes its marker', () => {
      const r = stage({ launches: true });
      expect(r.done.status).toBe(0);
      expect(readFileSync(join(r.bundle, 'version'), 'utf8')).toBe('new');
      expect(existsSync(`${r.bundle}.old`)).toBe(false);
      expect(r.opened).toEqual([r.bundle]);
      expect(existsSync(r.work)).toBe(false);
      expect(rolledBackVersion(r.userData)).toBeUndefined();
    });

    it("does not take the old version's own marker for the new one", () => {
      const r = stage({ launches: false, staleMarker: '0.1.5' });
      expect(readFileSync(join(r.bundle, 'version'), 'utf8')).toBe('old');
      const s = stage({ launches: false, staleMarker: '0.1.4' });
      expect(readFileSync(join(s.bundle, 'version'), 'utf8')).toBe('old');
    });
  },
);
