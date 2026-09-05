// Runs before `electron .` in the desktop script. Two checks, in order:
//
// 1. node-pty is built for Electron (BLOCKING). The desktop terminal runs
//    in-process, and the engine's terminal manager lazy-imports node-pty from
//    os-code's own node_modules. The postinstall rebuild is soft on purpose,
//    so nothing before this point proves the native addon exists or that it
//    loads under Electron's ABI rather than the system Node's. Launching with a
//    dead terminal reads like a broken app; refusing here, with the one command
//    that fixes it, does not.
// 2. A display is set (ADVISORY, never blocks). Electron cannot open a window
//    without one, and when launched from an SSH shell it dies with a bare
//    "Missing X server or $DISPLAY" plus a SIGTRAP. Say what is actually wrong
//    and how to point it at the machine's own screen, then continue.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_DIR = resolve(APP_DIR, '..', 'os-code');
const REBUILD_HINT = 'Rebuild it for Electron with: pnpm --filter oscode-app rebuild:native';

function refuse(reason) {
  console.error(['', `OpenShore desktop: ${reason}`, REBUILD_HINT, ''].join('\n'));
  process.exit(1);
}

/** Where node-pty lives, resolved the way the engine resolves it. */
function ptyDir() {
  const engineRequire = createRequire(join(ENGINE_DIR, 'package.json'));
  try {
    return dirname(engineRequire.resolve('node-pty/package.json'));
  } catch {
    return undefined;
  }
}

/** The Electron binary, if the electron package downloaded it. */
function electronBinary() {
  try {
    const bin = createRequire(join(APP_DIR, 'package.json'))('electron');
    return typeof bin === 'string' && existsSync(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}

function checkPty() {
  const dir = ptyDir();
  if (!dir) refuse('node-pty is not installed under os-code (run pnpm install at the repo root).');
  const binary = join(dir, 'build', 'Release', 'pty.node');
  if (!existsSync(binary)) refuse(`node-pty has no native build (${binary} is missing).`);

  // Load it inside Electron's own Node (ELECTRON_RUN_AS_NODE needs no display)
  // so the ABI checked is the one the app will use. An addon built for the
  // system Node fails right here with NODE_MODULE_VERSION, not at the first
  // terminal open.
  const electron = electronBinary();
  if (!electron) {
    console.error(
      'OpenShore desktop: the Electron binary is not installed (ELECTRON_SKIP_BINARY_DOWNLOAD, ' +
        'or an install that never fetched it), so node-pty was checked for presence only, not ' +
        'loaded.',
    );
    return;
  }
  const probe = spawnSync(electron, ['-e', `require(${JSON.stringify(dir)})`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 20000,
  });
  if (probe.error) refuse(`could not run Electron to probe node-pty: ${probe.error.message}`);
  if (probe.status !== 0) {
    const detail = (probe.stderr || probe.stdout || '').trim().split('\n').slice(-6).join('\n');
    refuse(`node-pty does not load inside Electron.\n${detail}`);
  }
}

function adviseOnDisplay() {
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (hasDisplay || process.platform !== 'linux') return;

  // Name the display that is actually live, if we can see its socket.
  let live;
  try {
    const sockets = existsSync('/tmp/.X11-unix') ? readdirSync('/tmp/.X11-unix') : [];
    const nums = sockets.filter((s) => /^X\d+$/.test(s)).map((s) => s.slice(1));
    if (nums.length) live = `:${nums[0]}`;
  } catch {}

  const home = process.env.HOME ?? '~';
  const lines = [
    '',
    'OpenShore desktop: no display is set in this shell (DISPLAY / WAYLAND_DISPLAY are empty).',
    'This happens when launching over SSH. Electron will exit with "Missing X server".',
    live
      ? `A live X display was found at ${live}. To open the app on this machine's own screen:`
      : "To open the app on this machine's own screen, name its display, for example:",
    `  DISPLAY=${live ?? ':0'} XAUTHORITY=${home}/.Xauthority npx electron .`,
    '(Run it from the app/ folder. The window appears on the monitor, not in this terminal.)',
    '',
  ];
  console.error(lines.join('\n'));
}

checkPty();
adviseOnDisplay();
