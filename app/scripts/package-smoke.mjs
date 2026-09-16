// Packaging smoke test: launch the PACKAGED Linux app headless and prove the
// engine actually boots inside the bundle. A green vitest suite says the source
// is correct; it says nothing about whether electron-builder packaged the
// workspace-linked engine (os-code/dist) and node-pty's native binary so they
// resolve at runtime. That only breaks in the packaged app, and only this test
// catches it before a release ships a shell with no engine.
//
// The app's main process (electron/main.ts) has the other half: OSC_SMOKE=1
// makes it load the page, probe window.oscode, boot the engine, log a line per
// step, print "[smoke] done", and quit itself. This script launches the binary
// with that flag, reads the log, and judges it.
//
// Usage: node scripts/package-smoke.mjs [path-to-binary]
// With no argument it finds the unpacked binary under release/linux-unpacked.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');

// The unpacked electron app names its executable after the productName, lower-
// cased by electron-builder. Find whichever executable landed there so a rename
// of productName never silently breaks this test.
function findUnpackedBinary() {
  const dir = join(appRoot, 'release', 'linux-unpacked');
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    // The launcher is the one executable file at the top of linux-unpacked;
    // the rest are chrome-sandbox, *.pak, .so files, and resources/.
    if (name === 'chrome-sandbox' || name.includes('.')) continue;
    try {
      const s = statSync(full);
      if (s.isFile() && s.mode & 0o111) return full;
    } catch {
      // ignore anything we cannot stat
    }
  }
  return undefined;
}

const binary = process.argv[2] ?? findUnpackedBinary();
if (!binary || !existsSync(binary)) {
  console.error(
    'package-smoke: no binary to launch. Pass one, or build first with `pnpm package:linux`.',
  );
  process.exit(1);
}

// A packaged app that boots the page, wires the bridge, and boots the engine
// takes a few seconds; a hang past this means something is genuinely wrong, not
// slow. Kill and fail rather than let CI sit on a stuck launch.
const TIMEOUT_MS = 90_000;

console.log(`package-smoke: launching ${binary}`);
// --no-sandbox: CI runners have no user namespaces for the chrome sandbox, and
// this is a throwaway headless launch, never a user's session.
const child = spawn(binary, ['--no-sandbox'], {
  env: { ...process.env, OSC_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
const capture = (chunk) => {
  const text = chunk.toString();
  out += text;
  process.stdout.write(text);
};
child.stdout.on('data', capture);
child.stderr.on('data', capture);

const timer = setTimeout(() => {
  console.error(`\npackage-smoke: no verdict within ${TIMEOUT_MS / 1000}s, killing the app.`);
  child.kill('SIGKILL');
}, TIMEOUT_MS);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  // What the packaged app must have proven, in order: the renderer loaded and
  // the preload bridge is present (an object, not undefined), the engine booted
  // (never "engine failed"), and the run closed itself out cleanly.
  const bridgeUp = /\[smoke\] page loaded; window\.oscode is object/.test(out);
  const engineUp = /\[smoke\] engine booted;/.test(out);
  const engineFailed = /\[smoke\] engine failed:/.test(out);
  const done = /\[smoke\] done/.test(out);

  const problems = [];
  if (!bridgeUp) problems.push('the preload bridge (window.oscode) was not an object');
  if (engineFailed) problems.push('the engine failed to boot inside the package');
  if (!engineUp) problems.push('the engine never reported booting');
  if (!done) problems.push('the app did not reach "[smoke] done"');
  if (signal === 'SIGKILL') problems.push('the app had to be killed on timeout');

  if (problems.length) {
    console.error(`\npackage-smoke: FAILED\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  // The app quits itself with code 0 after a clean smoke; a non-zero exit after
  // all markers printed still means something tore down badly.
  if (code && code !== 0) {
    console.error(`\npackage-smoke: app exited ${code} after a clean run; treating as a failure.`);
    process.exit(1);
  }
  console.log('\npackage-smoke: OK. The packaged app booted its engine.');
  process.exit(0);
});

child.on('error', (err) => {
  clearTimeout(timer);
  console.error(`package-smoke: could not launch the app: ${err.message}`);
  process.exit(1);
});
