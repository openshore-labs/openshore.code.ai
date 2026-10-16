// Sync on all devices (founder, 2026-10-16; docs/design/openshore-folder-and-sync-plan.md).
// Each device keeps its own working copy of the vault and works on it while
// apart; once docked, a pass brings it and the computer's copy together. The
// computer is the meeting point: two devices never sync with each other.
//
// One pass over two storages behind the seam, `local` (this device) and
// `remote` (the docked computer), and a ledger: for every note, the version
// each side had the last time the two agreed. A side whose version moved
// since then changed it.
//
//   neither changed       nothing to do
//   only this device      push it (or its delete) to the computer
//   only the computer     pull it (or its delete) here
//   both                  the same text: agree; a delete against an edit:
//                         keep the edit; two different texts: KEEP BOTH. The
//                         computer's version stays as the note, this
//                         device's lands beside it as a conflict copy, on
//                         both sides (R3). Nothing is overwritten silently.
//
// Every write is compare-and-swap against the version this pass read, so a
// note typed into while the pass runs is left for the next pass instead of
// lost. A delete goes to Trash where the storage has one, so it can come
// back. One note that fails never stops the others; it keeps its old ledger
// row and is tried again next pass. Pure over the seam: no store, no timers.
import type { VaultSettingsConfigName } from 'os-code/protocol';
import {
  isNotePath,
  versionOf,
  type StorageProvider,
  type StoredFile,
  type StoredFileMeta,
} from './providers.js';

/** What the two sides had the last time they agreed on a note. */
export interface LedgerRow {
  local: string;
  remote: string;
}
export type SyncLedger = Record<string, LedgerRow>;

/** One side of a pass: a storage and the resource on it. `list`, when set,
 *  replaces the storage's own listing: it must be live and complete (the
 *  computer's `listComplete`), since a note missing from it reads as deleted. */
export interface SyncSide {
  provider: StorageProvider;
  resourceId: string;
  list?: () => Promise<StoredFileMeta[]>;
}

export interface SyncConflict {
  /** The note both sides changed; it now holds the computer's version. */
  path: string;
  /** Where this device's version was kept. */
  copy: string;
}

export interface SyncResult {
  ledger: SyncLedger;
  pushed: string[];
  pulled: string[];
  /** Deletes carried either way. */
  removed: string[];
  conflicts: SyncConflict[];
  /** Notes left for the next pass, with why. */
  skipped: Array<{ path: string; reason: string }>;
}

export interface SyncOptions {
  /** The conflict copy's path for a note, given a taken-check. The caller
   *  names it (the copy's words live in vaultCopy.ts). */
  conflictPath(path: string, taken: (p: string) => boolean): string;
}

type Meta = StoredFileMeta | undefined;

function byPath(list: StoredFileMeta[]): Map<string, StoredFileMeta> {
  const m = new Map<string, StoredFileMeta>();
  for (const f of list) if (isNotePath(f.path)) m.set(f.path, f);
  return m;
}

const ver = (m: Meta): string | undefined => (m ? versionOf(m) : undefined);

/** Did this side change the note since the two agreed? With no row (never
 *  agreed), anything there counts as a change. */
function changed(now: Meta, agreed: string | undefined, hadRow: boolean): boolean {
  if (!hadRow) return Boolean(now);
  return ver(now) !== agreed;
}

async function readText(side: SyncSide, path: string): Promise<StoredFile | undefined> {
  return side.provider.read(side.resourceId, path);
}

/** Write `text` at `path` on a side, guarded by what this pass saw there. */
async function put(
  side: SyncSide,
  path: string,
  text: string,
  seen: string | undefined,
): Promise<string | undefined> {
  const guard = seen === undefined ? { ifAbsent: true as const } : { ifMatch: seen };
  const r = await side.provider.write(side.resourceId, path, text, guard);
  return r.ok ? versionOf(r.file) : undefined;
}

