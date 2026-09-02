// Plan mode's proposal: the plan as it was written, then the two honest
// choices. "Start building" flips the session to accept-edits and tells the
// agent to proceed; "Change something" hands the person the composer with the
// plan still in view. Nothing runs until the person says so.
import { Markdown } from './Markdown.js';
import { hapticApproval, hapticTick } from '../lib/haptics.js';

export function PlanCard({
  text,
  status,
  onApprove,
  onRevise,
}: {
  text: string;
  status: 'proposed' | 'approved' | 'revising';
  onApprove: () => void;
  onRevise: () => void;
}) {
  return (
    <div className={`plan-card ${status}`}>
      <div className="plan-head">
        <span className="plan-badge">Plan</span>
        <span className="plan-sub">
          {status === 'proposed'
            ? 'Nothing has been changed yet.'
            : status === 'approved'
              ? 'Approved. Building.'
              : 'Tell the agent what to change.'}
        </span>
      </div>
      <div className="plan-body">
        <Markdown text={text} />
      </div>
      {status === 'proposed' ? (
        <div className="plan-actions">
          <button
            type="button"
            className="btn primary press-fb"
            onClick={() => {
              hapticApproval();
              onApprove();
            }}
          >
            Start building
          </button>
          <button
            type="button"
            className="btn ghost press-fb"
            onClick={() => {
              hapticTick();
              onRevise();
            }}
          >
            Change something
          </button>
        </div>
      ) : null}
    </div>
  );
}
