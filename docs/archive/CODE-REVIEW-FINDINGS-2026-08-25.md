> **Archived 2026-09-05. Status: WORKED.** The findings below were built out per `os-code/PROGRESS.md` (the "Nothing here is fixed yet" line further down is the original text); the few still open (TS-P2-1 on the CLI attach path, TS-P2-5, TS-P2-10, TS-P2-11, TS-P2-12, TS-P1-6) are carried in the "Still open from the earlier reviews" section of `CODE-REVIEW-FINDINGS-2026-09-05.md` at the repo root.

# OS Code review 2026-08-25: connectivity, terminal bridge, Marketplace

Findings and build-ready proposals for the implementing session (Opus 4.8).
**Nothing here is fixed yet.** Produced by three parallel senior-review passes
(Tailscale connectivity, chat-to-terminal bridge, Marketplace + Hugging Face
automation) plus inline verification of every load-bearing claim against the
current tree on branch `claude/openshore-code-review-ud4bt9` (HEAD `2ca71dd`).

The previous full-platform review lives in `CODE-REVIEW-FINDINGS.md` (2026-08-20,
fully addressed). This document covers three new focus areas the founder named:

1. The Tailscale connection integration (phone reaches local models and gitOS,
   "the exact feel of Claude Code in the Claude app, on the go").
2. A seamless chat-to-terminal bridge (today the founder pastes suggested
   commands into Termius over Tailscale and screenshots the output back).
3. The Marketplace as a premium, fully functioning storefront automated against
   Hugging Face offerings and updates.

## How to use this document (rules that bind the implementing session)

- **Repo conventions are enforcement, not memory.** Every fix lands with tests
  where a harness exists. Quality gate before every push: `pnpm typecheck`,
  `pnpm lint --max-warnings 0`, the test suites in both `os-code/` and `app/`,
  and `vite build` for the app.
- **Em dash policy is TOTAL in this repo** (comments included, encoded
  spellings too). `test/em-dash-policy.test.ts` in both packages fails the
  build on any violation. Keep every new string, comment, and doc line clean.
- **Settled architecture principles to respect** (from `os-code/DECISIONS.md`):
  the phone is a remote control and viewer, long or agentic work runs
  off-device on the daemon; the sessions journal plus SSE replay is the one
  lossless-reattach mechanism; the shell is default-deny with approvals;
  `os-code/src/protocol.ts` must stay Node-free; real git shells out on the
  desktop engine only; never bypass `daemonAuth`.
- **Severity legend:** P0 = the feature does not work at all for its primary
  user; P1 = major functional or security gap; P2 = reliability, polish, or
  hygiene. Items marked UNCONFIRMED name the exact check that settles them.
- **Suggested execution order (waves):**
  1. **Wave 1, correctness on the phone path:** TS-P0-1 (confirm, then flip),
     TB-P0 (Phase 0, hours), TS-P1-1 + TS-P1-2 together, TS-P1-4, TS-P1-3.
  2. **Wave 2, the terminal bridge Phase 1** (the founder's stated
     game-changer), plus MP-F2 (daemon install endpoint, shares the same
     daemon-route pattern).
  3. **Wave 3, Marketplace function:** MP-F1, MP-F3, MP-F4, MP-F5, MP-P-1.
  4. **Wave 4, HF automation:** MP-A-1 through MP-A-8.
  5. **Wave 5:** remaining P2s in the order listed per area.
  Present each wave's plan to the founder for sign-off before building
  (sign-off gate); anything touching a working foundation needs express
  approval first.

---

# AREA 1: Tailscale connection integration

## Architecture summary (verified, for orientation)

**Daemon (desktop).** `osc serve` (`os-code/src/commands/serve.ts`) starts the
HTTP daemon in `os-code/src/daemon/serve.ts`. `resolveBindHost()` binds either
`127.0.0.1` or the Tailscale interface IP from `tailscaleIp()`
(`os-code/src/connect/tailscale.ts`, shells `tailscale ip -4`, falls back to
scanning `networkInterfaces()` for a CGNAT `100.64/10` address).
`assertSafeBind()` (`os-code/src/core/security/daemonAuth.ts:71`) hard-refuses
`0.0.0.0`/`::`. Every request needs `Authorization: Bearer`; `resolveAuth()`
accepts the shared admin token at `~/.os-code/daemon.token` (mode 600, `osc_`
plus 32 random bytes base64url) or a per-device minted credential (SHA-256
hash, constant-time compare, optional expiry). Sessions are `LocalDriver`s
(`os-code/src/daemon/session.ts`) journaling every event to
`~/.os-code/sessions/<id>/events.jsonl` (sealed at rest) with contiguous seqs;
`GET /sessions/:id/events?since=N` replays then streams live over SSE with
`id: seq` frames and `:ka` keepalives every 15s.

**Pairing, two disjoint flows.** (1) CLI: `osc pair`
(`os-code/src/commands/pair.ts` + `src/connect/pair.ts`) is a Termius/SSH
wizard printing five steps and a QR of `ssh://user@<magicdns-or-ip>`; the
phone then runs `osc attach` in the SSH session. (2) App: the desktop Pair
screen (`app/src/screens/PairScreen.tsx`) calls `bridge.daemonStart()`
(`app/electron/engineHost.ts:362`) and renders a QR of
`{"u":"http://<tailscale-ip>:4816","t":"<shared admin token>"}`; the phone
branch accepts a pasted address plus token, probes `/health`, and saves
`settings.daemon` into the sealed settings blob.

**Phone runtime.** `refreshConnectivity()` (`app/src/state/store.ts:1231`)
polls `/health` every 20s for the Docked/Offshore/Offline profile. Desktop
conversations (opened from the Repos screen only) attach `RemoteDriver`
(`app/src/drivers/remoteDriver.ts`): SSE from `since=0` to rebuild the
transcript, exponential-backoff reconnect (600ms to 10s) from
`since=lastSeq`, one "Connection blipped" status per outage. gitOS over the
remote path is repos-only via `/workspaces`, `/workspaces/clone`,
`/outbox/apply`, `/outbox/verify`; the app-side gitOS seam
(`app/src/lib/gitos/`) has no daemon provider.

**What is already solid (calibration):** token generation and comparison
(256-bit, constant-time, hashed per-device credentials with expiry), the hard
no-`0.0.0.0` bind rule with tests (`os-code/test/security.test.ts:137-147`),
the journal/SSE replay design, the push notifier (beat-based presence,
content-free payload, live-only subscription so replays never re-fire),
deliberate documented ATS handling, and the fact that auth is never relaxed
when Tailscale is down (the app just degrades to Offshore).

## TS-P0-1. CapacitorHttp global fetch patch very likely kills the SSE stream on a real iPhone

- **Where:** `app/capacitor.config.ts:14-18` (`plugins.CapacitorHttp.enabled:
  true`, verified in tree) vs `app/src/drivers/remoteDriver.ts:196-219` (SSE
  via `fetch` + `res.body.getReader()`); also `app/src/drivers/stackDriver.ts:422-460`
  and Anthropic SDK streaming in `cloudClaudeDriver.ts`.
