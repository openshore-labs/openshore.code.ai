// The desktop's own "you're on an old version" notice: persistent (no
// auto-dismiss, no snooze) because the whole point is that nobody stays on a
// stale build. Mounted once from App.tsx, so it shows over any screen.
import { useRef } from 'react';
import { useApp } from '../state/store.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { bridge } from '../lib/electronBridge.js';
import { hapticApproval } from '../lib/haptics.js';

export function UpdateBanner() {
  const { updateStatus } = useApp();
  const presence = useExitPresence(Boolean(updateStatus));
  const last = useRef(updateStatus);
  if (updateStatus) last.current = updateStatus;
  if (!presence.mounted) return null;

  const shown = updateStatus ?? last.current;
  if (!shown) return null;
  const ready = shown.mode === 'install';

  return (
    <div
      className={`update-banner${presence.closing ? ' closing' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span>
        {ready ? `Update ready. v${shown.version}` : `Update available. v${shown.version}`}
      </span>
      <button
        type="button"
        className="press-fb"
        onClick={() => {
          hapticApproval();
          void bridge()?.installUpdate();
        }}
      >
        {ready ? 'Restart & Update' : 'Download'}
      </button>
    </div>
  );
}
