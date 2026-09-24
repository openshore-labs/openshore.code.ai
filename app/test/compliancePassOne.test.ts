// App compliance, pass one (2026-09-24): sign-up consent and age, the support
// and legal row, the paywall's subscription disclosures, dialog semantics,
// honest copy, pinch zoom, the Apple privacy manifest, and contrast. Most of
// these are promises to a reviewer or a regulator, so they are pinned here
// rather than left to memory.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPANY_NAME,
  MINIMUM_AGE,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  TERMS_URL,
} from '../src/lib/legal.js';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const src = (p: string) => read('src', p);

describe('the legal constants', () => {
  it('names the company, the one published support address, and the two documents', () => {
    expect(COMPANY_NAME).toBe('Open Shore, LLC');
    expect(SUPPORT_EMAIL).toBe('os-code@openshorellc.com');
    expect(TERMS_URL).toBe('https://openshore.ai/terms/');
    expect(PRIVACY_URL).toBe('https://openshore.ai/privacy-policy/');
    expect(MINIMUM_AGE).toBe(18);
  });

  it('opens outbound links the way every other outbound link opens', () => {
    const link = src('components/ExternalLink.tsx');
    expect(link).toMatch(/openExternal\(href\)/);
    expect(link).toMatch(/e\.preventDefault\(\)/);
  });
});