- **What is wrong:** With `enabled: true`, Capacitor replaces `window.fetch`
  (and XHR) in the iOS WebView with a native-bridged implementation that
  buffers the entire response body, with no streaming and unreliable
  AbortSignal support. The daemon's `/events` endpoint never completes, so the
  patched fetch never resolves: the phone pairs, `/health` passes, input POSTs
  succeed, the desktop runs the task, and the phone renders nothing, forever.
  `dispose()`'s abort is ignored, leaking the hung request. The comment in
  `app/src/lib/nativeFetch.ts:8-10` ("Streaming paths must NOT go through
  here") shows the team believes plain `fetch` is unpatched; with
  `enabled: true` it is not. `nativeFetch` itself calls `CapacitorHttp.request`
  explicitly and keeps working either way.
- **Failure scenario:** Founder pairs, opens a repo chat from the phone, sends
  "fix the bug". Daemon executes. Phone shows an empty thread and a spinner
  forever. Cloud streaming chats on the phone hang the same way. This is the
  single highest-leverage item in this review: it decides whether the flagship
  phone experience works at all.
- **Fix:** Set `CapacitorHttp.enabled: false` (or remove the plugin block) so
  the WebView fetch stays real, and keep all CORS-hostile calls (DuckDuckGo,
  Brave, Tavily, OpenAI-compatible providers) on the explicit
  `CapacitorHttp.request` path in `nativeFetch.ts`. Then migrate
  `webSearch.ts:55,98,116` to `nativeFetch` (today they use plain `fetch` and
  are the reason the flag was turned on). ATS already allows plain http to
  `http://100.x` (`app/ios/App/App/Info.plist:41-55`).
- **UNCONFIRMED:** Capacitor 8.5.0's patched fetch could not be inspected here
  (no node_modules). Settle by (a) reading
  `node_modules/@capacitor/core/dist/index.js` for the CapacitorHttp fetch
  patch and whether the Response is constructed only after the native call
  completes, or (b) on a device build, checking `window.CapacitorWebFetch`
  exists (means fetch was patched) and watching whether a desktop chat
  streams. If Capacitor 8 added true streaming passthrough, downgrade to P2
  (AbortSignal behavior still needs checking).

## TS-P1 findings

### TS-P1-1. `osc attach` cannot reach a daemon started with `--bind tailscale`

- **Where:** `os-code/src/daemon/attach.ts:19-24` (`defaultTarget(port, host =
  '127.0.0.1')`, verified) vs `os-code/src/connect/pair.ts:81-86` (wizard step:
  `osc serve --bind tailscale`) and `os-code/src/commands/pair.ts:44`.
- **What:** `startDaemon` binds only the Tailscale interface IP, never
  loopback as well. `osc attach` defaults to `http://127.0.0.1:<port>`. So
  following the pair wizard exactly, then SSHing in from Termius and running
  `osc attach`, gets connection refused plus the wrong advice "Start it on the
  desktop with: osc serve" (it IS running). Every CLI-path phone user hits
  this on the first session.
- **Fix (preferred):** In `startDaemon`, when `bind === 'tailscale'`, listen on
  both loopback and the tailnet IP (two `http.Server` instances sharing the
  handler). This also keeps `checkLinks`'s daemon probe
  (`os-code/src/connect/health.ts:101-124`) honest. Alternative: make
  `defaultTarget()` bind-aware (read `config.daemon.bind`, use
  `tailscaleIp() ?? '127.0.0.1'`).

### TS-P1-2. Silent loopback fallback publishes an unreachable pairing QR with false copy

- **Where:** `app/electron/engineHost.ts:362-377` (`daemonStart` falls back to
  `bind: 'loopback'` with no marker), `app/src/screens/PairScreen.tsx:98`
  (QR from `http://${next.host}:${next.port}`), `:130-134` ("Serving on
  ${info.host}:${info.port} over the tailnet.").
- **What:** If the Tailscale bind fails (tailnet down, `tailscale` CLI not
  found), the daemon quietly starts on `127.0.0.1`, the screen claims it is
  serving over the tailnet, and the QR points the phone at itself. The
  phone's health check then fails with generic copy that blames the phone.
- **Fix:** Return `mode: 'tailscale' | 'loopback'` from
  `daemonStart`/`daemonInfo` (host `=== '127.0.0.1'` is a usable proxy). In
  `DesktopPair`, when loopback: hide the QR and say "On, but only for this
  machine. Tailscale is not up, so the phone cannot reach it yet" with the
  `sudo tailscale up` hint. Also poll `refresh()` on an interval; the current
  `useEffect(..., [])` runs once, so starting Tailscale after opening the
  screen never updates the state.

### TS-P1-3. Daemon restart gives the model amnesia while the phone shows the full transcript

- **Where:** `os-code/src/daemon/serve.ts:359-371` (rehydrate calls
  `bootstrapSession({cwd, profile, sessionId})`),
  `os-code/src/core/agent/bootstrap.ts:40-91` (no history seeding),
  `os-code/src/core/agent/loop.ts:57` (`history: ChatMessage[] = []`).
- **What:** Rehydration replays the journal into the phone UI (transcript
  looks perfect) but builds a fresh `AgentSession` with empty history. After a
  daemon restart the user asks "now apply the same fix to the other file" and
  the model asks "which fix?". Directly breaks "exact feel of Claude Code".
- **Fix:** In `bootstrapSession`, when `sessionId` is passed and a journal was
  loaded, fold journaled events into seed messages (pair each `task-start`
  input with the following `text-final`, the same shape as
  `seedFromTranscript` in `app/src/state/transcript.ts`) and pass them into
  `AgentSession` as an initial `history` (add a `seed` option to its
  constructor). Also emit a status event ("This session was restored after a
  restart") so pending-approval zombies (TS-P2-6) are explainable.

### TS-P1-4. `/outbox/apply` and `/outbox/verify` are not admin-gated and accept any on-disk path

- **Where:** `os-code/src/daemon/serve.ts:231-260` (`/outbox/apply`, verified:
  no `requireAdmin()`, `cwd` checked only with `existsSync`) and `:264-278`
  (`/outbox/verify`), vs the admin gate on `/workspaces/clone` (`:209`) and
  the member-workspace confinement on `POST /sessions` (`:325-331`).
- **What:** `applyOutboxItem` (`os-code/src/git/outbox.ts`) creates commits
  with arbitrary file post-images in any repo the request names and runs
  `git push origin <branch>` with the desktop's credentials. The "a member
  token must not reach arbitrary paths" rule is enforced for sessions but
  forgotten for the outbox, which is a stronger capability (it pushes to
  remotes). A teammate's minted member token can post
  `{"cwd": "/home/owner/private-repo", ...}` and land a pushed commit under
  the owner's credentials.
- **Fix:** In both handlers require
  `hasRole(auth, 'admin') || isAdminProvisionedWorkspace(cwd)` (the same
  predicate sessions use). Consider per-item ownership if members should sync
  only their own buffers. Add a daemon RBAC test beside the existing ones in
  `os-code/test/daemon.test.ts`.

### TS-P1-5. The home-repo outbox sync can never run: `homePath` has no writer

- **Where:** `app/src/state/store.ts:2082-2085` (bails with "Set your home
  repo location on the desktop first."), `app/src/lib/repos.ts:62`
  (`homePath?: string`), `app/src/screens/ReposScreen.tsx:383-473`
  (`HomeRepoEditor` collects label/kind/remoteUrl/branch, never a path).
  No writer of `homePath` exists anywhere in app, engine, or Electron.
- **What:** "Sync now" (`ReposScreen.tsx:260-269`) always dead-ends on that
  toast, and the toast points at a desktop setting that does not exist. The
  buffered-deploy promise on the Repos screen is undeliverable for every
  `HomeRepo` kind.
- **Fix:** Give `HomeRepoEditor` a home-path field populated from
  `daemonWorkspaces()`/`bridge.recentWorkspaces()` (pick a cloned workspace,
  store its `cwd` as `homePath`); for platform kinds derive the path by
  cloning through `/workspaces/clone` on first sync. Until then, hide the
  Sync button rather than leaving it enabled-but-doomed.

### TS-P1-6. Pairing success toast promises a picker entry that does not exist; the only desktop entry point is buried and paywalled

- **Where:** `app/src/screens/PairScreen.tsx:218` ("Connected. Your desktop
  stack is now in the model picker."), `app/src/components/ModelSheet.tsx`
  (no `desktop` entries at all), `app/src/components/SourcePicker.tsx`
  (has the desktop path but is imported by nothing: dead code),
  `app/src/screens/ReposScreen.tsx:71,334,358` (the only live creators of
  `kind: 'desktop'`), `app/src/state/store.ts:1375-1379` (every desktop
  conversation is behind the Personal paywall). Also
  `app/src/screens/StackScreen.tsx:63` returns `<StackManager />` for phones
  while the `remote` daemon stack fetched at `:32` is thrown away, despite the
  file header claiming the phone shows the live daemon picture.
- **What:** After pairing, the model picker shows My Stack / Cloud / Local
  device only. There is no way to chat with the desktop's models from the
  picker and no "chat with the stack, no repo" entry anywhere live. The user
  must discover Repos and open a repo session, which additionally needs the
  paid unlock even for plain chat with their own home models.
- **Fix:** Add a "Your desktop" group to `ModelSheet` when `settings.daemon`
  is set (entries create or route a desktop conversation, or add a `home`
  kind to `StackModelRef` in `app/src/lib/stack.ts:41-44` routed through the
  daemon). Or, minimum honest fix: change the toast to describe what actually
  happens ("Connected. Open a repo from Repositories to use it."). Delete or
  wire up `SourcePicker.tsx`. Fix or remove the dead phone branch in
  `StackScreen`. Decide deliberately whether free-tier chat with the user's
  OWN desktop models should be paywalled (product call for the founder;
  flag it, do not silently change gating).

## TS-P2 findings

### TS-P2-1. Reconnect loop treats fatal HTTP answers as transient forever
`app/src/drivers/remoteDriver.ts:200` throws on any `!res.ok` and retries
every 10s forever. A 401 (token revoked) or persistent 404 (session deleted)
shows one "Connection blipped" and then silence. Fix: on 401 emit a terminal
status ("The desktop rejected this phone's token. Re-pair from Menu, Desktop
connection.") and stop; on 3 consecutive 404s emit "This session no longer
exists on the desktop" and stop. Same pattern in
`os-code/src/daemon/attach.ts:80`.

### TS-P2-2. No timeouts on phone-to-daemon POSTs; no optimistic echo
`app/src/drivers/remoteDriver.ts:247-263` (`send`) and `:40-49`
(`daemonCreateSession`) have no AbortSignal. When the tailnet blackholes
(Tailscale toggled off on the phone), sends hang for the OS default 60s+ and
the user bubble only appears when the daemon echoes `task-start` over SSE.
Fix: `signal: AbortSignal.timeout(10_000)` on send/abort/answerApproval/
createSession with the existing failure status; optionally push a provisional
user bubble at send time reconciled against the replayed `task-start`.

### TS-P2-3. Backoff and blip state only reset on a productive frame
`app/src/drivers/remoteDriver.ts:184-239`: `backoffMs` and `outageBlipped`
reset only when a real frame parses; `:ka` keepalives parse to null. After one
outage on an idle session, backoff stays 10s and the next real outage shows no
blip. Fix: treat received keepalives (or any bytes) as productive: reset
`backoffMs = 600` and clear `outageBlipped`.

### TS-P2-4. The QR hands out the shared non-expiring admin token; per-device credentials are unused
`app/electron/engineHost.ts:356` returns `loadOrCreateToken(...)`;
`os-code/src/commands/pair.ts:19` never passes the `mint` option that exists
in `src/connect/pair.ts:25-28`; the full mint/revoke/expiry machinery in
`os-code/src/core/security/credentials.ts` is dead in both shipped flows. A
lost phone cannot be revoked individually (only by deleting `daemon.token`,
un-pairing every device). Fix: mint a fresh device credential per pairing
(label "iPhone via QR") in `daemonStart`/`daemonInfo`, show that in the QR,
surface `osc token list`/revoke in the desktop UI; keep the shared token for
back-compat (resolveAuth already does).

### TS-P2-5. Two devices on the shared token overwrite each other's push registration
`os-code/src/daemon/serve.ts:180` keys `savePushConfig` by `auth.userId`,
which is `'legacy'` for every shared-token phone: last register wins, the
other device silently loses "session needs you" pushes. Fix: key by a device
id (send `settings.deviceId` in the register body) and fire to all grants for
the owning user; or land TS-P2-4 first, which makes userIds distinct.

### TS-P2-6. Pending approvals do not survive a daemon restart (zombie approval sheet)
`os-code/src/daemon/session.ts:96,268-284`: `pendingApprovals` is in-memory;
the journal records `approval-request` with no matching resolution. After a
restart the phone replay reconstructs the pending approval, the sheet blocks
the chat, and Approve 404s silently (`RemoteDriver.answerApproval` swallows
errors). Fix: on rehydrate, emit synthetic `approval-resolved
{approved: false}` for journaled requests with no resolution; on the phone,
surface the 404 and drop the pending entry.

### TS-P2-7. SSE write backpressure is unbounded on half-open connections
`os-code/src/daemon/serve.ts:427-434` writes per event with no `write()`
return check; cleanup only on `'close'`. A roaming phone leaves the old
socket half-open for minutes while a verbose run buffers every event into
daemon memory. Fix: `res.socket.setTimeout(60_000)`, unsubscribe on repeated
false `write()` returns or `res.on('error')`.

### TS-P2-8. Tailscale detection is Linux-shaped; macOS misreports even when up
`os-code/src/connect/tailscale.ts:19,27,57` shells `tailscale` from PATH; on
macOS the CLI lives at
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` and GUI apps do not
inherit shell PATH, so `detectTailscale()` returns `installed: false` while
the interface-scan fallback still finds the 100.x address: pairing can work
while the UI says Tailscale is down. Health fixes
(`os-code/src/connect/health.ts:129-175`) are Linux-only (`systemctl`,
`gsettings`, apt install hints). Fix: try the macOS binary path in a
candidate list; treat "interface scan found 100.64/10" as `running: true`
even without the CLI; branch fix strings on `process.platform`
(`caffeinate` for sleep on macOS). UNCONFIRMED on a real Mac: launch the
Electron app with Tailscale up and check `daemonInfo().tailscaleUp`.

### TS-P2-9. `detectTailscale` blocks the Electron main process up to 8s
`app/electron/engineHost.ts:349-360` calls two `spawnSync`s (4s timeout each,
`os-code/src/connect/tailscale.ts:19,27`) per `daemonInfo`. A hung
`tailscaled` freezes the desktop UI on every Pair-screen refresh. Fix: async
`execFile` with the same timeouts, or cache with a short TTL.

### TS-P2-10. Daemon CORS `*` lets any website probe for the daemon
`os-code/src/daemon/serve.ts:38-43`. Auth still gates everything, but a
drive-by page can fingerprint "OS Code daemon present at
100.x:4816 / localhost:4816" from the readable 401 body. Fix: reflect a small
allowlist (`capacitor://localhost`, `http://localhost`, the Electron origin);
answer other origins without CORS headers.

### TS-P2-11. "Paste or scan" has no scanner; daemon token lives in the settings blob, not the Keychain
`app/src/screens/PairScreen.tsx:161` advertises scanning; `PhonePair` is
paste-only (the only scan path is the iOS Camera app reading raw JSON, which
nobody will discover). The admin token persists via `saveSettings` into the
sealed settings blob; acceptable, but it deserves the same `secretSet`
Keychain slot the Anthropic key gets (a settings export leaks it in one hop).
Fix: add an in-app scanner (e.g. `@capacitor-mlkit/barcode-scanning`); move
`settings.daemon.token` to `secretSet('oscode.secret.daemon')` keeping
`baseUrl` in settings, with a one-time migration.

### TS-P2-12. Daemon and API hygiene (small, batchable)
- `serve.ts:419`: `Number(url.searchParams.get('since') ?? 0)` yields NaN for
  garbage and silently skips replay; clamp with
  `Number.isFinite(n) && n >= 0 ? n : 0`.
- `serve.ts:444-447`: `close()` only stops accepting; live SSE responses keep
  the process alive (masked in the CLI by `process.exit(0)`, not in Electron
  `daemonStop`). Track connections and destroy on shutdown.
- `tailscale.ts:60` accepts any `100.` prefix from the CLI while the interface
  scan matches only `100.64/10`; align both on the CGNAT range.
- `health.ts:101`: the daemon probe guesses host from config `bind`, but the
  running daemon may have been started with a different flag; after TS-P1-1's
  dual-bind fix, probe loopback always.
- `PairScreen.tsx:207-210`: an `https://` address against the plain-HTTP
  daemon fails with generic unreachable copy; detect the scheme mismatch
  ("The desktop serves plain http inside the tailnet; use http://").
- `store.ts:1237-1240`: the `Promise.race` timeout abandons the losing
  `daemonHealth` fetch instead of aborting it; pass `AbortSignal.timeout`.

## TS missing pieces (promised vs delivered)

1. **Discovery is fully manual (P2).** Nothing browses the tailnet: no
   MagicDNS attempt, no peer probing; the QR encodes the raw tailnet IP, so a
   machine whose tailnet IP changes strands the phone with no hint. Encoding
   the MagicDNS name (`detectTailscale().dnsName`, already available in
   `engineHost.daemonInfo`) would survive IP changes.
2. **gitOS over the remote path is repos-only (P2, tracked).** The gitOS
   storage seam has no daemon/home provider
   (`app/src/lib/gitos/providers.ts:22-23`), so a phone Vault cannot live on
   the desktop over Tailscale; phone and desktop vaults are separate worlds.
   Already tracked as future work in `os-code/PROGRESS.md`; expectation note
   only.
3. **CLI-only users cannot pair the iOS app (P2).** `osc pair` covers only
   the SSH path; nothing prints the `{u, t}` payload the app's PhonePair
   expects. An `osc pair --app` printing the JSON + QR (minting a device
   credential per TS-P2-4) closes the gap for headless daemons.
4. **Chat-with-desktop-models without a repo** exists only in dead code
   (`SourcePicker`); see TS-P1-6.
5. **Docked profile overpromise (P2).** `app/src/lib/profiles.ts:31` says
   Docked means home models are usable, but no stack ref can point at a home
   model (`stackDriver.ts:12-13`); align the blurb until a `home` ref kind
   ships.

---

# AREA 2: Chat-to-terminal bridge

## The core fact (changes the whole framing)

**The agent can already run shell commands on the desktop with approval from
the phone, end to end.** Phone input POST
(`app/src/drivers/remoteDriver.ts:247`) reaches the daemon
(`os-code/src/daemon/serve.ts:383-392`), the model emits `runShell`
(`os-code/src/core/tools/runShell.ts`, risk class `shell`, default `ask` per
`os-code/src/core/permissions/index.ts:36`), the approval rides the journaled
SSE stream (`os-code/src/daemon/session.ts:268-276`) into `ApprovalSheet` on
the phone showing the exact command, the answer posts back
(`serve.ts:398-417`), the command runs as `/bin/bash -c` in the workspace root
with capped, secret-redacted output fed to the model
(`os-code/src/core/agent/loop.ts:471-486`). Daemon sessions run the
`remote-attached` profile (`serve.ts:333`), which forbids session-wide shell
auto-approve server-side (`os-code/src/core/security/profiles.ts:27-33`).
Reconnects are lossless (journal + `since=` replay) and an APNs push fires
when a run blocks on approval with no phone watching
(`os-code/src/daemon/push.ts:141-152`).

**So this feature is "expose, stream, and polish what exists," not "build a
PTY product from scratch."** The daemon, auth, approval, replay, and push
substrate are in place. What is missing is the last mile, plus one outright
bug that plausibly caused the Termius screenshot workflow in the first place.

Environment facts constraining the design: no `node-pty`, no `xterm`, no `ws`
anywhere in either package. The daemon is a hand-rolled `node:http` server
speaking JSON + SSE. It runs both standalone (`osc serve`) and inside
Electron (`app/electron/engineHost.ts:362-372`), so any native module must
work in both runtimes. `runShell` is deliberately not jailed (the `Jail`
covers file tools only, `os-code/src/core/agent/registry.ts:64`); approval,
ownership (`serve.ts:349-381`), and bearer auth are the security boundary.

## TB review findings

### TB-P1-1. The phone cannot display shell output beyond its first line
- **Where:** `app/src/state/transcript.ts:96-109` (verified): on `tool-end`
  the reducer sets `summary: firstLine(event.result.content)` (100 chars) and
  `detail: event.result.diffText`. `runShell` never produces `diffText`
  (`ToolOutput`, `os-code/src/core/tools/index.ts:18-26`), so the expandable
  detail in `ToolCard.tsx:86` is empty for every shell command.
- **What:** The full (capped, redacted) output IS on the wire in the
  `tool-end` event; the reducer throws it away. The founder can approve
  `npm test` from the phone and then literally cannot read the result in the
  app. This one-line gap is most of the reason the Termius/screenshot loop
  still exists.
- **Fix:** `detail: event.result.diffText ?? (event.result.content ||
  undefined)`, with a `detailKind: 'diff' | 'output'` on the tool ThreadItem
  so plain output renders in a mono block instead of `DiffBlock` (whose
  `+`/`-` colorizing would misfire on shell output).

### TB-P1-2. There is no user-initiated command path anywhere
The daemon's only session verbs are `input`, `abort`, `approvals`, `events`
(`serve.ts:383-437`); the TUI has no `!command` either
(`os-code/src/tui/slash.ts`). The only way to run a command is asking the
model to run it, which costs a local-model turn, risks the model rephrasing
the command, and interleaves the run with agent reasoning. The founder's
"take a suggested command and run it" has no direct rail. Fixed by Phase 1
below.

### TB-P2 findings (constraints the proposal addresses)
- **TB-P2-1. No stdin.** `runShell.ts:39` spawns with
  `stdio: ['ignore','pipe','pipe']`; anything interactive (sudo, `y/N`, git
  credential prompts) hangs until the timeout SIGKILLs the group.
- **TB-P2-2. No streaming output.** Output is delivered only in the terminal
  `tool-end` after exit (`runShell.ts:58-78`); a two-minute build is a blind
  spinner on the phone and the abort decision is made blind.
- **TB-P2-3. No long-running processes.** `timeoutSeconds` max 600, default
  120, then SIGKILL of the process group with no SIGTERM grace
  (`runShell.ts:12-18,44-56`). Dev servers and watch modes are impossible.
- **TB-P2-4. Client-side `auto` permission mode silently defeats the remote
  shell policy.** `app/src/lib/permissionMode.ts:29-33` +
  `app/src/state/store.ts:666-671`: in `auto` mode the phone auto-answers
  every approval, including `runShell`, the instant it arrives; behaviorally
  identical to the session-wide grant the `remote-attached` profile forbids
  server-side (`profiles.ts:31`, `permissions/index.ts:83-91`). Not a
  vulnerability (the token holder is the user), but the new command lane must
  not inherit `auto` semantics implicitly.
- **TB-P3-1. Output truncation is shared between model and human.**
  `capContent` caps at 16000/8000 chars (`runShell.ts:72-73`) and the full
  output is never stored; right cap for a small local context window, wrong
  cap to force on the human.
- **TB-P3-2. Live SSE sinks receive unredacted events.** `LocalDriver.emit()`
  redacts only the journal line (`session.ts:247-252`); subscribers get the
  raw event. Safe today only because `runShell` redacts before resolving. Any
  new streaming-output event must call `redactSecrets` before `emit`.
- **TB-P3-3. The journal replays in full on every attach.** The phone always
  opens `RemoteDriver(sessionId, daemon, 0)` (`store.ts:746`). A raw terminal
  byte stream pushed through `emit()` would bloat the sealed journal (every
  chunk AES-sealed per line) and make reattach O(total terminal output).
  Terminal-grade streams need their own buffer, not the journal.
- **TB-P3-4. No copy affordance on suggested commands.**
  `app/src/components/Markdown.tsx` renders fenced code with no Copy or Run
  button; the founder is thumb-selecting commands into Termius.

## TB build plan (recommended: Phase 0 now, Phase 1 as the game-changer, Phase 2 as the full terminal)

**Recommendation:** Phase 1 is a first-class command lane ("terminal card" in
chat). It reuses every existing seam (DriverEvent protocol, SSE replay,
daemonAuth, journal, ownership, push) and removes the screenshot loop
entirely. Phase 2 is a real PTY tab with xterm.js as a separate stream
outside the journal. **Reject tmux/ssh integration** as the product path: it
reintroduces exactly the Termius experience the founder is escaping, adds a
second auth surface (ssh keys) alongside daemonAuth, and cannot feed output
into model context cleanly. Phase 2's daemon-held PTY gives the tmux property
that matters (survival across phone disconnects) natively.

**Transport ruling:** extend the existing SSE + POST protocol; do not add
WebSocket in Phase 1. The daemon is plain `node:http`; a WS upgrade means a
new dependency, new auth handling on upgrade, and new WebView quirks, for
latency the tailnet does not need (keystroke POSTs over Tailscale are tens of
ms; batch client-side). SSE already has the resume semantics the app depends
on. WebSocket stays a Phase 2 option if PTY typing ever feels laggy.

### Phase 0 (hours; ship first)
1. `app/src/state/transcript.ts:104`: the TB-P1-1 fix above (detail fallback
   to `content`, `detailKind` branch in `ToolCard`).
2. `app/src/components/Markdown.tsx`: custom `code` renderer adding a Copy
   button to fenced blocks. Useful before Run even exists.

### Phase 1: the command lane (the minimal game-changer)

Goal: any command, model-suggested or founder-typed, runs on the desktop over
the existing daemon connection with one tap, streams live output into the
chat as a terminal card, and its result lands in the model's context so the
model sees outcomes without screenshots.

**Engine (os-code):**
1. New events in `os-code/src/core/agent/types.ts` (browser-safe, re-exported
   via `os-code/src/protocol.ts`; pure type additions keep the Node-free
   contract), added to `DriverEvent` at the driver level like the approval
   events:
   ```ts
   | { type: 'command-start'; runId: string; command: string; cwd: string; source: 'user' | 'agent' }
   | { type: 'command-output'; runId: string; chunk: string; stream: 'stdout' | 'stderr' }
   | { type: 'command-end'; runId: string; exitCode: number | null; signal?: string; durationMs: number; truncated: boolean }
   ```
2. New `os-code/src/core/exec/commandRunner.ts`: extract and generalize the
   spawn logic from `runShell.ts` into a streaming runner: `/bin/bash -c`,
   `detached: true` process-group kill, `stdio: ['pipe','pipe','pipe']`, an
   `onChunk(stream, text)` callback, `write(data)` for stdin, `kill()`
   (SIGTERM, then SIGKILL after 3s), configurable timeout with a much higher
   ceiling for user-initiated runs (default no timeout, kill is explicit),
   and per-chunk `redactSecrets` before anything leaves the runner
   (TB-P3-2). Refactor `runShellTool.execute` onto it (identical external
   behavior, keeps its caps and timeout) so agent and user lanes share one
   execution path.
3. `LocalDriver` additions in `os-code/src/daemon/session.ts`:
   - `runCommand(command, opts): { runId }`, `writeCommandStdin(runId, data)`,
     `killCommand(runId)`. One active user command per session (409
     otherwise). Allow running in parallel with an agent run but never while
     a `runShell` approval is pending, to keep the transcript readable.
   - Journal discipline (TB-P3-3): `command-start`/`command-end` journal
     normally through `emit()`. Output chunks are coalesced (flush every
     ~200ms or 2KB) and the journaled total per run is capped (~64KB with a
     `truncated` marker) so replay stays cheap. Chunks are redacted before
     `emit`.
   - Model context injection (the "no screenshots" half): keep `AgentSession`
     untouched mid-run. `LocalDriver` keeps a
     `pendingTerminalContext: string[]`; on `command-end` it appends a framed
     record: `[terminal] user ran \`cmd\` in <cwd> (exit 0, 4.2s):` plus the
     tail-capped output via `capContent(..., 8000)`. In `send()`, drain the
     queue and prepend it to the user text before `agent.run()`. The model
     sees exactly what happened, in order, on its next turn, with zero
     mid-run history surgery. (A later refinement can push directly into
     `agent.history` when the driver is idle; the prepend is correct and
     simple.)
4. Daemon routes in `os-code/src/daemon/serve.ts`, inside the existing
   `parts[0] === 'sessions'` block so `resolveAuth`, `ownedBy`, and
   rehydration apply unchanged (never bypass daemonAuth):
   - `POST /sessions/:id/commands` `{command, timeoutSeconds?}` returns
     `202 {runId}`
   - `POST /sessions/:id/commands/:runId/stdin` `{data}` (unblocks `y/N`
     prompts without a PTY; document that sudo-password entry waits for
     Phase 2's PTY, since pipe-stdin sudo needs `-S`)
   - `POST /sessions/:id/commands/:runId/kill`
   - Output rides the EXISTING `/events` SSE stream as the new events with
     seqs, so reconnect/replay and the phone's backoff loop need zero
     changes.

   Security posture, stated plainly: a user-initiated command does NOT raise
   a model approval; the authenticated owner's explicit tap IS the approval
   (a second sheet asking to approve the command the user just typed is
   theater). The real gates remain: bearer auth, session ownership (member
   vs admin unchanged), full audit in the sealed journal (`command-start`
   records the exact command and cwd), redaction, and kill. The default-deny
   policy and `remote-attached` profile continue to govern agent-initiated
   `runShell` exactly as today. `PushNotifier.watch` (`push.ts:131-152`)
   keys only on `approval-request`/`task-done`, so command events fire no
   pushes; leave as is.

**App:**
- `app/src/state/types.ts`: new `ThreadItem` variant `{ kind: 'command';
  runId; command; output; state: 'running' | 'done' | 'killed'; exitCode?;
  durationMs?; truncated? }`.
- `app/src/state/transcript.ts`: reduce the three new events; append chunks
  with a client-side cap (~200KB) matching the journal cap.
- New `app/src/components/CommandCard.tsx`: monospace live-tail block
  (auto-stick to bottom, stop sticking when the user scrolls up), running
  spinner, exit badge, Kill button, Copy-output, and a one-line stdin field
  visible while running (posts to the stdin route). Strip ANSI escapes with
  a small regex in Phase 1; full ANSI belongs to Phase 2. Render from
  `MessageList` alongside `ToolCard`.
- Run button on suggested commands: in `Markdown.tsx`'s `code` renderer,
  when the fence language is shell-ish (`bash|sh|zsh|shell|console`, or a
  single-line unlabeled block) AND the active conversation's
  `source.kind === 'desktop'`, show Run next to Copy.
- `app/src/drivers/types.ts`: extend `ChatDriver` with optional
  `runCommand?`, `sendStdin?`, `killCommand?`; only desktop drivers
  implement them. `app/src/drivers/remoteDriver.ts`: three fetches against
  the new routes. `app/src/drivers/electronDriver.ts` +
  `app/electron/engineHost.ts` + `app/electron/main.ts` +
  `app/src/lib/electronBridge.ts`: mirror over IPC (`osc:runCommand` etc.)
  calling the same `LocalDriver.runCommand`, so desktop gets the same card.
- `app/src/state/store.ts`: `runCommand(text)` action next to `send`/`abort`
  (the `store.ts:2560-2591` region). Explicitly do NOT route `command-*`
  through the `autoApproves` path (keeps TB-P2-4 contained).
- Composer entry for ad-hoc commands: a terminal-mode toggle on
  `app/src/components/Composer.tsx` (a `$` pill, visible only for
  desktop-source chats): when on, send runs the text as a command instead of
  a prompt. This is the "type ls from the couch" path.

Phase 1 outcome: the founder reads a suggested command in chat, taps Run,
watches output stream live, taps Kill if needed, answers a `y/N` inline, and
the model's next turn already knows the result. Termius, screenshots, and
retyping are gone for 90 percent of the workflow.

### Phase 2: the full interactive terminal

Goal: a real PTY on the desktop (colors, cursor addressing, sudo, vim-grade
if wanted), rendered in the app, multiplexed over the same daemon, readable
by the model on request.

- **PTY host:** `node-pty` as an optionalDependency of `os-code`. New
  `os-code/src/daemon/terminal.ts`: a `TerminalManager` owning PTYs keyed by
  `termId`, each spawned as the user's `$SHELL` (login shell) with `cwd` =
  the session workspace, holding a ring buffer (~200KB) of raw output with
  absolute byte offsets for reattach replay. PTYs outlive phone connections
  (the tmux property). Runtime caveat: inside Electron, `node-pty` must be
  rebuilt for Electron's ABI (`electron-builder` install-app-deps or
  `@electron/rebuild`); the standalone `osc serve` daemon uses stock
  prebuilds. Guard with a lazy `import()` and degrade to the Phase 1 runner
  with a clear message when the native module is absent.
- **Routes (same auth/ownership block in `serve.ts`):**
  `POST /sessions/:id/term` (ensure/create, returns `{termId, cols, rows}`),
  `GET /sessions/:id/term/:termId/stream?since=<byteOffset>` (SSE of base64
  chunks, each frame carrying its end offset; replay from the ring buffer,
  then live), `POST .../stdin {dataBase64}`, `POST .../resize {cols, rows}`,
  `DELETE .../` (kill). **PTY bytes never enter the event journal**
  (TB-P3-2/TB-P3-3): raw ANSI cannot be meaningfully redacted line-wise,
  sealing keystroke-cadence chunks is pure cost, and replay must be
  offset-based. Journal only `terminal-opened`/`terminal-closed` marker
  events (with cwd, never content) for audit. Never journal or log stdin
  (sudo passwords live there).
- **Renderer:** xterm.js (`@xterm/xterm` + fit addon) in a terminal panel
  for desktop-source chats: new `app/src/screens/TerminalScreen.tsx` (or a
  slide-up drawer inside ChatScreen), driver methods on
  `RemoteDriver`/`ElectronDriver`. iOS specifics: batch keystrokes (20-30ms
  debounce) into stdin POSTs; an accessory key row above the keyboard (Esc,
  Tab, Ctrl, arrows, pipe); on background/foreground (Capacitor `App`
  resume, the same lifecycle `push/beat` uses) re-open the SSE at the last
  byte offset, `term.reset()`, replay; `resize` on rotation via the fit
  addon.
- **Chat and terminal, both directions:** the Phase 1 Run button gains "Run
  in terminal" for interactive commands (writes `cmd + "\n"` to the PTY and
  switches to the panel). Terminal to model: a new engine tool
  `readTerminal` in `os-code/src/core/tools/readTerminal.ts` (registered in
  `registry.ts`), risk `read`, returning the last N lines of the ring buffer
  ANSI-stripped, `capContent`-capped, and `redactSecrets`-redacted, via a
  `ToolContext` accessor wired in `bootstrap.ts`. Then "look at my terminal
  and fix the error" works with zero screenshots. If an agent
  `writeTerminal` tool is ever added it must be risk `shell` with
  `alwaysAsk: true` (the existing `ToolDef.alwaysAsk` seam,
  `tools/index.ts:60-63`): injecting keystrokes into a live user shell must
  never be silent.
- **Security:** PTY creation restricted to the session owner (same
  `ownedBy`) and, since a PTY is an unjailed interactive shell, to
  admin-role credentials via the existing `requireAdmin` seam
  (`serve.ts:142-146`); members keep the approval-gated agent lane and the
  Phase 1 command lane. daemonAuth untouched; bind policy untouched.

### TB phasing summary

| Phase | Engine files | App files |
|---|---|---|
| 0 | none | `src/state/transcript.ts`, `src/state/types.ts` (detailKind), `src/components/ToolCard.tsx`, `src/components/Markdown.tsx` |
| 1 | `src/core/agent/types.ts`, `src/protocol.ts` (re-export check), NEW `src/core/exec/commandRunner.ts`, `src/core/tools/runShell.ts` (refactor onto runner), `src/daemon/session.ts`, `src/daemon/serve.ts` | `src/state/types.ts`, `src/state/transcript.ts`, `src/state/store.ts`, `src/drivers/types.ts`, `src/drivers/remoteDriver.ts`, `src/drivers/electronDriver.ts`, NEW `src/components/CommandCard.tsx`, `src/components/MessageList.tsx`, `src/components/Markdown.tsx`, `src/components/Composer.tsx`, `electron/engineHost.ts`, `electron/main.ts`, `src/lib/electronBridge.ts` |
| 2 | `node-pty` optional dep, NEW `src/daemon/terminal.ts`, `src/daemon/serve.ts` (term routes), NEW `src/core/tools/readTerminal.ts`, `src/core/agent/registry.ts`, `src/core/agent/bootstrap.ts` | `@xterm/xterm` dep, NEW `src/screens/TerminalScreen.tsx`, drivers, `App.tsx` routing, keyboard accessory component |

Tests per repo convention: commandRunner streaming/kill/redaction unit
tests, daemon route tests beside the existing serve tests, transcript
reducer tests for the three new events. Note: Phase 1 and 2 streaming on the
phone DEPENDS on TS-P0-1 being resolved first (the same SSE path).

---

# AREA 3: Marketplace

## Architecture map (verified, for orientation)

- **Builder (CI only):** `os-code/scripts/build-catalog/` with `index.ts`
  (I/O shell), `enrich.ts` (pure build + gates), `gate.ts` (regression gate),
  `sources.ts` (HF metadata fetch), `stars.ts` (benchmark-to-star tables),
  `licenses.table.ts` (SPDX allow-list), `types.ts`. Seed is
  `os-code/catalog.sample.json` (27 models, 4 presets) plus
  `os-code/curation/{benchmarks,eval,recommended}.json`. Workflow:
  `.github/workflows/catalog.yml` (weekly cron `17 8 * * 1`, path-triggered,
  manual) publishes by committing to the marketing repo, served at
  `openshore.ai/os-code/catalog.json`.
- **Engine consumption:** `os-code/src/market/schema.ts` (zod), `catalog.ts`
  (remote + cache + bundled fallback, egress-checked), `install.ts` (Ollama
  `/api/pull` streaming, CLI fallback, HF prints the command). CLI:
  `os-code/src/commands/market.ts`. Daemon: `GET /catalog` only
  (`serve.ts:303`).
- **App storefront:** `app/src/screens/MarketplaceScreen.tsx` + pure logic in
  `app/src/components/marketplace.ts`, `Stars.tsx`, `CompareSheet.tsx`,
  `MarketIcon.tsx`; catalog loading in `app/src/lib/catalog.ts`; device
  downloads via `app/src/lib/llamaPlugin.ts` +
  `app/plugins/oscode-llama/ios/.../ModelStore.swift`; desktop installs via
  `app/src/lib/electronBridge.ts` + `app/electron/engineHost.ts:219`.
- **Already genuinely good:** App-Store-front information architecture
  (featured heroes, capability shelves, category rail), half-step star
  tracks with provenance chips, honest absence states ("Not yet rated"),
  honest per-axis subheads, staggered card entrance with a calm spring,
  reduced-motion kills, monogram tiles, the compare tray. Schema validation
  of remote catalogs is strong everywhere it is consumed (S1 below).

## MP functional gaps

### MP-F1. P1. A standalone iPhone never sees the published catalog; three headline features are dead there
- **Where:** `app/src/lib/catalog.ts:15-37` (verified): load order is
  Electron bridge, then paired daemon, then bundled `catalog.sample.json`.
  There is NO direct fetch of `https://openshore.ai/os-code/catalog.json`.
  The bundled seed carries none of the builder-computed fields (no ratings,
  popularity, recommended, timestamps; confirmed by
  `os-code/test/catalog.schema.test.ts:18`).
- **Failure:** a paying Personal-tier iPhone user with no desktop pairing (a
  fully supported configuration; Marketplace is exactly what Personal
  unlocks, `app/src/state/store.ts:1260`) gets: every card "Not yet rated";
  Staff picks renders the empty state (`MarketplaceScreen.tsx:268` filters
  on `recommended?.isRecommended`, `:935-939`); the Popular sort silently
  degrades to curated order while its subhead still claims "Ranked by
  downloads and likes" (`:70-75`); the "Popular right now" shelf never
  appears (`marketplace.ts:342-353` needs 3+ models with popularity); no
  hero says "OpenShore pick"; Newest degrades to curated order.
- **Fix:** in `loadAppCatalog`, when no bridge and the daemon is absent or
  fails, fetch the published URL directly (validated with
  `CatalogSchema.parse`, 6-8s timeout), cache via `storeSetJson` with a
  refresh window mirroring `config.catalog.refreshHours` (24h), fall back to
  cache then bundled. Keep the honest `note` string per source.

### MP-F2. P1. On the phone, "Get" on any desktop model is a dead end even when a desktop IS paired
- **Where:** `MarketplaceScreen.tsx:214-218`: `pullToDesktop` requires the
  Electron bridge, otherwise toasts "Desktop models install from the desktop
  app." The daemon has no install endpoint at all (full route list at
  `serve.ts:151-343`).
- **Failure:** a user who paired their phone over Tailscale, whose phone
  drives desktop coding sessions remotely, still cannot install a model onto
  that desktop from the storefront. 24 of the 27 models are desktop models;
  on the phone their Get buttons all dead-end.
- **Fix:** add `POST /models/install` to `serve.ts` (admin-gated like
  `/workspaces/clone`, body `{modelId}`), reusing `installModel` from
  `src/market/install.ts` with progress buffered per install and polled via
  `GET /models/install/:id/progress` (or streamed as NDJSON). In
  `pullToDesktop`, when `bridge()` is absent but `settings.daemon` exists,
  call the daemon path and drive the same `downloads` state.

### MP-F3. P1. Preset stacks are browsable nowhere in the app; the store cannot sell its own bundles
- **Where:** the catalog ships 4 presets; schema, gate, and CLI support them
  (`osc market presets --apply`, `os-code/src/commands/market.ts:144-185`).
  In the app the ONLY surface is a one-line mention inside a card's expanded
  detail ("In these stacks: ...", `MarketplaceScreen.tsx:489-497`). No
  preset shelf, no detail, no apply, no install-all.
- **Fix:** add a "Starter stacks" shelf (in `buildShelves`' output or a
  dedicated section above the capability shelves) rendering
  `catalog.presets` as cards: name, tagline, member models with monogram
  tiles, combined `sizeGB`, fit pill vs the machine tier, `minVramGB`.
  One-tap on desktop: sequential `bridge().installModel` per member with the
  existing progress UI, then `setOrchestrator` + `enableSpecialist` per role
  (both already on the bridge, `electronBridge.ts:78-80`). On phone, gate
  apply behind MP-F2's daemon endpoint or show the honest browse-only state.

### MP-F4. P1. A pocket-model download does not survive app relaunch in the UI; a download finishing while the app is away is never adopted
- **Where:** native side is built for background completion
  (`ModelStore.swift:246-258` moves the finished GGUF into place;
  `recoverActiveTasks` at `:189-211` re-attaches) and JS exposes
  `activeDownloads()`. But `app/src/state/store.ts:1164-1178` re-drives only
  the two Harbor ids; boot reconciliation at `store.ts:1047-1056` only
  REMOVES `deviceModels` entries whose files vanished, never adds entries
  for present files; `addDeviceModel` (`store.ts:2601-2606`) is only called
  from `pullToDevice`'s live happy path (`MarketplaceScreen.tsx:197`).
- **Failure:** user taps Get on the phone starter model, backgrounds the
  app, iOS finishes the 1.1 GB transfer, user reopens: the card says "Get"
  again, the GGUF silently occupies storage, and tapping Get re-downloads.
- **Fix:** (a) in boot reconciliation, ADD entries for `listModels()` ids
  matching a catalog model id (name from the catalog, falling back to the
  id); (b) extend the relaunch re-attach to any id in `activeDownloads()`
  and seed a store-level `deviceDownloads` map the screen reads; the
  existing `downloadProgress` listener (`MarketplaceScreen.tsx:147-158`)
  then animates it.
- **UNCONFIRMED (device-only):** whether the plugin's `downloadProgress`
  events for a recovered task reach a listener registered after relaunch.
  Settle by starting a pocket download on device, force-quitting,
  relaunching, and watching the card.

### MP-F5. P1. An HF outage publishes a popularity-stripped catalog instead of keeping the last good numbers
- **Where:** `scripts/build-catalog/index.ts:69-73` publishes when an online
  run resolves zero popularity (warn only); `enrich.ts:149-153` omits
  `popularity` when metadata is missing; `gate.ts` has no popularity
  invariant.
- **Failure:** on a bad HF day the weekly run wipes downloads/likes from all
  models; the app hides "Popular right now", the Popular sort quietly
  degrades, and the stripped catalog becomes next week's regression
  baseline.
- **Fix:** in `buildModel`, when `inputs.metadata[base.source.ref]` is
  absent and the parsed `previous` catalog has `popularity` for the same
  model id, carry the previous popularity forward (optionally only if the
  previous catalog's `updated` is under N weeks old). Add a gate check:
  when online, if the count of models with popularity falls by more than
  half vs previous, breach. `previous` is already in `BuildInputs`; a
  two-line plumb into `buildModel`.

### MP-F6. P2. A successful desktop install never marks the model installed; HF-sourced desktop models "fail" into a toast
After `pullToDesktop` succeeds the card shows "Get" forever: `owned` covers
only on-device models (`MarketplaceScreen.tsx:317-318`) and the screen never
consults `bridge().status().ollama.models` (available,
`electronBridge.ts:14`). Separately, a desktop model with
`source.kind === 'huggingface'` routes to `installModel`, which by design
returns `ok:false` with a multiline "Fetch it with: <command>" message
(`os-code/src/market/install.ts:45-50`) that the screen shows as a transient
toast (`:225-228`), unreadable and un-copyable (latent today: all 24 desktop
models are Ollama-sourced). Fix: fetch `status()` on mount and mark models
whose `source.ref` is in `ollama.models` as installed; for HF desktop
sources, skip the pull attempt and open the detail panel scrolled to the
pull command with a copy button.

### MP-F7. P2. Hardware fit on the phone is a fiction; `onDevice.minRamGB` is dead data
`memoryGB` defaults to 16 and is only corrected through the Electron bridge
(`MarketplaceScreen.tsx:105,108-117`); the daemon exposes no hardware
(`serve.ts:151-159`). On iOS every fit pill is computed against an imaginary
16 GB desktop, including pocket models, whose honest floor
`onDevice.minRamGB` (`os-code/src/market/schema.ts:83`) is used nowhere in
the app. An iPhone with 4 GB RAM shows "Runs here" on a 9 GB desktop model.
Fix: (a) on iOS compute pocket fit from `onDevice.minRamGB` vs real device
RAM (expose `physicalMemory` in the llama plugin's `isSupported()` payload:
`ProcessInfo.processInfo.physicalMemory`, one line of Swift); (b) for
desktop models on the phone either hide the pill or label it "on your
desktop" and, when paired, source the tier from a new daemon `/hardware`
(or fold `budgetFor(detectHardware()).summary` into `/health`).

### MP-F8. P2. Loading is a bare text line; no skeleton, no error surface, no manual refresh
`MarketplaceScreen.tsx:291-300` renders "Loading the catalog." as a hint
paragraph; the catalog can take up to 8s before fallback, and the only
remedy for a stale cache is waiting out `refreshHours`. Fix: a skeleton
storefront (2 hero placeholders + 2 shelves of 3 rows reusing the existing
`build-shimmer` animation, killed by the global reduced-motion reset at
`theme.css:2920-2925`), plus pull-to-refresh or a refresh affordance next to
the note.

### MP-F9. P2. "Staff picks" axis offered even when the catalog has zero picks
The `used` axis hides itself when empty (`MarketplaceScreen.tsx:243-262`);
`staff` does not, and with a pick-less catalog (bundled fallback) it lands
on the empty state. Fix: gate the `staff` sort entry on
`catalog.models.some((m) => m.recommended?.isRecommended)`.

### MP-F10. P2. Nested interactive elements
`renderHero` (`MarketplaceScreen.tsx:544-564`) and `renderRow` (`:573-585`)
are `<button>`s containing the Get `<button>` from `getControl`
(`:526-537`). Button-inside-button is invalid HTML; screen readers announce
it unpredictably and Safari can fire both. Fix: card becomes a `div` with
`role="link"`/`onClick`/`onKeyDown`, or position the Get control as a
sibling overlay.

### MP-F11. P2. The "product page" is a search-query hack
`openModel` (`MarketplaceScreen.tsx:507-510`) sets `facets.query =
model.name` and relies on fuzzy match; siblings can ride along and the
result is a filtered list, not a detail view. Resolved by MP-P-1.

### MP-F12. P2 (copy). Promises that cannot be true
`SORT_SUBHEAD.popular` says "downloads and likes on Hugging Face and Ollama"
(`MarketplaceScreen.tsx:72-74`); popularity is HF-only by design
(`sources.ts:8-11`). Fix the string to "on Hugging Face". Also the
`store-note` "this phone uses them over Tailscale" renders on plain web too
(`:885-890`, guard is `!isDesktop()` not `isPhone()`) and is duplicated at
`:927-932`.

## MP premium-experience items

### MP-P-1. P1. No model detail page
Everything hangs off an inline disclosure inside a list card
(`MarketplaceScreen.tsx:465-499`). A premium storefront needs a product
page: full-height sheet or pushed screen with the tile, tagline, fit for
THIS machine with a one-line why ("needs ~11 GB, you have 16"), the ratings
block, popularity, context length, quantization with the tradeoff in plain
words, license (name, posture, note, link), the pull command with a copy
button, preset membership as tappable chips, and the Get button pinned.
Suggested: new `app/src/components/ModelSheet`, sibling pattern to
`CompareSheet`, opened from hero/row/card taps. Also resolves MP-F11.

### MP-P-2. P1. Quant options and context depth are single hard-coded values
Each model shows exactly one quantization (Q4_K_M) and one size; no "choose
your quant" and no explanation of what Q4_K_M means anywhere. Ollama tags
support quant variants (`qwen2.5-coder:14b-instruct-q8_0`). Minimum: a
one-line plain-language gloss under the meta row. Full fix ties into MP-A-3
(publish the sibling GGUF quant list per model, render a quant picker in the
detail sheet).

### MP-P-3. P2. Hero imagery
Monogram tiles are a solid system, but heroes are text-on-flat-card. Cheap
on-brand upgrade: per-capability generative wave/gradient backdrops on
`hero-card` (CSS only, keyed off `model.categories[0]`, existing palette
tokens), with the capability glyph ghosted large at low opacity behind the
hero text.

### MP-P-4. P2. Filter empty state
`:938` "No models match these filters yet." should carry a Clear-filters
button (the action exists at `:785-792`) and ideally name the binding facet.

### MP-P-5. P2. Download affordances
No visible Cancel during an in-flight device download even though
`Llama.cancelDownload` exists and is used for Harbor (`store.ts:2275`). Add
Cancel during flight; keep the percent visible on the card list variant.

### MP-P-6. P2. Context length is buried
The `market-meta` line (`:409-411`) buries context length, the single most
decision-relevant spec, mid-string. Promote ctx to its own labeled chip in
the detail sheet (MP-P-1).

### MP-P-7. P3. `market-card` entrance uses `animation-fill-mode: both`
`theme.css:3092` on an element with an `:active` transform (`:3109-3112`).
The keyframes end at identity so nothing visibly breaks today, but `both`
pins the entrance transform and can silently kill the press; use
`backwards`.

### MP-P-8. P3. Offline note placement
The `note` is appended to the lead sentence (`:802`) and easy to miss; a
quiet dismissible banner reads more deliberate.

## MP Hugging Face automation

### Where it stands today
- (a) **Weekly popularity refresh: YES** (cron `17 8 * * 1`, public HF
  models API per model, Ollama models via `popularityRef`). **Sizes: NO.**
  `sizeGB`, `quantization`, `contextTokens` are hand-typed in
  `catalog.sample.json` and never verified against HF file listings.
- (b) **Discovery: NO.** The roster is 100 percent hand-curated; a new model
  means editing four files by hand (workflow in
  `os-code/docs/MARKETPLACE.md`). Structural note: the quality gate makes
  fully automatic admission impossible by design (orchestrators need a local
  eval run, specialists need curated benchmark rows), so the right target is
  candidate discovery + auto-enrichment + a human-approved PR, not
  auto-publish.
- (c) **GGUF quant updates: NOT tracked.** `lastModified` ships as
  `updatedAt` but file-level changes are invisible: no revision sha, no file
  list, no size verification. 24/27 models pull via floating Ollama tags, so
  re-pulls pick up whatever the tag points to, but nothing is pinned and
  published `sizeGB`/`quantization` can silently drift. The three
  `onDevice` HF URLs are pinned to specific files and will 404 if the
  upstream repo reorganizes; nothing checks them.
- (d) **The wasteful-commit follow-up is ALREADY FIXED in code, still listed
  open in PROGRESS.** `enrich.ts:55-86` (`chooseUpdated` +
  `contentSignature`) carries `updated` forward on a true no-op, and the
  publish step skips on `git diff --cached --quiet` (`catalog.yml:117-124`).
  Residuals: tick the stale entry at `os-code/PROGRESS.md:138-140`, and add
  the missing unit test (same catalog twice keeps `updated`; a one-field
  change advances it).
- (e) **Rate limits/auth: anonymous, bursty, no retry.** No auth header; all
  27 requests fire concurrently via `Promise.all` (`sources.ts:94-103`),
  one 8s timeout, no backoff; a partial 429 run publishes partial popularity
  silently (and a full failure strips it, MP-F5).
- (f) **License allow-list: fail-closed at build, good; two drift holes.**
  Hole 1: the HF `cardData.license` tag is fetched (`sources.ts:46`) and
  never used for verification; an upstream relicense keeps the old license
  asserted with no alarm. Hole 2: the app duplicates the commercial-posture
  mapping by hand (`app/src/components/marketplace.ts:25-38`) because the
  published catalog does not carry the `commercial` flag; no test asserts
  the mirror matches the builder table.

### Automation upgrade plan (exact files)
- **MP-A-1. Discovery stage (new):** `os-code/scripts/build-catalog/discover.ts`
  plus `.github/workflows/catalog-discovery.yml`. Weekly (offset from the
  publish cron), query
  `https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=100`
  and the same with `sort=trendingScore`; also per-family queries
  (`author=Qwen`, `bartowski`, etc.) for updated instruct GGUFs. Candidate
  filter, all machine-checkable: license tag maps onto `LICENSE_TABLE`;
  `gguf` tag present; not already in the seed by ref OR `popularityRef`;
  downloads/likes above a floor (e.g. 50k/500); a Q4_K_M (or nearest)
  sibling under a size ceiling. For each candidate auto-draft a full seed
  stub: `id`, `name`, `source.ref`/`pullCommand`, `sizeGB` from the sibling
  file size (`GET /api/models/{repo}?blobs=true` returns
  `siblings[].size`), `quantization` from the filename, `license.id` from
  the tag, `categories` heuristically from tags,
  `orchestratorCapable: false` (honest default; promotion requires a human
  eval). Write candidates to a new `os-code/curation/candidates.json` and
  open a PR against `openshore.code.ai` using the workflow's `GITHUB_TOKEN`
  with `permissions: {contents: write, pull-requests: write}`
  (`gh pr create`), the body listing each candidate with its numbers and
  the missing human steps. Humans approve by moving entries into
  `catalog.sample.json` plus benchmark rows; the existing path trigger then
  rebuilds and publishes. This keeps the curated gate intact while making
  the landscape come to the founder: it is the piece that changes the
  Marketplace from "hand-fed roster with automated enrichment" to "tracks
  the HF landscape with human approval."
- **MP-A-2. Popularity resilience** (`sources.ts`): read
  `process.env.HF_TOKEN` and send `authorization: Bearer` when set; bound
  concurrency (small inline semaphore, 4 at a time); one retry with
  jittered backoff on 429/5xx. Add `HF_TOKEN: ${{ secrets.HF_TOKEN }}` to
  the job env (optional secret; absent keeps anonymous behavior).
- **MP-A-3. GGUF revision + size tracking** (`sources.ts`, `enrich.ts`,
  `os-code/src/market/schema.ts`): capture the repo `sha`; for HF-sourced
  and `onDevice` models resolve the referenced GGUF's file size; publish
  optional `source.revision`; HEAD-check `onDevice.url` during the build
  (gate breach on 404: a dead pocket URL is a broken Get button on every
  iPhone); warn when sibling-file size disagrees with seed `sizeGB` by more
  than 10 percent (the MP-A-1 PR flow carries the correction).
- **MP-A-4. Popularity carry-forward + coverage gate:** MP-F5 above.
- **MP-A-5. License drift check** (`enrich.ts`): compare `meta.licenseTag`
  (normalized) against `base.license.id`; on mismatch log a loud warning
  into the job summary (fail-closed drop is too aggressive for tag noise,
  but the signal must exist). Test in `catalog.builder.license.test.ts`.
- **MP-A-6. Ship the commercial flag** (`schema.ts`, `enrich.ts`,
  `app/src/components/marketplace.ts`): add optional
  `commercial: z.enum(['ok','non-commercial','gated']).optional()` to
  `CatalogLicenseSchema`, populate from `licenseRow.commercial` in
  `buildModel`, have `licensePosture()` prefer `model.license.commercial`
  with the current table as fallback for old catalogs. Kills drift hole 2
  structurally.
- **MP-A-7. Cadence:** if fresher popularity is wanted,
  `cron: '17 8 * * 1,4'` is the whole change; the no-op guards make extra
  runs free.
- **MP-A-8. Test the no-op stamp** and tick the stale follow-up at
  `os-code/PROGRESS.md:138-140`.

## MP correctness / security

- **MP-S1. Remote-catalog validation: GOOD everywhere consumed.** Engine
  parses remote, cache, and bundled (`os-code/src/market/catalog.ts:45,57,69,76`);
  app daemon path parses before render (`app/src/lib/catalog.ts:29`); zod
  strips unknown fields; the gate refuses to publish against an unparseable
  baseline; the workflow refuses a failed baseline fetch other than a
  genuine 404. Strong shape; nothing to do.
- **MP-S2. P2. `onDevice.url` is an unconstrained string end to end.**
  Schema `z.string()` (`schema.ts:79-84`, no `.url()`, no host
  restriction); the only guard is the native https scheme check
  (`OscodeLlamaPlugin.swift:181`). Whoever can write the marketing repo (or
  holds `MARKETING_DEPLOY_TOKEN`) can point iPhones at any https URL for a
  multi-GB background download parsed by llama.cpp (a parser with a CVE
  history against malicious GGUF). Fix: builder gate asserting the host is
  `huggingface.co` (the URLSession follows the resolve redirect to
  `cdn-lfs.huggingface.co` after the check), the same host check
  client-side before `Llama.downloadModel`, plus the MP-A-3 liveness check.
- **MP-S3. P3. Rendering is injection-safe** (all catalog strings render as
  React text nodes, no `dangerouslySetInnerHTML`, `license.url` never
  rendered as a hyperlink). The one social-engineering surface is
  `pullCommand`, shown as copyable text (`:486-488`); the gate only checks
  non-empty (`enrich.ts:99-101`). Cheap hardening: gate that it matches
  `^ollama pull \S+$` for Ollama sources and starts with a known tool for
  HF sources.
- **MP-S4. P3. HTTPS/egress:** default catalog URL is https and engine
  fetches go through `EgressPolicy.fetch` with per-hop redirect checks. The
  policy allows plain http to non-local hosts if a user edits config;
  acceptable for a local-first tool.
- **MP-S5. P3. Cache:** engine cache is mtime-based, no ETag, negligible at
  this size. The standalone app has NO cache because it has no remote fetch;
  MP-F1's fix adds the Preferences-backed cache.
- **MP-S6. P3. `parseMemoryGB`** (`MarketplaceScreen.tsx:52-59`) is correct
  against the current summary format (verified vs `resourceBudget.ts:121-122`)
  but is a string-scrape of prose; if the wording changes the fit tier
  silently reverts to 16. Prefer structured `totalVramGB`/`systemRamGB` on
  `DesktopStatus`.
- **MP-S7. P3. Publish job:** token-in-clone-URL is standard for actions;
  concurrency group prevents racing publishes; rebase-retry caps at 3 and
  fails loudly. Nit: `git fetch --depth=50` before the rebase can hit a
  shallow boundary if marketing main advances more than 50 commits mid-run;
  acceptable.

---

# Cross-cutting notes for the implementing session

1. **TS-P0-1 gates everything phone-streaming.** The terminal bridge Phase 1
   and 2, remote chat, and cloud streaming all ride the same WebView fetch.
   Confirm and fix it first.
2. **Three findings share the daemon-route pattern** (MP-F2 install
   endpoint, TB Phase 1 command routes, TB Phase 2 term routes): build them
   with the same auth/ownership discipline as the existing
   `parts[0] === 'sessions'` block, admin-gating anything that reaches
   arbitrary paths (the TS-P1-4 lesson).
3. **TS-P1-4 is the one security must-fix** in this review; it is a two-line
   gate reuse plus a test.
4. **Product decisions to put to the founder before building** (sign-off
   gate): whether free-tier chat with the user's own desktop models stays
   paywalled (TS-P1-6); whether Phase 2 (full PTY) is wanted after Phase 1
   ships; the MP-A-1 discovery-PR workflow shape (who reviews candidate
   PRs); MP-P-3 hero art direction.
5. **UNCONFIRMED items and their checks**, collected: TS-P0-1 (inspect
   `@capacitor/core` dist or device-test streaming), TS-P2-8 (run on a real
   Mac), MP-F4 (device test of recovered downloads), plus: check past
   `catalog.yml` run logs for the `popularity resolved N/M` line to see if
   anonymous HF rate limiting has ever actually bitten; device-test whether
   re-tapping Get on an already-downloaded-but-unrecorded model re-downloads
   (the `startTask` path in `ModelStore.swift` does not check for an
   existing file first; the code reads as re-download).
6. **Update `os-code/PROGRESS.md` and `DECISIONS.md`** as waves land, per
   the repo's standing rules, and keep every new persisted or user-facing
   string inside the existing enforcement tests' reach.
