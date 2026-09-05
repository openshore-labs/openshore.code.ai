// Shared workspace walker for the grep and glob tools. Skips the directories
// that are never interesting (VCS metadata, dependencies, build output) and
// respects a size cap so pathological repos stay fast.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
]);

export function* walkFiles(root: string, maxFiles = 20_000): Generator<string> {
  const stack: string[] = [root];
  let count = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        // Exact names only: `.git` is metadata, `.github` is where CI lives.
        if (!SKIP_DIRS.has(entry)) stack.push(full);
      } else if (stat.isFile()) {
        if (++count > maxFiles) return;
        yield relative(root, full);
      }
    }
  }
}
