// The Google Drive storage provider: the same seam Local and iCloud satisfy,
// backed by the Drive REST API under the drive.file scope (CFO ruling,
// os-code/DECISIONS.md: drive.file only, never a broader scope, to avoid the
// CASA assessment fee). drive.file means the app can only see files and
// folders it creates itself, so this provider creates a REAL folder tree
// (not the hidden appDataFolder) mirroring each resource's note paths: a
// user (or Drive-for-desktop, or Obsidian pointed at that local mirror) can
// find and open it normally.
//
// A `.oscode/index.json` file (sibling to iCloud's `.oscode/lease.json`
// convention) caches path -> Drive file id so list()/read() do not walk the
// whole tree on every call. The cache is rebuilt by a real recursive walk
// whenever it is empty or fails to parse. write() never trusts a cache miss
// blindly: it resolves against a live listing first and treats more than one
// same-name match as a conflict to surface, because Drive (unlike a
// filesystem) does not enforce unique names within a folder, and a stale or
// missing cache entry could otherwise fork one logical path into two file
// ids (CTO must-fix, os-code/DECISIONS.md).
import { gdriveAccessToken } from './gdriveAuth.js';
import type { Lease, StorageProvider, StoredFile } from './providers.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const OSCODE_FOLDER = '.oscode';

interface DriveIndex {
  files: Record<string, { id: string; updatedAt: string; size: number }>;
  // Deleted paths and when, so a merge with a stale remote index (or another
  // device's) never resurrects a note that was intentionally removed.
  tombstones?: Record<string, string>;
}

interface ResourceHandle {
  rootId: string;
  oscodeId: string;
  indexId?: string;
  leaseId?: string;
  index: DriveIndex;
}

const handleCache = new Map<string, ResourceHandle>();
// In-flight handle builds, memoized per resource so two concurrent first calls
// (e.g. a refresh racing a save on app start) cannot each create a duplicate
// root folder and fork the vault into two trees.
const handlePromises = new Map<string, Promise<ResourceHandle>>();

let createSeq = 0;

/** Union two index snapshots: newest-wins per path, honoring tombstones from
 *  either side, so a save never clobbers a concurrent device's entries and a
 *  deletion is not undone by an older remote copy. Exported for testing. */
export function mergeIndex(local: DriveIndex, remote: DriveIndex): DriveIndex {
  const files: DriveIndex['files'] = { ...local.files };
  const tombstones: Record<string, string> = {
    ...(remote.tombstones ?? {}),
    ...(local.tombstones ?? {}),
  };
  // Keep the newer tombstone when both sides recorded one.
  for (const [path, at] of Object.entries(remote.tombstones ?? {})) {
    const mine = (local.tombstones ?? {})[path];
    if (!mine || at > mine) tombstones[path] = at;
  }
  for (const [path, meta] of Object.entries(remote.files)) {
    const mine = files[path];
    if (!mine || meta.updatedAt > mine.updatedAt) files[path] = meta;
  }
  // A file newer than its tombstone is live again; drop the tombstone. A file
  // older than (or equal to) its tombstone was deleted after that version; drop
  // the file.
  for (const [path, at] of Object.entries(tombstones)) {
    const meta = files[path];
    if (meta && meta.updatedAt > at) delete tombstones[path];
    else if (meta) delete files[path];
  }
  return { files, tombstones };
}

/** The conflict-copy name for a path, mirroring the org vault's rule: the base
 *  note is preserved and the incoming write lands beside it. */
function conflictPath(path: string, stamp: string): string {
  const dot = path.lastIndexOf('.');
  const base = dot === -1 ? path : path.slice(0, dot);
  const ext = dot === -1 ? '' : path.slice(dot);
  const safeStamp = stamp.replace(/[:.]/g, '-');
  return `${base} (conflict ${safeStamp})${ext}`;
}

