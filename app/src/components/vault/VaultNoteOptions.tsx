// A note's Options sheet (moved out of VaultScreen in Vault M6 wave 0, no
// behavior change; stream G owns what it becomes: Rename or move, Outline,
// one-tap delete where Trash is real, CTO K5, K6 with R2 and CX X5, X8, X16).
// Prop-driven: the screen owns the open and armed state and every action.
import { Sheet } from '../Sheet.js';
import { SheetHead } from '../SheetHead.js';

export interface VaultNoteOptionsProps {
  open: boolean;
  /** The delete row is armed: the next tap deletes. */
  confirmDelete: boolean;
  /** Offer "Ask about this note" (personal notes only). */
  canAsk: boolean;
  /** Offer "Pin to project context". */
  canPin: boolean;
  /** Delete is shown but cannot run (a Drive vault, the computer away). */
  deleteDisabled: boolean;
  /** Close without choosing (also disarms delete). */
  onClose: () => void;
  onAsk: () => void;
  onPin: () => void;
  /** The first tap on Delete. */
  onArmDelete: () => void;
  /** The second tap on Delete. */
  onDelete: () => void;
}

export function VaultNoteOptions({
  open,
  confirmDelete,
  canAsk,
  canPin,
  deleteDisabled,
  onClose,
  onAsk,
  onPin,
  onArmDelete,
  onDelete,
}: VaultNoteOptionsProps) {
  return (
    <Sheet open={open} onClose={onClose}>
      {open ? (
        <>
          <SheetHead title="Options" onClose={onClose} />
          <div className="sheet-actions">
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
            <button
              className={`btn press-fb ${confirmDelete ? 'danger' : 'quiet'}`}
              // Unreachable on a Drive vault (Options is left out there),
              // kept as a safety; the computer away holds the tree still.
              disabled={deleteDisabled}
              onClick={() => {
                // Two taps to delete: a single tap is too easy to hit by
                // accident, and a local or iCloud delete is unrecoverable.
                if (!confirmDelete) {
                  onArmDelete();
                  return;
                }
                onDelete();
              }}
            >
              {confirmDelete ? 'Really delete? Tap to confirm.' : 'Delete this note'}
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
