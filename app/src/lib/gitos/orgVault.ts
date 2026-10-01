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
// supabase/migrations/0021_org_vault_v1.sql). A conflict comes back as a
// result with theirs, so the store shows its resolve sheet the way it does
// for every other provider; the server never makes a copy for this client.
// The base lives in the open note and the stash entry, never in this module.
//
// Rename, Trash and Restore (Vault M6, CTO K3, K6, R3; migration 0024). A
// rename is org_vault_move under the source's rev; the store adopts the path
// and rev it answers. Trash is org_vault_remove under the rev (a tombstone
// plus a 'deleted' revision row); Trash lists a tombstone only while its
// newest revision of any reason is 'deleted', so a path a note moved away
// from never shows there. Restore writes that revision's body back with
// if_absent, and beside it as "{title} (restored)" when the name is taken,
// never over anything. A folder's entry names the notes its trash took, and
// its Restore brings back only those. There is no Empty Trash: the server's
// weekly purge drops tombstones and revisions after 30 days, so team Trash is
// Restore only.
//
// Settings and the plan (Vault M7, CTO L17, CX Y14, Y15; migration 0025). The
// vault's settings are one row per org, read with org_vault_settings_get and
// written, by admins only, with org_vault_settings_put under its rev. The
// text this seam carries is that jsonb rendered in Postgres's own key order,
// so a write answers the text the next read gives. The same read says
// whether the plan is active, until when a never-paid team stays editable,
// and whether this person is an admin; a write refused with OV402 (plan not
// active) marks the plan lapsed, and OV403 (admins-only delete) answers the
// Y14 line. Three settings a team vault does not carry out
// (ORG_VAULT_UNAPPLIED_SETTINGS: Delete, the attachments folder and the
// templates folder) are never read back from the row and never sent to it,
// so a stored "For good" cannot make a restorable delete look permanent.
//
// Multi-writer, so there is no single-writer lease to take: acquireLease grants
// trivially and the server resolves concurrency. Team vault is online by
// design; when there is no session it fails with a clear message rather than
// pretending to hold bytes it cannot reach.
import { isVaultConfigName, type ConfigRead, type VaultConfigName } from 'os-code/protocol';
import {
  VAULT_CONFIG_MAX_BYTES,
  foldPath,
  noteTitle,
  utf8Length,
  type VaultSettingsConfigName,
  type VaultSettingsField,
} from 'os-code/protocol';
import { isConfigured, rpc, select } from '../supabase.js';
import {
  VAULT_SETTINGS_NAME_REFUSED,
  VAULT_SETTINGS_TOO_LARGE,
  VAULT_TEAM_DELETE_ADMINS_ONLY,
  VAULT_TEAM_DELETE_REFUSED,
  VAULT_TEAM_FULL,
  VAULT_TEAM_LAPSED_NOT_SAVED,
  VAULT_TEAM_NOT_MEMBER_REASON,
  vaultNameInTrash,
  vaultNotFolderLine,
  VAULT_TEAM_NOT_READY,
  VAULT_TEAM_PATH_NOT_ALLOWED,
  VAULT_TEAM_PATH_TOO_LONG,
  VAULT_TEAM_SETTINGS_ADMINS_ONLY,
} from '../vaultCopy.js';
import { TEAM_PATH_MAX, fitMadeName, teamPathProblem } from '../vault.js';
import { isVaultFolderPath } from './folderClient.js';
import { VAULT_SETTINGS_PATH, restoredPath } from './local.js';
import { isNotePath } from './providers.js';
import type {
  Lease,
  RemoveGuard,
  RemoveResult,
  RenameGuard,
  RenameResult,
  RestoreBeside,
  RestoreReport,
  StorageProvider,
  StoredFile,
  StoredFileMeta,
  TrashEntry,
  TrashPartial,
  TrashReport,
  TrashTarget,
  WriteGuard,
  WriteResult,
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

/** What org_vault_move answers (0024). */
type MoveReply =
  | { ok: true; path: string; rev: number; updated_at: string; size: number }
  | { ok: false; conflict: 'exists' | 'missing' | 'changed'; theirs?: TheirsRow | null };

/** Who may delete team notes (0025): admins only, or every member. */
export type OrgVaultDeleteRole = 'admin' | 'member';

/** What org_vault_settings_get answers (0025). */
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

/** What org_vault_settings_put answers (0025). */
type SettingsPutReply =
  | { ok: true; rev: number; updated_at: string }
  | { ok: false; conflict: 'changed'; theirs: SettingsRow };

/** The team's plan as the Vault needs it (CX Y14, Y15): whether team notes
 *  can change, until when a never-paid team stays editable (the notice), and
 *  whether this person is an admin and who may delete. */
export interface OrgVaultPlan {
  entitled: boolean;
  /** Set only while a never-paid team has a deadline (0025's
   *  no_entitlement_vault_until); null in the beta. */
  entitledUntil?: string;
  isAdmin: boolean;
  deleteRole: OrgVaultDeleteRole;
  /** The team's free space is used up (0023), as a write this sign-in made
   *  was refused for it: what adds text is refused here, before the server
   *  is asked, until a refresh or a write that adds text lands (round 7
   *  E27). No read says so (0025's settings answer no usage), so only a
   *  refusal sets it, and a settings read keeps it. */
  full?: true;
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
 *  (octet_length over 1048576 in org_vault_put). */
// And in org_vault_write (0021, 0025), the write this client makes.
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
 *  before migration 0021 did. Not permanent, so the store stashes the text
 *  and retries it once the server catches up, and nothing is written blind
 *  through the old last-write-wins function in the meantime (CTO G3). */
export class OrgVaultNotReady extends Error {
  /** The seam's mark for the store, which says this line, never "offline"
   *  (round 7 E42); its words are vaultCopy's. */
  readonly notReady = true;
  constructor() {
    super(VAULT_TEAM_NOT_READY);
    this.name = 'OrgVaultNotReady';
  }
}

/** The team plan is not active (OV402, migration 0025): team notes are
 *  read-only, every note still reads and exports. Permanent, so a save
 *  refused mid-edit is held as Not saved with this reason (CX Y15). */
export class OrgVaultLapsed extends OrgVaultRefusal {
  /** The seam's mark for the store, which turns the open note back to the
   *  team's text once its words are held (round 7 E28). */
  readonly lapsed = true;
  constructor() {
    super(VAULT_TEAM_LAPSED_NOT_SAVED);
    this.name = 'OrgVaultLapsed';
  }
}

/** A member's delete under admins-only (OV403, migration 0025). `whole`
 *  says the message is the whole line, said as it is (CX Y14). */
export class OrgVaultDeleteRefused extends OrgVaultRefusal {
  readonly whole = true;
  constructor() {
    super(VAULT_TEAM_DELETE_REFUSED);
    this.name = 'OrgVaultDeleteRefused';
  }
}

/** A team without a live plan has used its free space (migration 0023's byte
 *  cap, raised as check_violation, SQLSTATE 23514, which PostgREST answers
 *  with a 400). Only growth is refused: a save, a new note, Today, a Restore
 *  or an Undo, and a rename once the team is past the cap. A delete always
 *  goes through but frees nothing until the weekly purge, so trying again
 *  cannot help; permanent, and its message is the reason only
 *  (VAULT_TEAM_FULL), which the store says after the verb ("Not restored."). */
export class OrgVaultFull extends OrgVaultRefusal {
  /** The seam's mark for the store (round 7 E27). */
  readonly full = true;
  constructor() {
    super(VAULT_TEAM_FULL);
    this.name = 'OrgVaultFull';
  }
}

/** A create or a move onto a name that is in Trash (E22): 0021's if_absent
 *  and 0024's move revive the tombstone at that exact path, which takes the
 *  deleted note out of Trash with no word and leaves its text unreachable,
 *  so the call is refused before it is sent. Permanent: the same name meets
 *  the same Trash. `nameInTrash` lets a caller that tries names in turn (a
 *  keep-both copy) go on to the next. */
export class OrgVaultNameInTrash extends OrgVaultRefusal {
  readonly nameInTrash = true;
  constructor(path: string) {
    super(vaultNameInTrash(noteTitle(path)));
    this.name = 'OrgVaultNameInTrash';
  }
}

/** This account is not a member of the org (0002's is_org_member, which
 *  every vault RPC asks first: 0021, 0024, 0025): an admin removed it, or it
 *  left from another device. Its selects then answer no rows (0010's RLS),
 *  as an emptied vault would, so `notMember` tells the store, which takes the
 *  team vault away rather than call its notes deleted (round 7 E26).
 *  Permanent: retrying cannot make anyone a member again. */
export class OrgVaultNotMember extends OrgVaultRefusal {
  readonly notMember = true;
  constructor() {
    super(VAULT_TEAM_NOT_MEMBER_REASON);
    this.name = 'OrgVaultNotMember';
  }
}

/** Is this the server's "not a member of this org"? A plain raise (P0001,
 *  which PostgREST answers with a 400), matched by its own words, since every
 *  other raise shares the code. */
function isNotMemberRefusal(
  e: { code?: unknown; message?: unknown } | undefined,
  status: unknown,
): boolean {
  return (
    status === 400 &&
    (e?.code === undefined || e.code === 'P0001') &&
    typeof e?.message === 'string' &&
    /^not a member of this org$/i.test(e.message.trim())
  );
}

/** Is this 0023's free space refusal? Its code, and its own words, since a
 *  check constraint on a vault table raises the same code with Postgres's
 *  message. 0023's other cap (one team without a plan per owner) is on
 *  public.orgs, which no RPC this client calls writes, so it never reaches
 *  here; only org creation meets it (the store's pushOrgToServer). */
function isFreeSpaceRefusal(e: { code?: unknown; message?: unknown } | undefined): boolean {
  return e?.code === '23514' && typeof e.message === 'string' && /\bfree space\b/i.test(e.message);
}

// A 4xx from PostgREST is the server saying no (a raised P0001 arrives as a
// 400), except the three that say "try again": 401 (a token the next refresh
// fixes), 408, and 429. Anything without a status (offline, a 5xx) is left
// as it is, so the store stashes it and retries.
// A missing function (PGRST202, a 404 on an RPC) is a server not yet
// migrated, retried the same way. OV402 and OV403 are the plan and the delete
// rule (0025), and 23514 the free space (0023), each with its own line.
const RETRYABLE_4XX = new Set([401, 408, 429]);
async function refusing<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const status = (err as { status?: unknown } | undefined)?.status;
    const e = err as { code?: unknown; message?: unknown } | undefined;
    if (e?.code === 'OV402') throw new OrgVaultLapsed();
    if (e?.code === 'OV403') throw new OrgVaultDeleteRefused();
    if (isFreeSpaceRefusal(e)) throw new OrgVaultFull();
    if (e?.code === 'PGRST202' || status === 404) throw new OrgVaultNotReady();
    if (isNotMemberRefusal(e, status)) throw new OrgVaultNotMember();
    if (typeof status === 'number' && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) {
      throw new OrgVaultRefusal(err instanceof Error ? err.message : `Request failed (${status}).`);
    }
    throw err;
  }
}

