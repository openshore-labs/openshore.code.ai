// The desktop updater's state, as one pure step function (the D2 shell
// package), so every path the bar can take is pinned by a test without a
// packaged app. main.ts feeds it electron-updater's events and the person's
// click, sends the new status to the renderer when it changed, and runs the
// effect it asks for. Nothing here touches Electron.
//
// What it fixes: a check that found nothing (the release was pulled, or the
// person is already up to date) had no handler, so a retry from "failed"
// parked the bar at "installing 0%" forever; and the half-hourly check
// skipped a pending "available" update, so a newer release never replaced an
// older one the person had not clicked yet.

export interface PendingUpdateStatus {
  version: string;
  phase: 'downloading' | 'ready' | 'available' | 'installing' | 'failed';
  percent?: number;
  detail?: string;
}

export interface UpdaterState {
  /** What the bar shows; undefined when nothing is pending. */
  pending?: PendingUpdateStatus;
  /** The person clicked while the download was not done: install the moment
   *  it lands. */
  installWhenReady: boolean;
}

export const IDLE_UPDATER: UpdaterState = { installWhenReady: false };

export type UpdaterEvent =
  /** electron-updater found a newer release. */
  | { type: 'available'; version: string }
  /** electron-updater's check found nothing newer. */
  | { type: 'not-available' }
  /** A check the person's retry started resolved; `found` is false when it
   *  came back empty or the updater was inactive (no event fires then). */
  | { type: 'check-done'; found: boolean }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; detail: string }
  /** The half-hourly check itself failed (offline, rate-limited). */
  | { type: 'check-failed'; detail: string }
  /** The person clicked Update on the bar. */
  | { type: 'click' };

/** What main does after a step. */
export type UpdaterEffect = 'download' | 'check' | 'quit-and-install';

export interface UpdaterStep {
  state: UpdaterState;
  /** The renderer should hear the new `state.pending`. */
  notify: boolean;
  effect?: UpdaterEffect;
}

const same = (state: UpdaterState): UpdaterStep => ({ state, notify: false });

/** A retry that is still waiting on its check: nothing downloaded yet. */
function awaitingCheck(state: UpdaterState): boolean {
  const p = state.pending;
  return state.installWhenReady && p?.phase === 'installing' && !p.percent;
}

export function stepUpdater(state: UpdaterState, event: UpdaterEvent): UpdaterStep {
  const p = state.pending;
  switch (event.type) {
    case 'available': {
      if (state.installWhenReady) {
        // A retry the person asked for: download straight away.
        return {
          state: { ...state, pending: { version: event.version, phase: 'installing', percent: 0 } },
          notify: true,
          effect: 'download',
        };
      }
      // A newer release replaces an older one the person has not clicked yet.
      if (p?.phase === 'available' && p.version === event.version) return same(state);
      return {
        state: { ...state, pending: { version: event.version, phase: 'available' } },
        notify: true,
      };
    }
    case 'not-available':
    case 'check-done': {
      if (event.type === 'check-done' && event.found) return same(state);
      // Nothing to install: clear what the bar shows, unless a download is
      // already underway or done (it finishes as it is).
      const clearable =
        !p || p.phase === 'available' || p.phase === 'failed' || awaitingCheck(state);
      if (!clearable) return same(state);
      if (!p && !state.installWhenReady) return same(state);
      return { state: { ...IDLE_UPDATER }, notify: true };
    }
    case 'progress': {
      if (!p) return same(state);
      return {
        state: {
          ...state,
          pending: {
            ...p,
            phase: state.installWhenReady ? 'installing' : 'downloading',
            percent: Math.round(event.percent),
          },
        },
        notify: true,
      };
    }
    case 'downloaded': {
      if (state.installWhenReady) {
        return {
          state: {
            ...state,
            pending: { version: event.version, phase: 'installing', percent: 100 },
          },
          notify: true,
          effect: 'quit-and-install',
        };
      }
      return {
        state: { ...state, pending: { version: event.version, phase: 'ready' } },
        notify: true,
      };
    }
    case 'check-failed':
    case 'error': {
      // A background check that could not reach the feed changes nothing the
      // bar shows: an update the person has not clicked stays offered. Only a
      // retry that is waiting on a check fails with it.
      if (event.type === 'check-failed' && !awaitingCheck(state)) return same(state);
      if (!p) return same({ ...state, installWhenReady: false });
      return {
        state: {
          installWhenReady: false,
          pending: { ...p, phase: 'failed', detail: event.detail },
        },
        notify: true,
      };
    }
    case 'click': {
      if (!p) return same(state);
      if (p.phase === 'ready') {
        return {
          state: { ...state, pending: { ...p, phase: 'installing', percent: 100 } },
          notify: true,
          effect: 'quit-and-install',
        };
      }
      if (p.phase === 'available') {
        // The person's click is the download: fetch it, then install.
        return {
          state: { installWhenReady: true, pending: { ...p, phase: 'installing', percent: 0 } },
          notify: true,
          effect: 'download',
        };
      }
      if (p.phase === 'failed') {
        // Try again from the top: a fresh check finds the release (and
        // downloads it), or finds nothing and clears the bar.
        return {
          state: {
            installWhenReady: true,
            pending: { version: p.version, phase: 'installing', percent: 0 },
          },
          notify: true,
          effect: 'check',
        };
      }
      // Downloading or installing already: install the moment it lands.
      return {
        state: { installWhenReady: true, pending: { ...p, phase: 'installing' } },
        notify: true,
      };
    }
  }
}

/** Whether the half-hourly check may run now. Nothing pending, a failure to
 *  retry, or an update the person has not clicked yet (a newer release
 *  replaces it); never while a download is underway, done, or installing. */
export function mayCheckForUpdate(state: UpdaterState): boolean {
  const phase = state.pending?.phase;
  return phase === undefined || phase === 'failed' || phase === 'available';
}
