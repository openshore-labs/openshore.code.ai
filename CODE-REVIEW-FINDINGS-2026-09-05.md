# OpenShore full-codebase review, 2026-09-05

> ## STATUS (2026-09-05): ADDRESSED
>
> Every finding below was implemented on `main` in one remediation wave the
> same day, each fix test-first where a harness exists. Design calls were
> ruled by the CTO (technical) and the CFO (money and license) and are
> recorded one line each in `os-code/DECISIONS.md` under 2026-09-05. Gates at
> close: os-code typecheck, lint, 493 tests, build, format; app typecheck,
> lint, 692 tests, vite build, format; repo-wide em-dash guard.
>
> **Not code. These need the founder (ops):** the list under "Still needs the
> founder" below is current, plus the ship steps in `supabase/README.md`
> (migration `0015`, six function redeploys, the `APPLE_PRODUCT_IDS` secret,
> pg_cron). Three things could not be verified in this session and are
> called out in `os-code/PROGRESS.md` What remains: the Swift changes need an
> on-device pass, the sealed-store key repro needs the Linux desktop, and the
> Deno and pgTAP suites were written but not executed here.
>
> **Deferred by ruling, not dropped:** ESLint 9 (own commit after this wave),
> the App Store Server API for live Apple subscription status (needs the
> `.p8` key), per-seat Stripe quantity (a pricing change, Board gate), and
> the seat ceiling for entitlement-less orgs (one SQL constant, null today,
> CFO recommends 5).
>
> The three older review docs this document cites now live in `docs/archive/`.

Findings only. Nothing here is fixed yet. Produced by six parallel senior-review
passes (engine core, engine daemon and providers, app state and drivers, app
screens and native shell, Supabase backend and money path, infrastructure and
docs) over HEAD `e14b0a7` on `main`, plus a run of every quality gate. Every P0
was re-read by the coordinating reviewer against the live code before it was
kept. Items marked _repro-confirmed_ were executed in a throwaway vitest file
against the real modules. Items marked UNCONFIRMED are read-confirmed but need a
deploy, a device, or a console to settle; the `Verify` line says how.

Scope covered since the last review (2026-08-25): 82 commits, roughly 90k
changed lines. Every fix the 2026-08-20 and 2026-08-25 reviews recorded as
landed was re-checked; none regressed. The regressions section at the end lists
the few items from those reviews that are still open.

## Verdict in one paragraph

The substrate is strong: the jail, egress re-check on every redirect hop,
redact-then-seal journaling, Electron isolation, per-device pairing credentials,
Keychain-backed secrets, the outbox's plumbing-only commits, and the money path
fixes from August are all in place, tested, and holding. Gates are green on both
packages. What this pass found is one layer out from that substrate: policy
seams where a documented boundary is not what the code enforces. Four of those
are P0 (a member token reaches a raw shell on a shared hub, a long session
permanently stops starting tasks, a keyring hiccup on the desktop can orphan
every sealed byte, and the checked-in Supabase config leaves org-admin takeover
open if it ever reaches production). Below those, the P1 list is mostly
lifecycle bugs a user hits after an hour or after a second device, and the P2
list is hygiene with teeth.

## Quality gates, run on this tree

| Gate                       | os-code                     | app                       |
| -------------------------- | --------------------------- | ------------------------- |
| typecheck                  | green                       | green (src and electron)  |
| lint (`--max-warnings 0`)  | green                       | green                     |
| tests                      | 48 files, 420 passed        | 83 files, 604 passed      |
| build                      | green (`tsc`)               | green (`vite build`)      |
| prettier `--check`         | 7 files drift               | 10 files drift, no script |
| em-dash guard (in scope)   | green                       | green                     |
| em-dash grep, whole repo   | 46 hits outside guard scope | (see INF-2)               |
| `.skip` / `.only` in tests | none                        | none                      |
| TODO / FIXME in source     | none                        | none                      |
| committed secrets          | none found                  | none found                |

Note that CI runs typecheck, lint, and test, but never `vite build`, never a
format check, and never the Deno entitlement test (INF-1, INF-8, INF-13).

## How to use this document

- **Severity.** P0 = data loss, security hole, or a shipped-but-dead critical
  path. P1 = incorrect behavior a user hits. P2 = robustness and hygiene.
- **Each finding has a `Verify` line.** Write that test first (red), then fix
  (green). Most point at an existing test file to extend.
- **IDs.** ENG (engine core), DAE (daemon, providers, git), APP (app state,
  drivers, lib), UI (screens, components, Electron, native plugins), BE (Supabase
  and money), INF (infrastructure, CI, docs).
- **Batch by file.** The suggested execution order at the end groups findings so
  each file is edited once.

---

## P0, fix first

### P0-1 (DAE). A member token gets an unjailed shell through the user command lane, so every admin gate on a shared hub is decorative

- **Files:** `os-code/src/daemon/serve.ts:606-613` (`ownedBy` is the only check),
  `:698-707` (`POST /sessions/:id/commands` calls `driver.runCommand`),
  `os-code/src/daemon/session.ts:426-451`, `os-code/src/core/exec/commandRunner.ts:55`
  (`spawn('/bin/bash', ['-c', opts.command], { cwd })`).
- **What is wrong:** The command lane is gated by session ownership only, never
  `requireAdmin()`. It spawns `bash -c` with no jail, no approval, writable
  stdin, and no timeout. The comment at `serve.ts:733-737` says members "never
  get a raw shell" and admin-gates the PTY for exactly that reason, but `bash -c`
  with `cd` is a raw shell. A member with any admin-provisioned workspace session
  can read `~/.os-code/daemon.token` (the admin credential), push from any repo
  with the admin's ambient git credentials, and symlink `~/OSCode/x` to any path
  to defeat `isAdminProvisionedWorkspace` and `isOutboxAllowedPath`
  (`serve.ts:1005-1029`, string-prefix on `resolve()`, no `realpathSync`).
- **Why it matters:** `osc token mint --role member` and the "Ask a company
  admin" copy promise a trust boundary that does not exist. On a shared hub this
  is member-to-admin escalation with one POST. A solo user is unaffected.
- **Fix:** Gate the command lane with `requireAdmin()` (members keep the
  approval-gated `runShell` in the agent lane), or make it an explicit daemon
  config (`daemon.memberCommandLane`, default off). Independently, make both
  path predicates `realpathSync` both sides. If the founder decides members may
  have a shell, delete the comment and the member role's other gates, because
  they no longer mean anything.
- **Verify:** `os-code/test/daemon.test.ts` RBAC block: mint a member, create a
  session under `~/OSCode` (set `HOME` to the scratch dir),
  `POST /sessions/:id/commands {"command":"id"}` expects 403. Unit test
  `isOutboxAllowedPath` with a symlink inside `~/OSCode` pointing outside,
  expect false.

### P0-2 (ENG). Guardrail token and dollar counters never reset, so a long session becomes permanently unable to start a task _(repro-confirmed)_

- **Files:** `os-code/src/core/guardrails/index.ts:43-47` (`startTask()` resets
  `steps`, `startedAt`, `callCounts` only), `os-code/src/core/agent/loop.ts:304`
  (`guardrails.check()` before the first model call of every task), `:424`
  (`noteTokens(promptTokens + completionTokens)` every turn),
  `os-code/src/core/agent/bootstrap.ts:131` (one `Guardrails` per session).
- **What is wrong:** `tokens` and `dollars` accumulate for the life of the
  session while the config comment (`index.ts:13`) and the stop message say
  "in one task". `promptTokens` is the whole context each turn, so a 32k-context
  model at roughly 20k prompt tokens per turn crosses `maxTokens: 400_000` in
  about 20 turns across the session. Once tripped, every later `run()` emits
  "Stopped: this task used 400,000 tokens" forever. Unlike the steps rail there
  is no "say continue" escape.
