// The server installer (connect-anywhere, 2026-10-07) holds the same lines the
// desktop does: it trusts only a package signed with the pinned desktop key,
// the daemon it starts listens on the tailnet alone, and it never installs
// network software behind the person's back.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const installer = readFileSync(join(root, 'os-code', 'scripts', 'install-server.sh'), 'utf8');

describe('install-server.sh', () => {
  it('pins the same release key the desktop app pins', () => {
    const keys = readFileSync(join(root, 'app', 'electron', 'releaseKeys.ts'), 'utf8');
    const desktop = /DESKTOP_RELEASE_PUBLIC_KEY = '([^']+)'/.exec(keys)?.[1];
    expect(desktop).toBeTruthy();
    expect(installer).toContain(`RELEASE_PUBLIC_KEY="${desktop}"`);
  });

  it('signs over the same message the desktop verifies', () => {
    expect(installer).toContain('printf \'openshore-release-v1\\n%s\\n%s\' "$ASSET" "$SHA"');
    expect(installer).toMatch(/openssl pkeyutl -verify -pubin/);
    expect(installer).toMatch(/fail "the signature does not match/);
  });

  it('serves on the tailnet only, never a public address', () => {
    expect(installer).toContain('ExecStart=/usr/local/bin/osc serve --bind tailscale');
    expect(installer).not.toMatch(/0\.0\.0\.0|--bind loopback/);
  });

  it('prints the Tailscale install line instead of running it', () => {
    expect(installer).toContain('say "  curl -fsSL https://tailscale.com/install.sh | sh"');
    expect(installer).not.toMatch(/^\s*curl -fsSL https:\/\/tailscale\.com/m);
  });

  it('reads from the public releases repository the desktop updates from', () => {
    expect(installer).toContain(
      'RELEASES="https://github.com/openshore-labs/openshore-releases/releases"',
    );
  });
});
