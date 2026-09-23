// The desktop's "a new version is out" bar: a full-width strip across the top
// of the window, in the layout (it moves the app down rather than covering a
// header), with no dismiss and no snooze, because the whole point is that
// nobody stays on a stale build. Every push to main publishes a release, so
// this shows whenever this desktop is behind. One click updates: it installs
// and restarts (Windows, Linux) or downloads, swaps, and relaunches (macOS);
// the bar tracks progress until the restart. Mounted once from App.tsx.
import { useRef } from 'react';
import { useApp } from '../state/store.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { bridge, type PendingUpdate } from '../lib/electronBridge.js';
import { hapticApproval } from '../lib/haptics.js';

/** The bar's words and its button, per phase. Pure, for the test. */
export function updateBarCopy(u: PendingUpdate): {
  text: string;
  action?: string;
  busy: boolean;
} {
  const v = `v${u.version}`;
  switch (u.phase) {
    case 'installing':
      return {
        text:
          u.percent !== undefined && u.percent < 100
            ? `Updating OpenShore to ${v}. ${u.percent}%`
            : `Updating OpenShore to ${v}. Restarting.`,
        busy: true,
      };
    case 'ready':
      return { text: `OpenShore ${v} is ready.`, action: 'Restart to update', busy: false };
    case 'failed':
      return { text: `The update to ${v} did not finish.`, action: 'Try again', busy: false };
    default:
      return {
        text: `A new version of OpenShore is available. ${v}`,
        action: 'Update',
        busy: false,
      };
  }
}

export function UpdateBanner() {
  const { updateStatus } = useApp();
  const presence = useExitPresence(Boolean(updateStatus));
  const last = useRef(updateStatus);
  if (updateStatus) last.current = updateStatus;
  if (!presence.mounted) return null;

  const shown = updateStatus ?? last.current;
  if (!shown) return null;
  const copy = updateBarCopy(shown);

  return (
    <div
      className={`update-banner${presence.closing ? ' closing' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="update-banner-text">{copy.text}</span>
      {copy.busy ? (
        <span className="update-banner-track" aria-hidden="true">
          <span
            className="update-banner-fill"
            style={{ transform: `scaleX(${(shown.percent ?? 0) / 100})` }}
          />
        </span>
      ) : (
        <button
          type="button"
          className="press-fb"
          onClick={() => {
            hapticApproval();
            void bridge()?.installUpdate();
          }}
        >
          {copy.action}
        </button>
      )}
    </div>
  );
}
