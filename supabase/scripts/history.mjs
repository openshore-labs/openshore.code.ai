// Production's migration history as the repo records it (CTO 11, 2026-09-29).
// Shared by replay-split.mjs, check-migrations.mjs and push-preflight.mjs.
// Node built-ins only, so every caller runs with no install. It reads files
// and git objects; it never connects to a database.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPABASE = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The repository root: supabase/ sits at its top level. */
export const ROOT = join(SUPABASE, '..');
export const MIGRATIONS = join(SUPABASE, 'migrations');
export const HISTORY = join(SUPABASE, 'production-history.tsv');
export const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** SHA-256 hex of a migration's bytes, with CRLF line ends read as LF. */
export function sha256(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[n++] = buf[i];
  }
  return createHash('sha256').update(out.subarray(0, n)).digest('hex');
}

/** The rows of production-history.tsv: { version, name, sha256, note, file }. */
export function parseHistory(text) {
  const rows = [];
  let header = false;
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (!header) {
      if (cols.slice(0, 3).join(',') !== 'version,name,sha256') {
        throw new Error(
          `production-history.tsv line ${i + 1}: expected the header version, name, sha256`,
        );
      }
      header = true;
      continue;
    }
    const [version, name, hash, note = ''] = cols;
    if (
      !/^\d{4}$/.test(version ?? '') ||
      !/^[a-z0-9_]+$/.test(name ?? '') ||
      !/^[0-9a-f]{64}$/.test(hash ?? '')
    ) {
      throw new Error(`production-history.tsv line ${i + 1}: not version, name, sha256: ${line}`);
    }
    rows.push({ version, name, sha256: hash, note, file: `${version}_${name}.sql` });
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].version <= rows[i - 1].version) {
      throw new Error(
        `production-history.tsv: ${rows[i].version} is not above ${rows[i - 1].version}`,
      );
    }
  }
  return rows;
}

export function readHistory(path = HISTORY) {
  return parseHistory(readFileSync(path, 'utf8'));
}

/** Migration file names in a folder, sorted. Anything else is ignored. */
export function migrationFiles(dir = MIGRATIONS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Every way the folder disagrees with the applied history. */
export function appliedProblems(history, dir = MIGRATIONS) {
  const problems = [];
  const files = migrationFiles(dir);
  for (const row of history) {
    const path = join(dir, row.file);
    if (!existsSync(path)) {
      const same = files.filter((f) => f.startsWith(`${row.version}_`));
      problems.push(
        same.length
          ? `${row.file} is applied in production, but the folder has ${same.join(', ')} under that number`
          : `${row.file} is applied in production and missing from the folder`,
      );
      continue;
    }
    const got = sha256(readFileSync(path));
    if (got !== row.sha256) {
      problems.push(
        `${row.file} differs from the bytes production ran (sha256 ${got}, pinned ${row.sha256})`,
      );
    }
  }
  return problems;
}

/** The files not in the history, in order: what the next push applies. */
export function pendingFiles(history, dir = MIGRATIONS) {
  const applied = new Set(history.map((r) => r.file));
  return migrationFiles(dir).filter((f) => !applied.has(f));
}

/** git at the repository root, so `ref:path` and ls-tree see the whole tree. */
export function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });
}
