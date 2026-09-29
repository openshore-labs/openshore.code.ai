# Runbook: gate 1 under CTO 4 (0019, 0022, 0023, 0024, 0025, all from main)

This replaces the earlier drafts (push-0019-0021 and v2). Do not use either.

**Status:** step 1 is done. `vault-team-migrations` (`cd213e6`) was merged into `main` on 2026-09-29, so an up-to-date `main` now carries 0024 and 0025. Start at section 0.

**CTO 4, as the repo records it:** migrations go to production from `main` only, never from a held branch (`supabase/README.md`, Ship order; DECISIONS, the premium build entry). `0022` and `0023` are main's. The team files are `0024_org_vault_move.sql` and `0025_org_vault_settings.sql` (written as 0020 and 0021 on the held branch).

**Where things stand (2026-09-29):**

- `main` is `bf0ac38`.
- `vault-team-migrations` is `cd213e6`: 0024, 0025, their pgTAP (`org_vault.test.sql`, `rls.test.sql`) and `supabase/README.md`, nothing else. It includes the fixes from the 2026-09-29 interaction review: 0025 section 10 keys `org_vault_settings.updated_by` and `org_vault_revisions.updated_by` to `auth.users` on delete set null, with the index `org_vault_revisions_updated_by_idx`; the move writes its history copy last, so a free team at its 25 MiB cap can still rename; and the README's Ship order step 1 checks that there is no 0020 or 0021 in production's history.
- `vault-m2-team` (draft PR #1) is `6609338`. Its `supabase/` folder is byte-identical to `vault-team-migrations`.

## The plan in three steps

1. **Claude** merges `vault-team-migrations` into `main`. You already said yes (section 1).
2. **You**, from an up-to-date `main`: preflights, backups, one push at a quiet hour, `supabase functions deploy delete-account`, then the checks and the rolled-back smoke test (sections 2 to 10).
3. **Claude** merges draft PR #1 once the push is done and its CI is green on the current `main` (section 11).

## Facts that shape the plan

- **0024 and 0025 already passed pgTAP in CI.** PR #1's `sql` job on `6609338` (run 36592050642) ended with `Files=3, Tests=213` and `Result: PASS`: 32 in `rls.test.sql`, 144 in `org_vault.test.sql`, 37 in `account_deletion.test.sql`. Main alone runs 125 (56 in its older `org_vault.test.sql`). `vault-team-migrations` has never run CI itself (CI runs on pushes to `main` and on PRs into it), but its `supabase/` folder is the same.
- **"CI is green" means the `check` and `sql` jobs.** The `windows` job is red on `main` at `bf0ac38` (run 36590234172: `test/processTools.test.ts`, EBUSY on a temp folder, an engine cleanup race with no SQL). Compare any windows failure against main's latest windows run.
- **Merging is safe for builds in the field; pushing changes what they see.** Main's app calls only `org_vault_put`, `org_vault_delete` and plain selects on `org_vault_notes` (`app/src/lib/gitos/orgVault.ts`; the one mention of a new RPC, line 221, is a comment). But 0025 re-creates `org_vault_put` and `org_vault_delete` with the plan gate (0025 lines 594-706), so once pushed, a team with a lapsed entitlement row goes read-only in every build (4.3), and 0023's caps reach every build too (4.5).
- **The files are the same on both sides.** `0019_org_vault_v1.sql` is blob `a2bee6c` on `main` and on `vault-m2-team`. Main has 0001 to 0019, 0022 and 0023; there is no 0020 or 0021 on `main`, on purpose.
- **`db push` applies every local file that production's history lacks, matching on the version number only** (read in the 2.118.0 code). Nothing in the repo records 0018 as applied, so 0018 may go out first. 0018 is not optional: 0022's `record_enforcement` calls `enforcement_window()` (0022 lines 167, 194, 200), which only 0018 creates (0018 line 42).
- **A push is one transaction per file, and it stops at the first failure.** Verified locally on 2.118.0: with a failing statement added to 0025, the push applied 0024, stopped at 0025, left the history ending at 0024, and a second push applied only 0025.
- **0019's case-duplicate rename has never run against real rows.** CI applies migrations to an empty database, and `org_vault.test.sql` never re-runs the rename block (0019 lines 158-195).
- **0022 turns on a ladder that has never recorded anything.** In 0016 to 0018, `record_enforcement` raised on every call (0022 lines 131-136). After 0022, the app's call after a blocked request records a row: a warning after one confirmed Tier 1 block, and a termination flag plus a queued, never submitted, report after a second one within 90 days (0018 lines 42-48).
- **The CLI skips its own confirmation when it thinks an AI agent is running it.** Under Claude Code it printed JSON, and its confirm helper then returns the default, Yes for `db push`. So run every `sb` command below yourself, in a Terminal window you typed into. Never through Claude.

**Ground rules**

- "SQL editor" means Dashboard, SQL Editor. Run one block at a time; the editor shows only the last result. Before each block, check that the address contains `/project/lzlrlfdffwiypzreoldb/`, since Uki is on Supabase too (README lines 3-4). If the editor offers a role picker, choose `postgres` (not verified here that it has one).
- Terminal: do every Terminal step in one macOS Terminal window and keep it open. If you open a new one, re-run 2.1 and `cd` into `oscode-main`. Always type `sb`, never `supabase`.
- Never push from `vault-m2-team` or any branch other than `main`. Never add `--include-all`. Never edit a migration that production has applied; any change is a new file numbered above the newest.

---

## 0. Look and decide first (browser only, read only)

1. **2.2b before Claude's merge reaches `main`.** Your yes to step 1 assumed it. If you have not looked yet, tell Claude to hold the merge until you have: if an integration deploys migrations when `main` changes, the merge would push 0018 to 0025 with no preflight. (0022 and 0023 have been on `main` since this morning; 4.1 shows whether anything pushed them.)
2. **In the SQL editor, run 4.1 to 4.5.**
   - 4.1 hits a stop: hand the output to Claude and do not push.
   - 4.1 shows 0018 missing: it goes out first; read 4.1 so you know what it changes.
   - 4.2 returns rows: have the owners fix those notes first, or ask Claude for the local rename rehearsal (4.2).
   - 4.3 lists teams: decide per 4.3.
   - 4.4 returns rows: fix them with Claude before any push.
   - 4.5 returns rows: tell those owners before the push (in the words 4.5 gives).
3. **Three calls from the interaction review, before push day.** They are recorded in `os-code/PROGRESS.md` (What remains) on `vault-m2-team`, so they are not visible from `main` until PR #1 merges.
   - a. **CTO, 0023's refusal copy (finding 2).** A growing save at the cap gets "start a plan or delete notes to make room" (0023 line 188), but a delete frees nothing for about 30 days: the body moves into a `deleted` revision that 0023 still counts until the weekly purge. 0023 is main's and treated as frozen, so the choice is: accept the copy for now, or ship corrected copy as a new `0026` in this push.
   - b. **Founder, the `delete-account` race (finding 6).** The function checks each owned team for other active members, then deletes the sole-member ones in a later call, so a team that gains an active member in between is erased with the account. Deploy it with that recorded race (the window is small), or first ship the one-statement service-role delete as a new `0026` in this push.
   - c. **Founder or CX, finding 7.** A deleted person's email stays in `org_project_members` and in pending `org_members` invites (the ids are cleared). It does not block the push or the deploy.
   - **If a or b adds a file,** Claude revises this runbook's file lists (2.3, 6.1, 6.2, 8.1) and the "0026 or higher" stop before push day. Do not push until it has.

On push day you run section 4 again.

---

## 1. Step 1: Claude merges `vault-team-migrations` into `main`

You already said yes. This is what Claude does, and what it reports back to you.

- Fetch, then merge `origin/vault-team-migrations` (`cd213e6`) into the current `origin/main` (`bf0ac38` or newer). It merges into `bf0ac38` with no conflict (checked with `git merge-tree`).
- Before the merge, `git diff --stat origin/main...origin/vault-team-migrations` (three dots) lists only `supabase/README.md`, the two migrations, `supabase/tests/org_vault.test.sql` and `supabase/tests/rls.test.sql`. `git diff origin/vault-team-migrations origin/vault-m2-team -- supabase` prints nothing.
- No DECISIONS or PROGRESS records go on `main` in this merge. They are already on `vault-m2-team` and arrive with PR #1; adding them on `main` too would conflict. The test map's new numbers arrive the same way.
- After the merge lands, main's CI runs. **You should see:** `sql` ending with `Files=3, Tests=213` and `Result: PASS`, `check` green, and `windows` failing no differently from run 36590234172.
- Then Claude merges the new `main` into `vault-m2-team` and pushes it, so PR #1's CI runs on it. PR #1 stays a draft and is not merged.
- **Side effects:** one TestFlight build of unchanged app code, because Codemagic builds every push to `main` (`codemagic.yaml` lines 51-57). `release.yml` does not run; its path filter leaves out `supabase/**` (lines 37-53). Nothing changes in production; only `db push` does, once 2.2b rules out an automatic one.
- **Stop if** `sql` or `check` fails, or the merge touches anything outside the five files above.

---

## 2. Prerequisites (push day)

**2.1 Pin the CLI and clean the shell:**

```
alias sb='npx --yes supabase@2.118.0 --agent no'
sb --version
env | grep '^SUPABASE_'
```

- **You should see:** `2.118.0`, and nothing from the `env` line. You need Node for npx. Docker is needed only if `functions deploy` asks for it (7.4).
- **If the `env` line prints anything,** `unset` each name in this window (for example `unset SUPABASE_PROJECT_ID`). In 2.118.0, `SUPABASE_PROJECT_ID` beats the linked project, and `SUPABASE_WORKDIR` changes which `supabase/` folder is read (read in the binary, not run).
- **Stop if:** it prints any other version. Not verified here: that 2.118.0 downloads on macOS with Apple Silicon.

**2.2 Dashboard checks** (first in section 0, again on push day):

- a. Project Settings, General. The Project ID must be `lzlrlfdffwiypzreoldb` (it is also in the README's repo-oauth callback URL).
- b. Project Settings, Integrations, GitHub. Confirm that nothing deploys migrations to production automatically, and note whether Branching is on. **Stop if** automatic production deploys are on, and rethink the plan with Claude. The repo has no deploy automation of its own (no `db push` or `SUPABASE_ACCESS_TOKEN` in `.github/` or `codemagic.yaml`). Not verified here: the dashboard path or your settings.
- c. Codemagic, environment group `Harbor-os-code` (`codemagic.yaml` lines 31-32 and 233-240). `VITE_SUPABASE_URL` must be `https://lzlrlfdffwiypzreoldb.supabase.co`. **Stop if** it names another project. Not verified here: the group is not visible from the repo.

**2.3 An up-to-date checkout of main.** After Claude reports the step 1 merge.

```
cd <your clone of openshore-labs/openshore.code.ai>
git fetch origin
git worktree list
git worktree add --detach ../oscode-main origin/main
cd ../oscode-main
git log -1 --format='%h %s'
git merge-base --is-ancestor cd213e6 HEAD && echo step1-is-in
git status --short
ls supabase/migrations | tail -6
git diff --stat origin/vault-m2-team HEAD -- supabase/migrations
```

- **If `git worktree list` shows `oscode-migrations`** from the first runbook, remove it first: `git worktree remove ../oscode-migrations` (add `--force` if git refuses). Nothing may ever be pushed from it.
- **If `worktree add` says `../oscode-main` already exists,** run `git worktree remove ../oscode-main` and add it again.
- **You should see:** the step 1 merge commit (or a newer `main` commit); `step1-is-in`; nothing from `git status --short`; the last six files `0018_graduated_enforcement.sql`, `0019_org_vault_v1.sql`, `0022_account_deletion.sql`, `0023_org_free_caps.sql`, `0024_org_vault_move.sql`, `0025_org_vault_settings.sql`; and nothing from the diff.
- **Stop if:** `step1-is-in` is missing, any file numbered 0026 or higher exists (unless 0.3 added one and Claude revised this runbook), or the diff prints anything.

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

- 0019: a SHARE lock on `org_vault_notes` while it builds the unique index without CONCURRENTLY (lines 197-199); then an ACCESS EXCLUSIVE lock while it rewrites the table for the new `size` column (lines 205-218).
- 0022: it swaps the foreign keys on `org_members`, `org_vault_notes`, `org_projects` and `org_project_members` (lines 43-86). Adding a foreign key also locks the table it points at, `auth.users`, against writes, so sign-ins and sign-ups wait until 0022 commits.
- 0023: it adds triggers on `orgs`, `org_vault_notes` and `org_vault_revisions`, then reads both vault tables for its backfill (lines 198-220).
- 0024 only creates a function.
- 0025: it adds two foreign keys to `auth.users` (section 10, lines 746-791), so sign-ins wait a second time, until 0025 commits. It also clears and validates `org_vault_revisions.updated_by`, and builds `org_vault_revisions_updated_by_idx` without CONCURRENTLY (lines 796-797), which blocks history writes (overwrites, deletes, renames) until it commits.

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

**3.2 Copy the tables whose rows change.** This writes to production, so run it at 7.1, after sections 4 to 6 pass. 0019 renames case duplicates and rewrites `org_vault_notes`; 0022 may delete queued repeats from `abuse_reports` (lines 284-295).

```sql
create schema if not exists pre_0019;
revoke all on schema pre_0019 from public, anon, authenticated;
drop table if exists pre_0019.org_vault_notes;
create table pre_0019.org_vault_notes as table public.org_vault_notes;
drop table if exists pre_0019.abuse_reports;
create table pre_0019.abuse_reports as table public.abuse_reports;
```

**Only if 4.1 showed 0019 already applied,** also copy the revisions, because 0025 clears the author id of any account already deleted there (section 10):

```sql
drop table if exists pre_0019.org_vault_revisions;
create table pre_0019.org_vault_revisions as table public.org_vault_revisions;
```

Then compare counts, one block each: `select count(*) from pre_0019.org_vault_notes;` against `select count(*) from public.org_vault_notes;`, the same for `abuse_reports`, and for `org_vault_revisions` if you copied it.

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

- Each note 0019 renames keeps its old path and body in `org_vault_revisions` with `reason = 'renamed'` (0019 line 184), and in `pre_0019.org_vault_notes`.
- The weekly purge deletes revision rows older than 30 days (0019 lines 527-547), so keep `pre_0019` until you are satisfied.
- Copying notes back needs an explicit column list: `org_id, path, body, deleted, rev, updated_at, updated_by`. Never `select *`: 0019 re-adds `size` as a generated column at the end (lines 205-218).
- 0022 removes only a queued report that repeats another for the same account and hash; `pre_0019.abuse_reports` holds the rows as they were.
- 0025 only clears author ids of accounts already deleted; nothing else in it changes rows.
- A wrong OV402 is fixed in that org's `org_entitlements` row or in a new file, never by editing an applied one.

---

## 4. Preflight (SQL editor, read only; first in section 0, then again on push day)

**4.1 Migration history.** This is also the README's held-numbers check (Ship order, step 1).

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

- **You should see:** 0001 `orgs` through 0017 `reconcile_stale_0016`, possibly 0018 `graduated_enforcement`, each name matching its file.
- **Stop if** there is any 0020 or 0021 row. Those were the team files' numbers on the held branch only. The push would fail with "Remote migration versions not found in local migrations directory"; stop and ask.
- **Stop if** any row numbered 0019 to 0025 has a name other than its file's: `org_vault_v1`, `account_deletion`, `org_free_caps`, `org_vault_move`, `org_vault_settings`. The unmerged branch `claude/openshore-privacy-mobile-1ij12h` uses 0019 and 0020 for other files, and the CLI matches on the number only.
- **Stop if** 0022, 0023, 0024 or 0025 is already there and you did not push it. Something pushes without you (re-check 2.2b), and a held copy of 0024 or 0025 would lack the review's fixes, which `db push` would never re-apply.
- **Stop if** the table is missing or there are gaps, and hand the full output to Claude. DECISIONS lines 948-967 record the 0016 case, where a migration was applied outside the file history.
- **If 0019 `org_vault_v1` is already there:** fine; 0018 must be there too. Only 0022 to 0025 go, and you skip 4.2.
- **For every file the history does not list, check for leftovers made by hand:**
  ```sql
  select
    to_regclass('public.org_vault_revisions') as r0019_revisions,
    to_regclass('public.org_vault_rev_seq') as r0019_rev_seq,
    to_regclass('public.org_vault_notes_live_lower_idx') as r0019_lower_idx,
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
        and p.proname in ('org_vault_lock', 'enforcement_email_key', 'org_is_entitled',
                          'org_storage_track', 'org_vault_move', 'org_vault_entitled')) as functions,
    (select string_agg(tgname, ', ' order by tgname)
       from pg_trigger
      where tgname in ('org_free_owned_cap', 'org_vault_notes_storage',
                       'org_vault_revisions_storage')) as triggers;
  ```
  - The `r00NN_` prefix names the file. In `functions`, `org_vault_lock` is 0019's, `enforcement_email_key` is 0022's, `org_is_entitled` and `org_storage_track` are 0023's, `org_vault_move` is 0024's, and `org_vault_entitled` is 0025's. Every name in `triggers` is 0023's.
  - **Pass:** everything that belongs to a file the history does not list is NULL or absent. Before any of them is applied, the whole row is NULL.
  - **Stop if** anything is filled in for a file not in the history, because `if not exists` would silently keep a leftover. Hand it to Claude.
- **If 0018 is missing,** run:
  ```sql
  select exists (select 1 from pg_proc where proname = 'admin_confirm_termination') as fn_0018,
         exists (select 1 from pg_policies where policyname = 'members_delete_self') as policy_0018;
  ```
  - **Both false:** production still ends an account on the first strike (0016 and 0017). The board replaced that with the graduated ladder on 2026-09-16 (0018 header lines 6-11). 0018 adds `enforcement_window` (line 42, 90 days); replaces `record_enforcement` (line 56), which 0022 replaces again; adds `admin_confirm_termination` (line 151); and adds the `members_delete_self` policy plus `grant delete on public.org_members to authenticated` (lines 200-208), so a member can remove their own membership. It goes first and cannot be skipped; check it in 8.6. If you do not want it, stop: there is no way to ship 0022 without it.
  - **Either true:** 0018 was applied by hand. Stop and hand the output to Claude. No `migration repair`, no `--include-all`.

**4.2 Case duplicates (0019).** The README's query (0019 section, Preflight: case duplicates) with a tie-break added, so the first path shown is exactly the one 0019 keeps (0019 lines 169-172), and a path check, because a path that fails `org_vault_path_ok` makes 0019 roll back (0019 lines 123-150):

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

- **Pass:** no rows ("No rows means 0019 changes no data", same README section).
- **If there are rows, preferred:** have the owners rename or merge those notes in the app, then re-run until there are none.
- **If you go ahead with rows anyway:**
  - Ask Claude first to rehearse the rename on a local stack: drop `org_vault_notes_live_lower_idx`, insert case-duplicate paths shaped like your output with made-up bodies, re-run 0019 lines 158-199, and show the renamed paths and revision rows.
  - Save the output and write down N, the sum of (notes minus 1).
  - The first path in `paths` keeps its name. Each other one moves to "<name> (conflict YYYY-MM-DD HHMM).md" and leaves a revision row (0019 lines 158-195).
  - Tell the owners: a build in the field that still has an old path open gets a permanent "Not saved" on its next save, because the put refuses a name that differs only by case (0019 line 446, 0025 line 630). The text stays in the editor. Reopen the note under its new name before editing.
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

- **Pass:** no rows, or only teams you accept as read-only. The CFO and CTO ruling of 2026-09-27 says a lapsed paid row is read-only with export (DECISIONS lines 2611-2615). An org with no entitlement row keeps writing (0025 lines 129-146) until `no_entitlement_vault_until()` (lines 116-122), which is null in the beta.
- **`past_due` rows need a decision.** Those are paying customers inside Stripe's retry window (0001 line 38). Only `active` and `trialing` count (0025 lines 135-141, and `supabase/functions/_shared/entitlement.ts` line 16).
- **What those teams will see:** OV402 on every save, delete and move, builds in the field included (raised at 0025 lines 150-162; called by the write at line 332, the remove at 423, the move at 487, the legacy put at 622 and the legacy delete at 685). They can still read and export every note.
- **If a listed team has live notes and you want to tell them first,** either:
  - tell them, wait, then do the one push as planned; or
  - hold 0025 back: push first from main's commit just before the step 1 merge (Claude gives you the hash; use it in place of `origin/main` in 2.3). That push takes only 0018 (if missing), 0019, 0022 and 0023. Then push 0024 and 0025 later from the current `main`, repeating sections 4 to 9 for those two files. This is the README's two-push Ship order. Ask Claude before choosing it.

**4.4 abuse_reports (0022).** From the README (Migrations 0022 and 0023, step 1), verbatim. Two separate blocks; both should return no rows:

```sql
select id, status from public.abuse_reports where request_hash !~ '^[0-9a-f]{64}$';
```

```sql
select user_id, request_hash, array_agg(status) from public.abuse_reports
 where user_id is not null group by 1, 2 having count(*) > 1;
```

- **If there are rows:** the README says 0022 "removes a queued report that repeats another for the same account and hash, and never one an operator acted on. If rows remain, it prints a NOTICE and leaves the new check unvalidated or the unique index uncreated; fix the rows by hand and re-run that block." Do that fix with Claude before the push, so 8.7 passes cleanly.

**4.5 Free caps (0023). For information; these two queries are mine, not the README's.** 0023 caps every org without a live plan, beta teams with no entitlement row included, because its `org_is_entitled` has no beta window (0023 lines 53-66; 0025's header lines 57-59 note the difference). Nothing stored is removed: a team over the cap keeps its notes but cannot grow them, and an owner with more than one free team keeps them but cannot make another (0023 lines 23-27).

Teams within 5 MiB of the 25 MiB cap, counting note bytes (0023 also counts revision bytes, which exist only once 0019 is in):

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

- **Pass:** no rows. Rows are not a stop. Tell those owners only this: after the push, a save that grows a team past 25 MiB of free space is refused, and an account without a plan cannot make a second team (0023 lines 98 and 188). Do not tell them that deleting notes frees space: it does not until the weekly purge, about 30 days later (0.3a).

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

- **You should see:** one row. If not, go to Dashboard, Database, Extensions, enable `pg_cron`, and re-run. 0019 tries to enable it itself, but if that fails it only prints a NOTICE and skips scheduling the purge (0019 lines 553-572).

**5.2 Existing cron jobs:**

```sql
select jobname, schedule, active from cron.job order by jobname;
```

- **You should see:** `oscode_ledger_retention` at `17 3 * * 0`, from 0015. If it is missing, 0015's cron block needs a re-run later; that does not block this push.

Nothing else is needed. None of these files uses pgcrypto, pg_net or Supabase Vault secrets; 0022 hashes with the built-in `sha256()` (lines 105-119). `config.toml` has no `[db.vault]` section, and there is no `supabase/roles.sql`.

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

- **You should see:** rows in ascending order. 0001 to 0017 (or 0018) have both Local and Remote. At the bottom, Local-only rows for exactly 0019, 0022, 0023, 0024 and 0025, plus 0018 if 4.1 showed it missing; only 0022 to 0025 if 0019 was already applied. No 0020 or 0021 rows; that is correct.
- **Stop if:** any row is Remote only, or a Local-only row sits above (has a lower number than) the last row with Remote filled in.

**6.2 Dry run:**

```
sb db push --linked --dry-run
```

- **You should see:** `DRY RUN: migrations will *not* be pushed to the database.`, then `Would push these migrations:` and a list that is exactly one of these:
  - `0018_graduated_enforcement.sql`, `0019_org_vault_v1.sql`, `0022_account_deletion.sql`, `0023_org_free_caps.sql`, `0024_org_vault_move.sql`, `0025_org_vault_settings.sql`, if 4.1 showed 0018 missing;
  - the same five without 0018, if 0018 is applied;
  - `0022_account_deletion.sql` to `0025_org_vault_settings.sql` only, if 4.1 showed `0019 org_vault_v1` applied.
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

- **Pass:** no rows. A session left open in a transaction would make 0019's rewrite or the key changes in 0022 and 0025 wait, and every save, read and sign-in would queue behind them.
- **If there are rows,** wait a few minutes and re-run. If they are Supabase's own services, hand them to Claude before you decide. Not verified here: what those services show.

**7.2 Push.** Run it yourself in Terminal, not through Claude Code, a script or a pipe.

```
sb db push --linked
```

- **You should see:** `Do you want to push these migrations to the remote database? [Y/n]` with the same list as 6.2. Read it, type `y`, press Enter. The default is Yes, so Enter alone also pushes. Never add `--yes`, `--output-format`, `--include-all`, `--include-seed` or `--include-roles`.
- Then `Applying migration 0019_org_vault_v1.sql...` and the same for each other file, ending with `Finished supabase db push.`
- There may be a NOTICE saying "renamed N live note(s)", and a NOTICE about pg_cron if it could not be enabled (8.4 covers that). A NOTICE about `abuse_reports` means 4.4 was not clean; note it for Claude. Not verified here: whether the CLI shows notices.
- **If it hangs for more than a minute** on any file, do not press Ctrl-C. Run the lock query from section 10. If the blocker is a session `idle in transaction`, end it with `select pg_terminate_backend(<its pid>);`. Otherwise hand the output to Claude.
- **If it fails:** copy all the output and re-run 4.1. Each file applies as one transaction with its history row, and the push stops at the first failure (verified locally, see "Facts").
  - Production then has nothing applied, or the files up to one of 0018, 0019, 0022, 0023, 0024 or 0025.
  - Each of these is safe for builds in the field: they use only plain selects plus `org_vault_put` and `org_vault_delete`, and 0019 and 0025 keep both signatures (0019 lines 411-521, 0025 lines 594-706). With 0024 in and 0025 not, `org_vault_move` is callable without the plan gate, but nothing calls it. Not verified here: every partial state against each build in the field.
  - In sections 8 and 9, skip the checks for files not applied; they will fail and are not new faults.
  - Do not run 7.4 unless 0022 applied (the function writes `enforcement_tombstones` and clears revision authors, which only 0022 allows; 0022 lines 30-31). Do not start step 3.
  - Hand the output to Claude. Once the cause is fixed, run 6.2 again and push again from the same window; it applies only the rest. A file not yet applied may still be corrected; one already in the history is frozen, and any fix to it is a new file.
- **A unique violation on `org_vault_notes_live_lower_idx`** means a build in the field created a case duplicate during the push. That file rolled back. Re-run 4.2 and push again.

**7.3 Record PUSH_TIME.** After `Finished supabase db push.`, run `select now();` in the SQL editor and write it down.

**7.4 Deploy the account deletion function** (README, Migrations 0022 and 0023, step 3), in the same window, as decided in 0.3b:

```
sb secrets list
sb functions deploy delete-account
```

- `secrets list` should include `STRIPE_SECRET_KEY`. The function reads it only when the account has a Stripe customer or subscription to cancel. Not verified here: what production holds or how the list looks. If it is missing, deploy anyway and tell Claude; deleting an account with a Stripe subscription would fail until it is set.
- Always name `delete-account`. With no name, 2.118.0 deploys every function (`functions deploy --help`). Never add `--prune` (it deletes remote functions not in the folder) or `--no-verify-jwt`: `config.toml` sets `verify_jwt = true` for this function (lines 70-71), and a plain deploy honors it.
- **If it says Docker is not running,** start Docker Desktop and run it again, or add `--use-api` ("Bundle functions server-side without using Docker" in the 2.118.0 help). Not verified here: either path against this project.
- **You should see:** a line saying `delete-account` was deployed. Not verified here: the exact wording.
- **Check it refuses a caller with no sign-in:**
  ```
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lzlrlfdffwiypzreoldb.supabase.co/functions/v1/delete-account
  ```
  No header. Expect `401`: the gateway checks the sign-in before the function runs. Not verified here: the exact code.

**Compatibility window: pushing now and merging PR #1 later is safe.**

- Builds from v0.1.45 (48593b9) on hide the team vault unless the build is tier 4: `teamVaultAvailable` checks `featureOn('teams')` (main `store.ts` lines 10201-10203), and `teams` is 4 in `focus.ts` (line 40). Nothing in `codemagic.yaml` or the workflows sets `VITE_RELEASE_TIER`; the Codemagic group is not visible from the repo.
- Every build keeps working through the legacy RPCs. What people see change:
  - A note whose name differs from another only by letter case is refused, including an old path 0019 renamed (see 4.2).
  - `size` now counts bytes.
  - The teams from 4.3 get OV402, `past_due` ones included.
  - The teams from 4.5 cannot grow past the free caps.
  - Deleting an account that ever wrote to a team no longer fails on a foreign key, and its id is cleared from team settings and history too. Builds with Settings, Your account, Delete account can use it once 7.4 is done.
  - The enforcement ladder records rows for the first time.
  - Saves and sign-ins are briefly slow or time out while 0019, 0022 and 0025 hold their locks.

---

## 8. Verify (SQL editor)

**8.1 History:**

```sql
select version, name from supabase_migrations.schema_migrations where version >= '0018' order by version;
```

- **Pass:** `0018 graduated_enforcement`, `0019 org_vault_v1`, `0022 account_deletion`, `0023 org_free_caps`, `0024 org_vault_move`, `0025 org_vault_settings`. `sb migration list --linked` should show them on both sides.

**8.2 The vault objects (0019, 0024, 0025):**

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
                    'enforce_free_owned_orgs')
