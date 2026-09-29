// The routine store: routines and their runs, on disk under ~/.os-code as
// one sealed file (mode 600, atomic writes), the same posture as the push
// grant store. A routine's task and persona are the person's own words, so
// the file seals like a session title; timestamps and ids carry no content.
//
// Two processes share this file (the desktop app and `osc serve`, H1). The
// parsed copy is kept only while the file on disk is the one it was read
// from (its inode, size, and times, the way listSessions watches its folder),
// so every read sees the other process's writes. Every change is a
// read-modify-write under a short file lock, re-read fresh inside the lock
// and published whole with a temp file and a rename, so neither process
// writes back a stale copy over the other's runs.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { oscHome } from '../config/load.js';
import { isSealed, loadOrCreateDataKey, openString, sealString } from '../core/security/atRest.js';
import { deleteClosedSession } from '../daemon/session.js';
import { withFileLock } from './lock.js';
import type { Routine, RoutineInput, RoutineRun } from './model.js';

/** Runs kept on disk; older ones fall off the end, and the session a run
 *  opened goes with it (its journal and info), unless it is open right now. */
export const MAX_RUNS = 200;

interface RoutineFile {
  routines: Routine[];
  runs: RoutineRun[];
}

function storePath(): string {
  return join(oscHome(), 'routines.json');
}

/** What identifies one version of the file on disk. A write is a rename, so
 *  a new version is a new inode as well as a new time. */
