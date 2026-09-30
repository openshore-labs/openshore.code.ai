// A fake of the team vault's server half, in memory: the PostgREST selects the
// provider makes on org_vault_notes, org_vault_revisions and org_members, the
// two guarded RPCs from supabase/migrations/0021_org_vault_v1.sql,
// org_vault_write and org_vault_remove, 0024's org_vault_move, and 0025's
// settings pair and gates (OV402 when the plan is not active, OV403 for a
// member's delete under admins-only), each by its decision table as written
// there, and 0023's free space cap (`freeBytes`: note and revision bytes of a
// team with no live plan, counted by its triggers in the order each RPC
// writes, refused with check_violation 23514 on note growth only, the whole
// call rolled back). Revs come from
// one sequence and never repeat, so a note removed and made again never
// matches an old base. Shared by test/orgVault.test.ts and the team row of
// test/providerContract.test.ts, so there is one fake, not two.
//
// It speaks the same shapes the real client receives: rows as arrays, the RPC
// replies as jsonb objects, and failures as errors carrying `status` (and
// `code` for PostgREST's own), the way lib/supabase.ts raises them.

export interface FakeNote {
  path: string;
  body: string;
  rev: number;
  updated_at: string;
  updated_by: string | null;
  deleted: boolean;
}

/** A revision row (0021): the displaced version, and why. */
export interface FakeRevision {
  id: number;
  path: string;
  rev: number;
  body: string;
  reason: 'overwritten' | 'deleted' | 'renamed';
  recorded_at: string;
}

/** The org's settings row (0025); undefined is no row (the defaults). */
export interface FakeSettingsRow {
  settings: Record<string, unknown>;
  delete_role: 'admin' | 'member';
  context_folder: string | null;
  rev: number;
  updated_at: string;
  updated_by: string | null;
}

/** 0023's refusal, word for word (org_storage_track's raise); vaultCopy.test
 *  holds it to the migration. */
export const FREE_SPACE_REFUSAL =
  'this team has used its 25 MiB of free space; start a plan to add more. A deleted note frees its space when its history is cleared, about a month later';

export interface FakeOrgVaultServer {
  org: string;
  notes: Map<string, FakeNote>;
  revisions: FakeRevision[];
  settingsRow: FakeSettingsRow | undefined;
  /** org_vault_entitled: false makes every write RPC raise OV402. */
  entitled: boolean;
  /** entitled_until as settings_get answers it (a never-paid team's date). */
  entitledUntil: string | null;
  /** org_vault_is_admin for the caller. */
  isAdmin: boolean;
  members: Array<{ user_id: string | null; email: string; status: string }>;
  /** Every select query string, in order, keyed by table. */
  selects: Array<{ table: string; query: string }>;
  /** Every RPC call, in order. */
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  /** The user the RPCs run as (auth.uid()). */
  caller: string;
  /** When set, every RPC throws it (a network failure, a PGRST202). */
  rpcFailure: unknown;
  /** 0023's cap for a team with no live plan, in bytes; undefined is a team
   *  on a plan (no cap). */
  freeBytes: number | undefined;
  /** What 0023's org_storage_usage holds: every note body (tombstones are
   *  empty) and every revision body, in UTF-8 bytes. */
  usage(): number;
  /** Another writer: sets a live note with a fresh rev, as a teammate's save would. */
  put(path: string, body: string, by?: string): FakeNote;
  /** Another writer's delete: the row becomes a tombstone with a fresh rev,
   *  and the displaced version a 'deleted' revision. */
  drop(path: string): void;
  /** Another admin's settings write: the row replaced with a fresh rev. */
  putSettings(settings: Record<string, unknown>): void;
  /** The live body at a path, or undefined. */
  bytes(path: string): string | undefined;
  select(table: string, token: string, query: string): Promise<unknown[]>;
  rpc(fn: string, token: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Read the value of a filter the provider sent: an `eq.` or `gt.` value,
 *  URL-encoded and, for a path, wrapped in double quotes. */
function filterValue(raw: string): string {
  const v = decodeURIComponent(raw);
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v;
}

const utf8 = (text: string) => new TextEncoder().encode(text).length;

const raise = (message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status: 400, ...extra });

/** 0025's org_vault_settings_ok: the L2 keys a team shares, each its type. */
function settingsOk(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, x]) =>
    ['newNotes', 'daily', 'templates', 'attachments', 'links', 'editor', 'tree'].includes(k)
      ? Boolean(x) && typeof x === 'object' && !Array.isArray(x)
      : k === 'version'
        ? typeof x === 'number'
        : k === 'delete'
          ? x === 'trash' || x === 'permanent'
          : false,
  );
}

