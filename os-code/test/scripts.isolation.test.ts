// SCRIPTS ISOLATION GUARD. The catalog builder under scripts/ runs in CI only
// and must NEVER reach the shipped client. This test fails on any import of a
// scripts/ path from src/ or from the protocol surface, mirroring the drift
// guards in connectorMap.test.ts. The dependency arrow points one way only:
// scripts/ may import from src/, never the reverse.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'src/', 'bin/'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
}

// Any import specifier that reaches into the scripts/ tree.
const SCRIPTS_IMPORT = /from\s+['"][^'"]*\bscripts\//;

describe('scripts isolation', () => {
  it('no file under src/ or bin/ imports from scripts/', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      text.split('\n').forEach((line, i) => {
        if (SCRIPTS_IMPORT.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `The builder under scripts/ is CI-only and must never ship in the client. Remove these imports:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the protocol surface (the client entry) does not import from scripts/', () => {
    const protocol = readFileSync(resolve(ROOT, 'src/protocol.ts'), 'utf8');
    expect(SCRIPTS_IMPORT.test(protocol)).toBe(false);
  });
});
