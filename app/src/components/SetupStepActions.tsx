// The buttons for the guided setup's current step (lib/guidedSetup.ts). They
// sit under Harbor Lite's latest message, so after an off-script question the
// way to carry on is still right at the end of the chat. Three choices, every
// step: the primary button opens the step's page (or starts Harbor's download
// in place), "Ask about this" asks the guide for more before deciding, and
// "Skip for now" moves the walk along. A Harbor download in flight shows its progress here
// for the rest of the walk. Everything rides press-fb and arrives on the
// First Moves curve.
import { useApp } from '../state/store.js';
import { STEP_COPY, stepNumber, type SetupStepId } from '../lib/guidedSetup.js';

export function SetupStepActions({ step }: { step: SetupStepId }) {
  const openSetupStep = useApp((s) => s.openSetupStep);
  const skipSetupStep = useApp((s) => s.skipSetupStep);
  const send = useApp((s) => s.send);
  const harborDownload = useApp((s) => s.harborDownload);
  const { n, of } = stepNumber(step);
  return (
    <div className="setup-actions" role="group" aria-label={`Setup step ${n} of ${of}`}>
      <button type="button" className="btn primary press-fb" onClick={openSetupStep}>
        {STEP_COPY[step].action}
      </button>
      <div className="setup-actions-row">
        <button
          type="button"
          className="btn ghost press-fb"
          onClick={() => send(STEP_COPY[step].ask)}
        >
          Ask about this
        </button>
        <button type="button" className="btn quiet press-fb" onClick={skipSetupStep}>
          Skip for now
        </button>
      </div>
      {harborDownload && !harborDownload.failed ? (
        <div className="setup-actions-progress">
          <div className="progress-track">
            <div
              className={`progress-fill${harborDownload.indeterminate ? ' indeterminate' : ''}`}
              style={
                harborDownload.indeterminate
                  ? undefined
                  : { transform: `scaleX(${harborDownload.percent / 100})` }
              }
            />
          </div>
          <div className="hint">Harbor: {harborDownload.label}</div>
        </div>
      ) : null}
    </div>
  );
}