// --------------------------------------------------------------- transport

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await gdriveAccessToken();
  if (!token) throw new Error('Google Drive is not connected.');
  const headers = {
    authorization: `Bearer ${token}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Google Drive request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
    );
  }
  return res;
}

function driveFetch(path: string, init?: RequestInit): Promise<Response> {
  return authedFetch(`${API}${path}`, init);
}

/** A connected cloud's storage, in bytes. `unlimited` is set for an account
 *  with no cap (a Workspace pooled quota), where a free/total bar has no
 *  meaning and only the used figure is honest. */
export interface CloudQuota {
  freeBytes: number;
  totalBytes: number;
  usedBytes: number;
  unlimited: boolean;
}

/** Google Drive's real quota, read from about.get. Unlike iCloud, Drive
 *  reports free of total, so this is an honest availability number for the
 *  capacity meter. Returns undefined when Drive is not connected or the read
 *  fails, so the caller shows nothing rather than a guess. */
export async function gdriveStorageQuota(): Promise<CloudQuota | undefined> {
  try {
    const res = await authedFetch(`${API}/about?fields=storageQuota`);
    const json = (await res.json()) as {
      storageQuota?: { limit?: string; usage?: string };
    };
    const q = json.storageQuota;
    if (!q) return undefined;
    const usedBytes = Number(q.usage ?? 0);
    // A Drive account with no cap omits `limit` entirely. Report it as
    // unlimited rather than inventing a total.
    if (q.limit == null) {
      return { freeBytes: 0, totalBytes: 0, usedBytes, unlimited: true };
    }
    const totalBytes = Number(q.limit);
    return {
      freeBytes: Math.max(0, totalBytes - usedBytes),
      totalBytes,
      usedBytes,
      unlimited: false,
    };
  } catch {
    return undefined;
  }
}

function escapeQ(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

async function listChildren(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
      spaces: 'drive',
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(`/files?${params.toString()}`);
    const json = (await res.json()) as { nextPageToken?: string; files?: DriveFile[] };
    out.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

async function findFilesByName(name: string, parentId: string): Promise<DriveFile[]> {
  const q = `name='${escapeQ(name)}' and mimeType!='${FOLDER_MIME}' and trashed=false and '${parentId}' in parents`;
  const res = await driveFetch(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size)&spaces=drive&pageSize=10`,
  );
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

async function queryFolderIds(name: string, parentId?: string): Promise<string[]> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name='${escapeQ(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`;
  const res = await driveFetch(
    `/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive&pageSize=10`,
  );
  const json = (await res.json()) as { files?: Array<{ id: string }> };
  return (json.files ?? []).map((f) => f.id);
}

async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const existing = await queryFolderIds(name, parentId);
  if (existing.length) return existing.sort()[0]!;
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const create = await driveFetch('/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = ((await create.json()) as { id: string }).id;
  // Re-query to detect a device that created the same folder concurrently
  // (Drive allows duplicate names). Everyone adopts the lexicographically
  // smallest id and trashes the rest, so all clients converge on one folder
  // instead of forking the tree.
  const all = await queryFolderIds(name, parentId);
  if (all.length <= 1) return created;
  const winner = all.sort()[0]!;
  for (const id of all) if (id !== winner) await trashFile(id).catch(() => {});
  return winner;
}

async function readTextFile(id: string): Promise<string> {
  const res = await driveFetch(`/files/${id}?alt=media`);
  return res.text();
}

async function putContent(id: string, text: string): Promise<void> {
  await authedFetch(`${UPLOAD_API}/files/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: text,
  });
}

async function createFile(name: string, parentId: string, text: string): Promise<string> {
  // One multipart request creates metadata and content together, so a crash
  // can never leave a named-but-empty file that later reads as an empty note.
  const boundary = `oscode-${Date.now().toString(36)}-${(createSeq++).toString(36)}`;
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
    `${text}\r\n` +
    `--${boundary}--`;
  const res = await authedFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return ((await res.json()) as { id: string }).id;
}

async function trashFile(id: string): Promise<void> {
  await driveFetch(`/files/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

async function getMeta(id: string): Promise<{ updatedAt: string; size: number }> {
  const res = await driveFetch(`/files/${id}?fields=modifiedTime,size`);
  const json = (await res.json()) as { modifiedTime: string; size?: string };
  return { updatedAt: json.modifiedTime, size: json.size ? Number(json.size) : 0 };
}

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter(Boolean);
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] ?? '' };
}

async function resolveDirId(handle: ResourceHandle, dirs: string[]): Promise<string> {
  let parentId = handle.rootId;
  for (const seg of dirs) parentId = await findOrCreateFolder(seg, parentId);
  return parentId;
}

// -------------------------------------------------------------- the handle