function stampOf(path: string): string {
  try {
    const st = statSync(path);
    return `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
  } catch {
    return 'absent';
  }
}

let cached: { path: string; stamp: string; file: RoutineFile } | undefined;

function readFile(): RoutineFile {
  const path = storePath();
  const stamp = stampOf(path);
  if (cached && cached.path === path && cached.stamp === stamp) return cached.file;
  let file: RoutineFile = { routines: [], runs: [] };
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8').trim();
      if (raw) {
        const dk = loadOrCreateDataKey();
        const clear = isSealed(raw) ? (dk ? openString(dk.key, raw) : null) : raw;
        if (clear) {
          const parsed = JSON.parse(clear) as Partial<RoutineFile>;
          file = {
            routines: Array.isArray(parsed.routines) ? parsed.routines : [],
            runs: Array.isArray(parsed.runs) ? parsed.runs : [],
          };
        }
      }
    }
  } catch {
    file = { routines: [], runs: [] };
  }
  cached = { path, stamp, file };
  return file;
}

function writeFile(file: RoutineFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const dk = loadOrCreateDataKey();
  const line = JSON.stringify(file);
  // A name no other writer shares, even two stores in one process.
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, dk ? sealString(dk.key, line) : line, { mode: 0o600 });
  renameSync(tmp, path);
  cached = { path, stamp: stampOf(path), file };
}

/** One read-modify-write, under the store lock and on a fresh read. */
function mutate<T>(change: (file: RoutineFile) => { next?: RoutineFile; result: T }): T {
  return withFileLock(`${storePath()}.lock`, () => {
    const { next, result } = change(readFile());
    if (next) writeFile(next);
    return result;
  });
}

/** Drop the in-memory copy (tests, or another process wrote the file). */
export function invalidateRoutineStore(): void {
  cached = undefined;
}

export function listRoutines(): Routine[] {
  return readFile().routines.map((r) => ({ ...r }));
}

export function getRoutine(id: string): Routine | undefined {
  const r = readFile().routines.find((x) => x.id === id);
  return r ? { ...r } : undefined;
}

export function createRoutine(input: RoutineInput, ownerUserId?: string): Routine {
  const now = new Date().toISOString();
  const routine: Routine = {
    id: randomUUID().slice(0, 8),
    name: input.name,
    agentId: input.agentId,
    agentName: input.agentName,
    persona: input.persona,
    task: input.task,
    cwd: input.cwd,
    projectName: input.projectName,
    schedule: input.schedule,
    enabled: input.enabled ?? true,
    access: input.access ?? 'read-only',
    maxMinutes: input.maxMinutes ?? 20,
    ownerUserId,
    createdAt: now,
    updatedAt: now,
  };
  mutate((file) => ({ next: { ...file, routines: [...file.routines, routine] }, result: null }));
  return { ...routine };
}

/** Patch a routine. `lastSlotKey` is the scheduler's own bookkeeping and is
 *  set through claimSlot, never through a client patch. */
export function updateRoutine(
  id: string,
  patch: Partial<Omit<Routine, 'id' | 'createdAt' | 'lastSlotKey' | 'ownerUserId'>>,
): Routine | undefined {
  return mutate((file) => {
    const idx = file.routines.findIndex((r) => r.id === id);
    if (idx < 0) return { result: undefined };
    const current = file.routines[idx]!;
    const next: Routine = { ...current, ...patch, updatedAt: new Date().toISOString() };
    // A changed clock starts fresh: the old slot key must not suppress the new
    // clock's first slot, nor mark it missed.
    if (patch.schedule) next.lastSlotKey = undefined;
    const routines = [...file.routines];
    routines[idx] = next;
    return { next: { ...file, routines }, result: { ...next } };
  });
}

/**
 * Claim a scheduled slot for a routine: true for the one caller that moves
 * `lastSlotKey` to it, false when the slot was already claimed (by an earlier
 * tick, or by the other process's scheduler) or the routine is gone. Read
 * fresh under the lock, so a slot fires once per box even if two clocks ever
 * tick it.
 */
export function claimSlot(id: string, slotKey: string): boolean {
  return mutate((file) => {
    const idx = file.routines.findIndex((r) => r.id === id);
    if (idx < 0 || file.routines[idx]!.lastSlotKey === slotKey) return { result: false };
    const routines = [...file.routines];
    routines[idx] = { ...routines[idx]!, lastSlotKey: slotKey };
    return { next: { ...file, routines }, result: true };
  });
}

/** Set the slot bookkeeping outright (tests and older callers). */
export function markSlot(id: string, slotKey: string): void {
  claimSlot(id, slotKey);
}

export function deleteRoutine(id: string): boolean {
  return mutate((file) => {
    if (!file.routines.some((r) => r.id === id)) return { result: false };
    return {
      next: {
        routines: file.routines.filter((r) => r.id !== id),
        runs: file.runs.filter((r) => r.routineId !== id),
      },
      result: true,
    };
  });
}

export function listRuns(limit = 50, routineId?: string): RoutineRun[] {
  const runs = readFile().runs.filter((r) => !routineId || r.routineId === routineId);
  // Newest first.
  return runs
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

export function getRun(id: string): RoutineRun | undefined {
  const r = readFile().runs.find((x) => x.id === id);
  return r ? { ...r } : undefined;
}

export function appendRun(run: Omit<RoutineRun, 'id'>): RoutineRun {
  const full: RoutineRun = { id: randomUUID().slice(0, 8), ...run };
  const dropped = mutate((file) => {
    const sorted = [...file.runs, full].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const kept = sorted.slice(-MAX_RUNS);
    return {
      next: { ...file, runs: kept },
      result: sorted.slice(0, sorted.length - kept.length),
    };
  });
  // The runs that fell out of the window take their sessions with them (H1),
  // after the lock is let go: every run is a stored session, and nothing
  // else would ever delete one. A session open right now stays for
  // retention to take later.
  for (const old of dropped) {
    if (!old.sessionId) continue;
    try {
      deleteClosedSession(old.sessionId);
    } catch {
      // A folder that will not go is left for retention.
    }
  }
  return { ...full };
}

/** Patch a run. With `when`, only while the stored run still passes it, read
 *  fresh under the lock (the orphan sweep marks a run failed only if it is
 *  still running when the write lands). */
export function updateRun(
  id: string,
  patch: Partial<RoutineRun>,
  when?: (run: RoutineRun) => boolean,
): RoutineRun | undefined {
  return mutate((file) => {
    const idx = file.runs.findIndex((r) => r.id === id);
    if (idx < 0) return { result: undefined };
    if (when && !when(file.runs[idx]!)) return { result: undefined };
    const runs = [...file.runs];
    runs[idx] = { ...runs[idx]!, ...patch };
    return { next: { ...file, runs }, result: { ...runs[idx]! } };
  });
}
