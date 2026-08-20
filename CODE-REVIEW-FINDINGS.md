# OS Code platform code review — findings for remediation

Full-platform review, 2026-08-20. Findings only; **nothing here is fixed yet.**
Produced by five parallel senior-review passes (engine core+security, engine
breadth+builder, money/backend, app+electron, infra) plus an inline review of
the latest commit. Every claim was read against real code and callers; items
that could not be confirmed at runtime are marked **UNCONFIRMED** with the exact
check that settles them.

## How to use this document (for the implementing session)

- **Two repos + one backend.** Paths are in `openshore.code.ai` unless prefixed
  `[marketing]` (`Open-Shore-LLC-Homepage`) or `[supabase]`
  (`openshore.code.ai/supabase`). The commercial/money path spans all three.
- **Severity.** P0 = money loss, data loss, security hole, or a shipped-but-dead
  critical path. P1 = incorrect behavior a user hits. P2 = robustness/hygiene.
- **Each finding has a `Verify` line.** Prefer writing that test/repro FIRST
  (red), then fixing (green). Most point at an existing test file to extend.
- **Batch by subsystem** to edit each file once — see "Suggested execution
  order" at the end. Several findings share a root cause; fix the cluster, not
  the symptom.
- **Confidence.** All findings were code-verified. `[repro-confirmed]` means a
  runnable reproduction was executed. `[UNCONFIRMED]` means the code path is
  read-confirmed but live behavior (needs a deploy / device / vLLM) was not
  executed — the Verify line says how to confirm.

---

## ⭐ START HERE: is the live billing path actually working?

Two independent reviews concluded the **entire purchase flow may be returning
403 for every real admin right now** (P0-1 below). You are live. Before fixing
anything, run the one check that resolves the biggest unknown and also validates
half the money-path findings:

> **Do one real (Stripe test-mode) purchase end to end** as a signed-in org
> admin: click Buy → complete checkout → watch whether `stripe-checkout` returns
> a URL or a 403, and whether `org_entitlements`/`orgs.tier_id` update. The
> result tells you whether today's billing is a silent outage (P0-1) or a live
> bypass, and exercises P0-2/P0-4/P1 webhook items at the same time.

---

## P0 — fix first

### P0-1. Billing auth checks the service-role identity, not the caller, so `auth.uid()` is NULL and the admin gate denies everyone (purchase path likely dead). [confirmed by two independent passes; runtime UNCONFIRMED]
- **Files:** `[supabase] functions/stripe-checkout/index.ts:27-42`,
  `functions/stripe-portal/index.ts:15-24`,
  `functions/entitlement-claim/index.ts:34-45`, vs
  `migrations/0002_rls.sql:7-34` (`is_org_admin`/`is_org_member`).
- **Claim:** Each function builds `createClient(URL, SERVICE_ROLE_KEY)`,
  validates the JWT only via `auth.getUser(token)`, then calls
  `rpc('is_org_admin', {p_org})` on that **service-role** client. Inside the
  `security definer` SQL, `auth.uid()` derives from the request JWT — which is
  the service-role key — so it is NULL and `exists(... user_id = auth.uid())` is
  false for every caller.
- **Scenario:** A legitimate admin clicks Buy → `stripe-checkout` 403 "Only an
  org admin can buy seats." Portal and entitlement-claim 403 identically. No
  revenue can flow. (Fail-closed today; if later "fixed" by forwarding a token
  wrong, it flips to org-admin impersonation.)
- **Fix:** Either run the membership query from the function itself with the
  service role, filtered on the **validated `user.id`** (not `auth.uid()`), or
  create the RPC client with the caller's `Authorization` header in
  `global.headers` so `auth.uid()` = caller. Never authorize with the service
  role standing in for the caller.
- **Verify:** The START HERE purchase test (403 today = confirmed). Or log
  `select auth.uid()` inside the RPC during a real call.

### P0-2. Entitlement is never revoked on cancel / delete / payment failure.
- **File:** `[supabase] functions/stripe-webhook/index.ts:28-40, 61-66`.
- **Claim:** On `customer.subscription.deleted` / `.updated`→`past_due`/`canceled`,
  `upsertEntitlement` still maps the sub's price to the PAID tier and writes
  `orgs.tier_id = <paid>`; nothing gates on `org_entitlements.status`.
  `invoice.payment_failed` has no handler.
- **Scenario:** Customer cancels or card fails → access continues indefinitely.
- **Fix:** On non-active statuses map to `personal`/a revoked flag and downgrade
  `orgs.tier_id`; add an `invoice.payment_failed` handler; make the feature gate
  read `org_entitlements.status ∈ {active,trialing}` (+ `valid_until`), not
  `orgs.tier_id`. (Couples with P0-3 and P1-BILL-1.)
