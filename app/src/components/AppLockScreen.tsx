// The lock screen (App Lock, CX ruling Q3, 2026-10-12). While the app is
// locked this is all that renders: the rooms unmount, so nothing private sits
// under it. It names no chat, no account and no count. It asks for the
// device's own unlock as it arrives (after taking down the native cover
// held over the app since the return), and the Unlock button asks again after a
// back-out. Anything already running keeps running.
import { useEffect, useRef } from 'react';
import { useApp } from '../state/store.js';
import { BrandMark } from './BrandMark.js';
import { LOCKED_HINT, LOCKED_TITLE, UNLOCK, revealLockScreen } from '../lib/appLock.js';

export function AppLockScreen() {
  const unlockApp = useApp((s) => s.unlockApp);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    // Drawn: the native cover held over the app can come down, then ask.
    void revealLockScreen().then(() => unlockApp());
  }, [unlockApp]);
  return (
    <div className="app-lock" role="dialog" aria-modal="true" aria-labelledby="app-lock-title">
      <BrandMark size={32} />
      <h1 id="app-lock-title" className="app-lock-title">
        {LOCKED_TITLE}
      </h1>
      <button type="button" className="btn primary press-fb" onClick={() => void unlockApp()}>
        {UNLOCK}
      </button>
      <p className="hint">{LOCKED_HINT}</p>
    </div>
  );
}
