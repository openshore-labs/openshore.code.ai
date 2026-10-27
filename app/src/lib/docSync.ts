// Sync on all devices for chats and projects (founder, 2026-10-16; folder plan
// M5). The vault's pass (lib/gitos/sync.ts) carries them too: each side is
// shown to it as a storage of documents named `<id>.json`, one per chat or
// project, and the computer keeps them in its own folder (the daemon's /sync
// routes, or main's osc:sync* channels on the desktop that is the computer).
//
// What a document holds is what should follow the person, never what belongs
// to one device: a chat's title, source, project, thread items and citations,
// not its live state (busy, approvals, a queue); a project's name,
// instructions, currents, repositories, network access, setup script and
// agent selection, not where it runs, its pinned notes, or its environment
// variables (sealed on each device, lib/projectEnv.ts). A shared project syncs
// through the team server already, and a coding session's chat through its
// own machine, so neither is a document here.
import type { Conversation, Project, ThreadItem } from '../state/types.js';
import { emptyThread } from '../state/types.js';
import { isProjectNetwork } from 'os-code/protocol';
import type { OscodeBridge } from './electronBridge.js';
import {
  type RemoveResult,
  type StorageProvider,
  type StoredFile,
  type StoredFileMeta,
  type WriteGuard,
  type WriteResult,
} from './gitos/providers.js';

export type DocKind = 'chats' | 'projects';

export interface DocMeta {
  id: string;
  version: string;
  updatedAt: string;
  size: number;
}