order by 1;
```

- **Pass:** 14 rows.
  - f, t: `org_vault_entitled`, `org_vault_move`, `org_vault_remove`, `org_vault_settings_get`, `org_vault_settings_put`, `org_vault_write`.
  - f, f: `enforce_free_owned_orgs`, `enforcement_email_key`, `org_is_entitled`, `org_storage_track`, `org_vault_is_admin`, `org_vault_purge`, `org_vault_require_entitled`, `org_vault_require_may_delete`.
- The grants are in 0019 lines 576-590, 0022 line 120, 0023 lines 68 and 195-196, 0024 lines 184-185 and 0025 lines 712-721.

**8.4 The purge job:**

```sql
select jobname, schedule, btrim(command) as command, username, active from cron.job where jobname = 'oscode_vault_purge';
```

- **Pass:** schedule `29 3 * * 0`, command `select public.org_vault_purge();`, username `postgres`, active `t`. Without `btrim`, the stored command has a space at each end (0019 line 567). The username is `postgres` locally; on production it is not verified here.
- **If there is no row, or `cron.job` does not exist:** do 5.1, then run 0019's block (lines 553-572) exactly as written, and re-run this check:
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

**8.6 0018:**

```sql
select exists (select 1 from pg_proc where proname = 'admin_confirm_termination') as fn_0018,
       exists (select 1 from pg_policies where policyname = 'members_delete_self') as policy_0018,
       has_table_privilege('authenticated', 'public.org_members', 'delete') as members_delete;
