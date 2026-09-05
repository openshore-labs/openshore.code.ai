// The routine store: routines and their runs, on disk under ~/.os-code as
// one sealed file (mode 600, atomic writes), the same posture as the push
// grant store. A routine's task and persona are the person's own words, so
// the file seals like a session title; timestamps and ids carry no content.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { oscHome } from '../config/load.js';
import { isSealed, loadOrCreateDataKey, openString, sealString } from '../core/security/atRest.js';
import type { Routine, RoutineInput, RoutineRun } from './model.js';

/** Runs kept on disk; older ones fall off the end. The session journals they
 *  point at stay until the session itself is deleted. */
const MAX_RUNS = 200;

interface RoutineFile {
  routines: Routine[];
  runs: RoutineRun[];
}

function storePath(): string {
  return join(oscHome(), 'routines.json');
}

let cached: { path: string; file: RoutineFile } | undefined;

function readFile(): RoutineFile {
  const path = storePath();
  if (cached && cached.path === path) return cached.file;
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
  cached = { path, file };
  return file;
}

function writeFile(file: RoutineFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const dk = loadOrCreateDataKey();
  const line = JSON.stringify(file);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, dk ? sealString(dk.key, line) : line, { mode: 0o600 });
  renameSync(tmp, path);
  cached = { path, file };
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
  const file = readFile();
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
  writeFile({ ...file, routines: [...file.routines, routine] });
  return { ...routine };
}

/** Patch a routine. `lastSlotKey` is the scheduler's own bookkeeping and is
 *  set through markSlot, never through a client patch. */
export function updateRoutine(
  id: string,
  patch: Partial<Omit<Routine, 'id' | 'createdAt' | 'lastSlotKey' | 'ownerUserId'>>,
): Routine | undefined {
  const file = readFile();
  const idx = file.routines.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  const current = file.routines[idx]!;
  const next: Routine = { ...current, ...patch, updatedAt: new Date().toISOString() };
  // A changed clock starts fresh: the old slot key must not suppress the new
  // clock's first slot, nor mark it missed.
  if (patch.schedule) next.lastSlotKey = undefined;
  const routines = [...file.routines];
  routines[idx] = next;
  writeFile({ ...file, routines });
  return { ...next };
}

export function markSlot(id: string, slotKey: string): void {
  const file = readFile();
  const idx = file.routines.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const routines = [...file.routines];
  routines[idx] = { ...routines[idx]!, lastSlotKey: slotKey };
  writeFile({ ...file, routines });
}

export function deleteRoutine(id: string): boolean {
  const file = readFile();
  if (!file.routines.some((r) => r.id === id)) return false;
  writeFile({
    routines: file.routines.filter((r) => r.id !== id),
    runs: file.runs.filter((r) => r.routineId !== id),
  });
  return true;
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
  const file = readFile();
  const full: RoutineRun = { id: randomUUID().slice(0, 8), ...run };
  const runs = [...file.runs, full]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-MAX_RUNS);
  writeFile({ ...file, runs });
  return { ...full };
}

export function updateRun(id: string, patch: Partial<RoutineRun>): RoutineRun | undefined {
  const file = readFile();
  const idx = file.runs.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  const runs = [...file.runs];
  runs[idx] = { ...runs[idx]!, ...patch };
  writeFile({ ...file, runs });
  return { ...runs[idx]! };
}