/** Take a note off a side, guarded, to Trash where the storage has one. */
async function drop(side: SyncSide, path: string, seen: string): Promise<boolean> {
  const p = side.provider;
  if (p.trash) {
    const r = await p.trash(side.resourceId, { kind: 'note', path, ifMatch: seen });
    // Already gone counts as done.
    return r.ok || r.conflict === 'missing';
  }
  return (await p.remove(side.resourceId, path, { ifMatch: seen })).ok;
}

/** One sync pass. Never throws for a note; a listing that fails throws, so
 *  the caller keeps its ledger and tries the whole pass again later. */
export async function syncPass(
  local: SyncSide,
  remote: SyncSide,
  ledger: SyncLedger,
  opts: SyncOptions,
): Promise<SyncResult> {
  const listOf = (s: SyncSide) => (s.list ? s.list() : s.provider.list(s.resourceId));
  const [lList, rList] = await Promise.all([listOf(local), listOf(remote)]);
  const L = byPath(lList);
  const R = byPath(rList);
  const next: SyncLedger = { ...ledger };
  const out: SyncResult = {
    ledger: next,
    pushed: [],
    pulled: [],
    removed: [],
    conflicts: [],
    skipped: [],
  };
  const paths = new Set([...L.keys(), ...R.keys(), ...Object.keys(ledger).filter(isNotePath)]);
  const taken = (p: string) => L.has(p) || R.has(p) || p in next;

  const agree = (path: string, l: string, r: string) => {
    next[path] = { local: l, remote: r };
  };
  const skip = (path: string, reason: string) => out.skipped.push({ path, reason });

  for (const path of [...paths].sort()) {
    const l = L.get(path);
    const r = R.get(path);
    const row = ledger[path];
    // A note whose bytes are not on a side yet (an iCloud placeholder) waits.
    if (l?.evicted || r?.evicted) {
      skip(path, 'downloading');
      continue;
    }
    const lMoved = changed(l, row?.local, Boolean(row));
    const rMoved = changed(r, row?.remote, Boolean(row));
    try {
      if (!lMoved && !rMoved) {
        if (!l && !r) delete next[path];
        continue;
      }
      if (lMoved && !rMoved) {
        if (l) {
          const file = await readText(local, path);
          if (!file) {
            skip(path, 'changed');
            continue;
          }
          const v = await put(remote, path, file.text, ver(r));
          if (v === undefined) skip(path, 'changed');
          else {
            agree(path, versionOf(file), v);
            out.pushed.push(path);
          }
        } else if (r && (await drop(remote, path, versionOf(r)))) {
          delete next[path];
          out.removed.push(path);
        } else skip(path, 'changed');
        continue;
      }
      if (rMoved && !lMoved) {
        if (r) {
          const file = await readText(remote, path);
          if (!file) {
            skip(path, 'changed');
            continue;
          }
          const v = await put(local, path, file.text, ver(l));
          if (v === undefined) skip(path, 'changed');
          else {
            agree(path, v, versionOf(file));
            out.pulled.push(path);
          }
        } else if (l && (await drop(local, path, versionOf(l)))) {
          delete next[path];
          out.removed.push(path);
        } else skip(path, 'changed');
        continue;
      }
      // Both changed.
      if (!l && !r) {
        delete next[path];
        continue;
      }
      if (!l && r) {
        // Deleted here, edited there: keep the edit.
        const file = await readText(remote, path);
        const v = file ? await put(local, path, file.text, undefined) : undefined;
        if (file && v !== undefined) {
          agree(path, v, versionOf(file));
          out.pulled.push(path);
        } else skip(path, 'changed');
        continue;
      }
      if (l && !r) {
        // Edited here, deleted there: keep the edit.
        const file = await readText(local, path);
        const v = file ? await put(remote, path, file.text, undefined) : undefined;
        if (file && v !== undefined) {
          agree(path, versionOf(file), v);
          out.pushed.push(path);
        } else skip(path, 'changed');
        continue;
      }
      const [mine, theirs] = await Promise.all([readText(local, path), readText(remote, path)]);
      if (!mine || !theirs) {
        skip(path, 'changed');
        continue;
      }
      if (mine.text === theirs.text) {
        agree(path, versionOf(mine), versionOf(theirs));
        continue;
      }
      // Keep both: this device's text goes beside the note on both sides,
      // then the note here takes the computer's version.
      const copy = opts.conflictPath(path, taken);
      const copyHere = await put(local, copy, mine.text, undefined);
      const copyThere = await put(remote, copy, mine.text, undefined);
      if (copyHere === undefined || copyThere === undefined) {
        skip(path, 'conflict-copy');
        continue;
      }
      agree(copy, copyHere, copyThere);
      const here = await put(local, path, theirs.text, versionOf(mine));
      if (here === undefined) {
        // Typed into while the pass ran: the copy is kept, the note waits.
        skip(path, 'changed');
        continue;
      }
      agree(path, here, versionOf(theirs));
      out.conflicts.push({ path, copy });
    } catch (err) {
      skip(path, err instanceof Error ? err.message : 'failed');
    }
  }
  for (const name of SYNCED_CONFIGS) {
    try {
      await syncConfig(local, remote, name, next, out);
    } catch (err) {
      skip(configKey(name), err instanceof Error ? err.message : 'failed');
    }
  }
  return out;
}