```

- **Pass:** all three `t`.

**8.7 Account deletion (0022 and 0025 section 10).** Two blocks. The author columns:

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

- **Pass:** seven rows, each `on_delete` exactly `n` (set null, validated). The first five are 0022's (lines 43-86); the last two are 0025's (lines 746-791).

The rest of 0022:

```sql
select
  to_regclass('public.enforcement_tombstones') is not null as tombstones,
  (select convalidated from pg_constraint
    where conrelid = 'public.abuse_reports'::regclass
      and conname = 'abuse_reports_request_hash_check') as hash_check_valid,
  to_regclass('public.abuse_reports_user_hash_idx') is not null as report_idx;
```

- **Pass:** `t`, `t`, `t`. An `f` in the last two means 4.4 was not clean (0022 lines 270-277 and 297-310); hand it to Claude.

**8.8 Free caps (0023).** Two blocks. The objects:

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

The backfill matches what is stored (0023 lines 210-220):

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

---

## 9. Smoke test (SQL editor; keeps nothing)

This block makes a throwaway team and runs 22 checks across 0019 and 0022 to 0025. Then it raises an error on purpose, so everything rolls back. The only lasting effect is that the rev and revision-id sequences move forward, which is harmless.

It follows the pgTAP fixture pattern (`org_vault.test.sql` lines 20-52). It was run through psql as `postgres` on a local stack built from `vault-team-migrations` at `cd213e6` (the same `supabase/` as `vault-m2-team` at `6609338`), migrations 0001 to 0019 and 0022 to 0025, on 2026-09-29: it printed `SMOKE PASSED: 22 checks held`, and afterwards no smoke org, user, note or revision was left. So a `FAIL` here means production differs from the files.

What each number checks: 1 to 7, 0019's guarded writes, legacy pair and history; 8 and 14, 0024's move (14 is a member's move under admins-only delete); 9 to 13, 16 and 17, 0025's settings, OV403 and OV402; 15, 21 and 22, 0022's ladder and the history's author rule; 18 and 19, 0023's byte total and the one-free-team cap; 20, 0025's author keys (deleting an account keeps its history rows and clears its id).

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

  -- A, the admin (0019)
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

  -- B, a member (0019, 0024, 0025)
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

  raise exception 'SMOKE PASSED: 22 checks held. This error is deliberate, so nothing is kept.';
end $smoke$;
```

