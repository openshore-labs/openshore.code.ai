# Package daemon (H1 plus the session-switch half of A3)

## Log

Sessions, routines and credentials now have a lifecycle. A revived session
(the daemon's rehydrate and the desktop's resume, both through
`bootstrapSession`) keeps a declined web search and the Agentic and Harness
Current it was handed: the booleans sit in `info.json`, the handles ride
sealed with no key in them, and each key lives in this computer's credential
store under the session's own name and goes when the session is deleted. The
routine store re-reads on a file stamp before every read, and every change is
a read-modify-write under a short `wx` file lock with a temp-and-rename
publish, so two processes never write back a stale copy; a slot is claimed by
compare-and-set, so it fires once per box. Only the clock holder sweeps
orphaned runs, and only runs whose recorded process (pid plus its start
token) is gone. The clock lock is taken with `open(..., 'wx')`, knows a
reused pid by its start token, and reports "held by pid N since T" on
`GET /routines` (`clock`) and the desktop's `routinesList`. `startRun`
re-checks the folder (gone, left the allowed roots, or a link that leads
elsewhere) and refuses with `RoutineRefused`; a slot waits with "You were
working in this folder, so this run waited for the next time." when a
person's session is busy in the same real path. A run that leaves the 200
window takes its session; ordinary sessions are pruned after
`daemon.sessionRetentionDays` (90) of no activity, at daemon start and daily,
never an open one. Device credentials end after
`DEVICE_CREDENTIAL_TTL_DAYS` (180), with their own "pairing has expired"
refusal; `osc token rotate` (and an `osc:rotateSharedToken` IPC channel)
replaces the shared token, which a running daemon picks up at once; the
shared token is refused from a non-loopback address once any device
credential exists. `/pair/claim` takes 4 KB and a per-address token bucket;
`/push/register` pins the push function's host and path; `/chat` answers one
request per credential (409), caps count and size (413), and checks a named
model against the provider's list. `unhandledRejection` and
`uncaughtException` are caught in `osc serve` and the Electron main process,
logged, and announced once in each working session. Tests: new
`os-code/test/daemonLifecycle.test.ts` (17), and additions to
`routines.test.ts` (8, one rewritten), `sessionSwitches.test.ts` (3),
`daemon.test.ts` (1), `daemonRoutines.test.ts` (one assertion). Gates: engine
build, typecheck, lint, format green, 1955 tests passed and 1 skipped (was
1926); app typecheck, lint, format, build green, 2598 passed and 2 skipped.

## Decisions

- CTO call: a current's key is kept in the device credential store
  (`auth/store.ts`) under `session-key:<id>:<current>`, one per session, and
  deleted with the session; `info.json` holds only the sealed handle and that
  name. A stored name is honored only if it is the session's own, so a
  hand-edited `info.json` cannot hand another credential (a cloud key) to a
  current. The whole handle is sealed, since an address can carry a login.
- Only a declined web search is stored (`webSearch: false`), matching what a
  create honors; a revived CLI handle is dropped when that CLI has left the
  PATH, the rule a create applies.
- The default busy predicate is the process-wide registry of open stored
  sessions (`openSessionDrivers` in `daemon/session.ts`), not two predicates:
  in the desktop the daemon and the engine host share one process and one
  scheduler, so one list covers both. Tests inject `workspaceBusy`.
