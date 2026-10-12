# Package: cloud (streaming and Stop for the direct cloud chats)

## Log

The two direct cloud chats (a Claude model, or a connected provider's model,
picked by itself rather than through the Stack) now ride the drivers
package's provider client and keep its abort contract. `cloudOpenAiDriver.ts`
no longer asks the native shim for a whole answer on the iPhone and the
desktop: it streams through `openAiCompatibleClient`, so the desktop uses the
guarded `osc:chatStream` channel, the iPhone the WebView stream with one fall
back to the shim on a refused preflight, and the web the streaming fetch.
`cloudClaudeDriver.ts` already streamed on every shell (the SDK over the
WebView fetch) but only closed a stopped turn when the SDK unwound, so a stop
before the first byte or while the vault pack gathered never ended the turn,
and a failure dropped the partial; it now runs on `anthropicClient`. Both
drivers share `app/src/drivers/cloudChat.ts`: a per-send `CloudTurn` that
emits only while open, ends once (`finish`), and on Stop aborts the request
and closes the turn at once with the partial in the chat and in history; an
error keeps its partial with `text-final`. The provider client gained three
additive pieces: a `sources` event (Sonar's `search_results` or `citations`,
read in the streamed and whole paths alike), `stopReason` on `done` (Claude's
refusal note), and `OpenAiSeat.streamUsage` (`stream_options.include_usage`,
streamed requests only). Sonar citations, vision, Chain of Thought, usage
events with `dollars: 0`, the amber cloud `turn-start` and the vault pack all
hold, and both chats now carry the humanizer by the Stack's seat rule. Tests:
`cloudOpenAiDriver.test.ts` rewritten (5 to 27), `cloudClaudeDriver.test.ts`
extended on the real SDK over a mocked fetch (6 to 19), one agreement test in
`humanizeWriting.test.ts`, one body test in `providerClient.test.ts`;
`chainOfThought.test.ts` and `vaultContext.test.ts` now refuse the WebView
fetch so the shim path runs and nothing leaves the test. Gates: engine build,
typecheck, lint, format green, 2011 passed, 1 skipped (2012); app typecheck,
lint, format, build green, 2871 passed, 2 skipped (2873; baseline 2834
passed, 2 skipped).

## Decisions

- CTO call: Claude stays on the SDK over the WebView fetch on every shell
  (`anthropicClient`), not the Electron channel or the shim. Anthropic answers
  cross-origin calls when the SDK sends its direct-browser header, the Stack's
  Claude seat already rides this path, and the channel is held to
  `/chat/completions` and `/api/chat` with a header allowlist that has no
  `x-api-key` (CTO 7 keeps it narrow). The Claude tests prove it streams on
  Electron, the iPhone and the web and never touches the channel or the shim.
- CTO call: the direct chat asks a streamed reply for its usage
  (`stream_options.include_usage`), so the context meter and the `/cost` line
  keep the provider's own counts now that every shell streams (the old web
  path sent the same option). Only this chat sets `streamUsage`, so the
  Stack's requests are byte-identical, and the shim's whole request never
  carries it (OpenAI refuses the option when nothing streams). A provider that
  refuses it answers 400 before generating anything, so the driver asks once
  more without it (`cloudOpenAiDriver.ts:191`); two requests at most, never a
  second generation.
- CX call: the humanizer now reaches both direct cloud chats. They never
  carried it, while Settings promises it for "any text a model writes for
  you" and names only the pocket guides and a project's config as exceptions
  (`SettingsScreen.tsx:960`), and DECISIONS (2026-09-04) says the toggle
  governs cloud and BYOM models. `cloudHumanizer` mirrors the Stack's
  `humanizerApplies` and `leanSeat` (a cloud seat classes as large, so the
  setting decides); `humanizeWriting.test.ts` pins that the two agree. It adds
  about 1.6k prompt tokens per request on a paid seat, in Claude's stable head;
  turning Humanize Writing off drops it, as the toggle's toast already says.
  The store passes `humanize: settings.humanizeWriting !== false`
  (`store.ts:4049`, `store.ts:4067`), wiring only.
- Sonar's sources are read inside the provider client as one `sources` event,
  so the streamed, channel and shim paths share one reader
  (`providerClient.ts:318`); the driver says them once, after the answer, and
  never for a stopped turn.
- A per-send `CloudTurn` rather than a shared `aborted` flag: a stopped run
  that unwinds after the next send began (a pack that settles late, the
  uncancellable shim) cannot close or write into the new turn. Pinned by the
  "pack that settles after the stop" and "late answer goes nowhere" tests.
- No new copy. Both drivers end a stop with `task-done` reason `aborted` and
  the transcript's existing "Stopped by you." or "Stopped before it
  answered." applies; the arrival motion stays the founder's 2026-09-23 fade in
  `theme.css`, no caret.
- History keeps Claude's whole reply as its content blocks (as before) and a
  stopped or failed reply as its visible text; a partial is kept only when it
  says something, and a failure with no words shows the error alone (the
  empty `text-final` removes the empty bubble), the same as the Stack.
- `dispose()` clears the listeners before it stops the turn, so closing a chat
  is not recorded as a Stop, as the Stack does.

## What remains

- Device check (desktop): a direct OpenAI, Gemini, Kimi and Perplexity chat
  streams word by word through `osc:chatStream`; Stop mid-reply ends the turn
  at once and main ends the request; a Perplexity answer shows its sources;
  the meter reads the provider's count.
- Device check (iPhone): a provider that allows the WebView's cross-origin
  call streams; one that refuses it (check Perplexity and Moonshot) falls back
  once to a whole answer, and the provider's usage page shows one request, not
  two; Stop while the shim waits ends the turn at once and the next message
  goes straight out.
- Device check: Moonshot and Perplexity with `stream_options.include_usage`.
  If either answers 400 on every turn, the retry costs one refused request per
  message; drop `streamUsage` for that provider then
  (`app/src/drivers/cloudOpenAiDriver.ts:198`).
- `app/src/drivers/stackDriver.ts:2315`: `streamRound` ignores the new
  `sources` event, so a Perplexity seat in the Stack still drops its sources.
- `app/src/lib/egressManifest.ts:153`: the "Your cloud providers" entry names
  Anthropic, OpenAI, Google and Moonshot but not Perplexity, though a direct
  Sonar chat sends the chat to `api.perplexity.ai` (the host is listed, under
  search). Copy fix for whoever owns the manifest.
- The Anthropic SDK keeps its default two retries on a connection error, for
  the direct chat and the Stack alike; a request cut off after it reached the
  server could generate twice. Not changed here.
- The direct chats read Humanize Writing when a chat's driver is built, the
  same as the Stack (`store.ts:4106`); a flip reaches a chat whose driver is
  built after it (a new chat, a model switch, a relaunch), not one already
  running.
