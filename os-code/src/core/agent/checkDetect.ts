// Finding a project's own check when none is configured (v1 Phase 1,
// "detect the project's check automatically"). Whatever is found here is the
// repository's own code, so it never runs on being found: the loop asks the
// person once, and "always" becomes a verify grant on this machine keyed by
// the folder, the command, and a digest of what the command runs, so a
// changed test script asks again (see config/trust.ts).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedCheck {
  command: string;
  /** Digest of the command and what it runs (the script body, the Makefile),
   *  so a grant covers exactly this and nothing a later pull swaps in. */
  digest: string;
  /** Where it came from, in plain words for the approval card. */
  source: string;
}

// npm's placeholder for "no tests yet".
const NPM_PLACEHOLDER = /no test specified/i;

function digestOf(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${part}\n`);
  return `sha256:${hash.digest('hex')}`;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** The digest a configured command's grant is keyed by. */
export function commandDigest(command: string): string {
  return digestOf(command);
}

/** The project's own check, or undefined when it has none this knows. */
export function detectCheckCommand(cwd: string): DetectedCheck | undefined {
  const pkgText = readText(join(cwd, 'package.json'));
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { scripts?: Record<string, unknown> };
      const test = pkg.scripts?.test;
      if (typeof test === 'string' && test.trim() && !NPM_PLACEHOLDER.test(test)) {
        const runner = existsSync(join(cwd, 'pnpm-lock.yaml'))
          ? 'pnpm'
          : existsSync(join(cwd, 'yarn.lock'))
            ? 'yarn'
            : existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))
              ? 'bun run'
              : 'npm';
        const command = `${runner} test`;
        return {
          command,
          digest: digestOf(command, test),
          source: 'the test script in package.json',
        };
      }
    } catch {
      // A package.json that does not parse offers no check.
    }
  }
  const makefile = readText(join(cwd, 'Makefile'));
  if (makefile && /^test\s*:/m.test(makefile)) {
    return {
      command: 'make test',
      digest: digestOf('make test', makefile),
      source: 'the test target in the Makefile',
    };
  }
  const pyproject = readText(join(cwd, 'pyproject.toml')) ?? '';
  const pytestIni = readText(join(cwd, 'pytest.ini'));
  if (pytestIni !== undefined || /\[tool\.pytest/.test(pyproject)) {
    const command = 'python3 -m pytest -q';
    return {
      command,
      digest: digestOf(command, pytestIni ?? '', pyproject),
      source: 'the pytest settings in this project',
    };
  }
  return undefined;
}
