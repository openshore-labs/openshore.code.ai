// The daemon's vault routes and the desktop chat's pack (Vault M5, tech review J6,
// J7). A handler module: serve.ts authenticates, picks the caller's own root
// (`vaultRootFor(auth)`), and hands the request here with one dispatch line;
// every answer comes back as a value serve.ts writes, so a test can drive a
// route without a socket.
//
// Scoped to the caller's root, never owner-only (D9): the owner and the
// legacy shared token reach the machine's vault, a member reaches their own
// root under oscHome()/vaults/members. No route takes a root, and every note
// path goes through the note rule and the Jail (folderFs.vaultNoteAbs), so a
// `..`, a dot segment, a backslash or a link planted in the folder never
// leaves it. A phone's write is the person's own: no approval, but always a
// compare-and-swap against the version it read (F1), and the engine's open
// index takes the text in hand so the next pack sees the edit.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { VAULT_FOLDER_MISSING } from '../config/load.js';
import { readVaultConfigFile, writeVaultConfigFile } from '../core/vault/configFile.js';
import { VAULT_CONFIG_MAX_BYTES } from '../harness/vault/configDir.js';
import { parseVaultSettingsFile } from '../harness/vault/settings.js';
import { createVaultContextSource } from '../core/vault/contextSource.js';
import { openEngineVaultIndex } from '../core/vault/engineIndex.js';
import {
  createVaultFolder,
  emptyVaultTrash,
  isVaultNotePath,
  listVaultAttachments,
  listVaultFolders,
  listVaultTrash,
  parseVaultGuard,
  parseVaultRenameGuard,
  parseVaultTrashIds,
  parseVaultTrashTarget,
  readVaultBytes,
  readVaultFile,
  removeVaultFile,
  renameVaultFile,
  restoreVaultTrash,
  renameVaultFolder,
  trashVaultPath,
  writeVaultFile,
  type VaultFile,
  type VaultFileMeta,
} from '../core/vault/folderFs.js';
import { loadVaultIndexFile } from '../core/vault/indexFile.js';
import { listVaultNotes } from '../core/vault/listNotes.js';
import { ensureVaultRootAt } from '../core/vault/memberRoots.js';
import { NotANoteError } from '../core/vault/noteFile.js';
import { JailViolation } from '../core/security/jail.js';
import { deriveProfile } from '../harness/profile.js';
import {
  buildContextPack,
  packBudgetTokens,
  packModeFor,
  type VaultContextSetting,
  type VaultContextSource,
} from '../harness/vaultContext.js';
import type {
  ConfigWriteGuard,
  ConfigWriteResult,
  ResolvedVaultSettings,
  VaultOverrides,
  VaultPackSize,
  VaultPrivacy,
  VaultSettingsConfigName,
  VaultSettingsParse,
} from '../harness/vault/types.js';
import { attachmentMime, isAttachmentPath } from '../harness/vault/attachments.js';
import {
  VAULT_SETTINGS_CONFIG_NAME,
  VAULT_WIRE_LIST_MAX,
  VAULT_WIRE_NOTE_MAX_BYTES,
  type ChatContextPackEvent,
  type HubNoteMeta,
  type VaultAttachmentsListResponse,
  type VaultConfigConflictResponse,
  type VaultConfigPutResponse,
  type VaultConfigResponse,
  type VaultFolderConflictResponse,
  type VaultFolderRenameResponse,
  type VaultFoldersListResponse,
  type VaultNoteConflictResponse,
  type VaultNoteReadResponse,
  type VaultNotesListResponse,
  type VaultPrivacyWire,
  type VaultRenameConflictResponse,
  type VaultRenameResponse,
  type VaultTrashConflictResponse,
  type VaultTrashEmptyResponse,
  type VaultTrashListResponse,
  type VaultTrashResponse,
  type VaultTrashRestoreResponse,
} from './vaultWire.js';

