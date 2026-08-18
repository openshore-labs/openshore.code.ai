// Post-apply verification. After a write lands, re-read the file, confirm it
// is byte-for-byte what the engine produced, and (when configured) run a
// cheap structural check. A verification failure reverts nothing by itself;
// it reports precisely so the caller can decide.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface VerifyResult {
  ok: boolean;
  detail: string;
}

export function verifyWritten(path: string, expected: string): VerifyResult {
  let actual: string;
  try {
    actual = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, detail: `Could not re-read ${path} after writing: ${(err as Error).message}` };
  }
  if (sha(actual) !== sha(expected)) {
    return {
      ok: false,
      detail: `${path} on disk does not match what the edit engine produced. Something else changed the file mid-edit; re-read it before editing again.`,
    };
  }
  return { ok: true, detail: 'File on disk matches the applied edit.' };
}

/**
 * Optional structural check after an edit, e.g. a linter or `tsc --noEmit` on
 * the touched file. Cheap syntax-level checks for common languages are built
 * in; anything richer comes from config (edit.verifyCommand).
 */
export function structuralCheck(path: string, content: string): VerifyResult {
  if (/\.(json)$/.test(path)) {
    try {
      JSON.parse(content);
      return { ok: true, detail: 'JSON parses.' };
    } catch (err) {
      return { ok: false, detail: `The edited JSON no longer parses: ${(err as Error).message}` };
    }
  }
  if (/\.(mjs|cjs|js)$/.test(path)) {
    const res = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', timeout: 10_000 });
    if (res.status === 0) return { ok: true, detail: 'JavaScript syntax check passed.' };
    return { ok: false, detail: `Syntax check failed: ${(res.stderr || res.stdout).trim().slice(0, 400)}` };
  }
  // Balanced-brace sanity for brace languages; heuristic on purpose, cheap on purpose.
  if (/\.(ts|tsx|jsx|c|h|cpp|hpp|java|go|rs|swift|kt|scala|css)$/.test(path)) {
    const balance = braceBalance(content);
    if (balance !== 0) {
      return {
        ok: false,
        detail: `Braces look unbalanced after the edit (${balance > 0 ? balance + ' unclosed {' : -balance + ' extra }'}). Re-read the file and fix the block boundaries.`,
      };
    }
    return { ok: true, detail: 'Brace balance holds.' };
  }
  return { ok: true, detail: 'No structural check for this file type.' };
}

function braceBalance(content: string): number {
  // Strip strings and comments well enough for a balance count.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
