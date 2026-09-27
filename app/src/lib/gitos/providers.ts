// The gitOS storage seam. A gitOS resource (a code repo, a vault) is a named
// tree of files whose bytes live WHERE THE USER CHOSE, and this interface is
// the one seam everything above it sees: the Vault UI, the repo browser, and
// eventually real git working copies all read and write through a
// StorageProvider and never learn which backend holds the bytes. Get more
// backends by adding providers; nothing above the seam changes.
//
// v1 ships one live provider (Local: this device, through the app's existing
// sealed key-value store, encrypted at rest under the device DEK). iCloud,
// Dropbox, Google Drive, and Proton Drive are REGISTERED so the modularity is
// real and visible, but marked not ready until their OAuth wiring lands. They
// are never faked.

// 'files' is the on-disk folder provider (desktop only): plain .md files under
// the agent's vault directory (~/OSCode/Vault), so the app and the agent share
// one folder that Obsidian opens directly. It IS a roster entry (a real place
// to keep the personal vault). 'org' is the Team vault (Supabase-backed,
// organization tier), a real provider behind the seam but deliberately NOT in
// PROVIDER_ROSTER: the team vault is reached by the Vault scope switcher, not by
// moving the personal vault's bytes, so it never appears in the "where it lives"
// sheet.
export type StorageProviderId =
  'local' | 'files' | 'icloud' | 'dropbox' | 'gdrive' | 'proton' | 'org';

/** One file inside a gitOS resource, addressed by a relative POSIX-style
 *  path (e.g. "notes/ideas/vault-design.md"). Paths map 1:1 onto a real
 *  folder when a file-backed provider takes over from the sealed store. */
export interface StoredFile {
  path: string;
  /** Body as UTF-8 text. v1 carries text (markdown, code, config). */
  text: string;
  updatedAt: string;
  /** Opaque. Compare with === only; never parse, order, or carry across
   *  providers. Set by providers that version their files natively (the
   *  desktop folder's lstat token); the rest leave it out, and versionOf
   *  falls back to updatedAt. */
  version?: string;
}

export interface StoredFileMeta {
  path: string;
  updatedAt: string;
  /** Body size in bytes; a cheap size signal for lists. */
  size: number;
  /** Opaque. Compare with === only; never parse, order, or carry across
   *  providers. Same token as StoredFile.version for the same bytes. */
  version?: string;
  /** True when the provider knows the file exists but its bytes are not on
   *  this device yet (an iCloud placeholder). Opening it waits; creating a
   *  file of the same name must never overwrite it. */
  evicted?: boolean;
}

/** Whether a path in a vault is a note the Vault shows and edits: a `.md`
 *  file with no dot-folder or dot-file segment. So Obsidian's `.obsidian/`,
 *  its `.trash/`, our own `.oscode/`, and a `.git/` never list as notes, and
 *  attachments (images, PDFs, `.canvas`, `.base`) never open as text. One
 *  rule at the seam, shared by every provider and by a vault move. */
export function isNotePath(path: string): boolean {
  if (!/\.md$/i.test(path)) return false;
  return !path.split('/').some((segment) => segment.startsWith('.'));
}

/** The version a write's guard compares against: the provider's own opaque
 *  version where it has one, else its updatedAt. The only way the store
 *  derives a base (Vault M1, CTO F1). */
export function versionOf(f: { version?: string; updatedAt: string }): string {
  return f.version ?? f.updatedAt;
}

/** A write's precondition. `ifMatch` replaces the file only while its version
 *  (versionOf) is still this one; `ifAbsent` creates it only while nothing has
 *  the name. */
export type WriteGuard = { ifMatch: string } | { ifAbsent: true };

/** What a write did. A conflict is a result, never a throw, and leaves the
 *  file as it was: 'changed' (the version moved; theirs is what is there now),
 *  'missing' (an ifMatch found nothing; nothing is recreated), 'exists' (an
 *  ifAbsent found the name taken; theirs is what has it), 'downloading'
 *  (reserved for iCloud and the iPhone folder: the bytes are not here yet). */
export type WriteResult =
  | { ok: true; file: StoredFile }
  | { ok: false; conflict: 'changed' | 'missing' | 'exists' | 'downloading'; theirs?: StoredFile };

/** A lease marks one writer per resource. Cloud folder syncs have no
 *  Git-aware locking, so the seam carries single-writer semantics from day
 *  one (CTO ruling): a holder id plus TTL, renewed by heartbeat. The Local
 *  provider grants trivially; cloud providers will contest for real. */
export interface Lease {
  holder: string;
  expiresAt: string;
}

