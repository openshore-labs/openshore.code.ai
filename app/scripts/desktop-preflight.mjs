// Runs before `electron .` in the desktop script. Electron cannot open a window
// without a display, and when launched from an SSH shell it dies with a bare
// "Missing X server or $DISPLAY" plus a SIGTRAP, which reads like a crash in
// the app. Say what is actually wrong, and how to point it at the machine's
// own screen, then continue (Electron still gets to try; this never blocks).
import { existsSync, readdirSync } from 'node:fs';

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
if (hasDisplay || process.platform !== 'linux') process.exit(0);

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
    : 'To open the app on this machine\'s own screen, name its display, for example:',
  `  DISPLAY=${live ?? ':0'} XAUTHORITY=${home}/.Xauthority npx electron .`,
  '(Run it from the app/ folder. The window appears on the monitor, not in this terminal.)',
  '',
];
console.error(lines.join('\n'));