export function createFakeOrgVaultServer(org = 'org-123'): FakeOrgVaultServer {
  let seq = 1_000_000_000;
  let revisionId = 0;
  let clock = Date.parse('2026-09-27T00:00:00.000Z');
  const nextRev = () => ++seq;
  const now = () => new Date((clock += 1000)).toISOString();

  const live = (s: FakeOrgVaultServer, path: string) => {
    const n = s.notes.get(path);
    return n && !n.deleted ? n : undefined;
  };
  const theirs = (n: FakeNote) => ({
    path: n.path,
    body: n.body,
    rev: n.rev,
    updated_at: n.updated_at,
    updated_by: n.updated_by,
  });
  const set = (s: FakeOrgVaultServer, path: string, body: string, by: string | null) => {
    const n: FakeNote = {
      path,
      body,
      rev: nextRev(),
      updated_at: now(),
      updated_by: by,
      deleted: false,
    };
    s.notes.set(path, n);
    return n;
  };

  // 0021's org_vault_snapshot: a delete or a rename always records; an
  // overwrite records only when the displaced version is someone else's (or
  // nobody's) or more than ten minutes old, so a member's quick second save
  // keeps no copy of the first.
  const snapshot = (s: FakeOrgVaultServer, n: FakeNote, reason: FakeRevision['reason']) => {
    if (
      reason === 'overwritten' &&
      n.updated_by === s.caller &&
      Date.parse(n.updated_at) >= clock - 10 * 60 * 1000
    ) {
      return;
    }
    s.revisions.push({
      id: ++revisionId,
      path: n.path,
      rev: n.rev,
      body: n.body,
      reason,
      recorded_at: now(),
    });
  };
  const settingsGet = (s: FakeOrgVaultServer) => ({
    settings: s.settingsRow?.settings ?? {},
    delete_role: s.settingsRow?.delete_role ?? 'member',
    context_folder: s.settingsRow?.context_folder ?? null,
    rev: s.settingsRow?.rev ?? 0,
    updated_at: s.settingsRow?.updated_at ?? null,
    updated_by: s.settingsRow?.updated_by ?? null,
    entitled: s.entitled,
    entitled_until: s.entitledUntil,
    is_admin: s.isAdmin,
  });
  // 0023: after a note grows, a team past its free space is refused, and the
  // call's writes are undone with it, as the raise rolls back the RPC.
  const grew = (s: FakeOrgVaultServer, delta: number) => {
    if (s.freeBytes !== undefined && delta > 0 && s.usage() > s.freeBytes) {
      throw raise(FREE_SPACE_REFUSAL, { code: '23514' });
    }
  };
  const inCall = <T>(s: FakeOrgVaultServer, run: () => T): T => {
    const notes = new Map(s.notes);
    const revisions = s.revisions.length;
    try {
      return run();
    } catch (err) {
      s.notes.clear();
      for (const [k, v] of notes) s.notes.set(k, v);
      s.revisions.length = revisions;
      throw err;
    }
  };
  const requireEntitled = (s: FakeOrgVaultServer) => {
    if (!s.entitled) {
      throw raise("the organization's plan is not active, so team notes are read-only", {
        code: 'OV402',
      });
    }
  };

  const server: FakeOrgVaultServer = {
    org,
    notes: new Map(),
    revisions: [],
    settingsRow: undefined,
    entitled: true,
    entitledUntil: null,
    isAdmin: true,
    members: [],
    selects: [],
    rpcs: [],
    caller: 'u-me',
    rpcFailure: undefined,
    freeBytes: undefined,

    usage() {
      let total = 0;
      for (const n of server.notes.values()) total += utf8(n.body);
      for (const r of server.revisions) total += utf8(r.body);
      return total;
    },

    put(path, body, by = 'u-teammate') {
      return set(server, path, body, by);
    },

    drop(path) {
      const n = server.notes.get(path);
      if (!n || n.deleted) return;
      snapshot(server, n, 'deleted');
      server.notes.set(path, { ...n, deleted: true, body: '', rev: nextRev() });
    },

    putSettings(settings) {
      server.settingsRow = {
        settings,
        delete_role: server.settingsRow?.delete_role ?? 'member',
        context_folder: server.settingsRow?.context_folder ?? null,
        rev: (server.settingsRow?.rev ?? 0) + 1,
        updated_at: now(),
        updated_by: 'u-other-admin',
      };
    },

    bytes(path) {
      return live(server, path)?.body;
    },

    async select(table, _token, query) {
      server.selects.push({ table, query });
      const params = query.split('&').map((kv) => {
        const i = kv.indexOf('=');
        return [kv.slice(0, i), kv.slice(i + 1)] as const;
      });
      const get = (k: string) => params.filter(([key]) => key === k).map(([, v]) => v);
      if (get('org_id')[0] !== `eq.${encodeURIComponent(org)}`) return [];
      if (table === 'org_members') {
        const status = get('status')[0]?.replace(/^eq\./, '');
        return server.members
          .filter((m) => !status || m.status === status)
          .map((m) => ({ user_id: m.user_id, email: m.email }));
      }
      if (table === 'org_vault_revisions') {
        let revs = [...server.revisions];
        for (const f of get('path')) {
          if (f.startsWith('eq.')) revs = revs.filter((r) => r.path === filterValue(f.slice(3)));
        }
        for (const f of get('reason')) {
          if (f.startsWith('eq.')) revs = revs.filter((r) => r.reason === f.slice(3));
          const inList = /^in\.\((.*)\)$/.exec(decodeURIComponent(f));
          if (inList) revs = revs.filter((r) => inList[1]!.split(',').includes(r.reason));
        }
        for (const f of get('id')) {
          if (f.startsWith('lt.')) revs = revs.filter((r) => r.id < Number(f.slice(3)));
          if (f.startsWith('eq.')) revs = revs.filter((r) => r.id === Number(f.slice(3)));
        }
        if (get('order')[0] === 'id.desc') revs.sort((a, b) => b.id - a.id);
        revs = revs.slice(0, Math.min(Number(get('limit')[0] ?? 1000), 1000));
        const rcols = (get('select')[0] ?? '*').split(',');
        return revs.map((r) =>
          Object.fromEntries(rcols.map((c) => [c, (r as unknown as Record<string, unknown>)[c]])),
        );
      }
      if (table !== 'org_vault_notes') return [];
      let rows = [...server.notes.values()];
      if (get('deleted')[0] === 'is.false') rows = rows.filter((n) => !n.deleted);
      if (get('deleted')[0] === 'is.true') rows = rows.filter((n) => n.deleted);
      for (const f of get('path')) {
        if (f.startsWith('eq.')) {
          const p = filterValue(f.slice(3));
          rows = rows.filter((n) => n.path === p);
        } else if (f.startsWith('gt.')) {
          const p = filterValue(f.slice(3));
          rows = rows.filter((n) => n.path > p);
        }
      }
      if (get('order')[0]?.startsWith('path')) {
        rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      }
      // PostgREST's max_rows: a select never returns more than 1000 rows.
      const limit = Math.min(Number(get('limit')[0] ?? 1000), 1000);
      rows = rows.slice(0, limit);
      const cols = (get('select')[0] ?? '*').split(',');
      return rows.map((n) => {
        const full: Record<string, unknown> = {
          ...n,
          size: new TextEncoder().encode(n.body).length,
        };
        return Object.fromEntries(cols.map((c) => [c, full[c]]));
      });
    },

    async rpc(fn, _token, args) {
      server.rpcs.push({ fn, args });
      if (server.rpcFailure) throw server.rpcFailure;
      if (args.p_org !== org) {
        throw Object.assign(new Error('not a member of this org'), { status: 400 });
      }
      const path = args.p_path as string;
      if (fn === 'org_vault_settings_get') return settingsGet(server);
      if (fn === 'org_vault_settings_put') {
        if (!settingsOk(args.p_settings)) throw raise('those vault settings are not allowed');
        if (args.p_delete_role !== 'admin' && args.p_delete_role !== 'member') {
          throw raise('who may delete is admin or member');
        }
        if (typeof args.p_base_rev !== 'number') {
          throw raise('a settings write needs the base rev (0 for none yet)');
        }
        if (!server.isAdmin) throw raise('only admins can change team vault settings');
        requireEntitled(server);
        if ((server.settingsRow?.rev ?? 0) !== args.p_base_rev) {
          return { ok: false, conflict: 'changed', theirs: settingsGet(server) };
        }
        server.settingsRow = {
          settings: args.p_settings as Record<string, unknown>,
          delete_role: args.p_delete_role,
          context_folder: (args.p_context_folder as string | null) ?? null,
          rev: (server.settingsRow?.rev ?? 0) + 1,
          updated_at: now(),
          updated_by: server.caller,
        };
        return { ok: true, rev: server.settingsRow.rev, updated_at: server.settingsRow.updated_at };
      }
      if (fn === 'org_vault_move') {
        requireEntitled(server);
        const from = args.p_from as string;
        const to = args.p_to as string;
        const ifMatch = args.p_if_match as number | null | undefined;
        if (ifMatch === null || ifMatch === undefined) throw raise('a move needs if_match');
        const cur = live(server, from);
        if (!cur) return { ok: false, conflict: 'missing' };
        if (cur.rev !== ifMatch) return { ok: false, conflict: 'changed', theirs: theirs(cur) };
        const size = (n: FakeNote) => new TextEncoder().encode(n.body).length;
        if (from === to) {
          return {
            ok: true,
            path: cur.path,
            rev: cur.rev,
            updated_at: cur.updated_at,
            size: size(cur),
          };
        }
        const other = [...server.notes.values()].find(
          (x) => !x.deleted && x.path !== from && x.path.toLowerCase() === to.toLowerCase(),
        );
        if (other) return { ok: false, conflict: 'exists', theirs: theirs(other) };
        // 0024's order: the source's tombstone, then the destination (the
        // growth 0023 checks), then the displaced version, so a team at its
        // cap still renames and only one already past it is refused. A
        // case-only rename changes no body, so nothing is checked.
        return inCall(server, () => {
          if (from.toLowerCase() === to.toLowerCase()) {
            server.notes.delete(from);
          } else {
            server.notes.set(from, { ...cur, deleted: true, body: '', rev: nextRev() });
          }
          const was = utf8(server.notes.get(to)?.body ?? '');
          const n = set(server, to, cur.body, server.caller);
          if (from.toLowerCase() !== to.toLowerCase()) grew(server, utf8(n.body) - was);
          snapshot(server, cur, 'renamed');
          return { ok: true, path: n.path, rev: n.rev, updated_at: n.updated_at, size: size(n) };
        });
      }
      if (fn === 'org_vault_write') {
        requireEntitled(server);
        const body = (args.p_body as string | undefined) ?? '';
        const ifMatch = args.p_if_match as number | null | undefined;
        const ifAbsent = Boolean(args.p_if_absent);
        if ((ifMatch === null || ifMatch === undefined) === !ifAbsent) {
          throw Object.assign(new Error('a write needs exactly one guard: if_match or if_absent'), {
            status: 400,
          });
        }
        let n: FakeNote;
        if (ifAbsent) {
          const taken = [...server.notes.values()].find(
            (x) => !x.deleted && x.path.toLowerCase() === path.toLowerCase(),
          );
          if (taken) return { ok: false, conflict: 'exists', theirs: theirs(taken) };
          const was = utf8(server.notes.get(path)?.body ?? '');
          n = inCall(server, () => {
            const made = set(server, path, body, server.caller);
            grew(server, utf8(body) - was);
            return made;
          });
        } else {
          const cur = live(server, path);
          if (!cur) return { ok: false, conflict: 'missing' };
          if (cur.rev !== ifMatch) return { ok: false, conflict: 'changed', theirs: theirs(cur) };
          n = inCall(server, () => {
            snapshot(server, cur, 'overwritten');
            const made = set(server, path, body, server.caller);
            grew(server, utf8(body) - utf8(cur.body));
            return made;
          });
        }
        return {
          ok: true,
          path: n.path,
          rev: n.rev,
          updated_at: n.updated_at,
          size: new TextEncoder().encode(n.body).length,
        };
      }
      if (fn === 'org_vault_remove') {
        requireEntitled(server);
        if (server.settingsRow?.delete_role === 'admin' && !server.isAdmin) {
          throw raise('only admins can delete team notes here', { code: 'OV403' });
        }
        const ifMatch = args.p_if_match as number | null | undefined;
        if (ifMatch === null || ifMatch === undefined) {
          throw Object.assign(new Error('a remove needs if_match'), { status: 400 });
        }
        const cur = live(server, path);
        if (!cur) return { ok: true, path };
        if (cur.rev !== ifMatch) return { ok: false, conflict: 'changed', theirs: theirs(cur) };
        server.drop(path);
        return { ok: true, path, rev: server.notes.get(path)!.rev };
      }
      // Any other function: what PostgREST says for a name it does not have.
      throw Object.assign(new Error(`Could not find the function public.${fn}`), {
        status: 404,
        code: 'PGRST202',
      });
    },
  };
  return server;
}
