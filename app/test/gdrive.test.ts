// Google Drive provider correctness, against an in-memory fake Drive that
// speaks the REST surface gdrive.ts uses. Covers the data-loss cluster: index
// merge (COR-6, a concurrent entry does not vanish), conflict copies on a
// concurrent edit (COR-5), delete via a stale index (COR-8), a single root
// folder under concurrent first contact (COR-7), and single-request creates
// (R-2). H-1: this harness is the thing that made these testable at all.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/gitos/gdriveAuth.js', () => ({
  gdriveAccessToken: async () => 'test-token',
}));

const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface Node {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: string;
  modifiedTime: string;
  trashed: boolean;
}

const drive = new Map<string, Node>();
let idSeq = 0;
let timeTick = 0;
const nextId = () => `id${idSeq++}`;
const nextTime = () => `2026-01-01T00:00:00.${String(++timeTick).padStart(6, '0')}Z`;

function parseQ(q: string) {
  const nameEq = q
    .match(/name='((?:[^'\\]|\\.)*)'/)?.[1]
    ?.replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
  const parentIn = q.match(/'([^']+)' in parents/)?.[1];
  const folderOnly = q.includes(`mimeType='${FOLDER_MIME}'`);
  const notFolder = q.includes(`mimeType!='${FOLDER_MIME}'`);
  return { nameEq, parentIn, folderOnly, notFolder };
}

function fileFields(n: Node) {
  return {
    id: n.id,
    name: n.name,
    mimeType: n.mimeType,
    modifiedTime: n.modifiedTime,
    size: String(n.content.length),
  };
}

function multipartParts(body: string, boundary: string) {
  const segments = body
    .split(`--${boundary}`)
    .filter((s) => s.trim() && !s.trim().startsWith('--'));
  const payload = (p: string) => {
    const i = p.indexOf('\r\n\r\n');
    return p.slice(i + 4).replace(/\r\n$/, '');
  };
  return { meta: JSON.parse(payload(segments[0]!)), content: payload(segments[1]!) };
}

const json = (obj: unknown) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

async function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const method = (init?.method ?? 'GET').toUpperCase();
  const p = url.pathname;

  // Multipart create (metadata + content in one request).
  if (p === '/upload/drive/v3/files' && method === 'POST') {
    const ct = (init!.headers as Record<string, string>)['content-type']!;
    const boundary = ct.split('boundary=')[1]!;
    const { meta, content } = multipartParts(String(init!.body), boundary);
    const id = nextId();
    drive.set(id, {
      id,
      name: meta.name,
      mimeType: 'text/plain',
      parents: meta.parents ?? [],
      content,
      modifiedTime: nextTime(),
      trashed: false,
    });
    return json({ id });
  }
  // Media put (overwrite content).
  if (p.startsWith('/upload/drive/v3/files/') && method === 'PATCH') {
    const id = p.slice('/upload/drive/v3/files/'.length);
    const n = drive.get(id)!;
    n.content = String(init!.body);
    n.modifiedTime = nextTime();
    return json({ id });
  }
  // Media read.
  if (p.startsWith('/drive/v3/files/') && url.searchParams.get('alt') === 'media') {
    const id = p.slice('/drive/v3/files/'.length);
    return new Response(drive.get(id)!.content, { status: 200 });
  }
  // Metadata read.
  if (p.startsWith('/drive/v3/files/') && url.searchParams.has('fields') && method === 'GET') {
    const n = drive.get(p.slice('/drive/v3/files/'.length))!;
    return json({ modifiedTime: n.modifiedTime, size: String(n.content.length) });
  }
  // Trash / rename (JSON PATCH).
  if (p.startsWith('/drive/v3/files/') && method === 'PATCH') {
    const n = drive.get(p.slice('/drive/v3/files/'.length))!;
    const body = JSON.parse(String(init!.body));
    if (body.trashed) n.trashed = true;
    return json({ id: n.id });
  }
  // Create folder (JSON POST).
  if (p === '/drive/v3/files' && method === 'POST') {
    const body = JSON.parse(String(init!.body));
    const id = nextId();
    drive.set(id, {
      id,
      name: body.name,
      mimeType: body.mimeType ?? 'text/plain',
      parents: body.parents ?? [],
      content: '',
      modifiedTime: nextTime(),
      trashed: false,
    });
    return json({ id });
  }
  // Query.
  if (p === '/drive/v3/files' && method === 'GET') {
    const { nameEq, parentIn, folderOnly, notFolder } = parseQ(url.searchParams.get('q') ?? '');
    const files = [...drive.values()]
      .filter((n) => !n.trashed)
      .filter((n) => nameEq === undefined || n.name === nameEq)
      .filter((n) => parentIn === undefined || n.parents.includes(parentIn))
      .filter((n) => !folderOnly || n.mimeType === FOLDER_MIME)
      .filter((n) => !notFolder || n.mimeType !== FOLDER_MIME)
      .map(fileFields);
    return json({ files });
  }
  throw new Error(`unhandled request: ${method} ${p}`);
}

