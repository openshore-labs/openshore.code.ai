// CONNECTOR MANIFEST GUARD. src/server/connectorMap.ts is the single source
// of truth for every cloud connector and where each secret lives. This test
// fails on drift: a secret-ish env var read anywhere in src/ that the
// manifest does not declare, a store key the manifest does not know, or a
// public projection that leaks more than nicknames.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONNECTORS,
  declaredEnvVars,
  declaredStoreKeys,
  publicProjection,
} from '../src/server/connectorMap.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

// Env vars that are configuration, not secrets; they live in the config
// schema (search.braveKeyEnv etc.) or the harness, not the manifest.
const NON_SECRET_ENV = new Set(['OSC_HOME', 'OSC_LOG_LEVEL', 'NO_COLOR', 'TERM']);

function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'src/', 'bin/'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
}

function envReadsInSource(): Set<string> {
  const reads = new Set<string>();
  const pattern = /process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g;
  for (const file of sourceFiles()) {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    for (const m of text.matchAll(pattern)) {
      const name = m[1] ?? m[2];
      if (name) reads.add(name);
    }
  }
  return reads;
}

describe('connector manifest', () => {
  it('every secret-ish env var read in src/ is declared in the manifest', () => {
    const declared = new Set(declaredEnvVars());
    const undeclared = [...envReadsInSource()].filter(
      (name) =>
        /KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD/.test(name) &&
        !NON_SECRET_ENV.has(name) &&
        !declared.has(name),
    );
    expect(
      undeclared,
      `These env vars look like secrets but are not in connectorMap.ts. Declare them (with homes and consumers) before they ship:\n${undeclared.join('\n')}`,
    ).toEqual([]);
  });

  it('every declared env var is actually read somewhere (no dead manifest rows)', () => {
    const reads = envReadsInSource();
    // Search-backend keys are read via config indirection (search.braveKeyEnv
    // names the var), so check for their default names in the config schema.
    const schema = readFileSync(resolve(ROOT, 'src/config/schema.ts'), 'utf8');
    const stale = declaredEnvVars().filter(
      (name) => !reads.has(name) && !schema.includes(`'${name}'`),
    );
    expect(stale, `Declared in connectorMap.ts but read nowhere: ${stale.join(', ')}`).toEqual([]);
  });

  it('every credential-store key used by auth is declared', () => {
    const declared = new Set(declaredStoreKeys());
    const authFiles = ['src/auth/claude.ts', 'src/auth/github.ts'];
    const used = new Set<string>();
    for (const file of authFiles) {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      for (const m of text.matchAll(/(?:KEY_NAME|TOKEN_NAME)\s*=\s*'([^']+)'/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) {
      expect(
        declared.has(key),
        `Store key "${key}" is used by auth but not declared in connectorMap.ts`,
      ).toBe(true);
    }
  });

  it('the public projection renders nicknames only, never secret names or homes', () => {
    const projection = JSON.stringify(publicProjection());
    expect(projection).not.toMatch(/ANTHROPIC_API_KEY|GITHUB_TOKEN|BRAVE_API_KEY|TAVILY_API_KEY/);
    expect(projection).not.toMatch(/credential-store|daemon\.token|license\.json/);
  });

  it('every connector names at least one consumer', () => {
    for (const connector of CONNECTORS) {
      expect(connector.consumers.length, `${connector.id} lists no consumers`).toBeGreaterThan(0);
    }
  });
});