async function saveIndex(handle: ResourceHandle): Promise<void> {
  if (handle.indexId) {
    // Merge with the current remote index before writing, so a concurrent
    // device's entries are not clobbered by our stale snapshot (an added note
    // would otherwise vanish from every list and never come back).
    let remote: DriveIndex = { files: {} };
    try {
      remote = JSON.parse(await readTextFile(handle.indexId)) as DriveIndex;
    } catch {
      remote = { files: {} };
    }
    handle.index = mergeIndex(handle.index, remote);
    await putContent(handle.indexId, JSON.stringify(handle.index));
  } else {
    handle.indexId = await createFile('index.json', handle.oscodeId, JSON.stringify(handle.index));
  }
}

async function rebuildIndex(handle: ResourceHandle): Promise<void> {
  const files: DriveIndex['files'] = {};
  const walk = async (folderId: string, prefix: string): Promise<void> => {
    for (const child of await listChildren(folderId)) {
      if (prefix === '' && child.name === OSCODE_FOLDER) continue;
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.mimeType === FOLDER_MIME) await walk(child.id, path);
      else
        files[path] = {
          id: child.id,
          updatedAt: child.modifiedTime,
          size: Number(child.size ?? 0),
        };
    }
  };
  await walk(handle.rootId, '');
  // Keep any tombstones so a rebuild does not resurrect a note deleted while
  // the index was empty or unparseable.
  handle.index = { files, tombstones: handle.index.tombstones };
  await saveIndex(handle);
}

async function handleFor(resourceId: string): Promise<ResourceHandle> {
  const cached = handleCache.get(resourceId);
  if (cached) return cached;
  const inFlight = handlePromises.get(resourceId);
  if (inFlight) return inFlight;
  const build = buildHandle(resourceId).finally(() => handlePromises.delete(resourceId));
  handlePromises.set(resourceId, build);
  return build;
}

async function buildHandle(resourceId: string): Promise<ResourceHandle> {
  const rootId = await findOrCreateFolder(resourceId);
  const oscodeId = await findOrCreateFolder(OSCODE_FOLDER, rootId);
  const infra = await listChildren(oscodeId);
  const indexFile = infra.find((f) => f.name === 'index.json');
  const leaseFile = infra.find((f) => f.name === 'lease.json');
  let index: DriveIndex = { files: {} };
  if (indexFile) {
    try {
      index = JSON.parse(await readTextFile(indexFile.id)) as DriveIndex;
    } catch {
      index = { files: {} };
    }
  }
  const handle: ResourceHandle = {
    rootId,
    oscodeId,
    indexId: indexFile?.id,
    leaseId: leaseFile?.id,
    index,
  };
  handleCache.set(resourceId, handle);
  // A fresh resource, or an index that failed to parse, gets a real walk so
  // list() never silently reports empty when files actually exist.
  if (Object.keys(index.files).length === 0) await rebuildIndex(handle);
  return handle;
}

// ------------------------------------------------------------------ lease

async function readLease(handle: ResourceHandle): Promise<Lease | undefined> {
  if (!handle.leaseId) return undefined;
  try {
    return JSON.parse(await readTextFile(handle.leaseId)) as Lease;
  } catch {
    return undefined;
  }
}

async function writeLease(handle: ResourceHandle, lease: Lease): Promise<void> {
  const text = JSON.stringify(lease);
  if (handle.leaseId) await putContent(handle.leaseId, text);
  else handle.leaseId = await createFile('lease.json', handle.oscodeId, text);
}

// --------------------------------------------------------------- provider

