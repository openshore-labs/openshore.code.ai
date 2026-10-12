# Package harness (CTO 6): the premium harness lifts for 3B and 7B seats

## Log

Alternating-repeat detection is on for every seat: the loop's repeat ladder
now also catches two calls taking turns (A, B, A, B) with the same arguments,
the cycle the exact check misses when a write or a command that succeeds sits
between the pair (`harness/repeatCycle.ts`, pure; `noteRepeat` in loop.ts).
The fourth call is answered from the record, the next that keeps the cycle
going makes the next turn answer-only; any call that breaks the pattern, a
task start, a fresh attempt and a verify retry (`clearRepeatState`) clear it.
Every call answered from the record marks its `tool-end` with `repeat:
'exact' | 'alternating'`, and `DriveTrace.repeatBreaks` counts both. Per the
integrator, `readProcess` is volatile: never answered from the record, and it
joins the cycle watch by the output it showed, so a cycle through it breaks
only once that output stops moving. Retrieval before turn one ships off
(`harness.retrieval.firstTurn`, `--retrieval on|off`): on a seat that stays on
this network (judged by address), the keyword search (`keywordHits` beside
`keywordSearch` in `context/index.ts`) heads the task's first message with the
best excerpts by `file:start-end`, within the lesser of 1,500 tokens and a
tenth of the served window, skipping secret-shaped files (`stageSecretOf`),
paths the vault's privacy rules keep local or hide, the vault folder, and
paths the policy denies to readFile; an additive `retrieval` event becomes a
teal card. Union decoding ships off (`harness.decoding.union`,
`--union-decoding on|off`): a tiny or small seat on the JSON text bridge whose
server holds a schema (`useConstrainedDecoding`) sends `buildDecodingSchema`
of its own menu as `jsonSchema` (Ollama's `format`), learns the `{"say"}`
shape from the prompt, streams only the answer's words (`SayStream`), keeps
`maxCallsPerTurn` on this path only, and falls back for the session on a 4xx.
`constrainForSmallModels` now gates the repair pass it always described. A seat
whose full fixed prompt takes over 40 percent of its served window runs the
lean prompt and the lean menu whatever its class (a mid seat served 4,096),
with its own once-per-session note; when even the lean prompt takes over half
the window, an additive `window-tight` event becomes the window card's
little-room variant once per chat per model. The task-done card (the changed
files card) carries the task's verdict pill, and a headless run leaves
`delegate`, `analyzeImage` and `generateImage` out and names them. Both eval
flags go on `--deep` and `--floor`, into the variant suffix, and the trace
line prints retrieval tokens, union turns and repeats broken. Tests: new
`os-code/test/harnessLifts.test.ts` (35: the cycle broken and recorded, a
pattern break and a verify retry clear it, readProcess never stale and its
cycle standing while output moves, retrieval off byte-identical, on inlining
capped hits and skipping `.env`, a secret-shaped file, local-only paths and a
denied path, never on a cloud or remote seat, union off byte-identical, on
sending the schema and streaming say text through the loop and through a fake
Ollama as `format`, the per-turn cap, the 4xx fallback, the repair meaning, a
mid seat served 4096 on the lean prompt, the little-room notice once, the eval
flags parsed and in the suffix, the drive, the floor and the trace line, the
config classified off-only, headless with no specialist tool); new
`app/test/harnessCards.test.tsx` (10: the verdict's pass, fail and not checked
states, the tap that scrolls to the check through the real MessageList, the
colors, the little-room and retrieval cards from their events). Gates: engine
build, typecheck, lint, format green, 131 files, 2087 passed, 2 skipped (was
2052); app typecheck, lint, format, build green, 214 files, 2936 passed, 2
skipped (was 2926). One engine run under load from parallel builds failed a
vault index timing test (`vaultIndex.test.ts`, worst title search time); it
passed alone and in every later full run.

## Decisions

- CTO call: "clear on any change" is read as any call that breaks the
  pattern, plus the resets `clearRepeatState` makes. A workspace change cannot
  clear it: the cycle this catches is exactly the one where a successful write
  or command between the pair makes each call look fresh to the exact check.
  A read-only cycle is already caught at its third call by the exact check,
  which still speaks first.
- The cycle ladder mirrors the exact one (warn once, then answer-only): the
  fourth call of A, B, A, B is stale, the fifth is answer-only.
- `repeatBreaks` is `{ exact, alternating }`, counted from the `tool-end`
  events marked `repeat` (an additive field, not a new event).
- Integrator instruction: `readProcess` (matched by name, the tool arrives
  with the processes package) is volatile in both checks. Its cycle key carries
  the output it showed, noted after it runs, so the cycle breaks only when two
  reads showed the same output. The guardrails' own repeat rail is unchanged
  (see What remains).
- CTO call: retrieval uses the keyword search only, never the embedding index:
  an embedder may be a cloud endpoint (an automatic send nobody asked for), and
  a first index refresh embeds the whole repository before turn one on the CPU
  box. It needs a new `keywordHits` (line-level excerpts) beside
  `keywordSearch`, which returns file names only.
- Retrieval heads the task's first message (before any context preamble), so a
  best-of-N fresh attempt starts from it too; the chat bubble stays the
  person's own words. Excerpt lines carry no line-number prefixes, so a small
  model never copies one into editFile's search.
- "Local-only paths" in a workspace: the machine's vault privacy globs
  (`Private/**`, `Journal/**` by default) and a markdown file's own marks
  (`oscode: local-only`, `#private`) applied to workspace paths
  (`bodyVisibility`, now exported), plus anything inside the vault folder and
  anything the permission policy denies to readFile.
- Under an 80 token budget (a window under about 800 tokens) retrieval adds
  nothing: no excerpt worth reading fits.
- Union decoding checks the class (tiny, small) as well as
  `useConstrainedDecoding`, since a project override may set
  `constrainedDecoding` on a mid seat. Never on an answer-only turn. The union
  prompt lines replace the text bridge's opening lines, which told the model to
  answer with no JSON. A `say` reply is kept in history as its plain words. A
  4xx other than 429 turns it off for that model for the session, with one
  status line.
- `turn-start` gains `decoding: 'union'` and `DriveTrace.unionTurns`, so a
  union run that never engaged reads as zero, not as "no lift".
- `constrainForSmallModels` was read nowhere; it now gates the repair pass's
  tool-call grammar (default true, so nothing changes), which is the meaning
  CTO 6 says it keeps.
- CTO call: `WINDOW_LEAN_FRACTION` 0.4 (the full system text plus the native
  tool specs over 40 percent of the served window) and `LITTLE_ROOM_FRACTION`
  0.5 ("most of the window"), both placeholders until the eval like the class
  fractions. A window-lean seat gets the lean prompt, the small class's
  ten-tool menu by the same priority, and the merged vault tool, only with
  harness profiles on. The little-room notice fires for lean seats only.
- The little-room notice is a new additive `window-tight` event, since an
  older client would misread a `window-cut` with a flag as "could not see the
  whole chat". The app maps it to the window card with `tight`, so the
  "Give it more room" action and its cost line are the same.
- CTO call: `harness.decoding.union` and `harness.retrieval.firstTurn` are
  `off-only` in projectPolicy (a project may turn them off from any folder, on
  only once trusted), like Chain of Thought: both cost time on this computer.
  `constrainForSmallModels` stays `project`.
- CTO call: on `--floor` a lift flag is set on every engine run; the Claude
  Code baseline rows stay with the plain floor run (a lift never reaches Claude
  Code, and each baseline run is hours on the box), and the table's file name
  carries the suffix (`floor-DATE-retrieval-on.md`).
- CX call: the verdict pill wears `--ok` for a pass, not teal as the package
  text asked. The color guard (`app/test/color-tokens.test.ts`) keeps teal for
  local and private (CLAUDE.md tenet 4), and the transcript's verify pill
  already shows the same verdict in `--ok`; teal would give one verdict two
  colors on one screen. A miss wears the warning ink, never the danger red;
  "Not checked" is muted and not a button.
- The verdict is derived at render (`taskVerdict` in `state/harnessOps.ts`),
  not stored on the card, because a checkpoint can create the card after the
  verify events and a replayed transcript must read the same.
- The words stay in one place: `verdictLabel` lives in `VerifyPill.tsx` (the
  undo test guards them there) and the task-done card imports it.
- Headless: the three tools are named by `networkToolsLeftOut`, so a call is
  refused by name, and the run note says "hand work to another model", "look
  at images with another model", "make images".
- `loop.ts` carried a literal NUL character in the repeat key; the key is now
  spelled `\u0000` (the same string), so the file greps as text again.
- Test helper: `makeTestSession` gains `specialists` to register the three
  handoff tools as bootstrap does for a stack that has them.

## What remains

- Eval on the reference box before any default flips (tenet 2):
  `osc eval --deep --retrieval off` and `on`, `--union-decoding off` and `on`,
  and `osc eval --floor --retrieval on` beside a plain floor run. The trace
  line prints retrieval tokens (prefill cost), union turns and repeats broken.
- Union decoding engages only on a text-bridge seat. The floor models
  (qwen2.5-coder:3b, qwen3:4b) report Ollama's tools capability, so they run
  native tools and a union run on them shows 0 union turns; measuring it needs
  a tiny or small model without native tools.
- `os-code/src/core/guardrails/index.ts:99`: the repeat rail (`maxRepeats` 3) still stops a fourth identical `readProcess` call as "the model is
  looping". For the processes package to decide (exempt by name, or a read
  that moves its offset).