- **Verify:** In Stripe test mode cancel a sub, then read `orgs.tier_id` +
  `org_entitlements`; confirm access unchanged today.

### P0-3. `orgs.tier_id` and `stripe_customer_id` are client-writable by the org's own admin (RLS has no WITH CHECK).
- **Files:** `[supabase] migrations/0002_rls.sql:55` (`orgs_update`), exploited
  via `src/state/store.ts:1049-1055` (`setSeatCount` already PATCHes `orgs`).
- **Claim:** `orgs_update` has a USING clause but no WITH CHECK, so any admin can
  PATCH any column of their org — including `tier_id` (self-grant top tier) and
  `stripe_customer_id` (re-point billing at another `cus_...`).
- **Fix:** Add WITH CHECK and revoke UPDATE on `tier_id`/`stripe_customer_id`/
  `owner_uid` (column privilege or trigger). Treat `org_entitlements`
  (webhook-written, client-read-only) as the sole entitlement source.
- **Verify:** As a non-owner admin, PATCH your own org's `tier_id` — succeeds
  today.

### P0-4. `stripe-webhook` ignores DB write errors and returns 200, so a failed entitlement write is acked to Stripe and never retried.
- **File:** `[supabase] functions/stripe-webhook/index.ts:28-40, 67`.
- **Claim:** `upsert(...)`/`update(...)` results' `error` is never checked
  (supabase-js does not throw), so a transient DB/RLS/constraint failure still
  falls through to `return 200`. Also an unmapped price maps to `'personal'`
  (silent downgrade of a paying org).
- **Scenario:** Customer pays during a DB blip → entitlement never lands, Stripe
  marks delivered, no retry, no alert.
- **Fix:** Check `error` on both writes and return 500 so Stripe retries; treat
  an unknown priceId as an error, not `'personal'`.
- **Verify:** Unit-test `upsertEntitlement` with a mocked failing upsert.

### P0-5. Journal redaction corrupts the serialized JSON line, so the event is silently dropped on every replay. [repro-confirmed]
- **Files:** `os-code/src/daemon/session.ts:173` (redact of `JSON.stringify(entry)`)
  + `os-code/src/core/security/redaction.ts:29` (assignment rule).
- **Claim:** `redactSecrets(JSON.stringify(entry))` — the assignment rule's
  trailing `["']?` eats the JSON string's **closing quote** when an event value
  ends in e.g. `API_TOKEN=abcd1234efgh`, producing unterminated JSON.
  `loadJournal` swallows the parse error, so the event vanishes on
  rehydrate/reattach. The rule also over-eats across escaped `\n`.
- **Fix:** Redact event payload **fields** (deep-map string values) before
  `JSON.stringify`, or make the assignment rule preserve the consumed trailing
  quote.
- **Verify:** Extend `os-code/test/atRest.test.ts`: emit an event whose content
  ends with `TOKEN=<8+ chars>`, reload, assert it replays; add a
  `JSON.parse(redactSecrets(JSON.stringify(x)))` round-trip property test.

### P0-6. Outbox apply silently reverts intermediate commits when the branch advanced past the base.
- **File:** `os-code/src/git/outbox.ts:209` (tree seeded from base), gate `:255`,
  CAS `:262`.
