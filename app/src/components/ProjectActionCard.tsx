// A model's proposal for one of its project's fields (lib/projectActions.ts):
// the exact value, Add to project, which is the only thing that writes it,
// and Copy. The project is the open chat's own. Built on the app action
// card's frame, the plan card's; while the reply is still arriving the value
// may be half written, so the buttons wait for it.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { PROJECT_ACTIONS, type ProjectActionKey } from '../lib/projectActions.js';
import { copyText } from '../lib/clipboard.js';
import { hapticApproval } from '../lib/haptics.js';

export function ProjectActionCard({
  actionKey,
  value,
  streaming = false,
}: {
  actionKey: ProjectActionKey;
  value: string;
  streaming?: boolean;
}) {
  const applyProjectAction = useApp((s) => s.applyProjectAction);
  const projectId = useApp((s) =>
    s.activeId ? s.conversations[s.activeId]?.projectId : undefined,
  );
  const spec = PROJECT_ACTIONS[actionKey];
  const takes = spec.check(value) !== undefined;
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  // A setup script runs on the person's machine, so its card says so before
  // the tap, and the variables say they join the ones kept.
  const what =
    actionKey === 'setupScript'
      ? ' It runs when a coding session opens on the machine this project runs on.'
      : actionKey === 'env'
        ? ' They join the variables already kept, sealed on this device.'
        : '';
  const sub = streaming
    ? 'Still writing.'
    : added
      ? 'In Project Wayfinder.'
      : takes && projectId
        ? `Nothing changes until you tap Add to project.${what}`
        : 'This one cannot go into the project as it is. You can copy it.';

  const copy = async (): Promise<void> => {
    const ok = await copyText(value);
    setCopied(ok ? 'done' : 'failed');
    setTimeout(() => setCopied('idle'), 1400);
  };

  return (
    <div className={`plan-card app-action-card ${added ? 'approved' : 'proposed'}`}>
      <div className="plan-head">
        <span className="plan-badge">{spec.label}</span>
        <span className="plan-sub">{sub}</span>
      </div>
      <div className="plan-body app-action-value">{value}</div>
      {failed ? <div className="msg-note warn">That did not save. Try again.</div> : null}
      <div className="plan-actions">
        {takes && projectId && !added ? (
          <button
            type="button"
            className="btn primary press-fb"
            disabled={streaming}
            onClick={() => {
              hapticApproval();
              setFailed(false);
              void applyProjectAction(projectId, actionKey, value).then(
                (ok) => (ok ? setAdded(true) : setFailed(true)),
                () => setFailed(true),
              );
            }}
          >
            Add to project
          </button>
        ) : null}
        <button
          type="button"
          className="btn ghost press-fb"
          disabled={streaming}
          onClick={() => void copy()}
        >
          {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
