# OS Code review: local-first modulation, UI/UX vs the Uki bar, and the model stack

Full review, 2026-08-25, on branch `claude/openshore-review-local-first-9q1ja9`
(includes the org-vault and agent-vault-writes commits newer than PROGRESS.md's
snapshot). Findings only; **nothing here is fixed yet.** Produced by four
parallel senior-review passes (UI/UX vs the Uki gold standard, gitOS, Vault,
driver stack + parity), each verified against real code and callers, with the
top-severity claims independently re-verified line by line in a second pass.
The prior full-platform review (2026-08-20, `CODE-REVIEW-FINDINGS.md`) was
already remediated; nothing here re-opens it. This review covers what landed
since: gitOS, Vault, BYOM, mid-chat model switching, the speech plugin, and the
whole front end measured against Uki's motion and polish standard.

## How to use this document (for the implementing session)

This document is written for a Claude Opus 4.8 build session. Conventions:

- **Severity.** P0 = data loss, security hole, or a shipped-but-dead critical
  path. P1 = incorrect behavior a user hits. P2 = robustness/hygiene. UI/UX
  findings use Uki's tiers instead: Tier 1 = biggest feel-uplift per LOC,
  Tier 3 = housekeeping.
- **Each finding has a Verify line.** Prefer writing that test or repro FIRST
  (red), then fixing (green). Where a harness is missing, the harness itself is
  a named finding (H-1, H-2).
- **Work in the waves given at the end.** They batch by file so each file is
  edited once, and they front-load the data-loss fixes. Several findings share
  a root cause; fix the cluster, not the symptom.
- **Founder decision points are fenced off** in their own section. Do NOT
  build those without an explicit yes; everything else is yours to fix.
- **Repo policy reminders:** no em dash anywhere in tracked source, comments
  included (`test/em-dash-policy.test.ts` in both packages enforces it); gates
  before push are `pnpm typecheck`, `pnpm lint --max-warnings 0`, both test
  suites, and `vite build`.
- **Cross-checked findings.** The gitOS and Vault passes independently found
  DL-1, DL-4, and SEC-1 below; they are deduplicated here into one finding
  each. Where two passes disagreed on emphasis, the stricter reading is kept.

## Executive summary

1. **Two shipped data-loss paths in Vault, both small fixes.** The debounced
   autosave is cleared, never flushed, on unmount (the comment claims
   otherwise), and every provider save/list error is silently swallowed, so an
   offline cloud vault drops typed text without a word. A third path: iCloud's
   "not downloaded yet" reads as "note does not exist" and autosave then
   overwrites the cloud copy with empty text.
2. **The headline Vault feature is dead in the shipped renderer.** react-markdown
   10's default `urlTransform` strips the `vault:` protocol, so wikilinks in
   read mode render with an empty href and in-vault navigation does not work.
   One-line fix plus a render test.
3. **Mid-chat model switching has two undermining bugs:** reopened
   conversations after a relaunch are never reseeded (total model amnesia while
   the full transcript is on screen), and a failed switch leaves the header
   claiming the new model while the old driver answers.
4. **The Repositories offload pipeline is unreachable end to end.** Nothing
   ever calls `bufferCommitIntent` and no UI can set `homePath`, so the
   buffered-commit cards, the sync engine, and the polished desktop apply path
   are dead weight in the shipped app. Wire it or hide it (founder call).
5. **UI/UX is at pre-audit Uki.** Right taste (springs, a real haptics bus, an
   excellent SwipeRow), but no motion-token vocabulary (30+ raw curves, one
   drifted near-duplicate used 11 times), six sheets plus the drawer, toast,
   and popovers snap-unmount with no exit, chat autoscroll steals the scroll
   during streaming, and there is zero enforcement in `app/test/`. The overall
   parity verdict: the desktop engine is a genuine local-first Claude Code;
   the phone is an excellent Claude chat client that orbits it.

---

# Part 1: Data loss and security (fix first)

## DL-1 (P0). Debounced Vault autosave is dropped on unmount; no flush on background or suspend

- **Files:** `app/src/screens/VaultScreen.tsx:127-144`.
- **Evidence:** the comment promises "Anything pending flushes on unmount";
  the cleanup only cancels:

  ```ts
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );
  ```

- **Failure scenario:** type in a note, tap BackBar (or the sidebar, or switch
  notes) within 600ms of the last keystroke: the timer is cleared, `vaultSave`
  never runs, the last edit burst is gone on every provider including Local.
  Separately, no `visibilitychange` / Capacitor `appStateChange` listener
  exists anywhere in `app/src`, so iOS backgrounding or jetsam eats up to
  600ms of typing on every suspend. People type and immediately leave; this
  window is hit constantly.
- **Fix:** keep the pending `{path, text}` (and its scope/target, see DL-2) in
  the ref; in the cleanup, clear the timer AND synchronously fire `vaultSave`
  with the latest draft. Add an `appStateChange`/`visibilitychange` flush when
  state leaves active. Also flush before `vaultOpen` of a different note,
  before `vaultDelete`, in the "All notes" handler, and before
  `setVaultScope`.
- **Verify:** component test: mount the editor, type, unmount at t=300ms,
  assert the provider write was called with the final text. Second test:
  schedule a save, fire the appstate listener, assert the write.

## DL-2 (P1). Pending save timer fires against the wrong world: delete-resurrection and a personal-to-team privacy leak

- **Files:** `app/src/screens/VaultScreen.tsx:129-138`,
  `app/src/state/store.ts:2452-2455` (`vaultSave` resolves its target from the
  CURRENT `vaultScope` at fire time).
- **Failure scenarios (both inside the 600ms window):**
  1. Type, open Options, Delete this note: `vaultDelete` removes it, the timer
     fires and recreates it. Toast says "Note deleted." and it is back.
  2. Type, tap "All notes", tap the Team tab: the timer fires, `vaultTarget()`
     now resolves to the org provider, and a PERSONAL note body is written
     into the shared team vault, visible to the whole org. Reverse direction
     writes a team note into the personal vault.
- **Fix:** capture scope/target alongside path+text at `scheduleSave` time and
  pass it through (or make `vaultSave` take an explicit resourceId+provider).
  Clear or flush the timer inside `vaultDelete` and `setVaultScope`. Do this
  in the same PR as DL-1; it is the same code area.
- **Verify:** unit test: schedule a save, call `setVaultScope('team')`,
  advance timers, assert the org provider's `write` never received the
  personal note.

## DL-3 (P0). iCloud "not yet downloaded" reads as "does not exist"; autosave then clobbers the cloud copy with empty text

- **Files:**
  `app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/OscodeIcloudPlugin.swift:91-106`,
  `app/src/state/store.ts:2436-2446` (`vaultOpen` fabricates an empty note),
  `app/src/screens/VaultScreen.tsx:113-117` (`setEditing(text === '')` puts
  the user straight into edit mode).
- **Evidence:** the plugin calls `startDownloadingUbiquitousItem` without
  awaiting, then `try? Data(contentsOf:)` fails on the placeholder and it
  resolves `found: false`. `vaultOpen` turns undefined into
  `{ path, text: '' }`.
