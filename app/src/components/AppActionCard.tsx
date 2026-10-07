// A model's proposal to change a piece of the app (lib/appActions.ts): the
// exact value, and two ways on. "Add to Settings" writes it, and only that tap
// does; "Copy" hands it back for the person to paste in themselves. Built on
// the plan card's frame, the way the trust card is. While the reply is still
// arriving the value may be half written, so the buttons wait for it.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { APP_ACTIONS, type AppActionKey } from '../lib/appActions.js';
import { copyText } from '../lib/clipboard.js';
import { hapticApproval } from '../lib/haptics.js';

export function AppActionCard({
  actionKey,
  value,
  streaming = false,
}: {
  actionKey: AppActionKey;
  value: string;
  streaming?: boolean;
}) {
  const applyAppAction = useApp((s) => s.applyAppAction);
  const current = useApp((s) => s.settings[actionKey]);
  const spec = APP_ACTIONS[actionKey];
  const proposed = spec.apply(value);
  const inSettings = proposed !== undefined && proposed[actionKey] === current;
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [failed, setFailed] = useState(false);

  const sub = streaming
    ? 'Still writing.'
    : inSettings
      ? `In ${spec.where}.`
      : proposed
        ? 'Nothing changes until you tap Add to Settings.'
        : 'This one cannot go into Settings as it is. You can copy it.';

  const copy = async (): Promise<void> => {
    const ok = await copyText(value);
    setCopied(ok ? 'done' : 'failed');
    setTimeout(() => setCopied('idle'), 1400);
  };

  return (
    <div className={`plan-card app-action-card ${inSettings ? 'approved' : 'proposed'}`}>
      <div className="plan-head">
        <span className="plan-badge">{spec.label}</span>
        <span className="plan-sub">{sub}</span>
      </div>
      <div className="plan-body app-action-value">{value}</div>
      {failed ? <div className="msg-note warn">That did not save. Try again.</div> : null}
      <div className="plan-actions">
        {proposed && !inSettings ? (
          <button
            type="button"
            className="btn primary press-fb"
            disabled={streaming}
            onClick={() => {
              hapticApproval();
              setFailed(false);
              void applyAppAction(actionKey, value).then(
                (ok) => setFailed(!ok),
                () => setFailed(true),
              );
            }}
          >
            Add to Settings
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
