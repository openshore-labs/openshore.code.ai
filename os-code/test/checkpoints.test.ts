// Undo (v1 Phase 1): a checkpoint before every task in a shadow git folder on
// this machine, outside the project. It must work in a folder with no git and
// in a repository without touching the project's own git, see files a shell
// command wrote, put back every file a task changed or just one, bring the
// task's versions back with Redo, and refuse anything outside the record.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShadowCheckpoints, checkpointDir } from '../src/core/checkpoints/shadowGit.js';
import { LocalDriver } from '../src/daemon/session.js';
import type { DriverEvent } from '../src/core/agent/types.js';
import { removeTempDir } from './helpers/portable.js';

let home: string;
let folder: string;
const priorHome = process.env.OSC_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-ckpt-home-'));
  folder = mkdtempSync(join(tmpdir(), 'osc-ckpt-work-'));
  process.env.OSC_HOME = home;
});

afterEach(async () => {
  if (priorHome === undefined) delete process.env.OSC_HOME;
  else process.env.OSC_HOME = priorHome;
  await removeTempDir(home);
  await removeTempDir(folder);
});

const read = (rel: string) => readFileSync(join(folder, rel), 'utf8');
const write = (rel: string, text: string) => {
  mkdirSync(join(folder, rel, '..'), { recursive: true });
  writeFileSync(join(folder, rel), text);
};

async function task(shadow: ShadowCheckpoints, work: () => void, sessionId = 's1') {
  const before = (await shadow.snapshot('before'))!;
  work();
  const after = (await shadow.snapshot('after'))!;
  return shadow.record(sessionId, before, after);
}