- `os-code/src/core/agent/window.ts:63` and `:68`
  (`WINDOW_LEAN_FRACTION`, `LITTLE_ROOM_FRACTION`) and
  `os-code/src/harness/retrieval.ts:18` and `:21` are placeholders for the
  eval.
- `os-code/src/core/agent/loop.ts:239`: `OFFLINE_DENIED` says "nothing here
  reaches the web", which reads loosely for a `delegate` call.
- `os-code/src/core/tools/parser.ts:279`: `toolCallJsonSchema` (the repair
  pass) still lists every registered tool, not the seat's menu.
- Retrieval uses the keyword search only; a semantic variant waits for a local
  embedder judged by address and an index warmed before the task.
- `app/src/drivers/stackDriver.ts`: the app's own Stack driver talks to Ollama
  without the engine, so none of these lifts reach it.
- Device checks a person must do: on the Mac with a 14B on Ollama's default
  window, the first message shows "Mid model seat with a small window on this
  computer" and the little-room card once, with "Give it more room"; with
  `harness.retrieval.firstTurn: "on"` in `~/.os-code/config.json`, a task that
  names a function shows "Started from N places in your code" with a local
  model and nothing with a cloud one; a task whose check passes shows "Checks
  pass" or "It works" on the changed files card, and a tap scrolls to the
  check; a task with no check shows "Not checked". On the phone, the same
  pill is tappable and the card reads the same.
