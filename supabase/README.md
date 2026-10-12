# OpenShore backend (Supabase)

The optional account backend: sign-in, a few preferences that follow a person
between devices, account deletion and export, push for finished tasks, and
repository OAuth. OpenShore runs local-first without it, and chatting never
needs an account. Team features and their billing (Stripe, commercial team
seats) belong to a later release tier that this build keeps shut.

Everything here is inert until you stand up your own Supabase project and set
its keys. The official app talks to Open Shore LLC's own project; how that one
is operated is a maintainer matter and is not in this repository.

## Integration map

| Integration        | Secret(s) / home                                                                 | Used by                                  |
| ------------------ | -------------------------------------------------------------------------------- | ---------------------------------------- |
| Supabase (client)  | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (app build; public)                | app sign-in (`src/lib/supabase.ts`)      |
| Supabase (server)  | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (function secrets; NEVER `VITE_`)     | every edge function                      |
| Guardrail HMAC key | Vault secret `guardrail_hmac_key` (created once in the SQL editor, never committed, never in `config.toml`) | 0019's insert trigger and re-key |
| Repo OAuth         | `GITHUB/GITLAB/BITBUCKET_OAUTH_CLIENT_ID/_SECRET` (function secrets)              | repo-oauth (PKCE + fixed error codes)    |
| Team billing       | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MICRO/SMALL/GROWTH/SCALE`, optional `STRIPE_IGNORED_PRICES` (function secrets) | stripe-checkout / -webhook / -portal, delete-account (later tier) |

Rule: never put a service-role or secret key in a `VITE_` variable.

## Migrations: the rules

Migrations live in `migrations/`, numbered. Production's history is the
authority on what each number means, and `production-history.tsv` records it:
every applied version, its name, and the SHA-256 of its file.

- Never edit, rename or renumber an applied file. Any change to an applied
  object is a new file.
- A new file takes the next number above both `main`'s newest and the newest
  in `production-history.tsv`.
- A pull request that adds a migration says so; maintainers apply migrations
  to production, from `main` only.
- Every push command carries `--skip-vault` (see "Local stack" below).

Guards: `app/test/supabaseMigrations.test.ts` fails when an applied file is
missing, renamed, or edited, when an unapplied file is numbered at or below
production's newest, when two files share a number or the same bytes, or when
`config.toml` gains a `[db.vault]` section. `.github/workflows/migrations.yml`
runs `node supabase/scripts/check-migrations.mjs --against origin/main` on every
branch push that touches `supabase/` and on every PR.

Some migrations schedule a `pg_cron` job (retention and purges). Where pg_cron
is not installed, the block prints a NOTICE and the migration still applies;
enable pg_cron on a hosted project and re-run the block to schedule it.

## Tests

`supabase test db` runs every `.sql` file under `tests/`, each its own
rolled-back transaction with its own plan: `tests/rls.test.sql` (32 assertions
over 0015's row-level security cases), `tests/org_vault.test.sql` (144 over 0021, 0024 and
0025), `tests/account_deletion.test.sql` (68 over 0022, its section 6
deletion functions included, and 0023), and `tests/guardrail_privacy.test.sql`
(57 over production's 0019 and 0020, 0022's appeal address, and 0026). Every file scopes its counts to its own ids, since it
also runs on a database that is not empty. (Files outside `tests/`, such as
`replay/`, are not pgTAP files and must stay out of it.)

CI (`.github/workflows/ci.yml`) builds the database two ways, and both must pass
pgTAP:

- **`sql`, from empty:** `bash supabase/scripts/local-vault.sh supabase db
  start`, then `supabase test db`.
- **`sql-replay`, replaying production:**
  1. `node supabase/scripts/replay-split.mjs split` checks every row of
     `production-history.tsv` against its file's hash and sets the other files
     aside.
  2. The database is built from production's files only.
  3. `replay/production_rows.sql` loads rows with production's shape (a team
     with an invite, case-duplicate note paths, a queued report and its repeat,
     a submitted report under legal hold, keyed block rows, reviews) and
     snapshots every fingerprint and hold.
  4. The pending files come back, and the local dry run must list exactly
     them.
  5. `supabase db push --local --skip-vault --yes` applies them the way
     production's push will.
  6. `replay/after_push.sql` checks what must hold (the history, the rename,
     the dedupe, no fingerprint keyed twice, the author keys, the cron jobs, the
     export, the ladder, and the deletion functions on production's rows).
  7. The full pgTAP suite runs on the result.
  8. Its schema must equal one built from empty.

`deno test functions/_shared` covers the pure decisions: `entitlement.test.ts`
(the entitled statuses, seat bands, checkout routing and ignored prices) and
`accountDeletion.test.ts` (the deletion plan, how the function reads the
owned-team delete's answer, and the answer both apps read).

## Local stack: the Vault secret

Production's 0019 reads the guardrail HMAC key from Supabase Vault by name and
stops, by design, when it is missing, so a local database needs a throwaway key
before 0019 runs. Build or reset the local stack through the wrapper, never with
a bare `db start`:

```
bash supabase/scripts/local-vault.sh npx --yes supabase@2.118.0 db start
bash supabase/scripts/local-vault.sh npx --yes supabase@2.118.0 db reset --local
npx --yes supabase@2.118.0 test db
npx --yes supabase@2.118.0 stop --no-backup
```

The wrapper appends `[db.vault] guardrail_hmac_key =
"env(OSCODE_LOCAL_GUARDRAIL_HMAC_KEY)"` to `config.toml` with a fresh `openssl
rand -hex 32` key, runs the one command, and restores the file on exit. It
runs only `start`, `db start`, `db reset` and `db push --local`, and refuses
everything else (among them `db pull`, `pull`, `migration repair`,
`migration list`, `db dump` and `inspect`) and every flag that names a project
or another `supabase/` folder, in any spelling (on 2.118.0 a target flag
counts once given, whatever its value, so `--linked=false` targets the linked
project), any `--local=` other than `--local=true`, `--wizard` in any
spelling, a bare `--`, every `--no-<flag>` (2.118.0 reads `--no-linked` as
`--linked` and `--no-wizard` as `--wizard`), and any flag before the
subcommand that is not one of the CLI's global flags, before anything runs
(`app/test/localVaultScript.test.ts`, which also runs every use documented
here and in CI). The entry is never committed: the CLI's push upserts every Vault secret `config.toml` resolves
before it migrates (2.118.0: "Vault secrets from config.toml are updated before
migrations unless --skip-vault is set"), so a committed entry with the variable
set would silently rotate production's key and break the link between old and
new fingerprints. That is also why every push command here carries
`--skip-vault`.

## Stand up your own backend

### 1. Sign-in

1. Create a Supabase project. Copy `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
   into the app's `.env.local`.