- **Pass:** a red error that reads `SMOKE PASSED: 22 checks held...`.
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
- After the merge, if they return 404 or PGRST202, run `notify pgrst, 'reload schema';`. The branch client shows this case as "The team vault is being updated..." (branch `app/src/lib/gitos/orgVault.ts` lines 198-208 and 248).
- One account deletion with a throwaway account on TestFlight (PROGRESS, the premium build item). Dashboard, Edge Functions, `delete-account`, Logs should show it. Not verified here: the exact path.

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

**First purge.** The first Sunday after the push at 03:29 UTC (2026-10-04 if you push this week).

```sql
select d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname = 'oscode_vault_purge' order by d.start_time desc limit 5;
```

- **Pass:** `succeeded`.
- Once you are satisfied, run `drop schema pre_0019 cascade;`. It holds note bodies and abuse reports.

---

## 11. Step 3: hand-off to Claude

The migrations must land before PR #1 merges, because the branch client calls `org_vault_write`, `org_vault_remove`, `org_vault_move` and `org_vault_settings_get`/`_put`. After that the merge can wait: builds in the field use the legacy RPCs, and the migrations keep them. The device checklist's team lines (branch `docs/vault-v1-device-checklist.md` lines 78-89) need a tier-4 build. A push to `main` ships to TestFlight (Codemagic) and to the desktops (`release.yml`, for changes under `app/**` and `os-code/**`).

