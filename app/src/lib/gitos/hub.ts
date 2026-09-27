// The hub provider (Vault M5, CTO J9): the paired computer's one vault, over
// the daemon's /vault routes (os-code/protocol's vault wire), shown as "Your
// computer". Compare-and-swap replaces a lease: every write carries the
// version it was typed against and the computer checks it where the bytes
// are (the engine's writeNote guards), so a stale save is a conflict, never
// a silent overwrite.
//
// Requests go through the global fetch. On the iPhone that IS native HTTP
// (CapacitorHttp patches it, capacitor.config.ts), so no WebView CORS rule
// applies and PUT and DELETE reach the daemon; everywhere else the daemon's
// own CORS answers, as it does for remoteDriver.ts.
//
// Out of reach (the computer is off, asleep, or off the tailnet) the last
// listing and the bodies read here (at most HUB_STASH_MAX_NOTES or
// HUB_STASH_MAX_BYTES, oldest read first out) are kept in the sealed store, so:
// - list, stat and read answer from what was kept, and a note never read here
//   says it was not kept rather than reading as missing;
// - the tree is read-only: a create, a rename, a move or a delete is refused
//   in plain words (HUB_AWAY_READ_ONLY), marked permanent so the store holds
//   it rather than replaying a create nobody asked to wait;
// - a save to a note that was read here fails as a transient error, so the
//   store's pending queue keeps it with its base version and replays it as
//   `ifMatch` when the computer is back; a 409 then is the store's resolve
//   path, as on every compare-and-swap provider.
//
// One vault per hub and per person on it: the provider ignores the resource
// id (like the desktop folder), and the stash and the index are keyed by
// `hubIndexTarget(baseUrl, hubUserId).owner`, so two hubs or two members
// never share either.
import {
  VAULT_CONFIG_ROUTE,
  VAULT_INDEX_ROUTE,
  VAULT_NOTES_ROUTE,
  VAULT_PRIVACY_ROUTE,
  VAULT_WIRE_NOTE_MAX_BYTES,
  INDEX_FILE_MAX_BYTES,
  isVaultConfigName,
  vaultNoteRoute,
  type ConfigRead,
  type HubNoteMeta,
  type VaultConfigName,
  type VaultNoteConflictResponse,
  type VaultNotePutBody,
  type VaultPrivacyWire,
} from 'os-code/protocol';
import { storeDelete, storeGetJson, storeKeys, storeSetJson } from '../platform.js';
import {
  HUB_AWAY_LINE,
  HUB_AWAY_NOT_KEPT,
  HUB_AWAY_READ_ONLY,
  HUB_PAIR_LINE,
  HUB_PAIRING_REFUSED,
  HUB_UPDATE_LINE,
  hubTooLargeLine,
} from '../vaultCopy.js';
import { registerVaultIndexSeed, type VaultIndexTarget } from '../vaultIndexHost.js';
import { asConfigRead } from './config.js';
import {
  isNotePath,
  type GitosResource,
  type Lease,
  type RemoveGuard,
  type RemoveResult,
  type StorageProvider,
  type StorageProviderId,
  type StoredFile,
  type StoredFileMeta,
  type WriteGuard,
  type WriteResult,
} from './providers.js';

/** The resource id the hub's vault is addressed by. */
export const HUB_VAULT_RESOURCE_ID = 'vault';
/** What is kept sealed for out-of-reach reading (J9). */
export const HUB_STASH_MAX_NOTES = 200;
export const HUB_STASH_MAX_BYTES = 8 * 1024 * 1024;
/** How long one request waits before the computer reads as away. */
export const HUB_REQUEST_TIMEOUT_MS = 8000;

export interface HubProviderOptions {
  /** The paired hub's base URL (`settings.daemon.baseUrl`). */
  baseUrl: string;
  /** The bearer this device pairs with. */
  token: () => Promise<string | undefined>;
  /** The hub's id for the signed-in person (admin, legacy shared token, or
   *  member), so two members never share an index or a stash. */
  hubUserId: string;
  /** Test seam; defaults to the global fetch (native HTTP on the iPhone). */
  fetch?: typeof fetch;
}