/** The computer's store, however this device reaches it. */
export interface DocTransport {
  list(kind: DocKind): Promise<DocMeta[]>;
  get(kind: DocKind, id: string): Promise<{ text: string; version: string } | undefined>;
  put(
    kind: DocKind,
    id: string,
    text: string,
    guard: { ifMatch: string } | { ifAbsent: true },
  ): Promise<{ ok: true; version: string } | { ok: false; conflict: string }>;
  remove(kind: DocKind, id: string, ifMatch: string): Promise<boolean>;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const isDocPath = (p: string): boolean =>
  p.endsWith('.json') && ID.test(p.slice(0, -'.json'.length));
const idOf = (p: string): string => p.slice(0, -'.json'.length);

/** A short, stable hash of a document's text: its version on this device. */
export function docHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}-${text.length.toString(36)}`;
}

/** The pass's seam needs a lease pair; documents have no lease. */
const noLease = {
  ready: true,
  compareAndSwap: true as const,
  async acquireLease(_r: string, holder: string, ttlMs: number) {
    return { holder, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  },
  async releaseLease() {},
};

/** The computer's documents of one kind, as a storage the pass can read. */
export function remoteDocs(t: DocTransport, kind: DocKind): StorageProvider {
  return {
    ...noLease,
    id: 'hub',
    label: 'Your computer',
    blurb: '',
    async list(): Promise<StoredFileMeta[]> {
      return (await t.list(kind)).map((d) => ({
        path: `${d.id}.json`,
        updatedAt: d.updatedAt,
        size: d.size,
        version: d.version,
      }));
    },
    async stat(_r, path) {
      if (!isDocPath(path)) return undefined;
      const d = await t.get(kind, idOf(path));
      return d ? { path, updatedAt: '', size: d.text.length, version: d.version } : undefined;
    },
    async read(_r, path): Promise<StoredFile | undefined> {
      if (!isDocPath(path)) return undefined;
      const d = await t.get(kind, idOf(path));
      return d && { path, text: d.text, updatedAt: '', version: d.version };
    },
    async write(_r, path, text, guard?: WriteGuard): Promise<WriteResult> {
      const g =
        guard && 'ifMatch' in guard && guard.ifMatch !== undefined
          ? { ifMatch: guard.ifMatch }
          : { ifAbsent: true as const };
      const r = await t.put(kind, idOf(path), text, g);
      return r.ok
        ? { ok: true, file: { path, text, updatedAt: '', version: r.version } }
        : { ok: false, conflict: r.conflict === 'exists' ? 'exists' : 'changed' };
    },
    async remove(_r, path, guard): Promise<RemoveResult> {
      const ok = guard ? await t.remove(kind, idOf(path), guard.ifMatch) : false;
      return ok ? { ok: true } : { ok: false, conflict: 'changed' };
    },
  };
}

/** This device's documents of one kind, from the store. */
export interface LocalDocSource {
  /** Every document this device would sync, as text. `busy` holds one back
   *  (a reply still streaming) for a later pass. */
  list(): Array<{ id: string; text: string; updatedAt: string; busy?: boolean }>;
  /** Put a document's text in the store, or take it out (undefined). Returns
   *  the text as the store now holds it (its version), or undefined when it
   *  could not take it (a document it refuses). */
  apply(id: string, text: string | undefined): string | undefined;
}

export function localDocs(source: LocalDocSource): StorageProvider {
  const find = (path: string) => source.list().find((d) => `${d.id}.json` === path);
  return {
    ...noLease,
    id: 'local',
    label: 'This device',
    blurb: '',
    async list() {
      return source.list().map((d) => ({
        path: `${d.id}.json`,
        updatedAt: d.updatedAt,
        size: d.text.length,
        version: docHash(d.text),
        // The pass's "not here yet" mark: it waits for the next pass.
        ...(d.busy ? { evicted: true } : {}),
      }));
    },
    async stat(_r, path) {
      const d = find(path);
      return d
        ? { path, updatedAt: d.updatedAt, size: d.text.length, version: docHash(d.text) }
        : undefined;
    },
    async read(_r, path) {
      const d = find(path);
      return d && { path, text: d.text, updatedAt: d.updatedAt, version: docHash(d.text) };
    },
    async write(_r, path, text, guard?: WriteGuard): Promise<WriteResult> {
      if (!isDocPath(path)) return { ok: false, conflict: 'changed' };
      const cur = find(path);
      if (guard && 'ifAbsent' in guard && guard.ifAbsent && cur) {
        return { ok: false, conflict: 'exists' };
      }
      if (guard && 'ifMatch' in guard && guard.ifMatch !== undefined) {
        if (!cur || docHash(cur.text) !== guard.ifMatch) return { ok: false, conflict: 'changed' };
      }
      if (cur?.busy) return { ok: false, conflict: 'changed' };
      const held = source.apply(idOf(path), text);
      if (held === undefined) return { ok: false, conflict: 'changed' };
      return {
        ok: true,
        file: { path, text: held, updatedAt: new Date().toISOString(), version: docHash(held) },
      };
    },
    async remove(_r, path, guard): Promise<RemoveResult> {
      const cur = find(path);
      if (!cur) return { ok: true };
      if ((guard && docHash(cur.text) !== guard.ifMatch) || cur.busy) {
        return { ok: false, conflict: 'changed' };
      }
      source.apply(idOf(path), undefined);
      return { ok: true };
    },
  };
}

// ---- What a chat and a project carry ---------------------------------------

/** Chats whose brain is a model this person reaches from any device. A coding
 *  session's chat lives with its machine, and the mock is for tests. */
export function chatSyncs(c: Conversation): boolean {
  return (
    ID.test(c.id) &&
    c.source.kind !== 'desktop' &&
    c.source.kind !== 'mock' &&
    c.thread.items.length > 0
  );
}

interface ChatDoc {
  id: string;
  title: string;
  source: Conversation['source'];
  projectId?: string;
  projectChat?: boolean;
  repoIds?: string[];
  unfiled?: boolean;
  renamed?: boolean;
  hadVisionInput?: boolean;
  createdAt: string;
  updatedAt: string;
  items: ThreadItem[];
  citations: Conversation['thread']['citations'];
}

/** A chat's document, keys in one order so the same chat is the same text. */
export function chatDoc(c: Conversation): string {
  const d: ChatDoc = {
    id: c.id,
    title: c.title,
    source: c.source,
    ...(c.projectId ? { projectId: c.projectId } : {}),
    ...(c.projectChat ? { projectChat: true } : {}),
    ...(c.repoIds?.length ? { repoIds: c.repoIds } : {}),
    ...(c.unfiled ? { unfiled: true } : {}),
    ...(c.renamed ? { renamed: true } : {}),
    ...(c.hadVisionInput ? { hadVisionInput: true } : {}),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    items: c.thread.items,
    citations: c.thread.citations,
  };
  return JSON.stringify(d);
}

/** A chat from its document, keeping this device's live state of it. Undefined
 *  for a document that is not a chat this device can hold. */
export function chatFromDoc(
  text: string,
  id: string,
  existing?: Conversation,
): Conversation | undefined {
  let d: Partial<ChatDoc>;
  try {
    d = JSON.parse(text) as Partial<ChatDoc>;
  } catch {
    return undefined;
  }
  if (
    typeof d.title !== 'string' ||
    !d.source ||
    typeof d.source !== 'object' ||
    d.source.kind === 'desktop' ||
    d.source.kind === 'mock' ||
    !Array.isArray(d.items) ||
    typeof d.createdAt !== 'string' ||
    typeof d.updatedAt !== 'string'
  ) {
    return undefined;
  }
  const thread = existing?.thread ?? emptyThread();
  return {
    id,
    title: d.title,
    source: d.source,
    ...(d.projectId ? { projectId: d.projectId } : {}),
    ...(d.projectChat ? { projectChat: true } : {}),
    ...(d.repoIds ? { repoIds: d.repoIds } : {}),
    ...(d.unfiled ? { unfiled: true } : {}),
    ...(d.renamed ? { renamed: true } : {}),
    ...(d.hadVisionInput ? { hadVisionInput: true } : {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    thread: {
      ...thread,
      items: d.items,
      citations: Array.isArray(d.citations) ? d.citations : [],
    },
  };
}

/** A project syncs unless the team server carries it. */
export function projectSyncs(p: Project): boolean {
  return ID.test(p.id) && !p.shared && !p.serverId;
}

interface ProjectDoc {
  id: string;
  name: string;
  instructions?: string;
  agenticCurrent?: Project['agenticCurrent'];
  harnessCurrent?: Project['harnessCurrent'];
  repoIds: string[];
  network?: Project['network'];
  setupScript?: string;
  excludedAgentIds?: string[];
  createdAt: string;
}

export function projectDoc(p: Project): string {
  const d: ProjectDoc = {
    id: p.id,
    name: p.name,
    ...(p.instructions ? { instructions: p.instructions } : {}),
    ...(p.agenticCurrent ? { agenticCurrent: p.agenticCurrent } : {}),
    ...(p.harnessCurrent ? { harnessCurrent: p.harnessCurrent } : {}),
    repoIds: p.repoIds,
    ...(p.network && p.network !== 'full' ? { network: p.network } : {}),
    ...(p.setupScript ? { setupScript: p.setupScript } : {}),
    ...(p.excludedAgentIds?.length ? { excludedAgentIds: p.excludedAgentIds } : {}),
    createdAt: p.createdAt,
  };
  return JSON.stringify(d);
}

/** A project from its document, keeping what belongs to this device (where it
 *  runs, its pinned notes). */
export function projectFromDoc(text: string, id: string, existing?: Project): Project | undefined {
  let d: Partial<ProjectDoc>;
  try {
    d = JSON.parse(text) as Partial<ProjectDoc>;
  } catch {
    return undefined;
  }
  if (typeof d.name !== 'string' || !Array.isArray(d.repoIds) || typeof d.createdAt !== 'string') {
    return undefined;
  }
  return {
    ...(existing?.runsOn ? { runsOn: existing.runsOn } : {}),
    ...(existing?.vaultPins ? { vaultPins: existing.vaultPins } : {}),
    id,
    name: d.name,
    ...(d.instructions ? { instructions: d.instructions } : {}),
    ...(d.agenticCurrent ? { agenticCurrent: d.agenticCurrent } : {}),
    ...(d.harnessCurrent ? { harnessCurrent: d.harnessCurrent } : {}),
    repoIds: d.repoIds.filter((r): r is string => typeof r === 'string'),
    ...(isProjectNetwork(d.network) && d.network !== 'full' ? { network: d.network } : {}),
    ...(typeof d.setupScript === 'string' && d.setupScript ? { setupScript: d.setupScript } : {}),
    ...(Array.isArray(d.excludedAgentIds)
      ? { excludedAgentIds: d.excludedAgentIds.filter((x): x is string => typeof x === 'string') }
      : {}),
    createdAt: d.createdAt,
  };
}

/** A conflict copy's document: its own id, and a name that says where it came
 *  from (`from` is e.g. "from this iPhone"). */
export function docCopyText(kind: DocKind, text: string, copyPath: string, from: string): string {
  try {
    const d = JSON.parse(text) as { id?: string; title?: string; name?: string };
    d.id = idOf(copyPath);
    if (kind === 'chats') d.title = `${d.title ?? 'Chat'} (${from})`;
    else d.name = `${d.name ?? 'Project'} (${from})`;
    return JSON.stringify(d);
  } catch {
    return text;
  }
}

/** "c123.json" -> "c123-copy.json", numbered when taken. Ids only, so a copy
 *  is a document the computer takes. */
export function docCopyPath(path: string, taken: (p: string) => boolean): string {
  const id = idOf(path).slice(0, 110);
  for (let n = 1; ; n++) {
    const candidate = `${id}-copy${n > 1 ? n : ''}.json`;
    if (!taken(candidate)) return candidate;
  }
}

// ---- How this device reaches the computer's store --------------------------

/** Over the docking link: the daemon's /sync routes with this device's
 *  credential. A failure throws, so the pass keeps its ledger. */
export function httpDocTransport(target: {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}): DocTransport {
  const base = target.baseUrl.replace(/\/+$/, '');
  const f = target.fetch ?? fetch;
  const call = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      return await f(`${base}/sync/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${target.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async list(kind) {
      const res = await call('GET', kind);
      if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
      const body = (await res.json()) as { docs?: DocMeta[] };
      return Array.isArray(body.docs) ? body.docs : [];
    },
    async get(kind, id) {
      const res = await call('GET', `${kind}/${id}`);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
      return (await res.json()) as { text: string; version: string };
    },
    async put(kind, id, text, guard) {
      const res = await call('PUT', `${kind}/${id}`, { text, ...guard });
      if (res.status === 409) {
        const body = (await res.json()) as { conflict?: string };
        return { ok: false, conflict: body.conflict ?? 'changed' };
      }
      if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
      return { ok: true, version: ((await res.json()) as { version: string }).version };
    },
    async remove(kind, id, ifMatch) {
      const res = await call('DELETE', `${kind}/${id}?ifMatch=${encodeURIComponent(ifMatch)}`);
      if (res.ok) return true;
      if (res.status === 409) return false;
      throw new Error(`Your computer answered ${res.status}.`);
    },
  };
}

/** On the desktop that is the computer: main's osc:sync* channels, straight
 *  into the store a docked phone reaches. */
export function bridgeDocTransport(
  b: Required<Pick<OscodeBridge, 'syncList' | 'syncGet' | 'syncPut' | 'syncRemove'>>,
): DocTransport {
  return {
    list: (kind) => b.syncList(kind),
    get: (kind, id) => b.syncGet(kind, id),
    async put(kind, id, text, guard) {
      const r = await b.syncPut(kind, id, text, guard);
      return r.ok ? { ok: true, version: r.version } : { ok: false, conflict: r.conflict };
    },
    async remove(kind, id, ifMatch) {
      return (await b.syncRemove(kind, id, ifMatch)).ok;
    },
  };
}
