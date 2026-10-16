// The computer's side of Sync on all devices for chats and projects (founder,
// 2026-10-16; docs/design/openshore-folder-and-sync-plan.md, M5). Each docked
// device keeps its own chats and projects and syncs them here, the way its
// vault syncs with the vault folder. Here they are opaque documents: one JSON
// text per chat or project, written by the app, never read by the engine.
//
// Machine state, not the person's files: under ~/.os-code/sync, one folder per
// person (the owner, or each member of a shared hub by a hash of their id, as
// the vault's member roots are), 0700, files 0600. Each document's version is
// a hash of its text, so it is the same on every read and changes with every
// write. Every write is compare-and-swap (`ifMatch` a version, or `ifAbsent`),
// checked and published under one lock per folder, and written whole through
// a temporary file and a rename, so a reader never sees half a document.
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { oscHome } from '../../config/home.js';

export const SYNC_KINDS = ['chats', 'projects'] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

/** The largest document one write takes (a long chat, as JSON). */
export const SYNC_DOC_MAX_BYTES = 8 * 1024 * 1024;

export function isSyncKind(v: string): v is SyncKind {
  return (SYNC_KINDS as readonly string[]).includes(v);
}

/** A document id: the app's own ids, never a path. */
export function isSyncId(v: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(v);
}

/** The folder for one person's documents. */
export function syncRootFor(auth: { userId: string; role: string }): string {
  const base = join(oscHome(), 'sync');
  if (auth.role === 'admin') return join(base, 'owner');
  const key = createHash('sha256').update(auth.userId, 'utf8').digest('hex').slice(0, 16);
  return join(base, 'members', key);
}

export function docVersion(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32);
}

export interface DocMeta {
  id: string;
  version: string;
  updatedAt: string;
  size: number;
}

export type DocGuard = { ifMatch: string } | { ifAbsent: true };

export type DocWrite =
  | { ok: true; version: string; updatedAt: string }
  | { ok: false; conflict: 'exists' | 'changed' | 'missing' };

export type DocRemove = { ok: true } | { ok: false; conflict: 'changed' | 'missing' };

function kindDir(root: string, kind: SyncKind): string {
  return join(root, kind);
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // A file system without modes (FAT, some mounts) keeps its own.
  }
}

function fileOf(root: string, kind: SyncKind, id: string): string {
  if (!isSyncId(id)) throw new Error('Not a document id.');
  return join(kindDir(root, kind), `${id}.json`);
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

// One lock per folder: check and publish happen as one step. The daemon and
// the desktop app's main process share this module, so one queue holds both.
const queues = new Map<string, Promise<unknown>>();
function locked<T>(key: string, work: () => T): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(work, work);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export function listDocs(root: string, kind: SyncKind): DocMeta[] {
  const dir = kindDir(root, kind);
  if (!existsSync(dir)) return [];
  const out: DocMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (!isSyncId(id)) continue;
    const file = join(dir, name);
    const text = readText(file);
    if (text === undefined) continue;
    out.push({
      id,
      version: docVersion(text),
      updatedAt: statSync(file).mtime.toISOString(),
      size: Buffer.byteLength(text, 'utf8'),
    });
  }
  return out;
}

export function readDoc(
  root: string,
  kind: SyncKind,
  id: string,
): { text: string; version: string } | undefined {
  const text = readText(fileOf(root, kind, id));
  return text === undefined ? undefined : { text, version: docVersion(text) };
}

export function writeDoc(
  root: string,
  kind: SyncKind,
  id: string,
  text: string,
  guard: DocGuard,
): Promise<DocWrite> {
  const file = fileOf(root, kind, id);
  return locked(kindDir(root, kind), (): DocWrite => {
    const cur = readText(file);
    if ('ifAbsent' in guard) {
      if (cur !== undefined) return { ok: false, conflict: 'exists' };
    } else if (cur === undefined) {
      return { ok: false, conflict: 'missing' };
    } else if (docVersion(cur) !== guard.ifMatch) {
      return { ok: false, conflict: 'changed' };
    }
    ensureDir(kindDir(root, kind));
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
    return { ok: true, version: docVersion(text), updatedAt: new Date().toISOString() };
  });
}

export function removeDoc(
  root: string,
  kind: SyncKind,
  id: string,
  ifMatch: string,
): Promise<DocRemove> {
  const file = fileOf(root, kind, id);
  return locked(kindDir(root, kind), (): DocRemove => {
    const cur = readText(file);
    if (cur === undefined) return { ok: false, conflict: 'missing' };
    if (docVersion(cur) !== ifMatch) return { ok: false, conflict: 'changed' };
    rmSync(file, { force: true });
    return { ok: true };
  });
}
