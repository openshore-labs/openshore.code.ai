// Sync on all devices for chats and projects (folder plan M5): two devices
// meet through a computer's store, as the daemon's /sync routes keep it.
import { describe, expect, it, vi } from 'vitest';
import {
  chatDoc,
  chatFromDoc,
  chatSyncs,
  projectDoc,
  projectFromDoc,
  projectSyncs,
  type DocKind,
  type DocTransport,
} from '../src/lib/docSync.js';
import { createDocSyncs } from '../src/state/docSyncOps.js';
import { emptyThread, type Conversation, type Project } from '../src/state/types.js';

vi.mock('../src/lib/platform.js', async (orig) => {
  const actual = await orig<typeof import('../src/lib/platform.js')>();
  const mem = new Map<string, string>();
  return {
    ...actual,
    storeGetJson: async (k: string) => (mem.has(k) ? JSON.parse(mem.get(k)!) : undefined),
    storeSetJson: async (k: string, v: unknown) => void mem.set(k, JSON.stringify(v)),
    storeDelete: async (k: string) => void mem.delete(k),
  };
});

/** The computer's store: what the /sync routes keep, compare-and-swap. */
function computer() {
  const docs = new Map<string, string>();
  let n = 0;
  const versions = new Map<string, string>();
  const k = (kind: DocKind, id: string) => `${kind}/${id}`;
  const t: DocTransport = {
    async list(kind) {
      return [...docs.keys()]
        .filter((key) => key.startsWith(`${kind}/`))
        .map((key) => ({
          id: key.slice(kind.length + 1),
          version: versions.get(key)!,
          updatedAt: '',
          size: docs.get(key)!.length,
        }));
    },
    async get(kind, id) {
      const text = docs.get(k(kind, id));
      return text === undefined ? undefined : { text, version: versions.get(k(kind, id))! };
    },
    async put(kind, id, text, guard) {
      const key = k(kind, id);
      const cur = versions.get(key);
      if ('ifAbsent' in guard && cur) return { ok: false, conflict: 'exists' };
      if ('ifMatch' in guard && cur !== guard.ifMatch) return { ok: false, conflict: 'changed' };
      docs.set(key, text);
      const v = `v${++n}`;
      versions.set(key, v);
      return { ok: true, version: v };
    },
    async remove(kind, id, ifMatch) {
      const key = k(kind, id);
      if (versions.get(key) !== ifMatch) return false;
      docs.delete(key);
      versions.delete(key);
      return true;
    },
  };
  return { t, docs };
}

const chat = (id: string, text: string, over: Partial<Conversation> = {}): Conversation => ({
  id,
  title: `Chat ${id}`,
  source: { kind: 'stack' },
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
  thread: {
    ...emptyThread(),
    items: [{ kind: 'user', id: `${id}-u`, text } as never],
  },
  ...over,
});

function device(name: string, box: ReturnType<typeof computer>) {
  const chats = new Map<string, Conversation>();
  let projects: Project[] = [];
  const toasts: string[] = [];
  const syncs = createDocSyncs({
    // Each device keeps its own ledger; in this test they share one store.
    transport: () => ({ transport: box.t, key: `box-${name}` }),
    from: () => `from ${name}`,
    chats: {
      all: () => [...chats.values()],
      put: (id, c) => (c ? chats.set(id, c) : chats.delete(id)),
    },
    projects: {
      all: () => projects,
      put: (id, p) => {
        projects = p
          ? projects.some((x) => x.id === id)
            ? projects.map((x) => (x.id === id ? p : x))
            : [...projects, p]
          : projects.filter((x) => x.id !== id);
      },
    },
    onResult: (kind, r) => {
      if (r.conflicts.length) toasts.push(`${kind}:${r.conflicts.length}`);
    },
  });
  return {
    chats,
    get projects() {
      return projects;
    },
    set projects(p: Project[]) {
      projects = p;
    },
    toasts,
    sync: () => syncs.run(),
  };
}

