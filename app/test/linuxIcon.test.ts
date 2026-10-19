// The Linux app shows its own icon (founder, 2026-10-19): the dash and the
// applications folder showed the fallback, because the package carried only a
// 1024px icon, which hicolor themes do not look under, and the window never
// matched its .desktop entry. These pin the three fixes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  desktopName?: string;
  build: { linux: { icon?: string; syncDesktopName?: boolean } };
};

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('the Linux app icon', () => {
  it('ships the icon at every size a hicolor theme looks under', () => {
    expect(pkg.build.linux.icon).toBe('build/icons');
    for (const n of [16, 24, 32, 48, 64, 128, 256, 512]) {
      const file = join(root, 'build', 'icons', `${n}x${n}.png`);
      expect(existsSync(file), file).toBe(true);
      expect(pngSize(file)).toEqual([n, n]);
    }
  });

  it('names the window after its .desktop entry, so the dock links the two', () => {
    expect(pkg.desktopName).toBe('oscode-app.desktop');
    expect(pkg.build.linux.syncDesktopName).toBe(true);
  });

  it('gives the window and the tray an icon that is inside the package', () => {
    const main = readFileSync(join(root, 'electron', 'main.ts'), 'utf8');
    expect(main).toContain("process.platform === 'linux' ? { icon: bundledIconPath('default') }");
    expect(main).toMatch(
      /function trayIconPath\(\): string \{\s*return bundledIconPath\('default'\)/,
    );
  });
});
