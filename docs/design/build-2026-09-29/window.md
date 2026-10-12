# Package window (C1): the small model's true window

## Log

The engine now budgets against the window the server really serves. On
Ollama with `numCtx` unset, `capabilities().contextTokens` is the lower of the
model's own window and what Ollama serves a request that names none (the
Modelfile's `num_ctx` from the /api/show parameters block, else the default for
that Ollama version: 2048 before 0.6.7, 4096 from it, 2048 when the version is
unknown), cached per model; `'auto'` is unchanged and non-Ollama servers keep
today's behavior. The prompt estimate counts the native tool specs and their
template, and compaction holds them against the same budget (and says it
compacted only when it did, and never folds a stretch shorter than its own
summary). One observation is capped by the seat's class share of the served
window (readFile cuts at whole lines and says which `startLine` to read on
from; any other tool is cut by the loop with the transcript kept whole; vault
reads never pass it). A turn whose server reads back under 60 percent of the
estimate emits one additive `window-cut` event per chat per model, carrying
the model, the provider id, what was read and estimated, `room: 'more' | 'full'`
and the memory cost in GB when the model's geometry gives it; every usage event
carries `estimatedPromptTokens`, and `DriveTrace.promptWindow` records each
turn's read against its estimate, printed as "N of M turns cut by the server".
The "Give it more room" action exists in the engine: `giveMoreRoom` writes
`providers.<id>.numCtx: 'auto'` to machine config and switches every live
provider on that server from its next request, behind an admin-only
`POST /sessions/:id/more-room`. The text bridge gets the same menu native tools
get (terse lines for a lean seat); a verify retry clears the repeat state
(`clearRepeatState`, one place); a memory-only task runs no check or judge; a
decline, plan-mode or policy refusal, jail denial or stale repeat no longer
counts toward the cloud offer; the platform word comes from `process.platform`.
Tests: new `os-code/test/window.test.ts` (30), a daemon route test, and two
existing tests updated. Gates: engine 125 files, 1958 passed, 1 skipped; app
193 files, 2598 passed, 2 skipped; both suites' build, typecheck, lint and
format green.

## Decisions

- CTO 5 applied: the fallback default is per Ollama version and never the
  native window. From 0.15.5 Ollama picks its default from graphics memory
  (4096 under 24 GiB, 32768 to 48 GiB, 262144 above); the engine takes 4096,
  the lowest tier, so it errs low (earlier compaction, never a silent cut).
- `test/providerNumCtx.test.ts` "off: contextTokens is the model own" asserted
  finding 4 itself; it now expects 4096 served and the native window beside it.
  Its fake Ollama now reports a version.
- `compactHistory` returns `compacted: false` when nothing was trimmed or
  folded, and skips a summary of under about 400 tokens. Counting the tool
  specs makes the budget unreachable on a 4k window, and without this every
  turn said "Compacted" and paid a model call to fold two messages. The old
  fraction test used a history nothing could shorten; it now uses a trimmable
  one, and a new test pins the honest flag.
- The per-message template overhead already existed (+8); it is now the named
  `MESSAGE_TEMPLATE_TOKENS`. New: `TOOLS_TEMPLATE_TOKENS` (120) for the tool
  preamble, plus the specs as rendered.
- `TRUNCATION_RATIO` 0.6 and `TRUNCATION_MIN_ESTIMATE` 1024: the 4-chars
  estimate runs within about a quarter of the real count (prose high, code
  low), so 60 percent is past that noise. Cache reads and writes count as read,
  so an Anthropic cached prompt is never a cut.
- CX 6 needs a title, body and action, so the notice is a new additive
  `window-cut` event, not the `status` event the brief allowed reusing "if one
  fits". The terminal clients print it (`windowCutLines`).
- "Memory is free" is judged by the existing per-class ceiling for this
  computer's RAM (`numCtxCeiling`, CTO I1), not `os.freemem()`, which reads
  low on macOS. The GB figure comes from /api/show model_info (layers, key and
  value heads, head size, f16), rounded up to a tenth; absent when unknown.
- CX 6 says "from your next message, in every chat", so `giveMoreRoom` also
  marks the server in a process-wide set every `OpenAICompatibleProvider`
  reads, not only the config file a new session reads.
- Observation caps: a new policy field `observationContextFraction` (tiny 0.2,
  small 0.25, mid and large 0.3, placeholders until the eval), clamped to
  2,000 to 24,000 characters; no profile keeps 24,000. Not a project override.
  The loop's own cut allows 1,000 characters of slack so a tool that sized
  itself to the cap (readFile, a vault read) keeps its header. readFile's
  arguments are `startLine` and `endLine`, so its note names those, not
  offset and limit.