/** What a vault route answers: a JSON body, or raw text or bytes with its
 *  headers (the saved index, which the phone parses itself, a 304, and an
 *  attachment's bytes). */
export type VaultRouteAnswer =
  | { status: number; json: unknown }
  | { status: number; raw: string | Uint8Array; headers: Record<string, string> };

export interface VaultRouteRequest {
  method: string;
  /** The path segments after `vault`, still URI-encoded. */
  parts: readonly string[];
  url: URL;
  headers: IncomingHttpHeaders;
  /** The caller's own root (`vaultRootFor(auth)`). */
  root: string;
  /** The body as a JSON object (serve.ts's bounded reader); `maxBytes`
   *  lowers the daemon's cap for a route with a smaller one (413 over it). */
  readBody(maxBytes?: number): Promise<Record<string, unknown>>;
  /** The machine's privacy keys for this root (`vault.exclude`,
   *  `vault.localOnly`), never from a project file. */
  privacy(): VaultPrivacyWire;
}

const err = (status: number, error: string): VaultRouteAnswer => ({ status, json: { error } });

/** Decode a note path from its URI-encoded segments; null when a segment is
 *  not valid percent-encoding or the path is not a note. */
function notePathOf(segments: readonly string[]): string | null {
  if (!segments.length) return null;
  let path: string;
  try {
    path = segments.map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
  return isVaultNotePath(path) ? path : null;
}

function metaOf(path: string, note: { text: string; version: string; updatedAt: string }) {
  const meta: HubNoteMeta = {
    path,
    version: note.version,
    size: Buffer.byteLength(note.text, 'utf8'),
    mtime: note.updatedAt,
  };
  return meta;
}

/** The ETag of the saved index: a quoted hash of its bytes. */
export function indexEtag(text: string): string {
  return `"${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)}"`;
}

function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return false;
  return raw
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');
}

/** Tell the engine's open index (when one is open) what a phone wrote or
 *  removed, so the next pack sees it without a read. An index that is not
 *  open reconciles from the folder when it opens. */
async function tellIndex(
  root: string,
  path: string,
  note: { text: string; version: string; updatedAt: string } | null,
): Promise<void> {
  const handle = await openEngineVaultIndex(root).catch(() => undefined);
  if (!handle) return;
  if (note) {
    const size = Buffer.byteLength(note.text, 'utf8');
    handle.noteWrite({ path, version: note.version, updatedAt: note.updatedAt, size }, note.text);
  } else handle.noteWrite({ path, version: '', updatedAt: '', size: 0 }, null);
}

