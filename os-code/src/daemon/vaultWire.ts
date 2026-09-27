// The daemon's vault wire (Vault M5, CTO J6 and J7): the shapes the hub serves
// so a paired phone reaches the one vault on the person's computer, and the
// additive `/chat` fields that let the daemon build the desktop chat's pack.
// Types and plain constants only, exported through os-code/protocol, so the
// app's hub provider (app/src/lib/gitos/hub.ts) and the daemon's handler
// (daemon/vaultRoutes.ts) agree without sharing any Node code.
//
// Every route is scoped to the caller's own root (`vaultRootFor(auth)`): the
// owner and the legacy shared token get the machine's vault, a member gets
// their own. Every field is additive; an old daemon ignores them and an old
// app sends none.
import type { AgentEvent } from '../core/agent/types.js';
import type { AttachmentMeta, VaultTrashEntry } from '../harness/vault/types.js';

/** The route prefix every vault route shares. */
export const VAULT_ROUTE_PREFIX = '/vault';
/** `GET` lists; `GET/PUT/DELETE <prefix>/<path>` reads, writes, removes. */
export const VAULT_NOTES_ROUTE = '/vault/notes';
/** `GET <prefix>/<name>` reads one allow-listed config file
 *  (`isVaultConfigName`), capped at `VAULT_CONFIG_MAX_BYTES`. */
export const VAULT_CONFIG_ROUTE = '/vault/config';
/** `GET` the caller's privacy rules (`VaultPrivacyWire`). */
export const VAULT_PRIVACY_ROUTE = '/vault/privacy';
/** `GET` the engine's saved index file, with an ETag; `If-None-Match` gives
 *  304. Capped at `VAULT_INDEX_FILE_MAX_BYTES`; 404 when there is none. */
export const VAULT_INDEX_ROUTE = '/vault/index';

/** The largest note text a PUT carries, in UTF-8 bytes. Under the daemon's
 *  8 MB JSON body limit with room for the envelope. A larger PUT is 413. */
export const VAULT_WIRE_NOTE_MAX_BYTES = 4 * 1024 * 1024;
/** The most notes one listing returns; past it `truncated` is true. */
export const VAULT_WIRE_LIST_MAX = 20_000;

/** The route for one note: each segment URI-encoded, "/" kept. The daemon
 *  decodes, then checks `isNotePath` and the Jail before touching disk. */
