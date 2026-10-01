import { describe, expect, it } from 'vitest';
import { versionIsNewer } from '../electron/updateVersion.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleOf, newestMacUpdate, pickMacAsset } from '../electron/updateVersion.js';
import { updateBarCopy } from '../src/components/UpdateBanner.js';

describe('versionIsNewer', () => {
  it('compares numerically, not lexically', () => {
    expect(versionIsNewer('0.1.10', '0.1.9')).toBe(true);
    expect(versionIsNewer('0.1.9', '0.1.10')).toBe(false);
  });

  it('is false for an equal version', () => {
    expect(versionIsNewer('0.1.1', '0.1.1')).toBe(false);
  });

  it('is false for an older version', () => {
    expect(versionIsNewer('0.1.0', '0.1.1')).toBe(false);
  });

  it('treats a missing trailing segment as 0', () => {
    expect(versionIsNewer('1.2', '1.2.0')).toBe(false);
    expect(versionIsNewer('1.2.1', '1.2')).toBe(true);
  });

  it('weighs the leftmost differing segment first', () => {
    expect(versionIsNewer('1.0.0', '0.99.99')).toBe(true);
  });
});

// ---- a published release reaches the desktops (run by hand since 2026-10-01) ----

const asset = (name: string) => ({ name, browser_download_url: `https://x/${name}` });
const release = (tag: string, names: string[]) => ({ tag_name: tag, assets: names.map(asset) });

describe('picking the Mac update', () => {
  it('takes the zip for this Mac, never the dmg or the other arch', () => {
    const assets = [
      asset('OpenShore-0.1.4-arm64.dmg'),
      asset('OpenShore-0.1.4-arm64-mac.zip'),
      asset('OpenShore-0.1.4-mac.zip'),
    ];
    expect(pickMacAsset(assets, 'arm64')?.name).toBe('OpenShore-0.1.4-arm64-mac.zip');
    expect(pickMacAsset(assets, 'x64')?.name).toBe('OpenShore-0.1.4-mac.zip');
  });

  it('falls back to the dmg when a release has no zip (a build made by hand)', () => {
    const assets = [asset('OpenShore-0.1.4-arm64.dmg'), asset('OpenShore-0.1.4.dmg')];
    expect(pickMacAsset(assets, 'arm64')?.name).toBe('OpenShore-0.1.4-arm64.dmg');
    expect(pickMacAsset(assets, 'x64')?.name).toBe('OpenShore-0.1.4.dmg');
    const releases = [release('v0.1.5', ['OpenShore-0.1.5-arm64.dmg'])];
    expect(newestMacUpdate(releases, '0.1.4', 'arm64')?.asset.name).toBe(
      'OpenShore-0.1.4-arm64.dmg'.replace('0.1.4', '0.1.5'),
    );
  });

  it('ships a local Mac release script that stamps the version and uploads the dmg', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/mac-release.sh'), 'utf8');
    expect(script).toContain('npm pkg set version="$VERSION"');
    expect(script).toContain('release/*.dmg');
    expect(script).toContain('gh release upload');
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['release:mac']).toBe('bash scripts/mac-release.sh');
  });

  it('takes the newest release that actually has a Mac build', () => {
    const releases = [
      release('v0.1.6', ['OpenShore-Setup-0.1.6.exe']), // Mac build not landed yet
      release('v0.1.5', ['OpenShore-0.1.5-arm64-mac.zip']),
      release('v0.1.4', ['OpenShore-0.1.4-arm64-mac.zip']),
    ];
    expect(newestMacUpdate(releases, '0.1.3', 'arm64')?.version).toBe('0.1.5');
    expect(newestMacUpdate(releases, '0.1.5', 'arm64')).toBeUndefined();
    expect(newestMacUpdate(releases, '0.1.3', 'x64')).toBeUndefined();
  });

  it('skips drafts and prereleases', () => {
    const r = { ...release('v0.2.0', ['OpenShore-0.2.0-arm64-mac.zip']), prerelease: true };
    expect(newestMacUpdate([r], '0.1.0', 'arm64')).toBeUndefined();
  });

  it('finds the bundle the app runs from', () => {
    expect(bundleOf('/Applications/OpenShore.app/Contents/MacOS/OpenShore')).toBe(
      '/Applications/OpenShore.app',
    );
    expect(bundleOf('/usr/bin/node')).toBeUndefined();
  });
});

describe('the update bar', () => {
  it('offers one click to update, and tracks it until the restart', () => {
    expect(updateBarCopy({ version: '0.1.5', phase: 'downloading' }).action).toBe('Update');
    expect(updateBarCopy({ version: '0.1.5', phase: 'available' }).action).toBe('Update');
    expect(updateBarCopy({ version: '0.1.5', phase: 'ready' }).action).toBe('Restart to update');
    const busy = updateBarCopy({ version: '0.1.5', phase: 'installing', percent: 42 });
    expect(busy.busy).toBe(true);
    expect(busy.text).toContain('42%');
    expect(updateBarCopy({ version: '0.1.5', phase: 'failed' }).action).toBe('Try again');
    // CX cleanup 1: a refused signature never reads as the network's failure.
    expect(updateBarCopy({ version: '0.1.5', phase: 'failed' }).text).toBe(
      'The update to v0.1.5 did not finish.',
    );
    expect(updateBarCopy({ version: '0.1.5', phase: 'failed', refused: true })).toEqual({
      text: 'The download of v0.1.5 failed its safety check, so it was not installed. This version keeps working.',
      action: 'Try again',
      busy: false,
    });
  });

  it('sits at the top of the window, in the layout, with no dismiss', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toMatch(/<div className="app-frame">\s*<UpdateBanner \/>/);
    const banner = readFileSync(join(process.cwd(), 'src/components/UpdateBanner.tsx'), 'utf8');
    expect(banner).not.toMatch(/onClose|onDismiss|>\s*(?:Dismiss|Later|Not now)\s*</);
  });
});

describe('the release workflow', () => {
  const wf = readFileSync(join(process.cwd(), '../.github/workflows/release.yml'), 'utf8');
  // By hand since 2026-10-01 (founder: a private repo's Actions minutes ran
  // out with a release on every push): Run workflow on main publishes, or a
  // v* tag does; a push to main starts nothing.
  it('publishes when run by hand on main or on a tag, never on a plain push', () => {
    const on = wf.slice(wf.indexOf('\non:\n'), wf.indexOf('\npermissions:'));
    expect(on).not.toMatch(/branches:/);
    expect(on).toMatch(/tags:\s*\n\s*- "v\*"/);
    expect(on).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*publish:/);
    expect(wf).toContain(
      'elif [[ "$GITHUB_REF" == refs/heads/main && "${PUBLISH:-}" == "true" ]]; then',
    );
    expect(wf).toContain("if: needs.version.outputs.tag != ''");
  });

  it('publishes to the public installers-only repo, never this private one', () => {
    // openshore.ai's download buttons and every installed app read releases
    // from openshore-releases; a private repo's releases are invisible to both.
    expect(wf).toContain('--repo openshore-labs/openshore-releases');
    expect(wf).not.toContain('--repo "${GITHUB_REPOSITORY}"');
    expect(wf).not.toContain('--generate-notes');
    // The patch number keeps climbing across the move: both repos' tags count.
    expect(wf).toContain(
      'git ls-remote --tags https://github.com/openshore-labs/openshore-releases.git',
    );
  });
});
