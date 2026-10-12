#!/usr/bin/env node
// Branch guard for migration numbers (tech review 11, 2026-09-29; the workflow
// .github/workflows/migrations.yml). `supabase db push` matches a migration by
// its number only, so a branch that reuses a number main or production already
// gave to another file would have that file skipped, or re-run under a new
// name. This compares the checked-out tree's supabase/migrations with a ref.
//
//   node supabase/scripts/check-migrations.mjs --against origin/main
//     Fails when the tree has:
//       (a) a number main uses under another name;
//       (b) a number in main's production-history.tsv under another name or
//           with other bytes than the pinned hash;
//       (c) a file not on main numbered at or below the higher of main's
//           newest and production's newest. Such a branch renumbers before it
//           merges;
//       (d) a file production applied (main's production-history.tsv) missing
//           from the tree, deleted or renamed away;
//     and a file whose bytes another file in the tree already holds (a copy
//     under a new number, not a move).
//
//   node supabase/scripts/check-migrations.mjs --scan-remotes --against origin/main
//     On a push to main: runs the same checks for every refs/remotes/origin/*
//     branch and reports each collision as a warning (in the job summary when
//     $GITHUB_STEP_SUMMARY is set). It never fails, so a stale held branch
//     shows up the day main takes its number without turning main red. A
//     branch missing applied files, check (d), is one line, "behind main;
//     merge main before touching supabase/", not one line per file: every
//     branch cut before main took production's files would list all of them.
//
// Reads git objects only. Connects to nothing, installs nothing.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FILE_NAME,
  MIGRATIONS,
  git,
  migrationFiles,
  parseHistory,
  readHistory,
  sha256,
} from './history.mjs';

const args = process.argv.slice(2);
const against = args[args.indexOf('--against') + 1];
if (!args.includes('--against') || !against) {
  console.error('usage: check-migrations.mjs [--scan-remotes] --against <ref>');
  process.exit(64);
}

