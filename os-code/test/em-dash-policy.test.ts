// EM DASH POLICY GUARD. OpenShore standing rule: no em dash in anything a
// user reads. A period, a comma, or a rewrite. This repo enforces it the way
// the Uki repos do: the rule polices itself instead of relying on memory.
//
// Because OS Code started life under the rule, the scan is TOTAL: no em dash
// anywhere in tracked source, comments included, so nothing can drift from a
// comment into copy. Encoded spellings count too; they burned the marketing
// site once (&mdash; rendered as a dash while a character search saw
// nothing). Exemptions carry a reason, and the scanner never loosens.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.json', '.md']);

const EM_DASH = '—';
const ENCODED = /&mdash;|&#8212;|&#x2014;|&#151;|\\u2014|\\u\{2014\}/gi;

// Every exemption is a decision with a reason, never a reflex.
const EXEMPT_FILES = new Map<string, string>([]);

function normalize(text: string): string {
  return text.replace(ENCODED, EM_DASH);
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => EXTENSIONS.has(extname(f)));
}

describe('em dash policy', () => {
  it('no em dash (or encoded spelling) appears anywhere in tracked source', () => {
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

  it('the agent system prompt states the rule outright (generated replies mirror their prompt)', () => {
    const loop = readFileSync(resolve(ROOT, 'src/core/agent/loop.ts'), 'utf8');
    expect(loop).toMatch(/Never use em dashes/);
  });

  it('exemptions carry reasons', () => {
    for (const [file, reason] of EXEMPT_FILES) {
      expect(reason.length, `${file} is exempt without a reason`).toBeGreaterThan(10);
    }
  });
});
