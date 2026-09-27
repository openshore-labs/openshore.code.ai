// The Team vault storage provider: the organization tier of Vault, backed by
// Supabase (Postgres + PostgREST) so every active member of an org reads and
// writes one shared tree of notes. It slots into the gitOS seam like any other
// provider, so the Vault UI never learns the bytes live in Postgres rather than
// on a device.
//
// The resourceId for a team vault IS the org's server id (its `orgs.id` uuid),
// so one org has one team vault in v1. Membership and the last-write-wins
// conflict-copy rule are enforced server-side by the org_vault_put /
// org_vault_delete RPCs (see supabase/migrations/0010_org_vault.sql); this
// client only tracks the rev it last read so it can hand the RPC an honest
// base to detect a concurrent write.
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
  StoredFileMeta,
  WriteGuard,
  WriteResult,
} from './providers.js';

interface NoteRow {
  path: string;
  body: string;
  updated_at: string;
  rev: number;
  size: number;
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

// Per-note base revision, keyed by "<org>::<path>", set only when we read a
// note's body or write it, and consumed on the next write. A missing entry
// means "new note" and is sent as base 0, which never matches a real rev, so
// the server treats a surprise existing note as a conflict and copies it
// aside. list() and stat() never touch it: they run on every foreground, every
// save, and every backlink pass, and letting them advance the base under a
// stale open draft sent the teammate's rev as ours, so the server saw no
// conflict and made no copy (orgvault-1).
const baseRev = new Map<string, number>();
const revKey = (resourceId: string, path: string) => `${resourceId}::${path}`;

/** The team vault's per-note cap, the same byte count the server enforces
 *  (octet_length over 1048576 in org_vault_put). */
export const ORG_VAULT_NOTE_LIMIT_BYTES = 1_048_576;

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

// A 4xx from PostgREST is the server saying no (a raised P0001 arrives as a
// 400), except the three that say "try again": 401 (a token the next refresh
// fixes), 408, and 429. Anything without a status (offline, a 5xx) is left
// as it is, so the store stashes it and retries.
const RETRYABLE_4XX = new Set([401, 408, 429]);
async function refusing<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const status = (err as { status?: unknown } | undefined)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) {
      throw new OrgVaultRefusal(err instanceof Error ? err.message : `Request failed (${status}).`);
    }
    throw err;
  }
}

/** Forget all cached base revisions. Call on sign-out / account switch so one
 *  account's team-vault state never carries into the next on a shared device.
 *  The store also clears the on-screen vault state; this clears the module cache
 *  that would otherwise outlive it. */
export function resetOrgVault(): void {
  baseRev.clear();
}

/** The rev this device last read or wrote for a note, or undefined. The store
 *  keeps it with an offline draft, because this cache is memory only: after a
 *  relaunch a replay would otherwise send base 0, and the server would set the
 *  unchanged note aside as a conflict copy for nothing. */
export function orgVaultBaseRev(resourceId: string, path: string): number | undefined {
  return baseRev.get(revKey(resourceId, path));
}

/** Put back the rev an offline draft was typed against, just before its
 *  replay writes it. The store calls this only after stat() showed the note
 *  still at that version, so the rev is the server's current one. */
export function seedOrgVaultBaseRev(resourceId: string, path: string, rev: number): void {
  baseRev.set(revKey(resourceId, path), rev);
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
function eqPath(path: string): string {
  const quoted = '"' + path.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return encodeURIComponent(quoted);
}

export const orgVaultProvider: StorageProvider = {
  id: 'org',
  label: 'Team vault',
  blurb: 'Shared with your organization. Every member reads and writes it.',
  ready: false,
  pending: 'Sign in to your team to use this.',

  async list(resourceId) {
    const rows = await select<NoteRow>(
      'org_vault_notes',
      await token(),
      `select=path,updated_at,rev,size&org_id=eq.${eq(resourceId)}&deleted=is.false&order=path`,
    );
    return rows.map((r) => ({ path: r.path, updatedAt: r.updated_at, size: r.size }));
  },

  async stat(resourceId, path) {
    const rows = await select<NoteRow>(
      'org_vault_notes',
      await token(),
      `select=path,updated_at,rev,size&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&deleted=is.false&limit=1`,
    );
    const r = rows[0];
    if (!r) return undefined;
    return { path: r.path, updatedAt: r.updated_at, size: r.size };
  },

  async read(resourceId, path) {
    const rows = await select<NoteRow>(
      'org_vault_notes',
      await token(),
      `select=path,body,updated_at,rev&org_id=eq.${eq(resourceId)}&path=eq.${eqPath(path)}&deleted=is.false&limit=1`,
    );
    const r = rows[0];
    if (!r) return undefined;
    baseRev.set(revKey(resourceId, path), r.rev);
    return { path: r.path, text: r.body, updatedAt: r.updated_at };
  },

  // The guard is accepted and not yet enforced (Vault M1 F4): the server
  // resolves concurrency with its own rev, and M2 maps that to the guard.
  async write(resourceId, path, text, _guard?: WriteGuard): Promise<WriteResult> {
    // Checked here, before the send, so an oversized paste is refused at once
    // in plain words rather than after a round trip.
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > ORG_VAULT_NOTE_LIMIT_BYTES) {
      const mb = (bytes / ORG_VAULT_NOTE_LIMIT_BYTES).toFixed(1);
      throw new OrgVaultRefusal(`A team note is limited to 1 MB, and this one is ${mb} MB.`);
    }
    const base = baseRev.get(revKey(resourceId, path)) ?? 0;
    const auth = await token();
    // PostgREST returns a single-row composite function as one object.
    const row = await refusing(() =>
      rpc<NoteRow | NoteRow[]>('org_vault_put', auth, {
        p_org: resourceId,
        p_path: path,
        p_body: text,
        p_base_rev: base,
      }),
    );
    const saved = Array.isArray(row) ? row[0]! : row;
    baseRev.set(revKey(resourceId, path), saved.rev);
    return { ok: true, file: { path: saved.path, text, updatedAt: saved.updated_at } };
  },

  // The guard is accepted and not yet enforced: the server check arrives as
  // org_vault_remove with p_if_match (M2 2.3, CTO G3), so a stale remove
  // still removes here.
  async remove(resourceId, path, _guard?: RemoveGuard): Promise<RemoveResult> {
    const auth = await token();
    await refusing(() => rpc('org_vault_delete', auth, { p_org: resourceId, p_path: path }));
    baseRev.delete(revKey(resourceId, path));
    return { ok: true };
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
