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
}

export interface StoredFileMeta {
  path: string;
  updatedAt: string;
  /** Body length in UTF-16 code units; a cheap size signal for lists. */
  size: number;
}

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
 *  never a torn write. */
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
  write(resourceId: string, path: string, text: string): Promise<StoredFile>;
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
}

/** The backends a user can point a resource at, in picker order. Only
 *  entries whose provider is ready are selectable. */
export const PROVIDER_ROSTER: Array<{
  id: StorageProviderId;
  label: string;
  blurb: string;
  ready: boolean;
  pending?: string;
  // No wiring at all yet (no OAuth, no plugin): shown as a single quiet
  // "more storage arriving" line rather than a tappable row that only toasts.
  // Distinct from icloud/gdrive, which are wired and become ready at runtime.
  arriving?: boolean;
}> = [
  {
    id: 'local',
    label: 'This device',
    blurb: 'Stored here, sealed at rest. Private by construction.',
    ready: true,
  },
  {
    id: 'files',
    label: 'This folder',
    blurb:
      'Plain .md files on this computer. Your agent writes here too, and Obsidian opens the folder.',
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
    blurb: 'Your iCloud, synced by iOS across your devices.',
    ready: false,
    pending: 'Sign in to iCloud on this iPhone to use it.',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    blurb: 'Your Dropbox account, your bytes.',
    ready: false,
    pending: 'Arriving. Needs the Dropbox connection.',
    arriving: true,
  },
  {
    id: 'gdrive',
    // Wired (Drive REST + OAuth PKCE); readiness is decided at runtime by
    // whether an account is connected, so ready stays false here and
    // probeReady('gdrive') is the truth.
    label: 'Google Drive',
    blurb: 'Your Drive, your bytes. Files added outside OpenShore may not show up here.',
    ready: false,
    pending: 'Connect your Google account to use this.',
  },
  {
    id: 'proton',
    label: 'Proton Drive',
    blurb: 'End-to-end encrypted storage you already trust.',
    ready: false,
    pending: 'Arriving. Needs the Proton connection.',
    arriving: true,
  },
];
