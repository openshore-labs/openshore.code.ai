// Team vault claims (Vault M8, finding orgvault-19): the docs and a migration
// comment said a concurrent team overwrite is "never lost", which the review's
// repros disproved (a conflict copy folded by the minute could still drop a
// version with three writers in one minute; 0021's revisions table is what
// keeps every displaced body now). This guard fails on that claim, in any of
// its wordings, wherever it sits beside the team vault: the app's and the
// engine's source (comments included), the tracked docs, and the comment
// lines of the Supabase migrations.
//
// A claim is the unqualified "never lost" family in the same paragraph as a
// team word (team, org, organization, teammate, member, multi-writer) and a
// two-writers word (concurrent, overwrite, last-write-wins, at once). Personal
// storage lines ("a resealing hiccup must never lose data") and a one-writer
// step that keeps a revision row are not the claim and pass.
//
// Exempt by name, each with its reason:
// - the review findings, the plan, the test map, and the progress archive
//   quote the old claim as history;
// - supabase/migrations/0010_org_vault.sql is an APPLIED migration, so its
//   header comment is not edited (orgvault-19); 0021's revisions table
//   supersedes it, and the note on that lives with the M8 records.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: HERE,
  encoding: 'utf8',
}).trim();

const EXEMPT = new Map<string, string>([
  ['docs/design/vault-v1-review-findings.md', 'quotes the claim as the finding'],
  ['docs/design/vault-v1-plan.md', 'quotes the claim as the work to do'],
  ['docs/design/vault-v1-test-map.md', 'quotes the claim as the finding it maps'],
  [
    'supabase/migrations/0010_org_vault.sql',
    'orgvault-19: an applied migration is never edited; 0021 revisions supersede its header',
  ],
]);

/** The claim, in its wordings. */
const CLAIM =
  /\bnever\s+(?:silently\s+)?(?:be\s+)?(?:lost|loses?|lose)\b|\bnothing\s+is\s+(?:ever\s+)?lost\b|\bno\s+(?:edit|work|write)s?\s+(?:is|are)\s+ever\s+lost\b/i;
/** Words that put a paragraph about the team vault. */
const TEAM = /\b(?:team|org|organi[sz]ation|teammates?|members?(?:'s)?|multi-writer)\b/i;
/** Words that make it about two writers at once, the case the claim was
 *  false for (a one-writer step that keeps a revision row is not it). */
const RACE =
  /\b(?:concurrent(?:ly)?|overwrit\w*|last[- ]write[- ]wins|at once|same time|two (?:members|teammates|people|writers))\b/i;

/** Tracked files under the scanned roots. */
function tracked(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--', 'app/src', 'os-code/src', 'docs', 'os-code/docs', 'supabase/migrations'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => ['.ts', '.tsx', '.md', '.sql'].includes(extname(f)));
}

/** The prose a claim could sit in, as paragraphs. Markdown splits on blank
 *  lines. Code and SQL give their comments only, one paragraph per run of
 *  consecutive comment lines (any code line ends a run), plus each string
 *  literal of a source file as its own paragraph, since copy lives there. */
function paragraphs(file: string, text: string): string[] {
  const flat = (p: string) => p.replace(/\s+/g, ' ').trim();
  if (extname(file) === '.md') return text.split(/\n\s*\n/).map(flat);
  const sql = extname(file) === '.sql';
  const out: string[] = [];
  let run: string[] = [];
  let block = false;
  const end = () => {
    if (run.length) out.push(flat(run.join(' ')));
    run = [];
  };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!sql && block) {
      const close = t.indexOf('*/');
      run.push(t.slice(0, close >= 0 ? close : undefined).replace(/^\*\s?/, ''));
      if (close >= 0) block = false;
      continue;
    }
    const marker = sql ? '--' : '//';
    if (t.startsWith(marker)) {
      run.push(t.slice(marker.length));
      continue;
    }
    if (!sql && t.startsWith('/*')) {
      const close = t.indexOf('*/', 2);
      run.push(t.slice(t.startsWith('/**') ? 3 : 2, close >= 0 ? close : undefined));
      block = close < 0;
      continue;
    }
    // A code line ends the run; a trailing comment on it is its own run.
    end();
    const at = t.indexOf(` ${marker} `);
    if (at >= 0) out.push(flat(t.slice(at + marker.length + 2)));
    if (!sql) {
      for (const m of t.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g)) {
        out.push(flat(m[1] ?? m[2] ?? m[3] ?? ''));
      }
    }
  }
  end();
  return out;
}

/** Every paragraph in the text that makes the claim about the team vault. */
function teamClaims(file: string, text: string): string[] {
  return paragraphs(file, text).filter((p) => CLAIM.test(p) && TEAM.test(p) && RACE.test(p));
}

describe('no team vault claim says a concurrent edit is never lost (orgvault-19)', () => {
  it('finds none in the app, the engine, the docs, or the migration comments', () => {
    const files = tracked();
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      if (EXEMPT.has(file)) continue;
      for (const p of teamClaims(file, readFileSync(resolve(ROOT, file), 'utf8'))) {
        hits.push(`${file}: ${p.slice(0, 160)}`);
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('every exemption names a file that exists and is still scanned otherwise', () => {
    const files = new Set(tracked());
    for (const [file, why] of EXEMPT) {
      expect(files.has(file), file).toBe(true);
      expect(why.length, file).toBeGreaterThan(10);
    }
  });

  it('can fail: the old wordings are caught, and a personal storage line passes', () => {
    const sql =
      '-- Writes go through a RPC with a CONFLICT COPY, so a concurrent overwrite never\n' +
      "--     silently loses a member's work.\nselect 1;\n";
    expect(teamClaims('x.sql', sql)).toHaveLength(1);
    const md =
      'The team vault keeps a conflict copy (the overwritten body is preserved, never lost).';
    expect(teamClaims('x.md', md)).toHaveLength(1);
    const ts =
      '// Team notes: last write wins, but\n// nothing is lost when two members save at once.\n';
    expect(teamClaims('x.ts', ts)).toHaveLength(1);
    // The same words in SQL code (not a comment) are not prose.
    expect(teamClaims('x.sql', "select 'team overwrite never lost';\n")).toEqual([]);
    // A team step with one writer and a revision row is not the claim.
    expect(
      teamClaims(
        'x.sql',
        '-- Move the other org note aside with a revision row, so nothing is lost.\n',
      ),
    ).toEqual([]);
    // Not about the team vault.
    expect(teamClaims('x.ts', '// A resealing hiccup must never lose data.\n')).toEqual([]);
    // The applied migration still says it, which is why it is exempt.
    const applied = readFileSync(resolve(ROOT, 'supabase/migrations/0010_org_vault.sql'), 'utf8');
    expect(teamClaims('supabase/migrations/0010_org_vault.sql', applied).length).toBeGreaterThan(0);
  });
});
