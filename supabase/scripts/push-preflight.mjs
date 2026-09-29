#!/usr/bin/env node
// The founder's preflight before any `supabase db push` to production (CTO 11,
// 2026-09-29; docs/vault-gate1-runbook.md 4.1 and 6.2). It connects to
// nothing: its input is the CSV the Supabase SQL editor downloads for
//
//   select version, name from supabase_migrations.schema_migrations order by version;
//
//   node supabase/scripts/push-preflight.mjs ~/Downloads/production.csv
//
// It refuses unless:
//   - this checkout is main at origin/main (fetch first), with no tracked
//     change and no untracked file under supabase/;
//   - the CSV lists exactly the rows of supabase/production-history.tsv, in
//     order (a row production has that the file lacks, or the other way round,
//     is a stop);
//   - every history row's file matches its pinned SHA-256.
// Then it prints the exact list `supabase db push --linked --dry-run
// --skip-vault` must show. The push itself stays a command the founder types.
import { readFileSync } from 'node:fs';
import { appliedProblems, git, pendingFiles, readHistory } from './history.mjs';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('usage: node supabase/scripts/push-preflight.mjs <production.csv>');
  process.exit(64);
}

const stops = [];

// 1. The checkout.
const head = git(['rev-parse', 'HEAD']).trim();
let originMain = '';
try {
  originMain = git(['rev-parse', '--verify', 'origin/main'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  stops.push('there is no origin/main here; run git fetch origin first');
}
if (originMain && head !== originMain) {
  stops.push(
    `this checkout is at ${head.slice(0, 7)}, not origin/main (${originMain.slice(0, 7)}); run git fetch and check out origin/main`,
  );
}
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
if (branch !== 'main' && branch !== 'HEAD') {
  stops.push(
    `this checkout is on the branch ${branch}; push from main (or a detached origin/main) only`,
  );
}
const dirty = git(['status', '--porcelain', '--untracked-files=all'])
  .split('\n')
  .filter(Boolean)
  .filter((l) => !l.startsWith('??') || l.slice(3).startsWith('supabase/'));
if (dirty.length) stops.push(`the tree is not clean:\n    ${dirty.join('\n    ')}`);

// 2. The CSV against the history file.
function parseCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quoted) {
        if (c === '"' && raw[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        cells.push(cell);
        cell = '';
      } else cell += c;
    }
    cells.push(cell);
    rows.push(cells.map((s) => s.trim()));
  }
  if (rows.length && rows[0][0] === 'version' && rows[0][1] === 'name') rows.shift();
  return rows.map(([version, name]) => ({ version, name }));
}

const history = readHistory();
const production = parseCsv(readFileSync(csvPath, 'utf8'));
const want = history.map((r) => `${r.version} ${r.name}`);
const got = production.map((r) => `${r.version} ${r.name}`);
const width = Math.max(want.length, got.length);
for (let i = 0; i < width; i++) {
  if (want[i] !== got[i]) {
    stops.push(
      `row ${i + 1}: production has ${got[i] ?? 'nothing'}, supabase/production-history.tsv has ${want[i] ?? 'nothing'}`,
    );
  }
}

// 3. The applied files are the bytes production ran.
stops.push(...appliedProblems(history));

if (stops.length) {
  console.error('STOP. Do not push. Hand this output to Claude:\n');
  for (const s of stops) console.error(`- ${s}`);
  process.exit(1);
}

const pending = pendingFiles(history);
console.log(`Preflight passed at ${head.slice(0, 7)}: production's ${history.length} rows match`);
console.log('supabase/production-history.tsv, and every applied file is the one production ran.\n');
if (!pending.length) {
  console.log('Nothing is pending. There is nothing to push.');
} else {
  console.log(
    '`sb db push --linked --dry-run --skip-vault` must list exactly these, in this order:',
  );
  for (const f of pending) console.log(`  ${f}`);
}
