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

/** `DELETE /vault/notes/<path>?ifMatch=<version>` 200. Trash is M6. */
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