2. Create the guardrail Vault secret first (`guardrail_hmac_key`, in the SQL
   editor; migration 0019 stops without it), then apply the schema:
   `supabase db push --linked --skip-vault`.
3. Auth settings: enable Email (magic link and/or password). Add the app's
   redirect URLs so the magic-link callback lands on the app's own origin:
   - iOS: `oscode://auth-callback` (register the scheme in the app; wire the
     Capacitor App `appUrlOpen` listener to `completeAuthCallback(url)`).
   - Electron: `http://127.0.0.1:4817/auth-callback`.
   - Web (dev): `http://localhost:5173/auth-callback`.
4. Done when you can sign in from the app and Settings shows your account.

### Warning: `supabase config push` and email confirmations (P0-4)

`config.toml` now sets `[auth.email] enable_confirmations = true`. Keep it
that way. The newer CLI's `supabase config push` mirrors `[auth]` to the hosted
project, so a local `false` would switch confirmations OFF in production, and
with them off, anyone who signs up with an invited email gets a session whose
JWT carries that email and inherits the seats (admin included). 0015 adds a
SQL check on `email_confirmed_at` as a second lock, but the dashboard toggle
(Authentication, Providers, Email, "Confirm email") must be ON as well. Also
keep "Secure email change" on, since the claim keys on the JWT email.

### 2. Connect repositories over OAuth (optional)

One-tap "Connect GitHub" in the Repositories screen runs the OAuth web flow
(`app/src/lib/gitos/repoOAuth.ts`); the `repo-oauth` function holds the client
secret and does the token exchange. The app only ever sends the public client
id and a redirect address; it never carries the secret.

**The Callback URL is the whole ballgame.** The app sends this exact
`redirect_uri` on the authorize call, and the same string on the token
exchange, both derived from the build's Supabase URL:

```
<VITE_SUPABASE_URL>/functions/v1/repo-oauth/callback
```

A GitHub App requires the `redirect_uri` to match one of its registered
Callback URLs **exactly** (scheme, host, and path, byte for byte). If it does
not, GitHub never shows the consent screen; it shows **"The redirect_uri is not
associated with this application."**

Your GitHub App's settings:

- **Callback URL**: the exact string above. A GitHub App created without a
  Callback URL rejects every `redirect_uri`, so this field must be filled in.
- **Permissions**: Contents read/write, Pull requests read/write, Metadata read.
- The App's **Client ID** goes to `VITE_GITHUB_CLIENT_ID` (public, app build,
  a Codemagic build var) and `GITHUB_OAUTH_CLIENT_ID` (function secret); its
  generated **client secret** goes to `GITHUB_OAUTH_CLIENT_SECRET` (function
  secret). GitLab and Bitbucket light up the same way once their `*_CLIENT_ID`
  and `*_CLIENT_SECRET` are set; one Callback URL serves all three.

Deploy: `supabase functions deploy repo-oauth` (verify_jwt is false in
`config.toml`, since the provider redirect carries no bearer).

Which repositories a person sees is decided by the App's **installation**, not
by the sign-in: a GitHub App user token reaches only the repositories that both
the person and the App can reach. An App installed on an organization with
"Only select repositories" shows just those in the repo picker, which now says
so and links to the installation's settings page. `VITE_GITHUB_APP_SLUG`
(your App's slug) sends a person
with no installation yet to the install page; once any installation exists,
GitHub reports the slug itself. Without a client id, the app keeps the paste-a-token path.

#### Troubleshooting "redirect_uri is not associated with this application"

The address the app sends is not (yet) registered on the App the client id
points at. Walk these, in order:

1. **The GitHub App has that Callback URL.** Open the App the
   `VITE_GITHUB_CLIENT_ID` names, and confirm its Callback URL field contains
   the exact string above. Missing or different is the usual cause; add it.
2. **The client id points at that App.** A stray personal OAuth App with a
   different callback, baked into `VITE_GITHUB_CLIENT_ID`, produces this error
   even though GitHub finds an app. Confirm the build var is your App's client id.
3. **`VITE_SUPABASE_URL` names the right project and has no trailing slash.**
   The redirect is derived from it, so it must be the project whose URL the
   Callback names. The app and the function now trim a trailing slash before
   composing the URL (a `host//functions/...` was one silent way to break the
   exact match), but the two still have to name the same project over https.

The app helps you read the live value: when a one-tap connect fails, the
Repositories screen shows the exact Callback URL this build sends, with a copy
button, so you can paste precisely that string into the App's settings.
