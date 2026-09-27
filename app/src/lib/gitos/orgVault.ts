// The Team vault storage provider: the organization tier of Vault, backed by
// Supabase (Postgres + PostgREST) so every active member of an org reads and
// writes one shared tree of notes. It slots into the gitOS seam like any other
// provider, so the Vault UI never learns the bytes live in Postgres rather than
// on a device.
//
// The resourceId for a team vault IS the org's server id (its `orgs.id` uuid),
// so one org has one team vault in v1. Membership is enforced server-side.
//
// Compare-and-swap (Vault M2 2.1 and 2.3, CTO G3): a note's version is its
// server rev as a string, the same token from list, stat, read, and write. A
// write goes through org_vault_write with exactly one guard and a remove
// through org_vault_remove with the rev it was read at (see
// supabase/migrations/0019_org_vault_v1.sql). A conflict comes back as a
// result with theirs, so the store shows its resolve sheet the way it does
// for every other provider; the server never makes a copy for this client.
// The base lives in the open note and the stash entry, never in this module.
//
// Rename, Trash and Restore (Vault M6, CTO K3, K6, R3; migration 0020). A
// rename is org_vault_move under the source's rev; the store adopts the path
// and rev it answers. Trash is org_vault_remove under the rev (a tombstone
// plus a 'deleted' revision row); Trash lists a tombstone only while its
// newest revision of any reason is 'deleted', so a path a note moved away
// from never shows there. Restore writes that revision's body back with
// if_absent, and beside it as "{title} (restored)" when the name is taken,
// never over anything. There is no Empty Trash: the server's weekly purge
// drops tombstones and revisions after 30 days, so team Trash is Restore only.
//
// Settings and the plan (Vault M7, CTO L17, CX Y14, Y15; migration 0021). The
// vault's settings are one row per org, read with org_vault_settings_get and
// written, by admins only, with org_vault_settings_put under its rev. The
// text this seam carries is that jsonb rendered in Postgres's own key order,
// so a write answers the text the next read gives. The same read says
// whether the plan is active, until when a never-paid team stays editable,
// and whether this person is an admin; a write refused with OV402 (plan not
// active) marks the plan lapsed, and OV403 (admins-only delete) answers the
// Y14 line.
//
// Multi-writer, so there is no single-writer lease to take: acquireLease grants
// trivially and the server resolves concurrency. Team vault is online by
// design; when there is no session it fails with a clear message rather than
// pretending to hold bytes it cannot reach.
import {
  VAULT_CONFIG_MAX_BYTES,
  foldPath,
  isVaultConfigName,
  utf8Length,
  type ConfigRead,
  type VaultConfigName,
  type VaultSettingsConfigName,
} from 'os-code/protocol';
import { isConfigured, rpc, select } from '../supabase.js';
import {
  VAULT_SETTINGS_NAME_REFUSED,
  VAULT_SETTINGS_TOO_LARGE,
  VAULT_TEAM_DELETE_REFUSED,
  VAULT_TEAM_LAPSED_NOT_SAVED,
  vaultNotFolderLine,
} from '../vaultCopy.js';
import { isVaultFolderPath } from './folderClient.js';
import {
  VAULT_SETTINGS_PATH,
  isNotePath,
  restoredPath,
  type Lease,
  type RemoveGuard,
  type RemoveResult,
  type RenameGuard,
  type RenameResult,
  type RestoreResult,
  type StorageProvider,
  type StoredFile,
  type StoredFileMeta,
  type TrashEntry,
  type TrashResult,
  type TrashTarget,
  type WriteGuard,
  type WriteResult,
} from './providers.js';

interface NoteRow {
  path: string;
  body: string;
  updated_at: string;
  updated_by: string | null;
  rev: number;
  size: number;
}

/** A note as a conflict result carries it (org_vault_theirs). */
interface TheirsRow {
  path: string;
  body: string;
  rev: number;
  updated_at: string;
  updated_by: string | null;
}

/** What org_vault_write answers. */
type WriteReply =
  | { ok: true; path: string; rev: number; updated_at: string; size: number }
  | { ok: false; conflict: 'exists' | 'missing' | 'changed'; theirs?: TheirsRow | null };

/** What org_vault_remove answers. `rev` is there only when it made the
 *  tombstone; a note already gone answers ok with no rev. */
type RemoveReply =
  | { ok: true; path: string; rev?: number }
  | { ok: false; conflict: 'changed'; theirs?: TheirsRow | null };

/** What org_vault_move answers (0020). */
type MoveReply =
  | { ok: true; path: string; rev: number; updated_at: string; size: number }
  | { ok: false; conflict: 'exists' | 'missing' | 'changed'; theirs?: TheirsRow | null };

/** Who may delete team notes (0021): admins only, or every member. */
export type OrgVaultDeleteRole = 'admin' | 'member';

