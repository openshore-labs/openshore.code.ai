// The scheduler clock lock: one clock per machine, whichever process is up.
//
// The scheduler is a per-process singleton, so `osc serve` running beside the
// desktop app used to mean two clocks on one box, and every slot fired twice
// (review 5, defect 3.5). The fix is a small lock file under ~/.os-code/routines
// holding the pid of the process whose clock is live. A second process sees a
// live holder and leaves its clock off (it can still list, edit, and Run now;
// it just never fires a slot on its own). A lock left behind by a process that
// died is stale and taken over: the pid is checked with signal 0, never
// trusted from the file alone.
//
// Lifecycle (H1): the lock is created with open(..., 'wx'), so two processes
// starting together can never both write one and both believe they won. It
// records the holder's process start as well as its pid, because a pid is
// reused: after a crash and a reboot, some unrelated process can wear the old
// holder's number, and a pid alone would keep the crew's clock off for good.
// The same start token rides on each routine run, so only a run whose own
// process is gone is ever called orphaned.
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { oscHome } from '../config/load.js';

export interface SchedulerLock {
  pid: number;
  /** When this process took the clock (ISO), for "held by pid N since T". */
  startedAt: string;
  /** The holder's process start, as processStartToken reads it. Absent on a
   *  lock written before it was kept, which is then judged by its pid alone. */
  processStart?: string;
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

let bootIdCache: string | undefined;
function linuxBootId(): string {
  if (bootIdCache === undefined) {
    try {
      bootIdCache = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {
      bootIdCache = '';
    }
  }
  return bootIdCache;
}

/**
 * A string that names when a process started, the same every time it is read
 * for the same process, and different for a later process that reuses its
 * pid. Linux reads the start tick from /proc (with the boot id, so a reboot
 * never matches); other Unix systems ask ps for the start time. Undefined
 * when it cannot be read (Windows, or the process is gone): the caller then
 * falls back to the pid alone, which is how every lock was judged before.
 */
export function processStartToken(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === 'win32') return undefined;
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // The command name sits in parentheses and may hold spaces, so the
      // fields are counted from the last ')'. Field 22 is the start tick.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ticks = fields[19];
      if (ticks && /^\d+$/.test(ticks)) return `linux:${linuxBootId()}:${ticks}`;
    } catch {
      return undefined;
    }
    return undefined;
  }
  try {
    const res = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const text = res.status === 0 ? res.stdout.trim() : '';
    return text ? `ps:${text}` : undefined;
  } catch {
    return undefined;
  }
}

let ownToken: { value: string | undefined } | undefined;
/** This process's own start token, read once. */
export function ownProcessStart(): string | undefined {
  if (!ownToken) ownToken = { value: processStartToken(process.pid) };
  return ownToken.value;
}

/**
 * Whether the process a lock or a run names is still the one that wrote it:
 * the pid is alive and, when a start token was recorded and can be read now,
 * it matches. A live pid with a different start is a reused pid, so the old
 * holder is gone.
 */
export function holderAlive(pid: number, recordedStart: string | undefined): boolean {
  if (!pidAlive(pid)) return false;
  if (!recordedStart) return true;
  const now = pid === process.pid ? ownProcessStart() : processStartToken(pid);
  if (now === undefined) return true;
  return now === recordedStart;
}

/** Block this thread for a few milliseconds. The lock work is synchronous
 *  (the store and the lock are read and written with the sync fs calls), so
 *  a short wait cannot yield to the event loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readRaw(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function parseLock(raw: string | undefined): SchedulerLock | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<SchedulerLock>;
    if (typeof parsed.pid !== 'number') return undefined;
    return {
      pid: parsed.pid,
      startedAt: String(parsed.startedAt ?? ''),
      ...(typeof parsed.processStart === 'string' ? { processStart: parsed.processStart } : {}),
    };
  } catch {
    return undefined;
  }
}

export function readSchedulerLock(path = schedulerLockPath()): SchedulerLock | undefined {
  if (!existsSync(path)) return undefined;
  return parseLock(readRaw(path));
}

/** Our own lock: our pid, and our start when one was recorded. */
function isOurs(lock: SchedulerLock): boolean {
  return (
    lock.pid === process.pid &&
    (lock.processStart === undefined || lock.processStart === ownProcessStart())
  );
}

