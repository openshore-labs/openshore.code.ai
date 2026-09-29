// Release integrity for every desktop update (the D1 release package, CTO
// rulings 1 and 2, 2026-09-29). One verifyAsset in app/electron checks a
// detached Ed25519 signature over "openshore-release-v1\n<name>\n<sha256>"
// against a key pinned in the app; the release builds sign with
// app/scripts/release-sign.mjs. Every signature here is made by that script,
// so the two halves are proven to agree on the message byte for byte.
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DOWNLOAD_THEN_RUN,
  RELEASE_SIGNATURE_CONTEXT,
  fetchSignatureText,
  installIfVerified,
  isReleasePublicKey,
  nameCarriesVersion,
  releaseMessage,
  verifyAsset,
} from '../electron/releaseVerify.js';
import { DESKTOP_RELEASE_PUBLIC_KEY, MAC_RELEASE_PUBLIC_KEY } from '../electron/releaseKeys.js';
import { downloadOllamaInstaller } from '../electron/ollama.js';
import * as signer from '../scripts/release-sign.mjs';
import * as keygen from '../scripts/release-keygen.mjs';

const APP = process.cwd();
const tempDir = () => mkdtempSync(join(tmpdir(), 'osc-release-'));
const keys = keygen.makeReleaseKeyPair();

/** A file on disk and its `.sig` text, signed by the release script. */
async function signedFile(name: string, body: string, privateKey = keys.privateKey) {
  const file = join(tempDir(), name);
  writeFileSync(file, body);
  const { signature } = await signer.signFile(file, privateKey);
  return { file, signature: `${signature}\n` };
}