function isFolder(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** A folder-level change (a folder moved, something went to Trash or came
 *  back): the engine's open index reconciles from the folder rather than
 *  reading every moved note here. */
async function refreshIndex(root: string): Promise<void> {
  const handle = await openEngineVaultIndex(root).catch(() => undefined);
  if (handle) void handle.reconcile().catch(() => undefined);
}

function wireMeta(m: VaultFileMeta): HubNoteMeta {
  return { path: m.path, version: m.version, size: m.size, mtime: m.updatedAt };
}

function wireTheirs(f: VaultFile | undefined): { current?: HubNoteMeta } {
  return f ? { current: metaOf(f.path, f) } : {};
}

/** A `blocked:` refusal from folderFs, the Jail, or a folder where a note
 *  should be: the caller's mistake, a 400 that names it. Anything else is
 *  thrown on. */
function refusal(e: unknown): VaultRouteAnswer {
  if (e instanceof JailViolation) return err(400, 'That path leaves the vault.');
  if (e instanceof NotANoteError) return err(400, e.message);
  const message = (e as Error | undefined)?.message ?? '';
  if (message.startsWith('blocked: ')) return err(400, message.slice('blocked: '.length));
  throw e;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** A root that is not there makes no folder, trash or rename; the default
 *  one is made (as a PUT makes it), a configured one gone missing is 503. */
function readyRoot(root: string): VaultRouteAnswer | undefined {
  try {
    ensureVaultRootAt(root);
    return undefined;
  } catch (e) {
    if ((e as Error).message === VAULT_FOLDER_MISSING) return err(503, VAULT_FOLDER_MISSING);
    throw e;
  }
}

/** The M6 routes (tech review K13): rename, folders, Trash, attachments and their
 *  bytes. Undefined when the request is none of them. */
async function vaultM6Route(req: VaultRouteRequest): Promise<VaultRouteAnswer | undefined> {
  const [area, ...rest] = req.parts;
  const { method, root } = req;
  const sub = rest.join('/');

  if (area === 'rename' && !sub) {
    if (method !== 'POST') return err(405, 'Rename with POST.');
    const input = await req.readBody();
    const from = str(input.from);
    const to = str(input.to);
    if (!from || !to) return err(400, 'Send {"from", "to", "ifMatch"}.');
    try {
      const guard = parseVaultRenameGuard({ ifMatch: input.ifMatch });
      if (!isFolder(root)) return { status: 409, json: { conflict: 'missing' } };
      const r = await renameVaultFile(root, from, to, guard);
      if (!r.ok) {
        const body: VaultRenameConflictResponse = { conflict: r.conflict, ...wireTheirs(r.theirs) };
        return { status: 409, json: body };
      }
      await tellIndex(root, from, null);
      const moved = await readVaultFile(root, r.file.path).catch(() => null);
      if (moved) await tellIndex(root, r.file.path, moved);
      const body: VaultRenameResponse = { meta: wireMeta(r.file) };
      return { status: 200, json: body };
    } catch (e) {
      return refusal(e);
    }
  }

  if (area === 'folders' && !sub) {
    if (method === 'GET') {
      const body: VaultFoldersListResponse = {
        folders: isFolder(root) ? await listVaultFolders(root) : [],
      };
      return { status: 200, json: body };
    }
    if (method !== 'POST') return err(405, 'List folders with GET, make one with POST.');
    const input = await req.readBody();
    const path = str(input.path);
    if (!path) return err(400, 'Send {"path": "..."}.');
    try {
      const away = readyRoot(root);
      if (away) return away;
      const r = await createVaultFolder(root, path);
      if (!r.ok) {
        const body: VaultFolderConflictResponse = { conflict: r.conflict };
        return { status: 409, json: body };
      }
      return { status: 200, json: { ok: true } };
    } catch (e) {
      return refusal(e);
    }
  }

  if (area === 'folders' && sub === 'rename') {
    if (method !== 'POST') return err(405, 'Rename a folder with POST.');
    const input = await req.readBody();
    const from = str(input.from);
    const to = str(input.to);
    if (!from || !to) return err(400, 'Send {"from", "to"}.');
    try {
      if (!isFolder(root)) return { status: 409, json: { conflict: 'missing' } };
      const r = await renameVaultFolder(root, from, to);
      if (!r.ok) {
        const body: VaultFolderConflictResponse = { conflict: r.conflict };
        return { status: 409, json: body };
      }
      await refreshIndex(root);
      const body: VaultFolderRenameResponse = { moved: r.moved, attachments: r.attachments };
      return { status: 200, json: body };
    } catch (e) {
      return refusal(e);
    }
  }

  if (area === 'trash' && !sub) {
    try {
      if (method === 'GET') {
        const body: VaultTrashListResponse = { entries: await listVaultTrash(root) };
        return { status: 200, json: body };
      }
      if (method === 'POST') {
        const target = parseVaultTrashTarget(await req.readBody());
        if (!isFolder(root)) return { status: 409, json: { conflict: 'changed' } };
        const r = await trashVaultPath(root, target);
        if (!r.ok) {
          const body: VaultTrashConflictResponse = {
            conflict: r.conflict,
            ...wireTheirs(r.theirs),
          };
          return { status: 409, json: body };
        }
        if (target.kind === 'note') await tellIndex(root, target.path, null);
        else await refreshIndex(root);
        const body: VaultTrashResponse = {
          entry: r.entry,
          notes: r.notes,
          attachments: r.attachments,
        };
        return { status: 200, json: body };
      }
      if (method === 'DELETE') {
        const input = await req.readBody();
        const ids = parseVaultTrashIds(input.ids);
        const body: VaultTrashEmptyResponse = await emptyVaultTrash(root, ids);
        return { status: 200, json: body };
      }
    } catch (e) {
      return refusal(e);
    }
    return err(405, 'List Trash with GET, add with POST, empty with DELETE.');
  }

  if (area === 'trash' && sub === 'restore') {
    if (method !== 'POST') return err(405, 'Restore with POST.');
    const input = await req.readBody();
    const id = str(input.id);
    if (!id) return err(400, 'Send {"id": "..."}.');
    try {
      const r = await restoreVaultTrash(root, id);
      if (!r.ok) return { status: 409, json: { conflict: r.conflict } };
      if (r.file.version) {
        const note = await readVaultFile(root, r.file.path).catch(() => null);
        if (note) await tellIndex(root, r.file.path, note);
      } else await refreshIndex(root);
      const body: VaultTrashRestoreResponse = { meta: wireMeta(r.file), renamed: r.renamed };
      return { status: 200, json: body };
    } catch (e) {
      return refusal(e);
    }
  }

  if (area === 'attachments' && !sub) {
    if (method !== 'GET') return err(405, 'List attachments with GET.');
    const all = isFolder(root) ? await listVaultAttachments(root) : [];
    const body: VaultAttachmentsListResponse = {
      attachments: all.slice(0, VAULT_WIRE_LIST_MAX),
      truncated: all.length > VAULT_WIRE_LIST_MAX,
    };
    return { status: 200, json: body };
  }

  if (area === 'files' && rest.length) {
    if (method !== 'GET') return err(405, 'Read an attachment with GET.');
    let path: string;
    try {
      path = rest.map((s) => decodeURIComponent(s)).join('/');
    } catch {
      return err(400, 'That is not an attachment path.');
    }
    // 415 for a type outside the list, before the disk is touched.
    if (!attachmentMime(path)) return err(415, 'That file type does not open in the Vault.');
    if (!isAttachmentPath(path)) return err(400, 'That is not an attachment path.');
    const read = isFolder(root)
      ? await readVaultBytes(root, path)
      : ({ ok: false, reason: 'absent' } as const);
    if (!read.ok) {
      if (read.reason === 'absent') return err(404, 'No such attachment.');
      if (read.reason === 'too-large') return err(413, 'That attachment is over 20 MB.');
      if (read.reason === 'unsupported')
        return err(415, 'That file is not the type its name says.');
      return err(400, 'That attachment is not one the Vault reads.');
    }
    const etag = `"${read.version}"`;
    if (etagMatches(req.headers['if-none-match'], etag)) {
      return { status: 304, raw: '', headers: { etag } };
    }
    const name = path.split('/').pop() ?? 'attachment';
    return {
      status: 200,
      raw: read.bytes,
      headers: {
        'content-type': read.mime,
        'content-length': String(read.bytes.length),
        'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'private, no-cache',
        etag,
      },
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Vault M7 (tech review L7, L13): the settings file write and the session overrides.
// One write path for the two hosts that hold a folder: the hub's `PUT
// /vault/config/oscode/vault` (the caller's own root) and main's
// `osc:vaultWriteConfig` (the vault root main reads itself). Both call
// `putVaultSettingsFile`, so the name rule, the cap, the parse and the
// link checks are the same code. The person's own write from the sheet; no
// agent tool reaches it (the L7 grep test).

type ConfigWriter = (
  root: string,
  name: VaultSettingsConfigName,
  text: string,
  guard: ConfigWriteGuard,
) => Promise<ConfigWriteResult>;

/** The two calls the settings write makes past this file: the engine's
 *  writer and stream A's parser. A seam so a test can wrap either. */
export const vaultSettingsWriteSeam: {
  write: ConfigWriter;
  parse: (text: string) => VaultSettingsParse;
} = {
  write: writeVaultConfigFile,
  parse: parseVaultSettingsFile,
};

/** A PUT body's byte cap: the file's cap with room for JSON escapes (a
 *  control byte encodes as six) and the envelope. */
export const VAULT_CONFIG_PUT_BODY_MAX_BYTES = VAULT_CONFIG_MAX_BYTES * 6 + 4096;
/** The longest `ifMatch` accepted; a version token is far shorter. */
const GUARD_MAX = 256;

/** Exactly one guard, `ifMatch` (a version string) or `ifAbsent: true`.
 *  Anything else throws a `blocked:` refusal: a settings write is never
 *  unguarded. */
export function parseConfigWriteGuard(v: unknown): ConfigWriteGuard {
  const g = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const hasMatch = g.ifMatch !== undefined;
  const hasAbsent = g.ifAbsent !== undefined;
  if (hasMatch === hasAbsent) {
    throw new Error('blocked: send exactly one guard, ifMatch or ifAbsent');
  }
  if (hasAbsent) {
    if (g.ifAbsent !== true) throw new Error('blocked: ifAbsent must be true');
    return { ifAbsent: true };
  }
  if (typeof g.ifMatch !== 'string' || !g.ifMatch || g.ifMatch.length > GUARD_MAX) {
    throw new Error('blocked: ifMatch must be the version you read');
  }
  return { ifMatch: g.ifMatch };
}

/** The app's vault switches for a session (L13): each value checked, the
 *  switches off-only, the size one of the three; anything else is dropped,
 *  never a refused session. Undefined when nothing valid is left. Lower-only
 *  is the engine's `vaultPackSize`, against the machine's own size. */
export function parseVaultOverrides(v: unknown): VaultOverrides | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: VaultOverrides = {};
  if (o.context === 'off') out.context = 'off';
  if (o.handoff === 'off') out.handoff = 'off';
  if (o.packSize === 'small' || o.packSize === 'normal' || o.packSize === 'large') {
    out.packSize = o.packSize;
  }
  return Object.keys(out).length ? out : undefined;
}

function errnoOf(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

/** The root's real path, when `.oscode` under it is absent or a real
 *  directory whose real path is exactly `<real root>/.oscode`, and the
 *  settings file is absent or a regular file. A link at either step (planted
 *  by a sync client, a plugin or a teammate) is `refused`: the write never
 *  lands outside the folder, and never through a link inside it. */
export async function oscodeWriteRoot(root: string): Promise<string | 'refused'> {
  let real: string;
  try {
    real = await realpath(root);
  } catch {
    return 'refused';
  }
  const dir = join(real, '.oscode');
  try {
    const st = await lstat(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return 'refused';
    if ((await realpath(dir)) !== dir) return 'refused';
  } catch (e) {
    if (errnoOf(e) === 'ENOENT') return real;
    throw e;
  }
  try {
    const st = await lstat(join(dir, 'vault.json'));
    if (st.isSymbolicLink() || !st.isFile()) return 'refused';
  } catch (e) {
    if (errnoOf(e) !== 'ENOENT') throw e;
  }
  return real;
}

/**
 * Write the vault's settings file under `root`, guarded. `refused` for any
 * name but `oscode/vault` (every `obsidian/*` name included) or a link under
 * `.oscode`; `too-large` over `VAULT_CONFIG_MAX_BYTES`; a `blocked:` throw
 * for text the parser reads as `unreadable` (a write that would leave the
 * sheet read-only). Keys the parser sets aside are kept as sent (L7).
 */
export async function putVaultSettingsFile(
  root: string,
  name: unknown,
  text: string,
  guard: ConfigWriteGuard,
): Promise<ConfigWriteResult> {
  if (name !== VAULT_SETTINGS_CONFIG_NAME) return { ok: false, reason: 'refused' };
  if (Buffer.byteLength(text, 'utf8') > VAULT_CONFIG_MAX_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  if ('unreadable' in vaultSettingsWriteSeam.parse(text)) {
    throw new Error('blocked: that is not a settings file OpenShore can read');
  }
  const real = await oscodeWriteRoot(root);
  if (real === 'refused') return { ok: false, reason: 'refused' };
  return vaultSettingsWriteSeam.write(real, VAULT_SETTINGS_CONFIG_NAME, text, guard);
}

/** A config name from its URI-encoded segments (`oscode/vault` whole, or
 *  `oscode%2Fvault` as one); null when a segment is not valid encoding. */
function configNameOf(segments: readonly string[]): string | null {
  try {
    return segments.map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return null;
  }
}

/** `PUT /vault/config/<name>`: the settings write on the caller's root. */
async function vaultConfigPut(req: VaultRouteRequest, name: string): Promise<VaultRouteAnswer> {
  if (name !== VAULT_SETTINGS_CONFIG_NAME) {
    return err(403, "Only the vault's own settings can be written from here.");
  }
  const input = await req.readBody(VAULT_CONFIG_PUT_BODY_MAX_BYTES);
  if (typeof input.text !== 'string') return err(400, 'Send {"text": "..."}.');
  let guard: ConfigWriteGuard;
  try {
    guard = parseConfigWriteGuard({ ifMatch: input.ifMatch, ifAbsent: input.ifAbsent });
  } catch (e) {
    return refusal(e);
  }
  const away = readyRoot(req.root);
  if (away) return away;
  let r: ConfigWriteResult;
  try {
    r = await putVaultSettingsFile(req.root, name, input.text, guard);
  } catch (e) {
    return refusal(e);
  }
  if (r.ok) {
    const body: VaultConfigPutResponse = { name, version: r.version };
    return { status: 200, json: body };
  }
  if ('reason' in r) {
    if (r.reason === 'too-large') return err(413, 'Those settings are too large to save.');
    return err(403, 'The settings folder in this vault is not one OpenShore writes.');
  }
  if (r.conflict === 'downloading') return err(503, 'The settings file is still downloading.');
  const body: VaultConfigConflictResponse = {
    conflict: r.conflict,
    ...(r.current ? { current: { name, text: r.current.text, version: r.current.version } } : {}),
  };
  return { status: 409, json: body };
}

/** One vault route. `parts` starts after `vault`. */
export async function vaultRoute(req: VaultRouteRequest): Promise<VaultRouteAnswer> {
  const [area, ...rest] = req.parts;
  const { method, root } = req;

  const m6 = await vaultM6Route(req);
  if (m6) return m6;

  if (area === 'notes' && rest.length === 0) {
    if (method !== 'GET') return err(405, 'List notes with GET.');
    const all = isFolder(root) ? await listVaultNotes(root) : [];
    const notes: HubNoteMeta[] = [];
    let truncated = false;
    for (const n of all) {
      if (!isVaultNotePath(n.path) || n.version === undefined) continue;
      if (notes.length >= VAULT_WIRE_LIST_MAX) {
        truncated = true;
        break;
      }
      notes.push({ path: n.path, version: n.version, size: n.size, mtime: n.updatedAt });
    }
    const body: VaultNotesListResponse = { notes, truncated };
    return { status: 200, json: body };
  }

  if (area === 'notes') {
    const path = notePathOf(rest);
    if (!path) return err(400, 'That is not a note path. Notes are .md files outside dot folders.');
    try {
      if (method === 'GET') {
        const note = isFolder(root) ? await readVaultFile(root, path) : null;
        if (!note) return err(404, 'No such note.');
        const body: VaultNoteReadResponse = {
          path,
          text: note.text,
          version: note.version,
          mtime: note.updatedAt,
        };
        return { status: 200, json: body };
      }
      if (method === 'PUT') {
        const input = await req.readBody();
        if (typeof input.text !== 'string') return err(400, 'Send {"text": "..."}.');
        if (Buffer.byteLength(input.text, 'utf8') > VAULT_WIRE_NOTE_MAX_BYTES) {
          return err(413, 'That note is too large to save from here.');
        }
        let guard;
        try {
          guard = parseVaultGuard(
            input.ifMatch === undefined && input.ifAbsent === undefined
              ? undefined
              : {
                  ...(input.ifMatch !== undefined ? { ifMatch: input.ifMatch } : {}),
                  ...(input.ifAbsent !== undefined ? { ifAbsent: input.ifAbsent } : {}),
                },
          );
        } catch (e) {
          return err(400, (e as Error).message.replace(/^blocked: /, ''));
        }
        try {
          ensureVaultRootAt(root);
        } catch (e) {
          if ((e as Error).message === VAULT_FOLDER_MISSING) return err(503, VAULT_FOLDER_MISSING);
          throw e;
        }
        const saved = await writeVaultFile(root, path, input.text, guard);
        if (!saved.ok) {
          const body: VaultNoteConflictResponse = {
            conflict: saved.conflict,
            ...(saved.theirs ? { current: metaOf(path, saved.theirs) } : {}),
          };
          return { status: 409, json: body };
        }
        await tellIndex(root, path, saved.file);
        return { status: 200, json: { meta: metaOf(path, saved.file) } };
      }
      if (method === 'DELETE') {
        const ifMatch = req.url.searchParams.get('ifMatch');
        if (!ifMatch) return err(400, 'Send the version you read as ?ifMatch=.');
        let guard;
        try {
          guard = parseVaultGuard({ ifMatch });
        } catch (e) {
          return err(400, (e as Error).message.replace(/^blocked: /, ''));
        }
        if (!isFolder(root)) return { status: 200, json: { ok: true } };
        const removed = await removeVaultFile(root, path, guard as { ifMatch: string });
        if (!removed.ok) {
          const body: VaultNoteConflictResponse = {
            conflict: 'changed',
            ...(removed.theirs ? { current: metaOf(path, removed.theirs) } : {}),
          };
          return { status: 409, json: body };
        }
        await tellIndex(root, path, null);
        return { status: 200, json: { ok: true } };
      }
    } catch (e) {
      if (e instanceof JailViolation) return err(400, 'That path leaves the vault.');
      if (e instanceof NotANoteError) return err(400, e.message);
      throw e;
    }
    return err(405, `No route ${method} for a note.`);
  }

  if (area === 'config' && rest.length >= 1 && rest.length <= 2) {
    const name = configNameOf(rest);
    if (name === null) return err(400, 'That is not a config name.');
    if (method === 'PUT') return vaultConfigPut(req, name);
    if (method !== 'GET') return err(405, 'Read a config file with GET, save settings with PUT.');
    const read = await readVaultConfigFile(root, name);
    if (read.ok) {
      const body: VaultConfigResponse = { name, text: read.text, version: read.version };
      return { status: 200, json: body };
    }
    if (read.reason === 'absent') return err(404, 'No such config file.');
    if (read.reason === 'too-large') return err(413, 'That config file is too large.');
    return err(400, 'That config file is not one OpenShore reads.');
  }

  if (area === 'privacy' && rest.length === 0 && method === 'GET') {
    return { status: 200, json: req.privacy() };
  }

  if (area === 'index' && rest.length === 0 && method === 'GET') {
    const text = await loadVaultIndexFile(root);
    if (text === null) return err(404, 'No saved index yet.');
    const etag = indexEtag(text);
    if (etagMatches(req.headers['if-none-match'], etag)) {
      return { status: 304, raw: '', headers: { etag } };
    }
    return {
      status: 200,
      raw: text,
      headers: { 'content-type': 'application/json', etag },
    };
  }

  return err(404, `No route ${method} /vault/${req.parts.join('/')}.`);
}

// ---------------------------------------------------------------------------
// The desktop chat's pack (tech review J6)

export interface ChatPackOptions {
  /** The caller's own root; undefined (or a folder not there) leaves every
   *  vault layer out, so the pack is Current State at most. */
  root?: string;
  privacy: VaultPrivacy;
  /** This project's Current State, only when the cwd passed the session
   *  checks. */
  currentState?: () => Promise<{ path: string; text: string } | undefined>;
  /** The last user turn: retrieval's query. */
  task: string;
  /** The orchestrator's model and its capability probe (served window). */
  model: string;
  kind: 'local' | 'cloud';
  caps: { contextTokens: number; supportsGrammar: boolean; nativeContextTokens?: number };
  /** `vault.context` from the machine's config. */
  setting: VaultContextSetting;
  /** Room for notes in force (`vaultPackSize(machine, app)`, Vault M7, tech review
   *  L13) and the machine's cap; unset is Normal under the default cap. */
  packSize?: VaultPackSize;
  packMaxTokens?: number;
  /** The vault's resolved settings (templates folder, Obsidian's ignore
   *  filters), left out of retrieval. */
  settings?: () => Pick<ResolvedVaultSettings, 'templates' | 'ignore'> | undefined;
  signal?: AbortSignal;
  /** Test seam: the source a prepare runs on. */
  source?: VaultContextSource;
}

/**
 * Build the pack a `/chat` turn carries, the way the loop's renderPack does
 * for a session: prepared once over the caller's root, rendered for the
 * orchestrator's class and served window, on a seat that stays on this
 * network (the daemon pins `/chat` to a local orchestrator). The text goes
 * last in the system line; the event is streamed before the first text.
 * Nothing when the class's mode is off or the pack came out empty. App chats
 * never carry project secrets, so there is no lockdown.
 */
export async function buildChatPack(
  o: ChatPackOptions,
): Promise<{ text?: string; event?: ChatContextPackEvent }> {
  const profile = deriveProfile({ model: o.model, kind: o.kind, caps: o.caps });
  let mode = packModeFor(o.setting, profile.modelClass);
  if (!mode) return {};
  const root = o.root && existsSync(o.root) ? o.root : undefined;
  const source =
    o.source ??
    createVaultContextSource({
      ...(root ? { vaultRoot: root } : {}),
      privacy: o.privacy,
      ...(o.currentState ? { currentState: o.currentState } : {}),
      lockdown: { egress: false, secrets: false },
      ...(o.settings ? { settings: o.settings } : {}),
    });
  const prepared = await source.prepare(o.task, o.signal);
  if (!root) mode = 'current-state';
  const budgetTokens = packBudgetTokens(
    profile,
    o.caps.contextTokens,
    o.packSize ?? 'normal',
    o.packMaxTokens,
  );
  const pack = buildContextPack({
    mode,
    index: root ? prepared.index : null,
    query: o.task,
    ...(prepared.currentState ? { currentState: prepared.currentState } : {}),
    pins: prepared.pins,
    ...(prepared.projectPins ? { projectPins: prepared.projectPins } : {}),
    ...(prepared.handoff ? { handoff: prepared.handoff } : {}),
    budgetTokens,
    privacy: prepared.privacy,
    seat: { modelClass: profile.modelClass, leavesNetwork: false },
    lockdown: { egress: false, secrets: false },
    bodies: prepared.bodies,
  });
  if (!pack.text && !pack.withheld) return {};
  const event: ChatContextPackEvent = {
    type: 'context-pack',
    seat: 'local',
    mode,
    tokens: pack.tokens,
    budgetTokens,
    sources: pack.used,
    withheld: pack.withheld,
    cold: pack.cold,
    ...(pack.localOnly ? { localOnly: true as const } : {}),
  };
  return { ...(pack.text ? { text: pack.text } : {}), event };
}