describe('checkpoints in a folder with no git', () => {
  it('records what a task added, changed, and removed, and undo puts it all back', async () => {
    write('index.html', '<h1>Old</h1>\n');
    write('notes.txt', 'keep me\n');
    write('old.css', 'body {}\n');
    const shadow = new ShadowCheckpoints(folder);
    const record = await task(shadow, () => {
      write('index.html', '<h1>New</h1>\n');
      write('script.js', 'console.log(1);\n');
      rmSync(join(folder, 'old.css'));
    });
    expect(record).toBeDefined();
    expect(record!.files.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'index.html', status: 'modified' },
      { path: 'old.css', status: 'deleted' },
      { path: 'script.js', status: 'added' },
    ]);
    // The store lives on this machine, outside the project.
    expect(checkpointDir(folder).startsWith(home)).toBe(true);
    expect(existsSync(join(folder, '.git'))).toBe(false);

    const undo = await shadow.restore(record!.id, 'undo');
    expect(undo).toEqual({
      ok: true,
      paths: expect.arrayContaining(['index.html', 'old.css', 'script.js']),
    });
    expect(read('index.html')).toBe('<h1>Old</h1>\n');
    expect(read('old.css')).toBe('body {}\n');
    expect(existsSync(join(folder, 'script.js'))).toBe(false);
    expect(read('notes.txt')).toBe('keep me\n');

    const redo = await shadow.restore(record!.id, 'redo');
    expect('ok' in redo).toBe(true);
    expect(read('index.html')).toBe('<h1>New</h1>\n');
    expect(read('script.js')).toBe('console.log(1);\n');
    expect(existsSync(join(folder, 'old.css'))).toBe(false);
  });

  it('undoes one file at a time, and says so when there is nothing left to undo', async () => {
    write('a.txt', 'a1\n');
    write('b.txt', 'b1\n');
    const shadow = new ShadowCheckpoints(folder);
    const record = (await task(shadow, () => {
      write('a.txt', 'a2\n');
      write('b.txt', 'b2\n');
    }))!;
    expect(await shadow.restore(record.id, 'undo', { path: 'a.txt' })).toEqual({
      ok: true,
      paths: ['a.txt'],
    });
    expect(read('a.txt')).toBe('a1\n');
    expect(read('b.txt')).toBe('b2\n');
    // The rest of the change undoes the remaining file only.
    expect(await shadow.restore(record.id, 'undo')).toEqual({ ok: true, paths: ['b.txt'] });
    expect(await shadow.restore(record.id, 'undo')).toEqual({ error: 'Already undone.' });
    expect(await shadow.restore(record.id, 'redo', { path: 'b.txt' })).toEqual({
      ok: true,
      paths: ['b.txt'],
    });
    expect(read('b.txt')).toBe('b2\n');
    expect(read('a.txt')).toBe('a1\n');
  });

  it('redo brings back what was there at undo time, even edits made after the task', async () => {
    write('page.html', 'v1\n');
    const shadow = new ShadowCheckpoints(folder);
    const record = (await task(shadow, () => write('page.html', 'v2 by the agent\n')))!;
    write('page.html', 'v3 by the person\n');
    await shadow.restore(record.id, 'undo');
    expect(read('page.html')).toBe('v1\n');
    await shadow.restore(record.id, 'redo');
    expect(read('page.html')).toBe('v3 by the person\n');
  });

  it('refuses a path outside the change, another session, and an unknown id', async () => {
    write('a.txt', 'a1\n');
    write('secret.txt', 'untouched\n');
    const shadow = new ShadowCheckpoints(folder);
    const record = (await task(shadow, () => write('a.txt', 'a2\n')))!;
    expect(await shadow.restore(record.id, 'undo', { path: 'secret.txt' })).toEqual({
      error: 'That file was not part of this change.',
    });
    expect(await shadow.restore(record.id, 'undo', { path: '../elsewhere.txt' })).toMatchObject({
      error: expect.any(String),
    });
    expect(await shadow.restore(record.id, 'undo', { sessionId: 'someone-else' })).toMatchObject({
      error: expect.stringMatching(/not on this computer/),
    });
    expect(await shadow.restore('nope', 'undo')).toMatchObject({ error: expect.any(String) });
    expect(read('a.txt')).toBe('a2\n');
  });

  it('records nothing when a task changed nothing', async () => {
    write('a.txt', 'same\n');
    const shadow = new ShadowCheckpoints(folder);
    expect(await task(shadow, () => {})).toBeUndefined();
    expect(shadow.list()).toEqual([]);
  });

  it('skips a folder past the file cap, and leaves out files too big to copy', async () => {
    for (let i = 0; i < 6; i++) write(`f${i}.txt`, `${i}\n`);
    const capped = new ShadowCheckpoints(folder, { maxFiles: 5 });
    expect(await capped.snapshot('before')).toBeUndefined();

    write('video.mov', 'x'.repeat(2048));
    const shadow = new ShadowCheckpoints(folder, { maxFileBytes: 1024 });
    const record = (await task(shadow, () => {
      write('video.mov', 'y'.repeat(4096));
      write('f0.txt', 'changed\n');
    }))!;
    expect(record.files.map((f) => f.path)).toEqual(['f0.txt']);
  });

  it('never snapshots its own store when the folder holds it', async () => {
    rmSync(home, { recursive: true, force: true });
    home = join(folder, '.os-code');
    process.env.OSC_HOME = home;
    write('a.txt', 'a1\n');
    const shadow = new ShadowCheckpoints(folder);
    const record = (await task(shadow, () => write('a.txt', 'a2\n')))!;
    expect(record.files).toEqual([{ path: 'a.txt', status: 'modified' }]);
  });
});

describe('checkpoints in a git repository', () => {
  it("never touches the project's own git", async () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: folder, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    write('app.js', 'let x = 1;\n');
    write('.gitignore', 'build/\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'start');
    const headBefore = git('rev-parse', 'HEAD');

    const shadow = new ShadowCheckpoints(folder);
    const record = (await task(shadow, () => {
      write('app.js', 'let x = 2;\n');
      write('build/out.js', 'ignored by the project\n');
    }))!;
    expect(record.files).toEqual([{ path: 'app.js', status: 'modified' }]);
    await shadow.restore(record.id, 'undo');
    expect(read('app.js')).toBe('let x = 1;\n');
    expect(git('rev-parse', 'HEAD')).toBe(headBefore);
    // The project's own status is exactly what the edit left (build/ is its
    // own ignore), and nothing of the shadow store shows up in it.
    expect(git('status', '--porcelain')).toBe('');
    expect(git('stash', 'list')).toBe('');
  });
});

