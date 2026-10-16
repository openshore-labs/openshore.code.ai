// The daemon's /sync routes (Sync on all devices, chats and projects; founder
// 2026-10-16). Scoped to the caller's own folder like the vault routes: no
// route takes a root, so a member reaches only their own documents.
//
//   GET    /sync/<kind>               the documents there, with versions
//   GET    /sync/<kind>/<id>          one document: { text, version }
//   PUT    /sync/<kind>/<id>          { text, ifMatch } or { text, ifAbsent: true }
//   DELETE /sync/<kind>/<id>?ifMatch= remove it while it is still that version
//
// A conflict is an answer (409 with `conflict`), never a guess.
import {
  SYNC_DOC_MAX_BYTES,
  isSyncId,
  isSyncKind,
  listDocs,
  readDoc,
  removeDoc,
  writeDoc,
  type DocGuard,
} from '../core/sync/docStore.js';

/** A PUT body: the text as JSON, which can be up to six times its bytes. */
export const SYNC_PUT_BODY_MAX_BYTES = SYNC_DOC_MAX_BYTES * 6 + 4096;

export interface SyncRouteRequest {
  method: string;
  /** The path after /sync, split. */
  parts: string[];
  url: URL;
  /** The caller's own folder (`syncRootFor(auth)`). */
  root: string;
  readBody(maxBytes: number): Promise<Record<string, unknown>>;
}

export interface SyncRouteAnswer {
  status: number;
  json: unknown;
}

export async function syncRoute(req: SyncRouteRequest): Promise<SyncRouteAnswer> {
  const [kind, id, ...rest] = req.parts;
  if (!kind || !isSyncKind(kind) || rest.length) {
    return { status: 404, json: { error: 'No such sync route.' } };
  }
  if (id === undefined) {
    if (req.method !== 'GET') return { status: 405, json: { error: 'Use GET.' } };
    return { status: 200, json: { docs: listDocs(req.root, kind) } };
  }
  if (!isSyncId(id)) return { status: 400, json: { error: 'That is not a document id.' } };
  if (req.method === 'GET') {
    const doc = readDoc(req.root, kind, id);
    return doc ? { status: 200, json: doc } : { status: 404, json: { error: 'Not there.' } };
  }
  if (req.method === 'PUT') {
    const body = await req.readBody(SYNC_PUT_BODY_MAX_BYTES);
    const text = body.text;
    if (typeof text !== 'string') return { status: 400, json: { error: 'Send {"text": ...}.' } };
    if (Buffer.byteLength(text, 'utf8') > SYNC_DOC_MAX_BYTES) {
      return { status: 413, json: { error: 'That document is too large to sync.' } };
    }
    let guard: DocGuard;
    if (body.ifAbsent === true) guard = { ifAbsent: true };
    else if (typeof body.ifMatch === 'string' && body.ifMatch) guard = { ifMatch: body.ifMatch };
    else return { status: 400, json: { error: 'Send ifMatch or ifAbsent with every write.' } };
    const r = await writeDoc(req.root, kind, id, text, guard);
    return r.ok
      ? { status: 200, json: { version: r.version, updatedAt: r.updatedAt } }
      : { status: 409, json: { conflict: r.conflict } };
  }
  if (req.method === 'DELETE') {
    const ifMatch = req.url.searchParams.get('ifMatch');
    if (!ifMatch) return { status: 400, json: { error: 'Send ifMatch with every delete.' } };
    const r = await removeDoc(req.root, kind, id, ifMatch);
    return r.ok ? { status: 200, json: { removed: true } } : { status: 409, json: r };
  }
  return { status: 405, json: { error: 'Use GET, PUT or DELETE.' } };
}
