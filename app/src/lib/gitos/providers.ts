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

import type {
  AttachmentMeta,
  BytesRead,
  ConfigRead,
  ReadBytesOptions,
  VaultConfigName,
  VaultSettingsConfigName,
  VaultSettingsField,
  VaultTrashEntry,
} from 'os-code/protocol';
import { thisDeviceNoun } from '../deviceNoun.js';

// 'files' is the on-disk folder provider (desktop only): plain .md files under
// the agent's vault directory (~/OSCode/Vault), so the app and the agent share
// one folder that Obsidian opens directly. It IS a roster entry (a real place
// to keep the personal vault). 'org' is the Team vault (Supabase-backed,
// organization tier), a real provider behind the seam but deliberately NOT in
// PROVIDER_ROSTER: the team vault is reached by the Vault scope switcher, not by
// moving the personal vault's bytes, so it never appears in the "where it lives"
// sheet. 'hub' is the paired computer's vault over the daemon's /vault routes
// (Vault M5, tech review J9; lib/gitos/hub.ts), shown as "Your computer".
export type StorageProviderId =
  'local' | 'files' | 'icloud' | 'dropbox' | 'gdrive' | 'proton' | 'org' | 'hub';

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
  /** Who last changed this note, when the provider knows (the team vault
   *  only; Vault M2, tech review G6). `label` is a short display name, never an
   *  email address in full. Absent everywhere else. */
  editedBy?: { id: string; label?: string };
}

/** Whether a path in a vault is a note the Vault shows and edits: a `.md`
 *  file with no dot-folder or dot-file segment. So Obsidian's `.obsidian/`,
 *  its `.trash/`, our own `.oscode/`, and a `.git/` never list as notes, and
 *  attachments (images, PDFs, `.canvas`, `.base`) never open as text. One
 *  rule at the seam, shared by every provider and by a vault move. */
export function isNotePath(path: string): boolean {
  if (!/\.md$/i.test(path)) return false;
  // A backslash (a Windows separator) or a leading "/" never names a note, so
  // no spelling slips past the dot rule (review M1-5). Main also refuses a
  // colon on Windows, where it names a drive or an NTFS stream.
  if (path.includes('\\') || path.startsWith('/')) return false;
  return !path.split('/').some((segment) => segment.startsWith('.'));
}

/** The version a write's guard compares against: the provider's own opaque
 *  version where it has one, else its updatedAt. The only way the store
 *  derives a base (Vault M1, tech review F1). */
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

/** A remove's precondition: remove the file only while its version
 *  (versionOf) is still this one. */
export type RemoveGuard = { ifMatch: string };

/** What a remove did (Vault M2, tech review G7 wave 0). A file already gone is
 *  `{ ok: true }`: the person wanted it gone, and it is. A conflict is a
 *  result, never a throw, and leaves the file where it was: 'changed' (the
 *  version moved since the guard was read; theirs is what is there now, when
 *  the provider can say), 'downloading' (iCloud and the iPhone folder: the
 *  bytes are not here yet, so the version cannot be checked). */
export type RemoveResult =
  { ok: true } | { ok: false; conflict: 'changed' | 'downloading'; theirs?: StoredFile };

// ---- Vault M6 seam results (tech review K2, K3, K5, K6, reconciled R1 to R3) ------
// Every M6 member below is optional, and every conflict is a result, never a
// throw. A write-shaped member (rename, trash, restore, empty) is lit by
// `vaultCaps` (lib/vaultCaps.ts) only on a provider with `compareAndSwap`.

/** A rename's precondition: the source's `versionOf`, as the open note or
 *  the list last read it. */
export type RenameGuard = { ifMatch: string };

/** What a rename did (K3). It never replaces: 'exists' when `to` is taken
 *  (judged by the folded path; theirs is what has it), 'missing' when the
 *  source is gone, 'changed' when its version moved (theirs is what is
 *  there), 'downloading' for a note not yet on this device. On success `file`
 *  is the note at `to` with its version THERE, which the store adopts and
 *  never assumes equals the old one. Parents of `to` are created. */
export type RenameResult =
  | { ok: true; file: StoredFileMeta }
  | { ok: false; conflict: 'changed' | 'missing' | 'exists' | 'downloading'; theirs?: StoredFile };

/** What creating a folder did. */
export type CreateFolderResult = { ok: true } | { ok: false; conflict: 'exists' };

/** What a folder rename did (K5): one directory rename, the destination
 *  absent. `moved` names every note with its new version; `attachments`
 *  counts the other files that went with them. */
export type FolderMoveResult =
  | { ok: true; moved: Array<{ from: string; to: string; version: string }>; attachments: number }
  | { ok: false; conflict: 'exists' | 'missing' };

