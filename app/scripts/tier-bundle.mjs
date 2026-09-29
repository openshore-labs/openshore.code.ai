// Reads a built web bundle (the Vite dist) and reports what a build carries:
// the JavaScript a launch loads before the first room opens (the entry chunk
// and every chunk it imports statically), every other chunk, and any later
// tier's words that reached the files. app/test/tierBundle.test.ts builds a
// Personal bundle and runs this over it; `node scripts/tier-bundle.mjs dist`
// reports on an existing build by hand.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Words that belong to a later tier only (docs/release-tiers.md). A
 *  Personal build must carry none of them, in any file it ships. */
export const LATER_TIER_WORDS = [
  'Stack Health',
  'Launch with Codemagic',
  'Hermes Agent',
  'Manage the company account',
  'Jev',
];

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
  // Minified ESM: `import{a as b}from"./x.js"`, `import"./x.js"`, and the
  // same with spaces.
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
    totalJsBytes: js.reduce((n, f) => n + size(f), 0),
    chunks: js.length,
    leaks,
  };
}

// Run directly: report on the dist named on the command line.
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = inspectBundle(process.argv[2] ?? 'dist');
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`entry ${report.entry}: ${kb(report.entryBytes)}`);
  console.log(`loaded at launch: ${kb(report.bootBytes)} in ${report.bootChunks.length} chunks`);
  console.log(`all JavaScript: ${kb(report.totalJsBytes)} in ${report.chunks} chunks`);
  for (const leak of report.leaks) console.log(`later-tier word "${leak.word}" in ${leak.file}`);
  process.exitCode = report.leaks.length ? 1 : 0;
}
