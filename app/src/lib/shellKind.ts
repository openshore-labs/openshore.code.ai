// Whether this is the desktop app, for copy that builds its strings when it
// loads (the guided setup, Harbor Lite's persona). No imports on purpose, the
// same reason as deviceNoun.ts: a copy module that pulled in the platform
// layer would make every test that mocks it name this helper too. The preload
// sets window.oscode.platform before any module runs (electron/preload.cjs).

/** True in the Electron shell. */
export function onDesktopShell(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as { oscode?: { platform?: string } }).oscode?.platform === 'electron'
  );
}
