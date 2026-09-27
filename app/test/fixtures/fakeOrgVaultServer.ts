// A fake of the team vault's server half, in memory: the PostgREST selects the
// provider makes on org_vault_notes and org_members, and the two guarded RPCs
// from supabase/migrations/0019_org_vault_v1.sql, org_vault_write and
// org_vault_remove, with their decision table as written there. Revs come from
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

export interface FakeOrgVaultServer {
  org: string;
  notes: Map<string, FakeNote>;
  members: Array<{ user_id: string | null; email: string; status: string }>;
  /** Every select query string, in order, keyed by table. */
  selects: Array<{ table: string; query: string }>;
  /** Every RPC call, in order. */
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  /** The user the RPCs run as (auth.uid()). */
  caller: string;
  /** When set, every RPC throws it (a network failure, a PGRST202). */
  rpcFailure: unknown;
  /** Another writer: sets a live note with a fresh rev, as a teammate's save would. */
  put(path: string, body: string, by?: string): FakeNote;
  /** Another writer's delete: the row becomes a tombstone with a fresh rev. */
  drop(path: string): void;
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

export function createFakeOrgVaultServer(org = 'org-123'): FakeOrgVaultServer {
  let seq = 1_000_000_000;
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

  const server: FakeOrgVaultServer = {
    org,
    notes: new Map(),
    members: [],
    selects: [],
    rpcs: [],
    caller: 'u-me',
    rpcFailure: undefined,

    put(path, body, by = 'u-teammate') {
      return set(server, path, body, by);
    },

    drop(path) {
      const n = server.notes.get(path);
      if (n) server.notes.set(path, { ...n, deleted: true, body: '', rev: nextRev() });
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
      if (table !== 'org_vault_notes') return [];
      let rows = [...server.notes.values()];
      if (get('deleted')[0] === 'is.false') rows = rows.filter((n) => !n.deleted);
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
      if (fn === 'org_vault_write') {
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
          n = set(server, path, body, server.caller);
        } else {
          const cur = live(server, path);
          if (!cur) return { ok: false, conflict: 'missing' };
          if (cur.rev !== ifMatch) return { ok: false, conflict: 'changed', theirs: theirs(cur) };
          n = set(server, path, body, server.caller);
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