/** Migration file names at a ref (or the working tree when ref is null). */
function filesAt(ref) {
  if (ref === null) return migrationFiles(MIGRATIONS);
  const out = git(['ls-tree', '--name-only', `${ref}:supabase/migrations`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out
    .split('\n')
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function bytesAt(ref, file) {
  if (ref === null) return readFileSync(join(MIGRATIONS, file));
  return git(['show', `${ref}:supabase/migrations/${file}`], {
    encoding: 'buffer',
    maxBuffer: 64 << 20,
  });
}

function historyAt(ref) {
  try {
    return parseHistory(
      git(['show', `${ref}:supabase/production-history.tsv`], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    return null;
  }
}

/**
 * Every problem with `ref`'s migrations (null: the working tree) against main.
 *
 * Production decides what a number means (tech review 11). So a file production ran
 * (in the history, with the pinned bytes) never counts against (a) or (c):
 * where main disagrees with it, main is the one that is wrong. The history is
 * main's production-history.tsv; only while main has none yet (the reconcile
 * that adds it) does the checked-out tree's copy stand in, so once it is on
 * main no branch can exempt itself by editing its own copy.
 *
 * A file whose bytes main holds under another name is one of two things: main's
 * unapplied file moved, bytes unchanged, to a free number above production's
 * newest (the reconcile's own move; it passes, but only when the old name is
 * gone from the tree, so a copy is never read as a move), or a stale name or a
 * renumbered copy, which gets one line saying what to do instead of three.
 */
export function problemsFor(ref, mainRef) {
  const problems = [];
  const notes = [];
  const mainFiles = filesAt(mainRef);
  const mainByVersion = new Map(mainFiles.map((f) => [f.slice(0, 4), f]));
  const mainHistory = historyAt(mainRef);
  let history = mainHistory;
  if (!history) {
    try {
      history = ref === null ? readHistory() : historyAt(ref);
    } catch {
      history = null;
    }
    if (history)
      notes.push(`${mainRef} has no production-history.tsv yet; the tree's copy stands in for it`);
  }
  const historyByVersion = new Map((history ?? []).map((r) => [r.version, r]));
  const appliedFiles = new Set((history ?? []).map((r) => r.file));
  const newestMain =
    mainFiles
      .map((f) => f.slice(0, 4))
      .sort()
      .at(-1) ?? '0000';
  const newestProd = history?.at(-1)?.version ?? '0000';
  const ceiling = newestMain > newestProd ? newestMain : newestProd;
  const mainByHash = new Map(mainFiles.map((f) => [sha256(bytesAt(mainRef, f)), f]));
  const treeFiles = filesAt(ref);
  const inTree = new Set(treeFiles);

  const missing = (history ?? []).filter((row) => !inTree.has(row.file)).map((row) => row.file);
  for (const file of missing) {
    problems.push(
      `(d) ${file}: production applied it, and it is missing here; an applied file stays, byte for byte`,
    );
  }

  for (const file of treeFiles) {
    const m = FILE_NAME.exec(file);
    if (!m) {
      problems.push(`${file}: not named NNNN_words.sql`);
      continue;
    }
    const [, version] = m;
    const hash = sha256(bytesAt(ref, file));
    const onMain = mainByVersion.get(version);
    const sameBytes = mainByHash.get(hash);
    if (sameBytes && sameBytes !== file) {
      const free = !onMain || onMain === sameBytes;
      if (inTree.has(sameBytes)) {
        problems.push(
          `${file}: a copy of ${sameBytes}, which is here too; one change is one file`,
        );
      } else if (!appliedFiles.has(sameBytes) && version > newestProd && free) {
        notes.push(
          `${file} is main's unapplied ${sameBytes}, moved above production's newest (${newestProd})`,
        );
      } else if (appliedFiles.has(sameBytes)) {
        problems.push(
          `${file}: a copy of ${sameBytes}, which production applied; never renumber an applied file`,
        );
      } else {
        problems.push(
          `${file}: main holds these bytes as ${sameBytes}; use main's name (merge main)`,
        );
      }
      continue;
    }
    const applied = historyByVersion.get(version);
    const ranInProduction = applied?.file === file && applied.sha256 === hash;
    if (applied && !ranInProduction) {
      problems.push(
        applied.file !== file
          ? `(b) ${file}: production applied ${version} as ${applied.file}`
          : `(b) ${file}: its bytes differ from what production ran (production-history.tsv)`,
      );
    }
    if (onMain && onMain !== file) {
      if (ranInProduction)
        notes.push(`${file} is production's ${version}; main's ${onMain} must move`);
      else problems.push(`(a) ${file}: main uses ${version} for ${onMain}`);
    }
    if (!mainFiles.includes(file) && version <= ceiling && !ranInProduction) {
      problems.push(
        `(c) ${file}: not on main and numbered at or below ${ceiling}; renumber it above ${ceiling} before it merges`,
      );
    }
  }
  return { problems, notes, history: history !== null, ceiling, missing };
}

/** A scanned branch's warnings: check (d) as one line for the branch (the
 *  branch is behind main), every other problem as it is. */
export function scanLines(found) {
  const rest = found.problems.filter((p) => !p.startsWith('(d) '));
  if (found.missing.length === 0) return rest;
  const n = found.missing.length;
  return [
    `(d) behind main; merge main before touching supabase/ (${n} file${n === 1 ? '' : 's'} production applied ${n === 1 ? 'is' : 'are'} missing here)`,
    ...rest,
  ];
}

if (args.includes('--scan-remotes')) {
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/'])
    .split('\n')
    .filter((r) => r && r !== 'origin/HEAD' && r !== 'origin' && r !== against);
  const lines = [];
  for (const ref of refs) {
    let found;
    try {
      found = scanLines(problemsFor(ref, against));
    } catch {
      continue; // no supabase/migrations on that branch
    }
    for (const p of found) {
      console.log(`::warning title=Migration number on ${ref}::${p}`);
      lines.push(`- \`${ref}\`: ${p}`);
    }
  }
  const summary = lines.length
    ? `### Migration numbers on other branches\n\n${lines.join('\n')}\n\nEach such branch merges main, or renumbers above the newest taken number, before it merges.\n`
    : '### Migration numbers on other branches\n\nNo branch collides with main or production.\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
} else {
  const { problems, notes, history, ceiling } = problemsFor(null, against);
  for (const n of notes) console.log(`note: ${n}`);
  if (!history)
    console.log('note: no production-history.tsv on either side, so check (b) was skipped');
  if (problems.length) {
    console.error(
      `Migration numbers collide with ${against} or production:\n  ${problems.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `Migrations agree with ${against} and production's history (newest taken number ${ceiling}).`,
  );
}
