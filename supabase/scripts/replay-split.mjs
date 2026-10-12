#!/usr/bin/env node
// The production replay's file shuffle (tech review 11, 2026-09-29; CI job
// `sql-replay` in .github/workflows/ci.yml). The Supabase CLI builds a local
// database from every file in supabase/migrations, so to start from
// production's state the files production has not applied step out first,
// and come back before `supabase db push --local` applies them.
//
//   node supabase/scripts/replay-split.mjs split [dir]    check the history, move the pending files to dir
//   node supabase/scripts/replay-split.mjs restore [dir]  move them back
//   node supabase/scripts/replay-split.mjs dry-run <out>  check a `db push --dry-run` output lists exactly the pending files, in order
//   node supabase/scripts/replay-split.mjs versions       print every version, history then pending, comma separated
//
// dir defaults to $RUNNER_TEMP/pending-migrations (or the OS temp folder).
// `split` fails unless every row of supabase/production-history.tsv has its
// file on disk with the pinned SHA-256, and in CI it writes `pending=<count>`
// to the step's outputs.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIGRATIONS,
  appliedProblems,
  migrationFiles,
  pendingFiles,
  readHistory,
} from './history.mjs';

const [cmd, arg] = process.argv.slice(2);
const pendingDir = () => arg ?? join(process.env.RUNNER_TEMP ?? tmpdir(), 'pending-migrations');

function fail(msg) {
  console.error(`replay-split: ${msg}`);
  process.exit(1);
}

function checkHistory() {
  const history = readHistory();
  const problems = appliedProblems(history);
  if (problems.length)
    fail(`the folder does not hold production's history:\n  ${problems.join('\n  ')}`);
  return history;
}

if (cmd === 'split') {
  const history = checkHistory();
  const pending = pendingFiles(history);
  const dir = pendingDir();
  if (existsSync(dir) && readdirSync(dir).length)
    fail(`${dir} is not empty; restore or remove it first`);
  mkdirSync(dir, { recursive: true });
  for (const f of pending) renameSync(join(MIGRATIONS, f), join(dir, f));
  console.log(
    `History: ${history.length} applied files, ${history[0].file} to ${history.at(-1).file}.`,
  );
  console.log(`Moved ${pending.length} pending file(s) to ${dir}: ${pending.join(', ') || 'none'}`);
  // The replay's push-shaped steps (production's rows, the after-push
  // checks) describe the next push; with nothing pending they sit out.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending.length}\n`);
  }
} else if (cmd === 'restore') {
  const dir = pendingDir();
  if (!existsSync(dir)) fail(`${dir} does not exist`);
  const moved = migrationFiles(dir);
  for (const f of moved) {
    if (existsSync(join(MIGRATIONS, f))) fail(`${f} is already back in supabase/migrations`);
    renameSync(join(dir, f), join(MIGRATIONS, f));
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`Restored ${moved.length} file(s): ${moved.join(', ') || 'none'}`);
} else if (cmd === 'dry-run') {
  if (!arg) fail('usage: replay-split.mjs dry-run <file holding the dry run output>');
  const history = checkHistory();
  const want = pendingFiles(history);
  const text = readFileSync(arg, 'utf8');
  // The CLI lists them as bullet lines; when it thinks an agent runs it, it
  // also prints the same list as JSON. Read the bullets, else the JSON.
  const name = /\b\d{4}_[a-z0-9_]+\.sql\b/;
  let got = text
    .split('\n')
    .filter((l) => /^\s*•\s/.test(l) && name.test(l))
    .map((l) => name.exec(l)[0]);
  if (!got.length) {
    const json = text
      .split('\n')
      .find((l) => l.trim().startsWith('{') && l.includes('"migrations"'));
    got = json ? JSON.parse(json).migrations : [];
  }
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(
      `the dry run would push ${JSON.stringify(got)}, not the pending files ${JSON.stringify(want)}`,
    );
  }
  console.log(`The dry run lists exactly the pending files, in order: ${want.join(', ')}`);
} else if (cmd === 'versions') {
  const history = readHistory();
  const versions = [...history.map((r) => r.file), ...pendingFiles(history)].map((f) =>
    f.slice(0, 4),
  );
  process.stdout.write(versions.join(','));
} else {
  fail('usage: replay-split.mjs split [dir] | restore [dir] | dry-run <out> | versions');
}
