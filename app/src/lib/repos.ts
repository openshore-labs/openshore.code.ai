// Repositories: connect a platform (GitHub and friends) like Claude Code, and
// set a "home repo" once so the whole system works through it, the same way the
// stack works through your home LLM. Off-home and mobile, changes you deploy are
// buffered in the app (sealed at rest) as commit-intents; on dock the home
// engine materializes them into real git commits and pushes, and only then is a
// buffered item cleared. The protocol that guarantees "never lose work" lives in
// repoSync.ts; this file is the data model and the platform catalog.
//
// Tokens (GitHub, etc.) live in this device Keychain via secretSet, scoped per
// platform, never in the bundle.
import type { StorageLocation } from './gitos/location.js';

export type RepoPlatform = 'github' | 'gitlab' | 'bitbucket';

export interface RepoConnectorInfo {
  id: RepoPlatform;
  name: string;
  /** What the personal access token looks like, to reassure the user. */
  keyHint: string;
  /** Where OpenShore creates a token, shown as guidance. */
  tokenUrl: string;
}

export const REPO_CONNECTORS: RepoConnectorInfo[] = [
  {
    id: 'github',
    name: 'GitHub',
    keyHint: 'ghp_... or a fine-grained token',
    tokenUrl: 'https://github.com/settings/tokens',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    keyHint: 'glpat-...',
    tokenUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    keyHint: 'an app password',
    tokenUrl: 'https://bitbucket.org/account/settings/app-passwords/',
  },
];

export function repoConnector(id: string): RepoConnectorInfo | undefined {
  return REPO_CONNECTORS.find((c) => c.id === id);
}

export function repoSecretKey(id: string): string {
  return `oscode.secret.repo.${id}`;
}

// The home repo: the anchor, set once, admin-owned in a commercial org. It is
// either a location on the home system (reached over Tailscale) or a platform
// remote OpenShore pushes to on your behalf.
export interface HomeRepo {
  id: string;
  label: string;
  kind: 'home' | RepoPlatform;
  /** For a platform remote: the clone/push URL and which connector authorizes it. */
  remoteUrl?: string;
  connectorId?: RepoPlatform;
  /** For a home-system location: an opaque path on the desktop. */
  homePath?: string;
  defaultBranch: string;
}

// A home repo can only offload buffered work once its on-desktop working path
// is known: syncOutbox applies commits into that cwd, then pushes. Until a path
// is picked, the Sync affordance stays hidden rather than enabled-but-doomed.
export function homeRepoReady(home: HomeRepo | undefined): boolean {
  return Boolean(home?.homePath);
}

// A single file's post-image in a buffered commit-intent. Full content is
// content-addressed (sha256) and stored as a sealed blob (blobRef), so a retry
// is byte-identical and idempotent.
export interface OutboxFile {
  path: string;
  mode: 'upsert' | 'delete';
  sha256: string;
  /** A sealed-blob reference for large content (content-addressed at rest). */
  blobRef?: string;
  /** Inline post-image content, base64, for a self-contained item. */
  contentBase64?: string;
}

export type OutboxState = 'pending' | 'offloading' | 'confirmed' | 'conflict' | 'failed';

// A buffered commit-intent. Immutable payload once written; only state,
// attempts, lastError, and resultCommit change.
export interface OutboxItem {
  id: string;
  /** Immutable idempotency key: the same op never double-applies. */
  clientOpId: string;
  repoId: string;
  branch: string;
  message: string;
  /** The commit the edits were composed against, for conflict gating. */
  baseCommit: string;
  files: OutboxFile[];
  state: OutboxState;
  attempts: number;
  lastError?: string;
  resultCommit?: string;
  createdAt: string;
}

// ---- the repo registry (gitOS resources of kind 'repo') -------------------
//
// A cloned repo, and WHERE the user chose to keep it. This is the registry the
// CTO ruled for: it records what exists and its storage location, so the whole
// system works through a repo without re-deriving any of it, and reconnects on
// clone (the origin it came from and which platform token authorizes it). The
// bytes live on a real filesystem behind the git stack, never through the
// text StorageProvider seam Vault uses.

export type BackupInterval = 'manual' | 'daily' | 'weekly';

/** Scheduled backups to a SECOND user-chosen local/NAS folder (binary-safe
 *  mirror). The repo already lives on storage the user owns, so this is the
 *  headline gitOS differentiator: a near-free offsite copy. */
export interface BackupConfig {
  enabled: boolean;
  interval: BackupInterval;
  /** The second folder the mirror lands in. Real filesystem only in v1. */
  destParent: string;
  lastBackupAt?: string;
  lastError?: string;
}

export interface RepoRecord {
  id: string;
  name: string;
  /** Absolute working-copy path on the box (the git cwd). */
  cwd: string;
  /** Where the user chose to keep it. */
  location: StorageLocation;
  /** The remote it was cloned from, so it reconnects on clone. */
  remoteUrl?: string;
  /** Which connected platform token authorizes its pushes, if any. */
  connectorId?: RepoPlatform;
  defaultBranch: string;
  backup?: BackupConfig;
  createdAt: string;
  lastOpenedAt?: string;
}

/** How long between scheduled backups, in ms; undefined for manual-only. */
export function backupIntervalMs(interval: BackupInterval): number | undefined {
  if (interval === 'daily') return 24 * 60 * 60 * 1000;
  if (interval === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  return undefined;
}

/** Is a repo's scheduled backup due now? Manual-only or disabled is never due;
 *  a never-run schedule is due immediately. Pure, so it is unit-tested. */
export function backupDue(repo: RepoRecord, now: number): boolean {
  const b = repo.backup;
  if (!b || !b.enabled) return false;
  const every = backupIntervalMs(b.interval);
  if (every === undefined) return false;
  if (!b.lastBackupAt) return true;
  const last = Date.parse(b.lastBackupAt);
  return !Number.isFinite(last) || now - last >= every;
}

/** Infer the platform connector from a clone URL, for reconnect wiring. */
export function connectorForUrl(url: string): RepoPlatform | undefined {
  if (/github\.com/i.test(url)) return 'github';
  if (/gitlab\.com/i.test(url)) return 'gitlab';
  if (/bitbucket\.org/i.test(url)) return 'bitbucket';
  return undefined;
}

export interface RepoState {
  homeRepo?: HomeRepo;
  outbox: OutboxItem[];
  /** Repos the user has cloned, with their chosen storage location. */
  repos?: RepoRecord[];
}