describe('the session driver checkpoints each task', () => {
  it('emits a checkpoint after a task that changed files, and restores through the driver', async () => {
    write('index.html', 'before\n');
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    const events: DriverEvent[] = [];
    driver.onEvent((e) => events.push(e));
    // A stand-in agent: the task writes a file the way a shell command would.
    driver.attachAgent({
      run: async () => {
        writeFileSync(join(folder, 'index.html'), 'after\n');
        driver.emit({ type: 'task-done', reason: 'complete' });
      },
      generateTitle: async () => undefined,
      flushHandoff: () => undefined,
    } as never);
    driver.send('make the page');
    await waitFor(() => events.some((e) => e.type === 'checkpoint'));
    const checkpoint = events.find((e) => e.type === 'checkpoint') as Extract<
      DriverEvent,
      { type: 'checkpoint' }
    >;
    expect(checkpoint.files).toEqual([{ path: 'index.html', status: 'modified' }]);
    await waitFor(() => !driver.busy);

    const result = await driver.restoreCheckpoint(checkpoint.id, 'undo');
    expect(result).toEqual({ ok: true, paths: ['index.html'] });
    expect(read('index.html')).toBe('before\n');
    expect(events.at(-1)).toMatchObject({
      type: 'checkpoint-restored',
      id: checkpoint.id,
      direction: 'undo',
      paths: ['index.html'],
    });
  });

  it('refuses a restore while a task is running, and is off for a throwaway session', async () => {
    const driver = new LocalDriver(folder, { persist: false, checkpoints: true });
    let release: (() => void) | undefined;
    driver.attachAgent({
      run: () => new Promise<void>((r) => (release = r)),
      generateTitle: async () => undefined,
      flushHandoff: () => undefined,
    } as never);
    driver.send('long task');
    await waitFor(() => release !== undefined);
    expect(await driver.restoreCheckpoint('abc', 'undo')).toEqual({
      error: 'Wait for the current step to finish, then undo.',
    });
    release!();
    await waitFor(() => !driver.busy);
    const off = new LocalDriver(folder, { persist: false });
    expect(await off.restoreCheckpoint('abc', 'undo')).toEqual({
      error: 'Undo is not on for this session.',
    });
  });
});

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('the shadow store stays bounded', () => {
  it('lets aged-out records go and collects what they held; kept ones still undo', async () => {
    write('a.txt', 'v0\n');
    const shadow = new ShadowCheckpoints(folder, { keep: 2, gcEvery: 1, pruneAge: 'now' });
    const records = [];
    for (let i = 1; i <= 4; i++) {
      records.push((await task(shadow, () => write('a.txt', `v${i}\n`)))!);
    }
    expect(shadow.list().map((r) => r.id)).toEqual([records[2]!.id, records[3]!.id]);
    const gitDir = checkpointDir(folder);
    const refs = execFileSync('git', ['--git-dir', gitDir, 'for-each-ref', '--format=%(refname)'], {
      encoding: 'utf8',
    });
    expect(refs).not.toContain(records[0]!.id);
    expect(refs).toContain(records[3]!.id);
    // The oldest record's first snapshot is gone from the store.
    expect(() =>
      execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-e', records[0]!.before], {
        stdio: 'ignore',
      }),
    ).toThrow();
    expect(await shadow.restore(records[0]!.id, 'undo')).toMatchObject({
      error: expect.any(String),
    });
    expect(await shadow.restore(records[3]!.id, 'undo')).toEqual({ ok: true, paths: ['a.txt'] });
    expect(read('a.txt')).toBe('v3\n');
    expect(await shadow.restore(records[3]!.id, 'redo')).toEqual({ ok: true, paths: ['a.txt'] });
    expect(read('a.txt')).toBe('v4\n');
  });
});