/** What org_vault_settings_get answers (0021). */
interface SettingsRow {
  settings: Record<string, unknown>;
  delete_role: OrgVaultDeleteRole;
  context_folder: string | null;
  rev: number;
  updated_at: string | null;
  updated_by: string | null;
  entitled: boolean;
  entitled_until: string | null;
  is_admin: boolean;
}

/** What org_vault_settings_put answers (0021). */
type SettingsPutReply =
  | { ok: true; rev: number; updated_at: string }
  | { ok: false; conflict: 'changed'; theirs: SettingsRow };

/** The team's plan as the Vault needs it (CX Y14, Y15): whether team notes
 *  can change, until when a never-paid team stays editable (the notice), and
 *  whether this person is an admin and who may delete. */
export interface OrgVaultPlan {
  entitled: boolean;
  /** Set only while a never-paid team has a deadline (0021's
   *  no_entitlement_vault_until); null in the beta. */
  entitledUntil?: string;
  isAdmin: boolean;
  deleteRole: OrgVaultDeleteRole;
}

// The store owns the Supabase session and the active org, so it registers a
// fresh-token getter and a readiness predicate here rather than this module
// reaching into the store (which would be a cycle).
let getToken: (() => Promise<string | undefined>) | undefined;
let readyPredicate: (() => boolean) | undefined;

/** Wire the team vault to the signed-in session. `token` returns a fresh access
 *  token, undefined when there is no session, and throws when a refresh could
 *  not reach the server; `ready` is true when the user is an active member of
 *  an org that has a server id. */
export function setOrgVaultAuth(
  token: () => Promise<string | undefined>,
  ready: () => boolean,
): void {
  getToken = token;
  readyPredicate = ready;
}

/** Whether the team vault is usable right now: accounts configured on this
 *  build, and the user is an active org member. probeReady('org') defers here. */
export function isOrgVaultAvailable(): boolean {
  return isConfigured() && Boolean(readyPredicate?.());
}

/** The team vault's per-note cap, the same byte count the server enforces
 *  (octet_length over 1048576 in org_vault_write). */
export const ORG_VAULT_NOTE_LIMIT_BYTES = 1_048_576;

/** One page of a list. PostgREST caps a select at max_rows (1000), so a
 *  single select would silently drop the rest; the list pages by path. */
export const ORG_VAULT_PAGE_SIZE = 500;
/** The most pages one list walks: 50,000 notes. */
export const ORG_VAULT_MAX_PAGES = 100;

/** How long the member labels behind "Edited by" are reused (CTO G6). */
export const ORG_VAULT_MEMBERS_TTL_MS = 10 * 60 * 1000;

/** A team vault refusal that retrying cannot fix: over the 1 MB cap, a path
 *  the server does not allow, not a member, or no team session. `permanent`
 *  is the seam's mark for it, so the store holds the text as "Not saved"
 *  instead of stashing it for a replay that would fail forever (orgvault-9).
 *  The message is the server's own line, or ours for a check made here. */
export class OrgVaultRefusal extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'OrgVaultRefusal';
  }
}

/** The server does not have the guarded functions yet (PostgREST PGRST202,
 *  function not found, which arrives as a 404): a build that reached people
 *  before migration 0019 did. Not permanent, so the store stashes the text
 *  and retries it once the server catches up, and nothing is written blind
 *  through the old last-write-wins function in the meantime (CTO G3). */
export class OrgVaultNotReady extends Error {
  constructor() {
    super('The team vault is being updated. Your text is kept and saves when it is ready.');
    this.name = 'OrgVaultNotReady';
  }
}

/** The team plan is not active (OV402, migration 0021): team notes are
 *  read-only, every note still reads and exports. Permanent, so a save
 *  refused mid-edit is held as Not saved with this reason (CX Y15). */
export class OrgVaultLapsed extends OrgVaultRefusal {
  constructor() {
    super(VAULT_TEAM_LAPSED_NOT_SAVED);
    this.name = 'OrgVaultLapsed';
  }
}

/** A member's delete under admins-only (OV403, migration 0021). `whole`
 *  says the message is the whole line, said as it is (CX Y14). */
export class OrgVaultDeleteRefused extends OrgVaultRefusal {
  readonly whole = true;
  constructor() {
    super(VAULT_TEAM_DELETE_REFUSED);
    this.name = 'OrgVaultDeleteRefused';
  }
}

