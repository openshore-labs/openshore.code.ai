// The "help me get set up" list (lib/guidedSetup.ts setupMenuMessage, founder
// 2026-10-01): one button for each thing not set up yet, read live, so a
// connection made somewhere else drops its button. A tap has the guide walk
// through that step; the list comes back when it is done or skipped.
import { useApp } from '../state/store.js';
import { hapticCommit } from '../lib/haptics.js';
import { STEP_COPY, type SetupStepId } from '../lib/guidedSetup.js';
import { HarborDownloadProgress } from './SetupStepActions.js';

export function SetupMenuActions() {
  const pickSetupStep = useApp((s) => s.pickSetupStep);
  // A string, so the selector is stable between renders.
  const offer = useApp((s) => s.setupMenuOffer().join(','));
  const steps = offer ? (offer.split(',') as SetupStepId[]) : [];
  if (!steps.length) return <HarborDownloadProgress />;
  return (
    <div className="setup-actions setup-menu" role="group" aria-label="Not set up yet">
      {steps.map((id, i) => (
        <button
          key={id}
          type="button"
          className="btn ghost press-fb setup-menu-item"
          style={{ ['--i' as string]: i }}
          onClick={() => {
            hapticCommit();
            pickSetupStep(id);
          }}
        >
          {STEP_COPY[id].title}
        </button>
      ))}
      <HarborDownloadProgress />
    </div>
  );
}
