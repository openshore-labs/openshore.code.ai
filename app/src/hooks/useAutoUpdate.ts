// Subscribes to the desktop's own update check (see electron/main.ts) and
// keeps the store's updateStatus in sync. A no-op off Electron: bridge() is
// undefined on iOS and the web, where there is no desktop build to update.
import { useEffect } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';

export function useAutoUpdate(): void {
  const { setUpdateStatus } = useApp();
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    return b.onUpdateStatus((update) => setUpdateStatus(update));
  }, [setUpdateStatus]);
}