- CX call: a Run now tap while the person is busy in that folder is skipped
  too, with its own line ("did not start. Run it again once that chat is
  done."), since two agents in one folder is how work is lost, and the tap
  deserves a reason.
- A run with no recorded pid (an older build) is treated as orphaned by the
  clock holder, which only exists once no live process holds the lock.
- The store takes a short `wx` file lock around each read-modify-write, on top
  of the re-read and atomic rename, because re-reading alone still loses an
  update when two processes write in the same instant; after two seconds the
  write goes ahead unlocked rather than drop a run record.
- The start token is `/proc/<pid>/stat` start ticks with the boot id on Linux
  and `ps -o lstart=` on other Unix systems; Windows has none and falls back
  to the pid alone, as before.
- CTO call: every credential ends after 180 days, including those minted
  before an expiry was always set (by `createdAt`, and an unreadable date
  counts as ended); `osc token mint --ttl` defaults to 180 and there is no
  never-ending option. The desktop's device list now shows the effective date.
- The shared token is refused off loopback once any credential is stored,
  expired or not: the person has moved to per-device pairing either way.
- CTO call: `/push/register` accepts only `https://<project>.supabase.co/functions/v1/push-send`
  (no login, port, query), or a host named in machine config
  `daemon.pushHost` for a project on its own domain. Classified machine
  through `daemon: 'machine'`, commented in `projectPolicy.ts`.
- `/pair/claim` allows a burst of 5 then one every 10 seconds per address, and
  charges only a request that presents a claim, so the app's empty-body probe
  (`hubAnswers` in `app/src/drivers/remoteDriver.ts`) never trips it.
- `/chat` refuses the second request (409) rather than queue it, since the
  phone already shows a stop button and a queued answer would arrive late and
  out of place; 200 messages, 512 KB of text, 1 MB of body. The model check
  runs only when a model other than the orchestrator's is named, and a list
  the server cannot give within 3 seconds lets it through.
- Retention reads activity from the info stamp and the journal's time, not the
  info file's time, because the at-rest sealing pass rewrites `info.json`
  without any activity. Handoffs are not touched by retention.
- The process guards keep running after an uncaught exception as well, since
  the desktop's stake is the paired phone; no new IPC, the notice rides each
  working session's own events at most once a minute.
- The rotate IPC channel was trivial (one line each in `main.ts`,
  `preload.cjs`, `electronBridge.ts`, one method on the engine host), so it
  landed; the button did not (below).

## What remains

- Desktop button for "Replace the shared token" on the Desktop + phone screen,
  calling `bridge.rotateSharedToken` (`app/src/screens/PairScreen.tsx:216`, by
  the revoke list; channel at `app/electron/main.ts:1011`).
- The phone does not keep or show its own pairing's end date: `/pair/claim`
  now answers `expiresAt`, which `redeemPairClaim`
  (`app/src/drivers/remoteDriver.ts:179`) ignores. The re-pair prompt
  (`PAIRING_REJECTED`, `app/src/drivers/remoteDriver.ts:152`) already names
  expiry; the desktop list already shows each device's date.
- The Crew room does not render the clock status yet: `clock` rides
  `GET /routines` (`os-code/src/daemon/serve.ts:1014`) and the desktop's
  `routinesList` (read at `app/src/lib/routines.ts:193`).
- The busy check sees only this process's sessions
  (`os-code/src/routines/scheduler.ts:252`): with the desktop app and a
  separate `osc serve` both up, a run on one does not see a chat on the other.
- The desktop engine host never disposes a driver
  (`app/electron/engineHost.ts:172`, routine drivers added at 208), so a
  routine run's session loaded there stays open and is left for retention,
  and the map grows over a long uptime.
- The orphan line "The computer restarted before this run finished."
  (`os-code/src/routines/scheduler.ts:281`) now also covers the app quitting
  mid-run; a copy pass could say "OpenShore closed before this run finished."
- Push configs stored before the pin are not re-checked when a push fires
  (`os-code/src/daemon/push.ts:226`); a phone re-registers on its next launch.
- Deleting a routine leaves its runs' sessions for retention
  (`os-code/src/routines/store.ts:175`).
- The credential file is written in place, not by temp and rename
  (`os-code/src/core/security/credentials.ts:74`).
- `daemon.sessionRetentionDays` has no Settings row; it is set in
  `~/.os-code/config.json` (`os-code/src/config/schema.ts:220`).
- Device checks a person must do: pair a phone and retry a scan a few times
  without meeting the throttle; run `osc token rotate` and confirm
  `osc attach` on the computer still connects; run the desktop app and
  `osc serve` side by side and confirm one clock fires a slot once; start a
  chat in a folder, let a routine's slot land on it, and read the skipped
  line in Crew; on a Mac, confirm the lock's start token (`ps -o lstart=`)
  reads the same on each check.