- **Claim:** The gate `merge-base --is-ancestor baseCommit branchTip` passes when
  the branch moved forward (base still an ancestor), so the new commit's tree
  (base tree + only the phone's files) is fast-forwarded onto the tip, reverting
  every file changed between base and tip.
- **Scenario:** Phone composes against A; desktop commits B (edits `server.ts`);
  phone item applies → tip's `server.ts` reverts to A. Desktop work silently
  undone in pushed history.
- **Fix:** The fast-forward path is only safe when `branchTip === baseCommit`;
  when the tip moved, rebuild the index from `branchTip` and overlay only the
  request's files, or route to the rescue branch.
- **Verify:** Extend `os-code/test/outbox.test.ts`: commit meanwhile-work on a
  DIFFERENT file (no history rewrite), apply an older-based item, assert the
  meanwhile file survives at the new tip.

---

## P1 — incorrect behavior users hit (grouped by cluster)

### Cluster A — Billing correctness (finish the money path; pairs with P0-1..4)
- **A1 [P1] The signed entitlement-claim is dead code; no feature is gated on
  entitlement.** `[supabase] functions/entitlement-claim/index.ts` (whole) vs
  `src/state/store.ts:1206-1229`, `src/screens/AdminScreen.tsx:120-134`. The
  Ed25519 signed-claim mechanism is never invoked; `refreshEntitlement` reads
  plain rows; only a status label/portal-branch consume it. **Fix:** decide the
  enforcement point and require `org_entitlements.status` (or a verified signed
  claim), or delete the misleading function. **Verify:** grep for any caller of
  `entitlement-claim` / `VITE_ENTITLEMENT_PUBLIC_KEY` (none today).
- **A2 [P1] Webhook has no event de-dup or ordering guard.**
  `[supabase] functions/stripe-webhook/index.ts:42-71`. At-least-once + unordered
  Stripe delivery → a delayed `subscription.updated`(active) re-write after a
  `deleted` resurrects a canceled sub. **Fix:** persist processed `event.id`
  (unique table) and/or compare `created`/`current_period_end`; never regress a
  later state. **Verify:** replay a captured `updated` after a delete via Stripe
  CLI.
- **A3 [P1] Double-checkout creates duplicate subscriptions.**
  `functions/stripe-checkout/index.ts:52-59`, `[marketing] src/static/os-code-app.js:179-205`.
  No check for an existing active sub → tapping Buy twice double-charges; the
  org-keyed upsert hides it. **Fix:** look up active subs first; send an already-
  subscribed org to the portal. **Verify:** subscribe, run checkout again → two
  subs.
- **A4 [P1] Purchased tier never validated vs size; `seats` always 0.**
  `functions/stripe-checkout/index.ts:36-38`, `stripe-webhook/index.ts:30-34`.
  `tierId` is from the body (validated only as a known price) and `seats:0` is
  hardcoded. **Fix:** derive/validate tier from server-side `seat_count`/member
  count; write the real quantity. **Verify:** buy Micro on a 500-seat org →
  succeeds, `seats=0`.
- **A5 [P1] Full session (refresh token) in `localStorage`, no rotation.**
  `[marketing] src/static/os-code-app.js:53-64`. Same-origin XSS → durable
  billing-admin takeover. CSP mitigates but `style-src 'unsafe-inline'` widens
  it. **Fix:** short-lived in-memory access token + HttpOnly/Secure/SameSite
  cookie refresh, or enable rotation + reuse detection. **Verify:** read
  `localStorage['oscode.web.session.v1']` in devtools.
- **A6 [P1] `loadAccount` transient failure is indistinguishable from "no org,"
  so a paying admin is told to set up a company they already have.**
  `[marketing] src/static/os-code-app.js:119-121` + `188-192`; also `199-200`
  navigates to `/os-code/undefined` when `invoke` returns no `url`. **Fix:**
  distinguish fetch-failure from confirmed-no-org (retryable error); guard the
  redirect on a truthy `url`. **Verify:** block the Supabase origin, tap Buy.

### Cluster B — At-rest / journal robustness (data-loss risks)
- **B1 [P1] Transient keychain-unreadable mints a SECOND data key; interim-sealed
  data becomes permanently unreadable.** `os-code/src/core/security/atRest.ts:132-204`
  + `os-code/src/auth/store.ts:72-81`. Keyring locked at first read → new key
  minted to the file store; later `getCredential` prefers the keychain's old key
  → key-B-sealed lines decrypt to null forever. **Fix:** distinguish "keychain
  present but locked/errored" from "no key exists"; refuse to mint when neither
  source is readable and sealed data exists, or mirror the key to both homes and
  reconcile by trial-decrypt. **Verify:** `atRest.test.ts` with `_setSecretTool`
  simulating fail-then-old-key.
- **B2 [P1] `loadJournal` derives seq only from openable lines → duplicate seq
  numbers corrupt resume ordering.** `os-code/src/daemon/session.ts:137-151`.
  Skipped sealed lines (key unavailable) leave `seq=0`, new events append as
  1,2,3 alongside existing sealed 1..N. **Fix:** advance `seq` past the file's
  line count (or persist `lastSeq` in info.json). **Verify:** `atRest.test.ts` —
  sealed lines, reload without key, emit, restore key, assert unique increasing
  seqs. (Root cause shared with B1; fix together.)

### Cluster C — Agent-loop correctness (session-bricking)
- **C1 [P1] Abort during a pending approval never settles the approver promise
  (wedges the session); a later approve executes the tool after the user
  aborted.** `os-code/src/core/agent/loop.ts:402` + `os-code/src/daemon/session.ts:235`.
  **Fix:** in `LocalDriver.abort()` resolve all pending approvals as
  `{approve:false}`; in `executeCall` race the approver against the abort signal.
  **Verify:** `agentLoop.test.ts` — never-resolving approver, abort, assert
  `run()` resolves `aborted` and `busy===false`; post-abort approve does not
  execute.
- **C2 [P1] A guardrail trip mid tool-batch leaves dangling `tool_use` blocks
  with no `tool_result`, so every subsequent cloud turn 400s (session bricked).**
  `os-code/src/core/agent/loop.ts:323-333, 369-370`. **Fix:** on any early exit
  after the assistant/toolCalls message is recorded, push synthetic `tool`
  observations for every unexecuted call id. **Verify:** `agentLoop.test.ts` —
  two native calls, `maxSteps` trips on the first, assert both ids get a `tool`
  entry and `toAnthropicMessages` pairs every `tool_use`.
- **C3 [P1] Abort during Anthropic streaming ends the task as `complete` with
  truncated text instead of `aborted`; the truncated tool-call fragments are also
  flushed.** `os-code/src/core/agent/loop.ts:310-317`,
  `os-code/src/providers/anthropic.ts:150-151, 216-219`, and the same flush in
  `os-code/src/providers/openaiCompatible.ts:357-370`. **Fix:** after the stream
  loop, if `signal.aborted` emit `task-done reason:'aborted'` and skip the
  pending-call flush (mirror `chatOllama`). **Verify:** provider test with an
  `AbortController` aborted mid-stream; assert `aborted`, no phantom `tool-call`.

### Cluster D — Local security hardening
- **D1 [P1] A `member`-role device credential is effectively admin.**
  `os-code/src/daemon/serve.ts:259-318`. Member token can `POST /sessions` with
  an arbitrary `cwd` (jail root), drive it, and approve its own tool approvals;
  no ownership check on input/abort/approvals for OTHER users' sessions. Only
  `/workspaces/clone` is admin-gated. **Fix:** record an owner `userId` per
  driver and enforce it on input/abort/approvals/rehydrate; restrict member
  session creation to admin-provisioned workspaces. **Verify:** new daemon test —
  member `POST /sessions` outside allowed workspaces is 403; cross-user approval
  is 403.
- **D2 [P1] Egress policy checks only the initial URL while fetch follows
  redirects, so bl&#47;allowlists are bypassed by any 3xx.**
  `os-code/src/core/security/egress.ts:111-117` +
  `os-code/src/core/tools/search/readability.ts:33-34`. **Fix:** `redirect:'manual'`
  and re-run `check()` on each `location` hop (bounded). **Verify:**
  `security.test.ts` — local server 302→blocklisted host, assert `EgressBlocked`.
- **D3 [P1] `httpFetch` SSRF guard defeated by DNS rebinding (TOCTOU) and checks
  only the first resolved address.** `app/electron/main.ts:44-51` (one `lookup`)
  vs `:89` (fetch re-resolves). 0-TTL public→private record, or multi-A
  public-first, connects to loopback/LAN/tailnet with attacker body + auth
  header. Private-range table also misses several ranges (192.0.0.0/24,
  198.18/15, 224/4, 240/4, `fec0::/10`, `64:ff9b::/96`). **Fix:** resolve once,
  connect to the vetted IP (custom lookup/Agent), validate ALL addresses; extend
  the range table. **Verify:** rebinding test domain → second call hits loopback.

### Cluster E — Config / usage data integrity (torn-write + RMW races)
- **E1 [P1] `saveGlobalConfig` wipes the whole config when the current file is
  unreadable; non-atomic, unlocked read-modify-write.** `os-code/src/config/load.ts:90, 94`.
  Corrupt `config.json` → `current={}` → save persists only the partial,
  discarding providers/stack/permissions. **Fix:** temp-file + `renameSync`;
  refuse/back-up-and-warn on an unparsable existing config; lockfile or
  mtime-retry for the RMW. **Verify:** new `test/configLoad.test.ts` — garbage
  config, `saveGlobalConfig`, assert old keys survive or it errors.
- **E2 [P1] `usage.json` all-time spend can silently reset to zero (torn write /
  RMW race).** `os-code/src/auth/usage.ts:61-78`. `allTime()` catch → ZERO;
  `persist` non-atomic RMW. Crash mid-write or concurrent processes lose lifetime
  dollars. **Fix:** atomic write; treat unparsable existing file as an error
  (preserve as `.corrupt`), not zeros. **Verify:** new `test/usage.test.ts` —
  invalid json then `noteCloud`, assert not re-seeded from zero.

### Cluster F — Stack Health / marketplace / hardware correctness
- **F1 [P1] `planBuckets` anchors buckets at now's time-of-day (not local
  midnight), so sessions get the wrong day label and in-range sessions vanish
  from the timeline (chart sum ≠ headline).** `os-code/src/insights/stackHealth.ts:429-440, 462-470, 515-517`.
  Also DST drift (fixed `86_400_000`). **Fix:** anchor day buckets to local
  midnight via `new Date(y,m,d)`; clamp in-range sessions to bucket 0 (or align
  `cutoff` to `starts[0]`). **Verify:** `stackHealth.test.ts` via
  `__test.planBuckets`/`bucketIndex` — a 6.5-day-ago ts buckets (not −1) for
  'week'; a Monday-morning ts labels "Mon" with a Wednesday `now`.