- The text bridge uses `toolSpecs()`, plan mode's filter included, so text and
  native menus match. `ToolRegistry.textDocs` had no other caller and is gone;
  `textProtocolInstructions` still takes a registry for the eval harness.
- Escalation: a path outside the workspace is a policy refusal, like a deny
  rule. A native call rejected in a batch with valid ones now counts as a parse
  problem. A turn of refusals only leaves the count where it was.
- Memory writes set the renamed `noteWroteThisTask` (was `vaultWroteThisTask`)
  and not `attemptedWriteThisTask`, so the no-write nudge never asks a seat to
  "read the file again" after a memory note.
- Platform word: Linux stays "linux", so the Linux prompt is byte for byte as
  before; darwin is "macOS", win32 "Windows". The shell half of CTO 10 is the
  shell package's (integrator correction); nothing here touches the shell
  resolver or `SHELL_WRAPPERS`.
- Per the integrator's correction, the app card is left to the integrator (it
  spans the Electron IPC lockstep, four drivers, the store and a new card);
  the engine event, route and host function are ready for it.

## What remains

- App card for `window-cut` (CX 6 copy), for the integrator:
  `app/src/drivers/types.ts:56` add `giveMoreRoom?(provider)` beside
  `trustFolder`; `remoteDriver.ts:686` POST `/sessions/:id/more-room` with
  `{"provider": id}` (403 for a member, 409 for an unknown provider);
  `electronDriver.ts:80`, `lib/electronBridge.ts:301`, `electron/preload.cjs:29`
  (`invoke('osc:giveMoreRoom')`), `electron/main.ts:855`
  (`guarded('osc:giveMoreRoom', ...)`, two strings) and `electron/engineHost.ts:384`
  calling `giveMoreRoomHere(provider)` from
  `os-code/dist/src/providers/servedWindow.js` (the host shares the module
  with its sessions, so the live switch holds); `guardedDriver.ts:318`
  passthrough; the store maps the event to an item in a sibling module
  (CTO 9); the card: title "{model} could not see the whole chat", the body,
  with `room: 'more'` the "Give it more room" button and sub "Uses about {gb}
  GB more memory. Replies get slower." ("Uses more memory. Replies get
  slower." when `gb` is absent), after the tap "{model} has more room from
  your next message, in every chat."; with `room: 'full'` "This computer has
  no memory to spare for more. A shorter chat helps." and "Open Stack"; with
  no `room` the title and body only (a server whose window OpenShore does not
  set). Teal, press feedback, motion tokens.
- A small seat on a default 4096 window carries about 3,000 tokens of fixed
  prompt (lean system prompt, its code map share, ten tool specs), so the
  budget now compacts often and the card rarely fires (C1 stops the cut). A
  card or pill for "this window is nearly full before the chat starts" would
  reach those people; `os-code/src/core/agent/loop.ts:1260` is where the fixed
  cost is known.
- A mid seat served 4096 still gets the full prompt (about 7,000 tokens with
  every tool); the lean prompt keys on class, not window
  (`loop.ts:226` `LEAN_CLASSES`, `leanSeat`). Its reads land near 0.58 of the
  estimate, just under the ratio, so the card fires; the prompt should shrink.
- `os-code/src/providers/servedWindow.ts:20`: from Ollama 0.15.5 a large
  graphics card or `OLLAMA_CONTEXT_LENGTH` serves more than 4096; a VRAM read
  or `/api/ps` `context_length` (the window of the last load) could lift the
  budget there.
- `os-code/src/core/tools/parser.ts:258` `toolCallJsonSchema` still lists every
  registered tool in the grammar repair pass; it could take the menu too.
- CTO 6's alternating-repeat detector adds its state to `clearRepeatState`
  (`loop.ts:2002`), which the verify retry already calls.
- When the shell package lands `shellInfo()`, the workspace line in
  `loop.ts:998` and `:1009` should name the shell through it and drop
  `platformWord` from `core/agent/window.ts`.
- The app's own Stack driver talks to Ollama without the engine and keeps its
  own window assumptions (`app/src/drivers/stackDriver.ts`); not in this
  package.
- Eval on the reference box: `osc eval --deep --num-ctx off|auto` now prints
  "N of M turns cut by the server" per task; record it before
  `observationContextFraction`, `TRUNCATION_RATIO` or the numCtx default move.
- Device checks: on a Mac the system prompt says "(platform: macOS)"; with a
  14B on Ollama's default window the card appears once, and after "Give it
  more room" the next message sends `num_ctx` and `~/.os-code/config.json`
  holds `numCtx: "auto"` for that provider.
