// EM DASH POLICY GUARD, app edition. OpenShore standing rule: no em dash in
// anything a user reads. Total scan of the app package (the codebase was born
// under the rule), comments and test files included. The repo-wide guard in
// os-code/test/em-dash-policy.test.ts covers this package too; this thin copy
// exists so a drift here fails the app's own suite. The only file skipped is
// this one, which has to spell the dash to look for it.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.cjs',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.md',
  '.swift',
  '.yml',
  '.yaml',
  '.toml',
]);
const EM_DASH = '—';
const ENCODED = /&mdash;|&#8212;|&#x2014;|&#151;|\\u2014|\\u\{2014\}/gi;
const SELF = 'test/em-dash-policy.test.ts';

// Tracked files plus untracked ones git would accept, so a dash in a file that
// has not been staged yet fails here rather than after the commit. A path still
// in the index but gone from the working tree is skipped.
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((f) => EXTENSIONS.has(extname(f)))
    .filter((f) => f !== SELF && !f.startsWith('ios/App/App/public/'))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

describe('em dash policy (app)', () => {
  it('no em dash or encoded spelling anywhere in tracked app source', () => {
    const violations: string[] = [];
    for (const file of trackedFiles()) {
      const text = readFileSync(resolve(ROOT, file), 'utf8').replace(ENCODED, EM_DASH);
      if (!text.includes(EM_DASH)) continue;
      text.split('\n').forEach((line, i) => {
        if (line.includes(EM_DASH))
          violations.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      violations,
      `Em dashes found. Use a period, a comma, or a rewrite:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('scans test files too (only the guard itself is skipped)', () => {
    const files = trackedFiles();
    expect(files).not.toContain(SELF);
    expect(files.some((f) => f.startsWith('test/') && f.endsWith('.test.ts'))).toBe(true);
  });
});