- **F2 [P1] `resourceBudget`: a small iGPU VRAM carve-out masks the CPU/RAM
  fallback, capping the machine at 2 GB models.** `os-code/src/router/resourceBudget.ts:64-84, 95-96`.
  AMD APU reports 0.5–2 GB VRAM → never falls back to `systemRamGB/2`. **Fix:**
  treat VRAM < ~4 GB as "no dedicated GPU" for budgeting, or `max(vram, ram/2)`.
  **Verify:** new test — `budgetFor({...vramGB:1, systemRamGB:64, source:'rocm-sysfs'})`
  asserts `maxModelGB` ≠ 2.
- **F3 [P1] `installModel`: a dropped connection mid-pull throws out of the CLI
  flow; a premature clean stream end reports false success.**
  `os-code/src/market/install.ts:78-103`; escapes at `os-code/src/commands/init.ts:175`.
  **Fix:** wrap the read loop in try/catch → `{ok:false}`; only `ok:true` after a
  terminal `status:"success"`. **Verify:** new `test/install.test.ts` — mocked
  fetch stream that errors mid-way, and one that ends without success; both
  `ok:false`.

### Cluster G — Desktop/mobile app bugs
- **G1 [P1] Electron `resumeSession` replays the journal before the renderer is
  listening → reopened desktop conversations render blank.**
  `app/electron/engineHost.ts:62-97`, `app/electron/main.ts:181`,
  `app/src/state/store.ts:471-478`. Sync replay is `webContents.send`'d before
  `ElectronDriver` registers its `osc:event` listener; IPC isn't buffered. **Fix:**
  return the journal in the `resumeSession` reply, or split into
  resume + `replay(sessionId, since)` called after subscribing. **Verify:** chat
  on desktop, quit, relaunch, reopen → blank today.