async function listFiles(resourceId: string) {
  const handle = await handleFor(resourceId);
  return Object.entries(handle.index.files)
    .map(([path, meta]) => ({ path, updatedAt: meta.updatedAt, size: meta.size }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function statFile(resourceId: string, path: string) {
  return (await listFiles(resourceId)).find((f) => f.path === path);
}

async function readFile(resourceId: string, path: string): Promise<StoredFile | undefined> {
  const handle = await handleFor(resourceId);
  let cached = handle.index.files[path];
  if (!cached) {
    // The index can miss a file a rebuild raced past; check the real folder
    // once before reporting "not found".
    const { dirs, name } = splitPath(path);
    const dirId = await resolveDirId(handle, dirs).catch(() => undefined);
    const match = dirId ? (await findFilesByName(name, dirId))[0] : undefined;
    if (match) {
      cached = { id: match.id, updatedAt: match.modifiedTime, size: Number(match.size ?? 0) };
      handle.index.files[path] = cached;
      await saveIndex(handle);
    }
  }
  if (!cached) return undefined;
  const text = await readTextFile(cached.id);
  return { path, text, updatedAt: cached.updatedAt };
}

async function writeFile(resourceId: string, path: string, text: string): Promise<StoredFile> {
  const handle = await handleFor(resourceId);
  const cached = handle.index.files[path];
  let id: string;
  if (cached) {
    // Concurrent-edit guard: if the file changed on Drive since we last saw it
    // (another device wrote), do not overwrite. Land this write as a conflict
    // copy beside the original, so neither side's edit is lost.
    const live = await getMeta(cached.id).catch(() => undefined);
    if (live && live.updatedAt !== cached.updatedAt) {
      const cpath = conflictPath(path, new Date().toISOString());
      const { dirs, name } = splitPath(cpath);
      const dirId = await resolveDirId(handle, dirs);
      const cid = await createFile(name, dirId, text);
      const cmeta = await getMeta(cid);
      handle.index.files[cpath] = { id: cid, updatedAt: cmeta.updatedAt, size: cmeta.size };
      // Refresh the base entry to the version we just observed on Drive.
      handle.index.files[path] = { id: cached.id, updatedAt: live.updatedAt, size: live.size };
      await saveIndex(handle);
      return { path: cpath, text, updatedAt: cmeta.updatedAt };
    }
    await putContent(cached.id, text);
    id = cached.id;
  } else {
    // Not cached: resolve against a live listing before creating, so a stale
    // or missing index can never fork one logical path into two file ids.
    const { dirs, name } = splitPath(path);
    const dirId = await resolveDirId(handle, dirs);
    const matches = await findFilesByName(name, dirId);
    if (matches.length > 1) {
      throw new Error(
        `"${path}" exists more than once on Google Drive. Resolve the duplicate there before saving.`,
      );
    }
    if (matches[0]) {
      id = matches[0].id;
      await putContent(id, text);
    } else {
      id = await createFile(name, dirId, text);
    }
  }
  const meta = await getMeta(id);
  handle.index.files[path] = { id, updatedAt: meta.updatedAt, size: meta.size };
  await saveIndex(handle);
  return { path, text, updatedAt: meta.updatedAt };
}

async function removeFile(resourceId: string, path: string): Promise<void> {
  const handle = await handleFor(resourceId);
  let cached = handle.index.files[path];
  if (!cached) {
    // The index can be stale (another device wrote after our last read), so a
    // cache miss must not make delete a silent no-op: resolve against the live
    // folder before giving up.
    const { dirs, name } = splitPath(path);
    const dirId = await resolveDirId(handle, dirs).catch(() => undefined);
    const match = dirId ? (await findFilesByName(name, dirId))[0] : undefined;
    if (match) {
      cached = { id: match.id, updatedAt: match.modifiedTime, size: Number(match.size ?? 0) };
    }
  }
  // Record a tombstone regardless, so a merge with a stale remote index cannot
  // resurrect the note.
  handle.index.tombstones = {
    ...(handle.index.tombstones ?? {}),
    [path]: new Date().toISOString(),
  };
  if (cached) await trashFile(cached.id);
  delete handle.index.files[path];
  await saveIndex(handle);
}

async function acquireLease(resourceId: string, holder: string, ttlMs: number): Promise<Lease> {
  const handle = await handleFor(resourceId);
  const now = Date.now();
  const current = await readLease(handle);
  if (current && current.holder !== holder && new Date(current.expiresAt).getTime() > now) {
    return current;
  }
  const lease: Lease = { holder, expiresAt: new Date(now + ttlMs).toISOString() };
  await writeLease(handle, lease);
  return lease;
}

async function releaseLease(resourceId: string, holder: string): Promise<void> {
  const handle = await handleFor(resourceId);
  const current = await readLease(handle);
  if (current?.holder === holder && handle.leaseId) {
    await trashFile(handle.leaseId);
    handle.leaseId = undefined;
  }
}

export const gdriveProvider: StorageProvider = {
  id: 'gdrive',
  label: 'Google Drive',
  blurb: 'Your Drive, your bytes. Files added outside OpenShore may not show up here.',
  // Readiness is decided at runtime by isGdriveConnected(), same convention
  // as iCloud: the registry probes the account before offering Drive.
  ready: false,
  pending: 'Connect your Google account to use this.',
  list: listFiles,
  stat: statFile,
  read: readFile,
  write: writeFile,
  remove: removeFile,
  acquireLease,
  releaseLease,
};