- **Failure scenario:** device B opens a note whose bytes have not synced down
  yet; the app opens an empty editor; one keystroke plus 600ms writes
  near-empty text to iCloud, which syncs and destroys the note on every
  device.
- **Fix:** in Swift, distinguish placeholder-undownloaded (check
  `ubiquitousItemDownloadingStatusKey`) from missing; return a third state and
  poll or await the download with a timeout. In `vaultOpen`, never fabricate
  an empty editable note for a path that appears in `vaultFiles`; show a
  "downloading from iCloud" state instead.
- **Verify:** unit test `vaultOpen` with a mock provider where `list()`
  contains the path but `read()` returns undefined; assert no empty note is
  opened for editing. On-device repro on TestFlight: two devices, airplane
  mode on B during a large save on A, then open on B.

## DL-4 (P0). Provider errors are invisible: an offline cloud vault silently loses everything typed and renders as brand-new-empty

- **Files:** `app/src/state/store.ts:2413-2434` (`vaultRefresh`, no catch),
  `store.ts:2452-2464` (`vaultSave`, no catch),
  `app/src/screens/VaultScreen.tsx:106,134` (`void vaultRefresh()`,
  `void vaultSave(...)`), `app/src/lib/gitos/gdrive.ts:46-57` (throws on any
  non-OK or fetch failure), `orgVault.ts:67-71` (throws when signed out),
  `VaultScreen.tsx:463-474` (first-run empty-state copy).
- **Failure scenarios:** vault on Google Drive, airplane mode: (a) every
  debounced write throws an unhandled rejection while the UI looks fine; the
  user leaves the note and ten minutes of typing exist nowhere. (b) `list()`
  throws, `vaultFiles` stays `[]`, and a fifty-note vault renders the
  first-run "Your vault starts with one note." greeting. Same class of
  failure for the team vault when the session token expires mid-edit.
- **Fix:** catch in `vaultSave`/`vaultRefresh`/`vaultOpen`. On save failure:
  toast, mark the draft dirty-and-unsaved, and write the draft through to a
  durable local fallback (the Local provider or a
  `oscode.vault.pending.<path>` key), replayed on next successful save. On
  refresh failure: keep the last-known file list (cache metas locally) and
  render an explicit offline/error state distinct from an empty vault.
- **Verify:** unit tests: provider `write` rejects, assert toast + draft
  recoverable after the provider returns; provider `list` rejects, assert the
  error state renders, not the first-run greeting, and a previously loaded
  list is not cleared.

## DL-5 (P0). syncOutbox saves the outbox from a stale snapshot, deleting anything buffered mid-sync

- **File:** `app/src/state/store.ts:2073-2146`.
- **Evidence:** the outbox is snapshotted at entry (`const s = get().settings`),
  a long awaited network loop runs, then
  `saveSettings({ repo: { ...s.repo!, outbox: kept } })` writes `kept`
  computed from the pre-sync snapshot, erasing any item `bufferCommitIntent`
  (`store.ts:2149`) appended mid-flight. Latent today only because nothing
  yet produces items (see PAR-2), but it breaks the module's core
  never-lose-work invariant.
- **Fix:** at save time re-read `get().settings.repo.outbox` and merge:
  replace by id the items this run synced, keep unknown ids, drop only ids
  confirmed this run. Add a `syncing` re-entrancy flag so a double "Sync now"
  cannot interleave two loops.
- **Verify:** store test: start `syncOutbox` against a mocked slow
  `daemonApplyOutbox`, call `bufferCommitIntent` mid-flight, assert the new
  item survives the final save.

## SEC-1 (P0). `..` path segments survive normalizeNotePath; iCloud writes and export escape the vault root

- **Files:** `app/src/lib/vault.ts:66-77` (`.filter(Boolean)` keeps `..`),
  `OscodeIcloudPlugin.swift:88,121,150` (`root.appendingPathComponent(path)`,
  no prefix check), `app/src/lib/vaultExport.ts:19-25`.
- **Evidence:** `normalizeNotePath('../x')` returns `'../x.md'`. The iCloud
  resource root is `Documents/<resourceId>`, so a note named
  `../repo.main/whatever` writes into a sibling gitOS resource's tree (it can
  overwrite `.oscode/lease.json` or another resource's files), and `../../`
  climbs further within the container. A wikilink `[[../../x]]` flows through
  the same path via the "New:" autocomplete chip. Electron is jailed
  (`app/electron/main.ts:406-417`) and the daemon path is confined
  (`os-code/src/git/outbox.ts:84-96`); iCloud and export are not.
- **Fix:** both layers. In `normalizeNotePath`, drop `.` and `..` segments
  (reject a resulting empty path). In the Swift plugin, standardize the URL
  and reject unless its path has the resource root as prefix; the plugin must
  not trust JS.
- **Verify:** `expect(normalizeNotePath('../x'))` sanitized; plugin-side check
  that `write({path:'../evil.md'})` rejects (TestFlight manual until an
  XCTest harness exists).

## SEC-2 (P1). Any org member can commit and push to ANY git repo on the admin's desktop

- **File:** `os-code/src/daemon/serve.ts:231-259` (`/outbox/apply` takes `cwd`
  from the request body, checks only `existsSync(cwd)`; the comment at
  137-141 deliberately opens it to any valid member). `applyOutboxItem`
  confines file paths inside the repo but not which repo.
- **Failure scenario:** a member with a minted token posts
  `cwd: "/Users/founder/any-private-repo"` with arbitrary files; the daemon
  commits and pushes using the founder's ambient credentials. Cross-repo
  privilege escalation, plus an exfil path (push a workflow file). The
  `/outbox/verify` endpoint likewise confirms commit existence in any repo,
  an information leak.
- **Fix:** server-side allowlist: only admin-configured home repo path(s)
  accept applies; 403 anything else. Same allowlist on `/outbox/verify`.
- **Verify:** daemon test posting an apply with a cwd outside the configured
  home repo, expect 403.

## SEC-3 (P2). BYOM accepts an API key over cleartext http to arbitrary hosts

- **Files:** `app/src/components/StackManager.tsx:102` (`/^https?:\/\/.+/i`),
  `app/src/lib/byom.ts` (`normalizeBaseUrl` does not touch scheme),
  `stackDriver.runByom` (attaches `authorization: Bearer <key>` regardless).
- **Fix:** warn (or refuse the key field) when scheme is http and the host is
  not localhost/RFC1918/CGNAT 100.64/10 (tailnets). Keyless http LAN Ollama
  stays fine.
- **Verify:** unit test a `byomKeyAllowed(baseUrl)` helper; UI warning for
  `http://example.com/v1` + key.

## SEC-4 (P2). Provider keys (BYOM included) sit in the plain store on Electron

- **File:** `app/src/lib/platform.ts:198-217` (iOS Keychain only; the desktop
  secret store is a noted follow-up). BYOM widened this pre-existing hole with
  a new class of user-pasted keys. For the record, the rest of BYOM key
  handling is clean: Keychain-backed on iOS, per-connection, deleted on
  disconnect, never in Zustand state or settings JSON, never synced, no
  key material in analytics.
