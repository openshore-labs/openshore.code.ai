// The app's postinstall: rebuild node-pty against Electron's ABI so the desktop
// terminal works. pnpm builds node-pty for the system Node during install;
// Electron ships its own Node with a different module ABI, so the native
// addon has to be compiled a second time for it.
//
// Two rules:
// - It is SOFT. A failed rebuild prints the hint and exits 0, so `pnpm install`
//   still completes on a machine without a toolchain (a phone-only contributor,
//   a CI runner). The hard check is scripts/desktop-preflight.mjs, which runs
//   before every desktop launch and refuses to start with a dead terminal.
// - SKIP_NATIVE_REBUILD=1 skips it entirely. CI and the TestFlight pipeline
//   never launch Electron, and the rebuild (plus its header download) cost
//   minutes on every run for nothing.
import { spawnSync } from 'node:child_process';

const HINT =
  'electron-rebuild skipped: node-pty stays built for system Node; the desktop terminal ' +
  'needs it rebuilt for Electron, run pnpm --filter oscode-app rebuild:native';

if (process.env.SKIP_NATIVE_REBUILD === '1') {
  console.log('SKIP_NATIVE_REBUILD=1: not rebuilding node-pty for Electron.');
  process.exit(0);
}

// Same invocation as the rebuild:native script. shell: true so the .cmd shim
// resolves on Windows; stdio inherited so a failing build shows its reason.
const result = spawnSync('electron-rebuild -f -w node-pty -m ../os-code', {
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) console.log(HINT);
process.exit(0);
