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
// Multi-writer, so there is no single-writer lease to take: acquireLease grants
// trivially and the server resolves concurrency. Team vault is online by
// design; when there is no session it fails with a clear message rather than
// pretending to hold bytes it cannot reach.
import { isConfigured, rpc, select } from '../supabase.js';
import type {
  Lease,
  RemoveGuard,
  RemoveResult,
  StorageProvider,
  StoredFile,
  StoredFileMeta,
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

/** What org_vault_remove answers. */
type RemoveReply =
  | { ok: true; path: string; rev?: number }
  | { ok: false; conflict: 'changed'; theirs?: TheirsRow | null };

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

// A 4xx from PostgREST is the server saying no (a raised P0001 arrives as a
// 400), except the three that say "try again": 401 (a token the next refresh
// fixes), 408, and 429, and a missing function (PGRST202, a 404 on an RPC),
// which is a server not yet migrated. Anything without a status (offline, a
// 5xx) is left as it is, so the store stashes it and retries.
const RETRYABLE_4XX = new Set([401, 408, 429]);
async function refusing<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const e = err as { status?: unknown; code?: unknown } | undefined;
    const status = e?.status;
    if (e?.code === 'PGRST202' || status === 404) throw new OrgVaultNotReady();
    if (typeof status === 'number' && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) {
      throw new OrgVaultRefusal(err instanceof Error ? err.message : `Request failed (${status}).`);
    }
    throw err;
  }
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
  refusing(() => readRow(auth, resourceId, path));

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
  const reply = await refusing(() => rpc<WriteReply>('org_vault_write', auth, args));
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
    const reply = await refusing(() =>
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
};

export type { StoredFileMeta };
