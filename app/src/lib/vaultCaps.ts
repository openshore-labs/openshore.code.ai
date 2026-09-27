// What the Vault offers on a storage (Vault M6, CTO K1): one pure answer, from
// the provider's own members and never from its id, so a held branch lights
// a row by adding members to its provider, never by a UI change.
//
// The rules:
// - Every write-shaped action (rename, folders, Trash, link rewrites, the
//   checkbox write-back, Today) needs `compareAndSwap`. A provider without it
//   gets none of them: its `ok` is never proof that nobody else wrote, and a
//   rename, a rewrite or a tick on top of that could lose someone's words.
//   So today's team client and main's iCloud show no Rename and no checkbox
//   write-back, and Google Drive (read-only, D1) shows none.
// - One-tap delete only where Trash is real (CTO R2): `trash` is true only
//   when the provider can move a note to Trash, list it, and restore it. Any
//   other delete is permanent and asks twice.
// - Read-only (a lease held elsewhere, Drive, a sign-in that expired, a move
//   in flight) or a computer that is away turns every write-shaped action off;
//   the room's standing line already says why. Today is the one exception:
//   an existing note still opens read-only (CX X11), so `today` follows the
//   storage alone and the store refuses a create in the read-only words.
// - Reading attachments is not a write, so read-only and away leave it on
//   (the image says the computer is off, CX X14).
// - The Vault settings sheet saves (Vault M7, CTO L7) only where the storage
//   writes its settings file under compare-and-swap (`writeConfig`), and only
//   while writable and not away. A vault's own `delete: permanent` (L11)
//   turns one-tap Trash off, so every delete asks twice "for good".
// - On a team vault only an admin saves the settings (CX Y14; 0021 refuses a
//   member there too): `settingsAdmin: false` keeps the sheet read-only.
import type { VaultDeleteMode } from 'os-code/protocol';
import type { StorageProvider } from './gitos/providers.js';

/** What the Vault may offer on one storage right now. */
export interface VaultCaps {
  /** Rename or move one note (natively, or by the K3 compare-and-swap
   *  fallback: write the new name if absent, then remove the old). */
  rename: boolean;
  /** The storage renames in one native step (`rename` on the seam). */
  renameNative: boolean;
  /** Make, rename and move folders. */
  folders: boolean;
  /** Delete moves to a real Trash with Restore, so it is one tap (R2). */
  trash: boolean;
  /** Trash can be emptied from here (not a team vault's, R3). */
  emptyTrash: boolean;
  /** Images and PDFs show (readBytes and the attachment list). */
  attachments: boolean;
  /** A tick in reading view writes the box back. */
  taskWriteBack: boolean;
  /** A rename offers "Update N links in M notes?". */
  linkRewrite: boolean;
  /** Today's note can be started here. */
  today: boolean;
  /** The Vault settings sheet can save (Vault M7, CTO L7): `writeConfig`,
   *  compare-and-swap, writable, not away. Without it the sheet is read-only
   *  with the storage's own line (`vaultCapLine(provider, 'settingsWrite')`). */
  settingsWrite: boolean;
}

/** The room's state that narrows what the storage could do. */
export interface VaultCapsState {
  /** No writes now: a lease held elsewhere, Drive, an expired team sign-in,
   *  a move in flight, a folder gone. */
  readOnly: boolean;
  /** Your computer's reach (`HubReach`); `away` is read-only. Absent or
   *  `unknown` for every other storage and before the first answer. */
  reach?: 'unknown' | 'reachable' | 'away';
  /** A team vault: whether this person is an admin, who alone saves its
   *  settings (CX Y14). Absent for every other storage. */
  settingsAdmin?: boolean;
}

/** The vault's own settings that narrow the caps (Vault M7, CTO L11): the
 *  resolved `delete` mode. Absent before the settings load, which reads as
 *  the default (`trash`). */
export interface VaultCapsSettings {
  delete?: VaultDeleteMode;
}

const has = (p: StorageProvider, member: keyof StorageProvider): boolean =>
  typeof p[member] === 'function';

export function vaultCaps(
  p: StorageProvider,
  s: VaultCapsState,
  settings?: VaultCapsSettings,
): VaultCaps {
  const cas = p.compareAndSwap === true;
  const writable = cas && !s.readOnly && s.reach !== 'away';
  const trash =
    writable &&
    settings?.delete !== 'permanent' &&
    has(p, 'trash') &&
    has(p, 'listTrash') &&
    has(p, 'restore');
  return {
    rename: writable,
    renameNative: writable && has(p, 'rename'),
    folders: writable,
    trash,
    emptyTrash: trash && has(p, 'emptyTrash'),
    attachments: has(p, 'readBytes') && has(p, 'listAttachments'),
    taskWriteBack: writable,
    linkRewrite: writable,
    today: cas,
    settingsWrite: writable && has(p, 'writeConfig') && s.settingsAdmin !== false,
  };
}
