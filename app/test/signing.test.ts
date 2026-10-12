// Signing is ready but off (v1 Phase 1): the Mac build signs and notarizes
// only when the Developer ID secrets exist, and Windows signs only with its
// certificate secrets. Without them both builds are exactly today's unsigned
// ones (a maintainer's call stands until the secrets are added).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), '..');
const codemagic = readFileSync(join(root, 'codemagic.yaml'), 'utf8');
const release = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  build: { mac: Record<string, unknown> };
};

describe('macOS signing waits for the secrets', () => {
  const step = codemagic.slice(
    codemagic.indexOf('- name: Package the macOS app'),
    codemagic.indexOf('- name: Publish to the GitHub Release'),
  );

  it('signs and notarizes only with a certificate and notarization credentials', () => {
    expect(step).toContain(
      'if [ -n "${CSC_LINK:-}" ] && { [ -n "${APPLE_API_KEY:-}" ] || [ -n "${APPLE_ID:-}" ]; }',
    );
    expect(step).toContain('-c.mac.hardenedRuntime=true');
    expect(step).toContain('-c.mac.entitlements=build/entitlements.mac.plist');
  });

  it('otherwise builds exactly as before, with any stray certificate ignored', () => {
    expect(step).toContain(
      'env -u CSC_LINK -u CSC_KEY_PASSWORD CSC_IDENTITY_AUTO_DISCOVERY=false \\\n              pnpm exec electron-builder --mac --publish never',
    );
    // The default config carries no signing settings of its own.
    expect(pkg.build.mac.hardenedRuntime).toBeUndefined();
    expect(pkg.build.mac.entitlements).toBeUndefined();
    expect(pkg.build.mac.identity).toBeUndefined();
  });

  it('the entitlements are the three Electron and node-pty need, no more', () => {
    const plist = readFileSync(join(process.cwd(), 'build', 'entitlements.mac.plist'), 'utf8');
    const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
    expect(keys).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
      'com.apple.security.cs.disable-library-validation',
    ]);
  });
});

describe('Windows signing waits for its secrets', () => {
  it('passes the certificate only from repository secrets', () => {
    const step = release.slice(release.indexOf('- name: Package the Windows installer'));
    expect(step).toContain('WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}');
    expect(step).toContain('WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}');
    expect(release).not.toMatch(/WIN_CSC_LINK:\s*[^$\s]/);
  });
});