- **G2 [P1] `pullToDevice` writes `deviceModels` from a stale render snapshot;
  concurrent downloads clobber each other.** `app/src/screens/MarketplaceScreen.tsx:170-199`.
  **Fix:** read fresh state in the handler (`useApp.getState()`) or add an
  `addDeviceModel(id,name)` store action. **Verify:** web demo, Get two models
  quickly; first "on device" pill disappears.
- **G3 [P1] `OnDeviceDriver` never removes its Llama listeners → two-listener
  leak per device chat (retains the driver + history).** `app/src/drivers/onDeviceDriver.ts:38-65, 136-139`
  (contrast `stackDriver.ts:237-254`). **Fix:** store the `PluginListenerHandle`s
  and remove them in `dispose()`. **Verify:** open/close a Harbor chat N times,
  assert listener count grows by 2N.
- **G4 [P1] MarketplaceScreen download-listener effect leaks the Llama listener
  per mount, and the ref-guard breaks the bridge listener under StrictMode.**
  `app/src/screens/MarketplaceScreen.tsx:132-161` + `app/src/main.tsx:7`. **Fix:**
  drop the ref guard; register both listeners in the effect and remove both in
  cleanup. **Verify:** mount/unmount under StrictMode; dev install shows no
  progress today.
- **G5 [P1] RemoteDriver reconnects push a transcript status item per retry, and a
  cleanly-closed stream reconnects with zero delay (hot loop).**
  `app/src/drivers/remoteDriver.ts:194, 206-216` + `app/src/state/transcript.ts:139-140`.
  **Fix:** emit the "blip" once per outage (state outside the transcript); apply
  backoff on clean close too. **Verify:** pair a phone, kill the daemon, watch
  rows accumulate.

### Cluster H — Infra / CI / release
- **H1 [P1] No CI runs tests, lint, or typecheck; Codemagic ships every `main`
  push to TestFlight untested.** `.github/workflows/` has only `catalog.yml`; no
  husky. The em-dash guard, redaction tests, RBAC/crypto/plans tests, security
  tests only run locally. **Fix:** add a push/PR workflow running `pnpm -r lint`,
  `pnpm -r typecheck`, `pnpm -r test`; optionally gate the Codemagic trigger on
  it. **Verify:** inspect `.github/workflows/`.
