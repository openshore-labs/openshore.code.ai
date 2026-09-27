// Project trust: a folder's own os-code.config.json can make OpenShore
// stricter from anywhere, but what would loosen it (its check command, its
// allow rules, its model choices) waits for the person. One decision, in plain
// words: "Use them" trusts the folder on the computer it lives on, "Not now"
// leaves its settings off. Built on the plan card's frame and its reveal fold,
// so it arrives and leaves the way every card here does.
import { Markdown } from './Markdown.js';
import { hapticApproval } from '../lib/haptics.js';

export function TrustCard({
  waiting,
  state,
  error,
  onTrust,
  onDismiss,
}: {
  waiting: string[];
  state: 'untrusted' | 'changed' | 'trusted' | 'dismissed';
  error?: string;
  onTrust: () => void;
  onDismiss: () => void;
}) {
  const asking = state === 'untrusted' || state === 'changed';
  const sub =
    state === 'trusted'
      ? 'Trusted on this computer. They apply from your next chat here.'
      : state === 'dismissed'
        ? 'Left off. This folder can only make OpenShore stricter.'
        : state === 'changed'
          ? 'These changed since you trusted this folder, so they are off again.'
          : 'This folder brings its own settings. They stay off until you trust it.';
  const list = waiting.map((line) => `- It ${line}.`).join('\n');
  return (
    <div className={`plan-card trust-card ${asking ? 'proposed' : 'approved'}`}>
      <div className="plan-head">
        <span className="plan-badge">This project's settings</span>
        <span className="plan-sub">{sub}</span>
      </div>
      <div className={`reveal${asking ? ' open' : ''}`}>
        <div className="reveal-inner">
          <div className="plan-body">
            <Markdown text={list} />
          </div>
          {error ? <div className="msg-note">{error}</div> : null}
          <div className="plan-actions">
            <button
              type="button"
              className="btn primary press-fb"
              onClick={() => {
                hapticApproval();
                onTrust();
              }}
            >
              Use them
            </button>
            <button type="button" className="btn ghost press-fb" onClick={onDismiss}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
