// The fork after Harbor (lib/guidedSetup.ts NEXT_CHOICES, founder 2026-09-25):
// once the guide has offered Harbor, the person picks what happens next. Start
// chatting steps the walk back (it waits behind "Pick up setup"); Keep setting
// up carries on to the next step. Two equal buttons, chatting first since
// nothing in setup is required. A Harbor download in flight keeps showing.
import { useApp } from '../state/store.js';
import { hapticCommit } from '../lib/haptics.js';
import { NEXT_CHOICES } from '../lib/guidedSetup.js';
import { HarborDownloadProgress } from './SetupStepActions.js';

export function NextChoiceActions() {
  const chooseNext = useApp((s) => s.chooseNext);
  return (
    <div className="setup-actions" role="group" aria-label="What to do next">
      <div className="setup-actions-row">
        {NEXT_CHOICES.map((c) => (
          <button
            key={c.choice}
            type="button"
            className="btn primary press-fb"
            onClick={() => {
              hapticCommit();
              chooseNext(c.choice);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <HarborDownloadProgress />
    </div>
  );
}
