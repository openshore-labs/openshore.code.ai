// The scheduler clock lock: one clock per machine, whichever process is up.
//
// The scheduler is a per-process singleton, so `osc serve` running beside the
// desktop app used to mean two clocks on one box, and every slot fired twice
// (review 5, defect 3.5). The fix is a small lock file under ~/.os-code/routines
// holding the pid of the process whose clock is live. A second process sees a
// live pid and leaves its clock off (it can still list, edit, and Run now; it
// just never fires a slot on its own). A lock left behind by a process that
// died is stale and taken over: the pid is checked with signal 0, never
// trusted from the file alone.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { oscHome } from '../config/load.js';

export interface SchedulerLock {
  pid: number;
  startedAt: string;
}

export function schedulerLockPath(): string {
  return join(oscHome(), 'routines', 'scheduler.lock');
}

/** True when a process with this pid exists right now. Signal 0 checks
 *  without sending anything; EPERM means it exists but is not ours, which
 *  still counts as alive. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readSchedulerLock(path = schedulerLockPath()): SchedulerLock | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SchedulerLock>;
    if (typeof parsed.pid !== 'number') return undefined;
    return { pid: parsed.pid, startedAt: String(parsed.startedAt ?? '') };
  } catch {
    return undefined;
  }
}

/**
 * Take the clock for this process. Returns the lock now on disk, which is ours
 * when `pid` equals process.pid, or the other live holder's when it is not.
 * Re-entrant: our own lock is simply confirmed. A stale lock (dead pid, or an
 * unreadable file) is replaced.
 */
export function acquireSchedulerLock(
  path = schedulerLockPath(),
  now: () => number = Date.now,
): SchedulerLock {
  const held = readSchedulerLock(path);
  if (held && held.pid !== process.pid && pidAlive(held.pid)) return held;
  const mine: SchedulerLock = { pid: process.pid, startedAt: new Date(now()).toISOString() };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(mine)}\n`, { mode: 0o600 });
  return mine;
}

/** Give the clock back. Only our own lock is removed; another process's
 *  live lock is left alone. */
export function releaseSchedulerLock(path = schedulerLockPath()): void {
  const held = readSchedulerLock(path);
  if (!held || held.pid !== process.pid) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone. Nothing to release.
  }
}
