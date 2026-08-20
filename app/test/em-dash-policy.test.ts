// EM DASH POLICY GUARD, app edition. OpenShore standing rule: no em dash in
// anything a user reads. Total scan of app source (the codebase was born
// under the rule); test files excluded so the guard can define the dash.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html', '.json', '.md', '.swift']);
const EM_DASH = '—';
const ENCODED = /&mdash;|&#8212;|&#x2014;|\\u2014/gi;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => EXTENSIONS.has(extname(f)))
    .filter((f) => !f.includes('.test.') && !f.startsWith('ios/App/App/public/'));
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
});