/** refusing, for one team: a plan refused as not active (OV402) marks that
 *  team's plan lapsed, so the room turns read-only and says why (CX Y15),
 *  and an admins-only delete refusal (OV403) marks who may delete, so the
 *  room drops Delete and the next one is refused before it is sent (round 7
 *  E19). */
// A refusal that answers after the sign-in it was made under ended says
// nothing about the next account's plan, so it marks none (round 7 E14).
// "Not a member" from any call tells the store once per call (E26).
async function refusingFor<T>(resourceId: string, call: () => Promise<T>): Promise<T> {
  const gen = generation;
  try {
    return await refusing(call);
  } catch (err) {
    if (gen === generation) {
      if (err instanceof OrgVaultLapsed) markLapsed(resourceId);
      if (err instanceof OrgVaultDeleteRefused) markAdminsOnly(resourceId);
      if (err instanceof OrgVaultFull) markFull(resourceId);
      if (err instanceof OrgVaultNotMember) memberListener?.(resourceId);
    }
    throw err;
  }
}

// ---------------------------------------------------------------- the plan
// The last plan each org's settings read gave, and who hears a change: the
// store, which turns the room read-only and says why (CX Y15).
const plans = new Map<string, OrgVaultPlan>();
/** Which sign-in this module's memory belongs to: resetOrgVault moves it on,
 *  and an answer to a call made under an earlier one (another account's
 *  role, plan or member labels, still on its way at the sign-out) is
 *  returned to its caller but never remembered or told (round 7 E14). */
