// App compliance pass two B (advisory org rulings, 2026-09-24): web search and
// fetch ask first, desktop and web voice asks first, provenance copy narrowed,
// "Buy seats on the web" hidden on iOS, "encrypted at rest" replaced by
// per-platform wording, the magic-link age loophole closed, and the dark-mode
// contrast leftovers. The engine side of web ask-first is pinned in
// os-code/test/webAskFirst.test.ts; this file pins the app.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sealKind, sealLine, sealProtects, SEAL_LINES } from '../src/lib/keySeal.js';
import { VOICE_CONSENT_PROMPT, voiceNeedsConsent } from '../src/lib/voiceConsent.js';
import { billingStatusLine, cannotGrowHint, showsPurchasePath } from '../src/lib/adminBilling.js';
import { searchServiceLabel } from '../src/lib/webSearch.js';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('web search and fetch ask first', () => {
  const sheet = read('src', 'components', 'ApprovalSheet.tsx');
  const store = read('src', 'state', 'store.ts');
  const rows = read('src', 'components', 'PrivacyRows.tsx');
  const settings = read('src', 'screens', 'SettingsScreen.tsx');

  it('gives web access its own card: one session-wide yes on the engine, Search per query on the phone', () => {
    expect(sheet).toMatch(/const isWeb = !isSpend && request\.risk === 'network'/);
    expect(sheet).toMatch(/request\.grant === 'session'/);
    expect(sheet).toContain("'Allow for this session'");
    expect(sheet).toContain("? 'Search'");
    expect(sheet).toContain('Not now');
    expect(sheet).toContain("'Web access'");
  });

  it('names the search service the query goes to', () => {
    expect(searchServiceLabel(undefined)).toBe('DuckDuckGo');
    expect(searchServiceLabel('duckduckgo')).toBe('DuckDuckGo');
    expect(searchServiceLabel('brave')).toBe('Brave Search');
    expect(searchServiceLabel('tavily')).toBe('Tavily');
    expect(searchServiceLabel('perplexity')).toBe('Perplexity');
  });

  it('has an "Ask before searching the web" switch, default on, on every platform', () => {
    expect(rows).toContain("export const ASK_BEFORE_WEB_LABEL = 'Ask before searching the web'");
    expect(rows).toMatch(/const on = settings\.askBeforeWeb !== false;/);
    // Placed in the Privacy group, with no platform gate around it.
    expect(settings).toMatch(/<KeySealRow \/>\s*<WebAskRow \/>\s*<\/SettingsGroup>/);
  });

  it('threads the switch to the engine the way the humanizer override travels', () => {
    expect(store).toMatch(/askBeforeWeb: settings\.askBeforeWeb !== false,/);
    expect(store).toMatch(/askBeforeWeb: sessionOpts\.askBeforeWeb,/);
    expect(store).toMatch(/\(\) => get\(\)\.settings\.askBeforeWeb !== false,/);
    const remote = read('src', 'drivers', 'remoteDriver.ts');
    expect(remote).toMatch(/askBeforeWeb: opts\.askBeforeWeb/);
    const main = read('electron', 'main.ts');
    expect(main).toMatch(/askBeforeWeb: optBool\(o\.askBeforeWeb, 'askBeforeWeb'\)/);
    const host = read('electron', 'engineHost.ts');
    expect(host).toMatch(/askBeforeWeb: opts\.askBeforeWeb,/);
  });

  it('declares web use on the routine setup card, default off', () => {
    const lib = read('src', 'lib', 'routines.ts');
    const screen = read('src', 'screens', 'CrewCommandScreen.tsx');
    expect(lib).toMatch(/webSearch/);
    expect(screen).toContain('This routine may search the web');
    expect(screen).toMatch(/webSearch: draft\.webSearch/);
  });
});

