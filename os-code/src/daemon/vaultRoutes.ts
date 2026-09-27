// The daemon's vault routes and the desktop chat's pack (Vault M5, CTO J6,
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
import type { IncomingHttpHeaders } from 'node:http';
import { VAULT_FOLDER_MISSING } from '../config/load.js';
import { readVaultConfigFile } from '../core/vault/configFile.js';
import { createVaultContextSource } from '../core/vault/contextSource.js';
import { openEngineVaultIndex } from '../core/vault/engineIndex.js';
import {
  isVaultNotePath,
  parseVaultGuard,
  readVaultFile,
  removeVaultFile,
  writeVaultFile,
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
import type { VaultPrivacy } from '../harness/vault/types.js';
import {
  VAULT_WIRE_LIST_MAX,
  VAULT_WIRE_NOTE_MAX_BYTES,
  type ChatContextPackEvent,
  type HubNoteMeta,
  type VaultConfigResponse,
  type VaultNoteConflictResponse,
  type VaultNoteReadResponse,
  type VaultNotesListResponse,
  type VaultPrivacyWire,
} from './vaultWire.js';

/** What a vault route answers: a JSON body, or raw text with its headers
 *  (the saved index, which the phone parses itself, and a 304). */
export type VaultRouteAnswer =
  | { status: number; json: unknown }
  | { status: number; raw: string; headers: Record<string, string> };

export interface VaultRouteRequest {
  method: string;
  /** The path segments after `vault`, still URI-encoded. */
  parts: readonly string[];
  url: URL;
  headers: IncomingHttpHeaders;
  /** The caller's own root (`vaultRootFor(auth)`). */
  root: string;
  /** The body as a JSON object (serve.ts's bounded reader). */
  readBody(): Promise<Record<string, unknown>>;
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

/** One vault route. `parts` starts after `vault`. */
export async function vaultRoute(req: VaultRouteRequest): Promise<VaultRouteAnswer> {
  const [area, ...rest] = req.parts;
  const { method, root } = req;

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

  if (area === 'config' && rest.length === 1 && method === 'GET') {
    let name: string;
    try {
      name = decodeURIComponent(rest[0]!);
    } catch {
      return err(400, 'That is not a config name.');
    }
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
// The desktop chat's pack (CTO J6)

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
    });
  const prepared = await source.prepare(o.task, o.signal);
  if (!root) mode = 'current-state';
  const budgetTokens = packBudgetTokens(profile, o.caps.contextTokens);
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
  };
  return { ...(pack.text ? { text: pack.text } : {}), event };
}