/** One thing in Trash (K6), the shape the daemon wire shares. */
export type TrashEntry = VaultTrashEntry;

/** What goes to Trash: a note guarded by its version, or a folder as it is
 *  (Trash is recoverable, so a folder move is unguarded). */
export type TrashTarget =
  { kind: 'note'; path: string; ifMatch: string } | { kind: 'folder'; path: string };

/** What a trash did, with the counts the toast and the sheet say. */
export type TrashResult =
  | { ok: true; entry: TrashEntry; notes: number; attachments: number }
  /** The note was already gone (deleted or moved elsewhere), so nothing went
   *  to Trash here: the team vault's remove answers so for a gone note. */
  | { ok: false; conflict: 'missing'; theirs?: undefined }
  | { ok: false; conflict: 'changed' | 'downloading'; theirs?: StoredFile };

/** A folder's trash that stopped part way (the team vault, which trashes a
 *  folder note by note): how many went to Trash, the paths still in the
 *  folder, and why, when a refusal for good said (its reason, never a whole
 *  line); `lapsed` when the plan stopped being active, so no Undo is offered
 *  (it would be refused the same way). No line: a failure that may pass. A
 *  storage that trashes all or nothing never sets it (round 7 E20). */
// `changed`: the paths of `left` a teammate saved while the trash ran, which
// its guard passed over rather than delete a version nobody here has seen
// (round 7 E21).
export interface TrashPartial {
  trashed: number;
  left: string[];
  line?: string;
  lapsed?: true;
  changed?: string[];
}

/** A TrashResult whose ok answer may carry a TrashPartial, and whose
 *  'changed' answer for a folder that moved nothing (every note in it
 *  changed while it ran) names them in one, with `trashed` 0. */
export type TrashReport = TrashResult & { partial?: TrashPartial };

/** What a restore did. It never overwrites: a taken name lands beside it as
 *  "{title} (restored)" (R3) and `renamed` says so; parents are made. */
/** How a restore was asked for. `listed`: from a row the Trash page showed,
 *  which may be stale on a storage others share, so it comes back only while
 *  it is still in Trash (round 7 E38); an Undo of this device's own delete
 *  brings back what that delete took. */
export interface RestoreOptions {
  listed?: boolean;
}

export type RestoreResult =
  { ok: true; file: StoredFileMeta; renamed: boolean } | { ok: false; conflict: 'missing' };

/** A folder's Restore that brought back only some of its notes (the team
 *  vault near its free space, migration 0023): how many came back, the paths
 *  still in Trash, and the storage's own line for why, when a refusal said
 *  one. A storage that restores all or nothing never sets it. */
export interface RestorePartial {
  restored: number;
  left: string[];
  line?: string;
}

/** A restored note that came back beside its own name (the team vault,
 *  round 7 E23): the name it had, where it landed, and whether that name is
 *  held by another delete still in Trash rather than by a note in the vault. */
export interface RestoreBeside {
  from: string;
  to: string;
  inTrash: boolean;
}

/** A RestoreResult whose ok answer may carry a RestorePartial, and the notes
 *  that came back beside their names. Every RestoreResult is one, so a
 *  caller reads `partial` and `beside` without a cast. */
export type RestoreReport = RestoreResult & {
  partial?: RestorePartial;
  beside?: RestoreBeside[];
};

/** What Delete forever or Empty Trash removed. */
export interface EmptyTrashResult {
  removed: number;
}

/** A lease marks one writer per resource: a holder id plus TTL, taken while
 *  the person types. On a storage with compare-and-swap it is advisory (the
 *  "Also open on your iPad" line); only a storage without it has the lease
 *  enforced (Vault M2, tech review G5; lib/vaultLease.ts). */
export interface Lease {
  holder: string;
  expiresAt: string;
  /** The holder's device kind ("iPhone", "iPad", "Mac"), for the quiet "Also
   *  open on your iPad" line (Vault M2, tech review G5). Never a personal device
   *  name. */
  label?: string;
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
  /** Remove a file. A guard is enforced only by a provider that enforces it
   *  (the desktop folder, in wave 0 of M2); the others accept it and answer
   *  `{ ok: true }` until they gain the check, so their ok is never proof
   *  that nobody else wrote. */
  remove(resourceId: string, path: string, guard?: RemoveGuard): Promise<RemoveResult>;
  /** Take or renew the single-writer lease. Returns the current lease either
   *  way; callers compare holder to know if they won. `label` is this
   *  device's kind (Lease.label), kept with a lease the provider writes
   *  (Vault M2, tech review G5); a provider that keeps no lease file ignores it. */
  acquireLease(resourceId: string, holder: string, ttlMs: number, label?: string): Promise<Lease>;
  releaseLease(resourceId: string, holder: string): Promise<void>;
  /** Read one of the vault's config files by its logical name (Vault M3, tech review
   *  H5): Obsidian's app, daily-notes and templates settings, or the vault's
   *  own `.oscode/vault.json`. No path crosses the seam; each provider maps a
   *  name through its own allow-list, and anything else answers `refused`
   *  (never a plugin folder, never `workspace*.json`). Optional, so a
   *  provider that has not gained it yet answers `unsupported` through
   *  readVaultConfig (lib/gitos/config.ts). Capped at 256 KB of UTF-8. */
  readConfig?(resourceId: string, name: VaultConfigName): Promise<ConfigRead>;

