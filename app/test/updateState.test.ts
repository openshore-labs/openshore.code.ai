// The desktop updater's state machine (electron/updateState.ts), every path
// the bar can take (the D2 shell package). Before it, a check that found
// nothing had no handler: a retry after a failure parked the bar at
// "installing 0%" forever when the release had been pulled, and the
// half-hourly check never ran while an update was offered, so a newer release
// could not replace an older one the person had not clicked yet.
import { describe, expect, it } from 'vitest';
import {
  IDLE_UPDATER,
  mayCheckForUpdate,
  stepUpdater,
  type UpdaterEvent,
  type UpdaterState,
} from '../electron/updateState.js';

/** Run events through the machine, collecting what the renderer heard and
 *  the effects main was asked to run. */
function run(events: UpdaterEvent[], from: UpdaterState = IDLE_UPDATER) {
  let state = from;
  const heard: Array<UpdaterState['pending']> = [];
  const effects: string[] = [];
  for (const event of events) {
    const step = stepUpdater(state, event);
    state = step.state;
    if (step.notify) heard.push(state.pending);
    if (step.effect) effects.push(step.effect);
  }
  return { state, heard, effects };
}

describe('the updater state machine', () => {
  it('offers, downloads on the click, and installs when the download lands', () => {
    const { state, effects } = run([
      { type: 'available', version: '1.2.0' },
      { type: 'click' },
      { type: 'progress', percent: 41.6 },
      { type: 'downloaded', version: '1.2.0' },
    ]);
    expect(effects).toEqual(['download', 'quit-and-install']);
    expect(state.pending).toEqual({ version: '1.2.0', phase: 'installing', percent: 100 });
  });

  it('a retry on a pulled release leaves installing 0% and clears the bar', () => {
    const failed = run([
      { type: 'available', version: '1.2.0' },
      { type: 'click' },
      { type: 'error', detail: 'download failed' },
    ]).state;
    expect(failed.pending?.phase).toBe('failed');
    expect(failed.installWhenReady).toBe(false);

    const retry = run([{ type: 'click' }], failed);
    expect(retry.effects).toEqual(['check']);
    expect(retry.state.pending).toEqual({ version: '1.2.0', phase: 'installing', percent: 0 });

    // The release is gone: electron-updater says so, and the bar goes away.
    const gone = run([{ type: 'not-available' }], retry.state);
    expect(gone.state).toEqual(IDLE_UPDATER);
    expect(gone.heard).toEqual([undefined]);
  });

  it('a retry whose check came back empty without an event clears too', () => {
    const retrying: UpdaterState = {
      installWhenReady: true,
      pending: { version: '1.2.0', phase: 'installing', percent: 0 },
    };
    const done = run([{ type: 'check-done', found: false }], retrying);
    expect(done.state).toEqual(IDLE_UPDATER);
    expect(done.heard).toEqual([undefined]);
  });

  it('a retry that finds the release downloads it and installs', () => {
    const retrying: UpdaterState = {
      installWhenReady: true,
      pending: { version: '1.2.0', phase: 'installing', percent: 0 },
    };
    const { state, effects } = run(
      [
        { type: 'available', version: '1.2.1' },
        { type: 'check-done', found: true },
        { type: 'progress', percent: 50 },
        { type: 'downloaded', version: '1.2.1' },
      ],
      retrying,
    );
    expect(effects).toEqual(['download', 'quit-and-install']);
    expect(state.pending?.version).toBe('1.2.1');
  });

  it('a newer release replaces an older one the person has not clicked', () => {
    const offered = run([{ type: 'available', version: '1.2.0' }]).state;
    expect(mayCheckForUpdate(offered)).toBe(true);
    const newer = run([{ type: 'available', version: '1.3.0' }], offered);
    expect(newer.state.pending).toEqual({ version: '1.3.0', phase: 'available' });
    expect(newer.heard).toEqual([{ version: '1.3.0', phase: 'available' }]);
    // The same version again is not news.
    expect(run([{ type: 'available', version: '1.3.0' }], newer.state).heard).toEqual([]);
  });

  it('a pulled release that was only offered leaves the bar', () => {
    const offered = run([{ type: 'available', version: '1.2.0' }]).state;
    const gone = run([{ type: 'not-available' }], offered);
    expect(gone.state).toEqual(IDLE_UPDATER);
    expect(gone.heard).toEqual([undefined]);
  });

  it('nothing pending and nothing found says nothing', () => {
    expect(run([{ type: 'not-available' }]).heard).toEqual([]);
  });

  it('a background check that fails leaves an offered update offered', () => {
    const offered = run([{ type: 'available', version: '1.2.0' }]).state;
    const blip = run([{ type: 'check-failed', detail: 'offline' }], offered);
    expect(blip.state).toEqual(offered);
    expect(blip.heard).toEqual([]);
  });

  it('a retry waiting on its check fails with it, and can be retried again', () => {
    const retrying: UpdaterState = {
      installWhenReady: true,
      pending: { version: '1.2.0', phase: 'installing', percent: 0 },
    };
    const failed = run([{ type: 'check-failed', detail: 'offline' }], retrying).state;
    expect(failed.installWhenReady).toBe(false);
    expect(failed.pending).toMatchObject({ version: '1.2.0', phase: 'failed', detail: 'offline' });
    expect(run([{ type: 'click' }], failed).effects).toEqual(['check']);
  });

  it('never checks while a download is underway, done, or installing', () => {
    expect(mayCheckForUpdate(IDLE_UPDATER)).toBe(true);
    for (const phase of ['downloading', 'ready', 'installing'] as const) {
      expect(mayCheckForUpdate({ installWhenReady: false, pending: { version: '1', phase } })).toBe(
        false,
      );
    }
    expect(
      mayCheckForUpdate({ installWhenReady: false, pending: { version: '1', phase: 'failed' } }),
    ).toBe(true);
  });

  it('a found-nothing answer never interrupts a download that is underway', () => {
    const downloading: UpdaterState = {
      installWhenReady: true,
      pending: { version: '1.2.0', phase: 'installing', percent: 37 },
    };
    expect(run([{ type: 'not-available' }], downloading).state).toEqual(downloading);
    const ready: UpdaterState = {
      installWhenReady: false,
      pending: { version: '1.2.0', phase: 'ready' },
    };
    expect(run([{ type: 'not-available' }], ready).state).toEqual(ready);
  });

  it('a click on a finished download installs at once', () => {
    const ready: UpdaterState = {
      installWhenReady: false,
      pending: { version: '1.2.0', phase: 'ready' },
    };
    const { effects, state } = run([{ type: 'click' }], ready);
    expect(effects).toEqual(['quit-and-install']);
    expect(state.pending).toEqual({ version: '1.2.0', phase: 'installing', percent: 100 });
  });
});