/** The seam. Path/bytes-shaped on purpose: list, stat, read, write, remove,
 *  and lease operations, scoped to a resource id (one repo or vault). Nothing
 *  above it may pass note objects or provider-specific ideas through here.
 *  Writes are atomic per path: a reader sees the old body or the new one,
 *  never a torn write. A write may carry a guard (compare-and-swap, Vault
 *  M1 1.1) and answers with a result, never a throw, on a conflict. Only a
 *  provider with `compareAndSwap` enforces the guard; the others accept it and
 *  ignore it until they gain the check (M2), so an `{ ok: true }` from them is
 *  never proof that nobody else wrote. */
export interface StorageProvider {
  id: StorageProviderId;
  label: string;
  /** One honest line about where bytes live with this provider. */
  blurb: string;
  /** False until the backend's wiring (OAuth, entitlements) is in place.
   *  A not-ready provider is shown, never selectable, never faked. */
  ready: boolean;
  /** Why a not-ready provider is not ready, in user-facing words. */
  pending?: string;
  list(resourceId: string): Promise<StoredFileMeta[]>;
  stat(resourceId: string, path: string): Promise<StoredFileMeta | undefined>;
  read(resourceId: string, path: string): Promise<StoredFile | undefined>;
  write(resourceId: string, path: string, text: string, guard?: WriteGuard): Promise<WriteResult>;
  /** Set only by providers that enforce the write guard; the contract test
   *  (test/providerContract.test.ts) enrolls only these. */
  readonly compareAndSwap?: true;
  remove(resourceId: string, path: string): Promise<void>;
  /** Take or renew the single-writer lease. Returns the current lease either
   *  way; callers compare holder to know if they won. */
  acquireLease(resourceId: string, holder: string, ttlMs: number): Promise<Lease>;
  releaseLease(resourceId: string, holder: string): Promise<void>;
}

/** A gitOS resource: metadata for one repo or vault. The bytes live behind
 *  the provider; this record lives in settings. */
export interface GitosResource {
  id: string;
  name: string;
  kind: 'vault' | 'repo';
  providerId: StorageProviderId;
  createdAt: string;
  /** When the person last moved this resource themselves (any vaultMoveTo),
   *  so a storage they chose on purpose is never repointed or offered a move
   *  (Vault M1 1.3). Absent on a resource nobody has moved. */
  chosenAt?: string;
}

/** The backends a user can point a resource at, in picker order. Only
 *  entries whose provider is ready are selectable. What the Vault says about
 *  each one, per platform, lives in one place: lib/vaultCopy.ts (0.19). */
export const PROVIDER_ROSTER: Array<{
  id: StorageProviderId;
  label: string;
  ready: boolean;
  pending?: string;
  // No wiring at all yet (no OAuth, no plugin): shown as a single quiet
  // "more storage arriving" line rather than a tappable row that only toasts.
  // Distinct from icloud, wired and ready at runtime, and gdrive, wired but
  // held back, which each keep a row of their own.
  arriving?: boolean;
  // The pill a not-ready row wears when it is possible on this device but
  // switched off (iCloud signed out, or iCloud Drive off), instead of
  // "Arriving", which promises the thing is coming here. The step to turn it
  // on is `pending`, said in the toast.
  offPill?: string;
}> = [
  {
    id: 'local',
    label: 'This device',
    ready: true,
  },
  {
    id: 'files',
    label: 'This folder',
    // Desktop only; probeReady('files') decides at runtime by whether the
    // Electron file bridge is present, so ready stays false here.
    ready: false,
    pending: 'Open OpenShore on your computer to keep the vault as a folder.',
  },
  {
    id: 'icloud',
    // Wired (oscode-icloud plugin); readiness is decided at runtime by the
    // device, so ready stays false here and probeReady('icloud') is the truth.
    label: 'iCloud Drive',
    ready: false,
    pending: 'Sign in to iCloud and turn on iCloud Drive in Settings on this iPhone to use it.',
    offPill: 'Turned off',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    ready: false,
    pending: 'Arriving. Needs the Dropbox connection.',
    arriving: true,
  },
  {
    id: 'gdrive',
    // Wired (Drive REST + OAuth PKCE) but held back for v1 (D1, 0.18):
    // probeReady('gdrive') is false, so it shows as Arriving and takes no new
    // vault. A vault already there is read-only and moves off.
    label: 'Google Drive',
    ready: false,
    pending: 'Google Drive is held back for now while its sync is made safe.',
  },
  {
    id: 'proton',
    label: 'Proton Drive',
    ready: false,
    pending: 'Arriving. Needs the Proton connection.',
    arriving: true,
  },
];
