// UI-3: the phone-to-hub install poll must exit on its own. Both exits are
// pinned: a cancelled signal (the screen left) and a hub that stops answering.
import { describe, expect, it } from 'vitest';
import { pollInstall } from '../src/drivers/installPoll.js';
import type { DaemonInstallProgress } from '../src/drivers/remoteDriver.js';

const noSleep = async () => {};

describe('pollInstall', () => {
  it('reports progress until the desktop says done', async () => {
    const frames: Array<DaemonInstallProgress | undefined> = [
      { line: 'pulling', percent: 10, done: false },
      { line: 'pulling', percent: 60, done: false },
      { line: 'ok', done: true, ok: true, detail: 'Installed.' },
    ];
    const seen: number[] = [];
    const outcome = await pollInstall(
      async () => frames.shift(),
      (p) => seen.push(p.percent ?? -1),
      noSleep,
    );
    expect(seen).toEqual([10, 60]);
    expect(outcome).toEqual({ kind: 'done', ok: true, detail: 'Installed.' });
  });

  it('stops when the caller aborts and never reports after that', async () => {
    const ac = new AbortController();
    let polls = 0;
    const seen: number[] = [];
    const outcome = await pollInstall(
      async () => {
        polls += 1;
        if (polls === 2) ac.abort();
        return { line: 'pulling', percent: polls, done: false };
      },
      (p) => seen.push(p.percent ?? -1),
      noSleep,
      ac.signal,
    );
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(seen).toEqual([1]);
    expect(polls).toBe(2);
  });

  it('gives up after a run of consecutive failures (the hub stopped answering)', async () => {
    let polls = 0;
    const outcome = await pollInstall(
      async () => {
        polls += 1;
        throw new Error('timeout');
      },
      () => {},
      noSleep,
      undefined,
      { maxFailures: 4 },
    );
    expect(outcome).toEqual({ kind: 'unreachable' });
    expect(polls).toBe(4);
  });

  it('forgives a blip: a good answer resets the failure count', async () => {
    let polls = 0;
    const outcome = await pollInstall(
      async () => {
        polls += 1;
        if (polls % 2 === 1 && polls < 8) throw new Error('blip');
        if (polls >= 8) return undefined;
        return { line: 'pulling', done: false };
      },
      () => {},
      noSleep,
      undefined,
      { maxFailures: 3 },
    );
    expect(outcome).toEqual({ kind: 'untracked' });
  });
});