/** The index target for a hub vault: one per hub and per person on it. */
export function hubIndexTarget(baseUrl: string, hubUserId: string): VaultIndexTarget {
  return {
    providerId: 'hub',
    resourceId: HUB_VAULT_RESOURCE_ID,
    owner: `${baseUrl.replace(/\/+$/, '')}#${hubUserId}`,
  };
}

/** A stable per-person key for a pairing when the hub names no user id: a
 *  short hash of the bearer, so two members' tokens never share a stash. */
export async function hubPersonKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Errors

/** A refusal retrying cannot fix: not paired, the pairing turned down, an
 *  old computer, a note over the cap, or a tree change while away.
 *  `permanent` is the seam's mark, so the store holds the text as Not saved
 *  instead of replaying it. */
export class HubRefusal extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'HubRefusal';
  }
}

/** The computer did not answer. Transient, so the store stashes a save and
 *  replays it when the computer is back. */
export class HubAwayError extends Error {
  readonly away = true;
  constructor(message: string = HUB_AWAY_LINE) {
    super(message);
    this.name = 'HubAwayError';
  }
}

// ---------------------------------------------------------------------------
// Reach

/** Whether the computer answered last time: `unknown` before the first call. */
export type HubReach = 'unknown' | 'reachable' | 'away';

// ---------------------------------------------------------------------------
// The stash, in the sealed store, one key per body so a save rewrites only
// its own note:
//   oscode.hub.<key>.list          -> { files: StoredFileMeta[]; truncated }
//   oscode.hub.<key>.order         -> Array<{ path; bytes; version }> (oldest read first)
//   oscode.hub.<key>.body.<path>   -> StoredFile

interface StashList {
  files: StoredFileMeta[];
  truncated: boolean;
}
interface StashOrder {
  path: string;
  bytes: number;
  version?: string;
}

async function stashPrefixOf(owner: string): Promise<string> {
  return `oscode.hub.${await hubPersonKey(owner)}.`;
}

/** Forget what a hub vault kept on this device (unpairing, sign-out). */
export async function forgetHubStash(baseUrl: string, hubUserId: string): Promise<void> {
  const prefix = await stashPrefixOf(hubIndexTarget(baseUrl, hubUserId).owner!);
  for (const key of await storeKeys(prefix)) await storeDelete(key).catch(() => {});
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

function metaOf(n: HubNoteMeta): StoredFileMeta {
  return { path: n.path, updatedAt: n.mtime, size: n.size, version: n.version };
}

function isHubNoteMeta(v: unknown): v is HubNoteMeta {
  const m = v as Partial<HubNoteMeta> | null;
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.path === 'string' &&
    typeof m.version === 'string' &&
    typeof m.mtime === 'string' &&
    typeof m.size === 'number'
  );
}

/** The hub provider, with the few hub-only calls beside the seam. */
export interface HubProvider extends StorageProvider {
  readonly compareAndSwap: true;
  /** This vault's index target. */
  readonly target: VaultIndexTarget;
  /** Whether the computer answered last time. */
  reach(): HubReach;
  /** Called on every change of reach. Returns an unsubscribe. */
  onReach(listener: (reach: HubReach) => void): () => void;
  /** The caller's privacy rules (`GET /vault/privacy`). Throws when the
   *  computer does not answer, so the caller falls back to what it kept. */
  fetchPrivacy(): Promise<VaultPrivacyWire>;
  /** The engine's saved index file (`GET /vault/index`), a head start the
   *  index reconciles by version. Null when there is none, it did not change
   *  since the last fetch, it is over the phone's cap, or the computer is
   *  away. */
  fetchIndex(): Promise<string | null>;
  /** Forget the stash (unpairing, sign-out). */
  forget(): Promise<void>;
}