- **Repro:** `startTask(); noteTokens(1200); startTask(); check()` returns
  `{rail:'tokens'}` with `maxTokens: 1000`.
- **Fix:** Reset `tokens` and `dollars` in `startTask()`. If a session-wide
  dollar ceiling is wanted, add a separate `sessionMaxDollars`.
- **Verify:** `os-code/test/agentLoop.test.ts`: run one task that reports usage
  over `maxTokens`, then `run()` a second task and assert the mock provider is
  called (today it is not).

### P0-3 (APP). A missing or unreadable data-encryption key is silently replaced, which orphans all sealed data on the device

- **Files:** `app/src/lib/platform.ts:123-140` (`getDek`: on a null read it
  mints a fresh key and writes it over the old one), `app/electron/main.ts:633-641`
  (`osc:secureGet` returns `null` both when the key is absent and when
  `isEncryptionAvailable()` is false or `decryptString` throws),
  `app/plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin/Keychain.swift:23-36`
  (`get` returns nil on any non-success, including `errSecInteractionNotAllowed`),
  `Keychain.swift:10-21` (`set` deletes then adds, so it overwrites).
- **What is wrong:** `getDek` cannot tell "no key yet" from "key exists but
  cannot be read right now". In the second case it mints a new key. Every value
  sealed under the old key (settings, conversations, the Local-provider vault,
  the auth session, the hub token) becomes permanently undecryptable; the
  `.recovery.<ts>` copy-aside (`platform.ts:157-161`) preserves ciphertext
  nobody can open. On Electron the trigger is a `safeStorage` decrypt failure or
  a transient `isEncryptionAvailable() === false`; Linux keyring and backend
  changes are a known Chromium os_crypt failure mode, and the founder's desktop
  is Pop!\_OS. On the Electron unavailable branch (`platform.ts:112-113`) the new
  key lands in localStorage, but `dekSecretGet` never reads localStorage when
  the bridge exists (`:96-98`), so the next launch flips back to the old key and
  that session's writes are lost instead.
- **Why it matters:** Data loss with no visible cause and no recovery path; the
  app boots as a fresh install (`store.ts:1679-1687` defaults on `undefined`).
- **Fix:** Make the secure store distinguish absent from unreadable (`secureGet`
  returns `{present, value}`, or add `secureHas(key)`). In `getDek`, refuse to
  mint a new key when a key entry exists or when `storeGetRaw(SETTINGS_KEY)` is
  a sealed blob; resolve `undefined` (read-only for sealed keys) and surface a
  "could not unlock your data on this machine" state from `init`. On Electron
  read the localStorage fallback as well as the bridge. Keep a SHA-256
  fingerprint of the key next to the sealed data so a mismatch is detectable.
- **UNCONFIRMED:** how often `decryptString` throws on the Linux build. Settle by
  launching the desktop app with `--password-store=basic` after a run that used
  the default backend and checking whether `oscode-secrets.json`'s key entry is
  rewritten.
- **Verify:** new `app/test/platform.test.ts`: mock `secureGet` to return `null`
  while `storeGetRaw(SETTINGS_KEY)` returns an `enc:v1:` blob; assert `secureSet`
  is never called and `storeGet(SETTINGS_KEY)` returns `null` rather than the
  store being overwritten on the next `storeSet`.

### P0-4 (BE). Every email-keyed grant trusts `auth.email()`, and the checked-in config turns email confirmation OFF [UNCONFIRMED for the hosted project]

- **Files:** `supabase/config.toml:34-37` (`enable_confirmations = false`; the
  header at `:4-5` says "turn them on for production"),
  `supabase/migrations/0003_claim.sql:15-19` (binds any `invited` seat where
  `lower(m.email) = lower(auth.email())`, admin seats included),
  `0014_org_projects.sql:83-89` (same match in `project_level`), `0014:269`
  (binds `user_id` from `auth.users` by email at grant time, confirmed or not).
  Client: `app/src/lib/supabase.ts:74-95` already handles "no confirmation
  required" by returning a live session.
- **What is wrong:** With confirmations off, `POST /auth/v1/signup` with a
  victim's email returns a session whose JWT `email` claim is the victim's.
  `claim_membership()` then binds every invited seat for that address,
  `project_level` resolves the victim's project grants, and `is_org_admin`
  becomes true for someone who never proved the mailbox. The newer CLI's
  `supabase config push` mirrors `[auth]` from this file to the hosted project,
  so the local testing setting can reach production by one habitual command.
