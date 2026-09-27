// A note's Options sheet (moved out of VaultScreen in Vault M6 wave 0; stream
// G, CTO K5, K6 with R2 and CX X5, X8, X16). Prop-driven: the screen owns the
// open and armed state and every action.
//
// Delete is ONE tap only where Trash is real (`trashReal`, from
// `vaultCaps().trash`): the sheet is already the deliberate step, and Trash
// plus Undo cover a slip. Anywhere else a delete is for good, so it keeps the
// two-tap confirm, worded as permanent (R2). The in-memory Undo after it is a
// courtesy, never what makes one tap safe.
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';
import {
  VAULT_DELETE_ROW,
  VAULT_RENAME_ROW,
  VAULT_SETTINGS_TITLE,
  vaultDeleteForGood,
} from '../../lib/vaultCopy.js';

export interface VaultNoteOptionsProps {
  open: boolean;
  /** The note's title, for the permanent delete's armed line. */
  title?: string;
  /** The delete row is armed: the next tap deletes (permanent deletes only). */
  confirmDelete: boolean;
  /** Offer "Ask about this note" (personal notes only). */
  canAsk: boolean;
  /** Offer "Pin to project context". */
  canPin: boolean;
  /** Offer "Rename or move" (`vaultCaps().rename`). */
  canRename?: boolean;
  /** Offer "Outline" first (the note has two or more headings; stream H's
   *  sheet, CX X16). */
  canOutline?: boolean;
  /** Trash is real here (`vaultCaps().trash`): delete is one tap. Left out,
   *  a delete is treated as permanent (two taps). */
  trashReal?: boolean;
  /** Delete is shown but cannot run (a Drive vault, the computer away). */
  deleteDisabled: boolean;
  /** Why a row is not offered on this storage (`vaultCapLine`), one line
   *  each, shown under the title (wave 2). */
  notes?: readonly string[];
  /** Close without choosing (also disarms delete). */
  onClose: () => void;
  onAsk: () => void;
  onPin: () => void;
  onRename?: () => void;
  onOutline?: () => void;
  /** Open Vault settings (Vault M7, CX Y4): the row sits after Pin to
   *  project context and before Delete; the settings sheet opens once this
   *  one has left. Left out, no row. */
  onSettings?: () => void;
  /** The first tap on a permanent Delete. */
  onArmDelete: () => void;
  /** The delete itself: the one tap with Trash, the second tap without. */
  onDelete: () => void;
}

export function VaultNoteOptions({
  open,
  title,
  confirmDelete,
  canAsk,
  canPin,
  canRename,
  canOutline,
  trashReal = false,
  deleteDisabled,
  notes,
  onClose,
  onAsk,
  onPin,
  onRename,
  onOutline,
  onSettings,
  onArmDelete,
  onDelete,
}: VaultNoteOptionsProps) {
  // Only a permanent delete ever arms.
  const armed = confirmDelete && !trashReal;
  return (
    <Sheet open={open} onClose={onClose}>
      {open ? (
        <>
          <SheetHead title="Options" onClose={onClose} />
          {notes?.map((line) => (
            <p key={line} className="hint vault-options-note">
              {line}
            </p>
          ))}
          <div className="sheet-actions">
            {canOutline && onOutline ? (
              <button className="btn quiet press-fb" onClick={onOutline}>
                Outline
              </button>
            ) : null}
            {canRename && onRename ? (
              <button className="btn quiet press-fb" onClick={onRename}>
                {VAULT_RENAME_ROW}
              </button>
            ) : null}
            {/* Take the note to a model (Vault M5, CTO J15): personal
                notes only, since the team vault is never in context. */}
            {canAsk ? (
              <button className="btn quiet press-fb" onClick={onAsk}>
                Ask about this note
              </button>
            ) : null}
            {canPin ? (
              <button className="btn quiet press-fb" onClick={onPin}>
                Pin to project context
              </button>
            ) : null}
            {onSettings ? (
              <button className="btn quiet press-fb" onClick={onSettings}>
                {VAULT_SETTINGS_TITLE}
              </button>
            ) : null}
            <button
              className={`btn press-fb ${armed ? 'danger' : 'quiet'}`}
              // Unreachable on a Drive vault (Options is left out there),
              // kept as a safety; the computer away holds the tree still.
              disabled={deleteDisabled}
              onClick={() => {
                // One tap where Trash is real; two where the loss is (R2).
                if (!trashReal && !armed) {
                  onArmDelete();
                  return;
                }
                onDelete();
              }}
            >
              {armed ? vaultDeleteForGood(title) : VAULT_DELETE_ROW}
            </button>
            <button className="btn quiet press-fb" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
