// A fake of the daemon's /vault routes (Vault M5, CTO J7), answering the wire
// in os-code/protocol's vaultWire exactly: versions are fresh tokens on every
// write, a PUT checks ifMatch and ifAbsent where the bytes are, a DELETE
// checks ifMatch, and a 409 carries the note's metadata now. `up = false`
// makes every request fail the way an unreachable computer does (a network
// error), so the hub provider's away path runs as it would on a phone.
import type {
  AttachmentMime,
  HubNoteMeta,
  VaultNoteConflictResponse,
  VaultNotePutBody,
  VaultPrivacyWire,
  VaultTrashBody,
  VaultTrashEntry,
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
  // ---- Vault M6 (CTO K13): rename, folders, Trash and attachments, with the
  // semantics the contract pins (never replace, folded names, restore beside
  // a taken name as "{title} (restored)"). Versions at a new name are fresh,
  // so a caller that assumes the old one fails.
  /** Real folders made on the computer, empty ones too. */
  folders: Set<string>;
  trash: Map<string, FakeHubTrash>;
  attachments: Map<string, FakeHubAttachment>;
  /** When set, the M6 routes answer 404, as a daemon from before M6. */
  beforeM6?: boolean;
  /** Clear every note, folder, trash entry and attachment. */
  reset(): void;
}

export interface FakeHubTrash {
  kind: 'note' | 'folder';
  path: string;
  trashedAt: string;
  notes: Map<string, FakeHubNote>;
  attachments: Map<string, FakeHubAttachment>;
}

export interface FakeHubAttachment {
  bytes: Uint8Array;
  mime: AttachmentMime;
  version: string;
  mtime: string;
}