describe('desktop and web voice asks first', () => {
  it('asks off the iPhone until the setting is on; the iPhone never asks', () => {
    expect(voiceNeedsConsent('electron', {})).toBe(true);
    expect(voiceNeedsConsent('web', { voiceCloudConsent: false })).toBe(true);
    expect(voiceNeedsConsent('electron', { voiceCloudConsent: true })).toBe(false);
    expect(voiceNeedsConsent('ios', {})).toBe(false);
  });

  it('says where the audio may go, in the ruling words', () => {
    expect(VOICE_CONSENT_PROMPT).toBe(
      "Voice on this computer uses your system's speech service, which may send your audio to its provider (in Chrome-based apps, Google). Allow?",
    );
    const sheet = read('src', 'components', 'VoiceConsentSheet.tsx');
    expect(sheet).toContain('Allow');
    expect(sheet).toContain('Not now');
    expect(sheet).toMatch(/saveSettings\(\{ voiceCloudConsent: true \}\)/);
    expect(sheet).toMatch(/variant="confirm"/);
  });

  it('gates both mic doors: the composer dictation and voice mode', () => {
    const composer = read('src', 'components', 'Composer.tsx');
    expect(composer).toMatch(/voiceConsent\.gate\(\(\) => \{/);
    expect(composer).toContain('{voiceConsent.sheet}');
    const chat = read('src', 'screens', 'ChatScreen.tsx');
    expect(chat).toMatch(/voiceConsent\.gate\(\(\) => void openVoiceNow\(\)\)/);
    expect(chat).toContain('{voiceConsent.sheet}');
  });

  it('has a "Send voice to the speech service" row, off by default, hidden on iOS', () => {
    const rows = read('src', 'components', 'PrivacyRows.tsx');
    expect(rows).toMatch(/if \(platform\(\) === 'ios'\) return null;/);
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    expect(settings).toContain('<VoiceConsentRow />');
  });
});

describe('provenance copy narrowed to what exists', () => {
  it('Settings promises a provenance record for images only, and says video and voice are refused', () => {
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    expect(settings).not.toMatch(/an image, a video, or a voice/);
    expect(settings).not.toMatch(/provenance metadata/);
    expect(settings).toMatch(/unsigned provenance record/);
    expect(settings).toMatch(/Video\s+or voice of a real person is refused/);
  });
});

describe('iOS Admin shows seat counts only', () => {
  it('has no purchase path on iOS and keeps it on the web and desktop', () => {
    expect(showsPurchasePath(true)).toBe(false);
    expect(showsPurchasePath(false)).toBe(true);
    expect(billingStatusLine(undefined, true)).toBe('No active subscription.');
    expect(billingStatusLine(undefined, true)).not.toMatch(/web|purchase|buy/i);
    expect(billingStatusLine(undefined, false)).toMatch(/purchased on the web/);
    expect(cannotGrowHint(true)).not.toMatch(/renew|billing|web|buy/i);
  });

  it('puts the buy button, the price, and the headcount editor behind the gate', () => {
    const admin = read('src', 'screens', 'AdminScreen.tsx');
    expect(admin).toMatch(/const purchasePath = showsPurchasePath\(platform\(\) === 'ios'\);/);
    const buy = admin.indexOf("'Buy seats on the web'");
    const gate = admin.lastIndexOf('{purchasePath ? (', buy);
    expect(buy).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(0);
    expect(admin.slice(gate, buy)).not.toContain(') : null}');
    const price = admin.indexOf('priceLabel(tier)');
    expect(admin.lastIndexOf('{purchasePath ? (', price)).toBeGreaterThan(0);
    expect(admin).toMatch(/\{seatEdit && purchasePath \? \(/);
    expect(admin).not.toMatch(/Seats are purchased on the web/);
  });
});

describe('the data key, said per platform', () => {
  it('says where the key lives on each platform, in the ruling words', () => {
    expect(sealLine('ios')).toBe('Sealed on this device, key in the iOS Keychain.');
    expect(sealLine('electron', { os: 'darwin', available: true })).toBe(
      'Sealed on this computer, key held by the system.',
    );
    expect(sealLine('electron', { os: 'win32', available: true })).toBe(
      'Sealed on this computer, key held by the system.',
    );
    for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
      expect(sealLine('electron', { os: 'linux', available: true, backend })).toBe(
        'Sealed on this computer, key in your system keyring.',
      );
    }
    expect(sealLine('electron', { os: 'linux', available: true, backend: 'basic_text' })).toBe(
      'Keys on this computer are stored unencrypted because no system keyring was found. Install and unlock a keyring (for example GNOME Keyring or KWallet), then restart OpenShore.',
    );
    expect(sealLine('web')).toBe('Not encrypted against anyone who can use this browser profile.');
  });

  it('never promises protection it cannot see', () => {
    // An unknown Linux backend is not a keyring, and no secure storage on a
    // Mac or PC means the key sits in the app's own storage.
    expect(sealKind('electron', { os: 'linux', available: true, backend: 'unknown' })).toBe(
      'no-keyring',
    );
    expect(sealKind('electron', { os: 'linux', available: false })).toBe('no-keyring');
    expect(sealKind('electron', { os: 'darwin', available: false })).toBe('desktop-unavailable');
    expect(sealKind('electron')).toBe('checking');
    expect(sealProtects('no-keyring')).toBe(false);
    expect(sealProtects('browser')).toBe(false);
    for (const line of Object.values(SEAL_LINES)) expect(line).not.toMatch(/at rest/i);
  });

  it('reads the safeStorage backend in Electron and carries it on the status', () => {
    const main = read('electron', 'main.ts');
    expect(main).toMatch(/safeStorage\.getSelectedStorageBackend\(\)/);
    expect(main).toMatch(/keyStore: keyStoreStatus\(\)/);
    const bridge = read('src', 'lib', 'electronBridge.ts');
    expect(bridge).toMatch(/keyStore\?: import\('\.\/keySeal\.js'\)\.KeyStoreStatus;/);
  });

  it('leaves no unqualified "encrypted at rest" claim in the app copy', () => {
    for (const file of [
      ['src', 'screens', 'SettingsScreen.tsx'],
      ['src', 'screens', 'ProjectMemoryScreen.tsx'],
      ['src', 'lib', 'projectSecrets.ts'],
      ['src', 'lib', 'gitos', 'providers.ts'],
      ['src', 'lib', 'gitos', 'local.ts'],
    ]) {
      const text = read(...file);
      expect(text, file.join('/')).not.toMatch(
        /Encrypted at rest|sealed at rest with|'Stored here, sealed at rest/,
      );
    }
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    expect(settings).toMatch(/sealLine\(platform\(\), desktopStatus\?\.keyStore\)/);
    expect(settings).toContain('<KeySealRow />');
  });
});

describe('a sign-in link never creates an account', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const load = async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://sb.example');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    vi.resetModules();
    return import('../src/lib/supabase.js');
  };

  it('sends create_user false unless the create-account path asks', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body));
        return new Response('{}', { status: 200 });
      }),
    );
    const sb = await load();
    await sb.signInWithOtp('a@b.co', 'oscode://auth');
    await sb.signInWithOtp('a@b.co', 'oscode://auth', true);
    expect(bodies[0]!.create_user).toBe(false);
    expect(bodies[1]!.create_user).toBe(true);
  });

  it('says what to do when the address has no account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ msg: 'Signups not allowed for otp' }), { status: 422 }),
      ),
    );
    const sb = await load();
    await expect(sb.signInWithOtp('new@b.co', 'oscode://auth')).rejects.toThrow(
      sb.MAGIC_LINK_NO_ACCOUNT,
    );
  });

  it('only the create-account mode passes createAccount', () => {
    const store = read('src', 'state', 'store.ts');
    expect(store).toMatch(
      /signInWithOtp\(email\.trim\(\), authRedirectTo\(\), opts\?\.createAccount === true\)/,
    );
    const card = read('src', 'components', 'SignInCard.tsx');
    expect(card).toMatch(/sendMagicLink\(addr, \{ createAccount: mode === 'signup' \}\)/);
  });
});

describe('dark-mode contrast leftovers', () => {
  const theme = read('src', 'theme.css');
  const dark = theme.slice(theme.indexOf(":root[data-theme='dark'] {"));
  const token = (block: string, name: string) =>
    block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * channel(n[0]!) + 0.7152 * channel(n[1]!) + 0.0722 * channel(n[2]!);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it('the to-do check on the green mark uses the accent ink, which passes in dark', () => {
    expect(theme).toMatch(/\.todo-row\.completed \.todo-mark \{[^}]*color: var\(--on-accent\)/);
    // In dark the accent ink is the ground; white failed on the lighter green.
    const ink = token(dark, 'bg')!;
    expect(ratio(ink, token(dark, 'ok')!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#ffffff', token(dark, 'ok')!)).toBeLessThan(4.5);
  });

  it('the on-device model tile uses the accent ink, which passes on both ends of its gradient', () => {
    expect(theme).toMatch(/\.model-tile\.on-device \{[^}]*color: var\(--on-accent\)/);
    const ink = token(dark, 'bg')!;
    expect(ratio(ink, token(dark, 'wave')!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ink, token(dark, 'local-deep')!)).toBeGreaterThanOrEqual(4.5);
  });
});
