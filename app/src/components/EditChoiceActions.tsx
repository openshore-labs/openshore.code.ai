// The repository step's one choice (lib/guidedSetup.ts EDIT_CHOICES): how
// edits are handled, asked once there is code to edit (CX, 2026-09-24). Two
// equal buttons, neither preselected, and a quiet "Decide later" that keeps the
// starting mode. The same choice lives on in Settings, under Approvals.
import { useApp } from '../state/store.js';
import { hapticCommit } from '../lib/haptics.js';
import { EDIT_CHOICES } from '../lib/guidedSetup.js';

export function EditChoiceActions() {
  const chooseEditMode = useApp((s) => s.chooseEditMode);
  return (
    <div className="setup-actions" role="group" aria-label="How edits are handled">
      <div className="setup-actions-row">
        {EDIT_CHOICES.map((c) => (
          <button
            key={c.mode}
            type="button"
            className="btn primary press-fb"
            onClick={() => {
              hapticCommit();
              void chooseEditMode(c.mode);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn quiet press-fb"
        onClick={() => void chooseEditMode(undefined)}
      >
        Decide later
      </button>
    </div>
  );
}