const { gdriveProvider, mergeIndex } = await import('../src/lib/gitos/gdrive.js');

beforeEach(() => {
  drive.clear();
  idSeq = 0;
  timeTick = 0;
  vi.stubGlobal('fetch', fakeFetch as unknown as typeof fetch);
});

// Each test uses a fresh resourceId so the module-level handle cache never
// bleeds one test's tree into another.
let rid = 0;
const res = () => `vault.test.${rid++}`;

describe('gdrive provider (H-1)', () => {
  it('creates, reads back, and lists a note (single-request create)', async () => {
    const r = res();
    await gdriveProvider.write(r, 'a.md', 'hello');
    const read = await gdriveProvider.read(r, 'a.md');
    expect(read?.text).toBe('hello');
    const list = await gdriveProvider.list(r);
    expect(list.map((f) => f.path)).toContain('a.md');
    // Exactly one non-trashed file named a.md exists (no metadata-then-content fork).
    const aNodes = [...drive.values()].filter((n) => n.name === 'a.md' && !n.trashed);
    expect(aNodes.length).toBe(1);
    expect(aNodes[0]!.content).toBe('hello');
  });

  it('writes a conflict copy when the file changed underneath us (COR-5)', async () => {
    const r = res();
    await gdriveProvider.write(r, 'note.md', 'v1');
    // Another device edits the same file: bump its modifiedTime + content.
    const node = [...drive.values()].find((n) => n.name === 'note.md' && !n.trashed)!;
    node.content = 'from other device';
    node.modifiedTime = nextTime();
    // Our next write must not clobber it; it lands as a conflict copy.
    const saved = await gdriveProvider.write(r, 'note.md', 'my edit');
    expect(saved.path).toMatch(/note \(conflict .*\)\.md/);
    // The other device's content survives on the original path.
    const original = await gdriveProvider.read(r, 'note.md');
    expect(original?.text).toBe('from other device');
  });

  it('delete falls through a stale index instead of being a silent no-op (COR-8)', async () => {
    const r = res();
    await gdriveProvider.write(r, 'gone.md', 'bye');
    // Simulate a stale index: another device created a file our index never saw.
    const rootFolder = [...drive.values()].find((n) => n.name === r && !n.trashed)!;
    const orphanId = nextId();
    drive.set(orphanId, {
      id: orphanId,
      name: 'orphan.md',
      mimeType: 'text/plain',
      parents: [rootFolder.id],
      content: 'not in our index',
      modifiedTime: nextTime(),
      trashed: false,
    });
    await gdriveProvider.remove(r, 'orphan.md');
    expect(drive.get(orphanId)!.trashed).toBe(true);
  });

  it('creates only one root folder under concurrent first contact (COR-7)', async () => {
    const r = res();
    await Promise.all([gdriveProvider.list(r), gdriveProvider.write(r, 'x.md', 'x')]);
    const roots = [...drive.values()].filter(
      (n) => n.name === r && n.mimeType === FOLDER_MIME && !n.trashed,
    );
    expect(roots.length).toBe(1);
  });
});

describe('mergeIndex (COR-6)', () => {
  it('keeps a concurrent device entry instead of clobbering it', () => {
    const local = { files: { 'a.md': { id: '1', updatedAt: 't1', size: 1 } } };
    const remote = { files: { 'b.md': { id: '2', updatedAt: 't1', size: 1 } } };
    const merged = mergeIndex(local, remote);
    expect(Object.keys(merged.files).sort()).toEqual(['a.md', 'b.md']);
  });

  it('does not resurrect a locally deleted file that still sits in the remote index', () => {
    const local = { files: {}, tombstones: { 'a.md': 't2' } };
    const remote = { files: { 'a.md': { id: '1', updatedAt: 't1', size: 1 } } };
    const merged = mergeIndex(local, remote);
    expect(merged.files['a.md']).toBeUndefined();
  });

  it('revives a file re-created after its tombstone', () => {
    const local = { files: {}, tombstones: { 'a.md': 't1' } };
    const remote = { files: { 'a.md': { id: '1', updatedAt: 't2', size: 1 } } };
    const merged = mergeIndex(local, remote);
    expect(merged.files['a.md']?.id).toBe('1');
    expect(merged.tombstones?.['a.md']).toBeUndefined();
  });
});
