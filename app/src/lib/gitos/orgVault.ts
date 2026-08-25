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
import type { Lease, StorageProvider, StoredFile, StoredFileMeta } from './providers.js';

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
 *  token (or undefined when signed out); `ready` is true when the user is an
 *  active member of an org that has a server id. */
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

// Per-note base revision, keyed by "<org>::<path>", set whenever we read a note
// or its metadata and consumed on the next write. A missing entry means "new
// note" and is sent as base 0, which never matches a real rev, so the server
// treats a surprise existing note as a conflict and copies it aside.
const baseRev = new Map<string, number>();
const revKey = (resourceId: string, path: string) => `${resourceId}::${path}`;

async function token(): Promise<string> {
  const t = await getToken?.();
  if (!t) throw new Error('Sign in to your team to use the team vault.');
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
    for (const r of rows) baseRev.set(revKey(resourceId, r.path), r.rev);
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
    baseRev.set(revKey(resourceId, path), r.rev);
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

  async write(resourceId, path, text) {
    const base = baseRev.get(revKey(resourceId, path)) ?? 0;
    // PostgREST returns a single-row composite function as one object.
    const row = await rpc<NoteRow | NoteRow[]>('org_vault_put', await token(), {
      p_org: resourceId,
      p_path: path,
      p_body: text,
      p_base_rev: base,
    });
    const saved = Array.isArray(row) ? row[0]! : row;
    baseRev.set(revKey(resourceId, path), saved.rev);
    return { path: saved.path, text, updatedAt: saved.updated_at } satisfies StoredFile;
  },

  async remove(resourceId, path) {
    await rpc('org_vault_delete', await token(), { p_org: resourceId, p_path: path });
    baseRev.delete(revKey(resourceId, path));
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
