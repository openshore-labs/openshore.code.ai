// The app icon picker and the Nightshore dark theme (founder, 2026-10-01).
// The three tiles are one list (lib/appIcon.ts), and every place that has to
// agree with it is held to it here: the iOS icon sets and the Xcode setting
// that compiles them in, the native plugin's allow-list, the desktop's
// bundled PNGs and its handler. The dark ground is the site's abyss, in the
// theme and in every place the native shells paint it before the page does.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ICONS, appIconNote, appIconOf } from '../src/lib/appIcon.js';
import { SETTINGS_REACH } from '../src/lib/settingsReach.js';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('the app icon choices', () => {
  it('are the default ink tile, the site turquoise, and white with a near-black mark', () => {
    expect(APP_ICONS.map((i) => i.id)).toEqual(['default', 'turquoise', 'white']);
    expect(appIconOf('turquoise')).toMatchObject({ tile: '#5bb6cb', line: '#0b1417' });
    expect(appIconOf('white')).toMatchObject({ tile: '#ffffff', wave: '#0b1417' });
    expect(appIconOf(undefined).id).toBe('default');
    expect(appIconOf('nonsense').id).toBe('default');
  });

  it('has an iOS icon set, compiled in, and allowed natively, for each alternate', () => {
    const pbx = read('ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    const swift = read(
      'plugins',
      'oscode-llama',
      'ios',
      'Sources',
      'OscodeLlamaPlugin',
      'OscodeLlamaPlugin.swift',
    );
    const alternates = APP_ICONS.filter((i) => i.iosName).map((i) => i.iosName!);
    const setting = `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "${alternates.join(' ')}";`;
    expect(pbx.split(setting).length - 1).toBe(2); // Debug and Release
    for (const name of alternates) {
      const set = join(process.cwd(), 'ios', 'App', 'App', 'Assets.xcassets', `${name}.appiconset`);
      expect(existsSync(join(set, `${name}.png`)), name).toBe(true);
      expect(
        read('ios', 'App', 'App', 'Assets.xcassets', `${name}.appiconset`, 'Contents.json'),
      ).toContain(`"filename" : "${name}.png"`);
      expect(swift).toContain(`"${name}"`);
    }
    expect(swift).toContain('CAPPluginMethod(name: "setAppIcon"');
    expect(swift).toContain('setAlternateIconName(name)');
  });

  it('ships a PNG for the desktop for each, and the desktop takes only those', () => {
    for (const icon of APP_ICONS) {
      expect(
        existsSync(join(process.cwd(), 'public', 'app-icons', `${icon.id}.png`)),
        icon.id,
      ).toBe(true);
    }
    const main = read('electron', 'main.ts');
    expect(main).toContain("const APP_ICON_IDS = new Set(['default', 'turquoise', 'white']);");
    expect(main).toContain("guarded('osc:setAppIcon'");
    expect(read('electron', 'preload.cjs')).toContain("setAppIcon: invoke('osc:setAppIcon')");
  });

  it("is this device's own setting, and the copy says what changes where", () => {
    expect(SETTINGS_REACH.appIcon).toBe('device');
    expect(appIconNote('phone')).toMatch(/Home Screen icon/);
    expect(appIconNote('desktop')).toMatch(/while OpenShore is open/);
  });

  it('sits in Settings beside the System, Light and Dark switch', () => {
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    const appearance = settings.indexOf('label="Appearance"');
    const picker = settings.indexOf('label="App icon"');
    expect(appearance).toBeGreaterThan(0);
    expect(picker).toBeGreaterThan(appearance);
    expect(picker - appearance).toBeLessThan(2000);
    expect(settings).toContain('role="radiogroup" aria-label="App icon"');
  });

  it('never resets the device icon before the saved settings are in', () => {
    const app = read('src', 'App.tsx');
    expect(app).toMatch(/if \(ready\) void applyAppIcon\(appIcon \?\? 'default'\);/);
  });
});

describe('Nightshore, the dark theme', () => {
  const theme = read('src', 'theme.css');

  it('is the site palette: abyss ground, paper ink, the bright wave for the accent', () => {
    for (const token of [
      '--bg: #0b1417;',
      '--bg-raised: #10202a;',
      '--border: #24424d;',
      '--ink: #f6f4ef;',
      '--ink-soft: #a9bac0;',
      '--accent: #5bb6cb;',
      '--local: #5bb6cb;',
    ]) {
      expect(theme.split(token).length - 1, token).toBe(2); // system and pinned dark
    }
    expect(theme).not.toContain('#17140e');
  });

  it('is the ground the native shells paint before the page does', () => {
    expect(read('index.html')).toContain('content="#0b1417" media="(prefers-color-scheme: dark)"');
    expect(read('electron', 'main.ts')).toContain("nativeTheme.shouldUseDarkColors ? '#0b1417'");
    expect(read('ios', 'App', 'App', 'SceneDelegate.swift')).toContain(
      'UIColor(red: 0x0b / 255.0, green: 0x14 / 255.0, blue: 0x17 / 255.0, alpha: 1)',
    );
    expect(read('scripts', 'brand', 'osc-splash-dark.svg')).toContain('fill="#0b1417"');
  });
});