Keep `org_vault_put` and `org_vault_delete` until no v0.1.44-or-older build is in team use; dropping them would turn saves from those builds into permanent "Not saved" errors.

Paste this to Claude:

> Gate 1 is done. At <PUSH_TIME UTC> I ran `supabase db push` (CLI 2.118.0) from main at <commit from 6.0> against lzlrlfdffwiypzreoldb. Applied: <0018 if it went>, 0019, 0022, 0023, 0024, 0025. I deployed delete-account at <time>; the no-sign-in check gave <code>. Section 8 passed: <paste 8.1, 8.2, 8.4, 8.7, 8.8, and 8.6 if 0018 went>. Smoke test: SMOKE PASSED, 22 checks. Case-duplicate renames: <count from 8.5>. Read-only teams from 4.3: <list or none>. Teams at the free caps from 4.5: <list or none>. On vault-m2-team, before PR #1 merges: record the applied date in os-code/DECISIONS.md, and that 0018 to 0025 are applied and must never be edited (any change is a new file above the newest); in os-code/PROGRESS.md What remains, mark done the migration and purge-cron part of the held Vault branches item and the 0022, 0023 and delete-account part of the premium build item (the iCloud, native, xcodebuild, release signing and device parts stay open); in docs/vault-v1-test-map.md, say the push is done; reword supabase/README.md's Ship order steps 2 and 3 to say one push from main applied all five in order, followed by the delete-account deploy, and point the older "supabase db push" lines (the 0015 section, Phase 0) at the Ship order preflights. Findings 2, 6 and 7 of the 2026-09-29 interaction review stay open as recorded in PROGRESS and DECISIONS unless section 0 resolved them (<say how>); 0025 section 10 already keys org_vault_settings.updated_by and org_vault_revisions.updated_by on delete set null, so do not record that as open. Note that claude/openshore-privacy-mobile-1ij12h must renumber its 0019 and 0020 above the newest before it merges. Then merge the current main into vault-m2-team, retitle draft PR #1 (it still says 0020 and 0021), and merge it into main once its check and sql jobs are green on the current main; tell me first if its windows job fails differently from main's latest windows run. Keep featureOn('teams') in teamVaultAvailable. Do not remove org_vault_put or org_vault_delete.