export function vaultNoteRoute(path: string): string {
  return `${VAULT_NOTES_ROUTE}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** One note's metadata on the wire. `version` is the F1 version token (the
 *  same `noteVersion` the engine's writes guard on); `mtime` is ISO 8601;
 *  `size` is in bytes. */
export interface HubNoteMeta {
  path: string;
  version: string;
  size: number;
  mtime: string;
}

/** `GET /vault/notes`: the `listVaultNotes` walk of the caller's root. */
export interface VaultNotesListResponse {
  notes: HubNoteMeta[];
  /** The walk stopped at its ceiling or `VAULT_WIRE_LIST_MAX`. */
  truncated: boolean;
}

/** `GET /vault/notes/<path>`: 200 with the note, or 404. */
export interface VaultNoteReadResponse {
  path: string;
  text: string;
  version: string;
  mtime: string;
}

/** `PUT /vault/notes/<path>` body. At most one guard: `ifMatch` replaces the
 *  note only while its version is still this one; `ifAbsent` creates it only
 *  while nothing has the name. Neither writes unconditionally (the phone's
 *  own write, no approval). */
export interface VaultNotePutBody {
  text: string;
  ifMatch?: string;
  ifAbsent?: true;
}

/** `PUT` 200. */
export interface VaultNotePutResponse {
  meta: HubNoteMeta;
}

/** `PUT` or `DELETE` 409. `changed`: the version moved on; `exists`: an
 *  `ifAbsent` create found a note; `missing`: an `ifMatch` found none (the
 *  engine's `writeNote` reports it, so the wire carries it too). `current` is
 *  the note's metadata now, when there is one. */
export interface VaultNoteConflictResponse {
  conflict: 'changed' | 'exists' | 'missing';
  current?: HubNoteMeta;
}

/** `DELETE /vault/notes/<path>?ifMatch=<version>` 200. A permanent delete;
 *  M6's Trash is `POST /vault/trash`. */
export interface VaultNoteDeleteResponse {
  ok: true;
}

/** `GET /vault/config/<name>` 200; 404 when absent, 413 when over the cap. */
export interface VaultConfigResponse {
  name: string;
  text: string;
  version: string;
}

/** `GET /vault/privacy`: the machine's own privacy keys for the caller's
 *  root (`vault.exclude`, `vault.localOnly`), compiled on the phone with
 *  `compileVaultPrivacy`. Never from a project file. */
export interface VaultPrivacyWire {
  exclude: string[];
  localOnly: { paths: string[]; tags: string[] };
}

/** An error body any vault route may answer with (400, 401, 403, 404, 413). */
export interface VaultWireError {
  error: string;
}

// ---------------------------------------------------------------------------
// /chat (CTO J6)

/** The `/chat` body's additive vault fields. The daemon builds the pack over
 *  the caller's root; `cwd` gives Current State only when it passes the same
 *  checks a session create does. The phone never ships note bodies. */
export interface ChatVaultFields {
  vaultPack?: { cwd?: string; projectName?: string };
  /** Memory off: no pack, no handoff read. */
  memory?: false;
}

/** The `context-pack` line `/chat` streams before its first text, the same
 *  fields as the `context-pack` AgentEvent. */
export type ChatContextPackEvent = Extract<AgentEvent, { type: 'context-pack' }>;

// ---------------------------------------------------------------------------
// Session create (CTO J12, J14)

/** The session create body's additive fields. */
export interface SessionCreateVaultFields {
  /** A handoff to prepend to the first task's preamble, at most
   *  `HANDOFF_MAX_BYTES` (harness/handoff.ts). */
  handoff?: string;
  /** The project's own pins (`Project.vaultPins`), at most 8 paths. */
  vaultPins?: string[];
}

// ---------------------------------------------------------------------------
// Vault M6 (CTO K13): rename, folders, Trash and attachments, each on the
// caller's own root (D9), each path through `isNotePath` or
// `isAttachmentPath` and the Jail. `.trash` is reached only by the trash
// routes. No agent tool changes: the agent cannot rename, trash or read
// `.trash` in M6 (D4 holds). Wave 0 contracts; stream B serves them and
// stream C calls them.

/** `POST` renames one note (`VaultRenameBody`). */
export const VAULT_RENAME_ROUTE = '/vault/rename';
/** `GET` lists the real folders, empty ones too; `POST` creates one
 *  (`VaultFolderCreateBody`). */
export const VAULT_FOLDERS_ROUTE = '/vault/folders';
/** `POST` renames a folder (`VaultFolderRenameBody`). */
export const VAULT_FOLDERS_RENAME_ROUTE = '/vault/folders/rename';
/** `GET` lists Trash; `POST` moves a note or a folder there
 *  (`VaultTrashBody`); `DELETE` empties it (`VaultTrashEmptyBody`). */
export const VAULT_TRASH_ROUTE = '/vault/trash';
/** `POST` restores one entry (`VaultTrashRestoreBody`). */
export const VAULT_TRASH_RESTORE_ROUTE = '/vault/trash/restore';
/** `GET` lists the attachments (`VaultAttachmentsListResponse`). */
export const VAULT_ATTACHMENTS_ROUTE = '/vault/attachments';
/** `GET <prefix>/<path>` answers one attachment's bytes with its allow-listed
 *  type, `X-Content-Type-Options: nosniff`, `Content-Disposition:
 *  attachment`, an ETag (its version), and the 20 MB cap
 *  (`VAULT_ATTACHMENT_MAX_BYTES`, harness/vault/attachments.ts): 413 over it,
 *  404 when absent, 415 for a type outside the list. */
export const VAULT_FILES_ROUTE = '/vault/files';

/** The route for one attachment, encoded as `vaultNoteRoute` encodes a note. */
export function vaultFileRoute(path: string): string {
  return `${VAULT_FILES_ROUTE}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** `POST /vault/rename` body. Never replaces: `to` must be free (judged by
 *  the folded path), except a case-only rename of the same note. */
export interface VaultRenameBody {
  from: string;
  to: string;
  ifMatch: string;
}

/** `POST /vault/rename` 200: the note at `to`, with its version there. */
export interface VaultRenameResponse {
  meta: HubNoteMeta;
}

/** `POST /vault/rename` 409. `current` is the note that has `to` (`exists`)
 *  or the source as it is now (`changed`). */
export interface VaultRenameConflictResponse {
  conflict: 'changed' | 'missing' | 'exists' | 'downloading';
  current?: HubNoteMeta;
}

/** `GET /vault/folders` 200. */
export interface VaultFoldersListResponse {
  folders: string[];
}

/** `POST /vault/folders` body; 200 `{ ok: true }`, 409 `{ conflict: 'exists' }`. */
export interface VaultFolderCreateBody {
  path: string;
}

/** `POST /vault/folders/rename` body: one directory rename, `to` absent. */
export interface VaultFolderRenameBody {
  from: string;
  to: string;
}

/** `POST /vault/folders/rename` 200: every note that moved, with its new
 *  version, and how many attachments moved with them. */
export interface VaultFolderRenameResponse {
  moved: Array<{ from: string; to: string; version: string }>;
  attachments: number;
}

/** `POST /vault/folders` or `/vault/folders/rename` 409. */
export interface VaultFolderConflictResponse {
  conflict: 'exists' | 'missing';
}

/** `POST /vault/trash` body: a note guarded by its version, or a folder as it
 *  is (Trash is recoverable, so a folder move is unguarded, K6). */
export type VaultTrashBody =
  { kind: 'note'; path: string; ifMatch: string } | { kind: 'folder'; path: string };

/** `POST /vault/trash` 200, with what went in. */
export interface VaultTrashResponse {
  entry: VaultTrashEntry;
  notes: number;
  attachments: number;
}

/** `POST /vault/trash` 409: the note's version moved on. */
export interface VaultTrashConflictResponse {
  conflict: 'changed' | 'downloading';
  current?: HubNoteMeta;
}

/** `GET /vault/trash` 200. */
export interface VaultTrashListResponse {
  entries: VaultTrashEntry[];
}

/** `POST /vault/trash/restore` body. Restore never overwrites: a taken name
 *  lands beside it as "{title} (restored)" (R3), parents made. */
export interface VaultTrashRestoreBody {
  id: string;
}

/** `POST /vault/trash/restore` 200; 409 `{ conflict: 'missing' }`. */
export interface VaultTrashRestoreResponse {
  meta: HubNoteMeta;
  renamed: boolean;
}

/** `DELETE /vault/trash` body: the entries to delete for good, or none for
 *  all of Trash. */
export interface VaultTrashEmptyBody {
  ids?: string[];
}

/** `DELETE /vault/trash` 200. */
export interface VaultTrashEmptyResponse {
  removed: number;
}

/** `GET /vault/attachments` 200: the same walk as the note list. */
export interface VaultAttachmentsListResponse {
  attachments: AttachmentMeta[];
  truncated: boolean;
}
