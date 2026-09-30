// repo-info events leave in the order they were asked for. The first one (as
// the agent attaches) carries the person's command list; a later one carries
// only the branch chip. Each reads git first, and when the first read was the
// slower one the later event used to go out first, so the list arrived second
// or, on a loaded CI runner, after the task had started
// (customCommands.test.ts, "says the commands and what was left out").
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalDriver, type DriverEvent } from '../src/daemon/session.js';
import { removeTempDir } from './helpers/portable.js';

// Each checkIsRepo waits until the test answers it (true, or an error), so the
// order git answers in is the test's to choose.
const gates: Array<(answer: true | Error) => void> = [];
vi.mock('simple-git', () => ({
  simpleGit: () => ({
    checkIsRepo: () =>
      new Promise<boolean>((resolve, reject) =>
        gates.push((answer) => (answer === true ? resolve(true) : reject(answer))),
      ),
    status: async () => ({ current: 'main', isClean: () => true }),
  }),
}));

let work: string;

beforeEach(() => {
  gates.length = 0;
  work = mkdtempSync(join(tmpdir(), 'osc-repoinfo-'));
  mkdirSync(join(work, '.claude/commands'), { recursive: true });
  writeFileSync(join(work, '.claude/commands/review.md'), 'Review it.');
});

afterEach(async () => {
  await removeTempDir(work);
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('repo-info order', () => {
  it('says the first call first, even when its git read answers last', async () => {
    const driver = new LocalDriver(work, { persist: false, checkpoints: false });
    const events: DriverEvent[] = [];
    driver.onEvent((e) => events.push(e));
    const first = driver.emitRepoInfo();
    const second = driver.emitRepoInfo();
    await flush();
    expect(gates).toHaveLength(2);
    // The second read answers first: nothing may go out ahead of the first.
    gates[1]!(true);
    await flush();
    expect(events.filter((e) => e.type === 'repo-info')).toHaveLength(0);
    gates[0]!(true);
    await Promise.all([first, second]);
    const infos = events.filter(
      (e): e is Extract<DriverEvent, { type: 'repo-info' }> => e.type === 'repo-info',
    );
    expect(infos).toHaveLength(2);
    expect(infos[0]!.commands?.map((c) => c.name)).toContain('review');
    expect(infos[0]!.branch).toBe('main');
    expect(infos[1]!.commands).toBeUndefined();
    expect(infos[1]!.branch).toBe('main');
  });

  it('a read that fails still speaks in its turn, the cwd alone', async () => {
    const driver = new LocalDriver(work, { persist: false, checkpoints: false });
    const events: DriverEvent[] = [];
    driver.onEvent((e) => events.push(e));
    const first = driver.emitRepoInfo();
    const second = driver.emitRepoInfo();
    await flush();
    gates[1]!(true);
    gates[0]!(new Error('git is gone'));
    await Promise.all([first, second]);
    const infos = events.filter(
      (e): e is Extract<DriverEvent, { type: 'repo-info' }> => e.type === 'repo-info',
    );
    expect(infos).toHaveLength(2);
    expect(infos[0]!.branch).toBeUndefined();
    expect(infos[0]!.commands?.map((c) => c.name)).toContain('review');
    expect(infos[1]!.branch).toBe('main');
  });
});