---

## Review notes

- commands, stale pgTAP count: applied (Tests=213 from run 36592050642 on 6609338; 144 in org_vault; hashes cd213e6, 6609338, bf0ac38).
- commands, verification misses 0025 section 10: applied (8.7 seven rows with the not-valid mark, 8.2 author_idx and new_objects 4, 4.1 leftover columns).
- commands, hand-off records a false follow-up: applied (sentence replaced; findings 2, 6, 7 stay open).
- commands, step 1 prompt predates the fix stage: applied (step 1 is merging the existing branch; three-dot diff; no records on main, they ride with PR #1).
- commands, 0024 and 0025 line citations: applied per the mapping (verified against cd213e6).
- commands, stale CI hashes and windows failure names: applied (windows compared against run 36590234172 on bf0ac38).
- commands, 0025 missing from the lock analysis: applied (2.5, 7.1 and the compatibility window name 0025).
- commands, no gate for open findings 2 and 6: applied (0.3, with the file-list revision rule; 4.5 no longer promises that deleting frees space).
- commands, 3.2 lacks a revisions copy: applied (conditional copy when 0019 was already applied).
- commands, smoke provenance and section 10 coverage: applied (check 20 added, later checks renumbered 21 and 22, 22 in all; re-run locally on cd213e6).
- commands, README line citations move after step 1: applied (cited by section name).
- commands, test map in the step 1 prompt: dropped (vault-m2-team's test map already names 0024 and 0025 and lands with PR #1; the hand-off marks the push done).
- safety, smoke provenance: applied (see above; block extended, not only re-dated).
- safety, merge before 2.2b and 4.3: applied in part (0.1 has the founder confirm 2.2b before the merge reaches main; the 0025 hold-back stays possible after the merge by pushing from main's pre-merge commit, 4.3).
- safety, finding 2 gate: applied (0.3a); carrying the PROGRESS item to main dropped, since it would conflict with PR #1's copy and this runbook carries the gate.
- safety, delete-account race: applied (0.3b decision, 7.4 refers to it; finding 7 noted as non-blocking).
- safety, hand-off false follow-up: applied (same fix as commands).
- safety, step 1 staleness: applied (existing branch, Tests=213, run 36592050642, no windows failure list, no PR opened for step 1).
- safety, 7.2 partial failure: applied (atomicity marked verified locally; skip checks for unapplied files, no step 3, re-run 6.2 and push again, applied files frozen).
- safety, 2.5 quiet hour: applied (0025 bullet; 0024 only creates a function).
- safety, 8.7 and 4.1 leftovers: applied (same as commands).
- safety, 4.1 does not stop on 0024 or 0025: applied.
- safety, order versus README: applied (3.2 moved into 7.1 after 4 to 6; README rewording for one push and the older db push lines go in the hand-off).
- safety, line citations: applied (re-cited against cd213e6).
