// A fake of the daemon's /vault routes (Vault M5, CTO J7), answering the wire
// in os-code/protocol's vaultWire exactly: versions are fresh tokens on every
// write, a PUT checks ifMatch and ifAbsent where the bytes are, a DELETE
// checks ifMatch, and a 409 carries the note's metadata now. `up = false`
// makes every request fail the way an unreachable computer does (a network
// error), so the hub provider's away path runs as it would on a phone.
import type {
  HubNoteMeta,
  VaultNoteConflictResponse,
  VaultNotePutBody,
  VaultPrivacyWire,
} from 'os-code/protocol';

export interface FakeHubNote {
  text: string;
  version: string;
  mtime: string;
}

export interface FakeHubDaemon {
  fetch: typeof fetch;
  notes: Map<string, FakeHubNote>;
  /** False: every request fails as a network error. */
  up: boolean;
  /** The bearer the fake accepts. */
  token: string;
  /** Every request, as "METHOD /route". */
  calls: string[];
  /** Another writer (the agent, Obsidian): replace a note with a fresh version. */
  replace(path: string, text: string): void;
  remove(path: string): void;
  bytes(path: string): string | undefined;
  config: Map<string, string>;
  privacy: VaultPrivacyWire;
  /** The engine's saved index file, and its ETag. */
  index?: { text: string; etag: string };
  /** When set, the notes route answers 404, as a daemon from before M5. */
  old?: boolean;
}

export function fakeHubDaemon(baseUrl = 'http://mac.tail1234.ts.net:4816'): FakeHubDaemon {
  let n = 0;
  const fresh = () => `v${++n}`;
  const clock = () => new Date(Date.UTC(2026, 8, 27, 12, 0, n)).toISOString();
  const d: FakeHubDaemon = {
    notes: new Map(),
    up: true,
    token: 'pair-token',
    calls: [],
    config: new Map(),
    privacy: { exclude: ['Private/**'], localOnly: { paths: ['Journal/**'], tags: ['private'] } },
    replace(path, text) {
      d.notes.set(path, { text, version: fresh(), mtime: clock() });
    },
    remove(path) {
      d.notes.delete(path);
    },
    bytes(path) {
      return d.notes.get(path)?.text;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      d.calls.push(`${method} ${url.pathname}`);
      if (!d.up) throw new TypeError('Failed to fetch');
      if (`${url.protocol}//${url.host}` !== baseUrl) throw new TypeError('Failed to fetch');
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== `Bearer ${d.token}`) {
        return json(401, { error: 'That pairing is not known here.' });
      }
      const meta = (path: string): HubNoteMeta | undefined => {
        const note = d.notes.get(path);
        return note
          ? {
              path,
              version: note.version,
              size: new TextEncoder().encode(note.text).length,
              mtime: note.mtime,
            }
          : undefined;
      };
      const conflict = (c: VaultNoteConflictResponse['conflict'], path: string) => {
        const current = meta(path);
        return json(409, { conflict: c, ...(current ? { current } : {}) });
      };

      if (url.pathname === '/vault/notes' && method === 'GET') {
        if (d.old) return json(404, { error: 'not found' });
        const notes = [...d.notes.keys()].sort().map((p) => meta(p)!);
        return json(200, { notes, truncated: false });
      }
      if (url.pathname.startsWith('/vault/notes/')) {
        if (d.old) return json(404, { error: 'not found' });
        const path = url.pathname
          .slice('/vault/notes/'.length)
          .split('/')
          .map(decodeURIComponent)
          .join('/');
        if (method === 'GET') {
          const note = d.notes.get(path);
          if (!note) return json(404, { error: 'No such note.' });
          return json(200, { path, text: note.text, version: note.version, mtime: note.mtime });
        }
        if (method === 'PUT') {
          const body = JSON.parse(String(init?.body ?? '{}')) as VaultNotePutBody;
          const note = d.notes.get(path);
          if (body.ifAbsent && note) return conflict('exists', path);
          if (body.ifMatch !== undefined) {
            if (!note) return conflict('missing', path);
            if (note.version !== body.ifMatch) return conflict('changed', path);
          }
          d.replace(path, body.text);
          return json(200, { meta: meta(path) });
        }
        if (method === 'DELETE') {
          const note = d.notes.get(path);
          if (!note) return json(200, { ok: true });
          const ifMatch = url.searchParams.get('ifMatch');
          if (ifMatch !== null && ifMatch !== note.version) return conflict('changed', path);
          d.notes.delete(path);
          return json(200, { ok: true });
        }
      }
      if (url.pathname.startsWith('/vault/config/') && method === 'GET') {
        const name = url.pathname
          .slice('/vault/config/'.length)
          .split('/')
          .map(decodeURIComponent)
          .join('/');
        const text = d.config.get(name);
        if (text === undefined) return json(404, { error: 'absent' });
        return json(200, { name, text, version: `c-${text.length}` });
      }
      if (url.pathname === '/vault/privacy' && method === 'GET') return json(200, d.privacy);
      if (url.pathname === '/vault/index' && method === 'GET') {
        if (!d.index) return json(404, { error: 'none' });
        if (headers.get('if-none-match') === d.index.etag)
          return new Response(null, { status: 304 });
        return new Response(d.index.text, { status: 200, headers: { etag: d.index.etag } });
      }
      return json(404, { error: 'not found' });
    }) as typeof fetch,
  };
  return d;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
