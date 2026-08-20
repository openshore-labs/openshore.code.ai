# Stack Health

An Apple-Health-style read of how you actually use your AI stack. Every number
is folded, on your machine, from files the engine already writes. Nothing is
sent anywhere, nothing is sampled, nothing is invented.

## Where the numbers come from

The only per-run record the engine keeps is the session journal:
`~/.os-code/sessions/<id>/events.jsonl`, one `{seq, event}` per line, plus a
per-session `info.json` (`createdAt`, `updatedAt`, `cwd`, `title`). Stack Health
reads those journals and the local `usage.json`; it opens no other files and
makes no network calls.

The load-bearing events (`os-code/src/core/agent/types.ts`):

| Event                                               | What Stack Health takes from it                                   |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `task-start`                                        | a task was attempted                                              |
| `turn-start {model, providerKind}`                  | a turn ran, on the local or cloud side, on this model             |
| `usage {promptTokens, completionTokens, dollars}`   | tokens for the turn just started; cloud dollars are authoritative |
| `model-switch {providerKind}`                       | a flip to the cloud (counted when it lands on cloud)              |
| `tool-start` / `tool-denied`                        | tool runs and denials                                             |
| `approval-request` / `approval-resolved {approved}` | approvals asked and refused                                       |
| `task-done {reason}`                                | outcome: complete / declined / error / other                      |

`providerKind` is stamped on every turn by the engine (`loop.ts`), so the
local-vs-cloud split needs no inference. Each `usage` event is attributed to the
provider side of the turn that produced it; a `model-switch` mid-task moves the
attribution for the turns after it.

## The three rings

- **Local / Private** (`privacyRing`): local turns over total turns. This is the
  brand ring: the more of your work stayed on your hardware, the fuller it is.
- **Flow** (`flowRing`): tasks completed over tasks attempted.
- **Saved** (`savedRing`): dollars you avoided over what the same work would have
  cost entirely on the cloud reference model.

## Dollars saved is an estimate, and says so

Local inference is free, so a local turn's `usage.dollars` is 0. To answer "what
did running locally save me," Stack Health reprices the tokens that ran locally
at a single, named cloud rate: **Claude Sonnet** (`SAVINGS_BASIS`, matching the
Sonnet row in `auth/usage.ts`). That basis travels with the payload
(`savingsBasis`) so the UI can show what the figure assumes. It is an honest
counterfactual ("this would have cost about X on Claude Sonnet"), never presented
as a receipt. Actual cloud spend (`cloudDollars`) is summed straight from the
journal's `usage.dollars` and is never repriced.

`wouldHavePaid = savedDollars + cloudDollars`.

## The privacy seal is honest, including the parts that are not green

Three facts, each literally true:

1. **Telemetry** is off by construction (green, always).
2. **Data left device**: if there were no cloud turns in the window, "Nothing
   left this device this period" (green). If there were, it says so plainly:
   "N cloud turns sent to your provider, on your own key." A real amber note,
   not an alert, because a cloud call genuinely sends your prompt and context.
3. **Encrypted at rest**: journals are currently plaintext on disk. The seal
   reports "Sessions are not yet encrypted at rest" (amber `pending`) and flips
   to green only when the separate journal-sealing task ships. One candid amber
   is what makes the two greens believable.

**At-rest encryption is a separate task** (per the CTO): the engine needs its own
`node:crypto` sealing that mirrors the app's `enc:v1:iv:ct` format
(`app/src/lib/crypto.ts`), keyed from the OS keychain, applied per journal line
and tolerant of legacy plaintext. Until then the seal stays honest and the
reader (`readJournal`) already skips any line it cannot parse, so a future sealed
line degrades to skipped rather than crashing the read.

## Time travel

`day` / `week` / `month` / `year` / `all` each set a cutoff and a set of buckets
(hourly, daily, daily, monthly, monthly). **Buckets are session-grained**: a
journal carries no per-event timestamp, only the session's `updatedAt`, so a
whole session's turns land in the bucket its last activity falls in. Trends are
therefore session-resolution on purpose; the docs and the code say so rather than
implying per-minute precision the data does not have.

## The Crew

Today the "crew" is the configured stack: the orchestrator and the enabled
specialists (`config.stack`), each shown with its model, whether it runs local or
cloud, and how many turns its model handled in the window (attributed by model
id). **Named agents are Phase 2.** The current config schema has no per-agent
definitions and `AgentEvent` carries no `agentId`, so per-named-agent stats are
not yet attributable. The CTO-approved foundation for that (an `agents` record in
`ConfigSchema` and an opaque `agentId` on `task-start` / `turn-start`, threaded
through `loop.ts` and stamped as a stable record key, never a display name) is a
prerequisite for the named-crew view and is tracked separately.

## The endpoint

Stack Health is a read-only aggregation method on the engine host, reached the
same way as `catalog()`: `stackHealth(range)` on the bridge
(`app/src/lib/electronBridge.ts`) → `osc:stackHealth`
(`app/electron/main.ts`, `preload.cjs`) → `EngineHost.stackHealth`
(`app/electron/engineHost.ts`) → `computeStackHealth`
(`os-code/src/insights/stackHealth.ts`). The WebView never touches the
filesystem; it asks the engine, and the engine reads only what is already on
disk. Payload types are pure and shared through `os-code/protocol`
(`insights/stackHealthTypes.ts`), so the app imports them without pulling any
Node built-in into the bundle.

## Phasing

- **Phase 1 (built):** the aggregator, the honest seal, the three rings, dollars
  saved, flips, tools, outcomes, the session-grained timeline, and a crew view
  over the configured stack. Everything above.
- **Phase 2:** named agents (the schema + `agentId` foundation), which upgrades
  the Crew from stack roles to the user's own named agents with per-agent stats.
- **Phase 3:** optional one-tap suggestions and thumbs feedback on outcomes.

## Tests

`os-code/test/stackHealth.test.ts` pins the fold: local-vs-cloud attribution of
the usage that follows each turn, the savings reprice against the named basis,
flips / tools / approvals / outcomes counting, per-model turn attribution, and
the session-grained bucketing.
