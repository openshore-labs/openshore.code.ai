// The Vault's Trash (Vault M6 6.3; CTO K6, R2, R3; CX X10): a page inside the
// Vault room, back to Vault by the BackBar. Each row names the note, where it
// came from and when it was deleted, with one Restore. Empty Trash sits at the
// bottom behind two taps, the second in danger styling with the count. A team
// vault's Trash restores only: its tombstones and revisions are the
// organization's record, so there is no Empty (R3).
//
// Prop-driven: the room lists Trash (`listTrash` in state/vaultOps.ts), and
// owns the restore, the empty, and their toasts. Rows arrive one after
// another on the stagger; a restored row leaves when the list comes back.
import { useEffect, useState, type CSSProperties } from 'react';
import { noteFolder, noteTitle } from 'os-code/protocol';
import { BackBar } from '../BackBar.js';
import type { TrashEntry } from '../../lib/gitos/providers.js';
import {
  VAULT_TRASH,
  VAULT_TRASH_BACK,
  VAULT_TRASH_EMPTY,
  VAULT_TRASH_IS_EMPTY,
  VAULT_TRASH_RESTORE,
  VAULT_TRASH_TEAM_LINE,
  vaultTrashEmptyArmed,
  vaultTrashLead,
  vaultTrashRestoreLabel,
  vaultTrashRowSub,
  vaultTrashWhen,
} from '../../lib/vaultCopy.js';

export type VaultTrashKind = 'folder' | 'local' | 'team';

export interface VaultTrashViewProps {
  /** Where the Trash lives: the .trash folder, this device, or the team. */
  kind: VaultTrashKind;
  /** What is in Trash, or undefined while it loads. */
  entries: readonly TrashEntry[] | undefined;
  /** A line when Trash could not be read. */
  error?: string;
  /** Who deleted a team note, by `vaultEditedByLine`'s naming rule. */
  deletedBy?: (entry: TrashEntry) => string | undefined;
  /** The clock (tests pass their own). */
  now?: number;
  onBack: () => void;
  onRestore: (entry: TrashEntry) => Promise<void>;
  onEmpty: () => Promise<void>;
}

function titleOf(entry: TrashEntry): string {
  return entry.kind === 'folder'
    ? (entry.path.split('/').pop() ?? entry.path)
    : noteTitle(entry.path);
}

export function VaultTrashView({
  kind,
  entries,
  error,
  deletedBy,
  now,
  onBack,
  onRestore,
  onEmpty,
}: VaultTrashViewProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const count = entries?.length ?? 0;
  // A changed list disarms Empty, so a second tap always means this count.
  useEffect(() => setArmed(false), [count]);

  const restore = async (entry: TrashEntry) => {
    setBusy(entry.id);
    await onRestore(entry);
    setBusy(undefined);
  };
  const empty = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy('empty');
    await onEmpty();
    setBusy(undefined);
    setArmed(false);
  };

  return (
    <div className="screen">
      <BackBar title={VAULT_TRASH} back={{ to: VAULT_TRASH_BACK, onBack }} />
      <div className="screen-inner vault-trash">
        <p className="hint vault-trash-lead">{vaultTrashLead(kind)}</p>
        {kind === 'team' ? <p className="hint vault-trash-team">{VAULT_TRASH_TEAM_LINE}</p> : null}
        {error ? (
          <p className="hint vault-trash-error" role="alert">
            {error}
          </p>
        ) : null}
        {entries && !entries.length && !error ? (
          <p className="hint vault-trash-empty" role="status">
            {VAULT_TRASH_IS_EMPTY}
          </p>
        ) : null}
        {entries && entries.length ? (
          <ul className="vault-trash-list" aria-busy={busy !== undefined}>
            {entries.map((entry, i) => {
              const title = titleOf(entry);
              const by = kind === 'team' ? deletedBy?.(entry) : undefined;
              return (
                <li
                  key={entry.id}
                  className="vault-trash-row"
                  style={{ '--i': Math.min(i, 12) } as CSSProperties}
                >
                  <div className="vault-trash-text">
                    <span className="vault-trash-title">{title}</span>
                    <span className="vault-trash-sub">
                      {vaultTrashRowSub({
                        folder: noteFolder(entry.path),
                        when: vaultTrashWhen(entry.trashedAt, now),
                        by,
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn ghost press-fb vault-trash-restore"
                    aria-label={vaultTrashRestoreLabel(title)}
                    disabled={busy !== undefined}
                    onClick={() => void restore(entry)}
                  >
                    {VAULT_TRASH_RESTORE}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {kind !== 'team' && count > 0 ? (
          <div className="sheet-actions vault-trash-actions">
            <button
              type="button"
              className={`btn press-fb ${armed ? 'danger' : 'quiet'}`}
              disabled={busy !== undefined}
              onClick={() => void empty()}
            >
              {armed ? vaultTrashEmptyArmed(count) : VAULT_TRASH_EMPTY}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Trash's row, the LAST row at the root of the tree (CX X10), shown only
 *  when Trash holds something, with a count pill. */
export function VaultTrashRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className="conv-item vault-row vault-trash-entry press-fb press-fb--row"
      onClick={onOpen}
    >
      <span className="vault-row-chevron" aria-hidden="true" />
      {VAULT_TRASH}
      <span className="pill muted vault-trash-count">{count}</span>
    </button>
  );
}