- **Fix:** Electron `safeStorage` behind the same `secretSet` seam, mirroring
  the engine's OS-keychain credential store.
- **Verify:** on Electron, connect a BYOM key, grep the userData dir for the
  key string; it must not appear.

## SEC-5 (P2). Mid-chat switch silently exports a private on-device conversation to a network endpoint

- **Files:** `app/src/state/types.ts:240-253` (`seedFromTranscript`),
  `store.ts:1418+` (`switchModel`).
- **Failure scenario:** the user confides in Harbor precisely because it is
  local ("private by construction," per `onDeviceDriver.ts`), then switches to
  Claude or a BYOM endpoint for a better answer; the whole thread leaves the
  device with no disclosure.
- **Fix:** a one-time confirm (or at minimum an explicit note line) when a
  seed crosses from `device` to a network brain: "This sends the conversation
  so far to X."
- **Verify:** device chat with 2 turns, switch to BYOM, assert the confirm
  appears before any request fires.

## SEC-6 (P2). Google OAuth revoke sends the token in the URL query string

- **File:** `app/src/lib/gitos/gdriveAuth.ts:294`.
- **Fix:** move it to the POST body (`token=` form-encoded) so it cannot land
  in proxy or server logs.
- **Verify:** inspection plus the existing auth unit tests.

---

# Part 2: Correctness (P1)

## COR-1. Wikilink navigation in read mode is dead: react-markdown strips `vault:` hrefs

- **Files:** `app/src/components/VaultMarkdown.tsx:22-52`,
  `app/src/lib/vault.ts:136`, `app/package.json:35` (react-markdown 10.1.0).
- **Evidence:** `wikilinksToMarkdown` emits `[title](vault:...)`; no
  `urlTransform` prop is passed anywhere in `app/src` (grep confirmed).
  react-markdown 10's `defaultUrlTransform` returns `''` for any protocol not
  in `https?|ircs?|mailto|xmpp`, so the `a` component receives `href=""`, the
  `startsWith('vault:')` branch never fires, and the wikilink renders as an
  external empty link. Tapping does not open the note; the fresh-note toast
  for unresolved links never fires. The existing tests only cover the string
  rewrite (`app/test/vault.test.ts:55-59`), never the rendered anchor, which
  is how it slipped through.
- **Fix:** pass
  `urlTransform={(url) => url.startsWith('vault:') ? url : defaultUrlTransform(url)}`
  (import `defaultUrlTransform` from react-markdown). SECURITY NOTE: keep the
  default transform for every other protocol or this reopens `javascript:`
  hrefs; whitelist only `vault:`.
- **Verify:** render test asserting the anchor's href starts with `vault:` and
  that clicking calls `onOpenNote` with the decoded path; a second assertion
  that a `javascript:alert(1)` link still renders inert.

## COR-2. Reopened conversations are never reseeded: model amnesia after relaunch

- **File:** `app/src/state/store.ts:2548-2551` (`openConversation` calls
  `buildDriver(conv)` with no seed) vs the correct seeded path in
  `switchModel` at `store.ts:1441-1456`. Drivers live in a module-level Map
  that empties on reload while conversations persist with up to 200 thread
  items, so the transcript renders fully and the model knows none of it.
- **Failure scenario:** relaunch, open yesterday's chat, ask "so what did we
  decide?": zero context, with the whole conversation on screen.
- **Fix:** in `openConversation`, for seedable kinds (`device`, `cloud`,
  `stack`), pass `seedFromTranscript(conv.thread.items)` into `buildDriver`,
  with the same kind guard `switchModel` uses.
- **Verify:** extend `app/test/store.test.ts`: persist a conversation with
  turns, clear the driver map, `openConversation`, assert the constructed
  driver's history matches the seedable turns.

## COR-3. Failed model switch leaves the UI claiming the new model while the old driver answers

- **File:** `app/src/state/store.ts:1443-1473` (`switchModel` commits
  `conv.source` before `buildDriver` runs; the catch only toasts, so
  `attachDriver` never replaced the old driver).
- **Failure scenario:** tap a Claude model with no key stored; the toast
  flashes, the header and composer pill now read Claude, and every send goes
  to the old stack/device driver. The user believes they are talking to
  Claude.