/** Remove a lock file judged stale, but only while it still holds exactly
 *  what was judged: another process may have replaced it in between, and
 *  that fresh lock must never be deleted. */
function removeIfUnchanged(path: string, judged: string | undefined): void {
  if (readRaw(path) !== judged) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}

/** Create the file only when it is absent, with the content in the same
 *  breath. False when it already exists. */
function createExclusive(path: string, text: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
  return true;
}

/** How young an unreadable lock file must be to count as one being written
 *  right now (created, content not landed yet) rather than left-behind junk. */
const FRESH_UNREADABLE_MS = 2_000;

function youngerThan(path: string, ms: number): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < ms;
  } catch {
    return false;
  }
}

/**
 * Take the clock for this process. Returns the lock now on disk, which is ours
 * when `pid` equals process.pid, or the other live holder's when it is not.
 * Re-entrant: our own lock is simply confirmed. A stale lock (a dead pid, a
 * reused pid, or an unreadable file) is replaced, and the take is retried a
 * few times so two processes racing for a stale lock settle on one holder.
 */
export function acquireSchedulerLock(
  path = schedulerLockPath(),
  now: () => number = Date.now,
): SchedulerLock {
  mkdirSync(dirname(path), { recursive: true });
  const mine: SchedulerLock = {
    pid: process.pid,
    startedAt: new Date(now()).toISOString(),
    ...(ownProcessStart() ? { processStart: ownProcessStart() } : {}),
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    if (createExclusive(path, `${JSON.stringify(mine)}\n`)) return mine;
    const raw = readRaw(path);
    const held = parseLock(raw);
    if (held) {
      if (isOurs(held)) return held;
      if (holderAlive(held.pid, held.processStart)) return held;
    } else if (raw !== undefined && youngerThan(path, FRESH_UNREADABLE_MS)) {
      // Another process just created it and has not written its line yet.
      sleepSync(25);
      continue;
    }
    removeIfUnchanged(path, raw);
  }
  const held = readSchedulerLock(path);
  if (held) return held;
  throw new Error('Could not take the routine clock lock.');
}

/** Give the clock back. Only our own lock is removed; another process's
 *  live lock is left alone. */
export function releaseSchedulerLock(path = schedulerLockPath()): void {
  const held = readSchedulerLock(path);
  if (!held || !isOurs(held)) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone. Nothing to release.
  }
}

/**
 * Run `fn` holding a short-lived file lock, for a read-modify-write that two
 * processes may attempt at once (the routine store). The work inside is a
 * few synchronous file calls, so a waiter spins briefly; a lock whose holder
 * is gone, or that is older than `staleMs`, is broken. If the lock cannot be
 * had within `waitMs` the work goes ahead anyway: a routine's record must
 * never be dropped because a lock file was stuck.
 */
export function withFileLock<T>(
  lockPath: string,
  fn: () => T,
  opts: { waitMs?: number; staleMs?: number } = {},
): T {
  const waitMs = opts.waitMs ?? 2_000;
  const staleMs = opts.staleMs ?? 10_000;
  const deadline = Date.now() + waitMs;
  const line = `${JSON.stringify({ pid: process.pid, processStart: ownProcessStart() })}\n`;
  let held = false;
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    for (;;) {
      if (createExclusive(lockPath, line)) {
        held = true;
        break;
      }
      if (Date.now() > deadline) break;
      const raw = readRaw(lockPath);
      const holder = parseLock(raw);
      const gone = holder
        ? !holderAlive(holder.pid, holder.processStart)
        : raw !== undefined && !youngerThan(lockPath, FRESH_UNREADABLE_MS);
      if (gone || !youngerThan(lockPath, staleMs)) {
        removeIfUnchanged(lockPath, raw);
        continue;
      }
      sleepSync(5);
    }
  } catch {
    // An unwritable folder: the work below meets the same error and says so.
  }
  try {
    return fn();
  } finally {
    if (held) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Already gone.
      }
    }
  }
}