// A 4xx from PostgREST is the server saying no (a raised P0001 arrives as a
// 400), except the three that say "try again": 401 (a token the next refresh
// fixes), 408, and 429, and a missing function (PGRST202, a 404 on an RPC),
// which is a server not yet migrated. Anything without a status (offline, a
// 5xx) is left as it is, so the store stashes it and retries. OV402 and OV403
// are the plan and the delete rule (0021), each with its own line.
const RETRYABLE_4XX = new Set([401, 408, 429]);
async function refusing<T>(resourceId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const e = err as { status?: unknown; code?: unknown } | undefined;
    const status = e?.status;
    if (e?.code === 'OV402') {
      markLapsed(resourceId);
      throw new OrgVaultLapsed();
    }
    if (e?.code === 'OV403') throw new OrgVaultDeleteRefused();
    if (e?.code === 'PGRST202' || status === 404) throw new OrgVaultNotReady();
    if (typeof status === 'number' && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) {
      throw new OrgVaultRefusal(err instanceof Error ? err.message : `Request failed (${status}).`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------- the plan
// The last plan each org's settings read gave, and who hears a change: the
// store, which turns the room read-only and says why (CX Y15).
const plans = new Map<string, OrgVaultPlan>();
/** The settings row's columns the sheet does not change, from the last read,
 *  so a settings write echoes them under the same rev. */
const columns = new Map<
  string,
  { rev: number; deleteRole: OrgVaultDeleteRole; contextFolder: string | null }
>();
let planListener: ((resourceId: string, plan: OrgVaultPlan) => void) | undefined;

/** Hear every change to a team's plan (a settings read, or a write refused
 *  with OV402). One listener: the store's. */
export function onOrgVaultPlan(fn: (resourceId: string, plan: OrgVaultPlan) => void): void {
  planListener = fn;
}

/** The team's plan as last read, or undefined before the first read. */
export function orgVaultPlan(resourceId: string): OrgVaultPlan | undefined {
  const p = plans.get(resourceId);
  return p ? { ...p } : undefined;
}

function setPlan(resourceId: string, plan: OrgVaultPlan): void {
  plans.set(resourceId, plan);
  planListener?.(resourceId, { ...plan });
}

function markLapsed(resourceId: string): void {
  const was = plans.get(resourceId);
  setPlan(resourceId, {
    entitled: false,
    isAdmin: was?.isAdmin ?? false,
    deleteRole: was?.deleteRole ?? 'member',
  });
}

function rememberSettings(resourceId: string, row: SettingsRow): void {
  columns.set(resourceId, {
    rev: row.rev,
    deleteRole: row.delete_role === 'admin' ? 'admin' : 'member',
    contextFolder: row.context_folder ?? null,
  });
  setPlan(resourceId, {
    entitled: row.entitled !== false,
    ...(row.entitled_until ? { entitledUntil: row.entitled_until } : {}),
    isAdmin: row.is_admin === true,
    deleteRole: row.delete_role === 'admin' ? 'admin' : 'member',
  });
}

// ---------------------------------------------------------------- editedBy
// Who last changed a note, as a short label: one select of the org's active
// members (user_id, email), which members can already read under RLS, reused
// for ten minutes. The label is the email's local part, never the address.
const members = new Map<string, { at: number; labels: Map<string, string> }>();

async function memberLabels(resourceId: string, auth: string): Promise<Map<string, string>> {
  const hit = members.get(resourceId);
  if (hit && Date.now() - hit.at < ORG_VAULT_MEMBERS_TTL_MS) return hit.labels;
  const labels = new Map<string, string>();
  try {
    const rows = await select<{ user_id: string | null; email: string | null }>(
      'org_members',
      auth,
      `select=user_id,email&org_id=eq.${eq(resourceId)}&status=eq.active`,
    );
    for (const r of rows) {
      const local = r.email?.split('@')[0]?.trim();
      if (r.user_id && local) labels.set(r.user_id, local);
    }
  } catch {
    // A label is a nicety: a list never fails for want of one. Not cached,
    // so the next list asks again.
    return hit?.labels ?? labels;
  }
  members.set(resourceId, { at: Date.now(), labels });
  return labels;
}

function editedBy(
  updatedBy: string | null | undefined,
  labels: Map<string, string>,
): Pick<StoredFileMeta, 'editedBy'> {
  if (!updatedBy) return {};
  const label = labels.get(updatedBy);
  return { editedBy: label ? { id: updatedBy, label } : { id: updatedBy } };
}

/** Forget the module's per-account state (the member labels). Call on
 *  sign-out / account switch so one account's team-vault state never carries
 *  into the next on a shared device. */
export function resetOrgVault(): void {
  members.clear();
  plans.clear();
  columns.clear();
}

/** @deprecated Kept as a shim until the store drops it (Vault M2 wave 2,
 *  CTO G3): the base is now the note's version, String(rev), carried in the
 *  open note and the stash entry, so this module keeps no revs. Always
 *  undefined. */
export function orgVaultBaseRev(_resourceId: string, _path: string): number | undefined {
  return undefined;
}

/** @deprecated Kept as a shim until the store drops it (Vault M2 wave 2,
 *  CTO G3). Does nothing: a replay sends its base as the write's ifMatch. */
export function seedOrgVaultBaseRev(_resourceId: string, _path: string, _rev: number): void {
  // Nothing to seed: the guard carries the base.
}

// No token means no session: a refusal, since retrying cannot sign anyone in.
// A getter that throws (a token refresh that could not reach the server) is
// passed through as it is, so the store stashes the text and retries it.
async function token(): Promise<string> {
  const t = await getToken?.();
  if (!t) throw new OrgVaultRefusal('Sign in to your team to use the team vault.');
  return t;
}

/** Encode a plain (reserved-char-free) value for an `eq.` filter, e.g. an org
 *  uuid. */
function eq(value: string): string {
  return encodeURIComponent(value);
}

/** Encode a note PATH for an `eq.` or `gt.` filter. Paths carry spaces, dots,
 *  and (for conflict copies) parentheses and commas, all of which PostgREST
 *  treats as reserved in a filter value. Wrapping the value in double quotes
 *  makes them literal; embedded quotes and backslashes are escaped first.
 *  Without this, a path like `note (conflict 2026-01-01 1200).md` would
 *  mis-parse. */
function eqPath(path: string): string {
  const quoted = '"' + path.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return encodeURIComponent(quoted);
}

/** The version token for a rev: opaque to everyone above the seam. */
const versionOfRev = (rev: number): string => String(rev);

/** The rev a version names, or undefined when it is not one of ours (a base
 *  from before M2 was an ISO time, which can never equal a rev). */
function revOf(version: string): number | undefined {
  if (!/^\d{1,15}$/.test(version)) return undefined;
  const n = Number(version);
  return Number.isSafeInteger(n) ? n : undefined;
}

function theirsFile(t: TheirsRow | null | undefined): StoredFile | undefined {
  if (!t) return undefined;
  return { path: t.path, text: t.body, updatedAt: t.updated_at, version: versionOfRev(t.rev) };
}

async function readRow(
  auth: string,
  resourceId: string,
  path: string,
): Promise<NoteRow | undefined> {
  const rows = await select<NoteRow>(
    'org_vault_notes',
    auth,
    `select=path,body,updated_at,updated_by,rev&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&deleted=is.false&limit=1`,
  );
  return rows[0];
}

/** readRow as the first step of a write or remove, so its failure is
 *  classified the way the write's own would be (a refusal holds the text). */
const headFor = (auth: string, resourceId: string, path: string) =>
  refusing(resourceId, () => readRow(auth, resourceId, path));

const asFile = (r: NoteRow): StoredFile => ({
  path: r.path,
  text: r.body,
  updatedAt: r.updated_at,
  version: versionOfRev(r.rev),
});

async function guardedWrite(
  auth: string,
  resourceId: string,
  path: string,
  text: string,
  guard: WriteGuard,
): Promise<WriteResult> {
  let args: Record<string, unknown>;
  if ('ifAbsent' in guard) {
    args = { p_org: resourceId, p_path: path, p_body: text, p_if_absent: true };
  } else {
    const rev = revOf(guard.ifMatch);
    if (rev === undefined) {
      // A base that is not a rev (an ISO time from a draft stashed before
      // M2) never matches: answer as the server would, with what is there.
      const now = await headFor(auth, resourceId, path);
      return now
        ? { ok: false, conflict: 'changed', theirs: asFile(now) }
        : { ok: false, conflict: 'missing' };
    }
    args = { p_org: resourceId, p_path: path, p_body: text, p_if_match: rev };
  }
  const reply = await refusing(resourceId, () => rpc<WriteReply>('org_vault_write', auth, args));
  if (!reply.ok) {
    const theirs = theirsFile(reply.theirs);
    return theirs
      ? { ok: false, conflict: reply.conflict, theirs }
      : { ok: false, conflict: reply.conflict };
  }
  return {
    ok: true,
    file: { path: reply.path, text, updatedAt: reply.updated_at, version: versionOfRev(reply.rev) },
  };
}

// ---------------------------------------------------------------- M6 helpers

/** A note by the folded rule (case and Unicode form, one foldPath), for the
 *  one case the server's lower() cannot judge: a name with letters outside
 *  ASCII, which may be spelled composed or decomposed. The listing is read
 *  only then, so a plain rename costs one call. */
async function foldedTaken(
  auth: string,
  resourceId: string,
  to: string,
  except: string,
): Promise<StoredFile | undefined> {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(to)) return undefined;
  const want = foldPath(to);
  const hit = (await orgVaultProvider.list(resourceId)).find(
    (f) => f.path !== except && f.path !== to && foldPath(f.path) === want,
  );
  if (!hit) return undefined;
  const row = await headFor(auth, resourceId, hit.path);
  return row ? asFile(row) : undefined;
}

/** A revision row as Trash reads it (0019's org_vault_revisions). */
interface RevisionRow {
  id: number;
  path: string;
  reason: 'overwritten' | 'deleted' | 'renamed';
  recorded_at: string;
  body?: string;
}

/** Every tombstone's path, keyset-paged by path like the list. */
async function tombstonePaths(auth: string, resourceId: string): Promise<Set<string>> {
  const out = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < ORG_VAULT_MAX_PAGES; page++) {
    const from = after === undefined ? '' : `&path=gt.${eqPath(after)}`;
    const got = await select<{ path: string }>(
      'org_vault_notes',
      auth,
      `select=path&org_id=eq.${eq(resourceId)}&deleted=is.true${from}&order=path.asc&limit=${ORG_VAULT_PAGE_SIZE}`,
    );
    for (const r of got) out.add(r.path);
    if (got.length < ORG_VAULT_PAGE_SIZE) break;
    after = got[got.length - 1]!.path;
  }
  return out;
}

/** Each path's newest delete-or-move revision, newest first by id (the
 *  per-path lock orders a path's rows by id). An overwrite can never be
 *  newer than the event that made a tombstone, so these two reasons decide
 *  (m6 glue D). Keyset-paged by id. */
async function newestEndings(auth: string, resourceId: string): Promise<Map<string, RevisionRow>> {
  const newest = new Map<string, RevisionRow>();
  let before: number | undefined;
  for (let page = 0; page < ORG_VAULT_MAX_PAGES; page++) {
    const from = before === undefined ? '' : `&id=lt.${before}`;
    const got = await select<RevisionRow>(
      'org_vault_revisions',
      auth,
      `select=id,path,reason,recorded_at&org_id=eq.${eq(resourceId)}&reason=in.(deleted,renamed)${from}&order=id.desc&limit=${ORG_VAULT_PAGE_SIZE}`,
    );
    for (const r of got) if (!newest.has(r.path)) newest.set(r.path, r);
    if (got.length < ORG_VAULT_PAGE_SIZE) break;
    before = got[got.length - 1]!.id;
  }
  return newest;
}

// An entry's id says what it names: `n:` one note's path, `f:` a folder's.
const NOTE_ID = 'n:';
const FOLDER_ID = 'f:';

/** Put a trashed body back: its own path while free, else "{title}
 *  (restored)" beside it, never over anything. A name that already holds
 *  exactly this text is the restore already done, so a second tap lands
 *  nowhere new. */
async function putBack(
  auth: string,
  resourceId: string,
  path: string,
  body: string,
): Promise<{ file: StoredFileMeta; renamed: boolean }> {
  for (let n = 0; n <= 99; n++) {
    const at = n === 0 ? path : restoredPath(path, n);
    const r = await guardedWrite(auth, resourceId, at, body, { ifAbsent: true });
    if (r.ok) {
      const f = r.file;
      return {
        file: { path: f.path, updatedAt: f.updatedAt, size: utf8Length(body), version: f.version },
        renamed: n > 0,
      };
    }
    if (r.conflict === 'exists' && r.theirs?.text === body) {
      const t = r.theirs;
      return {
        file: { path: t.path, updatedAt: t.updatedAt, size: utf8Length(body), version: t.version },
        renamed: n > 0,
      };
    }
  }
  throw new OrgVaultRefusal(`There is no free name beside "${path}" to restore it to.`);
}

/** The newest 'deleted' revision's body at a path, or undefined. */
async function deletedBody(
  auth: string,
  resourceId: string,
  path: string,
): Promise<RevisionRow | undefined> {
  const rows = await select<RevisionRow>(
    'org_vault_revisions',
    auth,
    `select=id,path,reason,recorded_at,body&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&reason=eq.deleted&order=id.desc&limit=1`,
  );
  return rows[0];
}

// ---------------------------------------------------------------- M7 helpers

/** Postgres's jsonb key order: shorter keys first, then by UTF-8 bytes. The
 *  settings text is rendered in it, so what a write answers is what the
 *  next read gives. */
function jsonbOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v && typeof v === 'object') {
    const enc = new TextEncoder();
    const keys = Object.keys(v).sort((a, b) => {
      const x = enc.encode(a);
      const y = enc.encode(b);
      if (x.length !== y.length) return x.length - y.length;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
      return 0;
    });
    return Object.fromEntries(keys.map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** The settings as the seam's text: the vault file's JSON, two-space. */
export function orgVaultSettingsText(settings: unknown): string {
  return `${JSON.stringify(jsonbOrder(settings ?? {}), null, 2)}\n`;
}

const settingsFile = (row: SettingsRow): StoredFile => ({
  path: VAULT_SETTINGS_PATH,
  text: orgVaultSettingsText(row.settings),
  updatedAt: row.updated_at ?? new Date(0).toISOString(),
  version: versionOfRev(row.rev),
});

async function getSettings(auth: string, resourceId: string): Promise<SettingsRow> {
  const row = await refusing(resourceId, () =>
    rpc<SettingsRow>('org_vault_settings_get', auth, { p_org: resourceId }),
  );
  rememberSettings(resourceId, row);
  return row;
}

/** Write the org's settings row whole under `baseRev`, echoing the columns
 *  the caller does not change from the read that `baseRev` came from. */
async function putSettings(
  auth: string,
  resourceId: string,
  settings: Record<string, unknown>,
  baseRev: number,
  deleteRole?: OrgVaultDeleteRole,
): Promise<SettingsPutReply> {
  let cols = columns.get(resourceId);
  if (!cols || cols.rev !== baseRev) {
    await getSettings(auth, resourceId);
    cols = columns.get(resourceId)!;
  }
  const reply = await refusing(resourceId, () =>
    rpc<SettingsPutReply>('org_vault_settings_put', auth, {
      p_org: resourceId,
      p_settings: settings,
      p_delete_role: deleteRole ?? cols.deleteRole,
      p_context_folder: cols.contextFolder,
      p_base_rev: baseRev,
    }),
  );
  if (reply.ok) {
    columns.set(resourceId, {
      rev: reply.rev,
      deleteRole: deleteRole ?? cols.deleteRole,
      contextFolder: cols.contextFolder,
    });
    if (deleteRole) {
      const was = plans.get(resourceId);
      if (was) setPlan(resourceId, { ...was, deleteRole });
    }
  } else {
    rememberSettings(resourceId, reply.theirs);
  }
  return reply;
}

/** An admin changes who may delete team notes (CX Y14). The settings stay
 *  as they are; the write is guarded by the rev just read, so a change from
 *  another admin in between is `changed`, never lost. */
export async function setOrgVaultDeleteRole(
  resourceId: string,
  role: OrgVaultDeleteRole,
): Promise<'ok' | 'changed'> {
  const auth = await token();
  const now = await getSettings(auth, resourceId);
  const reply = await putSettings(auth, resourceId, now.settings ?? {}, now.rev, role);
  return reply.ok ? 'ok' : 'changed';
}

export const orgVaultProvider: StorageProvider = {
  id: 'org',
  label: 'Team vault',
  blurb: 'Shared with your organization. Every member reads and writes it.',
  ready: false,
  pending: 'Sign in to your team to use this.',
  compareAndSwap: true,

  // Keyset paging (CTO G3): ordered by path, each page starts after the last
  // path of the one before, until a short page. Offsets would skip or repeat
  // a note when a teammate creates or removes one between pages.
  async list(resourceId) {
    const auth = await token();
    const rows: NoteRow[] = [];
    let after: string | undefined;
    for (let page = 0; page < ORG_VAULT_MAX_PAGES; page++) {
      const from = after === undefined ? '' : `&path=gt.${eqPath(after)}`;
      const got = await select<NoteRow>(
        'org_vault_notes',
        auth,
        `select=path,updated_at,updated_by,rev,size&org_id=eq.${eq(resourceId)}&deleted=is.false${from}&order=path.asc&limit=${ORG_VAULT_PAGE_SIZE}`,
      );
      rows.push(...got);
      if (got.length < ORG_VAULT_PAGE_SIZE) break;
      after = got[got.length - 1]!.path;
    }
    const labels = await memberLabels(resourceId, auth);
    return rows.map((r) => ({
      path: r.path,
      updatedAt: r.updated_at,
      size: r.size,
      version: versionOfRev(r.rev),
      ...editedBy(r.updated_by, labels),
    }));
  },

  async stat(resourceId, path) {
    const auth = await token();
    const rows = await select<NoteRow>(
      'org_vault_notes',
      auth,
      `select=path,updated_at,updated_by,rev,size&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&deleted=is.false&limit=1`,
    );
    const r = rows[0];
    if (!r) return undefined;
    const labels = await memberLabels(resourceId, auth);
    return {
      path: r.path,
      updatedAt: r.updated_at,
      size: r.size,
      version: versionOfRev(r.rev),
      ...editedBy(r.updated_by, labels),
    };
  },

  async read(resourceId, path) {
    const r = await readRow(await token(), resourceId, path);
    return r ? asFile(r) : undefined;
  },

  async write(resourceId, path, text, guard?: WriteGuard): Promise<WriteResult> {
    // Checked here, before the send, so an oversized paste is refused at once
    // in plain words rather than after a round trip.
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > ORG_VAULT_NOTE_LIMIT_BYTES) {
      const mb = (bytes / ORG_VAULT_NOTE_LIMIT_BYTES).toFixed(1);
      throw new OrgVaultRefusal(`A team note is limited to 1 MB, and this one is ${mb} MB.`);
    }
    const auth = await token();
    if (guard) return guardedWrite(auth, resourceId, path, text, guard);
    // The server takes no unguarded write. An unguarded caller asked for
    // "whatever is there now", so guard on exactly that: the rev we see, or
    // absent. A teammate landing in between is still a conflict, not a loss.
    const now = await headFor(auth, resourceId, path);
    return guardedWrite(
      auth,
      resourceId,
      path,
      text,
      now ? { ifMatch: versionOfRev(now.rev) } : { ifAbsent: true },
    );
  },

  async remove(resourceId, path, guard?: RemoveGuard): Promise<RemoveResult> {
    const auth = await token();
    let rev: number | undefined;
    if (guard) {
      rev = revOf(guard.ifMatch);
      if (rev === undefined) {
        // Not a rev, so it cannot be the note's: gone is ok, else changed.
        const now = await headFor(auth, resourceId, path);
        return now ? { ok: false, conflict: 'changed', theirs: asFile(now) } : { ok: true };
      }
    } else {
      // An unguarded remove means the note as it is now.
      const now = await headFor(auth, resourceId, path);
      if (!now) return { ok: true };
      rev = now.rev;
    }
    const reply = await refusing(resourceId, () =>
      rpc<RemoveReply>('org_vault_remove', auth, {
        p_org: resourceId,
        p_path: path,
        p_if_match: rev,
      }),
    );
    if (reply.ok) return { ok: true };
    const theirs = theirsFile(reply.theirs);
    return theirs ? { ok: false, conflict: 'changed', theirs } : { ok: false, conflict: 'changed' };
  },

  // Multi-writer: there is no lease to contend for. Grant it so callers that
  // gate on holding a lease proceed; the server resolves real concurrency.
  async acquireLease(_resourceId, holder, ttlMs): Promise<Lease> {
    return { holder, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  },

  async releaseLease() {
    // Nothing held, nothing to release.
  },

  // ---- Vault M6 (CTO K3, K6, R3; migration 0020) ----------------------------

  async rename(resourceId, from, to, guard: RenameGuard): Promise<RenameResult> {
    if (!isNotePath(from))
      throw new OrgVaultRefusal(`"${from}" is not a note, so the vault does not move it.`);
    if (!isNotePath(to)) throw new OrgVaultRefusal(`"${to}" is not a note name the vault can use.`);
    const auth = await token();
    const rev = revOf(guard.ifMatch);
    if (rev === undefined) {
      const now = await headFor(auth, resourceId, from);
      return now
        ? { ok: false, conflict: 'changed', theirs: asFile(now) }
        : { ok: false, conflict: 'missing' };
    }
    const folded = await refusing(resourceId, () => foldedTaken(auth, resourceId, to, from));
    if (folded) return { ok: false, conflict: 'exists', theirs: folded };
    const reply = await refusing(resourceId, () =>
      rpc<MoveReply>('org_vault_move', auth, {
        p_org: resourceId,
        p_from: from,
        p_to: to,
        p_if_match: rev,
      }),
    );
    if (!reply.ok) {
      const theirs = theirsFile(reply.theirs);
      return theirs
        ? { ok: false, conflict: reply.conflict, theirs }
        : { ok: false, conflict: reply.conflict };
    }
    // The path and rev the server answers, never the `to` sent.
    return {
      ok: true,
      file: {
        path: reply.path,
        updatedAt: reply.updated_at,
        size: reply.size,
        version: versionOfRev(reply.rev),
      },
    };
  },

  // A note goes under its rev; a folder is every note under it, each under
  // the rev it was listed at (one retry on a teammate's save in between).
  // Only notes live here, so a folder with none moves nothing.
  async trash(resourceId, target: TrashTarget): Promise<TrashResult> {
    if (target.kind === 'note' && !isNotePath(target.path)) {
      throw new OrgVaultRefusal(`"${target.path}" is not a note, so the vault does not move it.`);
    }
    if (target.kind === 'folder' && !isVaultFolderPath(target.path)) {
      throw new OrgVaultRefusal(vaultNotFolderLine(target.path));
    }
    const auth = await token();
    const trashedAt = new Date().toISOString();
    const drop = async (path: string, version: string): Promise<RemoveResult | 'gone'> => {
      const rev = revOf(version);
      if (rev === undefined) {
        const now = await headFor(auth, resourceId, path);
        return now ? { ok: false, conflict: 'changed', theirs: asFile(now) } : 'gone';
      }
      const reply = await refusing(resourceId, () =>
        rpc<RemoveReply>('org_vault_remove', auth, {
          p_org: resourceId,
          p_path: path,
          p_if_match: rev,
        }),
      );
      if (reply.ok) return reply.rev === undefined ? 'gone' : { ok: true };
      const theirs = theirsFile(reply.theirs);
      return theirs
        ? { ok: false, conflict: 'changed', theirs }
        : { ok: false, conflict: 'changed' };
    };
    if (target.kind === 'note') {
      const r = await drop(target.path, target.ifMatch);
      // Gone before this trash: nothing went to Trash, as a stale remove.
      if (r === 'gone') return { ok: false, conflict: 'changed' };
      if (!r.ok)
        return r.theirs
          ? { ok: false, conflict: 'changed', theirs: r.theirs }
          : { ok: false, conflict: 'changed' };
      return {
        ok: true,
        entry: {
          id: `${NOTE_ID}${target.path}`,
          path: target.path,
          kind: 'note',
          size: 0,
          trashedAt,
        },
        notes: 1,
        attachments: 0,
      };
    }
    const under = `${target.path}/`;
    let notes = 0;
    for (const f of await orgVaultProvider.list(resourceId)) {
      if (!f.path.startsWith(under)) continue;
      let r = await drop(f.path, f.version ?? '');
      if (r !== 'gone' && !r.ok && r.theirs?.version) r = await drop(f.path, r.theirs.version);
      if (r !== 'gone' && r.ok) notes++;
    }
    return {
      ok: true,
      entry: {
        id: `${FOLDER_ID}${target.path}`,
        path: target.path,
        kind: 'folder',
        size: 0,
        trashedAt,
      },
      notes,
      attachments: 0,
    };
  },

  // A tombstone is in Trash only while its newest revision of any reason is
  // 'deleted' (m6 glue D): a path a note was moved away from never shows.
  // The listing carries no bodies, so `size` is 0 (the Trash view never shows
  // it).
  async listTrash(resourceId): Promise<TrashEntry[]> {
    const auth = await token();
    const [dead, endings] = await Promise.all([
      tombstonePaths(auth, resourceId),
      newestEndings(auth, resourceId),
    ]);
    const out: TrashEntry[] = [];
    for (const [path, r] of endings) {
      if (r.reason !== 'deleted' || !dead.has(path)) continue;
      out.push({ id: `${NOTE_ID}${path}`, path, kind: 'note', size: 0, trashedAt: r.recorded_at });
    }
    return out.sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
  },

  // A note comes back from its newest 'deleted' revision; a folder brings
  // back every note of it still in Trash. Never over anything (R3).
  async restore(resourceId, id): Promise<RestoreResult> {
    const auth = await token();
    if (id.startsWith(NOTE_ID)) {
      const path = id.slice(NOTE_ID.length);
      const rev = await refusing(resourceId, () => deletedBody(auth, resourceId, path));
      if (!rev || typeof rev.body !== 'string') return { ok: false, conflict: 'missing' };
      return { ok: true, ...(await putBack(auth, resourceId, path, rev.body)) };
    }
    if (id.startsWith(FOLDER_ID)) {
      const under = `${id.slice(FOLDER_ID.length)}/`;
      const entries = (await orgVaultProvider.listTrash!(resourceId)).filter((e) =>
        e.path.startsWith(under),
      );
      let first: StoredFileMeta | undefined;
      let renamed = false;
      for (const e of entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
        const rev = await refusing(resourceId, () => deletedBody(auth, resourceId, e.path));
        if (!rev || typeof rev.body !== 'string') continue;
        const back = await putBack(auth, resourceId, e.path, rev.body);
        first ??= back.file;
        renamed ||= back.renamed;
      }
      return first ? { ok: true, file: first, renamed } : { ok: false, conflict: 'missing' };
    }
    return { ok: false, conflict: 'missing' };
  },

  // No emptyTrash: the team's Trash is Restore only (R3); the server's
  // weekly purge drops what has been there 30 days.

  // ---- Vault M7 (CTO L7, L17; CX Y14, Y15; migration 0021) ------------------

  // Only the vault's own settings live on the server; Obsidian's files never
  // do, so each of their names reads absent. The read also brings the plan.
  async readConfig(resourceId, name: VaultConfigName): Promise<ConfigRead> {
    if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
    if (name !== 'oscode/vault') return { ok: false, reason: 'absent' };
    let row: SettingsRow;
    try {
      row = await getSettings(await token(), resourceId);
    } catch (err) {
      // A server without 0021 yet has no settings to give: the defaults.
      if (err instanceof OrgVaultNotReady) return { ok: false, reason: 'unsupported' };
      throw err;
    }
    if (!row.rev) return { ok: false, reason: 'absent' };
    return { ok: true, text: orgVaultSettingsText(row.settings), version: versionOfRev(row.rev) };
  },

  // Admins only, the server says (a member's write is refused there too).
  // The text is the vault file's JSON; `ifAbsent` is rev 0 (no row yet).
  async writeConfig(
    resourceId,
    name: VaultSettingsConfigName,
    text: string,
    guard: WriteGuard,
  ): Promise<WriteResult> {
    if (name !== 'oscode/vault') throw new OrgVaultRefusal(VAULT_SETTINGS_NAME_REFUSED);
    if (utf8Length(text) > VAULT_CONFIG_MAX_BYTES) {
      throw new OrgVaultRefusal(VAULT_SETTINGS_TOO_LARGE);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new OrgVaultRefusal('Team vault settings must be one JSON object, so nothing changed.');
    }
    const settings = parsed as Record<string, unknown>;
    const auth = await token();
    let base: number;
    if ('ifAbsent' in guard) {
      base = 0;
    } else {
      const rev = revOf(guard.ifMatch);
      if (!rev) {
        const now = await getSettings(auth, resourceId);
        return now.rev
          ? { ok: false, conflict: 'changed', theirs: settingsFile(now) }
          : { ok: false, conflict: 'missing' };
      }
      base = rev;
    }
    const reply = await putSettings(auth, resourceId, settings, base);
    if (!reply.ok) {
      if (!reply.theirs.rev) return { ok: false, conflict: 'missing' };
      return {
        ok: false,
        conflict: 'ifAbsent' in guard ? 'exists' : 'changed',
        theirs: settingsFile(reply.theirs),
      };
    }
    return {
      ok: true,
      file: {
        path: VAULT_SETTINGS_PATH,
        text: orgVaultSettingsText(settings),
        updatedAt: reply.updated_at,
        version: versionOfRev(reply.rev),
      },
    };
  },
};

export type { StoredFileMeta };
