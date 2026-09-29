// The release check for Apple's receipt roots (next build E0, finding 11):
// scripts/check-apple-roots.mjs, which Codemagic's iOS workflow runs. It must
// stop a build that can sell while AppleRootCA-G3 is still a placeholder, and
// must NOT fail ordinary CI or a TestFlight build while the pay gates are off,
// so it is tested here on fixture text, never on the real file's verdict.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as check from '../scripts/check-apple-roots.mjs';

// A plain .mjs build script with no type declarations, so its shape is named here.
const { appleRootsVerdict, buildCanSell, placeholderRoots } = check as unknown as {
  appleRootsVerdict: (
    apple: string,
    store: string,
    env: Record<string, string | undefined>,
  ) => { verdict: 'ok' | 'warn' | 'fail'; left: string[] };
  buildCanSell: (store: string, env: Record<string, string | undefined>) => boolean;
  placeholderRoots: (apple: string) => string[];
};

const placeholder = `
const PASTE = 'PASTE_REAL_BASE64_DER_HERE_';
const APPLE_ROOT_CA_G3_DER_BASE64 = PASTE + 'AppleRootCA_G3';
const APPLE_ROOT_CA_G2_DER_BASE64 = PASTE + 'AppleRootCA_G2';
const APPLE_ROOT_INC_DER_BASE64 = PASTE + 'AppleIncRootCertificate';
const APPLE_ROOT_COMPUTER_DER_BASE64 = PASTE + 'AppleComputerRootCertificate';
`;
const pasted = placeholder.replace(
  "PASTE + 'AppleRootCA_G3'",
  "'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS'",
);
const gatesOff = 'export const PAY_GATES_ENABLED = false as boolean;';
const gatesOn = 'export const PAY_GATES_ENABLED = true as boolean;';

describe('the Apple roots release check', () => {
  it('reads which roots are still placeholders', () => {
    expect(placeholderRoots(placeholder)).toHaveLength(4);
    expect(placeholderRoots(pasted)).not.toContain('APPLE_ROOT_CA_G3_DER_BASE64');
  });

  it('fails a build that can sell while AppleRootCA-G3 is a placeholder', () => {
    expect(appleRootsVerdict(placeholder, gatesOn, {}).verdict).toBe('fail');
    expect(appleRootsVerdict(placeholder, gatesOff, { OPENSHORE_STORE_RELEASE: '1' }).verdict).toBe(
      'fail',
    );
  });

  it('only warns while the pay gates are off, so TestFlight and CI stay green', () => {
    expect(appleRootsVerdict(placeholder, gatesOff, {}).verdict).toBe('warn');
  });

  it('passes once G3 is pasted, or kept in the function secrets', () => {
    expect(appleRootsVerdict(pasted, gatesOn, {}).verdict).toBe('ok');
    expect(appleRootsVerdict(placeholder, gatesOn, { APPLE_ROOTS_IN_SECRETS: '1' }).verdict).toBe(
      'ok',
    );
  });

  it('reads the real store switch and the real apple.ts shape', () => {
    const root = join(process.cwd(), '..');
    const store = readFileSync(join(root, 'app', 'src', 'state', 'store.ts'), 'utf8');
    expect(store).toMatch(/export const PAY_GATES_ENABLED = (true|false)\b/);
    expect(buildCanSell(gatesOn, {})).toBe(true);
    expect(buildCanSell(gatesOff, {})).toBe(false);
    // Every root constant the check looks for is still where apple.ts keeps it.
    const apple = readFileSync(join(root, 'supabase', 'functions', '_shared', 'apple.ts'), 'utf8');
    for (const name of [
      'APPLE_ROOT_CA_G3_DER_BASE64',
      'APPLE_ROOT_CA_G2_DER_BASE64',
      'APPLE_ROOT_INC_DER_BASE64',
      'APPLE_ROOT_COMPUTER_DER_BASE64',
    ]) {
      expect(apple).toMatch(new RegExp(`const ${name}\\s*=`));
    }
  });

  it('is run by the iOS workflow before it builds', () => {
    const yaml = readFileSync(join(process.cwd(), '..', 'codemagic.yaml'), 'utf8');
    const ios = yaml.slice(yaml.indexOf('ios-testflight:'), yaml.indexOf('mac-desktop:'));
    expect(ios).toContain('node app/scripts/check-apple-roots.mjs');
    expect(ios.indexOf('check-apple-roots')).toBeLessThan(ios.indexOf('npx cap sync ios'));
  });
});
