// A folder's options (Vault M6 6.2, 6.3; tech review K5, K6 with R2; UX review X5, X8): the
// folder view's own "..." button opens this Sheet with Rename folder, Move
// folder, New folder, and Delete folder. Every row that acts on the folder
// states its counts first ("12 notes and 3 other files", K5). Delete folder
// is two taps everywhere, and only where Trash is real, since a folder is
// never deleted for good in one step; its armed line names the counts.
//
// Rename and Move hand up to the parent, which opens VaultRenameSheet on the
// folder; New folder takes its name here and hands it up to be made. The
// parent owns the toasts and closes the sheet. Its one way out is the round
// close in its head, as VaultRenameSheet's is (the 2026-10-07 rule), so the
// rows end without a Cancel.
import { useEffect, useState } from 'react';
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import {
  VAULT_FOLDER_CREATE,
  VAULT_FOLDER_DELETE,
  VAULT_FOLDER_MOVE,
  VAULT_FOLDER_NAME,
  VAULT_FOLDER_NEW,
  VAULT_FOLDER_OPTIONS,
  VAULT_FOLDER_RENAME,
  vaultFolderDeleteArmed,
  vaultFolderHolds,
  vaultFolderLabel,
} from '../../lib/vaultCopy.js';

export interface VaultFolderSheetProps {
  open: boolean;
  /** The folder the options are for ('' at the root: New folder only). */
  folder: string;
  /** What it holds, counted before anything acts (undefined while counting). */
  counts?: { notes: number; attachments: number };
  /** Rename and Move are offered (`vaultCaps().rename`). */
  canRename: boolean;
  /** Folders can be made here (`vaultCaps().folders`). */
  canCreate: boolean;
  /** Trash is real here (`vaultCaps().trash`): Delete folder is offered. */
  // False too for a team member under admins-only, who may not delete (UX review
  // Y14).
  canTrash: boolean;
  /** Why a row is not offered here (the admins-only line), one line each,
   *  shown under the counts, as the note's Options sheet shows them. */
  notes?: readonly string[];
  onClose: () => void;
  onRename: () => void;
  onMove: () => void;
  /** Make a folder inside this one. Answers a line that says why not, or
   *  undefined when it was made. */
  onCreate: (name: string) => Promise<string | undefined>;
  /** The second tap on Delete folder. */
  onDelete: () => void;
}

export function VaultFolderSheet({
  open,
  folder,
  counts,
  canRename,
  canCreate,
  canTrash,
  notes,
  onClose,
  onRename,
  onMove,
  onCreate,
  onDelete,
}: VaultFolderSheetProps) {
  const [armed, setArmed] = useState(false);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setArmed(false);
    setMaking(false);
    setName('');
    setProblem(undefined);
    setBusy(false);
  }, [open, folder]);

  const atRoot = !folder;
  // With Cancel gone, a sheet that offers nothing here (an admins-only
  // member's folder) shows its notes and the round close, and no empty row.
  const hasActions = (!atRoot && (canRename || canTrash)) || canCreate;
  const create = async () => {
    setBusy(true);
    const why = await onCreate(name.trim());
    setBusy(false);
    if (why) setProblem(why);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      {open ? (
        <>
          <SheetHead
            title={atRoot ? VAULT_FOLDER_OPTIONS : vaultFolderLabel(folder)}
            onClose={onClose}
          />
          {!atRoot && counts ? (
            <p className="hint vault-folder-counts">
              {vaultFolderHolds(counts.notes, counts.attachments)}
            </p>
          ) : null}
          {notes?.map((line) => (
            <p key={line} className="hint vault-options-note">
              {line}
            </p>
          ))}
          {making ? (
            <div className="vault-folder-new">
              <div className="field">
                <label htmlFor="vault-folder-new-name">{VAULT_FOLDER_NAME}</label>
                <input
                  id="vault-folder-new-name"
                  value={name}
                  autoComplete="off"
                  onChange={(e) => {
                    setName(e.target.value);
                    setProblem(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim() && !busy) void create();
                  }}
                />
              </div>
              {problem ? (
                <p className="hint vault-rename-problem" role="alert">
                  {problem}
                </p>
              ) : null}
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn primary press-fb"
                  disabled={busy || !name.trim()}
                  onClick={() => void create()}
                >
                  {VAULT_FOLDER_CREATE}
                </button>
              </div>
            </div>
          ) : hasActions ? (
            <div className="sheet-actions">
              {!atRoot && canRename ? (
                <>
                  <button type="button" className="btn quiet press-fb" onClick={onRename}>
                    {VAULT_FOLDER_RENAME}
                  </button>
                  <button type="button" className="btn quiet press-fb" onClick={onMove}>
                    {VAULT_FOLDER_MOVE}
                  </button>
                </>
              ) : null}
              {canCreate ? (
                <button
                  type="button"
                  className="btn quiet press-fb"
                  onClick={() => setMaking(true)}
                >
                  {VAULT_FOLDER_NEW}
                </button>
              ) : null}
              {!atRoot && canTrash ? (
                <button
                  type="button"
                  className={`btn press-fb ${armed ? 'danger' : 'quiet'}`}
                  disabled={!counts}
                  onClick={() => {
                    // Two taps for a folder, everywhere (UX review X8).
                    if (!armed) {
                      setArmed(true);
                      return;
                    }
                    onDelete();
                  }}
                >
                  {armed && counts
                    ? vaultFolderDeleteArmed(counts.notes, counts.attachments)
                    : VAULT_FOLDER_DELETE}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
