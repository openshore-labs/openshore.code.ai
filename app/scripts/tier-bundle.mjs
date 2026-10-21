// Reads a built web bundle (the Vite dist) and checks what a Personal build
// carries (review 9, docs/release-tiers.md): no later tier's words or rooms in
// any file it ships, every room its own chunk that waits for its first open,
// and what a launch loads before the first room opens. CI runs it on the
// build it just made (`pnpm --filter oscode-app check:bundle`, .github/
// workflows/ci.yml); app/test/tierBundle.test.ts proves the checks on a small
// fixture. A build that asks for a later tier (VITE_RELEASE_TIER=2, 3 or 4)
// is reported, never failed: it is meant to carry those rooms.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/** Words that belong to a later tier only. A Personal build must carry none
 *  of them, in any file it ships. */
export const LATER_TIER_WORDS = [
  'Stack Health',
  'Launch with Codemagic',
  'Hermes Agent',
  'Manage the company account',
  'Jev',
];

/** The later tiers' room modules (lib/focus.ts ROOM_FEATURE). */
export const LATER_ROOM_FILES = ['StackHealthScreen', 'LaunchScreen', 'AdminScreen'];

/** Rooms that must wait for their first open, never load at launch. */
export const LAZY_ROOM_FILES = [
  'SettingsScreen',
  'VaultScreen',
  'PairScreen',
  'StackScreen',
  'LocalLibraryScreen',
];

/** Heavy libraries that wait for their first use, never load at launch, each
 *  found in a chunk by a word its own code keeps through minification. The
 *  chat's code highlighter came to about 320 KB of every launch before it
 *  loaded on the first fenced block (lib/lazyHighlight.ts). */
export const LAZY_LIBRARIES = [
  { name: 'highlight.js', marker: 'highlightAuto' },
  // pdf.js reads an attached PDF (lib/pdfText.ts), loaded on the first one.
  { name: 'pdf.js', marker: 'pdfjsWorker' },
  // The Anthropic SDK (about 140 KB) loads on the first Claude or
  // Anthropic-format request (drivers/anthropicSdk.ts); the marker is a line of
  // its own browser warning.
  { name: '@anthropic-ai/sdk', marker: 'browser-like environment' },
  // jsQR (about 130 KB) loads when the docking scanner's camera opens
  // (lib/qrImage.ts).
  { name: 'jsQR', marker: 'attemptBoth' },
];

/** Ceilings, in bytes. Before the split the launch was one 2,560,450-byte
 *  chunk. Crossing one means a room or a heavy library went back into the
 *  launch path. */
export const BUDGET = { entryBytes: 400_000, bootBytes: 2_000_000 };

/** Under this much room below the launch ceiling, the report warns, so the
 *  commit that eats the last of it is not the first anyone hears of it. */
export const HEADROOM_WARN_BYTES = 100_000;

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The chunks a JS file imports statically, as paths next to it. A dynamic
 *  `import("./x.js")` is not followed: that chunk waits for its room. */
function staticImports(code) {
  const found = new Set();
  const re = /\bimport\s*(?:[\w${},\s*]+?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g;
  for (const m of code.matchAll(re)) found.add(m[1]);
  return [...found];
}

/** Inspect a dist directory. */
export function inspectBundle(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entryMatch = html.match(/<script[^>]*type="module"[^>]*src="\.?\/?([^"]+\.js)"/);
  if (!entryMatch) throw new Error('No module entry in index.html');
  const entry = join(dist, entryMatch[1]);

  const boot = new Set();
  const walk = (file) => {
    if (boot.has(file)) return;
    boot.add(file);
    const dir = join(file, '..');
    for (const rel of staticImports(readFileSync(file, 'utf8'))) walk(join(dir, rel));
  };
  walk(entry);

  const lazyAtLaunch = [];
  for (const file of boot) {
    const text = readFileSync(file, 'utf8');
    for (const lib of LAZY_LIBRARIES) {
      if (text.includes(lib.marker))
        lazyAtLaunch.push({ library: lib.name, file: relative(dist, file) });
    }
  }

  const files = filesUnder(dist);
  const js = files.filter((f) => f.endsWith('.js'));
  const size = (f) => statSync(f).size;
  const leaks = [];
  for (const file of files.filter((f) => /\.(js|html|css|json)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const word of LATER_TIER_WORDS) {
      // Whole words, so a short one like Jev never matches inside another.
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(text)) leaks.push({ file: relative(dist, file), word });
    }
  }
  return {
    entry: relative(dist, entry),
    entryBytes: size(entry),
    bootBytes: [...boot].reduce((n, f) => n + size(f), 0),
    bootChunks: [...boot].map((f) => relative(dist, f)),
    chunkNames: js.map((f) => basename(f)),
    totalJsBytes: js.reduce((n, f) => n + size(f), 0),
    chunks: js.length,
    leaks,
    lazyAtLaunch,
  };
}

/** What is wrong with a Personal build's report, one line each. */
export function bundleProblems(report) {
  const problems = report.leaks.map((l) => `later-tier word "${l.word}" in ${l.file}`);
  for (const room of LATER_ROOM_FILES) {
    for (const name of report.chunkNames.filter((n) => n.startsWith(`${room}-`)))
      problems.push(`later-tier room emitted: ${name}`);
  }
  for (const room of LAZY_ROOM_FILES) {
    const at = report.bootChunks.find((c) => basename(c).startsWith(`${room}-`));
    if (at) problems.push(`${room} loads at launch (${at}); rooms wait for their first open`);
  }
  for (const at of report.lazyAtLaunch ?? []) {
    problems.push(`${at.library} loads at launch (${at.file}); it waits for its first use`);
  }
  if (report.entryBytes > BUDGET.entryBytes)
    problems.push(`entry chunk is ${report.entryBytes} bytes, over ${BUDGET.entryBytes}`);
  if (report.bootBytes > BUDGET.bootBytes)
    problems.push(`launch loads ${report.bootBytes} bytes, over ${BUDGET.bootBytes}`);
  return problems;
}

// Run directly: report on the dist named on the command line, and fail a
// Personal build that carries what it should not.
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = inspectBundle(process.argv[2] ?? 'dist');
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`entry ${report.entry}: ${kb(report.entryBytes)} (${report.entryBytes} bytes)`);
  console.log(
    `loaded at launch: ${kb(report.bootBytes)} (${report.bootBytes} bytes) in ${report.bootChunks.length} chunks`,
  );
  console.log(`all JavaScript: ${kb(report.totalJsBytes)} in ${report.chunks} chunks`);
  const room = BUDGET.bootBytes - report.bootBytes;
  console.log(`room below the launch ceiling: ${kb(room)}`);
  if (room >= 0 && room < HEADROOM_WARN_BYTES)
    console.log(
      `warning: launch is within ${kb(HEADROOM_WARN_BYTES)} of its ceiling; move something that waits for a tap behind a dynamic import before it fails`,
    );
  const tier = process.env.VITE_RELEASE_TIER?.trim();
  const later = tier === '2' || tier === '3' || tier === '4';
  const problems = bundleProblems(report);
  for (const p of problems) console.log(`${later ? 'note' : 'error'}: ${p}`);
  process.exitCode = problems.length && !later ? 1 : 0;
}