/** The vault's own settings file travels too: its privacy marks (it can only
 *  narrow) must hold on every device that has the notes. */
const SYNCED_CONFIGS: readonly VaultSettingsConfigName[] = ['oscode/vault'];

/** The ledger row for a settings file; never a note path. */
export function configKey(name: VaultSettingsConfigName): string {
  return `.config/${name}`;
}

/** One settings file, the notes' rule with one difference: there is no copy
 *  to keep beside it, so when both changed the computer's stands. */
async function syncConfig(
  local: SyncSide,
  remote: SyncSide,
  name: VaultSettingsConfigName,
  next: SyncLedger,
  out: SyncResult,
): Promise<void> {
  const lp = local.provider;
  const rp = remote.provider;
  if (!lp.readConfig || !lp.writeConfig || !rp.readConfig || !rp.writeConfig) return;
  const key = configKey(name);
  const [l, r] = await Promise.all([
    lp.readConfig(local.resourceId, name),
    rp.readConfig(remote.resourceId, name),
  ]);
  // Anything but there-or-absent (too large, downloading) waits.
  if ((!l.ok && l.reason !== 'absent') || (!r.ok && r.reason !== 'absent')) {
    out.skipped.push({ path: key, reason: 'settings' });
    return;
  }
  const row = next[key];
  const lv = l.ok ? l.version : undefined;
  const rv = r.ok ? r.version : undefined;
  const lMoved = row ? lv !== row.local : lv !== undefined;
  const rMoved = row ? rv !== row.remote : rv !== undefined;
  const guard = (v: string | undefined) =>
    v === undefined ? { ifAbsent: true as const } : { ifMatch: v };
  if (rMoved && r.ok && (!lMoved || !l.ok || l.text !== r.text)) {
    const w = await lp.writeConfig(local.resourceId, name, r.text, guard(lv));
    if (w.ok) {
      next[key] = { local: versionOf(w.file), remote: r.version };
      out.pulled.push(key);
    } else out.skipped.push({ path: key, reason: 'changed' });
    return;
  }
  if (lMoved && l.ok && !rMoved) {
    const w = await rp.writeConfig(remote.resourceId, name, l.text, guard(rv));
    if (w.ok) {
      next[key] = { local: l.version, remote: versionOf(w.file) };
      out.pushed.push(key);
    } else out.skipped.push({ path: key, reason: 'changed' });
    return;
  }
  if (l.ok && r.ok && l.text === r.text) next[key] = { local: l.version, remote: r.version };
}

/** "Plans/Ideas.md" -> "Plans/Ideas (from this iPhone 2026-10-16).md", with a
 *  number when that name is taken. `from` is the device's words, e.g.
 *  "from this iPhone". */
export function conflictCopyPath(
  path: string,
  from: string,
  day: string,
  taken: (p: string) => boolean,
): string {
  const stem = path.replace(/\.md$/i, '');
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${from} ${day}${n > 1 ? ` ${n}` : ''}).md`;
    if (!taken(candidate)) return candidate;
  }
}
