// The Vault's M6 operations (CTO K3 to K7, K11, reconciled R1 to R3): rename
// and move with links following, folders, Trash, restore, Undo, Today, and the
// checkbox write-back. They live here, apart from the store, so the
// orchestration is testable with a fake provider and a fake index and without
// the store: the store builds a `VaultOpsDeps` for the vault on screen and
// delegates (wave 2 integrator, call sites only).
//
// Wave 0: the deps interface only, and no logic. Stream G writes the
// operations below it (test: app/test/vaultOps.test.ts).
import type { VaultIndexHost } from '../lib/vaultIndexHost.js';
import type {
  StorageProvider,
  StoredFile,
  StoredFileMeta,
  WriteGuard,
  WriteResult,
} from '../lib/gitos/providers.js';
import type { VaultTargetRef } from './store.js';

/** The note open on screen, as an operation needs to see it: a note with
 *  unsaved edits or an open resolve choice is never rewritten under the
 *  person (R1). */
export interface VaultOpsOpenNote {
  path: string;
  /** The version the editor's text is based on (`versionOf`). */
  version: string;
  /** Typed text not yet saved. */
  dirty: boolean;
  /** A resolve choice is open on it. */
  choiceOpen: boolean;
}

/** Everything an M6 operation reaches, fixed for one vault when the
 *  operation starts, so a scope flip or a sign-out mid-flight can never send
 *  one vault's change to the other (the 0.7 rule). */
export interface VaultOpsDeps {
  /** The vault this operation acts on. */
  target: VaultTargetRef;
  /** Its storage. What it may do is `vaultCaps(provider, ...)`
   *  (lib/vaultCaps.ts, stream C); nothing falls back on a provider without
   *  `compareAndSwap` (K3). */
  provider: StorageProvider;
  /** The vault's index host, when one is open. A rewrite plan picks its
   *  sources from the index only, never a whole-vault read (K4). */
  index: () => VaultIndexHost | undefined;
  /** The store's one write path: the provider's write, then the list, the
   *  body cache and the index patched from the result. Every rewrite, Today
   *  and every tick go through it. */
  putVaultNote: (path: string, text: string, guard: WriteGuard) => Promise<WriteResult>;
  /** A note's text through the store's body cache, or undefined. */
  readBody: (path: string) => Promise<string | undefined>;
  /** Patch callbacks for a change the operation made itself that is not a
   *  plain write: the list, the body cache and the index, without a re-list. */
  patch: {
    /** A note written or restored. */
    saved: (file: StoredFile) => void;
    /** A note gone (trashed, deleted, or moved away from `path`). */
    removed: (path: string) => void;
    /** A note renamed: `to` carries its version at the new path. */
    renamed: (from: string, to: StoredFileMeta) => void;
  };
  /** Re-key everything a path owns on this device after a rename: project
   *  pins (`vaultRenamePins`), stash entries, the recent ring, and the open
   *  note. */
  rekey: (from: string, to: string) => Promise<void>;
  /** Write the open note's pending save now, before an operation reads it. */
  flushOpenSave: () => Promise<void>;
  /** The note open on screen, or undefined. */
  openNote: () => VaultOpsOpenNote | undefined;
  /** The clock (tests pass their own). */
  now?: () => number;
}

// ---- stream G: the operations -----------------------------------------------

// ---- end stream G -----------------------------------------------------------