let generation = 0;
/** The settings row's columns the sheet does not change, from the last read,
 *  so a settings write echoes them under the same rev. */
const columns = new Map<
  string,
  { rev: number; deleteRole: OrgVaultDeleteRole; contextFolder: string | null }
>();
/** How a plan was learned: a settings read, or a refusal (OV402, OV403,
 *  0023's free space) that says only part of it (round 7 E37). */
export type OrgVaultPlanSource = 'read' | 'refusal';
let planListener:
  ((resourceId: string, plan: OrgVaultPlan, learned: OrgVaultPlanSource) => void) | undefined;

/** Hear every change to a team's plan (a settings read, a write refused
 *  with OV402, or a delete refused with OV403). One listener: the store's. */
export function onOrgVaultPlan(
  fn: (resourceId: string, plan: OrgVaultPlan, learned: OrgVaultPlanSource) => void,
): void {
  planListener = fn;
}

let memberListener: ((resourceId: string) => void) | undefined;
/** Hear that the server answered "not a member of this org" for a team
 *  (round 7 E26). One listener: the store's. */
export function onOrgVaultNotMember(fn: (resourceId: string) => void): void {
  memberListener = fn;
}

/** The team's plan as last read, or undefined before the first read. */
export function orgVaultPlan(resourceId: string): OrgVaultPlan | undefined {
  const p = plans.get(resourceId);
  return p ? { ...p } : undefined;
}

function setPlan(
  resourceId: string,
  plan: OrgVaultPlan,
  learned: OrgVaultPlanSource = 'read',
): void {
  plans.set(resourceId, plan);
  planListener?.(resourceId, { ...plan }, learned);
}

function markLapsed(resourceId: string): void {
  const was = plans.get(resourceId);
  setPlan(
    resourceId,
    {
      entitled: false,
      isAdmin: was?.isAdmin ?? false,
      deleteRole: was?.deleteRole ?? 'member',
    },
    'refusal',
  );
}

/** 0023 refused a write that added text: the team is full (round 7 E27). */
function markFull(resourceId: string): void {
  const was = plans.get(resourceId);
  if (was?.full) return;
  setPlan(
    resourceId,
    {
      ...(was ?? { entitled: true, isAdmin: false, deleteRole: 'member' }),
      full: true,
    },
    'refusal',
  );
}

/** The team may have room again (a refresh asks the server afresh, or a
 *  write that added text landed): what adds text is sent again, and the
 *  server says, once, if it is still full (round 7 E27). */
export function clearOrgVaultFull(resourceId: string): void {
  const was = plans.get(resourceId);
  if (!was?.full) return;
  const { full: _full, ...rest } = was;
  setPlan(resourceId, rest);
}

/** OV403 proves three things (0025's org_vault_remove checks the plan first,
 *  then who may delete): the plan is active, deletes are admins only, and
 *  this person is not an admin. The notice date stays from the last read. */
