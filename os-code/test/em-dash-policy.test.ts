// EM DASH POLICY GUARD. OpenShore standing rule: no em dash in anything a
// user reads. A period, a comma, or a rewrite. This repo enforces it the way
// the Uki repos do: the rule polices itself instead of relying on memory.
//
// Because OS Code started life under the rule, the scan is TOTAL: no em dash
// anywhere in tracked source, comments included, so nothing can drift from a
// comment into copy. Encoded spellings count too; they burned the marketing
// site once (&mdash; rendered as a dash while a character search saw
// nothing). Exemptions carry a reason, and the scanner never loosens.
//
// Scope is the WHOLE repository, not this package: ROOT is the git toplevel,
// so root docs, `docs/`, `supabase/`, `.github/`, `codemagic.yaml`, and the app
// package are all read from here. Test files are scanned too (the rule says
// "comments included", and a test comment is a comment). The only files the
// scan skips are the two guard files themselves, which have to spell the dash
// to look for it. The app package keeps its own thin guard so a drift there
// fails that package's suite as well as this one.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: HERE,
  encoding: 'utf8',
}).trim();

const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.cjs',
  '.mjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.sql',
  '.swift',
  '.html',
  '.css',
  '.toml',
]);

const EM_DASH = '—';
const ENCODED = /&mdash;|&#8212;|&#x2014;|&#151;|\\u2014|\\u\{2014\}/gi;

// The guards define the dash in order to find it. Nothing else is skipped by
// name; everything else goes through EXEMPT_FILES with a reason.
const GUARD_FILES = new Set([
  'os-code/test/em-dash-policy.test.ts',
  'app/test/em-dash-policy.test.ts',
]);

// Every exemption is a decision with a reason, never a reflex.
const EXEMPT_FILES = new Map<string, string>([
  [
    'docs/archive/CODE-REVIEW-FINDINGS.md',
    'historical review record, archived verbatim (2026-08-20 review, fully addressed)',
  ],
]);

function normalize(text: string): string {
  return text.replace(ENCODED, EM_DASH);
}

// Tracked files plus untracked ones git would accept (`--others
// --exclude-standard`), so a dash in a file that has not been staged yet fails
// here rather than after the commit. A path still in the index but deleted or
// moved in the working tree is skipped: there is nothing to read.
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((f) => EXTENSIONS.has(extname(f)))
    .filter((f) => !GUARD_FILES.has(f))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

describe('em dash policy', () => {
  it('no em dash (or encoded spelling) appears anywhere in the tracked repository', () => {
    const violations: string[] = [];
    for (const file of trackedFiles()) {
      if (EXEMPT_FILES.has(file)) continue;
      const text = normalize(readFileSync(resolve(ROOT, file), 'utf8'));
      if (!text.includes(EM_DASH)) continue;
      text.split('\n').forEach((line, i) => {
        if (line.includes(EM_DASH))
          violations.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(
      violations,
      `Em dashes found. Use a period, a comma, or a rewrite:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('the scan reaches beyond this package (root docs, workflows, the app)', () => {
    const files = trackedFiles();
    expect(files).toContain('README.md');
    expect(files).toContain('.github/workflows/ci.yml');
    expect(files).toContain('codemagic.yaml');
    expect(files.some((f) => f.startsWith('app/src/'))).toBe(true);
    expect(files.some((f) => f.startsWith('supabase/migrations/'))).toBe(true);
  });

  it('the agent system prompt states the rule outright (generated replies mirror their prompt)', () => {
    const loop = readFileSync(resolve(ROOT, 'os-code/src/core/agent/loop.ts'), 'utf8');
    expect(loop).toMatch(/Never use em dashes/);
  });

  it('exemptions carry reasons and name files that exist', () => {
    for (const [file, reason] of EXEMPT_FILES) {
      expect(reason.length, `${file} is exempt without a reason`).toBeGreaterThan(10);
      expect(
        existsSync(resolve(ROOT, file)),
        `${file} is exempt but does not exist; drop the stale entry`,
      ).toBe(true);
    }
  });
});