describe('creating an account asks for age and states the terms', () => {
  const card = src('components/SignInCard.tsx');

  it('shows a required, never pre-checked, age checkbox in create mode', () => {
    expect(card).toMatch(/\[adult, setAdult\] = useState\(false\)/);
    expect(card).toMatch(/type="checkbox"\s+required/);
    expect(card).toMatch(/I'm \{MINIMUM_AGE\} or older\./);
    expect(card).toMatch(/mode === 'signup' \? \(\s*<label className="consent-check">/);
  });

  it('will not create an account until the box is checked', () => {
    expect(card).toMatch(/disabled=\{busy \|\| \(mode === 'signup' && !adult\)\}/);
    expect(card).toMatch(/if \(creating && !adult\)/);
    // Both account-making paths pass creating: the button and the magic link.
    expect(card).toMatch(/'',\s*true,\s*\);/);
    // The magic link creates an account only from create mode (pass two B).
    expect(card).toMatch(
      /sendMagicLink\(addr, \{ createAccount: mode === 'signup' \}\),[\s\S]{0,80}mode === 'signup'/,
    );
  });

  it('states the Terms of Use and Privacy Policy under the button, as links', () => {
    expect(card).toMatch(/By creating an account you agree to the/);
    expect(card).toMatch(/<ExternalLink href=\{TERMS_URL\}>Terms of Use<\/ExternalLink>/);
    expect(card).toMatch(/<ExternalLink href=\{PRIVACY_URL\}>Privacy Policy<\/ExternalLink>/);
  });

  it('labels every field for assistive tech, not by placeholder alone', () => {
    for (const file of [
      'components/SignInCard.tsx',
      'components/AccountSetup.tsx',
      'screens/PairScreen.tsx',
    ]) {
      const text = src(file);
      // Each <input ...> up to its self-closing slash (attributes hold arrows,
      // so a [^>] scan would stop early).
      const inputs = text
        .split('<input')
        .slice(1)
        .map((chunk) => chunk.slice(0, chunk.indexOf('/>')));
      expect(inputs.length, file).toBeGreaterThan(0);
      for (const tag of inputs) {
        if (/type="checkbox"/.test(tag)) continue; // wrapped in its <label>
        expect(tag, `${file}: ${tag.slice(0, 60)}`).toMatch(/aria-label=/);
      }
    }
  });
});

describe('Settings carries support and legal', () => {
  const settings = src('screens/SettingsScreen.tsx');

  it('names the company, a selectable mail link, and both documents', () => {
    expect(settings).toMatch(/<SettingsGroup title="Support and legal"/);
    expect(settings).toMatch(/label=\{COMPANY_NAME\}/);
    expect(settings).toMatch(/href=\{`mailto:\$\{SUPPORT_EMAIL\}`\}/);
    expect(settings).toMatch(/className="linklike settings-mail"/);
    expect(settings).toMatch(/openExternal\(PRIVACY_URL\)/);
    expect(settings).toMatch(/openExternal\(TERMS_URL\)/);
    expect(read('src', 'theme.css')).toMatch(/\.settings-mail \{[^}]*user-select: text/);
  });

  it('lets a mail link leave the desktop app for the mail client', () => {
    const main = read('electron', 'main.ts');
    expect(main.match(/\/\^\(https\?:\\\/\\\/\|mailto:\)\//g)?.length).toBe(2);
  });
});

describe('the paywall discloses the subscription', () => {
  const paywall = src('components/Paywall.tsx');

  it('uses the App Store localized price when StoreKit answers', () => {
    expect(paywall).toMatch(/products\(\[PERSONAL_YEARLY_PRODUCT_ID\]\)/);
    expect(paywall).toMatch(/found\?\.displayPrice/);
  });

  it('states billing, auto-renewal, the 24-hour window, and where to cancel', () => {
    expect(paywall).toMatch(/\{price\} a year, billed through your Apple ID\./);
    const flat = paywall.replace(/\s+/g, ' ');
    expect(flat).toContain(
      'It renews automatically each year unless you turn off auto-renew at least 24 hours before the renewal date. Manage or cancel in Settings, then your name, then Subscriptions.',
    );
  });

  it('links the Terms of Use and Privacy Policy, keeps Restore, and renames the check', () => {
    expect(paywall).toMatch(/<ExternalLink href=\{TERMS_URL\}>Terms of Use/);
    expect(paywall).toMatch(/<ExternalLink href=\{PRIVACY_URL\}>Privacy Policy/);
    expect(paywall).toMatch(/'Restore purchases'/);
    expect(paywall).toMatch(/'I already subscribed\. Check again'/);
    expect(paywall).not.toMatch(/I bought it/);
  });

  it('is a modal dialog to assistive tech', () => {
    expect(paywall).toMatch(/role="dialog"/);
    expect(paywall).toMatch(/aria-modal="true"/);
    expect(paywall).toMatch(/aria-labelledby="paywall-title"/);
  });
});

describe('the shared Sheet is a dialog', () => {
  const sheet = src('components/Sheet.tsx');

  it('carries dialog (alertdialog for confirm), aria-modal, a name, and tabIndex -1', () => {
    expect(sheet).toMatch(/role=\{variant === 'confirm' \? 'alertdialog' : 'dialog'\}/);
    expect(sheet).toMatch(/aria-modal="true"/);
    expect(sheet).toMatch(/aria-labelledby=/);
    expect(sheet).toMatch(/tabIndex=\{-1\}/);
  });

  it('leans on the app-root trap, which lands on the card when it has no control', () => {
    const trap = src('hooks/useSheetFocusTrap.ts');
    expect(trap).toMatch(
      /\(sheet\.querySelector<HTMLElement>\(FOCUSABLE\) \?\? sheet\)\.focus\(\)/,
    );
  });
});

describe('honest copy', () => {
  const retired = [
    'no IP address, ever',
    'Nothing routes through us.',
    'Personal use needs no account',
    'learns from how you work',
  ];
  it('retires the overclaims across the app', () => {
    const files = [
      'screens/SettingsScreen.tsx',
      'components/Paywall.tsx',
      'components/SignInCard.tsx',
      'lib/currents.ts',
    ];
    for (const file of files) {
      const text = src(file);
      for (const phrase of retired) expect(text, `${file}: ${phrase}`).not.toContain(phrase);
    }
  });

  it('says what a guardrail block record carries, and never the text', () => {
    const flat = src('screens/SettingsScreen.tsx').replace(/\s+/g, ' ');
    expect(flat).toContain(
      "When you're signed in, a block sends a short record to your account: the category and tier, the time, a one-way fingerprint of the text, whether it ran locally or in the cloud, what the screen did, whether it was your request or the model's reply, and the names of the rules that matched. Never the text, and never a person's name. Blocks are kept for 180 days. Consent you give to depict a real person stays on this device.",
    );
    expect(flat).toContain(
      "No telemetry, no analytics, no advertising. OpenShore's own code never reads or stores your IP address, though our hosting and sign-in provider sees it as any server does.",
    );
  });
});

describe('the page can be zoomed', () => {
  it('does not disable pinch zoom in the viewport', () => {
    const html = read('index.html');
    const viewport = html.match(/name="viewport"\s+content="([^"]*)"/)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/);
    expect(viewport).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
  });
});

describe('the Apple privacy manifest', () => {
  const manifest = read('ios', 'App', 'App', 'PrivacyInfo.xcprivacy');
  const pbx = read('ios', 'App', 'App.xcodeproj', 'project.pbxproj');

  it('declares no tracking and the collected data types, each linked and for app functionality', () => {
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    for (const type of [
      'EmailAddress',
      'UserID',
      'PurchaseHistory',
      'OtherUserContent',
      'OtherUsageData',
    ]) {
      const entry = manifest.match(
        new RegExp(`NSPrivacyCollectedDataType${type}</string>[\\s\\S]*?</dict>`),
      )?.[0];
      expect(entry, type).toBeTruthy();
      expect(entry).toMatch(/NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/);
      expect(entry).toMatch(/NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/);
      expect(entry).toMatch(/NSPrivacyCollectedDataTypePurposeAppFunctionality/);
    }
  });

  it('declares the required-reason APIs with their reasons', () => {
    const reasons: Record<string, string[]> = {
      UserDefaults: ['CA92.1'],
      FileTimestamp: ['C617.1', '3B52.1'],
      DiskSpace: ['E174.1'],
    };
    for (const [api, codes] of Object.entries(reasons)) {
      const entry = manifest.match(
        new RegExp(`NSPrivacyAccessedAPICategory${api}</string>[\\s\\S]*?</array>`),
      )?.[0];
      expect(entry, api).toBeTruthy();
      for (const code of codes) expect(entry, `${api} ${code}`).toContain(code);
    }
  });

  it('ships in the App target: a file reference, a build file, the group, and Resources', () => {
    const ref = pbx.match(
      /(\w{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;/,
    )?.[1];
    const build = pbx.match(
      /(\w{24}) \/\* PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile; fileRef = (\w{24})/,
    );
    expect(ref).toBeTruthy();
    expect(build?.[2]).toBe(ref);
    const resources = pbx.match(
      /\/\* Resources \*\/ = \{\s*isa = PBXResourcesBuildPhase;[\s\S]*?\);/,
    )?.[0];
    expect(resources).toContain(`${build?.[1]} /* PrivacyInfo.xcprivacy in Resources */`);
    const group = pbx.match(/\/\* App \*\/ = \{\s*isa = PBXGroup;[\s\S]*?\);/)?.[0];
    expect(group).toContain(`${ref} /* PrivacyInfo.xcprivacy */`);
    // Every object id in the project is unique.
    const ids = [...pbx.matchAll(/^\t\t([0-9A-F]{24}) .*= \{/gm)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('contrast (WCAG 2.2 AA)', () => {
  const theme = read('src', 'theme.css');
  const root = theme.slice(theme.indexOf(':root {'), theme.indexOf('color-scheme: light;'));
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

  it('text tokens read at 4.5:1 on the paper grounds', () => {
    const bg = token(root, 'bg')!;
    const raised = token(root, 'bg-raised')!;
    for (const name of [
      'muted',
      'ok',
      'ok-ink',
      'cloud',
      'voice-ink',
      'wave-ink',
      'warn',
      'link',
      'danger',
    ]) {
      const hex = token(root, name);
      expect(hex, name).toBeTruthy();
      expect(ratio(hex!, bg), `${name} on bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex!, raised), `${name} on raised`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('control edges read at 3:1 in both themes', () => {
    expect(ratio(token(root, 'input-border')!, token(root, 'bg')!)).toBeGreaterThanOrEqual(3);
    expect(ratio(token(dark, 'input-border')!, token(dark, 'bg')!)).toBeGreaterThanOrEqual(3);
    expect(theme).toMatch(/\.switch \{[^}]*background: var\(--input-border\)/);
    expect(theme).toMatch(/\.field input \{[^}]*border: 1px solid var\(--input-border\)/);
  });

  it('dark muted text reads at 4.5:1, and accent fills carry the dark ground as their text', () => {
    expect(ratio(token(dark, 'muted')!, token(dark, 'bg')!)).toBeGreaterThanOrEqual(4.5);
    expect(dark).toMatch(/--on-accent:\s*var\(--bg\)/);
    expect(theme).toMatch(/\.btn\.danger \{[^}]*color: var\(--on-accent\)/);
  });

  it('keeps the Coming soon pill at full opacity and dims only the room beside it', () => {
    const soon = theme.match(/\.nav-item--soon \{[^}]*\}/)?.[0] ?? '';
    expect(soon).not.toMatch(/opacity/);
    expect(theme).toMatch(/\.nav-item--soon \.nav-soon-label \{\s*opacity: 0\.5;/);
  });

  it('gives the attachment chip close a 24px target without moving the chip', () => {
    const chip = theme.match(/\.composer-chip-x \{[^}]*\}/)?.[0] ?? '';
    expect(chip).toMatch(/width: 18px;/);
    expect(chip).toMatch(/padding: 3px;/);
    expect(chip).toMatch(/margin: -3px;/);
    expect(chip).toMatch(/box-sizing: content-box;/);
  });
});