describe('verifyAsset', () => {
  const ZIP = 'OpenShore-0.1.5-arm64-mac.zip';

  it('accepts a file whose signature the release script made', async () => {
    const { file, signature } = await signedFile(ZIP, 'the new app');
    const verdict = await verifyAsset({
      file,
      name: ZIP,
      version: '0.1.5',
      signature,
      publicKey: keys.publicKey,
    });
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.ok && verdict.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a file changed after it was signed', async () => {
    const { file, signature } = await signedFile(ZIP, 'the new app');
    writeFileSync(file, 'the new app, with something added');
    const verdict = await verifyAsset({
      file,
      name: ZIP,
      version: '0.1.5',
      signature,
      publicKey: keys.publicKey,
    });
    expect(verdict).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a signed file served under another name', async () => {
    // The x64 build's signature does not cover the arm64 name, and back.
    const { file, signature } = await signedFile('OpenShore-0.1.5-mac.zip', 'x64 app');
    const verdict = await verifyAsset({
      file,
      name: ZIP,
      version: '0.1.5',
      signature,
      publicKey: keys.publicKey,
    });
    expect(verdict).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('refuses an older signed build offered as the new version', async () => {
    const old = await signedFile('OpenShore-0.1.4-arm64-mac.zip', 'the old app');
    const asOld = await verifyAsset({
      file: old.file,
      name: 'OpenShore-0.1.4-arm64-mac.zip',
      version: '0.1.5',
      signature: old.signature,
      publicKey: keys.publicKey,
    });
    expect(asOld).toMatchObject({ ok: false, reason: 'wrong-version' });
    // Renamed to the new version's name, its signature no longer checks.
    const renamed = await verifyAsset({
      file: old.file,
      name: ZIP,
      version: '0.1.5',
      signature: old.signature,
      publicKey: keys.publicKey,
    });
    expect(renamed).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a missing .sig', async () => {
    const { file } = await signedFile(ZIP, 'the new app');
    for (const signature of [undefined, '', '  \n']) {
      const verdict = await verifyAsset({
        file,
        name: ZIP,
        version: '0.1.5',
        signature,
        publicKey: keys.publicKey,
      });
      expect(verdict).toMatchObject({ ok: false, reason: 'no-signature' });
    }
  });

  it('refuses everything while no key is pinned', async () => {
    const { file, signature } = await signedFile(ZIP, 'the new app');
    for (const publicKey of ['', '   ']) {
      const verdict = await verifyAsset({
        file,
        name: ZIP,
        version: '0.1.5',
        signature,
        publicKey,
      });
      expect(verdict).toMatchObject({ ok: false, reason: 'no-key' });
    }
  });

  it('refuses a signature from another key, a broken key, and a broken signature', async () => {
    const { file, signature } = await signedFile(ZIP, 'the new app');
    const other = keygen.makeReleaseKeyPair();
    const base = { file, name: ZIP, version: '0.1.5' };
    expect(await verifyAsset({ ...base, signature, publicKey: other.publicKey })).toMatchObject({
      ok: false,
      reason: 'bad-signature',
    });
    expect(await verifyAsset({ ...base, signature, publicKey: 'not a key' })).toMatchObject({
      ok: false,
      reason: 'bad-key',
    });
    expect(
      await verifyAsset({ ...base, signature: 'AAAA', publicKey: keys.publicKey }),
    ).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a file it cannot read', async () => {
    const { signature } = await signedFile(ZIP, 'the new app');
    const verdict = await verifyAsset({
      file: join(tempDir(), 'gone.zip'),
      name: ZIP,
      version: '0.1.5',
      signature,
      publicKey: keys.publicKey,
    });
    expect(verdict).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('matches a version only as a whole number', () => {
    expect(nameCarriesVersion('OpenShore-0.1.5-arm64-mac.zip', '0.1.5')).toBe(true);
    expect(nameCarriesVersion('OpenShore-Setup-0.1.5.exe', '0.1.5')).toBe(true);
    expect(nameCarriesVersion('OpenShore-0.1.5.AppImage', '0.1.5')).toBe(true);
    expect(nameCarriesVersion('oscode-app_0.1.5_amd64.deb', '0.1.5')).toBe(true);
    expect(nameCarriesVersion('OpenShore-0.1.50-mac.zip', '0.1.5')).toBe(false);
    expect(nameCarriesVersion('OpenShore-10.1.5.exe', '0.1.5')).toBe(false);
    expect(nameCarriesVersion('OpenShore-0.1.5.1.exe', '0.1.5')).toBe(false);
    expect(nameCarriesVersion('OpenShore-0.1.5.exe', '')).toBe(false);
    expect(nameCarriesVersion('OpenShore-0x1y5.exe', '0.1.5')).toBe(false);
    for (const [name, v] of [
      ['OpenShore-0.1.5-mac.zip', '0.1.5'],
      ['OpenShore-0.1.50-mac.zip', '0.1.5'],
      ['OpenShore-10.1.5.exe', '0.1.5'],
    ] as const) {
      expect(signer.nameCarriesVersion(name, v)).toBe(nameCarriesVersion(name, v));
    }
  });

  it('signs and checks exactly the ruled message', () => {
    const sha = 'ab'.repeat(32);
    const want = `openshore-release-v1\nOpenShore-0.1.5-mac.zip\n${sha}`;
    expect(releaseMessage('OpenShore-0.1.5-mac.zip', sha).toString('utf8')).toBe(want);
    expect(signer.releaseMessage('OpenShore-0.1.5-mac.zip', sha).toString('utf8')).toBe(want);
    expect(signer.RELEASE_SIGNATURE_CONTEXT).toBe(RELEASE_SIGNATURE_CONTEXT);
  });
});

describe('the pinned keys', () => {
  it('are each empty (the founder has not run the keygen) or a real key', () => {
    for (const key of [MAC_RELEASE_PUBLIC_KEY, DESKTOP_RELEASE_PUBLIC_KEY]) {
      expect(key === '' || isReleasePublicKey(key), key).toBe(true);
    }
    expect(isReleasePublicKey(keys.publicKey)).toBe(true);
    expect(isReleasePublicKey('')).toBe(false);
  });
});

describe('the keygen and signing scripts', () => {
  it('prints both key pairs, which secret and which constant each goes to', () => {
    const out = spawnSync(process.execPath, ['scripts/release-keygen.mjs'], {
      cwd: APP,
      encoding: 'utf8',
    });
    expect(out.status).toBe(0);
    for (const word of [
      'OPENSHORE_MAC_SIGNING_KEY',
      'OPENSHORE_DESKTOP_SIGNING_KEY',
      'MAC_RELEASE_PUBLIC_KEY',
      'DESKTOP_RELEASE_PUBLIC_KEY',
      'app/electron/releaseKeys.ts',
      'openshore-mac-signing',
      'Environments, release',
    ]) {
      expect(out.stdout).toContain(word);
    }
    // Two different pairs, and a printed private key signs for its public key.
    const pubs = out.stdout.match(/^ {3}([A-Za-z0-9+/]{43}=)$/gm)!.map((l) => l.trim());
    expect(pubs).toHaveLength(2);
    expect(new Set(pubs).size).toBe(2);
    const one = spawnSync(process.execPath, ['scripts/release-keygen.mjs', 'desktop'], {
      cwd: APP,
      encoding: 'utf8',
    });
    expect(one.stdout).toContain('OPENSHORE_DESKTOP_SIGNING_KEY');
    expect(one.stdout).not.toContain('OPENSHORE_MAC_SIGNING_KEY');
    const priv = one.stdout.match(/^ {3}([A-Za-z0-9+/]{60,}={0,2})$/m)![1]!;
    const pub = one.stdout.match(/^ {3}([A-Za-z0-9+/]{43}=)$/m)![1]!;
    expect(signer.publicKeyOf(priv)).toBe(pub);
  });

  it('writes a .sig beside each file from the key in the named variable', async () => {
    const dir = tempDir();
    const files = ['OpenShore-Setup-0.1.7.exe', 'OpenShore-0.1.7.AppImage'].map((n) => {
      writeFileSync(join(dir, n), `body of ${n}`);
      return join(dir, n);
    });
    const out = spawnSync(
      process.execPath,
      ['scripts/release-sign.mjs', '--key-env', 'TEST_RELEASE_KEY', '--version', '0.1.7', ...files],
      { cwd: APP, encoding: 'utf8', env: { ...process.env, TEST_RELEASE_KEY: keys.privateKey } },
    );
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(keys.publicKey);
    expect(out.stdout).not.toContain(keys.privateKey);
    for (const file of files) {
      const verdict = await verifyAsset({
        file,
        name: file.split('/').pop()!,
        version: '0.1.7',
        signature: readFileSync(`${file}.sig`, 'utf8'),
        publicKey: keys.publicKey,
      });
      expect(verdict.ok, file).toBe(true);
    }
  });

  it('refuses to sign with no key, for the wrong version, or under a name GitHub renames', () => {
    const dir = tempDir();
    const good = join(dir, 'OpenShore-Setup-0.1.7.exe');
    const spaced = join(dir, 'OpenShore Setup 0.1.7.exe');
    writeFileSync(good, 'x');
    writeFileSync(spaced, 'x');
    const run = (args: string[], key = keys.privateKey) =>
      spawnSync(process.execPath, ['scripts/release-sign.mjs', ...args], {
        cwd: APP,
        encoding: 'utf8',
        env: { ...process.env, TEST_RELEASE_KEY: key },
      });
    expect(run(['--key-env', 'TEST_RELEASE_KEY', good], '').status).not.toBe(0);
    expect(run(['--key-env', 'TEST_RELEASE_KEY', '--version', '0.1.8', good]).status).not.toBe(0);
    expect(run(['--key-env', 'TEST_RELEASE_KEY', spaced]).status).not.toBe(0);
    expect(run([good]).status).not.toBe(0);
    expect(existsSync(`${good}.sig`)).toBe(false);
    expect(existsSync(`${spaced}.sig`)).toBe(false);
  });

  it('names the Windows installer the way the update feed does, so its signature can check', () => {
    // GitHub turns a space into a dot on upload, while electron-builder's
    // feed names the file with dashes: the default "OpenShore Setup 1.2.3.exe"
    // never matched either (every release before this one).
    const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
    const pattern: string = pkg.build.nsis.artifactName;
    const name = pattern
      .replace('${productName}', pkg.build.productName)
      .replace('${version}', '0.1.7')
      .replace('${ext}', 'exe');
    expect(name).toBe('OpenShore-Setup-0.1.7.exe');
    expect(signer.isGithubSafeName(name)).toBe(true);
  });
});

describe('Windows and Linux: the check before quitAndInstall', () => {
  const EXE = 'OpenShore-Setup-0.1.7.exe';

  async function attempt(opts: {
    publicKey: string;
    body?: string;
    tamper?: boolean;
    signature?: 'good' | 'missing';
  }) {
    const { file, signature } = await signedFile(EXE, opts.body ?? 'installer');
    if (opts.tamper) writeFileSync(file, 'installer with a payload');
    const install = vi.fn();
    const refuse = vi.fn();
    const fetchSignature = vi.fn(async () =>
      opts.signature === 'missing' ? undefined : signature,
    );
    const signatureUrl = vi.fn(
      (name: string, version: string) =>
        `https://github.com/o/r/releases/download/v${version}/${name}.sig`,
    );
    const log = vi.fn();
    const result = await installIfVerified({
      downloaded: { file, version: '0.1.7' },
      publicKey: opts.publicKey,
      signatureUrl,
      fetchSignature,
      install,
      refuse,
      log,
    });
    return { result, install, refuse, fetchSignature, signatureUrl, log };
  }

  it('refuses to install a changed download when a desktop key is pinned', async () => {
    const r = await attempt({ publicKey: keys.publicKey, tamper: true });
    expect(r.result).toBe('refused');
    expect(r.install).not.toHaveBeenCalled();
    expect(r.refuse).toHaveBeenCalledWith(expect.stringContaining('does not match its signature'));
  });

  it('refuses a download with no .sig when a desktop key is pinned', async () => {
    const r = await attempt({ publicKey: keys.publicKey, signature: 'missing' });
    expect(r.result).toBe('refused');
    expect(r.install).not.toHaveBeenCalled();
  });

  it('installs a download that matches, asking for the .sig of that file and version', async () => {
    const r = await attempt({ publicKey: keys.publicKey });
    expect(r.result).toBe('installed');
    expect(r.install).toHaveBeenCalledTimes(1);
    expect(r.refuse).not.toHaveBeenCalled();
    expect(r.signatureUrl).toHaveBeenCalledWith(EXE, '0.1.7');
  });

  it('installs as before, and says so, while no desktop key is pinned', async () => {
    const r = await attempt({ publicKey: '', tamper: true });
    expect(r.result).toBe('installed-unchecked');
    expect(r.install).toHaveBeenCalledTimes(1);
    expect(r.fetchSignature).not.toHaveBeenCalled();
    expect(r.log).toHaveBeenCalledWith(expect.stringContaining('without a signature check'));
  });

  it('refuses when it does not know what was downloaded', async () => {
    const install = vi.fn();
    const refuse = vi.fn();
    const result = await installIfVerified({
      downloaded: undefined,
      publicKey: keys.publicKey,
      signatureUrl: () => 'https://github.com/x.sig',
      install,
      refuse,
      log: () => {},
    });
    expect(result).toBe('refused');
    expect(install).not.toHaveBeenCalled();
    expect(refuse).toHaveBeenCalled();
  });

  it('reads a .sig only when it is there and small', async () => {
    const at = (res: Response) => async () => res;
    expect(await fetchSignatureText('u', at(new Response('sig\n')))).toBe('sig\n');
    expect(await fetchSignatureText('u', at(new Response('no', { status: 404 })))).toBeUndefined();
    expect(await fetchSignatureText('u', at(new Response('x'.repeat(5000))))).toBeUndefined();
    const offline = async (): Promise<Response> => {
      throw new Error('offline');
    };
    expect(await fetchSignatureText('u', offline)).toBeUndefined();
  });

  it('main.ts installs only through the check, and asks the release for the .sig', () => {
    const main = code(readFileSync(join(APP, 'electron', 'main.ts'), 'utf8'));
    expect([...main.matchAll(/quitAndInstall\(/g)]).toHaveLength(1);
    const call = main.indexOf('installIfVerified({');
    expect(call).toBeGreaterThan(-1);
    const block = main.slice(call, main.indexOf('});', call));
    expect(block).toMatch(/install: \(\) => autoUpdater\.quitAndInstall\(\)/);
    expect(block).toMatch(/publicKey: DESKTOP_RELEASE_PUBLIC_KEY/);
    expect(block).toMatch(
      /releases\/download\/v\$\{version\}\/\$\{encodeURIComponent\(name\)\}\.sig/,
    );
    expect(main).toMatch(/downloaded = \{ file: info\.downloadedFile, version: info\.version \}/);
    expect(main).toMatch(
      /step\.effect === 'quit-and-install'\) \{\s*void installDownloadedUpdate\(\)/,
    );
  });
});

/** Source with comments removed, so a word in a comment never counts. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('every download-then-run path is checked or listed with a reason', () => {
  const dir = join(APP, 'electron');
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: code(readFileSync(join(dir, f), 'utf8')) }));

  // A file that saves what it fetched (a stream to disk), or starts
  // electron-updater's download.
  const savesDownload = (text: string) =>
    (/\bfetch\w*\s*\(/.test(text) && /createWriteStream\(|Readable\.fromWeb\(/.test(text)) ||
    /\.downloadUpdate\(\)/.test(text);

  it('lists exactly the files that save a download', () => {
    const found = sources.filter((s) => savesDownload(s.text)).map((s) => s.file);
    expect(found.sort()).toEqual(DOWNLOAD_THEN_RUN.map((d) => d.file).sort());
    for (const d of DOWNLOAD_THEN_RUN) {
      expect(d.runs.length, d.file).toBeGreaterThan(10);
      expect(d.why.length, d.file).toBeGreaterThan(40);
    }
  });

  it('checks the Mac update before hdiutil, ditto, xattr, or the swap', () => {
    const mac = sources.find((s) => s.file === 'macUpdate.ts')!.text;
    const body = mac.slice(mac.indexOf('export async function updateMacInPlace'));
    const check = body.indexOf('verifyAsset(');
    expect(check).toBeGreaterThan(-1);
    for (const sink of ['deps.run(', 'deps.spawnDetached(', "'/usr/bin/hdiutil'", "'-x'"]) {
      const at = body.indexOf(sink);
      expect(at, sink).toBeGreaterThan(check);
    }
    expect(DOWNLOAD_THEN_RUN.find((d) => d.file === 'macUpdate.ts')?.check).toBe('verifyAsset');
    expect(DOWNLOAD_THEN_RUN.find((d) => d.file === 'main.ts')?.check).toBe('verifyAsset');
  });

  it("names Ollama's installer as unchecked, and keeps its download mark on both systems", async () => {
    const ollama = DOWNLOAD_THEN_RUN.find((d) => d.file === 'ollama.ts')!;
    expect(ollama.check).toBe('none');
    expect(ollama.why).toMatch(/no signature/i);
    expect(ollama.why).toMatch(/TLS/);
    expect(ollama.why).toMatch(/Gatekeeper/);
    expect(ollama.why).toMatch(/SmartScreen/);
    expect(ollama.runs).toMatch(/osc:ollamaInstall/);
    const main = readFileSync(join(APP, 'electron', 'main.ts'), 'utf8');
    expect(main).toMatch(/shell\.openPath\(plan\.installerPath\)/);
    // Windows: the Mark of the Web a browser leaves, so SmartScreen looks.
    const root = tempDir();
    const path = await downloadOllamaInstaller({
      platform: 'win32',
      tempRoot: root,
      fetch: async () => new Response('MZ installer'),
      run: async () => {},
    });
    const mark = readFileSync(`${path}:Zone.Identifier`, 'utf8');
    expect(mark).toContain('[ZoneTransfer]');
    expect(mark).toContain('ZoneId=3');
    expect(mark).toContain('HostUrl=https://ollama.com/download/OllamaSetup.exe');
  });
});

describe('the release builds sign what they publish', () => {
  const wf = readFileSync(join(APP, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const jobsAt = wf.indexOf('\njobs:\n');
  const publishAt = wf.indexOf('\n  publish:\n');
  const top = wf.slice(0, jobsAt);
  const buildJobs = wf.slice(jobsAt, publishAt);
  const publish = wf.slice(publishAt);

  it('reads by default, and only the publish job can write', () => {
    // YAML comment lines dropped: only keys count.
    const keys = (text: string) => text.replace(/^\s*#.*$/gm, '');
    expect(keys(top)).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(keys(top)).not.toMatch(/write/);
    expect(keys(buildJobs)).not.toMatch(/contents: write|permissions:/);
    expect(keys(publish)).toMatch(/\n {4}permissions:\n {6}contents: write\n/);
  });

  it('publishes from the release environment, with no install in that job', () => {
    expect(publish).toMatch(/\n {4}environment: release\n/);
    expect(publish).not.toMatch(/pnpm install|npm install|npm ci/);
    expect(publish).toMatch(/persist-credentials: false/);
    // Still every push to main (the founder's call) and every v* tag.
    expect(publish).toContain("if: needs.version.outputs.tag != ''");
  });

  it('signs every Windows and Linux file before the release is created, or says why not', () => {
    const sign = publish.indexOf('- name: Sign the Windows and Linux files');
    const create = publish.indexOf('gh release create');
    expect(sign).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(sign);
    const step = publish.slice(sign, create);
    expect(step).toContain(
      'OPENSHORE_DESKTOP_SIGNING_KEY: ${{ secrets.OPENSHORE_DESKTOP_SIGNING_KEY }}',
    );
    expect(step).toMatch(/release\/\*\.exe release\/\*\.AppImage release\/\*\.deb/);
    expect(step).toContain('--key-env OPENSHORE_DESKTOP_SIGNING_KEY');
    expect(step).toContain('--version "$VERSION"');
    // No key: publish unsigned, as today, rather than fail the release.
    expect(step).toMatch(/if \[ -z "\$\{OPENSHORE_DESKTOP_SIGNING_KEY:-\}" \]; then[\s\S]*?exit 0/);
    // The .sig files go up with the rest.
    expect(publish.slice(create)).toMatch(/release\/\*/);
  });

  it('sets the Windows publisher name only with a certificate, and says every later build must be signed', () => {
    const pack = buildJobs.slice(buildJobs.indexOf('- name: Package the Windows installer'));
    expect(pack).toMatch(/if \[ -n "\$WIN_CSC_LINK" \]; then/);
    expect(pack).toMatch(/env -u WIN_CSC_LINK -u WIN_CSC_KEY_PASSWORD/);
    expect(buildJobs).toMatch(/publisherName/);
    expect(buildJobs).toMatch(/EVERY later Windows build must\s+#?\s*be signed/);
    const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
    expect(pkg.build.win.publisherName).toBeUndefined();
    expect(pkg.build.win.signtoolOptions).toBeUndefined();
  });

  it('signs the Mac files on Codemagic with a key from its own group, and uploads the .sig files', () => {
    const cm = readFileSync(join(APP, '..', 'codemagic.yaml'), 'utf8');
    const mac = cm.slice(cm.indexOf('\n  mac-desktop:\n'));
    expect(mac).toMatch(/groups:[\s\S]*?- openshore-mac-signing/);
    const pack = mac.indexOf('- name: Package the macOS app');
    const sign = mac.indexOf('- name: Sign the macOS files');
    const publishStep = mac.indexOf('- name: Publish to the GitHub Release');
    expect(pack).toBeGreaterThan(-1);
    expect(sign).toBeGreaterThan(pack);
    expect(publishStep).toBeGreaterThan(sign);
    const step = mac.slice(sign, publishStep);
    expect(step).toContain('--key-env OPENSHORE_MAC_SIGNING_KEY');
    expect(step).toMatch(/release\/\*\.dmg release\/\*\.zip/);
    expect(mac.slice(publishStep)).toMatch(/gh release upload[\s\S]*?release\/\*\.sig/);
    expect(mac).toContain('- app/release/*.sig');
    const local = readFileSync(join(APP, 'scripts', 'mac-release.sh'), 'utf8');
    expect(local).toContain('--key-env OPENSHORE_MAC_SIGNING_KEY');
    expect(local).toMatch(/FILES=\([^)]*release\/\*\.sig/);
  });
});
