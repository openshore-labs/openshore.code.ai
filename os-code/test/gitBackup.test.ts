// Backups are the headline gitOS differentiator: because the repo already lives
// on storage the user owns, a second copy is near-free. These prove the two
// backup shapes against real git in throwaway repos: a full binary mirror to a
// second local path (incremental after the first run), and a single-file bundle
// for a files-only destination. The bar is "restore this and history is intact."
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { mirrorRepo, bundleRepo, currentBranch } from '../src/git/index.js';

let repo: string;
let scratch: string;

async function commit(file: string, body: string, message: string): Promise<void> {
  writeFileSync(join(repo, file), body);
  const g = simpleGit(repo);
  await g.add([file]);
  await g.commit(message);
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'oscbak-repo-'));
  scratch = mkdtempSync(join(tmpdir(), 'oscbak-scratch-'));
  const g = simpleGit(repo);
  await g.init(['--initial-branch=main']);
  await g.addConfig('user.email', 'dev@test.local');
  await g.addConfig('user.name', 'Dev');
  await g.addConfig('commit.gpgsign', 'false');
  await commit('README.md', '# repo\n', 'init');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('currentBranch', () => {
  it('reads the checked-out branch', async () => {
    expect(await currentBranch(repo)).toBe('main');
  });
});

describe('mirrorRepo', () => {
  it('mirrors every commit to a second local path and restores intact', async () => {
    const dest = join(scratch, 'mirror.git');
    await mirrorRepo(repo, dest);
    expect(existsSync(dest)).toBe(true);

    // A mirror can be cloned back, and the restored repo carries the history.
    const restored = join(scratch, 'restored');
    await simpleGit().clone(dest, restored);
    const log = await simpleGit(restored).log();
    expect(log.all.map((e) => e.message)).toContain('init');
  });

  it('is incremental: a later commit reaches the existing mirror', async () => {
    const dest = join(scratch, 'mirror.git');
    await mirrorRepo(repo, dest);
    await commit('two.txt', 'second\n', 'second commit');

    // Re-running updates the same mirror rather than re-cloning.
    await mirrorRepo(repo, dest);
    const restored = join(scratch, 'restored');
    await simpleGit().clone(dest, restored);
    const messages = (await simpleGit(restored).log()).all.map((e) => e.message);
    expect(messages).toContain('second commit');
  });
});

describe('bundleRepo', () => {
  it('writes a single-file bundle that clones back with full history', async () => {
    await commit('two.txt', 'second\n', 'second commit');
    const bundle = join(scratch, 'backup.bundle');
    await bundleRepo(repo, bundle);
    expect(existsSync(bundle)).toBe(true);

    const restored = join(scratch, 'from-bundle');
    await simpleGit().clone(bundle, restored);
    const messages = (await simpleGit(restored).log()).all.map((e) => e.message);
    expect(messages).toContain('init');
    expect(messages).toContain('second commit');
  });
});