- **Why it matters:** Org-admin takeover by knowing an invited email: billing
  portal, roster, Team Vault, and shared projects (whose instructions are
  injected into every member's coding agent).
- **Fix:** Set `enable_confirmations = true` in `config.toml` now. Belt and
  braces in SQL: in `claim_membership` and `project_level` also require
  `(select email_confirmed_at from auth.users where id = auth.uid()) is not null`;
  in `set_org_project_access` bind `user_id` only when `email_confirmed_at` is
  set.
- **Verify:** `curl -s -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $ANON" -H "content-type: application/json" -d '{"email":"nobody-owns-this@example.com","password":"Xx123456!"}'`.
  An `access_token` in the response means confirmations are off and the path is
  live. Also: Dashboard, Authentication, Providers, Email, "Confirm email".

---

## P1, incorrect behavior a user hits

### Engine core (ENG)

**ENG-1. `bypassPermissions` overrides the remote and headless profiles' "shell never auto-runs" guarantee.**
`os-code/src/core/security/profiles.ts:12,30,38` set `allowShellAutoApprove: false`;
`permissions/index.ts:97-106` honors it only for `sessionAllows`;
`loop.ts:595-600` turns any `ask` into `allow` under `bypassPermissions` with no
profile check; the daemon accepts `permissionMode` from any member
(`serve.ts:575-576`, `:671`). `test/agentModes.test.ts:27` only exercises
`local-interactive`. Fix: gate the mode override on `profile.allowShellAutoApprove`
and have `setMode` refuse or downgrade with an announcement. Verify:
`agentModes.test.ts` with `profileFor('remote-attached')`, `setMode('bypassPermissions')`,
a `runShell` turn; assert one approval was raised.

**ENG-2. Text bridge rejects a final answer containing any JSON object with a `name` or `function` key** _(repro-confirmed)_.
`os-code/src/core/tools/parser.ts:88-98` treats every balanced object as a
candidate and flags an unknown tool. `Done. Here is the package.json I created:`
followed by a `{"name": "my-app", ...}` block yields `problems: ['There is no
tool named "my-app"...']` and a truncated remainder; `loop.ts:462-487` then
runs two repair rounds and escalates. Fix: raise unknown-tool only when the
object also carries an args-shaped key (`args`, `arguments`, `parameters`,
`input`). Verify: `test/parser.test.ts` with that string expects zero problems;
`{"name":"readFile","arguments":{"path":"x"}}` still parses.

**ENG-3. Permission path globs match the raw model-supplied path** _(repro-confirmed)_.
`loop.ts:572` passes `tool.pathOf(call.args)` unnormalized; `permissions/index.ts:111`
runs `minimatch` on it. A deny rule on `secrets/**` gives `deny` for `secrets/k`
but `ask` for `./secrets/k` and `src/../secrets/k`, and under `acceptEdits` that
`ask` becomes `allow`. On the allow side, `loop.ts:650` builds `/**` for a
root-level file, which never matches, and `addProjectPermissionRule`
(`config/load.ts:156-168`) persists that dead rule while telling the user the
tool "is allowed from now on." Fix: normalize once in `executeCall` via
`jail.resolve` then `relative(cwd)`; use `**` at the root. Verify:
`test/security.test.ts` add the two dotted cases expecting `deny`;
`agentLoop.test.ts` approve `alwaysInProject` on `README.md` and assert the next
call is allowed.

**ENG-4. "Always allow in this project" for `runShell` persists an unscoped blanket allow that also sidesteps the profile guard in later sessions.**
`types.ts:23-26` promises scoping to the command's first word; `loop.ts:649-651`
computes `pathGlob` only from `pathOf`, so the rule written is
`{tool:'runShell', decision:'allow'}`. `permissions/index.ts:108-114` evaluates
config rules before the profile checks, so that rule auto-runs shell on a
`remote-attached` phone session. UNCONFIRMED whether the app offers
`alwaysInProject` for shell (grep `app/src`). Fix: refuse `alwaysInProject`
for path-less tools or add a `commandPrefix` rule field; apply
`allowShellAutoApprove` to config-rule allows. Verify: `agentLoop.test.ts`
second, different command still asks; `security.test.ts` a `runShell allow` rule
under `remote-attached` yields `ask`.

**ENG-5. The workspace walker skips `.github`** _(repro-confirmed)_.
`os-code/src/core/tools/walk.ts:44` uses `!entry.startsWith('.git')`, which
drops `.github` and `.gitlab`. Callers: `glob.ts:19`, `grep.ts:63` (JS
fallback), `context/codeMap.ts:87`, `context/index.ts:83,204`, `listFiles`.
"Fix my CI workflow" gets "Nothing matches .github/\*\*" unless ripgrep is
installed. Fix: `entry !== '.git'`. Verify: walker test lists
`.github/workflows/ci.yml` and not `.git/HEAD`.

**ENG-6. Compaction can cut between an assistant `tool_use` and its `tool_result`, which 400s the next Anthropic turn.**
`os-code/src/context/compaction.ts:64-67` keeps `rest.slice(-8)` verbatim with
no regard to pairing; `providers/anthropic.ts:290-296` still emits the orphaned
`tool_result`, which Anthropic rejects. Same failure class as C2 from August,
arriving exactly when a cloud session gets long. Fix: advance the cut point
past any leading `tool` messages so the tail starts on a `user` message.
Verify: build a history where index `-8` is a `tool` message, run
`compactHistory`, assert the tail begins with `role:'user'`.

**ENG-7. `/compact` after an aborted task silently drops the older turns instead of summarizing them.**
`loop.ts:878` passes `this.abortController?.signal`, which stays aborted until
the next `run()`; `compactNow` (`:146-161`) is idle-only so it always sees the
stale signal; undici throws immediately; `compaction.ts:84-86` substitutes the
"earlier turns were dropped" marker while the status still says "Compacted the
conversation." Fix: idle work (`compactNow`, `generateTitle`) must not inherit
the task signal. Verify: `agentLoop.test.ts` abort, then `compactNow()` on an
over-budget history; assert the summarize request reached the mock provider.

**ENG-8. `gitCommit` with no paths stages the whole repository, and explicit paths bypass the jail.**
`os-code/src/core/tools/git.ts:78` runs `git add -A` with no pathspec, which
since Git 2.0 stages the entire working tree, not the cwd. A workspace that is
a subdirectory of a repo commits unrelated changes, including an `.env` two
levels up. `args.paths` are handed to git unresolved. Fix:
`['-A', '--', '.']` when no paths; `jail.resolve` each explicit path. Verify:
new `test/gitTools.test.ts` with a dirty root file and a dirty `pkg/` file,
`cwd = pkg/`, assert only `pkg/` is committed and `../root.txt` is refused.

### Daemon, providers, git (DAE)

**DAE-1. `GET /sessions` and `GET /workspaces` disclose every user's sessions to any member.**
`serve.ts:560-568` returns all live and stored sessions with no owner filter;
`:244-247` lists every session cwd. Titles are the user's first prompt
(`session.ts:275-279`), so a member reads other people's prompt text, session
ids, and workspace paths. Fix: filter both by `ownedBy`; admins see all.
Verify: daemon test, member lists and sees exactly its own.

**DAE-2. Anthropic in-stream `error` events are silently dropped.**
`os-code/src/providers/anthropic.ts:175-216` handles four event types only; an
`{"type":"error","error":{"type":"overloaded_error"}}` event is ignored and the
loop ends with `stopReason: 'end'` and a truncated answer presented as complete.
Because no `ProviderError` is thrown, the transient retry (`loop.ts:836-853`)
never runs. Fix: `case 'error': throw new ProviderError(...)` with the 529 hint.
Verify: `test/providerAbort.test.ts`-style mock streaming a delta then an error
event; expect rejection with the overloaded hint.

**DAE-3. No idle timeout on any provider stream; a stalled local server hangs the task until manual abort.**
`openaiCompatible.ts:209-214, 297-302, 492-514` and `anthropic.ts:134-139, 158-162`
loop on `reader.read()` with no deadline; the wall-clock rail runs only between
turns. Ollama loading a large model or a half-open tailnet socket leaves the
phone spinning while the daemon's own SSE keepalives make everything look
alive. Fix: an idle deadline reset on every chunk (about 120s) combined with the
caller's signal via `AbortSignal.any`, surfacing "no bytes for 120s from
<label>". Verify: a local `http.createServer` that writes headers and one chunk
then stalls; `provider.chat()` rejects within the window.

**DAE-4. Stop does not stop a delegated specialist subtask.**
`os-code/src/router/router.ts:127-132` calls `provider.chat` with no signal, and
no signal reaches `ToolContext`. A user who hits Stop during a vision or coding
delegation waits for the whole local generation. Also (P2-class) the delegated
turn never notes cloud usage, so its dollars are invisible to the dollar rail
and to Stack Health's `cloudTurns` seal. Fix: put the task's `AbortSignal` on
`ToolContext` and pass it through `delegate`; note usage from the delegated
stream. Verify: router test, abort after the first delta, `delegate` resolves
within a tick; `usage.session.dollars > 0` after a cloud delegate.

**DAE-5. A terminal that exits never tells the client; the stream looks frozen and stdin 404s with the wrong message.**
`os-code/src/daemon/terminal.ts:179-181` only sets `entry.exited = true`;
`GET .../stream` (`serve.ts:771`) opens on a dead shell; `write()` returns false
and the route answers 404 "No terminal" (`serve.ts:838-841`). The phone's reader
(`app/src/drivers/remoteDriver.ts:528-545`) has no exit frame to parse. Fix: push
a final `{exit, offset}` frame, end the SSE responses, drop the entry after a
grace, answer stdin with 409 "shell exited". Verify: `test/terminal.test.ts`
"exit notifies subscribers".

**DAE-6. `info.json` is rewritten non-atomically on every event, including each text delta; a crash hides the whole session.**
`session.ts:272-284` does `readFileSync` plus `writeFileSync` (truncate then
write) per emit; `load.ts:130-134` and `session.ts:636-638` already use
tmp-plus-rename. A torn `info.json` makes `listSessions` skip the session
(`session.ts:85-88`), rehydrate 404s, and the intact journal is orphaned. Fix:
atomic helper, and only on `task-start`, `task-done`, `title`, `terminal-*`;
a repair path in `listSessions` for a torn info next to a valid journal.
Verify: truncate `info.json` to zero bytes and assert the session still lists.

**DAE-7. Two phones scanning the same QR share one push registration (TS-P2-5 still open).**
`serve.ts:223` keys `savePushConfig(auth.userId, ...)`; the QR credential is
minted once and cached (`app/electron/engineHost.ts:74-92`), so every device
resolves to the same `userId` and `push.ts:62-70` overwrites, last writer wins.
PROGRESS records TS-P2-4 as making userIds distinct; mint-once means it does
not. Fix: key by `${userId}:${deviceId}` and fire to every grant. Verify:
`test/push.test.ts` "two registrations for one user both receive the push".

### App state, drivers, lib (APP)

**APP-1. Half the Supabase calls use the stored access token raw and never refresh it; the purchase path is the casualty.**
`app/src/state/store.ts:2162` (`link-apple-purchase` in `buyPersonal`), `:2200`
(`restorePurchases`), `:2929`, `:2954` (`refreshEntitlement`), `:3013`
(`stripe-portal`), `:2819` (`updateMyPassword`), `:1419-1465`
(`pushOrgToServer` / `pullOrgFromServer` at launch, `:1922`). Four other callers
do refresh (`:1513`, `:1527`, `:1669`, `:2892`). `jwt_expiry = 3600`. After an
hour with the app open, `buyPersonal` completes the Apple charge and then fails
to link the JWS with a 401, and `reconcileEntitlementOnForeground` and
`restorePurchases` fail the same way, so "Your unlock will appear shortly" never
does until a relaunch. Fix: one `accessToken()` helper (the existing
`orgProjectToken` at `:1524-1530`) for every Supabase call, and single-flight
the refresh (`freshSession` is called concurrently from five places). Verify:
`test/store.test.ts` seed `expiresAt: Date.now() - 1`, mock `refreshSession`,
call `refreshEntitlement()` and `buyPersonal()`; both used the refreshed token
and `refreshSession` ran once.

**APP-2. A dead refresh token leaves a zombie "signed in" session with no way out.**
`app/src/lib/authSession.ts:21-28` says the caller signs out on failure; no
caller does (`store.ts:2887-2911`, `:1664-1675`, `:1516-1518`), and `:1877`
restores the stored session without validation. Fix: on a 400/401 from
`/token` (`invalid_grant`), clear the stored session and rethrow a typed error
the store catches in one place, toasting "Your sign-in expired. Sign in again."
Verify: new `test/authSession.test.ts`.

**APP-3. On-device drivers each think they own the single loaded model; two device chats answer with the wrong model.**
`app/src/drivers/onDeviceDriver.ts:104-141` (`if (!this.loaded)`),
`stackDriver.ts:390-408` (`loadedDeviceId`), `LlamaRunner.swift:7-24` (one
`llm` slot), `llamaPlugin.ts:65-71` (`generate` takes no model id), drivers kept
alive per conversation (`store.ts:371`). Open a Harbor chat, then a Qwen chat,
return to Harbor and send: it generates against Qwen with Harbor's prompt, or
runs a 4096-context conversation on a model loaded at 2048. Fix: one owner of
`loadedModelId` in `llamaPlugin.ts`, both drivers compare before every
`generate`. Verify: `test/onDeviceDriver.test.ts` two drivers `a`, `b`; send
a, b, a; assert `Llama.load('a')` is called again before the third generate.

**APP-4. A terminal daemon answer leaves the thread stuck busy and the dead driver attached.**
`remoteDriver.ts:269-272` (`emitTerminal` emits only a `status`),
`transcript.ts:70-81` (only `task-done` clears `busy`), `store.ts:4062-4076`
(`send` queues while busy), `:4005` (reuses any driver in the map). When the
replayed journal ended mid-run, every later message silently queues and
re-pairing never rebuilds the driver. Fix: `emitTerminal` also emits
`task-done` with `reason: 'error'`; the store drops the driver on terminal.
Verify: `test/remoteDriver.test.ts` stream `task-start` then 404 three times;
`thread.busy` is false after `reduceEvents`.

### Screens, components, Electron, native (UI)

**UI-1. Loading a second pocket model while a reply streams strands the first chat busy forever.**
`app/plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin/LlamaRunner.swift:17-19, 29-34, 66-74`:
`load()` calls `unload()`, which nils `currentRequestId`; the in-flight task's
guard then returns without calling `onDone`. `onDeviceDriver.ts:76-80` clears
`activeRequestId` only on `generationDone`, so chat A spins until restart; the
`BackgroundActivity("oscode.generate")` (`OscodeLlamaPlugin.swift:283-304`)
never ends, and the old LLM keeps running while the new one loads (double
memory). Fix: in `unload()` and at the top of `load()`, `stop()` then
`onDone("stopped", "Another model was loaded.")` before clearing state;
serialize load and generate on one queue; a JS-side watchdog. Verify: on
device, start a Harbor reply, open another pocket model chat and send; chat A
ends in a stopped state. Swift test with a stub `LLM` asserting `onDone` fires
on `unload()`.

**UI-2. iCloud Vault hides evicted notes, so a same-name create or wikilink overwrites the cloud copy.**
`OscodeIcloudPlugin.swift:80-88` skips every `.icloud` placeholder in `list`,
so an evicted note is absent from `vaultFiles`; `store.ts vaultCreate` guards
on `vaultFiles` only and then writes `''` with `.forReplacing` (`:151`).
`ModelStore.swift iCloudModels()` already does the right thing for models
(reports `evicted: true`). Fix: strip the placeholder name, emit `evicted: true`;
`vaultCreate` treats an evicted match as existing and routes to `vaultOpen`.
Verify: two-device repro with Remove Download, then create the same name; the
original survives.

**UI-3. Phone-to-hub install poll never exits and outlives the screen.**
`app/src/screens/MarketplaceScreen.tsx:541-565`: `for (;;)` with `catch { continue; }`,
no cancellation, no failure cap, no request timeout; keeps calling
`setDownloads` after unmount; each tap starts another loop. Fix: `cancelledRef`
checked each iteration, cap consecutive failures (about 10, then a "hub stopped
answering" state), `AbortSignal.timeout(8000)`. Verify: extract
`pollInstall(progressFn, sleepFn, signal)` and test both exits.

**UI-4. ModelSheet snap-unmounts on every pick (the most-used sheet in the app).**
`app/src/components/ModelSheet.tsx:233, 272, 288, 299, 315, 384, 412, 445, 474`
call `onPick` directly; `ChatScreen.tsx:631-634` flips `sheetOpen` synchronously
and the sheet is conditionally mounted (`:628`). The polish guard passes because
the scrim binds `closing`. `ApprovalSheet.tsx:41-50` shows the right pattern.
Fix: `pending.current = () => onPick(s); dismiss();` with `useSheetExit`.
Verify: extend `test/polish-standards.test.ts` so a file importing
`useSheetExit` cannot call `onPick(` outside a path that also calls `dismiss(`.

**UI-5. Embedded Codemagic view grants camera, mic, and geolocation with no prompt.**
`app/electron/embeddedWeb.ts:146-153` creates the view on
`persist:embedded-codemagic`; nothing calls `setPermissionRequestHandler`, so
Electron's default approves everything for any host inside the fence. The
`/orgs/` prefix (`:41`) allows any GitHub org page, wider than the "sign-in
pages" comment; sub-frame navigations are unfenced (`will-frame-navigate`
unused). Fix: deny-all permission handler on that partition, add
`will-frame-navigate` to the fence, tighten `/orgs/`. Verify: read-test that
`embeddedWeb.ts` contains `setPermissionRequestHandler`; manual `getUserMedia`
in the embed is denied.

### Backend and money (BE)

**BE-1. An org admin can insert an `org_members` row with an arbitrary `user_id`, enrolling any user into their org.**
`0002_rls.sql:59-61` (`members_write` WITH CHECK constrains only the caller's
admin-ness), victim uuids are public via reviews (`reviews.ts:27-28`,
`0011:189-191`), and the victim client adopts the first active membership
silently (`store.ts:1448-1455`, `:1493-1497`). The victim loses local admin
authority (`:3025-3035`) and their Team Vault points at the attacker's org
(`:1557-1561`). Fix: WITH CHECK `and (user_id is null or user_id = auth.uid())`,
`revoke update (user_id)` from authenticated; binding stays in
`claim_membership`; client never adopts a server org silently. Verify: the curl
in the reviewer's note; as B, `is_org_member(<A org>)` is true today.

**BE-2. Seat ceilings are never enforced server-side; a $20 Micro entitlement unlocks the app for unbounded members.**
`stripe-checkout/index.ts:93-101` checks once at checkout; `0005:27` leaves
`seat_count` client-writable; `stripe-webhook:72-82` copies it unvalidated;
`0002:59-61` has no cap; `store.ts:1032-1036` makes every member
`personalUnlocked`. Fix: a `before insert or update on org_members` trigger
counting against the entitled band, and a trigger refusing `seat_count` above
it; longer term bill `quantity = seats`. Verify: sixth member on Micro succeeds
today.

**BE-3. `stripe-webhook` has no cross-rail guard: an old Stripe subscription's period-end `deleted` event revokes a user who since bought Personal on Apple.**
`stripe-webhook/index.ts:186-191` matches by `stripe_customer_id` (which the
Apple writers deliberately preserve), then `:131-141` upserts `status` and
`source:'stripe'` unconditionally. Both Apple writers carry the guard
(`apple-notifications:83-96`, `link-apple-purchase:133-147`); the Stripe one
does not. The user stays locked until the next Apple renewal, up to a year.
Fix: mirror the guard in `upsertUserEntitlement`. Verify:
`stripe trigger customer.subscription.deleted` against a `source=apple, active`
row; it flips to canceled today. Extract the decision into
`_shared/entitlement.ts` and unit test it.

**BE-4. `link-apple-purchase` accepts a stale JWS on a fresh account; after a refund, replaying the purchase-time JWS yields the remaining term for free.**
`link-apple-purchase/index.ts:64-73` derives status from the JWS's own dates;
`:92-100` moves the link with no ordering guard; `:126-131` guards only against
the caller's existing row. The JWS reaches JS at `OscodeIapPlugin.swift:103` and
is posted from `store.ts:2162`, so capturing it needs Web Inspector. Fix: keep
subscription state on `apple_links` (`status`, `valid_until`, `last_event_at`),
have `apple-notifications` write it, refuse a JWS whose `signedDate` is not
newer than `last_event_at`, never grant on a revoked link; better, call the App
Store Server API for live status with the `.p8` the README already reserves.
Verify: sandbox buy, capture JWS, refund, replay from a second account; B reads
`active` today.

**BE-5. Removing a teammate does not remove their shared-project access.**
`0014_org_projects.sql:83-89` matches `org_project_members` by `user_id` or
email only; org membership is checked at grant time only (`:260-264`); Vault
does it right via `is_org_member` (`0010:85`). Fix: in `project_level` require
an active `org_members` row; optionally a trigger cascading deletes. Verify:
remove X, then as X `list_org_projects()` still returns rows.

**BE-6. Reviews: table-wide INSERT and UPDATE grants let an author write `flag_count`, `status`, and `created_at`, making their review report-proof.**
`0011_model_reviews.sql:238` (no column list), `:195-201` (no `status` guard on
UPDATE), `:100-104` (auto-hide fires on `flag_count + 1 >= 3`); the client sends
`status: 'visible'` on every submit (`reviews.ts:150`). Confirmed: insert with
`flag_count: -1000000` defeats the Apple 1.2 auto-hide. UNCONFIRMED: a hidden
review re-submitted with `resolution=merge-duplicates` may un-hide itself. Fix:
column-level grants, UPDATE USING `status = 'visible'`, drop `status` from the
client payload. Verify: the curl in the reviewer's note succeeds today.

**BE-7. `stripe-checkout` double-subscribes when the existing subscription is `past_due`, `unpaid`, `trialing`, or `incomplete`.**
`stripe-checkout/index.ts:120, 210` list `status: 'active'` only. A failed card
puts the sub in `past_due` (revoked, so the UI shows Buy); a second purchase
creates a second sub while Smart Retries keep the first alive, and the webhook
flip-flops between them. Fix: `status: 'all'` and route to the portal when any
sub is in the live set. Verify: Stripe test clock, fail renewal, call
`stripe-checkout`; a second `sub_` appears.

### Infrastructure (INF)

**INF-1. CI never builds the app, so a bundling break reaches `main` and is first seen on the TestFlight pipeline.**
`.github/workflows/ci.yml:50-60` runs engine build, lint, typecheck, test; no
`vite build`, no electron `tsc` emit. `codemagic.yaml:74` builds only after
merge. Fix: `pnpm -r build` after "Build the engine". Verify: add a bad
`@import` to `theme.css`; CI stays green today.

**INF-2. The em-dash "TOTAL" guard has a scope hole: 46 em dashes are tracked today.**
Both guards scan from their own package root (`os-code/test/em-dash-policy.test.ts:16,32`,
`app/test/em-dash-policy.test.ts:10,16`), so root `*.md`, `docs/`, `supabase/`,
`.github/`, and `codemagic.yaml` are never read, and `.yml`, `.sql`, `.swift`
are not in the extension set. Hits: `CODE-REVIEW-FINDINGS.md` (44),
`docs/TESTFLIGHT.md:39,112` (2), plus `os-code/test/outbox.test.ts:155`, a real
em dash in a comment that the `.test.` exclusion skips even though CLAUDE.md
says "comments included". Fix: resolve `ROOT` with
`git rev-parse --show-toplevel` in one guard, add the extensions, narrow the
self-exclusion to the two guard files plus reasoned `EXEMPT_FILES` entries for
the three regex lines (`greeting.test.ts:86`, `harborGuides.test.ts:29`,
`effort.test.ts:37`), archive or rewrite the 46. Verify: the guard goes red on
the current tree, then green.

**INF-3. A failed `node-pty` rebuild is swallowed, and nothing checks it before the desktop launches.**
`app/package.json:15` `postinstall` ends in `|| echo`, exit 0 either way; in
this checkout `node-pty` has no `build/Release/` at all and `pnpm install`
reported nothing. The desktop terminal runs in-process (`engineHost.ts:14,656`)
and `terminal.ts:45` raises `TerminalUnavailable` at first use;
`desktop-preflight.mjs` checks only `$DISPLAY`. Fix: preflight asserts
`node-pty/build/Release/pty.node` loads under Electron and exits non-zero with
the `rebuild:native` hint. Verify: remove the build dir and run `pnpm desktop`;
today it launches with a dead terminal.

**INF-4. `catalog.yml` hands the marketing-repo write token to every step, including dependency install.**
`.github/workflows/catalog.yml:52-64` sets `MARKETING_DEPLOY_TOKEN`, `HF_TOKEN`,
`CATALOG_REVIEWS_*` at job level, so they are in the environment of
`pnpm install` (which runs build scripts for electron, esbuild, node-pty, and
the app postinstall), the vitest run, and the builder that fetches HF discovery
for arbitrary repos. Neither workflow declares `permissions:`. That PAT writes
to the marketing site's `main`, which Cloudflare deploys unattended. Fix:
step-level `env:` on the steps that need each secret, `permissions: contents: read`
at the top of both workflows, SHA-pin actions. Verify: `printenv | grep MARKETING`
in the install step prints nothing.

**INF-5. `PROGRESS.md` no longer follows its own contract, and its "What remains" list gives wrong directions.**
3,746 lines, 40 stacked `## Current state` sections (lines 6-2340), a 487-line
parked-ideas block, then the log. Stale items: `:2470` "First Codemagic build to
TestFlight" unchecked (about 62 builds have shipped per `codemagic.yaml:82`);
`:2433-2459` still describes Personal on Stripe and a public pricing page,
contradicting `DECISIONS.md:211-221`; `:2468` "First desktop run" unchecked
(done 2026-09-02); `:129-138` says admin visibility and the optimizer are
"captured for sign-off" while `:6-48` says both shipped. Fix: one Current state,
one reconciled What remains, the other 39 sections into the log or an archive,
parked prompts into their own file. Verify: `grep -c "^## Current state"` is 1.

**INF-6. No license has been chosen, while builds ship and plugins declare MIT.**
`os-code/LICENSE:1-9` is a TODO; all four `app/plugins/*/package.json` say
`"license": "MIT"`. TestFlight builds are going to testers now. Fix: founder
decision (CFO and CTO); until then set the plugins to `UNLICENSED` or
`SEE LICENSE IN ../../os-code/LICENSE` so nothing is granted by accident.

---

## P2, robustness and hygiene

### Engine

- **ENG-9.** Redaction misses JSON-quoted keys: `redaction.ts:34` needs the colon right after the name, so `"GITHUB_TOKEN": "..."` passes untouched while `GITHUB_TOKEN=...` is scrubbed _(repro-confirmed)_. Fix: `\b(NAME)["']?\s*[:=]`. Verify: `security.test.ts` JSON-key case.
- **ENG-10.** Chunk-boundary leak in the streamed command lane: `commandRunner.ts:88-97` redacts each chunk independently; a secret split across two chunks reaches the phone's `command-output` events and the journal. Fix: a 64-char carry per stream. Verify: `commandRunner.test.ts` with a `sleep` between the two halves.
- **ENG-11.** A native batch with one valid and one invalid call drops the problems silently (`loop.ts:447-460`); the model retries identically. Fix: a synthetic observation per rejected native call. Verify: `agentLoop.test.ts`.
- **ENG-12.** Steps rail trips one call early (`guardrails/index.ts:49,86-87` with `loop.ts:564-566`: `steps >= ceiling` after `noteStep`), so `headless` gets 39 runs and the message says 40. Fix: `steps > ceiling`. Verify: exactly `maxSteps` tool-end events.
- **ENG-13.** Compaction stage 1 is dead for text-bridge models _(repro-confirmed)_: `compaction.ts:33` trims only `role:'tool'`, but text-bridge observations are `role:'user'` with a `[name result]` prefix (`loop.ts:706`). Fix: also trim those, or tag observations with `meta.observation`. Verify: unit test on `trimOldObservations`.
- **ENG-14.** `summarize()` cloud spend bypasses the dollar rail and the transcript (`loop.ts:882-884`, fixed 600-token guess, no `noteDollars`, no `usage` event). Fix: read the provider's usage events. Verify: `guardrails.spentDollars > 0` after `compactNow()` on a cloud mock.
- **ENG-15.** Pending approvals leak after an abort: `session.ts:301-316` keeps the resolver forever and a late `answerApproval` emits a phantom `approval-resolved`. Fix: `LocalDriver.abort()` settles and deletes every pending approval. Verify: `pendingApprovals.size === 0` after abort.
- **ENG-16.** Egress `fetch` replays the full `init` (auth headers, body) across cross-host redirects (`egress.ts:140`); `readability.ts:33` passes a dead `redirect:'follow'`. Fix: drop `authorization` and `x-*-token` on an origin change, convert 301/302/303 POST to GET. Verify: D2 case with a cross-origin 302 asserts the header is absent.

### Daemon

- **DAE-8.** Request bodies are unbounded (`serve.ts:1049-1063`); `/outbox/apply` writes each `contentBase64` to a temp file. Fix: cap (8 MB general, larger for outbox), answer 413. Verify: a 20 MB post expects 413 and a live daemon after.
- **DAE-9.** Stack Health visibility can be silently overridden by a project config in the daemon's cwd: `serve.ts:441,463` call `loadConfig()` (merges the cwd project file) while the POST writes only the global file (`:475`). Fix: read daemon-owned settings from the global file only. Verify: project config in cwd, POSTed value wins.
- **DAE-10.** Outbox: `update-index --force-remove f.path` has no `--` and `confinedPath` (`outbox.ts:86-96`) accepts a leading `-`; `serve.ts:371` keys the lock on the raw request `cwd` while the receipt is keyed on the toplevel, so `repo` and `repo/` bypass serialization. Fix: `--`, reject `^-`, lock on `realpathSync(cwd)`.
- **DAE-11.** `close()` does not drop live SSE sockets (`serve.ts:962-965`, `server.close()` only); Electron's `daemonStop` can hit EADDRINUSE on restart. Fix: `closeAllConnections()` on both servers. Verify: extend `test/daemonBind.test.ts`.
- **DAE-12.** Unbounded growth: `drivers` and `notifier.watched` never evict, every `LocalDriver` holds its full journal in memory, no `DELETE /sessions/:id`, `listSessions()` re-reads every `info.json` per call. Fix: idle eviction, a delete route, an index file.
- **DAE-13.** CLI attach retries 401/404 forever and drops `alwaysInProject` and `reason` (`attach.ts:80-107`, `:154-163`); the phone got the TS-P2-1 fix, the CLI did not. Fix: stop on 401 and repeated 404; forward all four fields.
- **DAE-14.** Terminal routes look up `termId` alone (`serve.ts:771, 837, 855, 866`), so `/sessions/A/term/<B's term>/stdin` works and the audit marker lands on the wrong journal. Admin-only today. Fix: `terminals.has(termId, sessionId)`.
- **DAE-15.** CORS `*` unchanged (`serve.ts:47-52`, TS-P2-10). Fingerprinting only, since the bearer gates everything. Either reflect an allowlist or record the acceptance in DECISIONS.md so it stops resurfacing.
- **DAE-16.** Clone target name from `basename(url)` can resolve to `.` or `..` (`serve.ts:259-265`), landing on `~` or `~/OSCode`. Admin-only. Fix: require `^[A-Za-z0-9._-]+$`.

### App

- **APP-5.** Conversation `source.sessionId` is mutated outside `set` and not persisted until the next event (`store.ts:1281, 1305, 4012-4025, 1155-1159`); a kill between `POST /sessions` and the first message orphans a daemon session. Fix: `buildDriver` returns the id; write through `set` and persist. Verify: persisted blob carries `sessionId` before any event.
- **APP-6.** The login-CSRF binding is lost on a cold start (`store.ts:390, 2842`, `useAuthDeepLink.ts:64-66`): the "same account we asked for" check is skipped exactly when a magic link launches the app from Mail. Fix: persist `pendingAuthEmail` with a 15-minute TTL; refuse an unsolicited callback. Verify: `vi.resetModules` between `sendMagicLink` and `completeAuthCallback` with a mismatched email.
- **APP-7.** Sign-out leaves the org roster and local admin authority on the device (`store.ts:2853-2885` clears session and roles but not `settings.account`, `pendingAuthEmail`, `passwordRecovery`; `:929-933`, `:3025-3035` fall back to the local roster). Fix: drop `account` when `org.serverId` is set; clear the other two. Verify: `authorizeAdmin()` is false after sign-out.
- **APP-8.** Sealed-store writes are not serialized (`platform.ts:152-164`; `saveSettings` is fire-and-forget from many actions), so an older snapshot can land last and a setting "reverts after relaunch". Fix: per-key promise chain in `storeSet`. Verify: slow first write, fast second, final value is the second.
- **APP-9.** Daemon helpers without timeouts (`remoteDriver.ts:127, 147, 153, 168, 196, 215`) can pin `outboxSyncing` and the repo picker forever; TS-P2-2 covered the session verbs only. Fix: `AbortSignal.timeout` (10s; 60s for clone and apply).
- **APP-10.** `sendWhenAttached` drops the first message after 5 seconds (`store.ts:2348-2365`); a desktop conversation's `daemonCreateSession` alone has a 10s timeout. Fix: persist a `pendingFirstMessage` and flush in `attachDriver`.
- **APP-11.** The hub pairing credential still rides the sealed settings blob, not the Keychain (`store.ts:234-238`, `PairScreen.tsx:258, 354`; TS-P2-11 half open). Fix: `secretSet('oscode.secret.hub.<baseUrl>')` with a one-time migration. Verify: `JSON.stringify(settings)` does not contain the token.
- **APP-12.** GitHub repo list cached in plain `localStorage` (`chatRepos.ts:113-130`), unsealed and not cleared on disconnect (`store.ts:3231-3239`). Fix: route through `storeSetJson` and delete on disconnect.
- **APP-13.** Journal replay is one `set` per event and in-memory transcripts are never trimmed (`store.ts:1050-1067`, `transcript.ts:94-97`, trim only at persist `:4635`). Fix: buffer replay into one `set`; cap in-memory items.

### UI, Electron, native

- **UI-6.** IPC handlers accept unvalidated arguments and never check the sender (`electron/main.ts:403-423, 457-459, 571-576`). Defense in depth today (CSP `'self'`, pinned navigation); one future XSS in markdown turns it into RCE. Fix: a `guarded(channel, fn)` wrapper checking `event.senderFrame.url === appEntry.href` plus `typeof` and `statSync(cwd).isDirectory()`. Verify: read-test that every `ipcMain.handle(` goes through the wrapper.
- **UI-7.** Double haptic on iOS for most tapped buttons: `App.tsx:133-141` fires `hapticTick()` on capture for every enabled button, and components fire it again (`BackBar.tsx:63,72`, `ChatScreen.tsx:357,370`, `MessageList.tsx:263,282`, `Markdown.tsx:60,73`, `EmbeddedSite.tsx:86,95,111`, `Composer.tsx:337,365`). Fix: remove the component-level ticks on button handlers or honor a `data-haptic="own"` attribute. Verify: a polish-standards assertion.
- **UI-8.** The motion guards read only `theme.css`; inline TSX motion drifts unchecked. `Stars.tsx:71` is the exact foreign curve the token test bans, an ad-hoc 260ms, and a `width` transition in one line. `index.html:66-68, 130-131, 174, 225, 273` carry raw curves and `fill-mode: both` (documented, reduced-motion handled; treat as a stated exemption). Fix: `transform: scaleX()` on a `.stars-fill` with tokens; extend the guard to scan `style={{ transition:` in `.tsx`. Verify: the extended guard fails on `Stars.tsx` then passes.
- **UI-9.** Focus trap and dialog a11y: `useSheetFocusTrap.ts:16-18` traps only `.sheet:not(.closing)`, so confirm cards and the drawer let Tab escape; focus is never restored to the opener; the `MutationObserver` (`:48-53`) runs `querySelectorAll` on every streamed token; `Composer.tsx:714` textarea has no `aria-label`; `ChatScreen.tsx:463-467` uses `<h1 role="button">`. Fix: widen the selector, remember and restore `activeElement`, observe only the sheet roots.
- **UI-10.** Purchase can charge with no unlock and the copy does not name the recovery (`OscodeIapPlugin.swift:95` finishes the transaction before the server sees it; `store.ts:2161-2168` toasts the raw error). Fix: a toast that says Apple confirmed and to tap Restore when back online; retry the link in `reconcileEntitlementOnForeground`. (Compounds APP-1.)
- **UI-11.** Duplicate `downloadModel` calls orphan a kept-alive plugin call (`OscodeLlamaPlugin.swift:161-165` overwrites `pendingDownloads[id]`); the earlier JS promise hangs. Fix: settle all, or reject the earlier one.
- **UI-12.** `TerminalScreen.tsx:186-189` clears `flushTimer` without flushing (its sibling `DesktopTerminal.tsx:170-173` flushes); a `y` typed right before Back is lost. Both hard-code the xterm background (`:63`). Fix: `flush()` before dispose; derive the theme from tokens.
- **UI-13.** `SourcePicker.tsx` is imported by nothing (TS-P1-6 follow-up left open). Fix: delete it or wire it; add a one-line test that every component is imported somewhere.

### Backend

- **BE-8.** The `last_event_at` ordering guard is read-then-write (`stripe-webhook:62-69, 84-93`; `apple-notifications:73-81, 102-111`); parallel deliveries can let the older event win. Fix: a `security definer` `apply_entitlement_event(...)` with the comparison in the `where`.
- **BE-9.** Neither Apple function checks `productId` or transaction `type` (`link-apple-purchase:64-73`, `apple-notifications:158-182`); any future IAP for this bundle becomes lifetime Personal (a non-subscription has no `expiresDate`). Fix: an `APPLE_PRODUCT_IDS` secret and reject non-subscription types.
- **BE-10.** `org_vault_put` accepts any `p_path` and any body size (`0010:82-84`); `vaultExport.ts:31-37` writes `Documents/Vault/<path>` recursively, so a teammate can store `../../x.md`. Fix: reject `..`, leading `/`, and bodies over 1 MB in the RPC; skip `..` on export.
- **BE-11.** `push-register` does not validate the device token (`push-register/index.ts:31`; `0009:33-35` PK is the token), so a known token's row can be re-pointed by any signed-in user. Fix: `/^[0-9a-f]{64}$/i`.
- **BE-12.** Repo OAuth has no PKCE (`repo-oauth/index.ts:192-199`; `repoOAuth.ts:19-20` argues it is unnecessary), which matters on desktop where another app can register `oscode://`; provider error text is reflected into toasts (`:167, 211`). `state` is verified and tested, which closes login-CSRF. Fix: add PKCE; map provider errors to fixed strings.
- **BE-13.** Ledgers grow forever (`apple_notifications_seen`, `push_sends`) and one unmapped price wedges the whole Stripe endpoint (`stripe-webhook:57, 117-119` throw, so Stripe retries for days and eventually disables the endpoint for every org). Fix: pg_cron retention; log and 200 for prices in an explicit ignore list.

### Infrastructure

- **INF-7.** Node version drift: CI Node 20 (`ci.yml:39`), Codemagic 22.22.2, `os-code` engines `>=20`, README "Node 20+", while `@capacitor/cli` 8.5 requires `>=22`. Fix: root `engines`, `.nvmrc`, `node-version-file` in both workflows.
- **INF-8.** No format check in CI and no app-side format script; 17 files drift today. Fix: `format:check` in app and a CI step.
- **INF-9.** ESLint 8.57 (EOL 2024-10) and typescript-eslint 7.18 (declares TS `<5.6`) against TS 5.9.3; every lint prints the unsupported-version warning. Fix: ESLint 9 flat config and typescript-eslint 8; record the supersession in DECISIONS.md.
- **INF-10.** Stale nested `os-code/pnpm-lock.yaml` (last touched at `8f95c53`); `os-code/README.md:23` tells people to install inside `os-code`, which uses it standalone. Fix: delete it and point the README at the root.
- **INF-11.** Unpinned actions (`@v4` tags) and `xcode: latest` in `codemagic.yaml:18`. Fix: SHA-pin; pin Xcode to the last green version.
- **INF-12.** Docs drift: `os-code/docs/MARKETPLACE.md:192` says weekly, `catalog.yml:30` is daily; `CATALOG_ALLOW_LARGE_DROP` cannot be passed because `workflow_dispatch` has no inputs.
- **INF-13.** `supabase/functions/_shared/entitlement.test.ts` is a Deno test that never runs in CI (`supabase/` is not a workspace package). Fix: a `denoland/setup-deno` step.
- **INF-14.** Lint excludes `*.cjs` and `*.mjs`, so `app/electron/preload.cjs` (the `contextBridge` surface) and `app/scripts/*.mjs` are unlinted.
- **INF-15.** Codemagic and CI do Electron work an iOS build does not need (Electron download and `electron-rebuild` per TestFlight build; os-code built twice at `codemagic.yaml:65,72`). Fix: `ELECTRON_SKIP_BINARY_DOWNLOAD=1` and a `SKIP_NATIVE_REBUILD=1` guard.
- **INF-16.** Model-drives-Codemagic gate is client-side only but structurally closed (no OpenShore server is in the loop; the engine registers the tool only when a token arrives, every call is `cloud-spend` risk, the store auto-denies when Off). UNCONFIRMED edge: a desktop session bootstrapped while On keeps its token after the switch flips Off. Verify: On, start a session, Off, ask the model to trigger a build; expect the deny.
- **INF-17.** Archive the addressed review docs: `CODE-REVIEW-FINDINGS.md` is ADDRESSED and carries 44 em dashes; the 2026-08-25 and LOCAL-FIRST docs still say "Nothing here is fixed yet" while PROGRESS records them as worked; `AUDIT-P0-ACTION-ITEMS.md` is pinned to a branch name. Fix: `docs/archive/` with a status banner on each.

---

## Still needs the founder (ops, not code)

1. **Supabase Auth, Email, "Confirm email" must be ON** in the hosted project (P0-4), and never run `supabase config push` while `config.toml:37` says `false`. Also confirm "Secure email change" is on, since `claim_membership` keys on the JWT email.
2. **Apple root CA constants are still the `PASTE_` sentinels** (`_shared/apple.ts:65-69`), so every Apple verification throws until `APPLE_ROOT_CA_G3_DER_BASE64`, `APPLE_BUNDLE_ID`, and `APPLE_APP_APPLE_ID` are set (already A3 in `AUDIT-P0-ACTION-ITEMS.md`; still true today). `APPLE_ALLOW_SANDBOX=1` only during review.
3. **Refresh-token rotation and reuse detection** (A5 from 2026-08-20) is still a dashboard toggle with no way to confirm from code.
4. **Seed `review_moderators`** (`0012:6-11`); until then nothing can lift an auto-hide, and BE-6 means nothing can enforce one either.
5. **Set `CORS_ALLOWED_ORIGINS`** (`_shared/cors.ts:11`) now that the marketing origin is known.
6. **Choose the license** (INF-6).
7. **Decide the member command lane** (P0-1): admin-only, or an explicit opt-in config. Both are small changes; the decision is the founder's because it defines what a "member" is.

---

## Still open from the earlier reviews

- TS-P2-1 on the CLI attach path (DAE-13); the phone side is fixed.
- TS-P2-5 push registration per device (DAE-7).
- TS-P2-10 CORS `*` (DAE-15).
- TS-P2-11 hub credential in the settings blob (APP-11).
- TS-P2-12 `close()` leaving SSE sockets open (DAE-11).
- TS-P1-6 `SourcePicker` dead component (UI-13).
- P2-9 engine-side header forwarding across redirects (ENG-16).

Everything else those two reviews listed as fixed is fixed and holding.

---

## What is in good shape

- **The jail and egress.** Lexical containment plus deepest-existing-ancestor realpath; manual redirects with the policy re-run on every hop, bounded at 10, IPv6 bracket and zone normalization, DNS-pinned `httpFetch` on the desktop with private-range refusal on every hop.
- **Journals and secrets.** Redact before seal, trailing-newline guard, the at-rest key lock with a cross-process create lock; every app-side key, OAuth token, BYOM key, Codemagic token, and project secret goes through Keychain or safeStorage; zero `console.*` in `app/src`; no secrets in the tree.
- **Loop cancellation and the edit engine.** The C1/C2/C3 abort fixes hold with tests; both provider adapters refuse to flush partial tool-call fragments on abort; the edit engine treats ambiguity as a rejection, never a guess, with post-write hash verification.
- **Daemon credentials.** 256-bit tokens, SHA-256 hashed per-device credentials with expiry, constant-time compares, mode-600 files, the pairing clear token rotated on revoke; the new Stack Health gate and scope stamp have three tests.
- **Outbox.** Plumbing-only commits that never touch the working tree, temp index, CAS ref update, rescue branch instead of force-push, flushed receipts for idempotency, and the overlay-onto-tip fix, all covered.
- **Money path.** Caller-scoped RPC client for `is_org_admin`, `orgs` column grants, every webhook write checked, `org_entitlements.status` as the single gate on both sides with identical status sets, Apple verification through Apple's own library with sandbox fail-closed, insert-then-process idempotency with rollback, and every `security definer` function pinning `search_path`.
- **Electron and native.** `contextIsolation`, `sandbox`, `nodeIntegration:false`, `will-navigate` pinned to the bundled entry, `setWindowOpenHandler` deny; Keychain with `AfterFirstUnlockThisDeviceOnly`; GGUF downloads pinned to `huggingface.co`; background `URLSession` with relaunch recovery.
- **Presence and gesture discipline.** Timer-driven exits land under reduced motion; `ApprovalSheet` and `ModeSheet` defer their answers to the exit; the drawer gesture survives lost pointer capture; keyboard-inset and dictation hooks clean up fully.
- **Release gating.** CI on PR and main with `--frozen-lockfile`; Codemagic gates the TestFlight build on lint, typecheck, and test before signing; `catalog.yml` seeds a baseline, no-ops on an empty diff, rebases and retries on a rejected push, and pins on-device URLs to `huggingface.co`.
- **Test hygiene.** 132 test files, zero `.skip`, `.only`, or `.todo`, no snapshot assertions, no TODOs in source, versions pinned exact.
- **Insights math.** Every ratio guarded, avoided floored at zero, buckets anchored to local midnight, labels say "estimate" and the basis travels with the payload.

---

## Suggested execution order

Batch by subsystem so each file is edited once. Write the `Verify` test first.

1. **Trust boundaries (half a day).** P0-1 command lane plus `realpathSync` on both path predicates (`serve.ts`), DAE-1 owner-filtered listings, ENG-1 and ENG-4 profile-aware permission overrides (`loop.ts`, `permissions/index.ts`), ENG-3 path normalization in the same `executeCall` edit. One daemon test block, one security test block.
2. **Session lifecycle (half a day).** P0-2 guardrail reset, ENG-7 idle-work signal, ENG-6 compaction cut point, ENG-12 steps off-by-one, ENG-11 native-batch problems, ENG-15 abort settles approvals. All in `loop.ts`, `guardrails/index.ts`, `compaction.ts`, `session.ts`, tested in `agentLoop.test.ts`.
3. **Streams and timeouts (half a day).** DAE-2 Anthropic error events, DAE-3 idle deadline in both adapters, DAE-4 signal through `delegate`, DAE-5 terminal exit frame, APP-9 daemon helper timeouts, UI-3 install poll.
4. **App auth and sealed store (one day).** P0-3 key lifecycle in `platform.ts` and `main.ts`, APP-1 one token helper, APP-2 typed sign-out, APP-6 persisted pending email, APP-7 sign-out clears, APP-8 per-key write chain, APP-11 hub credential to Keychain. New `platform.test.ts` and `auth.test.ts`.
5. **On-device model ownership (half a day, needs a device).** APP-3 and UI-1 together: one `loadedModelId` owner in `llamaPlugin.ts`, `onDone` on unload in `LlamaRunner.swift`, UI-11 pending downloads. UI-2 iCloud placeholder mapping in the same native pass.
6. **Backend (one day plus a migration).** P0-4 config and SQL belt-and-braces, BE-1 `members_write` WITH CHECK, BE-5 `project_level` membership check, BE-6 review column grants, BE-2 seat triggers, BE-10 vault path guard, as migration `0015`. BE-3 rail guard, BE-4 link state, BE-7 checkout filter, BE-9 product check in the edge functions, with the decisions extracted into `_shared/entitlement.ts` and Deno tests (INF-13 wires them into CI).
7. **Guards and CI (half a day).** INF-1 app build step, INF-2 repo-wide em-dash guard and the 46 cleanups, INF-3 preflight, INF-4 step-scoped secrets and `permissions:`, INF-8 format check, UI-8 TSX motion scan, UI-4 ModelSheet exit with its guard, ENG-5 walker, ENG-9 redaction, DAE-8 body cap.
8. **Docs and housekeeping (two hours).** INF-5 PROGRESS reconcile, INF-17 archive, INF-6 license placeholder, INF-10 nested lockfile, INF-12 doc drift, DAE-15 record the CORS decision.