const fold = (p: string) => p.normalize('NFC').toLowerCase();

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
    folders: new Set(),
    trash: new Map(),
    attachments: new Map(),
    reset() {
      d.notes.clear();
      d.folders.clear();
      d.trash.clear();
      d.attachments.clear();
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
      const m6 = m6Route(url, method, init);
      if (m6) return m6;
      return json(404, { error: 'not found' });
    }) as typeof fetch,
  };
  const noteMeta = (path: string): HubNoteMeta | undefined => {
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
  /** The note or attachment that holds a name by the folded rule. */
  const holder = (path: string, except?: string): string | undefined =>
    [...d.notes.keys(), ...d.attachments.keys()].find(
      (p) => p !== except && fold(p) === fold(path),
    );
  const allFolders = (): string[] => {
    const out = new Set(d.folders);
    for (const p of [...d.notes.keys(), ...d.attachments.keys()]) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'));
    }
    return [...out].sort();
  };
  const bodyOf = (init?: RequestInit): Record<string, unknown> =>
    JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  const beside = (path: string): string => {
    const stem = path.replace(/\.md$/i, '');
    const ext = path.slice(stem.length);
    for (let i = 1; ; i++) {
      const at = `${stem} (restored${i > 1 ? ` ${i}` : ''})${ext}`;
      if (!holder(at)) return at;
    }
  };
  const entryOf = (id: string, t: FakeHubTrash): VaultTrashEntry => ({
    id,
    path: t.path,
    kind: t.kind,
    size: [...t.notes.values()].reduce((a, x) => a + new TextEncoder().encode(x.text).length, 0),
    trashedAt: t.trashedAt,
  });
  let trashIds = 0;

  function m6Route(url: URL, method: string, init?: RequestInit): Response | undefined {
    const route = url.pathname;
    if (!route.startsWith('/vault/')) return undefined;
    const known = [
      '/vault/rename',
      '/vault/folders',
      '/vault/folders/rename',
      '/vault/trash',
      '/vault/trash/restore',
      '/vault/attachments',
    ];
    if (!known.includes(route) && !route.startsWith('/vault/files/')) return undefined;
    if (d.beforeM6) return json(404, { error: 'not found' });

    if (route === '/vault/rename' && method === 'POST') {
      const { from, to, ifMatch } = bodyOf(init) as { from: string; to: string; ifMatch: string };
      const note = d.notes.get(from);
      if (!note) return json(409, { conflict: 'missing' });
      if (note.version !== ifMatch)
        return json(409, { conflict: 'changed', current: noteMeta(from) });
      const taken = holder(to, from);
      if (taken)
        return json(409, {
          conflict: 'exists',
          ...(noteMeta(taken) ? { current: noteMeta(taken) } : {}),
        });
      d.notes.delete(from);
      d.notes.set(to, { text: note.text, version: fresh(), mtime: note.mtime });
      return json(200, { meta: noteMeta(to) });
    }
    if (route === '/vault/folders' && method === 'GET') return json(200, { folders: allFolders() });
    if (route === '/vault/folders' && method === 'POST') {
      const { path } = bodyOf(init) as { path: string };
      if (allFolders().some((f) => fold(f) === fold(path)) || holder(path)) {
        return json(409, { conflict: 'exists' });
      }
      d.folders.add(path);
      return json(200, { ok: true });
    }
    if (route === '/vault/folders/rename' && method === 'POST') {
      const { from, to } = bodyOf(init) as { from: string; to: string };
      if (!allFolders().includes(from)) return json(409, { conflict: 'missing' });
      if (allFolders().some((f) => fold(f) === fold(to)) || holder(to)) {
        return json(409, { conflict: 'exists' });
      }
      const under = `${from}/`;
      const moved: Array<{ from: string; to: string; version: string }> = [];
      for (const [p, note] of [...d.notes]) {
        if (!p.startsWith(under)) continue;
        const next = `${to}/${p.slice(under.length)}`;
        const version = fresh();
        d.notes.delete(p);
        d.notes.set(next, { ...note, version });
        moved.push({ from: p, to: next, version });
      }
      let attachments = 0;
      for (const [p, a] of [...d.attachments]) {
        if (!p.startsWith(under)) continue;
        d.attachments.delete(p);
        d.attachments.set(`${to}/${p.slice(under.length)}`, a);
        attachments++;
      }
      for (const f of [...d.folders]) {
        if (f === from || f.startsWith(under)) {
          d.folders.delete(f);
          d.folders.add(`${to}${f.slice(from.length)}`);
        }
      }
      return json(200, { moved, attachments });
    }
    if (route === '/vault/trash' && method === 'GET') {
      const entries = [...d.trash].map(([id, t]) => entryOf(id, t));
      return json(200, { entries });
    }
    if (route === '/vault/trash' && method === 'POST') {
      const body = bodyOf(init) as unknown as VaultTrashBody;
      const id = `t${++trashIds}`;
      const t: FakeHubTrash = {
        kind: body.kind,
        path: body.path,
        trashedAt: clock(),
        notes: new Map(),
        attachments: new Map(),
      };
      if (body.kind === 'note') {
        const note = d.notes.get(body.path);
        if (!note) return json(409, { conflict: 'changed' });
        if (note.version !== body.ifMatch) {
          return json(409, { conflict: 'changed', current: noteMeta(body.path) });
        }
        d.notes.delete(body.path);
        t.notes.set(body.path, note);
      } else {
        const under = `${body.path}/`;
        for (const [p, note] of [...d.notes]) {
          if (p.startsWith(under)) {
            d.notes.delete(p);
            t.notes.set(p, note);
          }
        }
        for (const [p, a] of [...d.attachments]) {
          if (p.startsWith(under)) {
            d.attachments.delete(p);
            t.attachments.set(p, a);
          }
        }
        for (const f of [...d.folders])
          if (f === body.path || f.startsWith(under)) d.folders.delete(f);
      }
      d.trash.set(id, t);
      return json(200, {
        entry: entryOf(id, t),
        notes: t.notes.size,
        attachments: t.attachments.size,
      });
    }
    if (route === '/vault/trash/restore' && method === 'POST') {
      const { id } = bodyOf(init) as { id: string };
      const t = d.trash.get(id);
      if (!t) return json(409, { conflict: 'missing' });
      let first: string | undefined;
      let renamed = false;
      for (const [p, note] of t.notes) {
        const at = holder(p) ? beside(p) : p;
        if (at !== p) renamed = true;
        d.notes.set(at, note);
        first ??= at;
      }
      for (const [p, a] of t.attachments) d.attachments.set(holder(p) ? beside(p) : p, a);
      d.trash.delete(id);
      if (!first) return json(409, { conflict: 'missing' });
      return json(200, { meta: noteMeta(first), renamed });
    }
    if (route === '/vault/trash' && method === 'DELETE') {
      const { ids } = bodyOf(init) as { ids?: string[] };
      let removed = 0;
      for (const id of [...d.trash.keys()]) {
        if (ids && !ids.includes(id)) continue;
        d.trash.delete(id);
        removed++;
      }
      return json(200, { removed });
    }
    if (route === '/vault/attachments' && method === 'GET') {
      const attachments = [...d.attachments].map(([path, a]) => ({
        path,
        size: a.bytes.byteLength,
        updatedAt: a.mtime,
        version: a.version,
        mime: a.mime,
      }));
      return json(200, { attachments, truncated: false });
    }
    if (route.startsWith('/vault/files/') && method === 'GET') {
      const path = route.slice('/vault/files/'.length).split('/').map(decodeURIComponent).join('/');
      const a = d.attachments.get(path);
      if (!a) return json(404, { error: 'No such file.' });
      if (a.bytes.byteLength > 20 * 1024 * 1024) return json(413, { error: 'Too large.' });
      return new Response(a.bytes, {
        status: 200,
        headers: {
          'content-type': a.mime,
          'content-length': String(a.bytes.byteLength),
          etag: `"${a.version}"`,
          'x-content-type-options': 'nosniff',
          'content-disposition': 'attachment',
        },
      });
    }
    return json(405, { error: 'method not allowed' });
  }

  return d;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
