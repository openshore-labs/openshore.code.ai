// The agent's git tools against a real repository: a commit from a workspace
// that is a subdirectory of the repo stages only that workspace, and an
// explicit path that leaves the jail is refused, never handed to git.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { gitCommitTool } from '../src/core/tools/git.js';
import { Jail } from '../src/core/security/jail.js';
import { EgressPolicy } from '../src/core/security/egress.js';
import type { ToolContext } from '../src/core/tools/index.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A repo with a committed root file and a committed pkg/ file, both dirty. */
function dirtyRepo(): { root: string; pkg: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'osc-git-')));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  const pkg = join(root, 'pkg');
  mkdirSync(pkg);
  writeFileSync(join(root, 'root.txt'), 'root v1\n');
  writeFileSync(join(pkg, 'file.txt'), 'pkg v1\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  writeFileSync(join(root, 'root.txt'), 'root v2\n');
  writeFileSync(join(pkg, 'file.txt'), 'pkg v2\n');
  return { root, pkg };
}

function contextFor(cwd: string): ToolContext {
  const config = ConfigSchema.parse({
    stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
  });
  return { cwd, jail: new Jail(cwd), egress: new EgressPolicy(config.egress), config };
}

describe('gitCommit (ENG-8)', () => {
  it('with no paths stages only the workspace, not the whole repository', async () => {
    const { root, pkg } = dirtyRepo();
    const result = await gitCommitTool.execute({ message: 'pkg change' }, contextFor(pkg));
    expect(result.ok).toBe(true);
    // The pkg file is committed; the root file is still modified.
    const status = git(root, 'status', '--porcelain');
    expect(status).toContain('root.txt');
    expect(status).not.toContain('pkg/file.txt');
  });

  it('refuses an explicit path that leaves the workspace', async () => {
    const { root, pkg } = dirtyRepo();
    const result = await gitCommitTool.execute(
      { message: 'sneaky', paths: ['../root.txt'] },
      contextFor(pkg),
    );
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/workspace/i);
    // Nothing was staged or committed.
    const status = git(root, 'status', '--porcelain');
    expect(status).toContain('root.txt');
    expect(git(root, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
  });

  it('stages an explicit in-workspace path', async () => {
    const { root, pkg } = dirtyRepo();
    const result = await gitCommitTool.execute(
      { message: 'one file', paths: ['file.txt'] },
      contextFor(pkg),
    );
    expect(result.ok).toBe(true);
    const status = git(root, 'status', '--porcelain');
    expect(status).toContain('root.txt');
    expect(status).not.toContain('pkg/file.txt');
  });
});
