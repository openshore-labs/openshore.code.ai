// UI-5: the embedded Codemagic view is a fenced sign-in surface, not a
// browser. It grants no device permissions, fences sub-frames like the main
// frame, and holds GitHub's /orgs/ to the SSO prompt alone.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  session: { fromPartition: () => ({}) },
  shell: { openExternal: async () => {} },
}));

const { EMBEDDED_SITES, hostAllowed } = await import('../electron/embeddedWeb.js');
const SRC = readFileSync(join(process.cwd(), 'electron', 'embeddedWeb.ts'), 'utf8');

describe('embedded web fence', () => {
  const site = EMBEDDED_SITES.codemagic!;

  it('denies every permission request on the embedded partition', () => {
    expect(SRC).toMatch(/setPermissionRequestHandler\([\s\S]{0,160}?callback\(false\)/);
    expect(SRC).toMatch(/setPermissionCheckHandler\(\(\) => false\)/);
  });

  it('fences sub-frame navigations too', () => {
    expect(SRC).toContain("contents.on('will-frame-navigate'");
  });

  it('allows the GitHub org SSO prompt and nothing else under /orgs/', () => {
    expect(hostAllowed('https://github.com/orgs/acme/sso', site)).toBe(true);
    expect(hostAllowed('https://github.com/orgs/acme/sso/', site)).toBe(true);
    expect(hostAllowed('https://github.com/orgs/acme', site)).toBe(false);
    expect(hostAllowed('https://github.com/orgs/acme/repositories', site)).toBe(false);
    expect(hostAllowed('https://github.com/orgs/acme/sso-settings', site)).toBe(false);
  });

  it('keeps the rest of the fence as it was', () => {
    expect(hostAllowed('https://github.com/login', site)).toBe(true);
    expect(hostAllowed('https://github.com/anthropics/claude-code', site)).toBe(false);
    expect(hostAllowed('https://app.codemagic.io/apps/x', site)).toBe(true);
    expect(hostAllowed('http://codemagic.io/apps', site)).toBe(false);
    expect(hostAllowed('https://example.com/', site)).toBe(false);
  });
});
