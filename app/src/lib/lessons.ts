// A project's lessons, the app's half (founder, 2026-10-27; the pure core is
// os-code/src/harness/lessons.ts). Kept sealed on this device, one entry per
// project, never in settings, never synced, never in a vault or a repo, and
// deleted with the project and when chats are cleared. Only the person's tap
// adds one; the harness only proposes.
import { LESSONS_MAX, type Lesson } from 'os-code/protocol';
import { storeDelete, storeGetJson, storeSetJson } from './platform.js';

/** The sealed-store key for a project's lessons. */
export function lessonsKey(projectId: string): string {
  return `oscode.lessons.${projectId}`;
}

/** A project's kept lessons, or none. A malformed entry reads as none. */
export async function readLessons(projectId: string): Promise<Lesson[]> {
  const raw = await storeGetJson<Lesson[]>(lessonsKey(projectId)).catch(() => undefined);
  return Array.isArray(raw)
    ? raw.filter((l) => l && typeof l.id === 'string' && typeof l.text === 'string')
    : [];
}

/** Keep a project's lessons, the newest LESSONS_MAX; none deletes the entry. */
export async function writeLessons(projectId: string, lessons: readonly Lesson[]): Promise<void> {
  if (!lessons.length) {
    await storeDelete(lessonsKey(projectId));
    return;
  }
  await storeSetJson(lessonsKey(projectId), lessons.slice(-LESSONS_MAX));
}