  // ---- Vault M6 (tech review K2). All optional, appended after readConfig so the
  // held branches rebase with the least conflict; a held branch lights its
  // row by adding members, never by a UI change. `providerContract` rows run
  // for any provider that declares a member.

  /** Rename or move one note, never replacing (K3). */
  rename?(resourceId: string, from: string, to: string, guard: RenameGuard): Promise<RenameResult>;
  /** The storage's real folders, empty ones too (desktop, hub). */
  listFolders?(resourceId: string): Promise<string[]>;
  /** Make a folder (mkdir) where the storage has real folders. */
  createFolder?(resourceId: string, path: string): Promise<CreateFolderResult>;
  /** Rename a folder in one move; the destination must be absent. */
  renameFolder?(resourceId: string, from: string, to: string): Promise<FolderMoveResult>;
  /** Move a note or a folder to Trash (K6). */
  trash?(resourceId: string, target: TrashTarget): Promise<TrashResult>;
  /** What is in Trash. */
  listTrash?(resourceId: string): Promise<TrashEntry[]>;
  /** Put one entry back where it came from, never overwriting. */
  restore?(resourceId: string, id: string, opts?: RestoreOptions): Promise<RestoreResult>;
  /** Delete entries for good, or all of Trash with no ids. */
  emptyTrash?(resourceId: string, ids?: string[]): Promise<EmptyTrashResult>;
  /** The vault's attachments (K11), from the same walk as the note list. */
  listAttachments?(resourceId: string): Promise<AttachmentMeta[]>;
  /** One attachment's bytes, capped at 20 MB (`VAULT_ATTACHMENT_MAX_BYTES`). */
  readBytes?(resourceId: string, path: string, opts?: ReadBytesOptions): Promise<BytesRead>;

  // ---- Vault M7 (tech review L7). Optional, after the K2 members. Lit in the sheet
  // only through `vaultCaps().settingsWrite` (compare-and-swap, writable,
  // not away). No agent path may name it (a grep test in each package).

  /** Write the vault's own settings file (`.oscode/vault.json` on a folder,
   *  the sealed key on Local), guarded: `ifMatch` replaces it only while its
   *  version is still that one, `ifAbsent` creates it only while there is
   *  none. `name` is only ever `oscode/vault`; every `obsidian/*` name is
   *  refused on every host (Obsidian's config is read, never written). A
   *  conflict is a result, never a throw. `file.version` is the new version. */
  writeConfig?(
    resourceId: string,
    name: VaultSettingsConfigName,
    text: string,
    guard: WriteGuard,
  ): Promise<WriteResult>;

  /** The vault settings this storage does not carry out, so none of them
   *  may say or do anything here: the settings sheet never offers their
   *  rows, `saveVaultSetting` never saves one, `vaultCaps` never lets one
   *  narrow the room, and the provider neither reads one back nor sends one.
   *  The team vault's are `ORG_VAULT_UNAPPLIED_SETTINGS` (its deletes always
   *  keep the note in Trash, it holds notes only, and no model reads it in
   *  v1). Absent: every field applies. */
  readonly unappliedSettings?: readonly VaultSettingsField[];
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
    id: 'hub',
    // The paired computer's one vault (Vault M5, tech review J9). Readiness is decided
    // at runtime (probeReady('hub'): paired and answering), so ready stays
    // false here. Not offered in the storage sheet until the provider lands
    // (vaultOffersProvider in lib/vaultCopy.ts).
    label: 'Your computer',
    ready: false,
    pending: 'Pair with your computer to keep one vault there.',
  },
  {
    id: 'icloud',
    // Wired (oscode-icloud plugin); readiness is decided at runtime by the
    // device, so ready stays false here and probeReady('icloud') is the truth.
    label: 'iCloud Drive',
    ready: false,
    pending: `Sign in to iCloud and turn on iCloud Drive in Settings on ${thisDeviceNoun()} to use it.`,
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