describe('chats and projects sync through the computer', () => {
  it("a chat started on the phone shows up on the iPad, and the iPad's reply comes back", async () => {
    const box = computer();
    const phone = device('this iPhone', box);
    const ipad = device('this iPad', box);
    phone.chats.set('c1', chat('c1', 'hello from the phone'));
    await phone.sync();
    await ipad.sync();
    expect(ipad.chats.get('c1')?.title).toBe('Chat c1');
    const onIpad = ipad.chats.get('c1')!;
    ipad.chats.set('c1', {
      ...onIpad,
      updatedAt: '2026-10-16T11:00:00.000Z',
      thread: {
        ...onIpad.thread,
        items: [...onIpad.thread.items, { kind: 'assistant', id: 'a', text: 'hi' } as never],
      },
    });
    await ipad.sync();
    await phone.sync();
    expect(phone.chats.get('c1')?.thread.items).toHaveLength(2);
  });

  it('a chat both devices went on with apart keeps both, the copy named for where it came from', async () => {
    const box = computer();
    const phone = device('this iPhone', box);
    const ipad = device('this iPad', box);
    phone.chats.set('c1', chat('c1', 'start'));
    await phone.sync();
    await ipad.sync();
    phone.chats.set('c1', chat('c1', 'phone went on'));
    ipad.chats.set('c1', chat('c1', 'iPad went on'));
    await ipad.sync();
    await phone.sync();
    expect(phone.toasts).toEqual(['chats:1']);
    const copy = phone.chats.get('c1-copy')!;
    expect(copy.title).toBe('Chat c1 (from this iPhone)');
    expect(JSON.stringify(copy.thread.items)).toContain('phone went on');
    expect(JSON.stringify(phone.chats.get('c1')!.thread.items)).toContain('iPad went on');
    await ipad.sync();
    expect(ipad.chats.get('c1-copy')?.title).toBe('Chat c1 (from this iPhone)');
  });

  it('a deleted chat goes from every device', async () => {
    const box = computer();
    const phone = device('this iPhone', box);
    const ipad = device('this iPad', box);
    phone.chats.set('c1', chat('c1', 'x'));
    await phone.sync();
    await ipad.sync();
    phone.chats.delete('c1');
    await phone.sync();
    await ipad.sync();
    expect(ipad.chats.has('c1')).toBe(false);
    expect(box.docs.size).toBe(0);
  });

  it('a reply still streaming waits for the next pass', async () => {
    const box = computer();
    const phone = device('this iPhone', box);
    phone.chats.set('c1', chat('c1', 'x', { thread: { ...emptyThread(), busy: true } as never }));
    phone.chats.get('c1')!.thread.items.push({ kind: 'user', id: 'u', text: 'x' } as never);
    await phone.sync();
    expect(box.docs.size).toBe(0);
  });

  it('a project syncs its name and instructions, never where it runs or its pinned notes', async () => {
    const box = computer();
    const desk = device('this computer', box);
    const phone = device('this iPhone', box);
    desk.projects = [
      {
        id: 'p1',
        name: 'Site',
        instructions: 'Be brief.',
        repoIds: ['github:me/site'],
        runsOn: 'this-computer',
        vaultPins: ['Plans.md'],
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ];
    await desk.sync();
    phone.projects = [
      {
        id: 'p1',
        name: 'Old name',
        repoIds: [],
        runsOn: 'http://box:4820',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ];
    await phone.sync();
    // Both had it with different text: the computer's stands, the phone's is beside it.
    const p = phone.projects.find((x) => x.id === 'p1')!;
    expect(p.name).toBe('Site');
    expect(p.instructions).toBe('Be brief.');
    expect(p.runsOn).toBe('http://box:4820');
    expect(p.vaultPins).toBeUndefined();
    expect(box.docs.get('projects/p1')).not.toContain('runsOn');
  });
});

describe('what a document carries', () => {
  it("a chat's document keeps its words and drops this device's live state", () => {
    const c = chat('c1', 'hello');
    c.thread = { ...c.thread, busy: true, queued: ['later'], dollars: 3 };
    const text = chatDoc(c);
    expect(text).not.toContain('later');
    expect(text).not.toContain('dollars');
    const back = chatFromDoc(text, 'c1')!;
    expect(back.thread.items).toEqual(c.thread.items);
    expect(back.thread.busy).toBe(false);
  });

  it('a coding session, the mock, and an empty draft stay on their device', () => {
    expect(chatSyncs(chat('c1', 'x', { source: { kind: 'desktop', sessionId: 's' } }))).toBe(false);
    expect(chatSyncs(chat('c1', 'x', { source: { kind: 'mock' } }))).toBe(false);
    expect(chatSyncs({ ...chat('c1', 'x'), thread: emptyThread() })).toBe(false);
    expect(chatFromDoc(JSON.stringify({ source: { kind: 'desktop' } }), 'c1')).toBeUndefined();
  });

  it('a team project syncs through the team server, not here', () => {
    const p: Project = { id: 'p', name: 'n', repoIds: [], createdAt: '', shared: true };
    expect(projectSyncs(p)).toBe(false);
    expect(projectFromDoc(projectDoc({ ...p, shared: false }), 'p')?.shared).toBeUndefined();
  });
});
