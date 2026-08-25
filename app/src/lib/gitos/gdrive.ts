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
}

interface ResourceHandle {
  rootId: string;
  oscodeId: string;
  indexId?: string;
  leaseId?: string;
  index: DriveIndex;
}

const handleCache = new Map<string, ResourceHandle>();

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

async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name='${escapeQ(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`;
  const res = await driveFetch(
    `/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive&pageSize=1`,
  );
  const json = (await res.json()) as { files?: Array<{ id: string }> };
  if (json.files?.[0]) return json.files[0].id;
  const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const create = await driveFetch('/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = (await create.json()) as { id: string };
  return created.id;
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
  const create = await driveFetch('/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId] }),
  });
  const { id } = (await create.json()) as { id: string };
  await putContent(id, text);
  return id;
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
  const text = JSON.stringify(handle.index);
  if (handle.indexId) await putContent(handle.indexId, text);
  else handle.indexId = await createFile('index.json', handle.oscodeId, text);
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
  handle.index = { files };
  await saveIndex(handle);
}

async function handleFor(resourceId: string): Promise<ResourceHandle> {
  const cached = handleCache.get(resourceId);
  if (cached) return cached;
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
  const cached = handle.index.files[path];
  if (!cached) return;
  await trashFile(cached.id);
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