export function createHubProvider(opts: HubProviderOptions): HubProvider {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const target = hubIndexTarget(base, opts.hubUserId);
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch)(input, init);
  let reachValue: HubReach = 'unknown';
  const listeners = new Set<(reach: HubReach) => void>();
  let indexEtag: string | undefined;

  function setReach(next: HubReach): void {
    if (next === reachValue) return;
    reachValue = next;
    for (const l of listeners) {
      try {
        l(next);
      } catch {
        // A listener's fault is its own.
      }
    }
  }

  // ---- the wire -----------------------------------------------------------

  async function call(
    method: 'GET' | 'PUT' | 'DELETE',
    route: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const token = await opts.token();
    if (!token) throw new HubRefusal(HUB_PAIR_LINE);
    let res: Response;
    try {
      res = await doFetch(`${base}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(HUB_REQUEST_TIMEOUT_MS),
      });
    } catch {
      setReach('away');
      throw new HubAwayError();
    }
    // A gateway in front of a computer that is off (a Funnel, a proxy).
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      setReach('away');
      throw new HubAwayError();
    }
    setReach('reachable');
    if (res.status === 401) throw new HubRefusal(HUB_PAIRING_REFUSED);
    return res;
  }

  async function errorOf(res: Response): Promise<Error> {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    const line = typeof body.error === 'string' ? body.error : undefined;
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      return new HubRefusal(line ?? `Your computer answered ${res.status}.`);
    }
    return new Error(line ?? `Your computer answered ${res.status}.`);
  }

  // ---- the stash ----------------------------------------------------------

  let prefixPromise: Promise<string> | undefined;
  const prefix = () => (prefixPromise ??= stashPrefixOf(target.owner!));
  let listCache: StashList | undefined;
  let orderCache: StashOrder[] | undefined;
  // One stash change at a time, so a read and a write never interleave.
  let stashChain: Promise<unknown> = Promise.resolve();
  function stashing<T>(fn: () => Promise<T>): Promise<T> {
    const next = stashChain.then(fn, fn);
    stashChain = next.catch(() => {});
    return next;
  }

  async function keptList(): Promise<StashList | undefined> {
    listCache ??= await storeGetJson<StashList>(`${await prefix()}list`).catch(() => undefined);
    return listCache;
  }
  async function keptOrder(): Promise<StashOrder[]> {
    orderCache ??=
      (await storeGetJson<StashOrder[]>(`${await prefix()}order`).catch(() => undefined)) ?? [];
    return orderCache;
  }
  async function keptBody(path: string): Promise<StoredFile | undefined> {
    const order = await keptOrder();
    if (!order.some((o) => o.path === path)) return undefined;
    return storeGetJson<StoredFile>(`${await prefix()}body.${path}`).catch(() => undefined);
  }

  // Keeping is best effort: a stash that cannot be written leaves the vault
  // working online, just not readable away.
  function keepList(files: StoredFileMeta[], truncated: boolean): Promise<void> {
    return stashing(async () => {
      listCache = { files, truncated };
      const listed = new Map(files.map((f) => [f.path, f.version]));
      const order = await keptOrder();
      // A body that no longer lists, or whose version moved on, is not kept:
      // offline it would answer for a note that is not that text any more.
      const stale = order
        .filter((o) => !listed.has(o.path) || listed.get(o.path) !== o.version)
        .map((o) => o.path);
      await dropBodies(stale);
      await storeSetJson(`${await prefix()}list`, listCache).catch(() => {});
    });
  }

  async function dropBodies(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const gone = new Set(paths);
    orderCache = (await keptOrder()).filter((o) => !gone.has(o.path));
    const p = await prefix();
    for (const path of paths) await storeDelete(`${p}body.${path}`).catch(() => {});
    await storeSetJson(`${p}order`, orderCache).catch(() => {});
  }

  function keepBody(file: StoredFile): Promise<void> {
    return stashing(async () => {
      const bytes = utf8Bytes(file.text);
      if (bytes > HUB_STASH_MAX_BYTES) return;
      const p = await prefix();
      const order = (await keptOrder()).filter((o) => o.path !== file.path);
      order.push({
        path: file.path,
        bytes,
        ...(file.version !== undefined ? { version: file.version } : {}),
      });
      // Oldest read first out, until both caps hold.
      const evicted: string[] = [];
      let total = order.reduce((n, o) => n + o.bytes, 0);
      while (order.length > HUB_STASH_MAX_NOTES || total > HUB_STASH_MAX_BYTES) {
        const out = order.shift()!;
        total -= out.bytes;
        evicted.push(out.path);
      }
      orderCache = order;
      for (const path of evicted) await storeDelete(`${p}body.${path}`).catch(() => {});
      await storeSetJson(`${p}body.${file.path}`, file).catch(() => {});
      await storeSetJson(`${p}order`, order).catch(() => {});
      // The listing learns the new version too, so an away list agrees.
      const list = await keptList();
      if (list) {
        const meta: StoredFileMeta = {
          path: file.path,
          updatedAt: file.updatedAt,
          size: bytes,
          ...(file.version !== undefined ? { version: file.version } : {}),
        };
        const files = list.files.filter((f) => f.path !== file.path);
        files.push(meta);
        files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        listCache = { files, truncated: list.truncated };
        await storeSetJson(`${p}list`, listCache).catch(() => {});
      }
    });
  }

  function forgetNote(path: string): Promise<void> {
    return stashing(async () => {
      await dropBodies([path]);
      const list = await keptList();
      if (list) {
        listCache = { files: list.files.filter((f) => f.path !== path), truncated: list.truncated };
        await storeSetJson(`${await prefix()}list`, listCache).catch(() => {});
      }
    });
  }

  // ---- reads --------------------------------------------------------------

  async function readLive(path: string): Promise<StoredFile | undefined> {
    const res = await call('GET', vaultNoteRoute(path));
    if (res.status === 404) {
      await forgetNote(path);
      return undefined;
    }
    if (!res.ok) throw await errorOf(res);
    const body = (await res.json()) as {
      path?: unknown;
      text?: unknown;
      version?: unknown;
      mtime?: unknown;
    };
    if (typeof body.text !== 'string' || typeof body.version !== 'string') {
      throw new Error('Your computer sent a note this app could not read.');
    }
    const file: StoredFile = {
      path,
      text: body.text,
      updatedAt: typeof body.mtime === 'string' ? body.mtime : new Date(0).toISOString(),
      version: body.version,
    };
    await keepBody(file);
    return file;
  }

  // What theirs is, for a conflict: the note as the computer holds it now.
  async function theirsOf(path: string): Promise<StoredFile | undefined> {
    try {
      return await readLive(path);
    } catch {
      return undefined;
    }
  }

  function refuseNonNote(path: string): Error {
    return new HubRefusal(`"${path}" is not a note, so the vault does not write it.`);
  }

  const provider: HubProvider = {
    id: 'hub',
    label: 'Your computer',
    blurb: 'Your computer, while it is on. Plain .md files in the vault folder there.',
    ready: true,
    compareAndSwap: true,
    target,

    reach: () => reachValue,
    onReach(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async list(): Promise<StoredFileMeta[]> {
      let res: Response;
      try {
        res = await call('GET', VAULT_NOTES_ROUTE);
      } catch (err) {
        if (err instanceof HubAwayError) {
          const kept = await keptList();
          if (kept) return kept.files.map((f) => ({ ...f }));
        }
        throw err;
      }
      // A computer from before the hub vault has no such route.
      if (res.status === 404) throw new HubRefusal(HUB_UPDATE_LINE);
      if (!res.ok) throw await errorOf(res);
      const body = (await res.json()) as { notes?: unknown; truncated?: unknown };
      const notes = Array.isArray(body.notes) ? body.notes.filter(isHubNoteMeta) : [];
      const files = notes.filter((n) => isNotePath(n.path)).map(metaOf);
      await keepList(files, body.truncated === true);
      return files;
    },

    async stat(_resourceId, path): Promise<StoredFileMeta | undefined> {
      if (!isNotePath(path)) return undefined;
      try {
        const file = await readLive(path);
        return file
          ? { path, updatedAt: file.updatedAt, size: utf8Bytes(file.text), version: file.version }
          : undefined;
      } catch (err) {
        if (!(err instanceof HubAwayError)) throw err;
        const kept = (await keptList())?.files.find((f) => f.path === path);
        if (kept) return { ...kept };
        throw err;
      }
    },

    async read(_resourceId, path): Promise<StoredFile | undefined> {
      if (!isNotePath(path)) return undefined;
      try {
        return await readLive(path);
      } catch (err) {
        if (!(err instanceof HubAwayError)) throw err;
        const kept = await keptBody(path);
        if (kept) return { ...kept };
        // Never "missing": the note may well be there, just not here.
        throw new HubAwayError(HUB_AWAY_NOT_KEPT);
      }
    },

    async write(_resourceId, path, text, guard?: WriteGuard): Promise<WriteResult> {
      if (!isNotePath(path)) throw refuseNonNote(path);
      const bytes = utf8Bytes(text);
      if (bytes > VAULT_WIRE_NOTE_MAX_BYTES) throw new HubRefusal(hubTooLargeLine(bytes));
      const body: VaultNotePutBody =
        guard && 'ifMatch' in guard
          ? { text, ifMatch: guard.ifMatch }
          : guard && 'ifAbsent' in guard
            ? { text, ifAbsent: true }
            : { text };
      let res: Response;
      try {
        res = await call('PUT', vaultNoteRoute(path), { body });
      } catch (err) {
        if (!(err instanceof HubAwayError)) throw err;
        // Away, the tree is read-only: only a save to a note this device
        // kept, against the version it was typed on, waits to be replayed.
        const kept = guard && 'ifMatch' in guard ? await keptBody(path) : undefined;
        if (!kept) throw new HubRefusal(HUB_AWAY_READ_ONLY);
        throw err;
      }
      if (res.status === 409) {
        const c = (await res.json().catch(() => ({}))) as Partial<VaultNoteConflictResponse>;
        if (c.conflict === 'missing') {
          await forgetNote(path);
          return { ok: false, conflict: 'missing' };
        }
        const conflict = c.conflict === 'exists' ? 'exists' : 'changed';
        const theirs = await theirsOf(path);
        return theirs ? { ok: false, conflict, theirs } : { ok: false, conflict };
      }
      if (res.status === 404) throw new HubRefusal(HUB_UPDATE_LINE);
      if (res.status === 413) throw new HubRefusal(hubTooLargeLine(bytes));
      if (!res.ok) throw await errorOf(res);
      const answer = (await res.json().catch(() => ({}))) as { meta?: unknown };
      if (!isHubNoteMeta(answer.meta)) {
        throw new Error('Your computer saved the note but did not say which version it is.');
      }
      const file: StoredFile = {
        path,
        text,
        updatedAt: answer.meta.mtime,
        version: answer.meta.version,
      };
      await keepBody(file);
      return { ok: true, file };
    },

    async remove(_resourceId, path, guard?: RemoveGuard): Promise<RemoveResult> {
      if (!isNotePath(path)) throw refuseNonNote(path);
      const q = guard ? `?ifMatch=${encodeURIComponent(guard.ifMatch)}` : '';
      let res: Response;
      try {
        res = await call('DELETE', `${vaultNoteRoute(path)}${q}`);
      } catch (err) {
        if (err instanceof HubAwayError) throw new HubRefusal(HUB_AWAY_READ_ONLY);
        throw err;
      }
      // Already gone is what the person wanted.
      if (res.ok || res.status === 404) {
        await forgetNote(path);
        return { ok: true };
      }
      if (res.status === 409) {
        const c = (await res.json().catch(() => ({}))) as Partial<VaultNoteConflictResponse>;
        if (c.conflict === 'missing') {
          await forgetNote(path);
          return { ok: true };
        }
        const theirs = await theirsOf(path);
        return theirs
          ? { ok: false, conflict: 'changed', theirs }
          : { ok: false, conflict: 'changed' };
      }
      throw await errorOf(res);
    },

    // Compare-and-swap settles every write where the bytes are, and the
    // agent and Obsidian write the same folder, so there is no lease to take.
    async acquireLease(_resourceId, holder, ttlMs): Promise<Lease> {
      return { holder, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
    },

    async releaseLease(): Promise<void> {
      // Nothing held.
    },

    // The computer maps the name through its own allow-list and reads the
    // file through the jail. Away, or on an old computer, it reads as
    // unsupported, which every caller treats as "use the defaults".
    async readConfig(_resourceId, name: VaultConfigName): Promise<ConfigRead> {
      if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
      try {
        const route = `${VAULT_CONFIG_ROUTE}/${name.split('/').map(encodeURIComponent).join('/')}`;
        const res = await call('GET', route);
        if (res.status === 404) {
          // An old computer answers 404 with no body shape of ours; a
          // current one says the file is absent.
          return { ok: false, reason: 'absent' };
        }
        if (res.status === 413) return { ok: false, reason: 'too-large' };
        if (res.status === 400 || res.status === 403) return { ok: false, reason: 'refused' };
        if (!res.ok) return { ok: false, reason: 'unsupported' };
        const body = (await res.json()) as { text?: unknown; version?: unknown };
        return asConfigRead({ ok: true, text: body.text, version: body.version });
      } catch {
        return { ok: false, reason: 'unsupported' };
      }
    },

    async fetchPrivacy(): Promise<VaultPrivacyWire> {
      const res = await call('GET', VAULT_PRIVACY_ROUTE);
      if (!res.ok) throw await errorOf(res);
      const body = (await res.json()) as Partial<VaultPrivacyWire>;
      const strings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
      return {
        exclude: strings(body.exclude),
        localOnly: { paths: strings(body.localOnly?.paths), tags: strings(body.localOnly?.tags) },
      };
    },

    async fetchIndex(): Promise<string | null> {
      try {
        const res = await call('GET', VAULT_INDEX_ROUTE, {
          ...(indexEtag ? { headers: { 'if-none-match': indexEtag } } : {}),
        });
        if (res.status === 304 || !res.ok) return null;
        const text = await res.text();
        if (utf8Bytes(text) > INDEX_FILE_MAX_BYTES.phone) return null;
        indexEtag = res.headers?.get?.('etag') ?? undefined;
        return text;
      } catch {
        return null;
      }
    },

    async forget(): Promise<void> {
      await stashing(async () => {
        const p = await prefix();
        for (const key of await storeKeys(p)) await storeDelete(key).catch(() => {});
        listCache = undefined;
        orderCache = [];
      });
    },
  };
  return provider;
}

// ---------------------------------------------------------------------------
// The one paired hub, registered in lib/gitos/index.ts

let link: HubProvider | undefined;
let linkUnsub: (() => void) | undefined;
const reachListeners = new Set<() => void>();

function notifyReach(): void {
  for (const l of reachListeners) {
    try {
      l();
    } catch {
      // A listener's fault is its own.
    }
  }
}

/** Point the hub vault at the paired computer, or at nothing (unpaired,
 *  signed out). The store calls this whenever `settings.daemon` changes. */
export function setHubVaultLink(opts: HubProviderOptions | undefined): HubProvider | undefined {
  linkUnsub?.();
  linkUnsub = undefined;
  link = opts ? createHubProvider(opts) : undefined;
  if (link) linkUnsub = link.onReach(notifyReach);
  notifyReach();
  return link;
}

/** The paired computer's hub provider, when one is paired. */
export function hubVaultLink(): HubProvider | undefined {
  return link;
}

/** Whether the paired computer answered last time (`unknown` when none is
 *  paired or nothing has asked yet). */
export function hubReach(): HubReach {
  return link?.reach() ?? 'unknown';
}

/** Listen for reach changes of the paired hub (and for a new pairing). */
export function subscribeHubReach(listener: () => void): () => void {
  reachListeners.add(listener);
  return () => reachListeners.delete(listener);
}

/** Whether the hub vault can be used now: a computer is paired. Away, it is
 *  still usable (read-only, from what was kept), so reach does not decide. */
export function isHubAvailable(): Promise<boolean> {
  return Promise.resolve(link !== undefined);
}

function linked(): HubProvider {
  if (!link) throw new HubRefusal(HUB_PAIR_LINE);
  return link;
}

/** The registered face: every call goes to the paired computer's provider,
 *  and with none paired it refuses in plain words. */
export const hubProvider: StorageProvider = {
  id: 'hub',
  label: 'Your computer',
  blurb: 'Your computer, while it is on. Plain .md files in the vault folder there.',
  ready: false,
  pending: HUB_PAIR_LINE,
  compareAndSwap: true,
  list: async (r) => linked().list(r),
  stat: async (r, p) => linked().stat(r, p),
  read: async (r, p) => linked().read(r, p),
  write: async (r, p, t, g) => linked().write(r, p, t, g),
  remove: async (r, p, g) => linked().remove(r, p, g),
  acquireLease: async (r, h, ttl, label) => linked().acquireLease(r, h, ttl, label),
  releaseLease: async (r, h) => linked().releaseLease(r, h),
  readConfig: async (r, name) =>
    link ? link.readConfig!(r, name) : { ok: false, reason: 'unsupported' },
};

// The index's head start for a hub vault on first open: the engine's own
// saved index, from the computer this target names.
registerVaultIndexSeed('hub', (t) =>
  link && t.owner === link.target.owner ? link.fetchIndex() : null,
);

// ---------------------------------------------------------------------------
// D2: where the personal vault goes on pairing (pure, for the store). The
// one pairing rule: the store runs it, and its words are in vaultCopy.ts.

/** Where the vault was before it pointed at the computer, so unpairing can
 *  return it. Device local, never synced. */
export interface VaultBeforeHub {
  providerId: StorageProviderId;
  chosenAt?: string;
  /** The hub it pointed at (its base URL). */
  hub: string;
}

/** The one-time move card after pairing, per hub. Device local. */
export interface VaultHubOffer {
  /** The hub it is for (its base URL). */
  hub: string;
  state: 'offered' | 'declined';
}

/** What pairing does to the personal vault: an empty Local vault (no notes
 *  and no text waiting to save) repoints to the computer with one toast; a
 *  Local vault with notes gets the one-time move card (the existing move,
 *  writing `ifAbsent`), unless the person already declined it for this hub;
 *  a vault the person placed themselves (`chosenAt`: a folder, iCloud, the
 *  iPhone folder) or one already on the computer stays where it is. A count
 *  of `undefined` is a listing that failed, which never counts as empty. */
export type HubPairPlan = 'repoint' | 'offer-move' | 'stay';

export function hubPairPlan(
  resource: Pick<GitosResource, 'providerId' | 'chosenAt'> | undefined,
  noteCount: number | undefined,
  opts: { waiting?: boolean; declined?: boolean } = {},
): HubPairPlan {
  const providerId = resource?.providerId ?? 'local';
  if (providerId === 'hub') return 'stay';
  if (resource?.chosenAt) return 'stay';
  if (providerId !== 'local') return 'stay';
  if (noteCount === undefined) return 'stay';
  if (noteCount === 0 && !opts.waiting) return 'repoint';
  return opts.declined ? 'stay' : 'offer-move';
}

/** Where the personal vault goes on unpairing: back to the resource it was
 *  on before the repoint (Local when none was kept). Nothing moves back; the
 *  notes stay on the computer. Undefined when the vault is not on the hub. */
export function hubUnpairTarget(
  resource: Pick<GitosResource, 'providerId'> | undefined,
  previous: GitosResource['providerId'] | undefined,
): GitosResource['providerId'] | undefined {
  if (resource?.providerId !== 'hub') return undefined;
  return previous && previous !== 'hub' ? previous : 'local';
}