function markAdminsOnly(resourceId: string): void {
  const was = plans.get(resourceId);
  setPlan(
    resourceId,
    {
      ...(was?.entitledUntil ? { entitledUntil: was.entitledUntil } : {}),
      entitled: true,
      isAdmin: false,
      deleteRole: 'admin',
    },
    'refusal',
  );
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
    // No read says how full the team is (0025's entitled is not 0023's
    // plan), so what a refusal learned stands (E27).
    ...(plans.get(resourceId)?.full ? { full: true as const } : {}),
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
  const gen = generation;
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
  if (gen === generation) members.set(resourceId, { at: Date.now(), labels });
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
  generation++;
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

/** Encode a note PATH for an `eq.` filter. Paths carry spaces, dots, and (for
 *  conflict copies) parentheses and commas, all of which PostgREST treats as
 *  reserved in a filter value. Wrapping the value in double quotes makes them
 *  literal; embedded quotes and backslashes are escaped first. Without this, a
 *  path like `note (conflict 2026-01-01 1200).md` would mis-parse. */
// The same for a `gt.` filter (the list's keyset paging).
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
  refusingFor(resourceId, () => readRow(auth, resourceId, path));

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
  /** A Restore putting a note back at its own name: the one create that
   *  means to revive the tombstone there. */
  opts: { revive?: boolean } = {},
): Promise<WriteResult> {
  let args: Record<string, unknown>;
  if ('ifAbsent' in guard) {
    // Never a create over a note in Trash, which would take it out (E22).
    if (!opts.revive && (await refusingFor(resourceId, () => inTrashAt(auth, resourceId, path)))) {
      throw new OrgVaultNameInTrash(path);
    }
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
  const gen = generation;
  const reply = await refusingFor(resourceId, () => rpc<WriteReply>('org_vault_write', auth, args));
  if (!reply.ok) {
    const theirs = theirsFile(reply.theirs);
    return theirs
      ? { ok: false, conflict: reply.conflict, theirs }
      : { ok: false, conflict: reply.conflict };
  }
  // A new note with text in it landed, so the team had room for it (E27).
  // A save over a note may only have trimmed it: the store judges that.
  if ('ifAbsent' in guard && text.length > 0 && gen === generation) {
    clearOrgVaultFull(resourceId);
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

/** Whether this exact path is in Trash, by the listing's rule (listTrash):
 *  its row is a tombstone and its newest ending is a delete, never a move. */
async function inTrashAt(auth: string, resourceId: string, path: string): Promise<boolean> {
  const dead = await select<{ path: string }>(
    'org_vault_notes',
    auth,
    `select=path&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&deleted=is.true&limit=1`,
  );
  if (!dead.some((r) => r.path === path)) return false;
  const ending = await select<RevisionRow>(
    'org_vault_revisions',
    auth,
    `select=id,path,reason,recorded_at&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&reason=in.(deleted,renamed)&order=id.desc&limit=1`,
  );
  return ending[0]?.reason === 'deleted';
}

/** A revision row as Trash reads it (0021's org_vault_revisions). */
interface RevisionRow {
  id: number;
  path: string;
  /** The rev the note had when this version was displaced: for a delete,
   *  the rev the remove matched (0021's org_vault_snapshot, 0025). */
  rev?: number;
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
      `select=id,path,rev,reason,recorded_at&org_id=eq.${eq(resourceId)}&reason=in.(deleted,renamed)${from}&order=id.desc&limit=${ORG_VAULT_PAGE_SIZE}`,
    );
    for (const r of got) if (!newest.has(r.path)) newest.set(r.path, r);
    if (got.length < ORG_VAULT_PAGE_SIZE) break;
    before = got[got.length - 1]!.id;
  }
  return newest;
}

// An entry's id says what it names: `n:` one note's path, `f:` one folder
// trash, with the folder and exactly the notes that trash tombstoned. A
// folder's Restore (its Undo) brings back only those, never a note deleted
// under the folder before it: a teammate's deliberate delete stays in Trash.
// Each names the rev its delete took (the 'deleted' revision's rev, which is
// the rev the remove matched), so an Undo brings back exactly what it took,
// never a later delete at the same name (round 7 E23). An id from before
// this build names no rev and restores the newest delete there, as it did.
const NOTE_ID = 'n:';
const FOLDER_ID = 'f:';

/** A deleted note in an id: its path, and the rev its delete took. */
interface TookNote {
  path: string;
  rev?: number;
}

/** A note entry's id: `n:{path}@{rev}`. A note path ends in `.md`, so the
 *  rev after the last `@` is never part of it. */
function noteEntryId(path: string, rev: number | undefined): string {
  return rev === undefined ? `${NOTE_ID}${path}` : `${NOTE_ID}${path}@${rev}`;
}

/** The note and rev a note entry's id names. */
function noteEntryOf(id: string): TookNote {
  const rest = id.slice(NOTE_ID.length);
  const m = /^(.*)@(\d{1,15})$/.exec(rest);
  return m && isNotePath(m[1]!) ? { path: m[1]!, rev: Number(m[2]) } : { path: rest };
}

/** A folder trash's id: the folder, and each note that trash tombstoned with
 *  the rev it removed. */
function folderEntryId(folder: string, took: readonly (readonly [string, number])[]): string {
  return `${FOLDER_ID}${JSON.stringify({ folder, took })}`;
}

/** The notes a folder trash's id says it tombstoned, each under its folder
 *  (with its rev, or a bare path in an id from before E23), or undefined for
 *  an id that does not say (a folder id from before that named only the
 *  folder, so which notes it took is unknown and it restores nothing rather
 *  than everything under the folder). */
function folderEntryTook(id: string): TookNote[] | undefined {
  let named: { folder?: unknown; took?: unknown };
  try {
    named = JSON.parse(id.slice(FOLDER_ID.length)) as typeof named;
  } catch {
    return undefined;
  }
  if (typeof named?.folder !== 'string' || !Array.isArray(named.took)) return undefined;
  const under = `${named.folder}/`;
  const out: TookNote[] = [];
  for (const x of named.took as unknown[]) {
    if (typeof x === 'string') {
      if (x.startsWith(under)) out.push({ path: x });
    } else if (
      Array.isArray(x) &&
      typeof x[0] === 'string' &&
      x[0].startsWith(under) &&
      Number.isSafeInteger(x[1])
    ) {
      out.push({ path: x[0], rev: x[1] as number });
    }
  }
  return out;
}

/** Refuse, before anything is sent, a note path 0015's org_vault_path_ok
 *  would refuse (E43). */
function refuseTeamPath(path: string): void {
  const problem = teamPathProblem(path);
  if (problem === 'long') throw new OrgVaultRefusal(VAULT_TEAM_PATH_TOO_LONG);
  if (problem) throw new OrgVaultRefusal(VAULT_TEAM_PATH_NOT_ALLOWED);
}

/** Put a trashed body back: its own path while free, else "{title}
 *  (restored)" beside it, never over anything. A name that already holds
 *  exactly this text is the restore already done, so a second tap lands
 *  nowhere new. */
async function putBack(
  auth: string,
  resourceId: string,
  path: string,
  body: string,
  /** Whether the tombstone at its own name is this delete's. When a later
   *  delete there is in Trash (someone made the name again and deleted it),
   *  that one keeps the name and this comes back beside it (E23). */
  own = true,
): Promise<{ file: StoredFileMeta; renamed: boolean; inTrash?: boolean }> {
  // Whether its own name was passed over because a delete there is in Trash.
  let inTrash = false;
  const beside = (n: number) => (n > 0 ? { inTrash } : {});
  for (let n = 0; n <= 99; n++) {
    // Fitted to the team's 512 characters, as a keep-both copy is (E43).
    const at = n === 0 ? path : fitMadeName(restoredPath(path, n), TEAM_PATH_MAX);
    // Back at its own name it revives its tombstone, as Restore means to; a
    // "(restored)" name that is itself in Trash is passed over, so no other
    // note leaves Trash on the way (E22).
    let r: WriteResult;
    try {
      r = await guardedWrite(
        auth,
        resourceId,
        at,
        body,
        { ifAbsent: true },
        { revive: n === 0 && own },
      );
    } catch (err) {
      if (err instanceof OrgVaultNameInTrash) {
        if (n === 0) inTrash = true;
        continue;
      }
      throw err;
    }
    if (r.ok) {
      const f = r.file;
      return {
        file: { path: f.path, updatedAt: f.updatedAt, size: utf8Length(body), version: f.version },
        renamed: n > 0,
        ...beside(n),
      };
    }
    if (r.conflict === 'exists' && r.theirs?.text === body) {
      const t = r.theirs;
      return {
        file: { path: t.path, updatedAt: t.updatedAt, size: utf8Length(body), version: t.version },
        renamed: n > 0,
        ...beside(n),
      };
    }
  }
  throw new OrgVaultRefusal(`There is no free name beside "${path}" to restore it to.`);
}

/** The 'deleted' revision a Trash entry names at a path: the one with that
 *  rev, or the newest when the entry names none; undefined when its history
 *  was cleared. */
async function deletedBody(
  auth: string,
  resourceId: string,
  path: string,
  rev?: number,
): Promise<RevisionRow | undefined> {
  const byRev = rev === undefined ? '' : `&rev=eq.${rev}`;
  const rows = await select<RevisionRow>(
    'org_vault_revisions',
    auth,
    `select=id,path,rev,reason,recorded_at,body&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&reason=eq.deleted${byRev}&order=id.desc&limit=1`,
  );
  return rows[0];
}

/** Whether a delete (by its rev) is still the newest event that ended the
 *  note at its path, so the tombstone there is its own to revive (E23). An
 *  entry that names no rev is taken as the newest, as before. */
async function ownsName(
  auth: string,
  resourceId: string,
  path: string,
  rev: number | undefined,
): Promise<boolean> {
  if (rev === undefined) return true;
  const rows = await select<RevisionRow>(
    'org_vault_revisions',
    auth,
    `select=id,rev,reason&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&reason=in.(deleted,renamed)&order=id.desc&limit=1`,
  );
  return rows[0]?.reason === 'deleted' && rows[0].rev === rev;
}

/** Whether a note is still in Trash by listTrash's own rule: its name holds
 *  a tombstone, and the newest event that ended a note there is a delete
 *  (round 7 E38). A teammate who restored it (and wrote on), or moved it on,
 *  took it out of Trash, though its 'deleted' revision is still there. */
async function stillInTrash(auth: string, resourceId: string, path: string): Promise<boolean> {
  const [dead, ending] = await Promise.all([
    select<{ path: string }>(
      'org_vault_notes',
      auth,
      `select=path&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&deleted=is.true&limit=1`,
    ),
    select<RevisionRow>(
      'org_vault_revisions',
      auth,
      `select=id,rev,reason&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&reason=in.(deleted,renamed)&order=id.desc&limit=1`,
    ),
  ]);
  if (!(dead.length > 0 && ending[0]?.reason === 'deleted')) return false;
  // Brought back beside a case twin is out of Trash too (E39).
  return !(await restoredBeside(auth, resourceId, [{ ...ending[0], path }])).has(path);
}

/** The deleted notes in `candidates` already brought back beside their own
 *  name (round 7 E39). 0021's if_absent folds letter case, so a Restore
 *  that meets a live note spelled otherwise ("PLAN.md" for "Plan.md") lands
 *  at "Plan (restored).md" and leaves the tombstone at "Plan.md", whose
 *  newest event is still its delete. By putBack's own rule (a name that
 *  already holds exactly this text is the restore already done) such an
 *  entry has nothing new to bring back, so it leaves Trash; edited since,
 *  it is listed again, and its next Restore lands "(restored 2)". One select
 *  of the live names with "restored" in them (a plain `like`, no reserved
 *  character to quote), then two reads per name that matches; anything that
 *  does not answer keeps the row. */
async function restoredBeside(
  auth: string,
  resourceId: string,
  candidates: readonly RevisionRow[],
): Promise<Set<string>> {
  const back = new Set<string>();
  if (!candidates.length) return back;
  try {
    const live = new Map<string, number>();
    let after: string | undefined;
    for (let page = 0; page < ORG_VAULT_MAX_PAGES; page++) {
      const from = after === undefined ? '' : `&path=gt.${eqPath(after)}`;
      const got = await select<{ path: string; size: number }>(
        'org_vault_notes',
        auth,
        `select=path,size&org_id=eq.${eq(resourceId)}&deleted=is.false&path=like.${eq('*restored*')}${from}&order=path.asc&limit=${ORG_VAULT_PAGE_SIZE}`,
      );
      for (const r of got) live.set(r.path, r.size);
      if (got.length < ORG_VAULT_PAGE_SIZE) break;
      after = got[got.length - 1]!.path;
    }
    if (!live.size) return back;
    for (const c of candidates) {
      const names: string[] = [];
      for (let n = 1; n <= 99; n++) {
        const at = fitMadeName(restoredPath(c.path, n), TEAM_PATH_MAX);
        if (live.has(at)) names.push(at);
      }
      if (!names.length) continue;
      const row = await deletedBody(auth, resourceId, c.path, c.rev);
      if (!row || typeof row.body !== 'string') continue;
      const body = row.body;
      const bytes = utf8Length(body);
      for (const at of names) {
        if (live.get(at) !== bytes) continue;
        const copy = await select<{ path: string; body: string }>(
          'org_vault_notes',
          auth,
          `select=path,body&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(at)}&deleted=is.false&limit=1`,
        );
        if (copy[0]?.path === at && copy[0].body === body) {
          back.add(c.path);
          break;
        }
      }
    }
  } catch {
    // A check that did not answer hides nothing: every row stays.
    return new Set();
  }
  return back;
}

/** Bring back one deleted note from the revision its entry names: at its
 *  own name while that is its to take, else beside, never over anything. */
async function restoreTook(
  auth: string,
  resourceId: string,
  took: TookNote,
): Promise<{ file: StoredFileMeta; renamed: boolean; inTrash?: boolean } | undefined> {
  const row = await refusingFor(resourceId, () =>
    deletedBody(auth, resourceId, took.path, took.rev),
  );
  if (!row || typeof row.body !== 'string') return undefined;
  const own = await refusingFor(resourceId, () => ownsName(auth, resourceId, took.path, took.rev));
  return putBack(auth, resourceId, took.path, row.body, own);
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

/** The vault settings a team vault does not carry out, each of which would
 *  say something untrue there (the team review of 2026-09-30):
 *  - `delete`: every team delete is org_vault_remove, which keeps a
 *    tombstone and a 'deleted' revision (0024) that Trash lists and any
 *    member restores until the weekly purge at 30 days, so "For good" would
 *    call a restorable delete permanent. A team delete is one tap to Trash.
 *  - `attachments.folder`: a team vault holds notes only, so no image or PDF
 *    is ever placed or found there.
 *  - `templates.folder`: its one reader keeps templates out of the notes a
 *    model is given, and no model reads team notes in v1 (D15).
 *  0025's row may hold them (its check allows the keys), so they are dropped
 *  on every read and every write here, and the sheet never offers them. */
export const ORG_VAULT_UNAPPLIED_SETTINGS: readonly VaultSettingsField[] = Object.freeze([
  'delete',
  'attachments.folder',
  'templates.folder',
]);

/** The settings without the fields a team vault does not carry out: a
 *  dotted field drops its key, and a section it leaves empty goes too. The
 *  input is never changed. */
export function orgVaultAppliedSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const out: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
  for (const field of ORG_VAULT_UNAPPLIED_SETTINGS) {
    const [head, leaf] = field.split('.') as [string, string | undefined];
    if (!Object.hasOwn(out, head)) continue;
    if (leaf === undefined) {
      delete out[head];
      continue;
    }
    const section = out[head];
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    const rest = { ...(section as Record<string, unknown>) };
    delete rest[leaf];
    if (Object.keys(rest).length) out[head] = rest;
    else delete out[head];
  }
  return out;
}

/** The settings as the seam's text: the vault file's JSON, two-space. */
export function orgVaultSettingsText(settings: unknown): string {
  return `${JSON.stringify(jsonbOrder(settings ?? {}), null, 2)}\n`;
}

const settingsFile = (row: SettingsRow): StoredFile => ({
  path: VAULT_SETTINGS_PATH,
  text: orgVaultSettingsText(orgVaultAppliedSettings(row.settings)),
  updatedAt: row.updated_at ?? new Date(0).toISOString(),
  version: versionOfRev(row.rev),
});

// A row read under an earlier sign-in is returned but not remembered (E14).
async function getSettings(auth: string, resourceId: string): Promise<SettingsRow> {
  const gen = generation;
  const row = await refusingFor(resourceId, () =>
    rpc<SettingsRow>('org_vault_settings_get', auth, { p_org: resourceId }),
  );
  if (gen === generation) rememberSettings(resourceId, row);
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
  const gen = generation;
  let cols = columns.get(resourceId);
  if (!cols || cols.rev !== baseRev) {
    const row = await getSettings(auth, resourceId);
    cols = columns.get(resourceId) ?? {
      rev: row.rev,
      deleteRole: row.delete_role === 'admin' ? 'admin' : 'member',
      contextFolder: row.context_folder ?? null,
    };
  }
  const reply = await refusingFor(resourceId, () =>
    rpc<SettingsPutReply>('org_vault_settings_put', auth, {
      p_org: resourceId,
      p_settings: orgVaultAppliedSettings(settings),
      p_delete_role: deleteRole ?? cols.deleteRole,
      p_context_folder: cols.contextFolder,
      p_base_rev: baseRev,
    }),
  );
  if (gen !== generation) return reply;
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
/** Read the team's plan again (one settings read) and return it, or
 *  undefined when the read did not answer. Never throws: the store asks
 *  this only when the plan it has would refuse a write, and a read that
 *  fails leaves that refusal standing (round 7 E37). */
export async function refreshOrgVaultPlan(resourceId: string): Promise<OrgVaultPlan | undefined> {
  try {
    await getSettings(await token(), resourceId);
  } catch {
    return undefined;
  }
  return orgVaultPlan(resourceId);
}

export async function setOrgVaultDeleteRole(
  resourceId: string,
  role: OrgVaultDeleteRole,
): Promise<'ok' | 'changed'> {
  const auth = await token();
  const now = await getSettings(auth, resourceId);
  // The read just made answers what 0025's put checks first (an admin, then
  // the plan), so a write it would refuse is refused here, in the app's
  // words, and never sent (round 7 E55).
  if (now.is_admin === false) throw new OrgVaultRefusal(VAULT_TEAM_SETTINGS_ADMINS_ONLY);
  if (now.entitled === false) throw new OrgVaultLapsed();
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
  unappliedSettings: ORG_VAULT_UNAPPLIED_SETTINGS,

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
    // 0015's path rule, checked first as the server does, so a name it would
    // refuse is never sent and is said in plain words (round 7 E43).
    refuseTeamPath(path);
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
    const reply = await refusingFor(resourceId, () =>
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

  // ---- Vault M6 (CTO K3, K6, R3; migration 0024) ----------------------------

  async rename(resourceId, from, to, guard: RenameGuard): Promise<RenameResult> {
    if (!isNotePath(from))
      throw new OrgVaultRefusal(`"${from}" is not a note, so the vault does not move it.`);
    if (!isNotePath(to)) throw new OrgVaultRefusal(`"${to}" is not a note name the vault can use.`);
    refuseTeamPath(to);
    const auth = await token();
    const rev = revOf(guard.ifMatch);
    if (rev === undefined) {
      const now = await headFor(auth, resourceId, from);
      return now
        ? { ok: false, conflict: 'changed', theirs: asFile(now) }
        : { ok: false, conflict: 'missing' };
    }
    const folded = await refusingFor(resourceId, () => foldedTaken(auth, resourceId, to, from));
    if (folded) return { ok: false, conflict: 'exists', theirs: folded };
    // A move onto a name in Trash revives that tombstone (0024): refused (E22).
    if (to !== from && (await refusingFor(resourceId, () => inTrashAt(auth, resourceId, to)))) {
      throw new OrgVaultNameInTrash(to);
    }
    const reply = await refusingFor(resourceId, () =>
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
  async trash(resourceId, target: TrashTarget): Promise<TrashReport> {
    if (target.kind === 'note' && !isNotePath(target.path)) {
      throw new OrgVaultRefusal(`"${target.path}" is not a note, so the vault does not move it.`);
    }
    if (target.kind === 'folder' && !isVaultFolderPath(target.path)) {
      throw new OrgVaultRefusal(vaultNotFolderLine(target.path));
    }
    const auth = await token();
    const trashedAt = new Date().toISOString();
    // A remove that went through answers the rev it matched: its entry
    // names it (E23).
    const drop = async (
      path: string,
      version: string,
    ): Promise<{ ok: true; removed: number } | Exclude<RemoveResult, { ok: true }> | 'gone'> => {
      const rev = revOf(version);
      if (rev === undefined) {
        const now = await headFor(auth, resourceId, path);
        return now ? { ok: false, conflict: 'changed', theirs: asFile(now) } : 'gone';
      }
      const reply = await refusingFor(resourceId, () =>
        rpc<RemoveReply>('org_vault_remove', auth, {
          p_org: resourceId,
          p_path: path,
          p_if_match: rev,
        }),
      );
      if (reply.ok) return reply.rev === undefined ? 'gone' : { ok: true, removed: rev };
      const theirs = theirsFile(reply.theirs);
      return theirs
        ? { ok: false, conflict: 'changed', theirs }
        : { ok: false, conflict: 'changed' };
    };
    if (target.kind === 'note') {
      const r = await drop(target.path, target.ifMatch);
      // Gone before this trash (a teammate deleted or moved it): nothing
      // went to Trash here, and the store says it is gone, never "changed".
      if (r === 'gone') return { ok: false, conflict: 'missing' };
      if (!r.ok)
        return r.theirs
          ? { ok: false, conflict: 'changed', theirs: r.theirs }
          : { ok: false, conflict: 'changed' };
      return {
        ok: true,
        entry: {
          id: noteEntryId(target.path, r.removed),
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
    // The notes this trash tombstoned, and only those, go in its entry's id,
    // each with the rev it removed (E23).
    const took: Array<[string, number]> = [];
    // A folder goes note by note, each its own call: one stopped part way (a
    // plan that lapsed, admins-only switched on, the network, a 5xx) says
    // what went to Trash and what is left, with its Undo, and throws only
    // when nothing went (round 7 E20).
    let partial: TrashPartial | undefined;
    const inside = (await orgVaultProvider.list(resourceId)).filter((f) =>
      f.path.startsWith(under),
    );
    // A note a teammate saves again after the one retry is passed over, not
    // trashed at a version nobody here has seen; it stays, and the answer
    // names it (round 7 E21).
    const changed: string[] = [];
    for (const [i, f] of inside.entries()) {
      try {
        let r = await drop(f.path, f.version ?? '');
        if (r !== 'gone' && !r.ok && r.theirs?.version) r = await drop(f.path, r.theirs.version);
        if (r === 'gone') continue;
        if (r.ok) took.push([f.path, r.removed]);
        else changed.push(f.path);
      } catch (err) {
        if (!took.length) throw err;
        const left = inside.filter((x, j) => j >= i || changed.includes(x.path)).map((x) => x.path);
        partial = {
          trashed: took.length,
          left,
          ...(err instanceof OrgVaultDeleteRefused
            ? { line: VAULT_TEAM_DELETE_ADMINS_ONLY }
            : err instanceof OrgVaultRefusal
              ? { line: err.message }
              : {}),
          ...(err instanceof OrgVaultLapsed ? { lapsed: true as const } : {}),
          ...(changed.length ? { changed: [...changed] } : {}),
        };
        break;
      }
    }
    if (changed.length && !took.length) {
      return {
        ok: false,
        conflict: 'changed',
        partial: { trashed: 0, left: [...changed], changed: [...changed] },
      };
    }
    if (changed.length && !partial) {
      partial = { trashed: took.length, left: [...changed], changed: [...changed] };
    }
    return {
      ok: true,
      entry: {
        id: folderEntryId(target.path, took),
        path: target.path,
        kind: 'folder',
        size: 0,
        trashedAt,
      },
      notes: took.length,
      attachments: 0,
      ...(partial ? { partial } : {}),
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
    const back = await restoredBeside(
      auth,
      resourceId,
      [...endings.values()].filter((r) => r.reason === 'deleted' && dead.has(r.path)),
    );
    for (const [path, r] of endings) {
      if (r.reason !== 'deleted' || !dead.has(path) || back.has(path)) continue;
      out.push({
        id: noteEntryId(path, r.rev),
        path,
        kind: 'note',
        size: 0,
        trashedAt: r.recorded_at,
      });
    }
    return out.sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
  },

  // A note comes back from its newest 'deleted' revision; a folder brings
  // back the notes that its trash took and that are still in Trash, never
  // one deleted under it before (a teammate's delete is theirs to undo).
  // Never over anything (R3).
  //
  // A folder is caught note by note (0023): a note refused for good (the
  // team's free space) stays in Trash and the rest are still tried, since a
  // smaller one may fit; a plan that is not active, or a failure that would
  // fail every later call the same way (offline), stops there. When some came
  // back, the answer says how many and which stayed (`partial`); when none
  // did, the first refusal (or the failure) is thrown as a note's would be.
  async restore(resourceId, id, opts): Promise<RestoreReport> {
    const auth = await token();
    if (id.startsWith(NOTE_ID)) {
      const took = noteEntryOf(id);
      // A row from the Trash page that a teammate already brought back, or
      // moved on, is no longer in Trash: nothing is written, never a stale
      // "(restored)" copy beside their note (E38). An Undo is this device's
      // own, and brings back what its delete took (E23).
      if (
        opts?.listed &&
        !(await refusingFor(resourceId, () => stillInTrash(auth, resourceId, took.path)))
      ) {
        return { ok: false, conflict: 'missing' };
      }
      const back = await restoreTook(auth, resourceId, took);
      if (!back) return { ok: false, conflict: 'missing' };
      const { file, renamed, inTrash } = back;
      return {
        ok: true,
        file,
        renamed,
        ...(renamed
          ? { beside: [{ from: took.path, to: file.path, inTrash: inTrash === true }] }
          : {}),
      };
    }
    if (id.startsWith(FOLDER_ID)) {
      const named = folderEntryTook(id) ?? [];
      if (!named.length) return { ok: false, conflict: 'missing' };
      // Each note that names its rev comes back from that revision, at its
      // name or beside whatever holds it now (E23). An id from before names
      // bare paths, and brings back those still in Trash, as it did.
      const bare = named.filter((x) => x.rev === undefined).map((x) => x.path);
      const inTrash = bare.length
        ? new Set((await orgVaultProvider.listTrash!(resourceId)).map((e) => e.path))
        : new Set<string>();
      const entries = named.filter((x) => x.rev !== undefined || inTrash.has(x.path));
      let first: StoredFileMeta | undefined;
      let renamed = false;
      let restored = 0;
      const left: string[] = [];
      let refusal: OrgVaultRefusal | undefined;
      let failure: unknown;
      const beside: RestoreBeside[] = [];
      const sorted = entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      for (const [i, e] of sorted.entries()) {
        try {
          const back = await restoreTook(auth, resourceId, e);
          if (!back) continue;
          first ??= back.file;
          renamed ||= back.renamed;
          restored += 1;
          if (back.renamed) {
            beside.push({ from: e.path, to: back.file.path, inTrash: back.inTrash === true });
          }
        } catch (err) {
          if (err instanceof OrgVaultRefusal && !(err instanceof OrgVaultLapsed)) {
            refusal ??= err;
            left.push(e.path);
            continue;
          }
          failure = err;
          left.push(...sorted.slice(i).map((x) => x.path));
          break;
        }
      }
      // A plan that is not active outranks the free space: nothing lands.
      const why = failure instanceof OrgVaultRefusal ? failure : refusal;
      if (!first) {
        if (why) throw why;
        if (failure !== undefined) throw failure;
        return { ok: false, conflict: 'missing' };
      }
      const besides = beside.length ? { beside } : {};
      if (!left.length) return { ok: true, file: first, renamed, ...besides };
      return {
        ok: true,
        file: first,
        renamed,
        partial: { restored, left, ...(why ? { line: why.message } : {}) },
        ...besides,
      };
    }
    return { ok: false, conflict: 'missing' };
  },

  // No emptyTrash: the team's Trash is Restore only (R3); the server's
  // weekly purge drops what has been there 30 days.

  // ---- Vault M7 (CTO L7, L17; CX Y14, Y15; migration 0025) ------------------

  // Only the vault's own settings live on the server; Obsidian's files never
  // do, so each of their names reads absent. The read also brings the plan.
  async readConfig(resourceId, name: VaultConfigName): Promise<ConfigRead> {
    if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
    if (name !== 'oscode/vault') return { ok: false, reason: 'absent' };
    let row: SettingsRow;
    try {
      row = await getSettings(await token(), resourceId);
    } catch (err) {
      // A server without 0025 yet has no settings to give: the defaults.
      if (err instanceof OrgVaultNotReady) return { ok: false, reason: 'unsupported' };
      throw err;
    }
    if (!row.rev) return { ok: false, reason: 'absent' };
    return {
      ok: true,
      text: orgVaultSettingsText(orgVaultAppliedSettings(row.settings)),
      version: versionOfRev(row.rev),
    };
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
    // What the team vault does not carry out is never sent (see
    // ORG_VAULT_UNAPPLIED_SETTINGS), so the text this answers is the next read's.
    const settings = orgVaultAppliedSettings(parsed);
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
