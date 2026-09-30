// supabase/scripts/check-migrations.mjs, the branch guard .github/workflows/
// migrations.yml runs on every push that touches supabase/ (CTO 11). Two
// shapes once passed it (review 2026-09-30): a tree that deleted a file
// production applied, and a byte-for-byte copy of one of main's unapplied
// files under a new number beside the original (the "moved above
// production's newest" relief fired for a copy, not only for a move). Here
// the script runs for real against a scratch git repository with a main of
// three files, two of them applied, and the tree changed one way at a time.
// On a push to main it scans the other branches (--scan-remotes, warnings
// only), where a branch cut before main took production's files is one line
// for (d), "behind main", not one per file (second review, 2026-09-30).
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

function check(...extra: string[]) {
  const res = spawnSync(
    process.execPath,
    [join(root, 'supabase', 'scripts', 'check-migrations.mjs'), ...extra, '--against', 'main'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } },
  );
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const commit = (message: string) =>
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', message);

/** A remote branch (refs/remotes/origin/<name>) whose tree is main's changed
 *  by `change`; the working tree is main's again afterwards. */
function remoteBranch(name: string, change: () => void) {
  git('checkout', '-q', '-b', name);
  change();
  git('add', '-A');
  commit(name);
  git('update-ref', `refs/remotes/origin/${name}`, 'HEAD');
  git('checkout', '-q', 'main');
  git('branch', '-q', '-D', name);
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
  commit('main');
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

describe('check-migrations.mjs --scan-remotes (a push to main, warnings only)', () => {
  afterEach(() => {
    for (const ref of git('for-each-ref', '--format=%(refname)', 'refs/remotes/origin/')
      .split('\n')
      .filter(Boolean)) {
      git('update-ref', '-d', ref);
    }
  });

  it('says a branch missing applied files is behind main, in one line, and never fails', () => {
    remoteBranch('stale', () => {
      rmSync(join(migrations, '0001_first.sql'));
      rmSync(join(migrations, '0002_second.sql'));
    });
    const { code, out } = check('--scan-remotes');
    expect(code).toBe(0);
    const warnings = out.split('\n').filter((l) => l.startsWith('::warning'));
    expect(warnings).toEqual([
      '::warning title=Migration number on origin/stale::(d) behind main; merge main before touching supabase/ (2 files production applied are missing here)',
    ]);
    expect(out).not.toContain('(d) 0001_first.sql');
    expect(out).not.toContain('(d) 0002_second.sql');
  });

  it('keeps every other problem on its own line beside the one behind-main line', () => {
    remoteBranch('mixed', () => {
      rmSync(join(migrations, '0002_second.sql'));
      writeFileSync(join(migrations, '0003_other.sql'), 'create table public.other (id int);\n');
    });
    const { code, out } = check('--scan-remotes');
    expect(code).toBe(0);
    const warnings = out.split('\n').filter((l) => l.startsWith('::warning'));
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain(
      '(d) behind main; merge main before touching supabase/ (1 file production applied is missing here)',
    );
    expect(out).toContain('(a) 0003_other.sql: main uses 0003 for 0003_third.sql');
    expect(out).toContain('(c) 0003_other.sql');
  });

  it('lists nothing for a branch that agrees with main', () => {
    remoteBranch('fine', () => {
      writeFileSync(join(migrations, '0004_new.sql'), 'create table public.fourth (id int);\n');
    });
    const { code, out } = check('--scan-remotes');
    expect(code).toBe(0);
    expect(out).not.toContain('::warning');
    expect(out).toContain('No branch collides with main or production.');
  });
});
