// Following a desktop model install from the phone (UI-3). The loop used to
// run forever: no cancellation when the screen left, no cap on a hub that
// stopped answering, and a second tap started a second loop. This is the pure
// part, so both exits are tested without a screen: the caller hands in the
// progress fetch, a sleep, and a signal it aborts on unmount or re-tap.
import type { DaemonInstallProgress } from './remoteDriver.js';

export type InstallPollOutcome =
  | { kind: 'done'; ok: boolean; detail?: string }
  /** The daemon no longer tracks the install (it finished and was forgotten). */
  | { kind: 'untracked' }
  /** The caller aborted (the screen closed, or the install was restarted). */
  | { kind: 'cancelled' }
  /** Too many consecutive failed polls: the hub stopped answering. */
  | { kind: 'unreachable' };

export const INSTALL_POLL_INTERVAL_MS = 1200;
export const INSTALL_POLL_MAX_FAILURES = 10;

export async function pollInstall(
  progressFn: () => Promise<DaemonInstallProgress | undefined>,
  onProgress: (p: DaemonInstallProgress) => void,
  sleepFn: (ms: number) => Promise<void>,
  signal?: AbortSignal,
  opts: { intervalMs?: number; maxFailures?: number } = {},
): Promise<InstallPollOutcome> {
  const interval = opts.intervalMs ?? INSTALL_POLL_INTERVAL_MS;
  const maxFailures = opts.maxFailures ?? INSTALL_POLL_MAX_FAILURES;
  let failures = 0;
  for (;;) {
    await sleepFn(interval);
    if (signal?.aborted) return { kind: 'cancelled' };
    let p: DaemonInstallProgress | undefined;
    try {
      p = await progressFn();
    } catch {
      failures += 1;
      if (failures >= maxFailures) return { kind: 'unreachable' };
      continue; // a transient blip; keep polling, but count it
    }
    if (signal?.aborted) return { kind: 'cancelled' };
    failures = 0;
    if (!p) return { kind: 'untracked' };
    if (p.done) return { kind: 'done', ok: Boolean(p.ok), detail: p.detail };
    onProgress(p);
  }
}
