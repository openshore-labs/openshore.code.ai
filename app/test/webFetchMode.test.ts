// Opening web pages is a setting (founder, 2026-10-02): ask, always, or never,
// carried to the computer that runs the coding agent and listed under What
// leaves this device.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushWebFetchMode, webFetchLine, WEB_FETCH_MODES } from '../src/lib/webFetchMode.js';
import { EGRESS } from '../src/lib/egressManifest.js';
import { SETTINGS_REACH } from '../src/lib/settingsReach.js';

afterEach(() => vi.unstubAllGlobals());

describe('opening web pages, the setting', () => {
  it('offers ask, always, and never, and says what each does', () => {
    expect(WEB_FETCH_MODES).toEqual(['ask', 'allow', 'off']);
    expect(webFetchLine('ask')).toMatch(/asks before/);
    expect(webFetchLine('allow')).toMatch(/without asking/);
    expect(webFetchLine('allow')).toMatch(/own network still asks/);
    expect(webFetchLine('off')).toMatch(/never opens/);
  });

  it('carries the choice to the paired computer as its owner', async () => {
    const fetchMock = vi.fn(async () => new Response('{"webFetch":"allow"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await pushWebFetchMode('allow', {
      daemon: { baseUrl: 'http://100.64.0.1:4816', token: 'osc_t' },
    });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://100.64.0.1:4816/settings/web-fetch');
    expect(JSON.parse(String(init.body))).toEqual({ mode: 'allow' });
  });

  it('says false when no computer is in reach', async () => {
    expect(await pushWebFetchMode('off', {})).toBe(false);
  });

  it('is a device setting, on What leaves this device, and in Settings, Approvals', () => {
    expect(SETTINGS_REACH.webFetchMode).toBe('device');
    const entry = EGRESS.find((e) => e.id === 'web-pages')!;
    expect(entry.when).toMatch(/asks first/);
    expect(entry.when).toMatch(/Never/);
    const settings = readFileSync(
      join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
      'utf8',
    );
    expect(settings).toMatch(/label="Opening web pages"/);
  });
});
