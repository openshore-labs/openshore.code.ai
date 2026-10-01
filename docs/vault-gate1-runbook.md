# Runbook: gate 1 under CTO 4 and CTO 11 (0021 to 0026, all from main)

This replaces the earlier drafts (push-0019-0021, v2, and the CTO 4 edition that pushed "0019, 0022 to 0025"). Do not use any of them.

**Status (2026-09-30, after the push):** 0021 to 0026 are APPLIED. You ran each file in the SQL editor from main at 4ffe370, one per run, bytes unchanged, with a guard above it and its history row in the same transaction, instead of the CLI push in section 7 (one user on TestFlight, your call); the check after it matched all 31 function bodies by md5 and found the three cron jobs, and `supabase/production-history.tsv` has the six rows. 7.4 is done too: you deployed main's `delete-account` the same day from main at 81253d0, and its no-sign-in check answered `{"error":"unauthorized"}`. What is left: section 11's hand-off to Claude. The rest of this runbook is the reference for the next push.

**Status before the push (2026-09-30):** production's history holds 0001 to 0020, and its 0019 and 0020 are the privacy branch's files, not main's (the founder's `schema_migrations` query, 2026-09-29). Packages A to C are on `main` (41bea18, landed 2026-09-30 from another session): CTO 11's reconcile to that history (A), reviews from production's view (B), and account deletion as one design (C: main's `delete-account` with the privacy function's legal-hold copy, the email cleanup and the guarded team delete, and an app that reads either function's answers). Section 0 ran clean on 2026-09-30 and you said yes to landing (DECISIONS, the F1 entry); it stays below as the reference. The review fixes on `prod-reconcile` (PR #2) change 0022 and 0026, both unapplied, so they land on `main` before push day (section 1). Once they have, your next step is push day: section 2 onward, through section 10.

**CTO 4 and CTO 11, as the repo records them:** migrations go to production from `main` only, never from a held branch (`supabase/README.md`, Migration history and Ship order; DECISIONS, the premium build entry and CTO 11). Production's history decides what a number means. `supabase/production-history.tsv` pins every applied file by name and SHA-256, and an applied file is never edited, renamed or renumbered. Main's Org Vault v1 file moved from 0019 to `0021_org_vault_v1.sql` with its bytes unchanged. `0022` and `0023` are main's. The team files are `0024_org_vault_move.sql` and `0025_org_vault_settings.sql` (written as 0020 and 0021 on the held branch). `0026_export_and_retention.sql` is new with CTO 11.

**Where things stand (2026-09-30; section 0's 4.1 matched it that day):**

- Production (lzlrlfdffwiypzreoldb) has exactly these 20 rows, and `supabase/production-history.tsv` has the same 20:

  | version | name |
  | --- | --- |
  | 0001 | orgs |
  | 0002 | rls |
  | 0003 | claim |
  | 0004 | entitlement_status |
  | 0005 | orgs_rls_lockdown |
  | 0006 | user_entitlements |
  | 0007 | user_entitlements_stripe_customer |
  | 0008 | apple_notifications_seen |
  | 0009 | push |
  | 0010 | org_vault |
  | 0011 | model_reviews |
  | 0012 | review_moderation |
  | 0013 | review_snapshot |
  | 0014 | org_projects |
  | 0015 | review_2026_09_05 |
  | 0016 | guardrail_enforcement |
  | 0017 | reconcile_stale_0016 |
  | 0018 | graduated_enforcement |
  | 0019 | account_deletion_and_guardrail_retention |
  | 0020 | reviews_public_view |

- The next push is exactly six files from `main`, in this order: `0021_org_vault_v1.sql`, `0022_account_deletion.sql`, `0023_org_free_caps.sql`, `0024_org_vault_move.sql`, `0025_org_vault_settings.sql`, `0026_export_and_retention.sql`.
- `vault-m2-team` (draft PR #1) and the other held branches still carry main's old supabase folder (the org vault file under 0019). They take the rename when they merge main (section 11).

## The plan in three steps

1. **Claude** lands packages A, B and C (CTO 11, the closure memo) on `main`, once you give the go-ahead (section 1). Done 2026-09-30 for A to C; the review fixes (PR #2) land the same way before push day.
2. **You**, from an up-to-date `main`: the preflights (among them `push-preflight.mjs` and which `delete-account` is live), backups, one push at a quiet hour, one deploy of main's `delete-account`, then the checks and the rolled-back smoke test (sections 2 to 10).
3. **Claude** records the push in `supabase/production-history.tsv`, merges `main` into the held branches, and merges draft PR #1 once its CI is green on the current `main` (section 11).

## Facts that shape the plan

- **Production's 0019 and 0020 are not main's old files.** They were pushed on 2026-09-24 from the unmerged branch `claude/openshore-privacy-mobile-1ij12h` (its head `d3d4bb7` says so). The CLI matches on the version number only, so a push from the old `main` would have treated main's org vault file (then 0019) as applied and skipped it, and refused because remote 0020 had no local file. Main now holds both privacy files byte for byte (blobs `6c50cda` and `6d91842`), and the org vault file is 0021.
- **Never renumber the privacy files.** A renumbered copy would run 0019's re-key again (0019 lines 316-326 are not idempotent), keying every unsubmitted fingerprint a second time and breaking the report dedupe, and would put back 0019's broken `record_enforcement` (lines 377-462). The earlier hand-off sentence asking the privacy branch to renumber is withdrawn.
- **0021 to 0026 passed pgTAP both ways, locally on 2.118.0 (2026-09-30, with package C's 0022 and 0026 and the review's fixes).** From empty: `Files=4, Tests=301`, `Result: PASS`. Replaying production (its 20 files, then rows with production's shape, then the six pending files through `db push --local --skip-vault`): `supabase/replay/after_push.sql` printed `REPLAY CHECKS PASSED: 11 checks held on production's rows.`, and pgTAP gave `Files=4, Tests=301`, `Result: PASS`. CI's `sql` and `sql-replay` jobs are the proof of record.
- **Which `delete-account` is live decides whether the push is safe for deletions.** The analysis in 7.4 and the compatibility window assume production runs the privacy branch's function, deployed 2026-09-24 with 0019 and 0020 (d3d4bb7): it writes only tables that exist before and after the push. Main's pre-merge function (never meant to be deployed) writes a tombstone shape 0022 no longer has. So 0.2 and 2.2d check the deployment time before anything else (founder decision F6). 0.2 found 2026-09-24 on 2026-09-30; 2.2d looks again on push day.
- **"CI is green" means `check`, `sql`, `sql-replay` and `migrations`.** The `windows` job has failed on `main` for reasons with no SQL in them (run 36590234172: `test/processTools.test.ts`, EBUSY on a temp folder). Compare any windows failure against main's latest windows run.
- **Merging is safe for builds in the field; pushing changes what they see.** Main's app calls only `org_vault_put`, `org_vault_delete` and plain selects on `org_vault_notes` (`app/src/lib/gitos/orgVault.ts`). But 0025 re-creates `org_vault_put` and `org_vault_delete` with the plan gate (0025 lines 596-708), so once pushed, a team with a lapsed entitlement row goes read-only in every build (4.3), and 0023's caps reach every build too (4.5).
- **The files are the same bytes the held branches carry.** `0021_org_vault_v1.sql` is blob `a2bee6c`, the same bytes `vault-m2-team`, `vault-team-migrations`, `vault-m2-icloud` and `vault-m2-native` hold under the old number. None of them edits it, so the rename carries through when they merge main.
- **The push applies every local file that production's history lacks, matching on the version number only** (read in the 2.118.0 code). With the history above, that is exactly 0021 to 0026, all above production's newest (0020), so no `--include-all` is ever needed.
- **A push is one transaction per file, and it stops at the first failure.** Verified locally on 2.118.0: with a failing statement added to 0025, the push applied 0024, stopped at 0025, left the history ending at 0024, and a second push applied only 0025.
- **A push writes Vault secrets unless told not to.** 2.118.0 upserts every Vault secret `config.toml` resolves before it migrates, "unless --skip-vault is set". `config.toml` has no `[db.vault]` section (a text test fails if it gains one), and every push command below carries `--skip-vault` anyway, so production's `guardrail_hmac_key` is never touched.
- **0021's case-duplicate rename runs against rows in CI now.** The `sql-replay` job loads case-duplicate paths before the push (`supabase/replay/production_rows.sql`) and checks the rename afterwards. Production's own rows are still unknown until 4.2.
- **0022 turns on a ladder that has never recorded anything.** In 0016 to 0019, `record_enforcement` raised on every call ("column reference action is ambiguous"; 0022 lines 161-166). After 0022, the app's call after a blocked request records a row: a warning after one confirmed Tier 1 block, and a termination flag plus a queued, never submitted, report after a second one within 90 days (0018 lines 42-48). The warning names support@openshore.ai (founder decision F1, 2026-09-30); production's 0019 showed os-code@openshorellc.com, and its ladder never recorded a row.
- **The CLI skips its own confirmation when it thinks an AI agent is running it.** Under Claude Code it printed JSON, and its confirm helper then returns the default, Yes for a push. So run every `sb` command below yourself, in a Terminal window you typed into. Never through Claude.

**Ground rules**

- "SQL editor" means Dashboard, SQL Editor. Run one block at a time; the editor shows only the last result. Before each block, check that the address contains `/project/lzlrlfdffwiypzreoldb/`, since Uki is on Supabase too (README lines 3-4). If the editor offers a role picker, choose `postgres` (not verified here that it has one).
- Terminal: do every Terminal step in one macOS Terminal window and keep it open. If you open a new one, re-run 2.1 and `cd` into `oscode-main`. Always type `sb`, never `supabase`.
- Never push from `vault-m2-team` or any branch other than `main`. Never add `--include-all`. Every push carries `--skip-vault`. Never edit a migration that production has applied; any change is a new file numbered above the newest.

---

## 0. Look and decide first (browser only, read only)

**Done 2026-09-30, clean** (DECISIONS, the F1 entry): nothing deploys from `main`, the live `delete-account` was deployed 2026-09-24, and 0.3 found the history equal to `production-history.tsv`, the Vault key present, no leftovers, pg_cron on with both jobs, and no rows from 4.2 to 4.5. You said yes to landing. Nothing here is to do again; it stays as the reference for what push day re-checks (2.2b, 2.2d, and sections 4 and 5 in full).

1. **2.2b before package A reaches `main`.** If an integration deploys migrations when `main` changes, landing package A would push 0021 to 0026 with no preflight. Tell Claude to hold the landing until you have looked.
   - **Done 2026-09-30:** Project Settings, Integrations, GitHub showed "Choose GitHub repository", so no repository is connected and nothing deploys from `main`. Look again on push day (2.2b), since a connection can be added later.
2. **Which `delete-account` is live (F6).** Dashboard, Edge Functions, `delete-account`: note its last deployed time.
   - **Done 2026-09-30:** 2026-09-24, the privacy branch's function (DECISIONS, F6's first fact). 2.2d looks again on push day.
   - **2026-09-24** means the privacy branch's function, the one this runbook's safety analysis assumes (7.4). Go on.
   - **Stop if** it is any other date, or there is no such function. Something else was deployed; hand the date to Claude before any push.
3. **In the SQL editor, run the SQL blocks of 4.1 (the history, the Vault secret count and the leftovers query), 4.2 to 4.5, and 5.2.** Skip 4.1's `push-preflight.mjs` step here: it runs in the Terminal from `oscode-main`, which 2.3 makes on push day. Compare the history with the 20-row table under "Where things stand" instead.
   - **Done 2026-09-30, clean:** the history equal to `production-history.tsv`, the Vault secret count 1, no leftovers, no rows from 4.2 to 4.5, and 5.2 showed both jobs. That run's 5.2 had no `username` column (it came with the review fixes), so push day's re-run of sections 4 and 5 is the first look at it.
   - 4.1 hits a stop: hand the output to Claude and do not push.
   - 4.2 returns rows: have the owners fix those notes first, or ask Claude for the local rename rehearsal (4.2).
   - 4.3 lists teams: decide per 4.3.
   - 4.4 returns rows: fix them with Claude before any push.
   - 4.5 returns rows: tell those owners before the push (in the words 4.5 gives).
   - 5.2 lacks `oscode_guardrail_retention`: turn pg_cron on at 5.1; 0026 schedules the job.
   - 5.2 shows `oscode_guardrail_retention` under a username other than `postgres`: hand it to Claude and do not push.
4. **What the interaction review left open, now settled.**
   - a. **0023's refusal copy: resolved by CTO 11.** 0023 was unapplied, so the file itself now says "start a plan to add more. A deleted note frees its space when its history is cleared, about a month later" (0023 line 190). Nothing to decide.
   - b. **The `delete-account` race: resolved by package C.** 0022's `account_deletion_orgs` deletes the owned teams in one statement, all or none, only while nobody else is active in them; fewer back than planned and the function answers `owns_org`.
   - c. **A deleted person's email in `org_project_members` and pending invites: resolved by package C** (CX: erase it). 0022's `account_deletion_memberships` removes every row bound to the account and every unclaimed row under its confirmed email.
   - d. **Founder decision F1, the appeal address: ruled 2026-09-30.** support@openshore.ai passed its round-trip test, so 0022's warning, the app's Delete account sheet and block card (`SUPPORT_EMAIL`), and the Terms all say it, and `app/test/contactAddress.test.ts` fails if any of them differs. 0022 was unapplied, so its one line changed with the constant and the Terms. After the push, switching it again takes a new migration.

On push day you run sections 4 and 5 again, in full, `push-preflight.mjs` included.

---

## 1. Step 1: Claude lands packages A, B and C, then the review fixes, on `main`

With your go-ahead, and only after 0.1.

- **Done 2026-09-30 for packages A to C:** the reconcile branch (package A, the migrations; B, reviews from the public view; C, account deletion as one design) is on `main` at 41bea18, merged through a PR from another session after your yes.
- **Before push day, the review fixes:** `prod-reconcile` into `main`, PR #2, through GitHub with your go-ahead, never a direct push to `main`. They change two unapplied files, 0022 (`account_deletion_orgs` is all or none over every team named) and 0026 (the export matches by email only rows nobody has claimed, and it stops, naming the owner, on a retention job another role owns), and the `delete-account` function, which now copies the legal hold after the team delete. They also carry app fixes (Block this user reads a void call's empty answer, and Delete account settles an account already gone, ends a dead sign-in the way an expiry does, and says when it could not confirm), `local-vault.sh` and `check-migrations.mjs`. **Push day waits for this merge:** a push from a `main` without it would apply the older 0022 and 0026, and an applied file is frozen. Claude reports the merge commit; 2.3 checks for it.
- After PR #2 lands, main's CI runs. **You should see:** `sql` ending with `Files=4, Tests=301` and `Result: PASS`; `sql-replay` green through its steps (the dry run lists exactly 0021 to 0026, `REPLAY CHECKS PASSED: 11 checks`, pgTAP `Files=4, Tests=301`, and an empty schema diff); `check` and `migrations` green; `windows` failing no differently from main's latest windows run.
- **Side effects:** no TestFlight build (Codemagic builds only when started by hand, founder 2026-10-01), but a desktop release, since `.github/workflows/release.yml` builds the desktops on every push to `main` that touches `app/`, `os-code/` or the workspace files (section 11). Both carry the same app fixes against what production already runs: community reviews read `model_reviews_public` (production's 0020), Block this user saves and reloads, and Delete account reads the live 2026-09-24 function's answers correctly. Nothing changes in production; only a push and a deploy do.
- **Stop if** `sql`, `sql-replay`, `check` or `migrations` fails.

---

## 2. Prerequisites (push day)

**2.1 Pin the CLI and clean the shell:**

```
alias sb='npx --yes supabase@2.118.0 --agent no'
sb --version
env | grep '^SUPABASE_'
```

- **You should see:** `2.118.0`, and nothing from the `env` line. You need Node for npx and for 4.1's preflight script.
- **If the `env` line prints anything,** `unset` each name in this window (for example `unset SUPABASE_PROJECT_ID`). In 2.118.0, `SUPABASE_PROJECT_ID` beats the linked project, and `SUPABASE_WORKDIR` changes which `supabase/` folder is read (read in the binary, not run).
- **Stop if:** it prints any other version. Not verified here: that 2.118.0 downloads on macOS with Apple Silicon.

**2.2 Dashboard checks** (first in section 0, again on push day):

- a. Project Settings, General. The Project ID must be `lzlrlfdffwiypzreoldb` (it is also in the README's repo-oauth callback URL).
- b. Project Settings, Integrations, GitHub. Confirm that nothing deploys migrations to production automatically, and note whether Branching is on. **Stop if** automatic production deploys are on, and rethink the plan with Claude. The repo has no deploy automation of its own (no push step or `SUPABASE_ACCESS_TOKEN` in `.github/` or `codemagic.yaml`). On 2026-09-30 (0.1) this page showed "Choose GitHub repository": nothing connected. Look again; a connection can be added at any time.
- c. Codemagic, environment group `Harbor-os-code` (`codemagic.yaml` lines 31-32 and 233-240). `VITE_SUPABASE_URL` must be `https://lzlrlfdffwiypzreoldb.supabase.co`. **Stop if** it names another project. Not verified here: the group is not visible from the repo.
- d. Edge Functions, `delete-account`: its last deployed time is still 2026-09-24 (0.2). **Stop if** it changed since you looked in section 0.

**2.3 An up-to-date checkout of main.** After Claude reports that PR #2 (the review fixes) merged into `main` (section 1).

```
cd <your clone of openshore-labs/openshore.code.ai>
git fetch origin
git worktree list
git worktree add --detach ../oscode-main origin/main
cd ../oscode-main
git log -1 --format='%h %s'
git status --short
ls supabase/migrations | tail -8
cat supabase/production-history.tsv | grep -v '^#' | tail -3
grep -c 'cannot re-schedule it' supabase/migrations/0026_export_and_retention.sql
```

- **If `git worktree list` shows `oscode-migrations`** from the first runbook, remove it first: `git worktree remove ../oscode-migrations` (add `--force` if git refuses). Nothing may ever be pushed from it.
- **If `worktree add` says `../oscode-main` already exists,** run `git worktree remove ../oscode-main` and add it again.
- **You should see:** the merge commit Claude reported for PR #2 (or a newer `main` commit); nothing from `git status --short`; the last eight files `0019_account_deletion_and_guardrail_retention.sql`, `0020_reviews_public_view.sql`, `0021_org_vault_v1.sql`, `0022_account_deletion.sql`, `0023_org_free_caps.sql`, `0024_org_vault_move.sql`, `0025_org_vault_settings.sql`, `0026_export_and_retention.sql`; the history ending at `0020 reviews_public_view`; and `1` from the `grep`, 0026's retention-owner stop, which came with the review fixes.
- **Stop if:** any file numbered 0027 or higher exists (unless Claude revised this runbook for it), the history file ends anywhere else, or the `grep` prints `0`: this `main` does not have the review fixes yet, and a push now would freeze the older 0022 and 0026.

**2.4 Log in and link:**

```
sb login
```

- Press Enter, sign in in the browser, and type the verification code at the `Enter your verification code:` prompt.
- **You should see:** `You are now logged in. Happy coding!`

```
sb link --project-ref lzlrlfdffwiypzreoldb
pwd
cat supabase/.temp/project-ref
```

- **You should see:** `Finished supabase link.`, a `pwd` ending in `oscode-main`, and `lzlrlfdffwiypzreoldb`. `supabase/.temp/` is ignored by git.
- **Password:** 2.118.0 makes a temporary login role through the API, so link and push should not ask for a database password (read in the code, not run). If one is asked for, stop and hand the output to Claude. Do not reset the database password partway through.
- **Stop if:** the link fails, or `cat` prints anything else.

**2.5 Pick a quiet hour.** None of these files sets a `lock_timeout`, and each holds its locks until it commits:

- 0021: a SHARE lock on `org_vault_notes` while it builds the unique index without CONCURRENTLY (lines 197-199); then an ACCESS EXCLUSIVE lock while it rewrites the table for the new `size` column (lines 205-218).
- 0022: its catalog loop finds the five author keys already set null by production's 0019 and changes nothing (lines 60-110); it adds the report check and index on `abuse_reports` (lines 288-341). If a dashboard-made key under another name turns up, swapping it also locks `auth.users` against writes until 0022 commits.
- 0023: it adds triggers on `orgs`, `org_vault_notes` and `org_vault_revisions`, then reads both vault tables for its backfill (lines 200-222).
- 0024 only creates a function.
- 0025: it adds two foreign keys to `auth.users` (section 10, lines 748-793), so sign-ins and sign-ups wait until 0025 commits. It also clears and validates `org_vault_revisions.updated_by`, and builds `org_vault_revisions_updated_by_idx` without CONCURRENTLY (lines 798-799), which blocks history writes (overwrites, deletes, renames) until it commits.
- 0026 replaces one function and re-schedules one cron job.

The lock levels come from Postgres's documented rules; the durations are not measured on this project. This lists the busiest hours of the last week; push outside them:

```sql
select date_trunc('hour', updated_at) as hour, count(*) as writes
from public.org_vault_notes
where updated_at > now() - interval '7 days'
group by 1 order by 2 desc limit 10;
```

---

## 3. Backups

There are no down migrations. Any undo is a new file numbered above the newest, or a restore. Never run `sb migration down`, `sb db reset --linked` or `sb migration repair` against production.

**3.1 Check the dashboard backups.** Dashboard, Database, Backups.

- **Pass:** a backup from the last 24 hours, or point-in-time recovery, is listed. Otherwise do 3.3.
- A restore rewinds the whole project, including every signup, entitlement and webhook write since the backup, and means downtime. It is a last resort, not the undo for this change. Not verified here: that exact path and your plan.

**3.2 Copy the tables whose rows change.** This writes to production, so run it at 7.1, after sections 4 to 6 pass. 0021 renames case duplicates and rewrites `org_vault_notes`; 0022 may delete queued repeats from `abuse_reports` (lines 315-326).

```sql
create schema if not exists pre_0021;
revoke all on schema pre_0021 from public, anon, authenticated;
drop table if exists pre_0021.org_vault_notes;
create table pre_0021.org_vault_notes as table public.org_vault_notes;
drop table if exists pre_0021.abuse_reports;
create table pre_0021.abuse_reports as table public.abuse_reports;
```

Then compare counts, one block each: `select count(*) from pre_0021.org_vault_notes;` against `select count(*) from public.org_vault_notes;`, and the same for `abuse_reports`.

- **You should see:** each pair gives the same number.
- **Stop if:** any statement errors.

**3.3 Take your own dump, only if 3.1 did not pass.**

Option A, no password needed. Not verified here: whether it needs Docker.

```
sb db dump --linked -s public,supabase_migrations -f ~/oscode-pre-gate1-schema.sql
sb db dump --linked --data-only -s public,supabase_migrations -f ~/oscode-pre-gate1-data.sql
```

Option B:

1. In the Dashboard, open Connect and copy the Session pooler URI.
2. Replace `[YOUR-PASSWORD]` with the database password from your password manager, percent-encoding any special characters. If you don't have it, use Option A instead of resetting it.
3. Run:

```
brew install libpq
"$(brew --prefix libpq)/bin/pg_dump" "<session pooler URI>" --schema=public --schema=supabase_migrations --format=custom --no-owner -f ~/oscode-pre-gate1.dump
"$(brew --prefix libpq)/bin/pg_restore" --list ~/oscode-pre-gate1.dump | head
```

- **You should see:** files that are not empty; with Option B, also a table of contents.
- **Stop if:** pg_dump complains about the server version. Its major version must be at least the server's (`select version();`).

**3.4 If something has to be put back,** hand it to Claude. The facts it needs:

- Each note 0021 renames keeps its old path and body in `org_vault_revisions` with `reason = 'renamed'` (0021 line 184), and in `pre_0021.org_vault_notes`.
- The weekly purge deletes revision rows older than 30 days (0021 lines 527-547), so keep `pre_0021` until you are satisfied.
- Copying notes back needs an explicit column list: `org_id, path, body, deleted, rev, updated_at, updated_by`. Never `select *`: 0021 re-adds `size` as a generated column at the end (lines 205-218).
- 0022 removes only a queued report that repeats another for the same account and hash; `pre_0021.abuse_reports` holds the rows as they were.
- 0025 only clears author ids of accounts already deleted; nothing else in it changes rows.
- 0026 changes no rows.
- A wrong OV402 is fixed in that org's `org_entitlements` row or in a new file, never by editing an applied one.

---

## 4. Preflight (SQL editor and Terminal, read only; the SQL blocks first in section 0, then all of it again on push day)

**4.1 Migration history, and the preflight script.**

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

- **You should see:** exactly the 20 rows in `supabase/production-history.tsv` at the checked-out commit (the table under "Where things stand"), in order, each name matching.
- **Stop if** any row differs from that file: a missing row, an extra row, or another name. Hand the full output to Claude.
- **Stop if** any row 0021 or above exists. Something pushed without you (re-check 2.2b).
- **Push day only (after 2.3):** download the result as CSV (the editor's export button) to, for example, `~/Downloads/production.csv`. Then, in the Terminal window, from `oscode-main`:

  ```
  node supabase/scripts/push-preflight.mjs ~/Downloads/production.csv
  ```

  It connects to nothing. **You should see:** `Preflight passed`, and the six files 0021 to 0026 as the list the dry run must show. **Stop if** it prints `STOP`: it refuses unless the checkout is `main` at `origin/main` with a clean tree, the CSV equals `production-history.tsv` exactly, and every applied file matches its pinned hash.
- **The Vault secret** that production's 0019 reads. Never select the decrypted value.

  ```sql
  select count(*) from vault.secrets where name = 'guardrail_hmac_key';
  ```

  **Pass:** `1`. **Stop if** `0`: guardrail inserts already fail in production, and that is a separate fix (the README's 0019 section) before any push.
- **For every file the history does not list, check for leftovers made by hand:**
  ```sql
  select
    to_regclass('public.org_vault_revisions') as r0021_revisions,
    to_regclass('public.org_vault_rev_seq') as r0021_rev_seq,
    to_regclass('public.org_vault_notes_live_lower_idx') as r0021_lower_idx,
    to_regclass('public.enforcement_tombstones') as r0022_tombstones,
    to_regclass('public.abuse_reports_user_hash_idx') as r0022_report_idx,
    to_regclass('public.org_storage_usage') as r0023_storage,
    to_regclass('public.org_vault_settings') as r0025_settings,
    to_regclass('public.org_vault_revisions_updated_by_idx') as r0025_author_idx,
    (select string_agg(conname, ', ' order by conname)
       from pg_constraint
      where conname in ('org_vault_revisions_updated_by_fkey',
                        'org_vault_settings_updated_by_fkey')) as r0025_keys,
    (select string_agg(distinct p.proname, ', ' order by p.proname)
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('org_vault_lock', 'enforcement_email_key', 'account_deletion_hold',
                          'account_deletion_orgs', 'account_deletion_tombstone',
                          'account_deletion_memberships', 'org_is_entitled',
                          'org_storage_track', 'org_vault_move', 'org_vault_entitled')) as functions,
    (select string_agg(tgname, ', ' order by tgname)
       from pg_trigger
      where tgname in ('org_free_owned_cap', 'org_vault_notes_storage',
                       'org_vault_revisions_storage')) as triggers,
    case when to_regclass('cron.job') is not null then
      (xpath('/row/line/text()', nullif(query_to_xml(
        $q$select position('enforcement_tombstones' in command) > 0 as line
             from cron.job where jobname = 'oscode_guardrail_retention'$q$,
        false, true, '')::text, '')::xml))[1]::text
    end as r0026_tombstone_line;
  ```
  - The `r00NN_` prefix names the file. In `functions`, `org_vault_lock` is 0021's, `enforcement_email_key` and the four `account_deletion_` functions are 0022's, `org_is_entitled` and `org_storage_track` are 0023's, `org_vault_move` is 0024's, and `org_vault_entitled` is 0025's. Every name in `triggers` is 0023's.
  - The last column reads `cron.job` only when pg_cron is installed, so the query runs either way.
  - **Pass:** every other column is NULL, and `r0026_tombstone_line` is `false` or NULL. `false`: production's retention job (0019's) has no tombstone line yet. NULL: there is no pg_cron or no retention job; that passes here too, and 5.1 and 5.2 say what to do about it.
  - **Stop if** any other column is filled in, or `r0026_tombstone_line` is `true`, because `if not exists` would silently keep a leftover. Hand it to Claude.

**4.2 Case duplicates (0021).** The README's query (0021 section, Preflight: case duplicates) with a tie-break added, so the first path shown is exactly the one 0021 keeps (0021 lines 169-172), and a path check, because a path that fails `org_vault_path_ok` makes 0021 roll back (0021 lines 123-150):

```sql
select org_id, lower(path) as folded, count(*) as notes,
       array_agg(path order by updated_at desc, path) as paths,
       bool_and(public.org_vault_path_ok(path)) as all_paths_ok
from public.org_vault_notes
where not deleted
group by org_id, lower(path)
having count(*) > 1
order by org_id, folded;
```

- **Pass:** no rows ("No rows means 0021 changes no data", same README section).
- **If there are rows, preferred:** have the owners rename or merge those notes in the app, then re-run until there are none.
- **If you go ahead with rows anyway:**
  - CI's `sql-replay` job already renames case-duplicate rows on every run and checks the result. For your exact shapes, ask Claude to rehearse on a local stack: drop `org_vault_notes_live_lower_idx`, insert case-duplicate paths shaped like your output with made-up bodies, re-run 0021 lines 158-199, and show the renamed paths and revision rows.
  - Save the output and write down N, the sum of (notes minus 1).
  - The first path in `paths` keeps its name. Each other one moves to "<name> (conflict YYYY-MM-DD HHMM).md" and leaves a revision row (0021 lines 158-195).
  - Tell the owners: a build in the field that still has an old path open gets a permanent "Not saved" on its next save, because the put refuses a name that differs only by case (0021 line 446, 0025 line 632). The text stays in the editor. Reopen the note under its new name before editing.
- **Stop if:** any row has `all_paths_ok = false`. Fix that path with its owner first.

**4.3 Teams that become read-only when 0025 lands:**

```sql
select e.org_id, o.name, u.email as owner_email, e.status, e.valid_until,
       (select count(*) from public.org_vault_notes n
         where n.org_id = e.org_id and not n.deleted) as live_notes
from public.org_entitlements e
join public.orgs o on o.id = e.org_id
left join auth.users u on u.id = o.owner_uid
where not (e.status in ('active', 'trialing')
           and (e.valid_until is null or e.valid_until > now()))
order by live_notes desc;
```

- **Pass:** no rows, or only teams you accept as read-only. The CFO and CTO ruling of 2026-09-27 says a lapsed paid row is read-only with export (DECISIONS, the M7 entry). An org with no entitlement row keeps writing (0025 lines 131-148) until `no_entitlement_vault_until()` (lines 118-124), which is null in the beta.
- **`past_due` rows need a decision.** Those are paying customers inside Stripe's retry window (0001 line 38). Only `active` and `trialing` count (0025 lines 137-143, and `supabase/functions/_shared/entitlement.ts` line 16).
- **What those teams will see:** OV402 on every save, delete and move, builds in the field included (raised at 0025 lines 152-164; called by the write at line 334, the remove at 425, the move at 489, the legacy put at 624 and the legacy delete at 687). They can still read and export every note.
- **If a listed team has live notes and you want to tell them first,** tell them, wait, then do the one push as planned. (Holding 0025 back would need a push of 0021 to 0024 from a commit without 0025 and 0026; ask Claude before choosing it.)

**4.4 abuse_reports (0022).** From the README (Migrations 0022 and 0023, step 1), verbatim. Production's 0019 already keyed every unsubmitted hash, so a repeat below means the same content, keyed once; the queries still apply. Two separate blocks; both should return no rows:

```sql
select id, status from public.abuse_reports where request_hash !~ '^[0-9a-f]{64}$';
```

```sql
select user_id, request_hash, array_agg(status) from public.abuse_reports
 where user_id is not null group by 1, 2 having count(*) > 1;
```

- **If there are rows:** the README says 0022 "removes a queued report that repeats another for the same account and hash, and never one an operator acted on. If rows remain, it prints a NOTICE and leaves the new check unvalidated or the unique index uncreated; fix the rows by hand and re-run that block." Do that fix with Claude before the push, so 8.6 passes cleanly.

**4.5 Free caps (0023). For information; these two queries are mine, not the README's.** 0023 caps every org without a live plan, beta teams with no entitlement row included, because its `org_is_entitled` has no beta window (0023 lines 55-68; 0025's header lines 57-59 note the difference). Nothing stored is removed: a team over the cap keeps its notes but cannot grow them, and an owner with more than one free team keeps them but cannot make another (0023 lines 23-29).

Teams within 5 MiB of the 25 MiB cap, counting note bytes (0023 also counts revision bytes, which exist only once 0021 is in):

```sql
select o.id as org_id, o.name, u.email as owner_email,
       sum(octet_length(n.body)) as note_bytes
from public.orgs o
join public.org_vault_notes n on n.org_id = o.id
left join auth.users u on u.id = o.owner_uid
where not exists (select 1 from public.org_entitlements e
                   where e.org_id = o.id
                     and e.status in ('active', 'trialing')
                     and (e.valid_until is null or e.valid_until > now()))
group by o.id, o.name, u.email
having sum(octet_length(n.body)) > 20971520
order by note_bytes desc;
```

Owners with more than one team without a plan:

```sql
select o.owner_uid, u.email as owner_email, count(*) as teams_without_plan
from public.orgs o
left join auth.users u on u.id = o.owner_uid
where not exists (select 1 from public.org_entitlements e
                   where e.org_id = o.id
                     and e.status in ('active', 'trialing')
                     and (e.valid_until is null or e.valid_until > now()))
group by o.owner_uid, u.email
having count(*) > 1;
```

- **Pass:** no rows. Rows are not a stop. Tell those owners only this: after the push, a save that grows a team past 25 MiB of free space is refused, a deleted note frees its space only when its history is cleared, about a month later, and an account without a plan cannot make a second team (0023 lines 100 and 190; the refusal says the same).

**4.6 (Optional) Tombstones the first purge will delete:**

```sql
select count(*) from public.org_vault_notes where deleted and updated_at < now() - interval '30 days';
```

For information only. Their bodies are already empty (0010 line 140).

---

## 5. Extension and dashboard settings

**5.1 pg_cron:**

```sql
select extname, extversion from pg_extension where extname = 'pg_cron';
```

- **You should see:** one row. If not, go to Dashboard, Database, Extensions, enable `pg_cron`, and re-run. 0021 and 0026 try to enable it themselves, but if that fails each skips scheduling with only a NOTICE, which the push does not show (7.2); 8.4 and 8.9 find the missing job either way.

**5.2 Existing cron jobs:**

```sql
select jobname, schedule, username, active from cron.job order by jobname;
```

- **You should see:** `oscode_guardrail_retention` at `41 3 * * *` (production's 0019) and `oscode_ledger_retention` at `17 3 * * 0` (0015), each with username `postgres`, the role the push runs as. The `username` column is new since section 0 ran on 2026-09-30, so this is its first look.
- **Stop if** `oscode_guardrail_retention` has any other username, or appears twice. pg_cron lets a role re-schedule only its own jobs, so 0026 stops on it (naming the owner) with 0021 to 0025 already applied. Hand the output to Claude before any push.
- **If `oscode_guardrail_retention` is missing,** pg_cron was off when 0019 ran in September. Turn it on at 5.1; 0026 schedules the whole job (with its tombstone line), so nothing else is needed. If `oscode_ledger_retention` is missing, 0015's cron block needs a re-run later; that does not block this push.

Nothing else is needed. Production's 0019 (applied) reads the Vault secret `guardrail_hmac_key` on every guardrail insert (4.1 checks it is there); none of 0021 to 0026 reads or writes a Vault secret, and the push itself must not either, so `config.toml` has no `[db.vault]` section and every push carries `--skip-vault`. 0022 hashes with the built-in `sha256()` (lines 133-148). There is no `supabase/roles.sql`.

---

## 6. Look at what will be pushed (same Terminal window)

**6.0 Check the window:**

```
pwd
cat supabase/.temp/project-ref
git log -1 --format='%h %s'
env | grep '^SUPABASE_'
type sb
```

- **You should see:** a `pwd` ending in `oscode-main`; `lzlrlfdffwiypzreoldb`; the commit from 2.3; nothing from `env`; `sb` as an alias with `supabase@2.118.0 --agent no`.
- **Stop if:** anything differs. Re-do 2.1 and `cd` into the folder.

**6.1 List local and remote migrations:**

```
sb migration list --linked
```

- **You should see:** rows in ascending order. 0001 to 0020 have both Local and Remote, with the privacy names at 0019 and 0020. At the bottom, Local-only rows for exactly 0021, 0022, 0023, 0024, 0025 and 0026.
- **Stop if:** any row is Remote only, or a Local-only row sits above (has a lower number than) the last row with Remote filled in.

**6.2 Dry run:**

```
sb db push --linked --dry-run --skip-vault
```

- **You should see:** `DRY RUN: migrations will *not* be pushed to the database.`, then `Would push these migrations:` and exactly these six, in this order, the same list 4.1's script printed: `0021_org_vault_v1.sql`, `0022_account_deletion.sql`, `0023_org_free_caps.sql`, `0024_org_vault_move.sql`, `0025_org_vault_settings.sql`, `0026_export_and_retention.sql`.
- **Stop if:** the list is anything else, including a missing file or one out of order, or you see "Remote migration versions not found in local migrations directory" or "Found local migration files to be inserted before the last migration on remote database". Never add `--include-all`.

---

## 7. The push

**7.1 Last checks (SQL editor, just before the push).** Do 3.2 now. Then:

```sql
select pid, usename, state, now() - xact_start as age, left(query, 80) as query
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid()
  and backend_type = 'client backend'
  and (state like 'idle in transaction%'
       or (state = 'active' and now() - xact_start > interval '30 seconds'));
```

- **Pass:** no rows. A session left open in a transaction would make 0021's rewrite or 0025's key changes wait, and every save, read and sign-in would queue behind them.
- **If there are rows,** wait a few minutes and re-run. If they are Supabase's own services, hand them to Claude before you decide. Not verified here: what those services show.

**7.2 Push.** Run it yourself in Terminal, not through Claude Code, a script or a pipe.

```
sb db push --linked --skip-vault
```

- **You should see:** `Do you want to push these migrations to the remote database? [Y/n]` with the same list as 6.2. Read it, type `y`, press Enter. The default is Yes, so Enter alone also pushes. Never add `--yes`, `--output-format`, `--include-all`, `--include-seed` or `--include-roles`, and never drop `--skip-vault`.
- Then `Applying migration 0021_org_vault_v1.sql...` and the same for each other file, ending with `Finished supabase db push.`
- The push prints no NOTICE, even when a file raises one (2.118.0 does not show them; checked on the local replay, where 0021 renamed a note and the output was only the `Applying migration` lines). The checks stand in for them: 8.5 counts 0021's renames, 8.4 and 8.9 find a cron job that pg_cron being off kept from scheduling, and 8.6 shows 0022's `abuse_reports` check or index missing if 4.4 was not clean.
- **If it hangs for more than a minute** on any file, do not press Ctrl-C. Run the lock query from section 10. If the blocker is a session `idle in transaction`, end it with `select pg_terminate_backend(<its pid>);`. Otherwise hand the output to Claude.
- **If it fails:** copy all the output and re-run 4.1's query. Each file applies as one transaction with its history row, and the push stops at the first failure (verified locally, see "Facts").
  - Production then has nothing new applied, or the files up to one of 0021, 0022, 0023, 0024 or 0025.
  - Each of these is safe for builds in the field: they use only plain selects plus `org_vault_put` and `org_vault_delete`, and 0021 and 0025 keep both signatures (0021 lines 411-521, 0025 lines 596-708). With 0024 in and 0025 not, `org_vault_move` is callable without the plan gate, but nothing calls it. With 0025 in and 0026 not, Download my data is still version 1 and the retention job has no tombstone line; the next push adds both. Not verified here: every partial state against each build in the field.
  - In sections 8 and 9, skip the checks for files not applied; they will fail and are not new faults.
  - Do not start step 3.
  - Hand the output to Claude. Once the cause is fixed, run 6.2 again and push again from the same window; it applies only the rest. A file not yet applied may still be corrected; one already in the history is frozen, and any fix to it is a new file.
- **A unique violation on `org_vault_notes_live_lower_idx`** means a build in the field created a case duplicate during the push. That file rolled back. Re-run 4.2 and push again.

**7.3 Record PUSH_TIME.** After `Finished supabase db push.`, run `select now();` in the SQL editor and write it down.

**7.4 Deploy main's `delete-account` (closure memo; package C).** Only after `Finished supabase db push.` with all six files applied (8.1 can wait until after this step). This deploys the function as merged on `main`, the review fixes from PR #2 included: it deletes the owned teams all or none over every team named, then copies the legal hold, then the rest (the README's "What main's `delete-account` does"). Main's function calls 0022's four `account_deletion_` functions and clears `org_vault_revisions.updated_by` (0021), so it must never run before the push. Until this step, and forever if you skip it, the privacy branch's 2026-09-24 function keeps working after 0021 to 0026: its tables still exist, and the one new write its deletion causes (the set-null 0025 puts on a revision's author) is the one update 0022's trigger allows. That holds only if 0.2 found the 2026-09-24 deployment.

```
sb functions deploy delete-account --use-api
```

- Name the function every time: without a name the CLI deploys every function in the folder. Never add `--prune` (it deletes functions production has that the folder lacks) or `--no-verify-jwt` (`config.toml` keeps `verify_jwt = true` for it). `--use-api` bundles on Supabase's side, so Docker is not needed (read in the 2.118.0 help, not run against a project).
- **You should see:** the CLI report `delete-account` deployed to `lzlrlfdffwiypzreoldb`, and in the Dashboard, Edge Functions, `delete-account`, a last deployed time of today. Not verified here: the CLI's exact words.
- **Check which function answers, deleting nothing.** Call it with the project's `anon` key and no signed-in user. Use the legacy `anon` key, the JWT that starts with `eyJ` (Dashboard, Project Settings, API Keys; the same public key the app ships as `VITE_SUPABASE_ANON_KEY`); a gateway answer about an invalid JWT means you used another key:

  ```
  curl -sS -X POST https://lzlrlfdffwiypzreoldb.supabase.co/functions/v1/delete-account \
    -H "Authorization: Bearer <anon key>" -H "apikey: <anon key>"
  ```

  **Pass:** `{"error":"unauthorized"}`, main's answer when no user signs the request. `{"error":"Sign in first.","code":"not_signed_in"}` is the 2026-09-24 function, so the deploy did not take; run it again. Read in both functions' code, not run against production.
- **What changes for people deleting an account:** the 2026-09-24 function's ten-minute re-sign-in check, its choice to delete a team that still has members, and its refunds are gone until the privacy branch's own PR brings them back (founder decisions F2 and F3). A person who owns a team with anyone else active gets "One step first" (`owns_org`) and emails support@openshore.ai (F1). Builds from `main` with package C read either function's answers; a `main` build from before package C reads this function's `{ ok: true, deleted: true }` as the success it is.
- **If the deploy fails:** nothing changed; the 2026-09-24 function still answers. Hand the output to Claude, and go on to section 8 either way.
- **If the push stopped partway (7.2):** do not deploy. Deploy once a later push has applied all six.

**Compatibility window: pushing now and merging PR #1 later is safe.**

- Builds from v0.1.45 (48593b9) on hide the team vault unless the build is tier 4: `teamVaultAvailable` checks `featureOn('teams')`, and `teams` is 4 in `focus.ts`. Nothing in `codemagic.yaml` or the workflows sets `VITE_RELEASE_TIER`; the Codemagic group is not visible from the repo.
- Every build keeps working through the legacy RPCs. What people see change:
  - A note whose name differs from another only by letter case is refused, including an old path 0021 renamed (see 4.2).
  - `size` now counts bytes.
  - The teams from 4.3 get OV402, `past_due` ones included.
  - The teams from 4.5 cannot grow past the free caps.
  - Deleting an account clears its id from team history and settings: the 2026-09-24 function by 0025's keys, main's function (after 7.4) by its own history clear as well.
  - The enforcement ladder records rows for the first time, and its warning names support@openshore.ai.
  - Download my data (for a build that calls it) gains six keys and reports version 2.
  - Saves and sign-ins are briefly slow or time out while 0021 and 0025 hold their locks.

---

## 8. Verify (SQL editor)

**8.1 History:**

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

- **Pass:** 26 rows: the 20 from 4.1, then `0021 org_vault_v1`, `0022 account_deletion`, `0023 org_free_caps`, `0024 org_vault_move`, `0025 org_vault_settings`, `0026 export_and_retention`. `sb migration list --linked` should show them on both sides.

**8.2 The vault objects (0021, 0024, 0025):**

```sql
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace
     and relname in ('org_vault_revisions', 'org_vault_settings', 'org_vault_rev_seq',
                     'org_vault_revisions_updated_by_idx')) as new_objects,
  (select generation_expression from information_schema.columns
     where table_schema = 'public' and table_name = 'org_vault_notes' and column_name = 'size') as size_expr,
  (select indexdef from pg_indexes
     where schemaname = 'public' and indexname = 'org_vault_notes_live_lower_idx') as lower_idx,
  (select indexdef from pg_indexes
     where schemaname = 'public' and indexname = 'org_vault_revisions_updated_by_idx') as author_idx,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('org_vault_write', 'org_vault_remove', 'org_vault_move', 'org_vault_put',
                     'org_vault_delete', 'org_vault_settings_get', 'org_vault_settings_put',
                     'org_vault_purge')) as rpcs,
  (select bool_and(prosrc like '%can still rename%' and prosrc like '%org_vault_require_entitled%')
     from pg_proc where pronamespace = 'public'::regnamespace
      and proname = 'org_vault_move') as move_ok,
  public.no_entitlement_vault_until() as deadline;
```

- **Pass:**
  - `new_objects` is 4;
  - `size_expr` is `octet_length(body)`;
  - `lower_idx` ends with `(org_id, lower(path)) WHERE (NOT deleted)`;
  - `author_idx` ends with `(updated_by) WHERE (updated_by IS NOT NULL)`;
  - `rpcs` is 8;
  - `move_ok` is `t` (the move writes its history copy last and carries the plan gate);
  - `deadline` is NULL.
- **Stop if:** `rpcs` is more than 8 (a leftover overload), `move_ok` is not `t`, or an index has a different definition.

**8.3 Who can call the new functions:**

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('org_vault_write', 'org_vault_remove', 'org_vault_move',
                    'org_vault_settings_get', 'org_vault_settings_put', 'org_vault_entitled',
                    'org_vault_purge', 'org_vault_require_entitled',
                    'org_vault_require_may_delete', 'org_vault_is_admin',
                    'enforcement_email_key', 'org_is_entitled', 'org_storage_track',
                    'enforce_free_owned_orgs', 'export_my_data', 'account_deletion_hold',
                    'account_deletion_orgs', 'account_deletion_tombstone',
                    'account_deletion_memberships')
order by 1;
```

- **Pass:** 19 rows.
  - f, t: `export_my_data`, `org_vault_entitled`, `org_vault_move`, `org_vault_remove`, `org_vault_settings_get`, `org_vault_settings_put`, `org_vault_write`.
  - f, f: `account_deletion_hold`, `account_deletion_memberships`, `account_deletion_orgs`, `account_deletion_tombstone`, `enforce_free_owned_orgs`, `enforcement_email_key`, `org_is_entitled`, `org_storage_track`, `org_vault_is_admin`, `org_vault_purge`, `org_vault_require_entitled`, `org_vault_require_may_delete`.
- The grants are in 0021 lines 576-590, 0022 line 149 and the end of its section 6 (the four `account_deletion_` functions are the service role's alone), 0023 lines 70 and 197-198, 0024 lines 185-186, 0025 lines 714-723, and 0026's export block.

**8.4 The purge job:**

```sql
select jobname, schedule, btrim(command) as command, username, active from cron.job where jobname = 'oscode_vault_purge';
```

- **Pass:** schedule `29 3 * * 0`, command `select public.org_vault_purge();`, username `postgres`, active `t`. Without `btrim`, the stored command has a space at each end (0021 line 567). The username is `postgres` locally; on production it is not verified here.
- **If there is no row, or `cron.job` does not exist:** do 5.1, then run 0021's block (lines 553-572) exactly as written, and re-run this check:
  ```sql
  do $$
  begin
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron could not be enabled here (%). Enable it in the dashboard, then re-run this block.', sqlerrm;
    end;
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      if exists (select 1 from cron.job where jobname = 'oscode_vault_purge') then
        perform cron.unschedule('oscode_vault_purge');
      end if;
      perform cron.schedule(
        'oscode_vault_purge',
        '29 3 * * 0',
        $job$ select public.org_vault_purge(); $job$
      );
    else
      raise notice 'pg_cron is not installed; the vault purge was not scheduled (see supabase/README.md).';
    end if;
  end $$;
  ```

**8.5 The case-duplicate rename:**

```sql
select count(*) from public.org_vault_revisions where reason = 'renamed';
```

- **Pass:** at least N from 4.2 (0 if 4.2 had no rows); it can be higher if a build in the field made a new duplicate after 4.2. Then re-run 4.2; it must return no rows.

**8.6 Account deletion (0022 and 0025 section 10).** Two blocks. The author columns:

```sql
select t.tbl, t.col,
       (select string_agg(c.confdeltype::text
                          || case when c.convalidated then '' else ' (not valid)' end, ',')
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.conrelid = format('public.%I', t.tbl)::regclass
           and c.contype = 'f'
           and c.confrelid = 'auth.users'::regclass
           and a.attname = t.col) as on_delete
from (values ('org_members', 'invited_by'), ('org_vault_notes', 'updated_by'),
             ('org_projects', 'created_by'), ('org_projects', 'updated_by'),
             ('org_project_members', 'granted_by'),
             ('org_vault_revisions', 'updated_by'), ('org_vault_settings', 'updated_by'))
     as t (tbl, col);
```

- **Pass:** seven rows, each `on_delete` exactly `n` (set null, validated). The first five were already set null by production's 0019 (lines 58-81) and 0022 confirms them by catalog (lines 60-110); the last two are 0025's (lines 748-793).

The rest of 0022:

```sql
select
  (select string_agg(column_name || ' ' || is_nullable, ', ' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'enforcement_tombstones') as tombstone_columns,
  (select string_agg(pg_get_constraintdef(oid), ', ')
     from pg_constraint
    where conrelid = 'public.enforcement_tombstones'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%level%') as tombstone_level,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('account_deletion_hold', 'account_deletion_orgs',
                      'account_deletion_tombstone', 'account_deletion_memberships')) as deletion_functions,
  (select convalidated from pg_constraint
    where conrelid = 'public.abuse_reports'::regclass
      and conname = 'abuse_reports_request_hash_check') as hash_check_valid,
  to_regclass('public.abuse_reports_user_hash_idx') is not null as report_idx;
```

- **Pass:** `email_sha256 NO, level NO, terminated_at NO`; `CHECK ((level = 2))`; `4`; `t`; `t`. An `f` in the last two means 4.4 was not clean (0022's section 5); hand it to Claude.

**8.7 Free caps (0023).** Two blocks. The objects:

```sql
select
  to_regclass('public.org_storage_usage') is not null as storage_usage,
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgname in ('org_free_owned_cap', 'org_vault_notes_storage',
                     'org_vault_revisions_storage')) as cap_triggers,
  public.no_entitlement_max_owned_orgs() as free_teams,
  public.no_entitlement_max_org_bytes() as free_bytes;
```

- **Pass:** `t`, `3`, `1`, `26214400`.

The backfill matches what is stored (0023 lines 212-222):

```sql
select count(*) as mismatched
from (select org_id, sum(bytes) as bytes
        from (select org_id, octet_length(body)::bigint as bytes from public.org_vault_notes
              union all
              select org_id, octet_length(body)::bigint from public.org_vault_revisions) s
       group by org_id) stored
full join public.org_storage_usage u using (org_id)
where coalesce(stored.bytes, 0) <> coalesce(u.bytes, 0);
```

- **Pass:** 0.

**8.8 Download my data (0026):**

```sql
select
  position('''version'', 2,' in prosrc) > 0 as version_2,
  (select count(*) from unnest(array['org_vault_revisions_authored', 'org_vault_settings_updated',
                                     'enforcement_tombstone', 'review_staff', 'push_sends',
                                     'likeness_consents']) k
    where position('''' || k || '''' in prosrc) > 0) as new_keys,
  position('email_sha256''' in prosrc) = 0 as no_hash_key
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'export_my_data';
```

- **Pass:** one row: `t`, `6`, `t`.

**8.9 The retention job's tombstone line (0026).** It reads `cron.job` only when pg_cron is installed, so it runs either way:

```sql
with j as (
  select case when to_regclass('cron.job') is not null then nullif(query_to_xml(
    $q$select schedule, username, active,
              position('delete from public.enforcement_tombstones where terminated_at < now() - interval ''2 years'';' in command) > 0 as tombstone_line,
              position('delete from public.deletion_holds where hold_until <= now();' in command) > 0 as holds_line
         from cron.job where jobname = 'oscode_guardrail_retention'$q$,
    false, true, '')::text, '')::xml end as x
)
select to_regclass('cron.job') is not null as pg_cron,
       (xpath('/row/schedule/text()', x))[1]::text as schedule,
       (xpath('/row/username/text()', x))[1]::text as username,
       (xpath('/row/active/text()', x))[1]::text as active,
       (xpath('/row/tombstone_line/text()', x))[1]::text as tombstone_line,
       (xpath('/row/holds_line/text()', x))[1]::text as holds_line
from j;
```

- **Pass:** `t`, `41 3 * * *`, `postgres`, `true`, `true`, `true`.
- **If `pg_cron` is `f`, or the other five are empty:** pg_cron was not on when 0026 ran, or the job is missing. Do 5.1, then run 0026's retention block exactly as written (the `do $$ ... $$;` at the end of `0026_export_and_retention.sql`), and re-run this check.

**8.10 The ladder's address (0022):**

```sql
select position('write to support@openshore.ai.' in prosrc) > 0 as ruled_address,
       position('os-code@openshorellc.com' in prosrc) = 0 as no_old_address,
       position('enforcement_tombstones' in prosrc) > 0 as reads_tombstones
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'record_enforcement';
```

- **Pass:** one row: `t`, `t`, `t`.

---

## 9. Smoke test (SQL editor; keeps nothing)

This block makes a throwaway team and runs 25 checks across 0021 and 0022 to 0025. Then it raises an error on purpose, so everything rolls back. The only lasting effect is that the rev and revision-id sequences move forward, which is harmless.

It follows the pgTAP fixture pattern (`org_vault.test.sql` lines 21-53). It was run through psql as `postgres` on 2026-09-29, and again on 2026-09-30 after the review fixes, on a local stack that replays production: production's 20 files, the rows in `supabase/replay/production_rows.sql`, then 0021 to 0026 through `db push --local --skip-vault`. It printed `SMOKE PASSED: 25 checks held`, and afterwards no smoke org, user, note, revision, action or tombstone was left. So a `FAIL` here means production differs from the files.

What each number checks: 1 to 7, 0021's guarded writes, legacy pair and history; 8 and 14, 0024's move (14 is a member's move under admins-only delete); 9 to 13, 16 and 17, 0025's settings, OV403 and OV402; 15, 21 and 22, 0022's ladder and the history's author rule; 18 and 19, 0023's byte total and the one-free-team cap; 20, 0025's author keys (deleting an account keeps its history rows and clears its id); 23 to 25, the functions main's `delete-account` calls (0022 section 6: the team delete is all or none while anyone else is active, an operator's termination leaves a tombstone at its own time, and the person's membership goes).

```sql
do $smoke$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  r jsonb;
  base bigint;
  code text;
  n bigint;
begin
  insert into auth.users (id, email, email_confirmed_at, aud, role) values
    (a, 'smoke-a-' || a || '@example.invalid', now(), 'authenticated', 'authenticated'),
    (b, 'smoke-b-' || b || '@example.invalid', now(), 'authenticated', 'authenticated');
  insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
    values (o, 'Smoke (rolled back)', a, 2, 'personal');
  insert into public.org_members (org_id, user_id, email, role, status) values
    (o, a, 'smoke-a-' || a || '@example.invalid', 'admin', 'active'),
    (o, b, 'smoke-b-' || b || '@example.invalid', 'member', 'active');

  -- A, the admin (0021)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.org_vault_write(o, 'Smoke/Hello.md', 'one', null, true);
  if r->>'ok' is distinct from 'true' then raise exception 'FAIL 1 create: %', r; end if;
  base := (r->>'rev')::bigint;
  if base < 1000000000 then raise exception 'FAIL 2 rev % is not from the new sequence', base; end if;
  r := public.org_vault_write(o, 'smoke/hello.md', 'two', null, true);
  if r->>'conflict' is distinct from 'exists' then raise exception 'FAIL 3 case-only duplicate: %', r; end if;
  perform public.org_vault_put(o, 'Smoke/Legacy.md', 'field build', null);
  perform public.org_vault_delete(o, 'Smoke/Legacy.md');
  if not exists (select 1 from public.org_vault_notes
                 where org_id = o and path = 'Smoke/Legacy.md' and deleted)
    then raise exception 'FAIL 4 legacy put and delete'; end if;

  -- B, a member (0021, 0024, 0025)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := public.org_vault_write(o, 'Smoke/Hello.md', 'from b', base - 1, false);
  if r->>'conflict' is distinct from 'changed' then raise exception 'FAIL 5 stale write: %', r; end if;
  r := public.org_vault_write(o, 'Smoke/Hello.md', 'from b', base, false);
  if r->>'ok' is distinct from 'true' then raise exception 'FAIL 6 guarded write: %', r; end if;
  if not exists (select 1 from public.org_vault_revisions
                 where org_id = o and reason = 'overwritten' and body = 'one')
    then raise exception 'FAIL 7 no revision row'; end if;
  r := public.org_vault_move(o, 'Smoke/Hello.md', 'Smoke/Moved.md', (r->>'rev')::bigint);
  if r->>'ok' is distinct from 'true' then raise exception 'FAIL 8 move: %', r; end if;
  r := public.org_vault_remove(o, 'Smoke/Moved.md', (r->>'rev')::bigint);
  if r->>'ok' is distinct from 'true' then raise exception 'FAIL 9 remove: %', r; end if;
  r := public.org_vault_settings_get(o);
  if r->>'entitled' is distinct from 'true' or r->>'delete_role' is distinct from 'member'
     or r->>'is_admin' is distinct from 'false'
    then raise exception 'FAIL 10 settings_get: %', r; end if;
  begin
    perform public.org_vault_settings_put(o, '{}'::jsonb, 'admin', null, 0);
    code := 'none';
  exception when others then code := sqlerrm;
  end;
  if code not like 'only admins%' then raise exception 'FAIL 11 member changed settings: %', code; end if;

  -- A turns on admins-only delete (0025)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := public.org_vault_settings_put(o, '{}'::jsonb, 'admin', null, 0);
  if r->>'ok' is distinct from 'true' then raise exception 'FAIL 12 admin settings put: %', r; end if;
  r := public.org_vault_write(o, 'Smoke/Keep.md', 'keep', null, true);
  base := (r->>'rev')::bigint;

  -- B may not delete under admins-only, but may still move (0025)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform public.org_vault_remove(o, 'Smoke/Keep.md', base);
    code := 'none';
  exception when others then code := sqlstate;
  end;
  if code is distinct from 'OV403' then raise exception 'FAIL 13 admins-only delete gave %', code; end if;
  r := public.org_vault_move(o, 'Smoke/Keep.md', 'Smoke/Kept.md', base);
  if r->>'ok' is distinct from 'true' then raise exception 'FAIL 14 member move under admins-only: %', r; end if;

  -- The enforcement ladder records again (0022)
  select x.action into code from public.record_enforcement() x;
  if code is distinct from 'log-only' then raise exception 'FAIL 15 record_enforcement gave %', code; end if;

  -- a lapsed plan: read-only, still readable (0025)
  reset role;
  insert into public.org_entitlements (org_id, tier_id, seats, status)
    values (o, 'commercial_small', 2, 'canceled');
  set local role authenticated;
  begin
    perform public.org_vault_write(o, 'Smoke/Late.md', 'late', null, true);
    code := 'none';
  exception when others then code := sqlstate;
  end;
  if code is distinct from 'OV402' then raise exception 'FAIL 16 lapsed write gave %', code; end if;
  if not exists (select 1 from public.org_vault_notes
                 where org_id = o and path = 'Smoke/Kept.md' and not deleted)
    then raise exception 'FAIL 17 lapsed team cannot read'; end if;
  reset role;

  -- The free caps (0023): bytes are counted, and one free team per owner
  select coalesce(sum(octet_length(body)), 0) into n from (
    select body from public.org_vault_notes where org_id = o
    union all
    select body from public.org_vault_revisions where org_id = o) s;
  if n = 0 or n is distinct from (select bytes from public.org_storage_usage where org_id = o)
    then raise exception 'FAIL 18 storage total % is not counted', n; end if;
  begin
    insert into public.orgs (id, name, owner_uid, seat_count, tier_id)
      values (gen_random_uuid(), 'Smoke second (rolled back)', a, 1, 'personal');
    code := 'none';
  exception when others then code := sqlerrm;
  end;
  if code not like 'an account without a plan can own one team%'
    then raise exception 'FAIL 19 second free team gave %', code; end if;

  -- The deletion's team delete is all or none while anyone else is active
  -- (0022 section 6b): b is active in a's team, so nothing is deleted.
  if cardinality(public.account_deletion_orgs(a, array[o])) <> 0
    then raise exception 'FAIL 23 a team with an active member was deleted'; end if;
  if not exists (select 1 from public.orgs where id = o)
    then raise exception 'FAIL 23 the team is gone'; end if;

  -- Deleting an account keeps its history and clears its id (0025 section 10)
  if not exists (select 1 from public.org_vault_revisions where org_id = o and updated_by = b)
    then raise exception 'FAIL 20 no revision by b to test'; end if;
  select count(*) into n from public.org_vault_revisions where org_id = o;
  delete from auth.users where id = b;
  if exists (select 1 from public.org_vault_revisions where updated_by = b)
     or n is distinct from (select count(*) from public.org_vault_revisions where org_id = o)
    then raise exception 'FAIL 20 deleting an account lost or kept history'; end if;

  -- History may lose its author, never its body (0022)
  update public.org_vault_revisions set updated_by = null
    where org_id = o and updated_by is not null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'FAIL 21 no revision author to clear'; end if;
  begin
    update public.org_vault_revisions set body = 'changed' where org_id = o;
    code := 'none';
  exception when others then code := sqlerrm;
  end;
  if code not like '%append-only%' then raise exception 'FAIL 22 a revision body changed: %', code; end if;

  -- The deletion's tombstone and memberships (0022 sections 6c and 6d): an
  -- operator's termination of a leaves a level 2 tombstone at that
  -- termination's own time, and a's membership goes.
  insert into public.enforcement_actions (user_id, level, action, reason, actor, created_at)
    values (a, 2, 'terminate', 'Smoke (rolled back).', 'smoke-operator', now() - interval '5 days');
  if not public.account_deletion_tombstone(a)
    then raise exception 'FAIL 24 an operator''s termination left no tombstone'; end if;
  if (select terminated_at from public.enforcement_tombstones
       where email_sha256 = public.enforcement_email_key('smoke-a-' || a || '@example.invalid'))
     is distinct from (select created_at from public.enforcement_actions
                        where user_id = a and actor = 'smoke-operator')
    then raise exception 'FAIL 24 the tombstone does not carry the termination''s time'; end if;
  n := public.account_deletion_memberships(a);
  if n < 1 or exists (select 1 from public.org_members where user_id = a)
    then raise exception 'FAIL 25 the membership delete left a''s row'; end if;

  raise exception 'SMOKE PASSED: 25 checks held. This error is deliberate, so nothing is kept.';
end $smoke$;
```

- **Pass:** a red error that reads `SMOKE PASSED: 25 checks held...`.
- **Stop if:** you get `FAIL n`. The number names what broke; hand it to Claude.
- **Not verified here:** whether the dashboard's role may insert into and delete from `auth.users`, and whether production has triggers on `auth.users` that no migration created. If the insert is refused:
  1. Create two throwaway users under Authentication, Users, with Auto Confirm ticked so no email goes out.
  2. Put their ids in place of the two `gen_random_uuid()` values for `a` and `b`, and delete the `insert into auth.users` statement.
  3. Check 19 needs `a` to own no other team; a fresh user owns none. Check 20's delete of `b` is rolled back with the rest.
  4. Afterwards, delete both users under Authentication, Users. The rollback does not remove them.

---

## 10. What to watch

**First hour**

- Nothing calls `org_vault_move` or the settings RPCs until PR #1 merges.
- After the merge, if they return 404 or PGRST202, run `notify pgrst, 'reload schema';`. The branch client shows this case as "The team vault is being updated..." (branch `app/src/lib/gitos/orgVault.ts`).
- Do not test account deletion with a real account you want to keep. After 7.4, main's function answers `{ ok: true, deleted: true, appleNote }`, which every `main` build reads as success; a build from `main` with package C also reads the 2026-09-24 function's `{ deleted: true }` and `reauth_required` correctly, so skipping 7.4 is safe for those builds too. The device check in PROGRESS (account deletion on TestFlight) is the place to try it, with a throwaway account.

**First day.** Dashboard, Logs, Postgres. Not verified here: the exact path or search syntax.

- OV402 should appear only for the teams from 4.3.
- OV403 should appear zero times before the merge, and `select count(*) from public.org_vault_settings;` should return 0; only the branch client writes that table.
- "used its 25 MiB of free space" and "can own one team" should appear only for the teams and owners from 4.5.
- "different letter case already exists" may appear rarely; that is expected (4.2).
- The ladder now records (0022). With the PUSH_TIME from 7.3:
  ```sql
  select action, count(*) from public.enforcement_actions where created_at > 'PUSH_TIME' group by 1;
  ```
  Any `terminate` row is an account flagged for you, with a queued report that was never sent; decide it by hand.
- Writes since the push use the new sequence:
  ```sql
  select count(*) from public.org_vault_notes where updated_at > 'PUSH_TIME' and rev < 1000000000;
  ```
  Pass: 0.
- Lock waits:
  ```sql
  select pid, wait_event, pg_blocking_pids(pid) as blocked_by, now() - query_start as waiting, left(query, 120)
  from pg_stat_activity where wait_event_type = 'Lock';
  ```
  Pass: empty.

**First retention run.** The next day at 03:41 UTC, and the first Sunday after the push at 03:29 UTC for the purge (2026-10-04 if you push this week).

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname in ('oscode_guardrail_retention', 'oscode_vault_purge')
order by d.start_time desc limit 10;
```

- **Pass:** `succeeded`.
- Once you are satisfied, run `drop schema pre_0021 cascade;`. It holds note bodies and abuse reports.

---

## 11. Step 3: hand-off to Claude

The migrations must land before PR #1 merges, because the branch client calls `org_vault_write`, `org_vault_remove`, `org_vault_move` and `org_vault_settings_get`/`_put`. After that the merge can wait: builds in the field use the legacy RPCs, and the migrations keep them. The device checklist's team lines need a tier-4 build. A push to `main` ships to the desktops (`release.yml`, for changes under `app/**` and `os-code/**`); a TestFlight build is started by hand in Codemagic.

Keep `org_vault_put` and `org_vault_delete` until no v0.1.44-or-older build is in team use; dropping them would turn saves from those builds into permanent "Not saved" errors.

Paste this to Claude:

> Gate 1 is done. Before the push, delete-account's last deployed time was <2026-09-24 or what you saw>. At <PUSH_TIME UTC> I ran the push (CLI 2.118.0, `--linked --skip-vault`) from main at <commit from 6.0> against lzlrlfdffwiypzreoldb. Applied: 0021, 0022, 0023, 0024, 0025, 0026. Then `functions deploy delete-account --use-api` from the same commit at <time>; the anon-key call answered <paste 7.4's curl output>. push-preflight.mjs passed; the Vault secret count was 1. Section 8 passed: <paste 8.1, 8.2, 8.4, 8.6, 8.7, 8.8, 8.9 and 8.10>. Smoke test: SMOKE PASSED, 25 checks. Case-duplicate renames: <count from 8.5>. Read-only teams from 4.3: <list or none>. Teams at the free caps from 4.5: <list or none>. The guardrail retention job was <there before / scheduled by 0026>. On main, in one change: append the six rows to supabase/production-history.tsv (version, name, and the SHA-256 of each file at that commit); record in os-code/DECISIONS.md the applied date and that 0001 to 0026 are applied and never edited (any change is a new file above the newest); in os-code/PROGRESS.md What remains, mark gate 1 done, with the migration and purge-cron part of the held Vault branches item and the push-and-deploy lines of the premium build and Accounts items (iCloud, native, xcodebuild, release signing and device parts stay open), and move the closure memo's follow-ups there; in docs/vault-v1-test-map.md, say the push is done; reword supabase/README.md's Ship order to say one push from main applied 0021 to 0026. The privacy branch claude/openshore-privacy-mobile-1ij12h is harvested in packages per CTO 11 and never merged whole. Then merge the current main into vault-m2-team, vault-m2-icloud and vault-m2-native (the rename flows through), retitle draft PR #1 (it still says 0020 and 0021), and merge PR #1 into main once its check, sql, sql-replay and migrations jobs are green on the current main; tell me first if its windows job fails differently from main's latest windows run. Keep featureOn('teams') in teamVaultAvailable. Do not remove org_vault_put or org_vault_delete.

---

## Review notes

- Second review revision (2026-09-30): the Status line says packages A to C are on `main` (41bea18) and section 0 ran clean with your yes (DECISIONS, the F1 entry), and points to push day; section 0 is marked done and kept as the reference, 0.3's "until the packages land" clause is gone, and 5.2's `username` column is first seen on push day's re-run of sections 4 and 5; section 1 marks A to C done and has the review fixes (PR #2, which change the unapplied 0022 and 0026) land before push day; 2.3 checks for them (the `grep` on 0026) and stops without them; 7.4 deploys the function as merged with them.
- Package C revision (2026-09-29, closure memo): 0.2 and 2.2d check which `delete-account` is live before anything depends on it; 0.4b and 0.4c are resolved by 0022's section 6; 7.4 deploys main's merged function after a complete push, with an anon-key call that tells the two functions apart; 7.2 no longer promises NOTICE lines (2.118.0 shows none); 4.1's leftover row expects `false` in its last column on production's state, and it and 8.9 read `cron.job` only when pg_cron exists; 8.3, 8.6 and 8.8 cover the four `account_deletion_` functions, the tombstone's shape and the export's six keys; the smoke test gains checks 23 to 25 and was re-run on the replay stack (`SMOKE PASSED: 25 checks held`); pgTAP is `Files=4, Tests=295`.
- Review revision (2026-09-30): the Status line starts at section 0 now, since 0.1 comes before the landing; 0.3 runs only 4.1's SQL blocks, because `push-preflight.mjs` needs `oscode-main` (2.3, push day) and a main that holds it; 4.1's Pass line says a NULL `r0026_tombstone_line` passes; 5.2 and 8.9 show the retention job's `username`, and 5.2 stops when it is not `postgres` (0026 now stops on it too, naming the owner); section 1 names the desktop release beside TestFlight; pgTAP is `Files=4, Tests=301` (0022's all-or-none over every team named, and the export's email rows); section 8 and the smoke test were re-run on the replay stack with the same values, 8.9 now `t`, `41 3 * * *`, `postgres`, `true`, `true`, `true`.
- CTO 11 revision (2026-09-29): production's 20 rows replace "no 0020 or 0021 in production"; every "0018 missing" and "0019 already applied" branch is gone; the org vault file is 0021 throughout (its line citations are unchanged, since its bytes are); 0022 to 0025 citations re-checked after their comment edits; 4.1 gains the Vault secret check, the leftover column for 0026 and `push-preflight.mjs`; 5.2 expects the guardrail retention job; 6.1, 6.2 and 8.1 name exactly 0021 to 0026 and 26 rows; every push carries `--skip-vault`; 7.4's deploy is removed (package C); 8.8 to 8.10 are new; 0.3a is resolved in 0023, and 0.3b and 0.3c move to package C; the smoke test was re-run on the replay stack; the hand-off appends to `production-history.tsv` and no longer asks the privacy branch to renumber.
- commands, stale pgTAP count: applied (Tests=213 from run 36592050642 on 6609338; Files=4, Tests=261 with `guardrail_privacy.test.sql`; 295 with package C; now 301 with the 2026-09-30 review fixes).
- commands, verification misses 0025 section 10: applied (8.6 seven rows with the not-valid mark, 8.2 author_idx and new_objects 4, 4.1 leftover columns).
- commands, hand-off records a false follow-up: applied (sentence replaced; findings 2, 6, 7 settled as 0.4 says).
- commands, step 1 prompt predates the fix stage: superseded (step 1 is now landing package A).
- commands, 0024 and 0025 line citations: re-cited after CTO 11's comment edits.
- commands, stale CI hashes and windows failure names: applied (windows compared against main's latest windows run).
- commands, 0025 missing from the lock analysis: applied (2.5, 7.1 and the compatibility window name 0025).
- commands, no gate for open findings 2 and 6: superseded by CTO 11 and package C (0.4).
- commands, 3.2 lacks a revisions copy: moot under CTO 11 (0021 is not applied, so there are no revision rows to copy).
- commands, smoke provenance and section 10 coverage: applied (check 20; re-run on the replay stack).
- commands, README line citations move: applied (cited by section name).
- safety, merge before 2.2b and 4.3: applied (0.1 has the founder confirm 2.2b before package A reaches main).
- safety, 7.2 partial failure: applied (atomicity marked verified locally; skip checks for unapplied files, no step 3, re-run 6.2 and push again, applied files frozen).
- safety, 2.5 quiet hour: applied (0026 bullet added).
- safety, order versus README: applied (3.2 inside 7.1 after 4 to 6).
