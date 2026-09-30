// supabase/scripts/check-migrations.mjs, the branch guard .github/workflows/
// migrations.yml runs on every push that touches supabase/ (CTO 11). Two
// shapes once passed it (review 2026-09-30): a tree that deleted a file
// production applied, and a byte-for-byte copy of one of main's unapplied
// files under a new number beside the original (the "moved above
// production's newest" relief fired for a copy, not only for a move). Here
// the script runs for real against a scratch git repository with a main of
// three files, two of them applied, and the tree changed one way at a time.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const SCRIPTS = join(process.cwd(), '..', 'supabase', 'scripts');
const FILES: Record<string, string> = {
  '0001_first.sql': 'create table public.first (id int);\n',
  '0002_second.sql': 'create table public.second (id int);\n',
  '0003_third.sql': 'create table public.third (id int);\n',
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

let root: string;
let migrations: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function check() {
  const res = spawnSync(
    process.execPath,
    [join(root, 'supabase', 'scripts', 'check-migrations.mjs'), '--against', 'main'],
    { cwd: root, encoding: 'utf8' },
  );
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-migrations-'));
  mkdirSync(join(root, 'supabase', 'scripts'), { recursive: true });
  for (const f of readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'))) {
    copyFileSync(join(SCRIPTS, f), join(root, 'supabase', 'scripts', f));
  }
  migrations = join(root, 'supabase', 'migrations');
  mkdirSync(migrations);
  for (const [f, text] of Object.entries(FILES)) writeFileSync(join(migrations, f), text);
  writeFileSync(
    join(root, 'supabase', 'production-history.tsv'),
    'version\tname\tsha256\n' +
      `0001\tfirst\t${sha(FILES['0001_first.sql'])}\n` +
      `0002\tsecond\t${sha(FILES['0002_second.sql'])}\n`,
  );
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'main');
});

afterEach(() => {
  // Back to main's tree between cases.
  git('checkout', '-q', '--', '.');
  git('clean', '-q', '-fd', 'supabase/migrations');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-migrations.mjs', () => {
  it("passes main's own tree", () => {
    expect(check().code).toBe(0);
  });

  it('fails a tree that deleted a file production applied', () => {
    rmSync(join(migrations, '0002_second.sql'));
    const { code, out } = check();
    expect(code).toBe(1);
    expect(out).toContain('(d) 0002_second.sql');
  });

  it('fails a copy of an unapplied file under a new number beside the original', () => {
    copyFileSync(join(migrations, '0003_third.sql'), join(migrations, '0004_copy.sql'));
    const { code, out } = check();
    expect(code).toBe(1);
    expect(out).toContain('0004_copy.sql: a copy of 0003_third.sql');
  });

  it('still passes a real move of an unapplied file above production and main', () => {
    renameSync(join(migrations, '0003_third.sql'), join(migrations, '0004_third.sql'));
    expect(check().code).toBe(0);
  });

  it('still passes a new file above the newest taken number', () => {
    writeFileSync(join(migrations, '0004_new.sql'), 'create table public.fourth (id int);\n');
    expect(check().code).toBe(0);
  });

  it('still fails an edited applied file', () => {
    writeFileSync(join(migrations, '0001_first.sql'), 'create table public.first (id bigint);\n');
    const { code, out } = check();
    expect(code).toBe(1);
    expect(out).toContain('(b) 0001_first.sql');
  });
});