- **Fix:** build the driver first and only commit `source` (and the "Now
  using" note) after `attachDriver` succeeds; or roll `source` back in the
  catch.
- **Verify:** store test: stub `secretGet` to null, `switchModel` to cloud on
  a stack chat, assert `conv.source.kind` is still `'stack'` and the attached
  driver unchanged.

## COR-4. Stop mid-stream on the web SSE path reports an error and drops the partial from history

- **File:** `app/src/drivers/stackDriver.ts` (`abort()`,
  `runOpenAiCompatible` streaming branch, `run()` catch).
- **Evidence:** aborting rejects the pending `reader.read()` with
  `AbortError`, which falls into `run()`'s catch and emits
  `task-done reason:'error'` ("The user aborted a request." as a red row);
  `finish('aborted')` never runs so the visible partial answer is absent from
  the next turn's context. The Anthropic branch handles this correctly via
  `APIUserAbortError`.
- **Fix:** in the catch, check `this.aborted` (or `err.name ===
  'AbortError'`) and call `this.finish('aborted')`.
- **Verify:** stackDriver test with a mocked streaming fetch whose reader
  rejects on abort; assert `task-done.reason === 'aborted'` and the partial
  landed in history (observable via the next request body).

## COR-5. Google Drive writes are unconditional last-write-wins; concurrent edits silently clobber

- **File:** `app/src/lib/gitos/gdrive.ts:280-309` (writeFile PATCHes content
  with no precondition). Contrast `orgVault.ts`, which CASes on `rev` and
  conflict-copies server-side.
- **Fix:** store `headRevisionId` (or `modifiedTime`) in the index at read
  time; on write, fetch current meta and, on mismatch with the base the
  editor loaded, write a conflict copy
  (`name (conflict <device> <timestamp>).md`), mirroring the org-vault rule.
- **Verify:** mock-transport test: read rev A, simulate external update to
  rev B, write, assert conflict copy created and the original preserved.

## COR-6. Drive index.json is itself last-write-wins across devices; files vanish from list() and stay vanished

- **File:** `gdrive.ts:39` (`handleCache` lives for the process lifetime),
  `174-178` (saveIndex overwrites whole index.json), `200-227` (index rebuilt
  only when EMPTY).
- **Failure scenario:** device A creates `a.md` (index {a}); device B, holding
  a session-start handle (index {}), writes `b.md` and saves index {b}.
  `a.md` still exists in Drive but is gone from every `list()` on both
  devices, forever (non-empty index means rebuildIndex never runs again). The
  `read()` live-listing fallback only rescues a path someone explicitly asks
  for.
- **Fix:** merge instead of replace on saveIndex (re-fetch index.json, union
  by path, newest-wins per entry); or drop the persisted index for a periodic
  real walk; at minimum expose a "Rescan Drive" action.
- **Verify:** mock-transport test: two handles for one resource interleave
  writeFile; assert the final index contains both paths.

## COR-7. Duplicate Drive root folders from concurrent first contact fork the vault

- **File:** `gdrive.ts:107-127` (query-then-create, no idempotency), `200-227`
  (handleCache set only after several awaits, so two concurrent first calls
  both create; Drive permits duplicate names).
- **Failure scenario:** `vaultRefresh` and `vaultSave` race on app start, or
  two devices connect near-simultaneously: two `vault.personal` folders
  exist; each client binds to whichever the name query returns first, and the
  vault forks into two trees that never reconcile.
- **Fix:** memoize the `handleFor` promise per resourceId (store the Promise
  in the cache before awaiting); after create, re-query and adopt the
  lexicographically smallest id, trashing a folder this client just created
  if a rival exists.
- **Verify:** call `handleFor` twice concurrently against a transport that
  counts folder creations; assert one creation.

## COR-8. Drive delete is a silent no-op on a stale index; no tombstones anywhere

- **File:** `gdrive.ts:311-318` (`if (!cached) return;` with no live-listing
  fallback, unlike readFile). Plus `store.ts:2500-2503`: `vaultMoveTo` leaves
  source bytes as a safety copy, so a note deleted after a move resurrects on
  move-back or rebuild.
- **Fix:** removeFile falls through to the live lookup before giving up.
  Handle move-back resurrection in COR-9.
- **Verify:** mock test: index empty, file exists in Drive, `remove(path)`,
  assert the trash call happened.

## COR-9. vaultMoveTo overwrites same-path target notes unconditionally and can resurrect deleted ones

- **File:** `store.ts:2489-2520`.
- **Failure scenario:** move Local to iCloud where another device already
  populated newer versions of the same paths: each is clobbered by the older
  copy and iCloud spreads the regression. Later move-back re-lists notes
  deleted meanwhile.
- **Fix:** before writing, stat the target; on existing-and-newer, write the
  source under a conflict name. After a verified copy, stamp the source
  inactive (or clear it) so move-back cannot resurrect.
- **Verify:** unit test with a target pre-seeded with a newer `a.md`; assert
  the target body survives and a conflict copy appears. Move, delete a note,
  move back; the note stays deleted.

## COR-10. Single-writer leases are dead code on every provider

- **Files:** contract at `app/src/lib/gitos/providers.ts:41-49` (a CTO
  ruling), implementations in `local.ts:68-82`, `icloud.ts:50-77`,
  `gdrive.ts:320-339`. Grep confirms zero callers of
  `acquireLease`/`releaseLease` outside the provider files: vault open/save
  and `vaultMoveTo` never take, renew, or check a lease. The two-device
  clobbers in DL-3 and COR-5 are exactly what the lease was ruled in to
  prevent.
- **Fix:** wire it: acquire on entering the Vault screen (or first write) for
  leased providers; a foreign live holder shows a "vault is open on another
  device" banner and read-only or warn-on-save; heartbeat while editing;
  release on exit. Org correctly no-ops. (If the founder prefers to drop the
  lease design instead, that is a founder decision, FD-3; do not delete it
  unprompted.)
- **Verify:** test that a provider returning a foreign live lease puts the
  screen read-only and blocks saves.

## COR-11. A revoked Google Drive connection reports healthy forever

- **File:** `gdriveAuth.ts:264-285` (refresh failure returns undefined but
  leaves the refresh token stored; `isGdriveConnected()` line 46 and
  `probeReady('gdrive')` still say connected while every call throws "Google
  Drive is not connected.", a wrong message for both offline and revoked).
  Note the 7-day Testing-mode expiry recorded in DECISIONS.md makes this a
  guaranteed dev-time state, not an edge case.
- **Fix:** on a definitive `invalid_grant` from the token endpoint
  (distinguish from network errors), clear tokens and flip the UI to
  "reconnect Google Drive"; surface that state in VaultScreen's storage
  sheet; reword the offline case honestly.
- **Verify:** unit test `gdriveAccessToken` with a mocked 400 invalid_grant;
  assert tokens cleared and `isGdriveConnected` false.

## COR-12. Stack routing never checks liveness or key presence; a dead specialist ends the turn instead of degrading

- **File:** `app/src/drivers/stackDriver.ts` (`route()` checks only
  `locationAllowed`; `runCloud` errors on a missing key; `runDevice` errors on
  a failed `Llama.load`). The engine's router does this degradation properly
  (`os-code/src/router/router.ts`, `hasApiKey()`, quarterback fallback); the
  app-side port did not carry it over.
- **Fix:** on specialist failure (missing key, load failure, HTTP error), fall
  back to the Reasoning anchor for the turn and emit the existing
  `model-switch` event with a reason.
- **Verify:** stack with a cloud specialist and no stored key; send a coding
  prompt; assert the reply comes from the reasoning ref and an event names
  the fallback.

## COR-13. Aborted Claude turns drop the visible partial from model history

- **File:** `app/src/drivers/cloudClaudeDriver.ts` (`run` catch emits
  `task-done` only; the streamed partial is never pushed to `this.history`).
- **Failure scenario:** stop a long answer at 80 percent, ask "continue"; the
  transcript shows the 80 percent, the model never said it.
- **Fix:** accumulate deltas locally (as StackDriver does) and on abort push
  the partial as the assistant turn.
- **Verify:** extend `app/test/cloudClaudeDriver.test.ts`: abort mid-stream,
  inspect the next request's messages for the partial assistant turn.

## COR-14. Seeding drops image blocks: any model switch loses vision context silently

- **File:** `app/src/state/types.ts` (`seedFromTranscript` is text-only).
  Even Claude-to-Claude (both vision-capable) loses earlier screenshots from
  context with no notice.
- **Fix:** carry image attachments in `SeedTurn` for cloud-to-cloud switches,
  or emit a note: "Images from earlier in this chat are not carried across a
  model switch."
- **Verify:** extend `vision.test.ts`: seed containing an image turn, switch,
  assert the note or the image block in the new history.

---

# Part 3: UI/UX vs the Uki gold standard

Summary: OS Code is where Uki was before its 2026-08-24 audit. The taste is
right (spring curves, sheet overshoot, a real swipe gesture, a proper haptics
bus with zero `navigator.vibrate` anywhere) but there is no token vocabulary,
most surfaces snap-unmount, and nothing is enforced by tests. The three
highest-leverage moves: (1) generalize ProfileStatus's exit-then-unmount
pattern to every sheet, the drawer, and the toast; (2) fix the chat autoscroll
that steals the user's scroll during streaming; (3) declare the motion tokens
plus per-size press scales, migrate the literals, and land the two enforcement
tests (UX-E below).

## Tier 1

### UX-1. Six sheets, the drawer, the toast, and both popovers snap-unmount with no exit

The exit CSS already exists (`app/src/theme.css:1629-1634`,
`.sheet-scrim.closing` / `.info-sheet.closing`) and
`app/src/components/ProfileStatus.tsx:46-65` implements the full pattern
correctly (a `closing` state, `EXIT_MS = 340` unmount timer, reduced-motion
safe). Nothing else uses it. Every one of these plays `sheet-up` (with backOut
overshoot) on the way in and hard-cuts on the way out:

- `InfoSheet.tsx:15-19` (`close()` sets `setOpen(false)` directly, despite the
  `.closing` CSS written for it, per the comment at `theme.css:1627`)
- `ApprovalSheet.tsx:20`, `ModeSheet.tsx:54`, `ModelSheet.tsx:125`,
  `CompareSheet.tsx:67`, `Paywall.tsx:38`
- Drawer: `App.tsx:127` + `Sidebar.tsx:368`; `slide-in` at `theme.css:351`
  has no exit twin
- Toast: `App.tsx:89,129`; `theme.css:2645` animates in, vanishes in a frame
- Popovers `project-menu` / `multiselect-panel` (`theme.css:2417-2422`)

**Fix:** extract ProfileStatus's logic into a `useSheetExit(open, EXIT_MS)`
hook returning `{mounted, closing, dismiss}`; apply to all six sheets and the
Paywall. Drawer: add a `slide-out` (translateX + scrim fade, 220ms standard
curve) and hold unmount. Toast: fade/slide down before the store clears it.
Popovers: reverse `menu-pop` at ~120ms on the accel curve. Exits ride the
accel or standard curve, never the spring.

### UX-2. Chat autoscroll steals the scroll during streaming

`app/src/components/MessageList.tsx:39-41` fires
`endRef.current?.scrollIntoView({ block: 'end' })` on every streamed chunk
unconditionally, and `.thread` sets `scroll-behavior: smooth`
(`theme.css:631`), so a user who scrolls up to reread is yanked back in an
animated chase that never settles. The single most-felt defect in the core
surface.

**Fix (iMessage behavior):** track pinned-ness via a scroll listener
(`pinned = scrollHeight - scrollTop - clientHeight < 48`); autoscroll only
when pinned, and scroll instantly (`behavior:'auto'` via scrollTo) during
streaming so smooth-scroll never chases. Optionally a "jump to latest" pill
when unpinned mid-stream.

### UX-3. `animation-fill-mode: both` silently kills the marketplace card press

`theme.css:3092` (`.market-card` animates with `both`) plus `theme.css:3109`
(`.market-card:active { transform: scale(0.99) }`): with `both`, the final
keyframe transform keeps applying and wins over `:active`, so the pressed
scale on every marketplace card is dead. Exactly the failure Uki's rule 3
names. **Fix:** `backwards` here (it still covers the stagger delay at
`MarketplaceScreen.tsx:548`), and move the other `both` users
(`composer-chip` 1483, `lib-dock-in` 2750, `lib-caption` 2765, `greet-in`
1542-1545, `sh-seal-fact-row` 3935) to `backwards` so a press state added
later does not die silently.

### UX-4. Press feedback: one class, four adopters, fifteen ad-hoc imitations

`.press-fb` (`theme.css:1473-1479`) correctly rides the individual `scale`
property but only Composer, MessageList, ModeSheet, and ModelSheet use it.
Fifteen selectors re-implement press on `transform` with a symmetric
`0.06s ease` (shadowable, no spring-out): `new-chat-btn` 203,
`sidebar-signin` 265, `icon-btn` 428, `stack-add-btn` 459, `wikilink` 478,
`.btn` 1820, `card-disclosure` 1934, `dl-item` 2002, `multiselect-row` 2442,
`account-card` 2521, `lib-next/lib-cta` 2849, `facet-chip` 3077, `hero-card`
3513, `store-get` 3582, `cat-chip` 3426. Many tappables acknowledge nothing:
`conv-item`, `nav-item`, `suggestion` 1588, `profile-chip`, `profile-row`,
`lane`, `shelf-head`, `store-row`, `project-menu-item`, `quick-chat-btn`,
`vault-link-chip`, `vault-mention`. Two defects in `.press-fb` itself: the
press-down uses `0.05s ease` (should be the accel curve) and `scale: 0.93` is
one-size-fits-all (aggressive on a full-width row).

**Fix:** add `--press-scale-btn: 0.96; --press-scale-row: 0.985;
--press-scale-tile: 0.94` with `.press-fb--row` / `.press-fb--tile` variants;
press-down `var(--dur-1) var(--ease-accel)`, release `260ms
var(--ease-spring)`. Sweep the fifteen ad-hoc `:active` transforms onto the
classes and add the class to the bare tappables.

### UX-5. No motion token vocabulary; the drift Uki's test prevents has already happened

`theme.css` has zero `--ease-*` / `--dur-*` tokens; 30 raw `cubic-bezier()`
literals plus dozens of raw ms durations:

- `cubic-bezier(0.32, 0.72, 0.28, 1)` x11 (351, 653, 659, 3092, 3100-3101,
  3300, 3325, 3499-3500, 3935): a near-duplicate (almost certainly a typo) of
  the iOS standard `0.32, 0.72, 0, 1`, which also appears x3 (2750, 2765,
  2821). Two curves one hair apart.
- Spring `cubic-bezier(0.34, 1.56, 0.64, 1)` x13 (1054, 1224, 1369, 1474,
  1483, 1655, 1685, 3021, 3649, 3706, 3803, 3885, 3993).
- easeOutQuint `0.22, 1, 0.36, 1` x2 (1542, 1545).
- Foreign curve `0.2, 0.8, 0.2, 1` at 2420 and inline in
  `components/Stars.tsx:70`, no stated reason.

**Fix:** declare Uki's exact `:root` block (`--ease-standard/arrive/spring/
accel/loop`, `--dur-1..6`, `--press-*`) copied verbatim from
`uki-audio/styles.css`; migrate the drift curve to `var(--ease-standard)`,
springs to `var(--ease-spring)`, greet-in to `var(--ease-arrive)`; retire
both foreign curves. Founder bias applies: "smooth and slow feels premium and
lux", so entrances sit at the longer durations; `menu-pop` at 0.14s and the
scrim at 0.16s currently read snappy, not calm.

## Tier 2

- **UX-6. `transition: all` + width animation on the pager dot.**
  `theme.css:2821` `.lib-dot { transition: all ... }` with `.active { width:
  18px }` (2824-2827). The only `transition: all` in the app and it animates
  layout. Fix: named transitions only; animate the stretch with `scaleX` on
  an inner span (or name `width` explicitly as a stated exemption). `all`
  goes regardless.
- **UX-7. Progress animates layout.** `theme.css:2597-2601` (`width`
  transition), 2605-2618 (indeterminate animates `margin-left` at 1.1s
  infinite: a reflow every frame of every download), `Stars.tsx:70` (inline
  width transition). Fix: `transform: scaleX()` with left origin;
  indeterminate via `translateX` keyframes; Stars via `clip-path` or scaleX.
- **UX-8. Reduced-motion reset incomplete.** `theme.css:2926-2931` zeroes
  durations but not `animation-delay` or `animation-iteration-count`.
  Today: inline stagger delays (`MarketplaceScreen.tsx:548`,
  `SettingsScreen.tsx:57`, `StackHealthScreen.tsx:130`) still wait out their
  delay under reduce, and five infinite animations not individually killed
  (`caret-blink` 713, `spin` 924, `pulse-dot` 2495, `build-shimmer` 2511,
  `progress-slide` 2608) become 0.01ms infinite loops (compositor thrash).
  Fix: add `animation-delay: 0ms !important; animation-iteration-count: 1
  !important;` and keep per-animation kills.
- **UX-9. Sheet drag: no velocity release, no rubber-band, InfoSheet has no
  haptics.** Both sheets commit on a fixed 90px threshold
  (`InfoSheet.tsx:29`, `ProfileStatus.tsx:90`): a fast flick under 90px
  springs back, and upward drag hard-clamps at 0. SwipeRow is the in-repo
  reference (axis lock, 1:1, 0.3 damping, velocity flick at
  `SwipeRow.tsx:93`, arm/commit haptics). Fix: one shared drag core: commit
  on `vy > ~0.5 px/ms` or distance, upward overdrag damped `y * 0.15`,
  `hapticTick` on lift and drop, `useSheetExit` unmount.
- **UX-10. No keyboard focus ring; sheets are not dialogs; toast is silent to
  screen readers.** `theme.css:119` strips outlines globally and no
  `:focus-visible` style exists (desktop keyboard users see nothing). No
  sheet has `role="dialog"`/`aria-modal`, none closes on Escape
  (`useDismissable` is wired only to the two popovers), none traps or
  restores focus. Toast lacks `role="status"`. Fix: global `:focus-visible`
  outline; a small `useDialog` (Escape, trap, restore, labelled dialog role)
  applied during the UX-1 sweep; `role="status"` on the toast.
- **UX-11. Tap targets under 44pt.** `shelf-more` 28px (`theme.css:3641`),
  `composer-add`/`composer-mic` 32px (1080, 1135), `send-btn` 34px (1043),
  `mode-close` 34px (1396), `icon-btn` 36px (411), `composer-chip-x` (1186).
  Fix: keep the visual size, extend the hit area with `::after {
  position:absolute; inset:-8px }`.

## Tier 3

- **UX-12. Room changes hard-cut.** `App.tsx:94-121`: no transition between
  screens. A 200ms arrive-curve fade+4px rise on `.shell-main`'s child keyed
  by `view` removes the biggest remaining hard cut. Boot also pops: `App.tsx:83`
  renders a bare shell then the greeting appears; cross-fade the ready state.
- **UX-13. Landscape safe areas.** Top/bottom handled well; zero
  `env(safe-area-inset-left/right)` anywhere, so landscape iPhone puts the
  drawer and `.screen-inner` under the notch.
- **UX-14. Haptic gaps.** The bus (`lib/haptics.ts`) is sound and the global
  iOS tap listener (`App.tsx:73-81`) is an elegant blanket. Gaps: drawer
  open/close, sheet commits outside ProfileStatus/SwipeRow, and marketplace
  "Get" (a decisive commit) should use `hapticSuccess` on completion.
- **UX-15. Misc.** Permanent `will-change` on the popovers (`theme.css:2421`);
  SwipeRow pin/unpin unreachable without the gesture (add a long-press or
  overflow affordance for keyboard/VoiceOver); `VaultMarkdown` re-parses the
  whole note on every parent render (wrap in `React.memo`, memo the wikilink
  rewrite).

## UX-E. Enforcement to add (the real deliverable of this section)

Create in `app/test/`, mirroring Uki:

1. **`app/test/motion-tokens.test.ts`** (port of
   `uki-audio/src/motion-tokens.test.js`): read `app/src/theme.css`, pin the
   token names and exact canonical values, pin the `--press-in`/`--press-out`
   asymmetry. Since OS Code has only ~31 literals, add what Uki could not
   afford: assert the drifted `0.32, 0.72, 0.28, 1` and foreign
   `0.2, 0.8, 0.2, 1` never appear once migrated.
2. **`app/test/polish-standards.test.ts`** (port of
   `uki-audio/src/polish-standards.test.js`) over `app/src/**/*.{ts,tsx,css}`:
   no `transition: all` (catches UX-6 today); the reduced-motion reset carries
   all four declarations (fails today, UX-8); `lib/haptics.ts` imports
   `@capacitor/haptics` and no `navigator.vibrate` exists outside it (passes
   today; locks it in); no `both` in any `animation:` shorthand in theme.css
   (catches UX-3); no `transition` on
   `width|height|top|left|margin|padding|max-height` outside an EXEMPT list
   (catches UX-7).

Land the tokens and both tests FIRST in the UI wave; they make every later
fix converge instead of drift.

---

# Part 4: P2 robustness (batched, short form)

- **R-1** `store.ts:2178`: outbox id suffix is not fixed-width; within one
  millisecond seq 'z' sorts after '10', breaking the ULID-order assumption in
  `pendingForRepo`. Pad the seq or use a real ULID.
- **R-2** `gdrive.ts:139-145`: createFile is metadata-create then content
  PATCH; a crash between leaves a permanent empty file that reads as an empty
  note. Use a single multipart upload.
- **R-3** `gdrive.ts:118`: root folder looked up by name only; a user rename
  or move in Drive silently creates a fresh empty vault. Persist the folder id
  locally and look up by id first.
- **R-4** Unicode normalization: iCloud/APFS stores NFD, Drive/local keep NFC;
  `resolveWikilink` compares without normalizing. Normalize to NFC in
  `normalizeNotePath`.
- **R-5** Case split-brain: resolution is case-insensitive (`vault.ts:85-93`),
  storage keys case-sensitive (`local.ts:15`): `vaultOpen('note')` with
  `Note.md` present forks a second note. Case-insensitive existence check in
  `vaultOpen`/create via `resolveWikilink`.
- **R-6** No filename sanitization beyond slashes: Obsidian's forbidden set
  (`# ^ [ ] |` plus `\ / :`) passes through; such notes can never be
  wikilinked (the WIKILINK regex excludes those chars) and `:` is hostile on
  Apple filesystems. Strip/replace at creation with a toast.
- **R-7** Backlinks: excerpt uses the note's FIRST `[[` (`vault.ts:114`), not
  the matched link (use matchAll and the hit's own index); membership credits
  `[[x/B]]` to root `B.md` (`vault.ts:109-111`); resolve each link via
  `resolveWikilink` and compare paths.
- **R-8** Opening any note downloads the entire vault serially
  (`VaultScreen.tsx:113-125` runs `vaultReadAll`; `store.ts:2477-2487` is a
  sequential per-file read loop): on a 300-note Drive vault that is 300+
  sequential GETs per note open. Cache bodies (or a link index keyed by
  `updatedAt`), refresh only changed files, small concurrency pool.
- **R-9** Local provider write is a non-transactional two-step and the shared
  index races (`local.ts:45-55`); Electron write is not atomic
  (`app/electron/main.ts:449`, direct `writeFileSync` despite the seam
  contract at `providers.ts:54-55`). Serialize index updates; temp file +
  rename on Electron.
- **R-10** Delete is one tap, unconfirmed, unrecoverable on Local/iCloud
  (`VaultScreen.tsx:356-366`). Confirm step or a 5s undo toast that defers
  the provider remove.
- **R-11** A brand-new empty note evaporates (`store.ts:2436-2446`: nothing
  written until the first keystroke; Create then back = never existed).
  Write the empty file on create; use a real fresh flag instead of the
  `text === ''` edit-mode heuristic (`VaultScreen.tsx:116`).
- **R-12** No refresh on external change: teammate/team-vault writes, the
  desktop agent writing the folder, or iCloud sync never update `vaultFiles`
  or an open note. Near-term: refresh on screen focus and appstate-resume;
  re-read the open note when its `updatedAt` moves.
- **R-13** Export (`vaultExport.ts:14-28`): never cleans up deleted/renamed
  notes (ghost files accumulate in Documents/Vault) and `VaultScreen.tsx:623-627`
  reports any thrown write failure as the on-web message. Clean stale files
  under the export root; distinguish undefined (web) from a thrown error.
- **R-14** Embeds `![[img.png]]` render as a broken image (the regex matches
  the inner wikilink, urlTransform strips the src). Match a leading `!` and
  render an explicit "embed not supported" chip.
- **R-15** `serve.ts:264-276`: `/outbox/verify` returns `{exists:false}` for
  any thrown error, so a landed commit can show as a scary false failure.
  Return 500 and keep the item retrying.
- **R-16** Streaming for BYOM/OpenAI-compat on iOS and Electron is
  buffer-then-dump and not cancelable (`stackDriver` native branch,
  `nativeFetch.ts` buffers by design). Electron: route through the existing
  IPC/SSE machinery; iOS: a URLSession streaming method on the llama plugin
  or a native SSE bridge. This is the difference between "feels like Claude"
  and "feels like a form post" for the flagship BYOM feature.
- **R-17** Speech plugin (`OscodeSpeechPlugin.swift`): if `installTap`
  succeeded but `audioEngine.start()` threw, `stopInternal` leaves the tap
  installed (guarded by `isRunning`), and the next start installs a second tap
  on bus 0 (NSException crash). Track a `tapInstalled` bool and remove
  unconditionally. Also use `task?.finish()` instead of `cancel()` on manual
  stop so the final recognition result fires. UNCONFIRMED on hardware
  (TestFlight is the proof per PROGRESS); the code path is real.
- **R-18** `stackDriver` request id `req_${Date.now()}` can collide across
  same-millisecond sends; use the module counter `onDeviceDriver` already
  uses.
- **R-19** Sign-out leaves the personal vault (Local bytes and
  `gitosResources`) readable by the next account on the device
  (`store.ts:1747-1771` clears team-vault state and Drive tokens only). If
  device-scoped-personal is by design, record it in `os-code/DECISIONS.md`;
  today it is undocumented. Contrast Uki's clearSyncedKeys rule.

## H. Missing test harnesses (build these before their waves)

- **H-1 (highest leverage single addition):** a mock-transport harness for
  `gdrive.ts` (356 lines of sync-critical logic, zero tests today; same for
  `icloud.ts`, `local.ts`, `gdriveAuth.ts`). Every Drive finding above
  (COR-5..8, R-2, R-3) is untestable until this exists.
- **H-2:** a render-level test setup for VaultMarkdown (testing-library) so
  COR-1 and R-14 get red-then-green coverage; the existing string-rewrite
  tests cannot see renderer behavior, which is exactly how COR-1 shipped.

---

# Part 5: Parity assessments (honest state of the three clones)

## 5a. Claude Code parity (the app + engine, as a user reaches it)

Capability matrix, as reachable from the APP:

| Capability | Local | Cloud | Status |
|---|---|---|---|
| Chat, streaming, markdown | yes (on-device llama, BYOM, Ollama) | yes (Claude native, OpenAI/Gemini compat) | shipped; no true streaming on iOS/Electron for non-Anthropic (R-16) |
| File read/edit + approval/diffs | via paired desktop engine, any local orchestrator | via engine escalation | desktop pairing required; gated to Personal tier |
| Shell exec | desktop engine only | same | no phone-side path |
| Web search | Harbor guide only on phone; engine on desktop | engine | stack chat has NO search (deliberate in `harbor.ts`) |
| RAG / code map | desktop engine | same | not reachable for phone chat brains |
| Sub-agents | engine `delegate` (one-shot specialist calls) | same | specialists cannot use tools |
| MCP / extensibility | no | no | absent entirely (grep confirms zero MCP in os-code/src) |
| Checkpoints / rewind | no | no | absent; git tool exists, no snapshot-restore UX |
| Mid-chat model switch | yes (chat brains, idle-only, seeded) | yes | not for desktop coding sessions; bugs COR-2/3 |
| Vision | no local | Claude only | tracked follow-up |
| Confirm-before-spend | yes, engine `confirmCloudSpend` with dollar estimate; `autoApproves` hard-excludes cloud-spend in every mode | n/a | solid, verified in code |

What is genuinely strong: the engine's local tool loop (capability probing,
native-tools detection, JSON text-bridge fallback with grammar-constrained
retries, bounded repair) is a stronger local-model tool story than most
clones; the RemoteDriver reconnect design (SSE resume-from-seq, productive
backoff reset, journal replay) and the transcript reducer held up under
hostile re-read; confirm-before-spend is real end to end.

Ranked gaps (effort S/M/L):

1. **The app's default surface is not agentic (L).** "My Stack" cannot touch
   a file, run a command, or search; a user who never pairs a desktop gets a
   chat client. Shortest credible path is NOT phone-side tools: make desktop
   pairing the celebrated first-run path, then a phone-side read-only slice
   (repo browse + web search + vault tools on StackDriver, reusing the
   engine's tool parser, which is already isomorphic). Note this aligns with
   the founder's standing off-device principle in DECISIONS.md: the phone is
   the remote control, the daemon runs the loop.
2. **No MCP seam (L, M for stdio-only).** The engine's ToolRegistry + zod
   specs is most of the shape an MCP client needs; register MCP-stdio servers
   as dynamic ToolDefs on the desktop engine first.
3. **No checkpoints/rewind (M).** The engine journals every event and has git
   tooling; per-task shadow-branch auto-commit plus "restore to before this
   task" is bounded and a big trust feature for misfiring local models.
4. **Keyword classifier routing (M).** `stackDriver`'s regex classifier will
   misroute constantly ("write a function" routes to writing). Route with
   Harbor Mini itself (one cheap local classification call).
5. **BYOM streaming + cancel on device (M).** R-16.
6. **Desktop session model switching from the app (S/M).** Chat brains
   switch; the coding session cannot. Expose the engine's active-model choice
   over the daemon.

Bottom line: local-first Claude Code exists on the desktop; the phone
currently orbits it. The one-liner gap between "clone" and "companion app" is
item 1.

## 5b. gitOS / "Repositories" (the GitHub modulation)

- **PAR-1. What is real:** the provider seam is clean and proven by a
  non-file backend (orgVault, with true server-side CAS + conflict copies);
  the desktop apply engine (plumbing commits, CAS ref updates, idempotent
  receipts, independent verify, rescue branches, no force-push, path jail,
  per-repo mutex) is production quality and well tested
  (`os-code/test/outbox.test.ts`); drive.file scope discipline and the
  honest-roster discipline are real.
- **PAR-2 (headline). The offload pipeline has no producer and no reachable
  consumer.** `bufferCommitIntent` is called only from tests; no agent flow
  or screen ever buffers a commit intent. And `HomeRepo.homePath` is never
  settable (ReposScreen's editor sets label/kind/remoteUrl/branch only), so
  `syncOutbox` (`store.ts:2081-2084`) always exits with "Set your home repo
  location on the desktop first" and no UI exists to do that. The buffered
  cards, buffer-health warnings, export backup, and the desktop engine are,
  end to end, unreachable in the shipped app. Founder decision FD-1.
- **PAR-3. Platform-remote home repos can never sync.** The editor saves
  `kind: 'github'` with a remoteUrl, but syncOutbox only speaks to the
  daemon; nothing pushes buffered items to a platform remote with the stored
  PAT (connector tokens are stored, then unused by this subsystem).
- **PAR-4. gitOS storage providers are a flat file mirror, not repos.** No
  history, diff, branches, commits, or merge for vault resources; the only
  real git is the desktop outbox engine. Conflict handling grades: orgVault
  real CAS (good); Local single-device LWW (fine); iCloud/Drive blind LWW
  (DL-3, COR-5). Keep the internal name; any user-facing copy implying
  versioning on the cloud providers overpromises.

## 5c. Vault / the Obsidian modulation

- **Functional today:** wikilink parsing incl. alias and heading/block
  suffix tolerance; live `[[` autocomplete with create-new (well tested);
  backlinks pane (correct membership modulo R-7, expensive per R-8); folders
  via real relative paths with breadcrumb tree; storage genuinely
  Obsidian-openable on files/iCloud/export (the compat claim is honest at the
  bytes level); save-as-you-type (modulo DL-1/DL-4).
- **Rendered but broken or cosmetic:** wikilink NAVIGATION (COR-1, dead);
  `[[Note#Heading]]` resolves but never scrolls (suffix discarded); embeds
  broken (R-14); frontmatter unparsed (renders as literal text; alias-based
  backlinks missed).
- **Missing entirely:** rename/move of a note or folder (no UI, no store
  action, no provider rename, so no rename-updates-backlinks; users WILL
  rename in Obsidian/Files and every link breaks with no repair pass),
  search, tags, graph, templates, daily notes, trash/undo.
- **XSS review: clean.** No dangerouslySetInnerHTML; react-markdown 10 does
  not render raw HTML without rehype-raw (absent); default transform kills
  `javascript:` URLs. Keep it that way when fixing COR-1.
- **Architecture for the ORGANIZATION tier:** vault sits cleanly on the seam
  (no bypasses found), but three things will fight multi-writer: (1) the seam
  carries no revision: `write(resourceId, path, text)` has no baseRev and
  `StoredFile` no rev, so orgVault smuggles base revs through a module-level
  Map (invisible, resets on reload, cannot express "conflict happened"). Add
  optional `rev` to `StoredFile`/meta and let `write` accept `baseRev` and
  return `{file, conflict?}`. (2) conflicts are mute: the server forks a
  `(conflict ...)` copy and the user finds it by accident; surface a
  toast/banner. (3) no change notification in the seam (subscribe-or-poll
  hook), which R-12 works around at screen level.
- **Marketing accuracy:** "you and your agent both write"
  (`VaultScreen.tsx:433`) is true only on the desktop files provider; on iOS
  the agent has no path to the notes, and nothing feeds vault content into
  chat context or RAG (grep confirms zero vault references in drivers/chat).
  Either scope the copy or wire vault read tools (see 5a gap 1).

---

# Founder decision points (sign-off gate: do NOT build without an explicit yes)

- **FD-1. Repositories offload: wire it or hide it.** Options: (a) wire the
  producer (agent off-home edits call `bufferCommitIntent`) plus a homePath
  picker in the desktop settings, making the pipeline real; (b) hide the
  Repositories buffered-commit UI until then. The desktop engine behind it is
  finished and tested either way. Recommendation: (b) now, (a) as its own
  scoped feature.
- **FD-2. Dark mode.** The app is light-only by design or by omission
  (`color-scheme: light`, zero dark tokens). A code tool's desktop audience
  is majority-dark. The palette is fully tokenized so this is a `:root`
  remap plus audit, but it is a brand call. If light-only is the brand,
  record it in DECISIONS.md.
- **FD-3. Leases: wire or retire.** COR-10 recommends wiring. Retiring the
  contract instead is a foundation change (a CTO ruling is on record) and
  needs an explicit founder yes.
- **FD-4. Free-tier daemon posture.** SEC-2's allowlist is a straight fix,
  but deciding whether members should reach ANY repo beyond the home repo is
  product policy; the fix as written scopes to admin-configured paths.
- **FD-5. Claude Code parity investment order.** Part 5a's ranked gaps 1-3
  (first-run desktop pairing celebration, MCP-stdio on the engine,
  checkpoints) are each their own build; pick the order.

---

# Suggested execution order (for the Opus 4.8 session)

Batch by file; run the full gates (`pnpm typecheck`, `pnpm lint
--max-warnings 0`, both test suites, `vite build`) before every push. The
em-dash policy is total in this repo: keep it out of code AND comments.

1. **Wave 1, Vault data safety (one PR):** DL-1, DL-2, DL-4, SEC-1 (TS side),
   R-11. Files: VaultScreen.tsx, store.ts (vault actions), vault.ts. Add the
   unit/component tests named in each Verify line.
2. **Wave 2, switching + drivers (one PR):** COR-2, COR-3, COR-4, COR-13,
   COR-14, COR-12, R-18, SEC-5. Files: store.ts (openConversation,
   switchModel), stackDriver.ts, cloudClaudeDriver.ts, types.ts. Extend
   store.test.ts, cloudClaudeDriver.test.ts, vision.test.ts, stackDriver
   tests.
3. **Wave 3, renderer:** COR-1 + R-14 behind harness H-2.
4. **Wave 4, daemon + plugin security:** SEC-2, R-15 (serve.ts + daemon
   test); SEC-1 Swift guard + DL-3 plugin states + R-17 (Swift; TestFlight
   verifies); SEC-6.
5. **Wave 5, Drive/iCloud correctness behind harness H-1:** COR-5, COR-6,
   COR-7, COR-8, COR-11, R-2, R-3; then COR-9, DL-5, R-1.
6. **Wave 6, UI/UX:** tokens + UX-E tests first, then UX-1 (useSheetExit
   sweep), UX-2, UX-3, UX-4; then Tier 2 (UX-6..11); Tier 3 as time allows.
   Close with the standing Apple-polish assessment format.
7. **Wave 7, robustness backlog:** remaining R items (R-4..R-10, R-12, R-13,
   R-16, R-19), each with its Verify test.
8. **Fenced:** FD-1..FD-5 wait for the founder; COR-10 waits on FD-3.

Estimated shape: waves 1-4 are small, surgical, high-value (a day of focused
work); wave 5 is the first one needing new infrastructure (H-1); wave 6 is
the perceived-quality jump; the parity gaps in Part 5 are the roadmap
conversation, not this session's diff.
