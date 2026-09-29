# Package: drivers (A4, B1, B2)

## Log

The search turn, the provider client and prompt size by seat class landed on
`build/drivers`. `app/src/drivers/providerClient.ts` is the one client for
Claude and every OpenAI-compatible seat (a connected cloud provider or your
own model server): `stream(messages, tools, signal)` yields text, thinking,
usage and a round's end with its tool calls, and the Stack's four `run*`
paths, `oneOpenAiToolRound` and `completeOnce` now run on it (two loops,
`runAnthropic` and `runOpenAi`, over one `streamRound`). Transport per CTO 7:
a new guarded main-process channel on Electron (`app/electron/chatStream.ts`,
`osc:chatStream`, `osc:chatStreamAbort`, data on `osc:chat-stream`, torn down
on reload, crash and close; `httpFetch` unchanged), the WebView stream on the
iPhone with one fall back to the native shim on a refused preflight, the
streaming fetch on the web. Stop closes the turn at once on every branch
(Stack, pocket chat, desktop free chat), keeps the partial in the chat and in
history, drops late data by request id, and both error branches now go
through `finish('error', ...)`. `app/src/drivers/searchTurn.ts` owns the
search rules for all three drivers; `searchAllowedNow()`, `webOnlineNow()`
and `searchOffered()` sit beside `setSearchConsent` in `lib/localSearch.ts`
(the store only registers two readers), `SEARCHED_NOTE` is new in
`os-code/protocol`. Seats are classed by `seatFor(ref).modelClass`; tiny and
small seats drop both standards; framing runs only when there is someone to
hand off to and a simple request is answered by the framing call itself. The
vision fallback names its model and picks the last (least costly) Claude in
the lineup; every Stack card says "Or press Stop to skip it."; the person's
own Stop reads "Stopped by you." or "Stopped before it answered." as a muted
marker (CX 5); a model on your computer says "Warming up {model} on your
computer." on its first request and the 30 second slow-start line once. New
tests: `test/providerClient.test.ts` (12), `test/chatStreamChannel.test.ts`
(12), `test/stackAbort.test.ts` (17), `test/searchTurn.test.ts` (13),
`test/stackPromptSize.test.ts` (7), plus extensions to `mainIpc`,
`transcript`, `chatRescue`, `stackDeviceWatchdog`, `stackImageAskFirst`,
`localModelSearch`, `stackVaultContext`, `vaultTool`, `privacyCalls` and the
engine's `localSearch`. Gates: engine build, typecheck, lint, format green,
1927 passed, 1 skipped (1928); app typecheck, lint, format, build green, 2661
passed, 2 skipped (2663; baseline 2598 passed, 2 skipped).

## Decisions

- CTO call: the framing gate counts the paired computer's engine as someone
  to hand off to (docked with a workspace bound), not only a placed
  specialist. An anchor-only stack that is docked can still run a play whose
  step edits files on the computer (`stackVaultContext` pins that path);
  undocked, an anchor-only stack makes one call per message.
- CTO call: "reuse a single-step framing as the answer" is done by letting the
  plan prompt answer in prose when the lead would do the one step itself
  (`planPrompt(..., answerDirectly)`, `PlanReplyFilter` in `lib/play.ts`). A
  reply that opens with JSON is still a plan; a one-step JSON plan for a
  specialist still goes to the single-turn path (two calls, because a
  specialist answers). The framing call now carries the anchor's own pack,
  since it may be the answer, so a play renders the pack once more for the
  anchor (the card updates in place).
- CTO call: a search line the host cannot honor (the one search is spent, or
  search is declined or offline) is never printed and never run as a third
  pass; the turn ends with the existing "did not come up with an answer"
  line. One search, at most two generations per message.
- CTO call: the Stack's and the pocket chat's device branches also close at
  once on Stop (the 250 ms test covers every branch); the old abort beat now
  only drops the slot claim when the runner never confirms the stop.
- CTO call: `num_ctx` is supported by the client (`OpenAiSeat.numCtx`, sent
  only to an Ollama base URL) but nothing on the app side configures it, so no
  request carries it. A BYOM connection's `contextTokens` describes the window
  for the pack; sending it would change what Ollama loads, the flip CTO 5
  holds for an eval.
- CTO call: the chat channel refuses link-local addresses (169.254/16,
  fe80::/10) even though they are "your network", because a cloud machine's
  metadata service answers there; plain http goes only to loopback, the LAN
  (10/8, 172.16/12, 192.168/16, fc00::/7) and 100.64/10, and a name that
  resolves both inside and outside is refused as rebinding.
- CTO call: the iPhone falls back to the shim on every refused preflight (no
  per-server memo), so a server whose CORS is fixed streams without a relaunch.
- A BYOM model whose name carries no size classes as `small` (the pack seat's
  existing reading), so it drops both standards; a large model behind a
  gateway with an unsized name loses them until its connection can say more.
- CX call (CX 5 applied, one part held): the muted Stop marker, the warming
  line and the slow-start line are built. The fade over `--dur-2` and the
  breathing caret are not: `theme.css` (`.md-live .w`, about line 3348)
  records the founder's 2026-09-23 "Claude-style arrival" with no caret over
  `--dur-6`, and a founder call outranks the ruling. Held for the founder.
- "Warming up" is said on a seat's first request in a chat, not every turn,
  since a server that already holds the model is not warming.

## What remains

- `app/src/drivers/cloudOpenAiDriver.ts:223`: the direct cloud chat with an
  OpenAI-compatible provider (outside the Stack) still asks for `stream:
  false` through the native shim on iPhone and Electron, with no abort. It can
  move onto `openAiCompatibleClient` the same way; out of this package's file
  list.
- Device check (iPhone): a BYOM seat on Ollama over the tailnet streams word
  by word through the WebView fetch (Ollama sends CORS headers), and a server
  that refuses CORS falls back once to a whole answer; Stop during both ends
  the turn at once. WKWebView's own request timeout may cut a cold 7B load
  past 60 seconds on the first word: watch for it on the reference box.
- Device check (desktop): a BYOM seat on `http://127.0.0.1:11434/v1` and one on
  the LAN stream through `osc:chatStream`; a public `http://` BYOM is refused
  with the plain sentence; reload mid-reply stops the server generating.
- `app/src/theme.css:3348`: the founder to settle CX 5's fade duration and
  caret against the 2026-09-23 arrival.
- `app/src/drivers/stackDriver.ts:2023`: the slow-start line is for BYOM seats
  on your own network and the desktop free chat; a pocket model on the phone
  keeps its own "Warming up {model} on this device" line.
- `app/src/drivers/stackDriver.ts:1519`: the framing call on a BYOM local
  anchor does not say "Warming up" (only the single-turn path does).
- `osc eval` numbers for the lean small-seat prompt (tenet 2): the change only
  removes what a tiny or small seat cannot hold; large seats are unchanged.