- **H2 [P1] Codemagic build step has no `set -e`, and `tsc` emits JS despite type
  errors, so a broken engine build can still ship an IPA.** `codemagic.yaml:55-60`;
  `os-code/tsconfig.json` (no `noEmitOnError`). **Fix:** `set -euo pipefail` in
  every script block; `noEmitOnError:true`. **Verify:** introduce a type error,
  run the step's commands as one script → exits 0 today.
- **H3 [P1] The catalog regression gate silently disables itself when the baseline
  is missing, partial, non-JSON, or old-schema.** `.github/workflows/catalog.yml:78-84`
  (`curl … || echo`), `os-code/scripts/build-catalog/index.ts:76`,
  `os-code/scripts/build-catalog/gate.ts:79-87` (`safeParse` → skip). A CDN blip
  during a scheduled run + an HF outage → collapsed catalog publishes ungated.
  **Fix:** distinguish 404 (genuine first run) from other failures (fail the job,
  add `curl --fail --retry` to a temp file); make "baseline exists but doesn't
  parse" a breach, not a skip. **Verify:** point the curl at a 500/HTML body →
  run still builds; extend `catalog.builder.gate.test.ts` with a truncated
  previous → assert breach.
- **H4 [P1] The catalog publish push has no fetch/rebase/retry, so a human commit
  landing between clone and push fails the run and strands the catalog up to a
  week.** `.github/workflows/catalog.yml:88-107`. **Fix:** fetch/rebase-and-retry
  loop (2-3 attempts) or push the single file via the contents API. **Verify:**
  clone shallow, commit, advance remote, push → rejected.
