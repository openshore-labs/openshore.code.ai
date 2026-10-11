// Deny rules judge a path as the disk stores it (security open item,
// 2026-10-11). On a case-insensitive disk (macOS, Windows) the native
// realpath returns the stored name, so `Secrets/k` is judged as
// `secrets/k` and a `secrets/**` rule still holds. On a case-sensitive disk
// the two are different files and there is nothing to test.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realRelativePath } from '../src/core/security/jail.js';

const probe = realpathSync(mkdtempSync(join(tmpdir(), 'osc-case-')));
writeFileSync(join(probe, 'lower'), '');
const caseInsensitive = existsSync(join(probe, 'LOWER'));

describe('the jail judges the stored name', () => {
  it.skipIf(!caseInsensitive)('reads Secrets/k as secrets/k on a case-insensitive disk', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'osc-jail-')));
    mkdirSync(join(root, 'secrets'));
    writeFileSync(join(root, 'secrets', 'k'), 'x');
    expect(realRelativePath(join(root, 'Secrets', 'k'), root)).toBe('secrets/k');
  });

  it('keeps the spelling of a path that is stored as written', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'osc-jail-')));
    mkdirSync(join(root, 'src'));
    expect(realRelativePath(join(root, 'src', 'new.ts'), root)).toBe('src/new.ts');
  });
});