- **H5 [P1] `catalog.json` is served at a stable URL with no `Cache-Control`
  story, so edge/browser staleness after a publish is unmanaged.**
  `[marketing] src/static/os-code/catalog.json`; no `_headers`. A license
  correction can be served stale for days (and poisons H3's baseline curl).
  **Fix:** add `[marketing] src/static/_headers` with an explicit short
  `Cache-Control` + `must-revalidate` for `/os-code/catalog.json`; document the
  purge. **Verify:** `curl -sI` the URL before/after a deploy. **UNCONFIRMED** how
  stale Cloudflare Pages lets it get.
- **H6 [P1] `NSAllowsArbitraryLoads=true` (blanket ATS off) is a standing App
  Review flag and drops TLS enforcement for all hosts.** `app/ios/App/App/Info.plist:41-52`.
  It's justified in-comment by Tailscale CGNAT, but the blanket also covers
  HF/Anthropic/Supabase. **Fix (needs founder sign-off — shipped foundation):**
  keep only if required and pre-write the Review justification; test whether
  `NSAllowsLocalNetworking` + scoped `NSExceptionDomains` on the tailnet suffices.
  **Verify:** whether the daemon connection fails with a narrower config
  (**UNCONFIRMED**).

---

## P2 — robustness / hygiene (compact)

- **P2-1** Anthropic stream double-counts output tokens (`message_start` +
  cumulative `message_delta`). `os-code/src/providers/anthropic.ts:167-174, 199-205`,
  summed `os-code/src/core/agent/loop.ts:225-227`. Fix: last-seen-wins per field.
  (Same pattern risks a big overcount vs a vLLM emitting `continuous_usage_stats`
  — **UNCONFIRMED**.)
- **P2-2** `stackHealth` at-rest scan caches never evict deleted sessions
  (unbounded growth in a long-lived daemon). `os-code/src/insights/stackHealth.ts:89-90, 111-148`.
  Fix: drop keys not visited this pass.
- **P2-3** Escalation gating never checks a Claude key is connected → user
  approves cloud spend, then the turn errors. `os-code/src/router/router.ts:60-62`,
  `os-code/src/core/agent/loop.ts:466-474`. Fix: consult the key getter in
  `escalationEnabled()`.
- **P2-4** Regression gate has no preset invariant → a build can publish with
  every preset dropped. `os-code/scripts/build-catalog/gate.ts:27-47` vs
  `enrich.ts:41-46`. Fix: breach when `next.presets.length===0 && prev>0`.
- **P2-5** `sealSessionsAtRest` migration read→rewrite→rename races a live append
  (best-effort mtime guard) → a concurrently appended event is discarded.
  `os-code/src/daemon/session.ts:279-307`. Fix: cross-process lock, or re-stat and
  abort the rename if it moved.
- **P2-6** Crash-truncated sealed line (no trailing `\n`) poisons the next
  appended event (they merge, both lost). `os-code/src/daemon/session.ts:174-177`.
  Fix: ensure the file ends with `\n` before the first append of a run.
- **P2-7** Daemon `readJson` maps a malformed/empty body to `{}` → a broken
  approval POST silently resolves as denied and returns 200; also answers
  `{resolved:true}` for unknown ids. `os-code/src/daemon/serve.ts:376-385, 311-318`.
  Fix: 400 on invalid JSON, require an explicit boolean `approve`, 404/409 on
  unknown id.
- **P2-8** IPv6 literals never match egress rules (WHATWG keeps brackets;
  `isIP('[::1]')===0`). `os-code/src/core/security/egress.ts:48-49`. Fix: strip
  brackets/zone-id before `isIP`/compare.
- **P2-9** `httpFetch` forwards `authorization`/`x-auth-token` across cross-host
  redirects and replays POST bodies on 3xx. `app/electron/main.ts:83-103` (Codemagic
  token at `app/src/lib/codemagic.ts:103`). Fix: strip auth on cross-origin hops;
  convert 301/302/303 POST→GET.
- **P2-10** `will-navigate` allows any `file:` URL, keeping the full bridge
  attached. `app/electron/main.ts:154-159`. Fix: restrict to the app's own
  `dist/index.html`. (No confirmed chain today — react-markdown neutralizes
  `file:` — but defense in depth.)
- **P2-11** `init()` not idempotent under StrictMode (dev only): double timers /
  listeners / migration writes / auth-callback race. `app/src/App.tsx:36-39`,
  `app/src/main.tsx:7`, `app/src/state/store.ts:840-844`. Fix: a state-level
  `initStarted` guard.
- **P2-12** Conversation persistence lossy window: snapshots only on `task-done`;
  disk order capped at 50 silently. `app/src/state/store.ts:447-448, 1849-1863`.
  Fix: also persist on `task-start`, debounce during streaming; raise/surface the
  cap.
- **P2-13** `deleteProject` "chats drop to no project" is undone by the init
  orphan-migration (re-adopts into another project). `app/src/state/store.ts:981-999, 754-775`.
  Fix: distinguish explicit-unfiled from legacy-missing `projectId`.
- **P2-14** CloudClaudeDriver context meter computed against a 1M window (≈5× too
  low; `turn` always 1). `app/src/drivers/cloudClaudeDriver.ts:80`. Fix: use the
  model's real context window.
- **P2-15** `orgIdForCustomer` uses `.single()` → 500 + Stripe retry loop on
  unmatched customers; `payment_failed` only implicit. `[supabase] functions/stripe-webhook/index.ts:73-76, 61`.
  Fix: `.maybeSingle()`, 200 on no match; explicit `payment_failed` handler (ties
  to P0-2).
- **P2-16** Checkout-success redirect races the webhook write (transient "not
  subscribed"). `[marketing] os-code-app.js:350-356`, `store.ts:833`. Fix: poll
  with backoff until active.
- **P2-17** Raw error messages returned to clients. `[supabase]` stripe-checkout:62,
  stripe-portal:35, entitlement-claim:67, stripe-webhook:49,69. Fix: log server,
  return generic + code.
- **P2-18** CORS wildcard on mutating functions. `[supabase] functions/_shared/cors.ts:4-8`.
  Acceptable with bearer auth; tighten to an allowlist if desired. (Low.)
- **P2-19** The `updated` date stamp makes every weekly catalog run a "change" →
  a no-op bot commit + Pages deploy weekly. `os-code/scripts/build-catalog/enrich.ts:50`,
  `.github/workflows/catalog.yml:100-103`. Fix: compare ignoring `updated`, or
  only bump it on content change.
- **P2-20** `[marketing]` repo has no em-dash guard (owns the pricing copy);
  `package.json` has no test/`check:copy`. Fix: port Uki's `check:copy` scan wired
  to `build`. (Copy is clean today.)
- **P2-21** Supabase URL duplicated in `[marketing] src/oscode.njk:7` (front-matter
  `pageConnect`) and `src/_data/oscode.js:24` — drift silently CSP-blocks billing;
  README's "no runtime/no secrets" is now false. Fix: derive `pageConnect` from
  `oscode.checkout.supabaseUrl`; update the README.

---

## Findings from the latest commit (`2bc6c3d`, brand finalization)

- **CR1 [P1 a11y] Replacing visible `✓`/`✗` with aria-hidden SVGs removes the
  screen-reader signal for tool outcome; a failed tool now announces nothing.**
  `app/src/components/ToolCard.tsx:53` (and the success/duration path). Fix: add
  `aria-label`/visually-hidden text ("done"/"failed") to the state spans.
- **CR2 [P2] `.md pre` background silently changed `#f1eee4`→`#f3f1e8` when folded
  into `--code-surface`, a real visual change vs the "no palette value changed"
  claim.** `app/src/theme.css:~500`. Fix: confirm the unification is intended (say
  so) or give `.md pre` its own value.
- **CR3 [P2] `ICON_NODES` is `Record<string, JSX.Element>`; a missing/misspelled
  key renders a silent empty SVG.** `app/src/components/Sidebar.tsx:28`. Fix: type
  it `Record<ViewName | 'admin', JSX.Element>` (precedent: `PairScreen`'s
  `keyof typeof GLYPHS`).
- **CR4 [P2] `.pill.ok` duplicates `.pill.fits` literal-for-literal.**
  `app/src/theme.css:~1186`. Fix: share the rule or add an `--ok-soft` token
  (mirror `--cloud-soft`).
- **CR5 [P2] The project-switcher caret still uses raw Unicode `▴`/`▾`.**
  `app/src/components/Sidebar.tsx:195`. Fix: swap to the inline-SVG chevron for
  consistency (the commit claimed the last stray glyphs were replaced).

---

## Solid — verified correct, do NOT churn

- **Electron window hardening**: `contextIsolation`+`sandbox`+`nodeIntegration:false`,
  `window.open` denied w/ external hand-off, http(s) navigation to the system
  browser, preload exposes only the typed channel bridge (no generic
  `ipcRenderer`). `app/electron/main.ts:141-159`, `preload.cjs`.
- **Daemon token auth**: timing-safe equal-length compare, SHA-256-hashed device
  tokens, expiry, mode-600 files, `assertSafeBind` never binds `0.0.0.0`.
  `os-code/src/core/security/{daemonAuth,credentials}.ts`.
- **Seal/open round-trip + jail + runShell**: app-compatible `enc:v1`, plaintext
  passthrough, tamper→null (never delete); lexical+symlink jail; detached
  process-group SIGKILL with redacted capped output.
- **Webhook signature verification** (`constructEventAsync`) and
  `claim_membership()` binding seats from `auth.uid()`/`auth.email()` (not client
  input); `org_entitlements` is client-read-only; RLS helpers are
  `security definer stable` with pinned `search_path`.
- **Catalog gate architecture** (schema-parse → regression gate → write-nothing-
  on-breach, pure fixture-tested core, `scripts.isolation` guard actually run in
  CI); **license fail-closed**; **HF per-segment ref encoding**; client fallback
  chain never poisons the cache.
- **The transcript reducer** is a pure driver-agnostic fold; **phone reattach seq
  handling** is correct (`subscribe(sink, since)` replays strictly `>since`);
  **StackHealthScreen fetch race** is handled (`live` flag + guarded rAF);
  **outbox idempotency/confinement**; **Codemagic signing setup** and the
  **log-redaction pipeline** (tested); the **app icon** is alpha-free 1024² (no
  ITMS-90717).

---

## Suggested execution order for the implementing session

1. **Billing cluster first** (P0-1, P0-2, P0-3, P0-4, A1-A6). One coherent
   problem: no trustworthy enforced link between "paid & active" and "has access."
   Start with the START HERE purchase test — it tells you whether P0-1 is an
   outage or a bypass and exercises the webhook items. Fix the edge-function auth,
   the RLS WITH CHECK, and pick `org_entitlements.status` as the single
   authoritative source everywhere. These span `[supabase]` + `[marketing]` + app.
2. **Journal/at-rest cluster** (P0-5, B1, B2, P2-5, P2-6) — all in
   `session.ts` / `atRest.ts` / `redaction.ts`; edit those three files once.
   P0-5 is repro-confirmed and silently loses history.
3. **Outbox P0-6** — isolated to `outbox.ts`; high-value, self-contained.
4. **Agent-loop cluster** (C1, C2, C3, P2-3) — all in `loop.ts` + the two
   provider files; abort/guardrail correctness.
5. **Local security** (D1, D2, D3, P2-8, P2-9, P2-10) — daemon RBAC, egress
   redirects, httpFetch SSRF.
6. **CI/release** (H1, H2, H3, H4, H5) — add the test workflow FIRST (H1) so
   every subsequent fix is guarded; then harden Codemagic and the catalog
   pipeline. H6 (ATS) needs founder sign-off.
7. **Data integrity + Stack Health + app bugs** (E1, E2, F1-F3, G1-G5) — mostly
   independent; parallelizable.
8. **P2 sweep + the brand-commit CR items** last.

**Untested money-critical modules** (write tests as you fix): all four
`[supabase]` edge functions and `[marketing] os-code-app.js` (neither repo has a
test harness). `app/src/lib/plans.ts`, `crypto.ts`, store, and rbac DO have tests
— they just never run in CI (H1).
