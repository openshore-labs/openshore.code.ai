# Decisions

> The decision log: each judgment call, who made it, and why. Search it when
> a design choice looks already settled; it is not a guide. New here? Start
> with the top-level `README.md` and `ARCHITECTURE.md`. "Founder", "CTO",
> "CX", "CMO" and "Creative Studio" are Open Shore LLC's maintainers and the
> reviews they ran; entries keep the names as they were recorded.

One line per ambiguous call made during the build, per the autonomous
execution contract. Newest at the bottom.

- **Branch:** the brief names `claude/local-llm-code-prompt-ghgztb`, but this
  session's harness designates `claude/os-code-local-llm-agent-arqoow` for this
  repo and forbids pushing elsewhere; the work lands on the harness branch.
- **DOM for readability:** `linkedom` over `jsdom` (both allowed by the brief).
  Lighter install, no native deps, parses everything Readability needs.
- **ESLint 8** (`.eslintrc.json`) rather than ESLint 9 flat config, because the
  pinned tree in the brief names `.eslintrc.json`.
- **zod 4:** the brief pins no zod major; 4 is current. Object defaults use
  `.prefault({})` (zod 4 semantics) so an empty config file yields full
  defaults.
- **qrcode-terminal added** (pure JS, zero deps) because the brief requires a
  QR code in `osc pair` and hand-rolling a QR encoder is not a good use of
  anyone's tree.
- **Ollama native `/api/chat`** is used when the backend probe identifies
  Ollama (tools, images, structured outputs, `keep_alive`); every other
  backend gets OpenAI-compatible `/v1/chat/completions` with SSE.
- **Grammar-constrained decoding is a repair tool, not a default:** a
  permanent JSON constraint would forbid final prose answers, so the schema
  constraint applies on retries after a failed parse, where the backend
  supports it.
- **Em dash policy is TOTAL here** (comments included), deliberately strict:
  this codebase started under the rule, so nothing can drift from a
  comment into copy. Exemptions require a reason in the test.
- **Code map symbols come from per-language regexes,** behind an interface
  tree-sitter can slot into later; a native parser dependency is not worth the
  install fragility for v0.1.
- **Credential storage:** `secret-tool` (libsecret) when the desktop has it,
  otherwise AES-256-GCM file encryption keyed from the machine identity,
  mode 600. Documented honestly as obfuscation, not a vault.
- **GitHub device flow requires `OSC_GITHUB_CLIENT_ID`** (OS Code ships no
  OAuth app id; borrowing another app's id would be wrong); the PAT path works
  with zero setup and is the default offered. (Desktop CLI only.)
- **The app connects repos through one-tap OAuth, the GitHub App path Claude
  Code uses (founder, 2026-09-03).** This reverses the "OS Code ships no OAuth
  app id" stance ABOVE for the app: OpenShore now registers its own GitHub App,
  GitLab application, and Bitbucket consumer, and holds each client secret in
  the `repo-oauth` edge function so the app never carries a secret (same shape
  as Claude Code's server-held GitHub App). The provider redirect lands on the
  function's https `/callback`, which bounces a single-use code into the app
  over `oscode://repo-oauth`; the app posts the code to `/exchange`, which uses
  the secret over TLS. GitHub rejects a custom-scheme redirect URI, so the https
  landing is required, not chosen. Paste-a-token stays as the fallback on every
  card (a fine-grained token, or a host the OAuth app does not cover), so the
  zero-setup path above is intact. A provider whose `VITE_*_CLIENT_ID` is unset
  simply shows only the token path. Code: `app/src/lib/gitos/repoOAuth.ts`,
  `supabase/functions/repo-oauth/`.
- **The hosted license-verify server and the subscription OAuth exchange are
  the only stubs,** as the brief allows: the request/response contract is
  documented in `src/license/verify.ts`, the client (activation, offline grace,
  entitlement gates) is real, and subscription sign-in is labeled experimental
  and appears on no marketing surface.
- **Sessions journal every event** (`~/.os-code/sessions/<id>/events.jsonl`)
  and the SSE stream replays from any sequence number; that one mechanism is
  what makes phone reattach lossless.
- **Specialist-facing tools register only when the stack can serve them,** so
  a single-model setup never shows the model tools that cannot work.
- **Commit tool never pushes;** push flows through an approved shell command
  or the git helpers, keeping the `push` risk class distinct.
- **`imageGen` ComfyUI support is a named follow-up** (needs a workflow
  graph); A1111 and OpenAI-images endpoints are implemented.
- **Streaming smoothing reveals at ~40fps with a bounded lag,** rather than
  painting every delta verbatim: bursty local token streams read as calm
  typing, and a large cloud burst still drains in a few hundred milliseconds.
- **Download progress uses the Ollama `/api/pull` stream** (structured byte
  totals for a real bar) with a `ollama pull` CLI fallback. Both pull straight
  from the Ollama library, so this stays true to "direct from source, never
  from OpenShore."
- **Low-color terminals: downsample, do not drop color.** Ink already
  downsamples truecolor; the hand-rolled ANSI surfaces now detect color depth
  (COLORTERM / TERM) and emit truecolor, xterm-256, or nearest ANSI-16. A bare
  `xterm` with no COLORTERM is assumed truecolor (the modern default) so we do
  not strip color from capable terminals that simply advertise nothing.
- **No custom scrollback pager.** Over SSH the terminal's own scrollback pages
  natively and a custom pager fights it; `/find` (transcript search, TUI and
  plain) is the additive capability instead.
- **gitOS and BYOM parked as build prompts, not code.** Two founder-requested
  features (gitOS decentralized Git hosting; BYOM connect-any-model) are
  captured as Opus 4.8 build prompts in PROGRESS.md "Parked feature ideas," not
  built. The founder's "remind me whenever I work on OS Code" is wired via a
  new repo-root `CLAUDE.md` that makes every session read PROGRESS.md and
  surface both until each is checked off. BYOM is framed as an extension of the
  existing model/router layer, since OS Code is already bring-your-own-stack.
- **Vault (Obsidian-style knowledge base) parked as a build prompt too.**
  Personal-tier vault plus an organization tier, native markdown browsing, and
  agent read/write access; captured in PROGRESS.md "Parked feature ideas"
  alongside gitOS and BYOM, same standing-reminder treatment. Flagged as
  sharing gitOS's storage-provider abstraction for the personal tier, and as
  needing a real multi-writer backend (not a synced folder) for the
  organization tier, since consumer cloud drives do not solve concurrent
  writers. "Vault" is a working name, not settled.
- **gitOS + Vault decision points settled by the full advisory org
  (2026-08-25), founder delegated the calls and pre-authorized the build.**
  CTO: seam is path/bytes-shaped with single-writer lease ops from day one;
  real git shells out on the desktop engine only, the phone browses and
  buffers through the existing outbox grain; secrets on untrusted storage
  seal enc:v1 under a PER-REPO key from the credential store, never the
  device DEK; org Vault is Supabase multi-writer (LWW plus conflict copy),
  folder-plus-lease cannot honestly serve concurrent writers; agent writes
  are user-directed or agent-proposed with approval, never silent. CMO:
  "gitOS" stays internal (Git trademark policy), ships as Repositories;
  Vault ships as Vault BECAUSE compat is true; the honest claim is "point
  Obsidian at the same folder and it just opens." CFO: personal tiers are
  near-zero COGS on user-owned storage; Google Drive integration must use
  drive.file scope only or we owe a $15k-75k/yr CASA assessment; Vault free
  (habit hook), Repositories Personal-gated, org Vault inside commercial
  tiers. Creative Studio: "Paper Study" direction, wikilinks wear --local
  teal (internal knowledge is local/private), not-ready providers render
  full-opacity with an Arriving pill and a toast, never disabled-looking.
  Built same day: the gitOS seam (app/src/lib/gitos/) and the personal
  Vault on it, with export-to-real-files as the true-compat escape hatch
  the CTO required.
- **iCloud is the first cloud storage provider wired (2026-08-25), founder
  order iCloud then Google then Dropbox.** iCloud needs no external OAuth
  (unlike Google/Dropbox), so it went first: a native Capacitor plugin
  (app/plugins/oscode-icloud) reads and writes the app's iCloud Drive
  ubiquity container under NSFileCoordinator, the entitlement and
  NSUbiquitousContainers config make the container's Documents public in
  Files as "OpenShore", and the JS provider (app/src/lib/gitos/icloud.ts)
  satisfies the same seam as Local with the lease kept as a container file.
  Readiness is a RUNTIME probe (Icloud.available()), never a hardcoded flag:
  a signed-out phone or an unprovisioned build shows iCloud as not usable and
  it stays unselectable, so the seam never lies. The vault can move Local to
  iCloud from the storage sheet (vaultMoveTo copies every note, then
  repoints, leaving source bytes as a safety copy). FOUNDER PREREQUISITE:
  enable the iCloud capability with the iCloud.ai.openshore.oscode container
  on the ai.openshore.oscode App ID before the next distribution build, or
  signing fails (same class of step as Push). Google and Dropbox are next,
  and are pure-JS REST plus OAuth (no native plugin), Google restricted to
  the drive.file scope per the CFO to avoid the CASA assessment.
- **Google Drive is the second cloud storage provider wired (2026-08-25),
  the first real OAuth flow anywhere in this app** (every other cloud
  connection, os-code's GitHub device flow included, is either paste-an-
  API-key or a terminal flow). CTO ruling on the architecture: two OAuth
  clients under one Google Cloud project, not a choice, Google's own
  native-app rules require it. An "iOS" client redirects through the app's
  existing oscode:// scheme on a path (oauth2redirect) distinct from the
  Supabase auth callback; a "Desktop app" client redirects through a
  one-shot loopback HTTP server the Electron main process opens, bound to
  127.0.0.1 only, closed after the single request. Both flows are PKCE with
  state verification, the security control that makes a custom-scheme
  collision non-exploitable. Tokens live in the same secretGet/Set/Delete
  store as every other credential (iOS Keychain, Electron safeStorage);
  disconnect revokes at Google before deleting locally, and account sign-out
  now revokes Drive too, so a handed-off device does not keep standing
  access. drive.file scope (CFO ruling already on record) means the app only
  sees files it created itself: `app/src/lib/gitos/gdrive.ts` creates a real
  folder tree per resource (not the hidden appDataFolder) so a user, Drive
  desktop sync, and Obsidian can all find it normally, with a
  `.oscode/index.json` cache (same dotfolder convention as iCloud's lease
  file) to avoid a full tree walk on every read. write() never trusts a
  cache miss blindly: it resolves against a live listing first and surfaces
  more than one same-name match as a conflict, since Drive does not enforce
  unique filenames the way a filesystem does and a stale index could
  otherwise fork one logical path into two file ids. Founder decision
  (asked directly, not defaulted): the drive.file scope's real limitation,
  that files added outside OpenShore may not appear, ships as honest UI
  copy on the Drive backend rather than silent v1 scope. FOUNDER
  PREREQUISITE before either build can connect: register an "iOS" OAuth
  client (bundle id ai.openshore.oscode) and a "Desktop app" OAuth client in
  the same Google Cloud project, publish the OAuth consent screen with
  scope drive.file (non-sensitive, no CASA and no Google verification
  review at any publishing status) and, while its Publishing status is
  Testing, add every internal tester's Google account as a test user
  (refresh tokens expire after 7 days in Testing, a known trap to expect
  during dev, not a bug); then fill in VITE_GDRIVE_IOS_CLIENT_ID,
  VITE_GDRIVE_DESKTOP_CLIENT_ID, and VITE_GDRIVE_DESKTOP_CLIENT_SECRET
  (app/.env.example). Dropbox is next, app-folder scope per the CTO.
- **Off-device is where long work runs (standing principle, founder call
  2026-08-25).** Any feature that kicks off long or agentic work runs that work
  off the phone (on the user's daemon, or a cloud runner), as a durable,
  journaled, resumable job with a completion notification, never as an
  in-app-process task that dies when iOS suspends the app. The phone is a remote
  control and a viewer, not the compute. Rationale: iOS grants no app
  minutes-long background compute, so on-device (Harbor / pocket) turns simply
  cannot continue while the app is closed; the desktop-daemon path already runs
  the loop off-device and journals every step for replay, which is why it is the
  path that behaves like Claude Code. New long-running features should target
  that path (or a future cloud runner) by design.

- **Personal vault is device-scoped, not account-scoped (R-19):** sign-out
  wipes the synced team-vault state and Drive tokens, but leaves the personal
  vault's Local bytes and gitOS resource rows on the device, so a user's own
  notes survive signing out and back in. Wiping them on sign-out would delete a
  user's knowledge base as a side effect of signing out, which is worse than
  the shared-device leak it would prevent; the personal vault is treated as
  device-local property, like the on-device model files. A future encrypted,
  per-account vault at rest is the real fix for a shared device.

- **Free desktop chat is a stateless /chat endpoint, not a neutered session
  (CTO ruling, founder approved).** Chat with a paired desktop's own local
  models is free; the coding agent, Local Library, and repo writes stay Personal
  ($20). The free surface is a new daemon route POST /chat that builds only a
  provider and streams one completion, instantiating none of the acting
  machinery (no AgentSession, LocalDriver, ToolRegistry, command lane, outbox,
  journal) and pinned to the local orchestrator (no cloud spend). A
  "zero-tools session" was rejected: the user-command lane (POST
  /sessions/:id/commands) bypasses the tool registry, so a tool-less session
  could still run shell. The app uses a distinct source.kind 'desktop-chat'
  (not a flag on 'desktop'), so the free path can never reach the
  session-creating branch that opens the paid agent, and the gate stays
  `coding = source.kind === 'desktop'`. Honest limit: the $20 wall is not
  server-enforceable against a user's own daemon (they hold both ends); this
  change confines the free surface so it cannot act, it does not claim to
  enforce entitlement against a hostile self-daemon.

- **Personal is Apple-only (2026-08-31, founder).** The $20/yr Personal tier is
  an Apple auto-renewable subscription bought only in-app on iPhone/iPad. No
  Stripe purchase for Personal; web/desktop points to buy on iPhone, then
  refreshes the shared entitlement row to unlock. Stripe stays only for
  commercial team plans (Apple forbids seat-based SaaS in-app). Code:
  buyPersonal/Paywall no longer offer web Stripe checkout for Personal.

- **All Personal pay gates OFF for the beta (2026-08-31, founder).** Run the
  beta with no paywall: coding agent and Local Library free for everyone. One
  reversible switch, PAY_GATES_ENABLED=false in store.ts, short-circuits
  personalUnlockedNow() to true so every gate is off from one place. Flip to
  true to re-enable; Apple purchase/entitlement plumbing stays built underneath.

- **Desktop chat defaults to the engine on this machine (2026-09-02).** On the
  Electron app the empty composer targets `{kind:'desktop'}` (the engine's
  configured model) rather than the phone-style stack; "ready" on desktop means
  an orchestrator is configured (store `desktopStatus`), so a chat is never
  opened against an engine that cannot start.
- **Natives build at install (2026-09-02).** Root `pnpm.onlyBuiltDependencies`
  allowlists electron, node-pty, esbuild, electron-winstaller; the app's
  postinstall rebuilds node-pty for Electron's ABI. The Electron build wins the
  single build dir on purpose (desktop app + in-app daemon); the system-Node
  `osc` CLI reports its terminal unavailable rather than crash.

- **The app works the way the founder works with a coding agent (2026-09-02).**
  `docs/interaction-model.md` is the standard: goal in the person's words, a
  plan first, forks as pickers with a recommendation, one step at a time when
  the person must act, every change shown before it lands, verify then report
  plainly, honest states, keep moving. Setup surfaces express it as guided
  chats ("Walk me through it"); the Local Library expresses it as bundles (one
  decision, total size shown) instead of fifteen model choices.
- **Guide steps are written, not generated (2026-09-02).** A guide chat opens
  with a seeded plan so it is correct even on Harbor Mini; the model's job is
  questions between steps, never inventing the procedure.

- **The advisor org is a Crew preset (2026-09-02, founder).** The founder's
  advisory team ships inside OpenShore
  as eight named crew members with the org's real activity levels. Personas are
  rewritten for OpenShore, not copied; all advisory, the person decides. The
  engine's own prompts carry the same working loop (lead with the outcome, one
  step at a time when the person acts, verify before claiming).

- **Copy blocks for anything pasted (2026-09-02, founder).** Whenever the person
  must paste text elsewhere, every model prompt puts it in its own fenced code
  block, one per step, nothing else in it, and the chat renders every block
  with a one-tap Copy that reports failure honestly. The only exception is the
  person asking for something else. Interaction model tenet 9.

- **Premium UX out of the box (2026-09-02, founder).** The twenty laws of UX
  plus the house bar are injected into the coding agent's system prompt as
  build instructions (uxStandard.ts), on by default. Rerouting is deliberate:
  `ux.standard: "off"` or `ux.notes` in os-code.config.json, or "skip the UX
  standard" in the chat. The one duplicate in the source list (Postel's law
  twice) was resolved to the aesthetic-usability effect, the standard
  twentieth law.

- **Prefab stacks are catalog presets, and presets are auto-derived (2026-09-02).**
  My Stack shows the catalog's presets as one-tap downloadable prefab stacks;
  they ride the live catalog feed (24h TTL) and the scheduled rebuild, so they
  refresh with no intervention. The builder now DERIVES presets from the current
  model set and eval scores (scripts/build-catalog/presets.ts) instead of
  hand-authoring, so prefab stacks reassess as models change; the regression
  gate validates the result and it falls back to the seed's presets if
  derivation is empty. The remaining piece for brand-new models to auto-appear
  in the browse list is live discovery of new GGUF models; install-by-name
  covers getting any new model now.
- **Live discovery keeps found models unrated rather than scoring them.** A
  discovered GGUF repo has no eval and no benchmarks, so the storefront
  quality bar cannot honestly apply. Rather than invent a star or a fit, the
  entry is labelled `discovery`, never orchestrator-capable, unrated, ranked
  after the seed, and skipped by the preset deriver. Trending plus newest
  from Hugging Face, license fail-closed via the same allow-list, gated and
  denylisted repos out, one single-file GGUF at a known quant, cap 25 with
  carry-forward so the shelf never collapses. The cron went daily.
- **Discovery quality bar, tightened after the first live crop.** The first
  live run shelved abliterated and merge variants, a speech model, four
  uploads of the same weights, and a 0.1 GB file. Rather than hand-curate,
  the bar moved: the newest axis is trusted publishers only (labs plus the
  quantizers the community pulls from), trending needs 100+ downloads and
  shelves trusted first, one entry per underlying model (quantizer and
  imatrix twins collapse), 0.3 GB floor, and the denylist covers guardrail
  removals under every spelling seen plus speech. Names, not ratings, so no
  star is ever invented; a wrong call costs a mis-shelving, not a lie.
- **Discovery is trusted publishers only, both axes.** The second live crop
  under the open trending axis was community merges and renames riding a
  lab's name. A storefront that says "new" should mean a lab or a known
  quantizer shipped it, so both axes are limited to `TRUSTED_PUBLISHERS`, and
  every unlisted publisher is logged as skipped so the list grows on
  evidence rather than by default.
- **Discovery reads trusted publishers' own pages.** The third live crop
  found six trusted repos in eighty global GGUF listings, and those were
  sharded or "other"-licensed, so the shelf came out at one model. The
  labs' and quantizers' latest uploads are now read per publisher
  (`author=` listing, round-robin so bartowski cannot fill the cap alone),
  after the two global axes. Cap 40, at most 160 metadata reads per build.
- **A quantizer's upload is trusted as a conversion, not as a model choice.**
  The fourth crop shelved forty lab models but also bartowski's and unsloth's
  conversions of community models (darkps_ice, Muse-Glimmer). A quantizer
  upload must now also name a known lab family; a lab's own upload needs no
  such check. Speech, reranker, guardrail-classifier, and translation-only
  uploads joined the denylist, and dated versions collapse to the newest.
- **The side panel is the main navigation.** Founder call from the phone.
  The panel carries rooms only: day-one rooms at the top (Chats, Projects,
  Repositories, Your stack, Vault), second-session rooms at the bottom with
  Settings last. New chat, quick chat, and the project switcher already live
  in the Chats and Projects rooms, so removing them from the panel loses
  nothing. A room's top bar opens the panel (hamburger) instead of jumping
  back to chat, because the panel is where the next destination is chosen.
- **Motion standard, with adoption enforced.** The tokens
  and guards already existed in the app; the drift was raw values and
  surfaces that snap-unmounted. A presence-aware `Sheet` component was the
  cheapest way to give fifteen state-driven sheets an exit without rewriting
  each parent's state. The guard bans raw easing and sub-second raw durations
  in motion declarations; loops and delays of a second or more stay raw by
  design (the tokens do not reach that range).
- **Room dissolve is a DOM snapshot, not a second React mount.** Keeping the
  outgoing screen mounted for its exit would re-run its effects (catalog
  fetches, vault loads) and could duplicate a streaming transcript. A cloned,
  inert overlay costs nothing and fades for 220ms. Skipped under reduced
  motion.
- **Claude Code parity, engine first, one event protocol.** The permission
  modes are Claude Code's four and the ENGINE enforces them (`loop.ts` consults
  the mode before it asks; plan mode filters the tool specs to read and
  network and denies a mutating call outright), so the app's old client-side
  auto-approval now applies only to brains that run their tools in the app
  (the stack). A stored `'auto'` maps to `bypassPermissions`. Everything new
  the transcript shows (todos, plan-proposed, mode, repo-info, title) is a
  `DriverEvent`, so the desktop and the phone render it from the same reducer
  and the journal replays it.
- **A message typed mid-run queues in the app, not the engine.** The queue is
  thread state flushed on task-done, so the engine's one-task-at-a-time
  contract stands and a queued message survives a reopen of the screen but
  never a lost session. Attachments do not queue (they need a live turn).
- **Approving a plan is two calls, in order.** Accept-edits first (so the
  agent can act), then the go-ahead message. The plan bubble becomes the plan
  card rather than rendering the same words twice.
- **The engine's generated title replaces the first-line placeholder, never a
  name the person typed.** `Conversation.renamed` guards it.
- **The # shortcut writes to the project's instructions, not a hidden file.**
  Projects already carry standing instructions that ride into every session
  in them; that is the memory, and it is visible in the Projects room.
- **A contained third-party site is a native view named by the renderer,
  never a URL it chooses.** `EMBEDDED_SITES` in `electron/embeddedWeb.ts` is
  the whole allow list, with sign-in providers held to their sign-in paths,
  so the view can never become a browser. Desktop only; iOS would need a
  WKWebView plugin with the same fence, and Google OAuth would still refuse.
- **Settings rows carry no icons.** Type carries the hierarchy (serif group
  heads, label, value); a glyph set would be a third visual language next to
  the serif and the mono. Creative Studio's call, founder-directed build.
- **The starting paths render two ways from one component.** Cards in
  onboarding, rows in the Settings sheet (`variant="rows"`), so the copy and
  the download states never drift.
- **Quick chat is retired (founder, 2026-09-02).** One kind of chat, always
  in a project, always persisted. A throwaway mode cost a flag on every
  conversation, prune logic on every navigation, and a "keep this?" seam in
  the top bar, for a case the New chat row already covers. Old ephemeral
  rows are dropped on load rather than adopted.
- **Hosted models derive from the providers, not the catalog (founder, 2026-09-03).**
  Kimi and the other frontier models are too large to download, so a catalog
  entry would need a fake size and a Get that cannot deliver. The store builds
  its "Frontier, on your key" shelf from `providers.ts` at runtime instead:
  one list feeds Cloud Connections, the Stack bench, and the Local Library, no
  schema change, works offline, and old clients still parse the feed.
- **The phone's stream smoother diverges from the terminal's.** The two
  copies of `nextRevealLength` were kept in step by hand; the app's now runs a
  calm fixed pace with a bounded lag and keeps ticking after the stream ends
  (founder, 2026-09-03: "a more graceful typing of the response"), while the
  TUI keeps drain-a-sixth-per-tick, which suits a terminal that repaints
  whole lines. Each stays covered by its own test.
- **The keyboard lift has a fallback, and the attach tray is web-only.** The
  composer lifts on the plugin's height when it arrives and on the device's
  remembered height when it does not (default 336, a portrait iPhone with the
  QuickType bar; a compact phone gets a small gap rather than a covered
  field). The tray's three sources are plain file inputs (camera via
  `capture`, photos via `accept`, any file) rather than `@capacitor/camera`,
  so no native permission strings or plugin wiring ride on a polish fix;
  a native picker can replace them later behind the same `AttachSource`.
- **A chat's repositories are a per-chat list seeded by the project, and
  the selection is honest about one cwd.** Claude Code's picker makes every
  repo available to the session; this engine works in one directory, so the
  first selected workspace is where the agent works and the rest ride in as
  named context. Ids stay strings a project already used (a workspace path)
  plus `github:owner/name`, so no migration; GitHub is listed on the stored
  token from the app, and a native clone stays the existing desktop flow.
- **The drawer slides on its own curve and clock, `--ease-glide` over
  `--dur-7`.** The motion family was closed on purpose, but the iOS standard
  curve front-loads two thirds of its travel into the first fifth of the
  clock; on a 310px door that is a 110ms pop, and the founder's recording
  called it jumpy. The glide is a bezier fit of UIKit's critically damped
  spring, added as a named token with the reason beside it, pinned by the
  tokens test. A drag-to-close keeps the standard curve on its velocity
  clock, because a moving finger's momentum wants the front-loaded start.
- 2026-09-03: Crowd-sourced ratings are now allowed, reversing the "never
  crowd-sourced" rule, on the founder's explicit request. Kept honest by making
  community a SEPARATE axis (never in catalog.json `ratings`, own `--voice`
  token, always shown with a count) so benchmark "OpenShore fit" stays
  uncorrupted. Reviews gate on any signed-in user (founder's call over the
  stricter entitlement gate); anti-abuse is one-per-user + report/block +
  auto-hide + a count-gated, benchmark-shrunk average.
- 2026-09-03: Local Library coverage broadened but the TRUSTED_PUBLISHERS
  allowlist stays (CTO): opening it readmits clean-named guardrail-stripped
  models the name denylist cannot catch. Flagship big models arrive via
  multi-part GGUF shard support instead. "All models" is served as the pipe
  (install-by-name + discovery), never as a claim that every model is vetted.
- 2026-09-03: Community stars ship on browse-list rows (batched RPC) and the
  product page now; the store-front hero/shelves stay benchmark-only until a
  review-aggregate sidecar lands in the catalog build, to avoid per-view egress.
- 2026-09-03: Community stars on the store-front hero and shelves are served by
  one batched RPC per view (all on-screen model ids at once), not the CTO's
  CI-to-Supabase sidecar. Same visible result, far less infra; the sidecar
  stays the scale path if per-view browse volume ever makes the call chatty.
- 2026-09-03: Review moderation is operator-scoped, not org-admin: a
  review_moderators allowlist seeded by the founder, guarded SECURITY DEFINER
  RPCs, and a panel in AdminScreen that renders only for a moderator (so it
  works for a personal-account operator too, independent of the org umbrella).
- 2026-09-04: Project memory lives INSIDE the project's primary attached repo,
  in a folder "OpenShore Project <name> MDs/", committed with the code and not
  hosted by the app (founder's explicit call, revising an earlier session choice
  to keep it in the personal Vault). The notes travel with the repo; the harness
  writes them through its normal repo-jailed file path.
- 2026-09-04: Only the PRIMARY attached repo holds the folder (not every
  attached repo), so the notes have one home and cannot diverge across repos.
- 2026-09-04: The folder name wraps the project name with a fixed prefix and
  suffix ("OpenShore Project " + name + " MDs"), which both reads plainly and
  makes a bare ".." project name a literal folder rather than a traversal.
- 2026-09-04: The memory notes ride into the agent's commit alongside the change
  that prompted them; the tool does not make a separate commit or push just for
  the notes.
- 2026-09-04: The app read-only view of the notes was surfaced for a scope call
  (net-new plumbing on both platforms), then built full cross-platform on the
  founder's choice: a desktop repo-read bridge jailed to the repo root, and a
  read-only GitHub contents client for iOS / clone-less devices. On desktop the
  local clone is preferred (it shows uncommitted edits); otherwise the primary
  GitHub repo is read. The view is strictly read-only (the agent owns writes).
- 2026-09-04: The desktop repo-read IPC handlers are contained twice: a Jail
  rooted at the repo (blocks traversal/symlink/absolute escape) AND a shape
  guard that only permits listing an "OpenShore Project <name> MDs/" folder and
  reading a .md file directly inside one, with a 4MB size cap. So the handlers
  are self-evidently safe in isolation, not only because the renderer is trusted
  (CTO GO, both its non-blocking follow-ups folded in).
- 2026-09-04: Offline reconcile pushes the repo's unpushed commits (notes ride
  with the code) to the tracking upstream, automatically on app open and on
  reconnect (founder's picks). Never force-pushes; on a moved-on remote it
  fetches and merges, and a real conflict is aborted and surfaced, never
  clobbered. It runs desktop-side only, since that is where the clones and the
  agent's commits live; iOS reads the always-current remote.
- 2026-09-04: Reconcile scope is each project's PRIMARY local clone (the first
  non-GitHub repo id), matching the "primary repo" choice for the notes, rather
  than every attached repo, so the behavior is predictable and does not push
  repos the project only references remotely.
- 2026-09-04: CTO review of the auto-push (GO, data-safety rails sound) drove
  three follow-ups, applied: the push targets the tracked upstream branch name
  (HEAD:<upstream>), not a same-named remote branch; a 20s block timeout so a
  stalled transfer gives up; outright failures (e.g. missing push credentials)
  are surfaced to the person. A per-project opt-out `sync.autoPush:false`
  (os-code.config.json) lets a repo whose branch deploys on push keep manual
  control. The CTO's one behavioral concern (auto-pushing a default/deploy
  branch) went to the founder, who chose to keep pushing any branch including
  main (truest to "nothing lingers on the device"); `sync.autoPush:false` is the
  per-project escape hatch for a repo that deploys on push.
- 2026-09-04: The five presets auto-write through a dedicated
  `projectMemoryWrite` tool that the permission engine allows by name, rather
  than making the existing `vaultWrite` path-aware. Keeps `vaultWrite`'s
  always-ask ruling and its test intact, and makes the memory capability a
  distinct, hard-scoped affordance the model reaches for on purpose.
- 2026-09-04: Skills.md holds the project's reusable build/test/ship recipes and
  gotchas (founder's pick), not a registry of agents/skills.
- 2026-09-04: Tokens and Secrets is a per-project note (founder's pick over one
  shared note), stored in the sealed device-local store (not a vault note, which
  can move to a cloud provider, and not the repo, which is pushed), off by
  default behind a Settings toggle.
- 2026-09-04: Secrets reach the coding model ONLY when the orchestrator is a
  local model (founder's "local models only"). Enforced in one pure gate
  (secretsGate.ts) at bootstrap; a cloud orchestrator has them dropped. A
  secrets session also runs under egress lockdown (no web, no specialist/vision/
  image delegation) and never escalates to the cloud, so a secret has no path
  off the device. Secrets are handed only to the in-process desktop engine,
  never sent over the daemon to a remote machine.
- 2026-09-04: Seeding moved to the harness (the app no longer writes the notes,
  since it does not own the repo working tree): the projectMemoryWrite tool
  creates any missing notes from templates on its first write, so the folder
  materializes as a complete set the first time the agent touches it.
- 2026-09-04: Harbor Mini's Settings control shows "Built in" (a status, not a
  toggle), not an install/uninstall button. Bundled weights are part of the app
  and cannot be honestly uninstalled to free space, so a toggle would lie;
  Harbor (a real ~1.1 GB download) keeps the full Install/Uninstall control.
- 2026-09-04: The guides are framed as "grounded in" the OpenShore repo, not
  "fine-tuned on" it (they are stock Qwen weights). Honesty bar: they are experts
  via the injected app facts, so the persona says grounded, not trained.
- 2026-09-04: The Harbor rows are gated to non-desktop, matching the existing
  guide rows in StartingPaths: the on-device guide path is iOS (desktop runs
  on-device through Ollama), and the bundle is an iOS app bundle.
- 2026-09-04: Harbor Mini's model is SmolLM2-135M-Instruct (Apache-2.0, ~105 MB
  Q4_K_M), not Qwen2.5-0.5B (380 MB) or SmolLM2-360M (271 MB): founder capped the
  whole App Store download at 170 MB with the guide bundled, and 135M is the
  capable model that fits. It is a grounded guide (reads injected app facts),
  not a reasoner; Harbor remains the upgrade for real work.
- 2026-09-04: Kept the model id `harbor-mini` across the swap (stable slot,
  decoupled from weights, like Harbor's id): a weights change touches only the
  URL, size label, and attribution, so the bundled `harbor-mini.gguf` and all
  reconcile/stack code keep working with no id churn.
- 2026-09-04: Mini's handoff walkthroughs are RECITED from setupGuides.ts, not
  authored fresh in the persona. A 135M model reciting a fixed script is reliable
  where reasoning steps out is not, and sourcing them from the setup guides keeps
  them from drifting from the real UI. Added a `get-harbor` setup guide so the
  Harbor activation steps have a single home too.
- 2026-09-04: First Moves live as tappable chips in the chat (a new
  MiniFirstMoves), not as a new ThreadItem kind: it keeps the transcript model
  untouched and the chips simply disappear once the first message is sent. They
  snap-unmount, which the polish guard allows (it enforces exits for scrims, not
  transient affordances).
- 2026-09-04: Onboarding leads with the bundled guide as the single hero (the
  only primary button), demoting Harbor/cloud/Local Library to a "go further"
  tier. Creative Studio direction "The Standing Light." Mini is instant now, so
  making it the front door is honest, not hype.
- 2026-09-04: Renamed the guide to "Harbor Lite" (display only). Kept the code
  identifiers HARBOR*MINI*\* and the model id "harbor-mini" as the stable slot:
  the id is persisted in settings, stack refs, and the bundled harbor-mini.gguf,
  so moving it would strand state and the bundle for no user gain. Same slot
  pattern as Harbor's id vs its display name.
- 2026-09-04: Applied the studio's byline "Built in. Offline. Always on." over
  the earlier capability sentence (founder said apply all studio proposals). The
  "Built in" pill stays as the row's control-slot status; a small overlap with
  the byline is acceptable next to the honest name of the affordance.
- 2026-09-04: Humanizer ships as an injected system-prompt standard (like the UX
  standard), not a separate rewrite pass over finished output. The founder's
  phrasing ("output runs through a Humanizer Mechanism") reads like a post-filter,
  but a second model call over every output fights the local-first budget; born
  humanized in one pass is cheaper and matches how the UX standard already works.
  Config knob `humanizer.standard` ('on' | 'off', default 'on'), chat escape
  "skip the humanizer".
- 2026-09-04: The "Signs of AI writing" page is ingested as a dated snapshot
  baked into source, never a live fetch. The founder flagged the risk ("anything
  can be written in this page"); a world-editable page read at runtime is a
  prompt-injection and quality hazard, so it is treated as data captured on
  2026-09-04 and refreshed deliberately.
- 2026-09-04: Only the prose-voice signs were carried over. The source's
  Wikipedia-specific signs (wikitext vs Markdown, heading levels, category and
  template hallucinations, DOI and ISBN integrity, citation reuse) do not apply
  to OpenShore's general written output and would add noise, so they were left
  out.
- 2026-09-04: Scope is openshore.code.ai only for now, as the single source of
  truth next to uxStandard.ts (founder call). HQ and the marketing site can
  reference it later rather than each carrying a copy.
- 2026-09-04: Humanizer is surfaced as a user setting "Humanize Writing" (app),
  default on (founder follow-up: a named, visible feature aids transparency and
  lets it be renovated on its own; off trims the prompt for a little speed). The
  app toggle governs app-side chats (StackDriver); the desktop engine keeps its
  own config knob, matching how the UX standard already splits app UI from engine
  config, rather than adding a new app-to-engine config write path.
- 2026-09-04: The Humanize Writing setting skips on-device pocket models (Harbor,
  Harbor Mini), the same context-protection carve-out the UX standard makes. Real
  writing runs on cloud or BYOM models where the small-context concern does not
  apply, so the toggle governs those; the desktop engine carries the standard for
  its own agent.
- 2026-09-04: The app toggle now reaches the desktop engine as a per-session
  override, but the override can only turn the humanizer OFF, never force it on
  (helper `humanizerEnabled`). A project that set `humanizer.standard: "off"` (or
  `notes`) in its config made a deliberate project-level call that wins, per the
  founder's "a project's own instructions win" rule; the app toggle's OFF is the
  direction that matters (turning it off for speed or preference), so that is the
  direction we propagate. Chosen over a full two-way sync of app setting and
  engine config, which would add a source-of-truth conflict (who wins, staleness,
  offline) for no real gain. CTO wanted the state-consistency fix; CMO wanted the
  toggle's promise to hold where writing is most visible; this satisfies both.
- 2026-09-04: Applied the override in `bootstrapSession` (translating the app
  preference into the session's effective config) rather than adding a new branch
  in `loop.ts`, so `loop.ts` keeps `config.humanizer` as its single source and the
  daemon and bridge paths share one code path.
- 2026-09-04: Stack Health sustainability numbers are estimates, not meter
  readings, repriced from token counts at published intensities the same way
  "dollars saved" is, with the basis (`SUSTAINABILITY_BASIS`) traveling in the
  payload. Held conservative on purpose so "avoided" is a floor, not a headline;
  sources cited beside the constants in `sustainability.ts`.
- 2026-09-04: The sustainability section stays in the teal/water palette, never
  a new green, to keep Stack Health's discipline (teal means local/private,
  amber means spend) intact. Everything it counts is a consequence of staying
  local, so teal is the honest color.
- 2026-09-04: Stack Health reaches the phone by reading the paired hub's new
  member-auth `GET /stack-health` (folded on the hub, only the aggregate
  crosses), not by syncing sessions to the device. This keeps the foundation
  "the phone is a window onto that machine, never a copy." Enterprise
  admin-controlled visibility (who on a shared org may see it) is deferred as a
  server-enforced follow-up rather than shipped half-built.
- 2026-09-04: Local Library "Runs lean" (greenest) axis estimates energy per token
  from a model's on-disk size (on-device build preferred when present), a
  relative browse guide, never a measured figure. A deeper stack-level
  sustainability optimizer is captured as a follow-up.
- 2026-09-04: **Codemagic Access is a single device-local boolean**, not a
  per-target map like Terminal Control. A shell command runs on a specific
  machine, so Terminal Control keys per target; Codemagic is one cloud account
  reached by one BYO token that lives in this device's Keychain and only ever
  executes on this device (the local engine, or the phone's own client loop).
  The token is never shipped to a remote hub (same stance as projectSecrets), so
  there is no second host for an On state to leak onto.
- 2026-09-04: **The engine codemagic tool uses a pinned-host global fetch**, not
  `ctx.egress`, and is registered only when a token was delivered and not under
  egress lockdown. It sends only build identifiers to the fixed api.codemagic.io
  host and returns redacted excerpts, so it never carries project context off
  the device; the token presence (Access on) is the real gate.
- 2026-09-04: **The phone Codemagic tool loop covers every network backend.**
  StackDriver was deliberately tool-less; the loop is added only when Access is
  on, so the existing single-turn path is untouched. It runs on the Anthropic
  native-tool-use path and the OpenAI-compatible path (built-in cloud providers
  AND BYOM, via function calling; native shim on device/desktop, SSE on the
  web). On-device pocket models are deliberately excluded: they are too small for
  reliable tool use, and driving Codemagic needs the network anyway, so a
  device-only stack cannot reach Codemagic regardless. (Supersedes the earlier
  "Anthropic-only for v1" scoping from the same day.)
- 2026-09-04: Stack Health updates on a DAILY cadence, not on demand (founder).
  Removed the pull-to-refresh gesture and its hook; the app loader now serves a
  per-range result from a 24h persisted cache and only refolds on open past a
  day. An honest "Updated <when>. Refreshes once a day." line replaces the manual
  refresh.
- 2026-09-04: Enterprise Stack Health visibility (CTO+CMO agreed). The setting
  lives in DAEMON CONFIG (`DaemonSchema.stackHealthVisibility`), not Supabase:
  the data is folded on the hub and the enforcement point is the hub, so authority
  stays co-located with both (no Supabase JWT path exists on the daemon anyway).
  Enforced by a FRESH `loadConfig()` read in `GET /stack-health` (so an admin's
  toggle needs no restart), with a distinct 403 `restricted` the phone renders as
  its own state, never the unreachable card. Default is `admins` (CTO call; CMO
  argued `everyone` for the team-scoreboard story and disagreed-and-committed):
  the fold is machine-wide on a shared hub, and the legacy/solo token is implicit
  admin so default-closed still shows a solo user everything. No migration.
- 2026-09-04: Stack Health honesty fix the CTO surfaced: `computeStackHealth`
  folds EVERY session on the machine, so on a shared hub a member sees a
  machine-wide aggregate, not their own. The payload now carries
  `scope: 'personal' | 'machine'` (stamped by the route from the auth source) and
  the screen states it plainly ("Across every session on this hub. Never broken
  down by person."). Corrected the false "user's OWN usage" comment.
- 2026-09-04: Sustainability optimizer = "Run leaner" (CMO name, extends the
  "Runs lean" axis). ADVISORY and read-only for v1 (CTO): it never mutates the
  stack; a per-suggestion Apply is a fast-follow once the swap path is proven.
  Capability-parity gate is a blocker, not a nicety (CTO must-fix): a candidate is
  surfaced only when it preserves the role's capability AND clears a quality floor
  AND is meaningfully leaner, so the size-proxy energy score can never quietly gut
  the stack. One basis (`modelEnergyPer1kTok`/`SUSTAINABILITY_BASIS`), estimates
  labelled, and a cloud model is never called "greener" (the win it names is
  running a capable local peer). NO-GO on the open "greener stack for a workload"
  framing (would need a capability/benchmark model we do not have). It renders on
  the Stack Health green card, co-located with the crew data it reads, with a
  "Browse lean models" link; the CMO's Stack-screen placement + per-suggestion
  Apply is the fast-follow that pairs with the mutation path.
- 2026-09-05: Full-codebase review remediation (`CODE-REVIEW-FINDINGS-2026-09-05.md`).
  The CTO ruled the technical calls, the CFO the money and license calls; the
  founder asked that every finding be addressed. The calls, one line each:
- 2026-09-05: Member command lane is ADMIN-ONLY (CTO). `POST /sessions/:id/commands`,
  its stdin and kill routes require admin; a member's tap answers a distinct 403
  `restricted` the phone renders as its own toast, and the Composer hides
  terminal mode for a member (role read from `GET /health` at attach). A
  `daemon.memberCommandLane` switch was rejected: an ON state silently voids
  every other member gate, with no customer behind it. Both workspace path
  predicates realpath both sides.
- 2026-09-05: `bypassPermissions` on a phone-attached or headless session
  DOWNGRADES to `acceptEdits`, announced with a note, never silently and never
  refused (CTO): the person asked to be asked less, and a mode chip that says
  Bypass while shell asks would be a dishonest state.
- 2026-09-05: "Always allow in this project" for `runShell` scopes to the
  command's first word via a `commandPrefix` rule (CTO), matching every
  pipeline segment's first token exactly and never matching a shell wrapper
  (`sudo`, `bash`, `env`, `eval`, `xargs`, and kin) or a command substitution.
  Config-rule allows for shell and cloud-spend risk respect the profile's
  `allowShellAutoApprove`, not just session grants.
- 2026-09-05: A jail violation at permission-match time DENIES outright (CTO),
  never falls back to tool-only rules: the tool would throw on execute anyway,
  so an approval prompt for it is a wasted tap. Vault tools declare
  `pathJail: 'own'` because they resolve against a different root.
- 2026-09-05: The whole `daemon` config block is machine config, read from the
  global file only (CTO): a member could otherwise commit a project
  `os-code.config.json` with `daemon.outboxAllowedRoots: ["/"]` through the
  outbox into the repo the daemon runs from. A project file's `daemon` key is
  dropped with one warning.
- 2026-09-05: CORS `*` on the daemon is deliberate (CTO): bearer-gated, no
  cookies, and Electron's origin is `null` so an allowlist would be strictly
  worse. One tightening: no CORS headers on the 401 branch, so a probing page
  gets an opaque error instead of a readable fingerprint.
- 2026-09-05: Seat ceilings are enforced in Postgres by two security-definer
  triggers reading the entitlement's tier (CTO), and the bands live in one SQL
  function pinned to the TypeScript copies by a drift test. An org with NO
  entitlement row has NO ceiling today, expressed as one constant function so a
  one-line migration can change it. CFO dissent, disagreed and committed: the
  CFO recommends the Micro band (5) for entitlement-less orgs so beta teams
  never face a cliff when pay gates flip; the CTO's reasoning is that the
  roster grants nothing without an entitlement and the checkout's band check
  already forces a covering plan at purchase. The founder decides the constant.
  Per-seat Stripe quantity is DEFERRED (CFO): the SKU is flat per band, so a
  quantity change is a pricing change and a Board gate.
- 2026-09-05: Apple purchase linking keeps subscription state on `apple_links`
  and refuses a stale JWS (not newer than the last notification, or older than
  48 hours) (CTO). Live status from the App Store Server API is the follow-up
  once the `.p8` key exists; it was not made a blocker because the founder's
  Apple ops queue is already the critical path.
- 2026-09-05: An unmapped Stripe price still fails the webhook (CTO): a silent
  200 strands a paid buyer, while a 500 keeps Stripe retrying and emails the
  owner. Only prices listed in `STRIPE_IGNORED_PRICES` get log-and-200.
- 2026-09-05: Checkout treats `active, trialing, past_due, unpaid, paused` as a
  live subscription and routes to the portal; an `incomplete` subscription is
  canceled and a fresh checkout proceeds (CFO), since an abandoned 3DS
  otherwise traps the buyer.
- 2026-09-05: A magic link that arrives cold with no pending request gets a
  confirm sheet naming the address (CTO); a pending match is silent, a pending
  mismatch is refused, and a link for another account while signed in is
  refused. Refusing every unsolicited link would break the real cross-device
  flow; the sheet defeats login-CSRF because a stranger's address is visible.
- 2026-09-05: A server-pulled org membership the local account did not create
  is adopted only through an explicit "Join" sheet (CTO), never a toast, because
  adoption rewires the Team Vault target and local admin authority.
- 2026-09-05: Haptics: the global capture listener in `App.tsx` is the one
  source of press feedback for buttons, role=button, and links (CTO);
  component-level ticks inside button handlers were the drift and are removed.
  Ticks that mark gesture lift, drop, and arm stay.
- 2026-09-05: The em-dash guard is repo-wide (`git rev-parse --show-toplevel`),
  covers yml, sql, swift, toml, html, and css, and no longer exempts test files
  wholesale; only the two guard files and an archived historical review record
  carry reasoned exemptions.
- 2026-09-05: License: until the founder signs, the repo carries a
  "no license granted" notice at the root and in `os-code/`, and the four
  native plugins declare `UNLICENSED` (CTO and CFO). The CFO recommends
  Business Source License 1.1 with an Additional Use Grant mirroring the tier
  ladder (individual use free, organizational use needs a commercial plan) and
  Apache-2.0 as the Change License four years after each release; the
  founder's call, with a lawyer pass before public launch.
- 2026-09-05: ESLint 9 with typescript-eslint 8 is DEFERRED to its own commit
  after this wave (CTO), superseding the ESLint 8 line above: a lint-config
  swap changes every file's lint output and must not land under parallel edits.
- 2026-09-05: `PROGRESS.md` is restructured to one Current state, one What
  remains, and the last five log entries (CTO); older state sections live in
  `docs/progress-archive.md`, parked prompts in `docs/parked-ideas.md`, and a
  shape test keeps it under a thousand lines.
- 2026-09-05: **Model families are derived on the client, not a schema field.**
  The founder wants the store browsed by maker, then size. A `family` field on
  the catalog would need the builder to emit it and every old feed to lack it;
  a pure derivation from id, name, and source ref (`modelFamilies.ts`, ordered
  table plus a first-word fallback) groups today's feed and the bundled seed
  identically, with no schema change. If the builder ever emits a family, the
  client prefers it and keeps this as the fallback.
- 2026-09-05: **Phone packs are a layer over the stack, keyed by status, and
  name models as preference lists.** One pack per connection status (Offline,
  Offshore, Docked) fills that status's own stack through `setReasoning` and
  `placeSpecialist`, so "build your docked, offshore, and offline models" is
  literally what the packs do. A pack resolves `qwen3-4b-phone` first and
  `qwen2.5-1.5b-phone` second against the LOADED catalog, because the 4B has
  no eval yet and the curated gate keeps it out of the live feed until it does;
  a hard-pinned id would have dead-ended on the phone today. No star is
  invented: the 4B is recommended on its published benchmarks and its curation
  note, and the gate still decides whether the feed carries it.
- 2026-09-05: **"Get" never appears on a phone for a model the phone cannot
  take.** The founder's screenshot was a Get that ended in a toast. The
  control now reads "On <hub>" (the existing tailnet install) or a quiet
  "Desktop", decided by one pure helper (`installLabel`) so the hero, the row,
  and the product page cannot drift.
- 2026-09-05: **Ethics layer installed at the registry and the driver factory,
  not at call sites.** The brief asked for one chokepoint with no bypass. Five
  engine call sites reach a model (`loop.run`, `loop.summarize`,
  `Router.delegate`, the daemon `/chat`, the eval harness) and eight app ones
  across four drivers. Wrapping each would be eight chances to forget, so the
  guard is applied where the object is HANDED OUT: `ProviderRegistry` returns
  only `GuardedProvider`, and `buildDriver` returns only `guardDriver(...)`.
  Adding a call site cannot miss the layer, because there is no unguarded object
  to call. `register()` wraps too, so a test double is screened like a real one.
- 2026-09-05: **Fail-closed applies to the whole screen, but the intent check
  only runs on a candidate.** Running a classifier on every benign request and
  blocking on its failure would break Tier 3 far more often than it would catch
  harm. So deterministic rules run first; only an unresolved candidate reaches
  the intent check, and there a throw or a timeout blocks. Every other failure
  path in the screen (a bad regex, a throwing sink) also blocks, via one outer
  catch. Recorded as `check-failed` and excluded from enforcement: blocking
  because our checks broke must not terminate a person's account.
- 2026-09-05: **Tier 2 reads satire as text-vs-media.** The brief says satire and
  parody are Tier 3 and must never route through Tier 2, and also that
  synthesizing a real person's face or voice IS Tier 2. Read literally together,
  "make a photorealistic video of the president saying X, it's satire" would be
  exempt, which is the exact deepfake the product exists to reduce. The call:
  the consent gate fires only on MEDIA synthesis (image, video, voice). Writing
  satire, parody, criticism, or a written impression never reaches it, which is
  what keeps political parody out of the gate.
- 2026-09-05: **A proper name alone never means a real person, except for media
  of a person.** Treating any capitalized pair as identifiable would block
  "erotica about Sarah Connor" (fiction, Tier 3). So NCII needs a relation, an
  attached photo, or an explicit real-person marker. The one place a bare name
  counts is a request to MAKE an image, video, or voice OF that name, filtered by
  a place/organization word list so "an image of Times Square" stays Tier 3. This
  errs slightly toward the consent gate for ambiguous proper nouns in image
  generation, which is recoverable in one sentence; the reverse error is a
  deepfake.
- 2026-09-05: **Provenance is C2PA-vocabulary but UNSIGNED, and says so.** A
  signed manifest needs an X.509 certificate from a C2PA-recognized authority,
  which OpenShore does not hold. Writing a JUMBF box with no valid signature
  would produce something that reads as a real manifest and fails validation, so
  instead the record is a PNG `iTXt` chunk carrying the C2PA assertion
  vocabulary, with `signature: null` present on purpose (so a reader can tell
  "unsigned" from "field missing") and a `note` stating it is not
  cryptographically verifiable. `ProvenanceInput.signer` is the seam for the day
  a certificate exists.
- 2026-09-05: **IP bans are a proposal type, not an action.** The brief asked for
  the ability and for human review. Rather than build an apply path and gate it,
  there is NO apply function in `enforcement.ts` and none in the migration: the
  only thing the code can produce is a `pending` row, and a test fails the build
  if an apply function or an `ip_bans` table appears. Applying an approved ban is
  an operator action at the edge. Approval requires an expiry, because a
  permanent address ban outlives the person who earned it.
- 2026-09-05: **The brief said the app already logs account IP addresses for
  sync. It does not.** A grep across `supabase/` and the connect path found no IP
  logging anywhere; pairing is a local bearer token with no server-side record.
  Rather than claim collection that does not exist, `request_ip()` captures the
  address at the moment a violation is recorded, and only then. No address is
  stored for an ordinary request, and the ToU and the docs say exactly that.
- 2026-09-05: **Refusal copy is held short by test.** Two sentences maximum, no
  "unethical", no "inappropriate", no apology, no "as an AI". The over-blocking
  half of the brief is enforced the same way: a Tier 3 control set (violent
  horror, political satire, exploit analysis, legal adult fiction, dissenting
  opinion, plus ordinary coding work containing vocabulary words) must pass
  clean, with no refusal and no note added.
- 2026-09-05: The botOS brief ("clone grokbot, local-first") ships as **Crew
  routines inside My Crew** (CMO; founder agreed): "bot" reads as chatbot, and
  the roster with activity levels already existed. botOS stays the codename,
  the way gitOS ships as Repositories. Grok Bot, not the @grok chatbot, is the
  reference: always-on agents with their own computer; ours run on the
  person's own desktop and models.
- 2026-09-05: The first stab at botOS this session (a witty persona chatbot,
  `ca6f12b` on the feature branch) was built on the wrong reading of the brief
  and was DROPPED, not conflict-resolved onto main (CTO must-fix; the founder's
  "push it all to main" is honored with the real build). It stays reachable on
  the branch's history only.
- 2026-09-05: Routines run on the headless profile, and a configured
  permissions DEFAULT of allow can no longer make shell, push, or cloud spend
  silent on a restrictive profile (CTO). Headless gains
  `allowPushAutoApprove: false`; remote-attached keeps push allowed so a
  phone-attached session's behavior does not change.
- 2026-09-05: Scheduler contract (CTO): one run on the box at a time and one
  per routine; a slot the machine slept through is recorded as skipped once,
  never replayed; an unanswered approval times out to a DENIAL with a reason
  after 15 minutes; a wall-clock cap per routine (5 to 60 min, default 20) on
  top of the engine guardrails; read-only maps to plan mode, edit to
  acceptEdits; only admin-provisioned workspaces and outbox roots, for every
  caller. The workspace predicates moved to `core/security/workspaces.ts` so
  the scheduler and the daemon share one gate (re-exported from serve.ts).
- 2026-09-05: The result note is written by the scheduler itself to
  `Vault/Crew/<routine>/<stamp>.md`, not through the agent's always-ask
  vaultWrite tool: it is the run's own record, like a session journal, and an
  unattended run could never approve its own note.
- 2026-09-05: A read-risk `gitLog` tool was added so a read-only (plan mode)
  routine can review history; without it the Morning review preset would have
  needed a shell it can never get.
- 2026-09-05: One preset (Morning review, weekdays 06:00, read-only) and custom
  routines unlock after the first run finishes (CX: results must be
  reviewable in under a minute with zero mid-run prompts before anyone builds
  their own). The preset adds a Reviewer to the crew on setup so the roster
  and the routine agree on who did the work.
- 2026-09-05: A missed slot shows in the results inbox but does not push: the
  push-send function takes the approval and done kinds only, and the backend
  was left untouched in this wave.
- 2026-09-05: Founder: Personal goes to $50/yr when the gates are reinstated;
  the app stays ungated while building, so the command center carries no
  paywall yet.
- 2026-09-05: Crew routines draw one control distinction on the existing
  docked/offshore/offline reach (founder): SET UP and CONTROL require being
  docked (home reachable over Tailscale) or on the machine; VIEW is always on.
  Away, the command center serves a cached snapshot and refuses every mutation.
  Enforced purely in the app (pure crewControl in lib/routines.ts, guards in the
  store): the daemon is physically unreachable when not docked, so being able to
  reach it IS the gate, and no server-side change was needed. The snapshot is
  cached at oscode.routines.v1 so the activity dashboards render offshore.

- 2026-09-05: **Tier 2 likeness precision reworked after the CTO/CMO review, and
  the gate made non-countable.** The classifier was over-blocking coding work
  ("Docker image of Ubuntu Server" read as a person) and under-blocking the
  canonical deepfake ("draw emma watson ... photorealistic"). Fix:
  `NON_PERSON_NAME_WORDS` gained a software/infra/product/concept vocabulary; the
  two-word auto-pass now defers to that vocabulary; generation verbs (draw,
  render, paint) are caught, case-tolerant at a sentence start; and an
  all-lowercase two-word name after a generation verb is caught only with a
  photorealism cue and no scene word. Ambiguous pronouns ("they", "their") left
  PERSON_CUE (they pepper engineering prose). Per the CTO's ship condition,
  `likeness` is now NON-COUNTABLE in `countableViolations`: a false gate is a
  recoverable one-sentence speed bump, never an enforcement accrual. The brief's
  "repeated Tier 2 -> warning" is suspended until precision is field-proven
  (tracked in PROGRESS What remains). Known limit: a lowercase name with no
  photoreal cue and no other signal is not caught; a public-figure gazetteer is
  out of scope and would over-block Tier 3 more than it would catch.
- 2026-09-05: **IP captured on a BLOCK only; enforcement evaluated server-side.**
  Reconciling the CMO (cut IP entirely) and the CTO (keep violation-only) under
  their own disagree-and-commit: the CTO made the repeat-abuser safety case, so
  the resolution is keep-but-minimal. A trigger fills `guardrail_events.ip_address`
  only when `action='blocked'`; `likeness_consents` no longer carries an address
  at all (an authorization assertion is not a violation). `record_enforcement()`
  now takes no arguments and computes the ladder from `guardrail_events`
  server-side, which fixes both the reinstall-reset and the client-resettable
  ladder the CTO flagged. The "cut IP entirely" option remains the founder's to
  take later; this is the strongest honest keep.
- 2026-09-05: **ToU/Settings/README honesty pass.** "No telemetry, ever" in app
  Settings and README stated an absolute that a signed-in block record breaks;
  reworded to name the one exception plainly. ToU section 4 "immediate and
  permanent removal" softened to what the code does (flag + operator-executed
  termination + prepared report). The media-vs-text satire seam ("words are
  free, faces and voices need permission") is now stated on the app, the ethics
  page, and the ToU, per both advisors, rather than left for someone to discover.
- 2026-09-05: **Provenance no longer drops silently.** `hasProvenance` matches on
  the chunk KEYWORD (or a caBX chunk), not a substring grep of the first bytes,
  so a prompt echoed into a tEXt chunk no longer suppresses labeling; the keyword
  read is bounded so a crafted unterminated iTXt cannot throw. A Tier 2 output
  that could not be provenance-labeled (a non-PNG format) is now refused rather
  than shipped unlabeled, since the whole point of the consent gate is that the
  output carries provenance. Ordinary images stay best-effort.
- 2026-09-05: **C2PA top-line naming and full IP removal LEFT to the founder.**
  Both are pure-positioning calls the founder deferred ("refine later"). The
  honesty-critical parts (no false collection claim, unsigned stated plainly)
  are done; the taste calls are logged in PROGRESS What remains, not decided here.
- 2026-09-05: **A great 4B is the phone ceiling; we do not chase a 7B on the
  iPhone (CTO + CMO consensus, founder asked).** The honest, more premium line
  is that the newest 4B beats the old 7B class at half the memory here, and
  bigger models run on your computer. What shipped: a RAM-aware honest verdict
  (`runsWellOnDevice` in `modelStorage.ts`) that flips the product page "Where
  it runs" phone pill to an amber "better on your computer" when a model is
  larger than this phone's memory keeps free (guidance for copy, never a gate,
  the module still never returns "blocked"); the Increased Memory Limit and
  Extended Virtual Addressing entitlements as invisible reliability; and a
  memory-warning unload in the llama plugin that emits `deviceModelUnloaded` so
  the JS slot recovers. NOT built, on purpose: a "force run anyway" toggle or a
  "7B on iPhone (beta)" pack (both end in a crash we cannot stand behind), and
  llama.cpp runtime tuning (the pinned LLM.swift 3.0.3 exposes no memory knobs,
  CTO-verified). The entitlements need the App ID capability enabled before the
  next distribution build, and the native memory path needs a TestFlight device
  test; both are in PROGRESS What remains.
- 2026-09-05: **Full IP removal, decided: the founder took the CMO's original
  recommendation over the block-only compromise.** "Get rid of the IP capture."
  This supersedes the 2026-09-05 "IP captured on a BLOCK only" entry above:
  `request_ip()`, both `ip_address` columns and their fill trigger, the
  `ip_ban_proposals` table, and both admin RPCs over it are deleted from
  migration `0016` (never applied to a live database, so a plain edit-in-place
  was safe); `enforcement.ts` loses `proposeIpBan`, `IpBanProposal`, and
  `IP_REVIEW_NOTES` outright. Enforcement is account termination plus a lawful
  report, full stop, no address anywhere. Read as authorization to remove the
  entire ban-queue mechanism, not just stop populating a column, since the CMO's
  stated reasoning was "cut IP from the product story and the copy entirely."
  CMO copy applied verbatim to every affected surface (Settings, README, both
  Terms of Use, `docs/ethics-layer.md`, marketing `ethics.njk`).
- 2026-09-05: **Correction: `0016` HAD been applied to production, from its very
  first draft, before every edit above.** The 2026-09-05 entry above ("never
  applied to a live database, so a plain edit-in-place was safe") was wrong. A
  direct query against the live schema (prompted by the founder asking what to
  check before running `db push`) found `guardrail_events.ip_address`,
  `likeness_consents.ip_address`, `request_ip()`, and `ip_ban_proposals` all
  live, plus a three-argument `record_enforcement` the current app code no
  longer calls (it calls the zero-argument version, so enforcement recording
  has been silently broken in production since whichever session shipped that
  app-side change). Postgres tracks a migration by version number, not file
  content, so editing `0016` in place after it had already been recorded as
  applied changed nothing on the server. Fixed with a new migration,
  `0017_reconcile_stale_0016.sql`, rather than further edits to `0016`: drops
  every stale IP object (confirmed empty first: 0 rows in `ip_ban_proposals`,
  `guardrail_events`, and `likeness_consents`, so nothing real was lost),
  drops the stale three-argument `record_enforcement`, and recreates the
  zero-argument version the app already expects. Lesson: "has this migration
  been applied" is a question for the live database, not the file's edit
  history, and it should have been asked with a query the first time, not
  four edits later.
- 2026-09-06: **Video attachments: a model reviews frames, never the video, and
  a large clip is compressed first (founder brief).** Frames are ordinary image
  `Attachment`s, so they reuse the whole existing vision path (the + gate, the
  send filter, the cloud image block) with no new send surface. Compression to
  the 25 to 29MB band is done natively where a real primitive exists:
  `AVAssetExportSession.fileLengthLimit` on the phone (a ceiling, not a floor,
  so "under 29MB" is the guaranteed half; the floor is a quality aim, not
  enforced) and a rate-capped FFmpeg pass on the desktop. Vision stays cloud
  Claude only (`sourceSupportsVision` unchanged), so frames route there and no
  text-only model is fed images. A canvas over a hidden `<video>` is the
  universal fallback (browser, and any native gap), so a clip always yields
  frames even without FFmpeg or the plugin; on iOS the video bytes are staged
  through the app cache for the plugin to open (a native PHPicker to skip that
  is the noted follow-up). FFmpeg is invoked with an argument array, never a
  shell string.
- 2026-09-06: **Vision is a placeable Stack category, with a cloud fallback
  (founder: "vision needs to be a stack category that you can put a local LLM
  in; if there isn't one available and capable it can go to a cloud provider").**
  The category already existed ("Image reading"); what was missing was routing.
  An image-bearing turn no longer goes through the text classifier: it routes by
  capability (`pickVisionRef`) to a reachable, capable model placed in or
  anchoring the stack, else a connected reachable cloud provider that reads
  images (`cloudVisionFallback`, Claude first). Capability is honest per kind:
  cloud by catalog (`providerModelVision`, Claude always), BYOM trusted (the
  user declared it; it errors and the turn fails cleanly if the endpoint cannot),
  device false, because the on-device runtime (LLM.swift) is text-only, so a
  local model placed for vision falls back to the cloud until a multimodal
  runtime lands (one line in `visionCapable` to flip). `StackDriver` now accepts
  attachments (it silently dropped them before) and folds frames into the
  Anthropic and OpenAI-compatible backends only, never the device backend. A
  vision turn does not use the specialist-to-reasoning fallback, since
  routeVision already picked the best reader and the anchor may not read images
  at all. The composer attach button lights for a "My Stack" chat via
  `stackVisionReady`, which mirrors the routing plus the connected-cloud
  fallback so the button is honest.
- 2026-09-06: **Vision gets two slots (local + cloud) with per-slot effort, and
  My Stack is the single source workflows inherit (founder).** "Assign a local
  model to vision and a cloud model. Choose the model/effort in my stack and
  preset for workflows. Default that position to most capable cloud model until
  manually adjusted." Implemented additively over the existing placement model:
  Vision is still one category, but the manager (`StackManager`) presents it as
  two slots split by ref kind (`visionSlots`: device/BYOM = local, cloud =
  cloud), each an ordinary vision placement. `Placement` gains an optional
  `effort` (honored in `StackDriver.systemFor` over the global composer effort),
  settable on any specialist, so Vision effort needed no special field. The
  cloud slot shows the most capable cloud model (`defaultVisionCloudRef`, Opus)
  as its default and routes to it via the existing cloud fallback until a person
  assigns one; assigning writes a real placement. Local is preferred over cloud
  in `pickVisionRef` when it can actually read images (a BYOM vision model does;
  a device model does not yet, so it falls back). On the "preset for workflows"
  fork the founder chose "My Stack is the source; workflows inherit" over a
  per-routine override or extending the published catalog-preset schema, so no
  new surface was added: a workflow that runs through the stack uses whatever the
  Vision position holds. Not built: a per-routine Vision override and a
  catalog-preset Vision role (both deferred to the founder's call above); the
  desktop-engine routine path uses the engine's own router, so inheriting the
  app stack's Vision position there is a separate cross-repo follow-up.
- 2026-09-06: **The plan-first workflow, built additively over the existing
  stack driver (founder brief; four picker decisions).** The founder specified
  the whole flow: prompt through the harness, framing by the reasoning LLM
  (clarify only when ambiguous), a play of dependency-ordered handoffs to
  specialist models, a live brief of steps and owners, hybrid execution that can
  re-plan, then a streamed synthesis. Decisions taken: app-native with engine
  handoff for repo/tool steps when docked; hybrid re-plan (pre-composed, can
  revise mid-run); ask only when ambiguous then auto-run (no approval gate);
  build the whole flow now; and "My Stack is the source, workflows inherit" over
  a per-routine override or a catalog-preset schema change. Built additively:
  the plan-first path sits on top of the existing single-turn backends, and the
  flow degrades to a single routed turn whenever the anchor is weak/unreachable,
  the plan will not parse, or the play is one step, so no working foundation was
  renovated. The brief reuses the todos event (TodoItem gained an owner field)
  rather than a new protocol event, so the chat's existing TodoCard renders it.
  A step may target a specific model by id (level-deeper routing) in addition to
  category routing; the planner is shown the targetable models and their placed
  subjects. Deferred, and stated as follow-ups in docs/workflow.md: the tappable
  clarify picker (questions render as chat text today), engine execution of a
  repo/tool step from this flow (marked and described today), and the same play
  flow on the desktop-engine routine path (routines use the engine router).
- 2026-09-06: **The three workflow follow-ups, ruled by the CTO (founder
  delegated the forks: "ask my CTO what to do").** (1) Clarify picker: a
  `clarify` driver event renders a `ClarifyCard` with tappable option chips;
  tapping sends the reply, which the driver folds back into the framing.
  Straightforward, no fork. (2) FORK A, engine execution of a `needsTools` step
  when docked: CTO ruled to open ONE real daemon engine session per play (bound
  to the chat's local workspace via `firstWorkspace(repoIds)`), run each tool
  step through the existing `RemoteDriver`, and surface the engine's real tool
  approvals in the chat, never auto-answered. Reuse, do not rebuild; do not use
  the tool-less `/chat` path; share one session/cwd across tool steps. Must-fixes
  applied: `StackDriver.answerApproval` is now a real pass-through to the engine
  session; abort aborts the engine turn and settles the awaited step; the session
  defaults to `acceptEdits` (in-jail edits flow, shell/push/cloud stay loud);
  `projectSecrets` are never sent to the docked session; every failure (not
  docked, no bound workspace, a 403 for a member) degrades to describe-only.
  Blast radius as the CTO scoped it: `stackDriver.ts` + one `StackContext` thread
  in `store.ts`, reusing `remoteDriver.ts`, no daemon/engine change. (3) FORK B,
  the play flow on the routine path: CTO ruled to KEEP the engine's ReAct loop
  and NOT port `play.ts` (a headless routine must never block on a clarifying
  question, and porting would create two planners to keep from drifting, a
  foundation renovation). Instead capture the loop's own `todoWrite` in the
  scheduler's `onEvent` and write it as a Plan section in the routine's vault
  note, no extra model call, no regression to the approval-free first run. Blast
  radius: `os-code/src/routines/scheduler.ts` only.
- **Voice mode uses native OS voices, not Claude's cloud TTS** (founder asked
  "what does Claude use?"). Claude streams a cloud voice service (online only)
  and a chosen human voice would sit against our own Tier 2 likeness gate. Native
  `AVSpeechSynthesizer` (and `speechSynthesis` on desktop/web) is on-device,
  offline, free, premium (Apple's downloadable neural voices), and generic (no
  likeness synthesized). A bundled cross-platform neural engine is a later seam
  behind the one TTS interface, not a day-one need.
- **Voice mode inherits the chat's access; no separate voice preset** (founder,
  2026-09-06: "if access is turned on for the chat, voice control gets the same
  access"). Voice is always available offline; a voice-triggered action flows
  through the same `send` and approval path as a typed one, so its reach lights
  up exactly when the chat's does. Rejected the earlier idea of a "voice coding"
  preset that flips Terminal Control and pairing on together.
- **The break policy: conversation stays in voice, authorization and visual
  selection break to the screen** (founder chose "answer as much as possible by
  voice", tempered by the original "a picker means go back to the screen").
  Clarify and plan are answered by voice; tool/terminal and cloud-spend approvals
  and the stopped-turn recovery hand back to the chat. One table
  (`VOICE_BREAK_POLICY`) so it is a one-line change to move a row.
- **Reopen only after an approval clears; a plan revision and a stopped-turn
  recovery do not auto-reopen.** Approvals have a clean resolved signal
  (`pendingApprovals` empties); a revision or a retry deliberately puts the
  person in the composer, and auto-reopening voice would cover the recovery UI.
  The voice button reopens it when they want it.
- **Listen and speak are mutually exclusive; the orb is tap-to-interrupt.** No
  echo cancellation is assumed, so the mic is off while a reply speaks. True
  always-open barge-in is a later refinement, noted in the doc.
- **The `oscode-tts` plugin is registered in `app/package.json` only, not in the
  CLI-managed `CapApp-SPM/Package.swift`,** mirroring how `oscode-media` was left
  for `cap sync ios` to wire. Verifying `cap sync` links it is a device-side
  follow-up in PROGRESS.
- **Repo OAuth on iOS uses `ASWebAuthenticationSession` (new `oscode-authsession`
  plugin), not Capacitor Browser + a deep-link bounce (founder, 2026-09-07).** The
  founder asked for a one-tap connect. ASWebAuthenticationSession runs the consent
  and, watching for the `oscode` callback scheme, returns the callback URL
  straight to the completion handler: no bounce-page "Back to OpenShore" tap
  (iOS blocks that page's automatic custom-scheme redirect without a gesture) and
  no deep-link round trip that a memory eviction could drop. Desktop keeps the
  system-browser + deep-link path (ASWebAuthenticationSession is Apple-only). The
  cold-start deep-link recovery stays as a harmless backstop. Device verification
  (and that `cap sync ios` links the plugin) is a follow-up in PROGRESS.
- **A Swift Package's product name must match `cap sync`'s naive capitalize-first-
  letter-per-segment transform of its npm package name, not readable PascalCase
  (found via a real Codemagic failure, 2026-09-07).** `oscode-authsession`'s
  `Package.swift` named its product `OscodeAuthSession` (capital S, treating
  "auth" and "session" as two words); `cap sync` instead derives
  `OscodeAuthsession` (capitalizing only the first letter of the whole
  "authsession" segment, since the npm name has no hyphen there), so
  `CapApp-SPM/Package.swift` asked for a product `OscodeAuthsession` that did not
  exist, and every build failed at SwiftPM's package-graph resolution with
  "product 'OscodeAuthsession' ... not found in package 'OscodeAuthSession'" (an
  error Codemagic's `xcode-project` CLI does not surface; found only by adding a
  plain diagnostic script step that runs `xcodebuild` directly, since plain
  script steps print output verbatim). Fixed by renaming the package and
  product name (only) to `OscodeAuthsession`; the target name and the Swift
  plugin's `jsName`/`identifier` are a separate, unrelated JS-bridge lookup and
  keep their readable casing. Lesson for any future oscode-\* plugin whose npm
  name's suffix is itself multi-word with no internal hyphen (matching this
  repo's plugins is the same instinct that produced the bug): either hyphenate
  the npm name (`oscode-auth-session`) so `cap sync` PascalCases each word, or
  verify the Package.swift's product name against `cap sync`'s actual output
  before shipping, never against what reads well.
- **The repo-oauth `/callback` returns an HTTP 302 to the `oscode://` scheme for
  iOS, not just a JavaScript redirect (found via a real one-tap connect,
  2026-09-07).** ASWebAuthenticationSession uses `WKNavigationDelegate` and
  completes only when the web content navigates to the callback scheme through a
  network-level redirect it can intercept; a `window.location` redirect runs
  inside the page and is not reliably captured (confirmed against Apple
  Developer Forums and an Apple engineer's reply), which left the person on the
  "Returning to OpenShore" page. So `/callback` now sends a 302 with
  `Location: oscode://repo-oauth?...` when the request is iOS (User-Agent carries
  iPhone/iPad/iPod, or `state` ends with ".r", which the iOS app now appends for
  the iPad-desktop-UA case); the HTML page with its manual button stays as the
  302's body fallback and as the full 200 response for desktop, where a real
  browser runs the JS redirect. Query params (`?code=...`), never a fragment
  (`#`), since fragment callbacks are the one shape the forums report as flaky
  to intercept. This is a server change: it takes effect on
  `supabase functions deploy repo-oauth`, with no new app build, so it fixes the
  already-installed one-tap build.

- 2026-09-09: **"Agentic Currents" is the name; "Layers" is retired.** The CMO and
  Creative Studio's call (founder agreed): "Layers" names the mechanism, not the
  feeling, and carries Photoshop and network baggage. "Currents" is water in
  motion through the familiar app, and the founder's own "connected throughout"
  is the promise. "Frontier" stays reserved for cloud models on a paid key, so
  the two axes never blur.
- 2026-09-09: **Wayfinding, not Navigation, for the default-on group.** The
  side panel is already "the main navigation" in the codebase and the haptics
  rules, and a settings group named Navigation would read as getting-around-
  the-app settings. Memory, skills, and a browser are how the agent finds its
  way. Founder picked Wayfinding.
- 2026-09-09: **One Agentic Current at a time, everywhere** (founder; the
  first cut is one modality as one idea, lifted later if wanted). Encoded as a
  single `agenticCurrent` id rather than a map of booleans, so exclusivity is
  structural and switching is one write.
- 2026-09-09: **The arrival is a gesture, not a progress bar** (founder: yes,
  the gesture). A few hundred milliseconds on the door clock and the glide
  curve, then the row's own state line says whether the box answered. Nothing
  "installs" on a phone; the copy says connect.
- 2026-09-09: **The water-line is persistent and faint on every screen** while
  a current is on (founder), which is what makes the modality feel whole
  without any room changing shape.
- 2026-09-09: **One decisive haptic at the border, never a run of ticks.** The
  haptics ruling on file allows marking a decisive commit and bans component
  ticks; a multi-tick pattern would read as a notification buzz, not calm.
- 2026-09-09: **Vellum and OpenAGI ship as Arriving rows now** (founder: try
  to find a way to connect them). Neither documents a network API (Vellum's
  README names an SSE stream and tunnel access but no endpoint; OpenAGI is an
  in-process Python framework), so their rows say so and accept an address:
  the probe tries an A2A agent card first, then an OpenAI-compatible `/v1`,
  and remembers which answered. Full opacity, an Arriving pill, never
  disabled-looking, per the roster ruling.
- 2026-09-09: **A2A is both the seam and a named row.** The generic door
  (`askAgent`, a tolerant JSON-RPC `message/send` client) serves any agent
  with a card, Hermes and Vellum included when they expose one; the named row
  is the "connect any agent" entry.
- 2026-09-09: **A current's handle rides to a remote hub; the Codemagic token
  does not.** A current names a box or a CLI the person chose to reach from
  the hub (a Hermes box on the tailnet, a CLI on the hub itself), and its key
  is that box's own key, not a secret bound to this device. So `currents`
  goes in the daemon session body, unlike `codemagicToken`.
- 2026-09-09: **A current tool never registers under egress lockdown, and a
  CLI handle is honored only when the CLI is really on PATH** (checked on the
  daemon and the desktop host alike), so a session never carries a tool that
  cannot run.
- 2026-09-09: **Hermes memory is read-only and jailed.** The daemon serves
  only `MEMORY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, and `skills/**/SKILL.md`
  under `HERMES_HOME` (default `~/.hermes`), through the same `Jail` the repo
  reader uses, size-capped, admin-only on a shared hub. Config, sessions,
  credentials, and plugins are never listed: not knowledge, and some hold
  secrets. Editing stays with Hermes and the vault's always-ask write.
- 2026-09-09: **A current's bench model is a BYOM-shaped ref keyed
  `current-<id>`.** It places and runs through the unchanged BYOM path, its
  key lives under the same secret slot the BYOM path reads, and turning the
  current off purges it from every status's stack (the disconnectByom sweep,
  shared). Placements are not kept across an off/on, on purpose.
- 2026-09-09: **Rooms never name a current.** They render the active current
  only through `activeContribution`; `app/test/currents.test.ts` greps the
  source and allows the proper nouns only in the core, the probe, the guides,
  the Settings screen, and the connect sheet. This is what makes "off leaves
  no trace" a fact.
- 2026-09-09: **The BETA badge is on the group, the exit condition is per
  current** (a contract test passing, device and paired-computer
  verification, no open must-fix). The founder deferred whether the pill
  moves down to the rows that are still rough once one graduates.
- 2026-09-14: **The premium harness starts as a pure discipline seam, not a
  loop rewrite.** Per the CTO and Chief of Staff, step 1 ships `profile.ts`
  (model-class derivation) and `decoding.ts` (the tool-or-answer union schema)
  as pure, tested modules behind config, wired only into `osc eval`, before any
  `loop.ts` change, so the loop is never rewritten twice and the class is
  something to score. Loop wiring is gated on eval numbers.
- 2026-09-14: **Model class is derived from size first, name hint next, on-disk
  size next, then the eval score only as a size-unknown tie-break.** The class
  is a resourcing decision; a 1.5B that scores well is still a 1.5B, so the
  eval score never overrides a known size. A cloud model is always the large
  class. Size-unknown defaults to small so the discipline is applied, not
  skipped.
- 2026-09-14: **Constrained decoding supersedes the 2026 "grammar is a repair
  tool, not a default" line for small local models.** The tool-or-answer union
  schema (`decoding.ts`) has a `say` branch, so a permanent constraint no longer
  forbids prose, and each tool branch carries its own argument schema so a
  constrained call validates. On by default for tiny and small (config
  `harness.decoding.constrainForSmallModels`), and only when the backend
  supports grammar; the eval decides per family whether it is a lift or a tax.
- 2026-09-14: **Auto-place (renamed from "LLM Auto-Source" by the CMO) fills a
  gap with a LOCAL model only, never the anchor, never under a secrets
  lockdown; every download and every cloud call is a card the person taps.**
  All eight advisors agreed downloads always ask, over the proposal's first
  draft. The founder's call.
- 2026-09-14: **The phone runs the harness in two layers.** Docked, it gets
  every new card through the engine path from the Claude Code moment; alone, it
  runs the pure core for phone-sized work, built last and gated on desktop
  parity plus a device pass. The founder's "phone feels like Claude Code in V1"
  applied without reversing "long work runs off the phone".
- 2026-09-14: **Frontier-level coding from a local model is reached by the
  oracle, not by a bigger prompt.** The founder's north star (code like Sonnet 5
  or Opus 4.8 from a decent local model, better with more context) is pursued
  in this order: the strongest local model the hardware allows, verify IN the
  loop (a failing check goes back to the model, bounded), best-of-N judged by
  the project's own tests, the discipline seam, the hand to a frontier model on
  the person's key, then lessons. The frontier reference run is the scoreboard,
  not the mover; every lever ships gated on the one-try and best-of-k numbers
  from `osc eval --deep --attempts`.
- 2026-09-14: **A failing verify is an observation, not a verdict, while a
  retry remains.** The loop hands the exact output tail back with one plain
  ask and continues, at most `harness.verify.maxRetries` times (default 2,
  zero means report only), under the same step and dollar rails, and the model
  is told not to claim a pass (the harness runs the check and reports). The
  `verify` event grew `round` and `willRetry` so the last one is the verdict.
- 2026-09-14: **Best-of-N is measured before it is built.** Eval v2 runs
  independent tries per task in fresh workspaces and reports one try next to
  best of n; a best-of-N picker in the loop (which needs checkpoints) is built
  only if that gap says it pays on the reference machine.
- 2026-09-15: **Native tool mode falls back to text tool calls.** A small
  local model offered native tools often writes the call as JSON in its text
  (ollama hands it back as content, not `tool_calls`), and the loop used to
  read that as a final answer and complete the task with nothing run: the 3B's
  0% on the reference box, "1 turn; no tools called; done: complete". Now, when
  no native call arrives, native mode runs the same conservative text extractor
  text mode uses, records that turn the text way (never a fabricated
  tool_use), and runs the tool; prose that quotes JSON stays prose, and an
  unknown tool name goes to repair. This is the harness doing the mechanical
  work for a small seat (tenet 3), and it is what turns the CPU floor from a
  timeout into a measurable baseline.
- 2026-09-15: **When a fix might not have worked, verify on the box before
  guessing the next one.** A byte-for-byte identical failure after a fix
  looked like a stale build; before proposing a fourth fix, the founder
  confirmed live (`git log`, `grep dist`) that the new commit and its string
  were both actually present. That ruled out staleness and pointed at a real
  gap in the diagnosis itself, not the model: `wrote` in `DriveTrace` was
  flagging any successful tool call, not a write-risk one (mislabeling a
  read-only answer task), and the trace never carried a failed call's own
  message, so "no write landed" could not distinguish a content mismatch from
  a format problem. Strengthening the eval's self-diagnosis, not another
  guess, is the harness's own rule (`osc eval` is the spine) applied to itself.
- 2026-09-15: **A failed edit echoes the file's own current content, bounded.**
  The 3B deep eval showed the real cost of a hint-only failure message: it
  resent an identical, non-matching SEARCH block four times and tripped the
  loop guardrail, because "re-read the file" is advice a small model does not
  reliably act on across a tool round trip. `editFile.ts` now includes the
  file's current content (capped at 4000 characters; past that, it says to
  call readFile) directly in the failure, so the next turn can copy the exact
  lines without a second read. This is retrieval the harness does for the
  model, per tenet 3, not a change to the edit-matching strategies themselves.
- 2026-09-15: **The matcher forgives how a line is spelled, never where it
  lands.** Once the 3B produced real blocks, every edit still failed on "SEARCH
  text was not found": inside a JSON string it swaps quote styles and spacing
  on lines like a template literal. Two bounded strategies: a spelling-tolerant
  match (whitespace collapsed, the three quote characters made one) that still
  requires a unique run, and anchoring on a unique first-and-last pair with the
  middle allowed to drift, since two independent lines pin the location and the
  REPLACE side overwrites that region regardless, with the diff shown and
  verify after. Several candidates still demand a strong, unique middle, and
  otherwise it is ambiguity, an error, never a guess.
- 2026-09-15: **editFile accepts the shapes small models actually produce.**
  Four deep-eval rounds on the reference box ended at "No valid edit blocks
  found": a 3B never once produced the SEARCH/REPLACE mini-language inside a
  JSON string. Rather than teach it harder, the tool now takes a flat `search`
  - `replace` pair first (plus the aliases other tools taught models), a JSON
    array of pairs or that array stringified, and loosely fenced markers, all
    normalized to the same blocks and the same exact / whitespace / anchored
    matcher, so nothing gets looser about WHERE an edit lands. A failure echoes
    what the model sent. And a lean seat that answers with a code block while
    changing no file is nudged once to make the change. Tenet 3: the harness
    meets the model where it is; the eval decides if it was enough.
- 2026-09-15: **North star: a five-year-old MacBook should feel as powerful as
  running Claude-grade models on a local stack (founder).** State-of-the-art
  hardware buys headroom and options, never entry. The feeling is delivered by
  the harness (retrieval, the project's own tests run and fed back, best-of-N by
  those tests, a hand to a frontier model on the person's key only when needed),
  never by pretending a small local model is a frontier one; the copy stays
  honest (tenet 2). Recorded in `docs/premium-harness-proposal.md`.
- 2026-09-15: **The reference machine is the lowest common denominator, on
  purpose (founder).** The founder's box is older, slower, and CPU-only (no
  NVIDIA driver, `ollama ps` reads 100% CPU; a 7B prefills at about 6.7 tok/s
  and generates at about 3.4 tok/s). Almost nobody who runs OpenShore will have
  a slower machine, so a harness that feels premium here feels premium
  everywhere, and a GPU only lifts it. Measure the floor on this box first and
  build for it. This is also why qwen2.5-coder:7b timed out the deep eval on the
  agent-loop (native tools, buffered, big prompt) while a one-shot answer was
  fine: the loop is the hard case, and the fit is a smaller local seat (a 3B or
  smaller) for a CPU box, which the harness should place automatically.
- 2026-09-14: **A lean seat gets a lean prompt: fewer tools and a compact
  standards digest.** The discipline seam wired into `loop.ts` (gated by
  `harness.profiles.enabled`, default on) shows a tiny/small class only its
  `maxToolsShown` tools (core-first, so readFile/editFile/writeFile/grep survive
  the cut) and replaces the full UX and humanizer standards (about 17KB) with a
  one-line digest that names the bar. mid, large, and the off path keep every
  tool and the full standards. This is not cosmetic: on a modest box the full
  prompt made a 7B time out during prefill (0% on the deep eval), so the lean
  prompt is what lets a small model run the loop at all. The premium bar is
  still held mechanically by verify and structure (tenet 3). The union decoding,
  per-class context budgets, and maxCallsPerTurn are the remaining seam pieces,
  each to land gated and measured.
- 2026-09-14: **The stream idle guard has two windows: prefill and inter-token.**
  Waiting for the first token is prefill, and a cold local model reading a large
  agent-loop prompt on a modest box (small GPU or CPU) can take minutes before
  it speaks; killing it then fails exactly the hardware OpenShore serves. So the
  first-byte window is generous (default 300s) and the inter-token window is
  tight (default 120s), both in `resourceBudget` and never first-byte shorter
  than inter-token. This was found by the self-diagnosing deep eval: qwen 0% was
  a 120s prefill timeout, not the model. `osc eval` is the spine, and it caught
  a harness bug that the three-probe eval (tiny prompts, fast prefill) hid.
- 2026-09-14: **A frontier reference run is a deliberate tap, once, up front.**
  `osc eval --deep` never spends on a local model; naming a cloud provider and
  model on the command line asks one terminal question (count of runs, on your
  key, default No, `--yes` for scripts) and only then does the approver say yes
  to the loop's cloud-spend prompts. The model under test sits in the
  orchestrator seat for the run with escalation off, so a benchmark measures one
  model.
- 2026-09-14: **Pricing when the beta gates return (CFO-ruled, a Board gate):**
  Personal $50/yr, Micro $100, Small $250, Growth $500, Scale $1000, the $20
  dropped from the site. Not harness work; new Stripe price objects, never a
  repriced id.
- 2026-09-14: **Perplexity is NOT an Agentic Current.** A Current is an
  exclusive agent runtime (one at a time, "runs on a computer you own"),
  which would force research to be mutually exclusive with Hermes/CLI and
  make the honesty copy false for a SaaS on a key. So it splits: Sonar is a
  cloud provider (a placeable model, `providers.ts`), and Research is a
  default-off, key-gated Wayfinding row that reuses the Perplexity provider
  key (`resolveSearchKey`, no second key to paste). CTO and CX both ruled
  this over the founder's first "it's a layer, put it in Currents" instinct.
- 2026-09-14: **Perplexity Computer was dropped, not deferred into Currents.**
  It runs on Perplexity's own models and cannot be driven by a local model, so
  it cannot serve the goal of computer capabilities for local models; that is
  OpenShore's own harness to build (the stubbed Wayfinding Browser), with
  Perplexity at most an optional cloud backend later.
- 2026-09-14: **Engine Perplexity search reads its key from the env on the box,
  not from the app toggle over the wire.** The `perplexity` search backend is
  config and env driven like Brave and Tavily (`search.backend` +
  `perplexityKeyEnv`), so a paired or headless session grounds in Sonar without
  a provider key ever riding a session to a remote hub (the provider-key
  ruling). The app's Research toggle governs the app-side (on-device) path
  only; a docked user sets `search.backend` on the desktop deliberately, so
  auto-syncing the toggle to the engine was intentionally not built.
- 2026-09-14: **The arrival is a replica of the iOS Siri glow, in the brand's
  water** (founder, from a screen recording read frame by frame: a bloom from
  the pressed edge, a thick multi-hue ring with an inward glow, settling to a
  thin drifting ring). Never Siri's pink and purple: the palette is deep water,
  water, shore teal, a light aqua for the highlight, and the amber counterpoint
  (`--current-1..5`, per theme). The ring is a masked frame whose conic gradient
  rides a rotating square (transform only); the bloom is a plain gradient (a
  large blurred element janks a WebView); the glow is the one blurred layer and
  lives only through the flourish. The persistent water-line became the same
  ring, thin and faint, breathing, so the hand-over is seamless and the
  modality reads whole. Supersedes the 2026-09-09 radial wave and thin border.
- **Project room, work-first over a config-form stack (2026-09-15, CTO +
  Creative Studio + CX).** The room now leads with the work (a premium cover
  with the primary action, then chats with a resume card) and demotes the
  context (instructions, repos) and roster below it, reversing the old order.
  A light paper cover with a water wash was chosen over a dark `cc-hero`-style
  band so the shared-element title still lands on ink, and over a Work/Context/
  Team tab split as heavier than a room this size needs. Presentational only,
  no store or gate change. Review in `docs/design/project-room-redesign.md`.
- **Stack page, legible-system rebuild scoped to the phone (2026-09-15, CTO +
  Creative Studio + CX).** The audited screenshot was the phone `StackManager`,
  so the redesign landed there: an anchor cover for the Reasoning LLM, a
  Specialists group with category tags, a Bench of reserves, and teal/amber
  location chips on every model. Presentational only, no store or gate change.
  The desktop `StackScreen`/`StackHealthScreen` "Quarterback" vs "Reasoning LLM"
  vocabulary split was surfaced as a separate founder-gated copy sweep rather
  than folded in. Review in `docs/design/stack-page-redesign.md`.
- **Vault empty state stops reusing the chat `.greeting` (2026-09-15, CTO +
  Creative Studio + CX).** The shared `.greeting` is `position: fixed` and
  `pointer-events: none` on touch by design (a chat backdrop), which made the
  Vault's empty state float over the page and its button untappable on a phone.
  The Vault now uses in-flow blocks: a new-user onboarding ramp for the empty
  personal vault (Obsidian-style, teaching what it is and how the agent uses
  it), and plain notice cards for offline/empty-team. `vaultCreate` gained an
  optional `content` arg so a seeded welcome note opens in read mode. Review in
  `docs/design/vault-page-redesign.md`.
- **My Crew advisor preset reframed to project-agnostic advisors (2026-09-15,
  founder).** The shipped crew read as a startup C-suite (CTO, CMO, CFO, Board,
  ...). Renamed to general advisors that keep the business abilities (Technical
  Advisor, Marketing Advisor, Finance Advisor, Research Advisor, Coordinator,
  Sounding Board, Strategy Advisor; Creative Studio kept), personas rewritten to
  advise on whatever a person is building rather than a company. Activity shape
  unchanged. Also fixed a command-door overlap bug (inline spans to a flex
  column). The repo's own dev-process references in CLAUDE.md keep the C-suite
  titles for now. Review in `docs/design/crew-page-redesign.md`.
- **Quarterback renamed to Reasoning LLM, and the greeting sweep (2026-09-15,
  founder).** The founder rejected "Quarterback" ("either just reasoning or
  something like Anchor"); the user-facing term is now Reasoning LLM everywhere
  (matching the phone), across the desktop StackScreen and StackHealth, the
  Library intro, the Harbor and guide copy. Separately, the fixed-overlay
  `.greeting` was swept off the last non-chat screen: the project memory view's
  empty/error/not-set-up states now use the shared in-flow `.empty-notice` card
  (renamed from `.vault-notice`), so only the chat keeps `.greeting`.
- **Edit matcher gains a fragment strategy; a blank SEARCH is redirected before
  it, not inside `locate()` (2026-09-15, deep-eval round six).** The 3B seat's
  rename-across-files task sent a bare fragment ("function oldName(") instead
  of a whole line. A single-line SEARCH that occurs exactly once as a substring
  anywhere in the file is now spliced in place rather than rejected, gated at a
  6-character minimum so a stray brace or paren never matches by coincidence
  (the number is a judgment call, not an eval-measured cutoff, and can move if
  a real fragment shorter than that turns up). Separately, the add-a-function
  task sent a block with search left blank (an append with nothing to anchor
  on); that is now caught in `editFile.ts` before `applyEditBlocks` runs at
  all, since the matcher's own empty-string message has no room to show the
  model's REPLACE text or the file to anchor on. Neither loosens WHERE an edit
  lands: both still require a provably unique location. Tests in
  `test/editMatchRelaxed.test.ts` and `test/editFileToolTrace.test.ts`.
- **The deep eval runs each task's own check as verify in the loop
  (2026-09-15, deep-eval round seven).** A real project's tests run after a
  change and the harness feeds a failure back (verify in the loop, tenet 3);
  the eval's edit tasks now carry the same check as a plain `.eval-check.mjs`
  in the workspace and the loop runs it, so the harness feature under
  measurement is exercised by the benchmark. Scoring is unchanged and
  independent (`check`), the check prints a FAIL line naming what is wrong
  (an exit code alone told the model nothing), and the trace line reports the
  verify rounds so the number is read with that in view. Not cheating the
  eval: the check is the project's test, which is exactly what the harness
  is for; a model that cannot fix against a failing test still scores zero.
- **An exact repeated call is answered from the record; the third repeat makes
  the next turn answer-only (2026-09-15).** Skipping applies only when no
  successful non-read call happened in between (a write or a shell command
  makes the same call a fresh question), so a legitimate re-run of tests
  after an edit is untouched. Applied to every seat, not only lean ones: a
  model repeating one exact call three times is stuck whatever its size, and
  an answer is strictly better than the repeat rail's empty stop, which stays
  as the backstop.
- **A lean seat gets a short core prompt, not the desktop etiquette
  (2026-09-15).** The interaction-model lines (ask before a change that
  touches working code, todoWrite first, propose standing instructions) are
  written for a capable model working with a person; a 3B reads them as the
  task and explains or asks instead of editing. The lean core keeps the role,
  the workspace, the tool shapes, "never ask, make the change", "answer
  briefly, a value alone when asked for a value", and the em-dash rule.
  Standing instructions, memory, secrets, and the UX digest still ride in.
- **A malformed-call escalation failure names its own cause (2026-09-15,
  deep-eval round eight).** The generic sentence ("kept producing tool calls
  that could not be parsed") gave no way to tell what a model actually sent
  without a second, differently-instrumented run. The last turn's own parse
  problem (`parser.ts` already produces a specific schema-mismatch or
  unknown-tool message) now rides in the same `task-done` message, which is
  also what the eval's trace line prints, so the next 0% on this path is
  diagnosable from the one run that produced it. No new plumbing: the message
  already existed per-turn, it just was not being read on the way out.
- **The no-write nudge also fires on a failed-and-abandoned edit, not only a
  code-in-the-reply answer (2026-09-15, deep-eval round eight).** The
  original nudge watched for a fenced code block in the final answer; the
  eval's fix-bug task showed a case it missed, three failed `editFile`
  attempts followed by a plain-prose "done" with no code shown at all. A new
  `attemptedWriteThisTask` flag (set whenever a write-risk tool is tried,
  landed or not, including a stale-repeat skip of one) gates the second
  trigger, so a task that never needed an edit still trips neither tell.
- **The matcher gains a flattened whole-file strategy for a squished
  multi-line block; the lean core is told not to reach for git (2026-09-15,
  deep-eval round nine).** A 3B seat joined a real three-line function body
  with spaces instead of line breaks, which no line-based strategy can match
  regardless of spelling tolerance, since they all compare a fixed number of
  whole lines. Both sides are now flattened the same way (each line
  normalized, joined by one space per line break) and the SEARCH is looked
  for as a unique substring of the whole file's flattened form; a hit still
  maps back to a real line range and applies as an ordinary whole-line swap.
  Deliberately does NOT bridge an actual content difference (the same run's
  SEARCH also carried a stray semicolon the file does not have anywhere),
  which stays a refusal, pinned by its own test: flattening forgives how the
  lines were broken, never a fact about what the file contains. Separately,
  the same run showed the model going looking for git tools (`gitStatus`,
  then a hallucinated `gitAdd`) on a task that never asked for version
  control; the lean core prompt now says plainly not to, since most tasks
  need none of it.
- **The 3B deep-eval cycle closes at 25% (2026-09-15, round ten).** The
  first non-zero number on the reference box (create 100%, the rest 0%),
  recorded as the small-class floor rather than chased further: every
  harness gap the traces showed across ten rounds is fixed and pinned, and
  the remaining misses (a one-line rename left undone with the correct line
  in view, and 20 \* 2 + 2 answered as 82) are the model, not the harness.
  Not tuned to the tasks: no fixture-specific rule was added at any point,
  each fix generalizes (tool shapes, matcher tolerance, repeat handling,
  verify in the loop). The next number comes from a stronger local seat on
  the same command, not another harness round.
- **The deep eval lets a plain `node` command run; the answer task is run,
  not reasoned (2026-09-15, round eleven).** The seat answered 20 \* 2 + 2 as
  82, 84, 16 across runs, and a coding agent asked what code returns should
  execute it (tenet 3). The eval stays hermetic in every other respect: only
  `node ...` with no chaining, redirection (an arrow's `=>` allowed, a bare
  `>` not), substitution, or `..`, the same trust the verify step already
  extends by running the task's own check with node; every other shell and
  any push are still refused. Not tuning to the task: any real project's
  agent has a shell, and the lean core's "run it" line is general.
- **A flattened match keeps the text outside it on its boundary lines
  (2026-09-15, round eleven).** The first cut swapped whole lines and could
  drop a prefix such as `export function `; the structural check caught the
  broken result, which is exactly what it is for. The prefix and suffix are
  mapped back to the original spelling, and when that cannot be done exactly
  the match is refused rather than guessed.
- **Verify retries are per model class (2026-09-15, round eleven).** Small
  and tiny seats get four goes at a failing check, mid and large two; a
  project's `harness.verify.maxRetries` can only raise the number. The 3B
  came within one line of a two-file rename at three checks; the lean seat
  converges in small steps and the step rails still bound it.
- **The structural check guards the proposed content, and writeFile has it
  too (2026-09-15, round twelve).** `node --check <path>` was checking the
  file before the edit, so a corrupting edit landed and only the next one
  was refused; the deep eval left `greeter.mjs` as `(name) {`. The candidate
  now goes to a probe file beside the real one with the same extension and
  is removed whatever happens; the error names the real file. `writeFile`
  runs the same JS and JSON gate before writing: a coding agent writing a
  file that does not parse is a mistake worth refusing, and the message says
  the existing file is unchanged.
- **The best-of-N picker is unlocked by a number (2026-09-15, round
  thirteen).** `--attempts 2` on the reference box: one try 38%, best of 2
  50%, about 13 points on the 3B. The proposal made the picker conditional
  on exactly this gap, so it is next, in its minimal checkpoint form (touched
  files recorded on first write, restored for a fresh attempt once verify
  retries are spent, first verifying attempt wins, N per class, step rails
  still bound it), not a general checkpoint system. Recorded as the current
  small-class floor: 38% one try on CPU-only hardware.
- **The picker's fresh attempt is independent, not a retry with the failure
  in context (2026-09-15, round fourteen).** What the eval measured was
  separate tries with clean context, so that is what the loop does: the
  history is reset to the original ask, and touched files go back to their
  pre-task content. Restoring only files that a path-carrying write tool
  touched is deliberate: it is cheap on any project size and covers what the
  seat itself did; changes a shell command made are not tracked, which is
  the honest limit of this form and stays out of scope until a number asks
  for more. The allowance is per class and one means off, so a full seat's
  behavior is unchanged.
- **The 3B reached 75% with the picker in the loop (2026-09-15, round
  fifteen).** edit/create/refactor 100%, answer 0% (the arithmetic ceiling
  of a 3B, a stronger seat's job). Recorded as the small-class result on the
  reference box and the close of the rounds-one-to-fifteen harness cycle: 0%
  to 75% on a free local model through the harness alone. The 7B run stalled
  on Ollama/RAM on the box, not the harness, so it is a box-side check, not
  another round.
- **The 7B does not run usefully on the 7.6 GB reference box (2026-09-16).**
  Confirmed cold, 3B stopped, 4.8 GB free: 0%, "No bytes for 300s" on every
  task. A 7B Q4 (~4.7 GB) plus context and ollama overhead exceeds real RAM,
  swaps, and crawls past the prefill window. Not fixed by chasing it: raising
  `streamFirstByteSeconds` could force a number but a swap-thrashing model is
  not a usable seat, and the box measures what a real person feels. The
  low-end tier's bigger local seat is a 4B (`qwen3:4b`), the next thing to
  measure; a 7B and up is the docked/hub tier (more RAM or a GPU). The 3B at
  75% stands as the floor seat for a machine this size.
- **First Seat fit-curve fork (2026-09-16).** A stream's test encoded a fit
  curve (3B fits 4GB, too-big at 2GB, 7B too-big through 12GB) that no single
  honest RAM budget satisfies, so there were two sources of truth for "does it
  fit." Resolved by keeping ONE honest source, the engine-parity `fitVerdict`,
  and re-pinning the two edge assertions in `app/test/firstSeat.test.ts` to it,
  rather than special-casing the model to match a hand-drawn curve.
- **Guarded-driver preserves the inner seq (2026-09-16).** The app's guard used
  to renumber every event from 1, which made a live status (seq 0) look like a
  journal frame (seq >= 1) and wiped a reopened chat's snapshot. The guard now
  carries the inner driver's seq through untouched. This is a production
  correctness fix, not a test accommodation; it also fixed the reopen and fast-
  send tests once a disposed driver was treated as absent.
- **`package-linux` lives in `release.yml`, not on every PR (2026-09-16).**
  Packaging downloads Electron, rebuilds node-pty, and builds an AppImage and
  deb, which is minutes per run. So the smoke-tested package job runs on a `v*`
  tag and on manual `workflow_dispatch`, not on every pull request; ci.yml keeps
  the fast unit gates. A person can prove packaging any time without cutting a
  release by running the workflow by hand.
- **Linux packaging BUILT and smoke-verified in the sandbox (2026-09-16).** The
  first attempt failed because the Electron binary download was skipped and the
  policy blocks `www.electronjs.org`; but the binary itself lives on GitHub
  release assets, which are reachable, so `node_modules/electron/install.js`
  fetched it and `electron-builder --linux` then produced `OpenShore-0.1.0.AppImage`
  (133 MB) and `oscode-app_0.1.0_amd64.deb` (102 MB). The packaged app booted its
  engine headless under xvfb (the package-smoke check passed). Config settled at:
  `homepage` and `repository` added (the deb's fpm target requires a homepage),
  `npmRebuild: false` with `rebuild:native` moved into the package scripts (so the
  native rebuild is one explicit, visible step, not electron-builder's fragile
  implicit one), and `asarUnpack` for the workspace engine and node-pty.
- **node-pty terminal rebuild is the one deferred piece (2026-09-16).** Its
  native binary must be built against Electron's node headers, which live only on
  `electronjs.org` mirrors that the sandbox policy blocks (GitHub and nodejs.org
  do not carry the Electron-ABI headers). node-pty is optional and lazy-loaded
  (terminal.ts wraps the import), so its absence disables only the in-app
  terminal, never the app; the sandbox AppImage ships with it disabled. CI
  (release.yml runs `rebuild:native` first) and the founder's own box, where
  electronjs.org is reachable, produce a build with a working terminal.
- **The sandbox's earlier read that Electron cannot be fetched here was wrong
  (2026-09-16, corrected same day).** Only `www.electronjs.org` itself is
  policy-blocked; the actual binary lives on GitHub release assets, which are
  reachable. Running `node_modules/electron/install.js` directly (bypassing
  the `ELECTRON_SKIP_BINARY_DOWNLOAD` guard meant for CI) let the sandbox build
  and smoke-test a real Linux AppImage and deb the same day, not just author
  the packaging config for someone else to prove.
- **macOS ships unsigned, outside the App Store, over Developer ID plus
  notarization (founder call, 2026-09-17).** The founder chose to skip the
  Apple Developer certificate and notarization API key setup entirely,
  accepting a one-time Gatekeeper right-click-to-open on a user's first
  launch in exchange. `mac-desktop` (codemagic.yaml) was rewritten from the
  signed/notarized version to a plain `electron-builder --mac`, which signs
  ad-hoc on its own (required for Apple Silicon to execute the binary at all,
  unrelated to Gatekeeper). Reversible later: `docs/MAC-DESKTOP.md` names
  exactly what adding real signing back would need.
- **Sign-in needed wiring into Linux and macOS, not just iOS (2026-09-17).**
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are Vite build-time values; iOS
  had them through a Codemagic variable group, the other two workflows never
  carried them, so sign-in silently didn't render there (the app's own
  intended fallback for "unconfigured", just not what anyone wanted). Fixed:
  Linux reads two new GitHub repository secrets, macOS imports the same
  `Harbor-os-code` group iOS already uses. Confirmed compatible: the app's
  Supabase client is hand-rolled over `fetch` (`app/src/lib/supabase.ts`), not
  the SDK, so Supabase's newer `sb_publishable_...` key format works exactly
  like the legacy anon key, since neither is ever parsed, only forwarded as a
  raw header value.
- **A release must stamp the app's version from its git tag (bug found and
  fixed, 2026-09-17).** electron-builder names artifacts from
  `app/package.json`'s version field, which was never bumped between tags;
  `v0.1.0` and `v0.1.1` both shipped as `oscode-app_0.1.0_amd64.deb`. Beyond
  the confusing name, this is a real correctness bug: `apt`/`dpkg` compare
  package version numbers to decide whether a local-file install actually
  overwrites anything, so an unchanged version can make a genuine update
  silently no-op. `release.yml` now stamps the version from the tag
  (`npm pkg set version=...`) before packaging on every tag build; a manual
  `workflow_dispatch` run has no tag to derive one from and leaves the
  committed version alone.
- **Three concurrent sessions on the same branch merged clean (2026-09-17).**
  While this session wired sign-in into Linux/macOS and fixed the version-
  stamp bug, two other sessions independently pushed Windows packaging plus
  electron-updater, the macOS publish-into-the-same-Release step with its
  own version-check fallback, and a desktop-pairing diagnosis, all built on
  top of this session's already-pushed commits rather than an older point.
  `git merge origin/main` on this session's branch (never a force-push or a
  rebase over the others' history) resolved with zero conflicts. One real
  cleanup needed: both this session and one other had independently written
  a macOS setup doc; the other session's `docs/MAC-DESKTOP.md` (root docs/,
  the established convention, matching `TESTFLIGHT.md`) is the more current
  and complete of the two (it documents the publish-into-Release step this
  session's copy predates), so this session's own `os-code/docs/MAC-DESKTOP.md`
  (the wrong location to begin with) was deleted rather than kept as a second,
  drifting source of truth.
- **DeepBlue is the third and final out-of-the-box model, and it lives on
  the desktop (founder, 2026-09-21).** The founder's brief: a compact, open,
  most-capable model "like Harbor Lite and Harbor", downloadable from the start
  without the Local Library, so a hub gets started Docked in one tap. It ships
  as the third member of the Harbor family, not as a Local Library featured pick
  and not as a new room: id `harbor-master` (a stable slot, the Harbor pattern),
  display name "DeepBlue" in one constant (a CMO rename touches copy only),
  code in `app/src/lib/harborMaster.ts`, a Settings > Harbor row on the desktop,
  and the First Seat card installing it in place. This supersedes the 2026-09-04
  "Harbor rows are gated to non-desktop" ruling for this row only: the two
  guides stay phone-only, the third is desktop-only. The convergence memo's
  "Harbor is taken" concern was heard; the founder chose the family name, and
  the word still means one thing, the out-of-the-box models.
- **DeepBlue's weights are stock Qwen 2.5 Coder, sized to the computer
  (2026-09-21).** Largest size that is not too big by the engine's own budget:
  the 14B on a hub with room, the 7B on a 16 GB laptop or an 8 GB GPU, the 3B on
  the CPU-only reference box; before the machine is read, the 7B, never the
  biggest on a guess. The same list the Starter bundle and the Stack screen's
  one-tap starter already used, so `starterModel.ts` now derives from
  `harborMaster.ts` rather than carrying a second copy. Presence is read from
  the engine's Ollama list, never remembered by the app, so the row cannot
  drift from what Ollama holds; there is no app-side uninstall or cancel,
  since Ollama owns the pull (`ollama rm` is the honest remove). Copy says
  "the most capable Harbor" and "a real coding agent", never "as smart as
  Claude", "a compact Opus", "trains itself", or "always on"; "tuned for
  OpenShore" is written only when OpenShore's own adapter ships, at which point
  only the refs and the attribution change (`docs/house-model-proposal.md`).
- **The Air program is the plan of record for Bonsai 2 on a phone (founder
  go, 2026-09-21).** Bonsai's ternary kernels are not in mainline llama.cpp,
  so neither the Ollama desktop path nor the pinned on-device LLM.swift can
  load it; on-device is a native program, not a config entry. The design:
  Bonsai as the base, a recovery adapter distilled from the open Qwen3.8-27B
  (Apache-2.0; Claude outputs never enter it), Harbor (Qwen3-1.7B, already on
  the phone) as the speculative-decoding draft, a prompt-prefix KV cache on
  flash, and CoreML 2-bit palettization on the Neural Engine as the runtime
  spike with PrismML's fork as the fallback. Gates, each a kill: Gate 0 on the
  Mac mini (beat the 14B on the deep eval or stop), the adapter measured on
  the Mac, the runtime, the Air load test, then speed and the lean-by-host
  harness change. Scope stated honestly: bounded coding un-docked, the test
  oracle stays Docked by physics, and copy climbs the claim ladder only on the
  Air's own deep-eval number. It lands as a 12 GB-gated pocket entry, never as
  a DeepBlue size. Full text in `docs/house-model-proposal.md`.
- **Scope simplified to three curated, harness-trained models; Local Library
  goes Coming soon (founder, 2026-09-21).** The lineup is Harbor Lite (the
  built-in phone guide, pocket), Harbor (a Qwen coder for mobile), and DeepBlue
  (the desktop coder, Qwen 2.5 Coder 32B flagship with 14B/7B/3B fallbacks).
  The open Local Library is grayed out with a Coming soon tag in the nav
  (Sidebar, desktop and phone drawer) while the scope narrows; other entry
  points into it are left for the follow-up. DeepBlue is the rename of the
  Harbor Master slot built earlier the same day: the internal identifiers stay
  (`harborMaster.ts`, `HARBOR_MASTER_*`, `harbor-master`, the stable-slot
  pattern), only the display name and copy carry "DeepBlue", and the 32B is
  added as the flagship size (the catalog's `qwen2.5-coder-32b`, 20 GB, Apache
  2.0). All three become the training targets for the harness (Gate 0 and the
  adapter program), stock Qwen today, tuned weights swapped in behind the slots
  when a number clears. The Harbor recast (guide to mobile coder) and the
  Harbor Lite rename are separate follow-up passes.
- **No OpenShore relay; phone-to-computer stays serverless (founder,
  2026-09-22).** The founder asked for a built-in terminal reached through the
  account instead of Termius plus Tailscale. The native Terminal room already
  exists (PTY on the desktop, xterm.js on the phone), so the only open question
  was the transport. An account-based relay (the desktop dials out to an
  OpenShore server, end-to-end encrypted) went to the eight advisors: seven
  said build with conditions, the Chief of Staff said not now. The founder
  declined it on principle: no OpenShore server sits in the path of a person's
  work, so the experience stays truly private and local and the site's "never
  reach an OpenShore server" and "no background pings" promises stay true. The
  phone reaches the computer directly, over Tailscale or the local network, and
  pairing stays device-to-device (the QR claim). A hosted cloud computer is
  also out. Do not re-propose a relay, a TURN fallback, or account-based
  discovery that stores devices on a server; friction is fixed on the device
  (a post-pairing "Open a terminal" card, a plain home-folder shell when no
  repo is open, split "can't reach" vs "pairing expired" errors).
- **Harness Currents (Jev), founder 2026-09-23:** the "add Jev" ask resolved
  to a new, independent Settings group above Agentic Currents, not an Agentic
  Current (Jev is a decision model, not a chat seat, so it fails the agentic
  mirrored-slot contract and must coexist with an agentic current rather than
  be mutually exclusive with it). One at a time WITHIN the harness group. Jev
  is scoped to a paid/cloud seat (nothing to save on a free local seat, and a
  cloud call would break the offline floor), does the gate + classifier in one
  `JevAdvisor.steer` call in the app stack driver and the verify judge in the
  engine loop, and its copy never claims a dollar saving until `osc eval`
  shows the number (tenet 2). The harness tenet 1 ("no room, no name") is
  deliberately superseded for this one visible group name; Keel stays barred.
- **Currents are per-project, founder 2026-09-23:** both current groups (Agentic
  and Harness) moved from app Settings to a project's settings, because a
  current is a workflow requirement and different projects must run different
  currents at once. The SELECTION lives on the Project
  (`Project.agenticCurrent`/`harnessCurrent`); the CONNECTION (endpoint + key)
  stays device-local and connect-once (a shared team project carries the
  selection, each teammate connects their own box/key). The global rooms and
  each session read the active project's selection via `agenticView`/
  `harnessView` off `activeProjectOf(settings)`. Forgetting a connection sweeps
  it off every project. UI is `components/ProjectCurrents.tsx` in
  `ProjectDetailScreen` (editors only), removed from `SettingsScreen`.
- **Notices on the phone, founder 2026-09-23:** the Claude app's pattern is the
  baseline (away only, asked in context, tap opens the thing, per-kind toggles).
  Download notices post natively from `ModelStore`, not JS, because the web
  layer may never wake on a background relaunch. Reply and approval notices
  stand down for a desktop session the daemon already pushes for, so no
  doubles. No reply text in a notice, matching `push-send`'s privacy line.
- **First open is the chat, founder 2026-09-23:** no setup wall and no
  Personal-or-Business question in front of the first chat. With no account,
  OpenShore runs as personal (`isOrgAdmin` already read it that way); the choice
  is asked once, right after `signUpAccount`, and only when the device never
  answered. A magic-link sign-in that happens to create an account is not
  asked (it cannot be told apart from a returning sign-in client-side); the
  choice stays in Settings. The setup page is reached from a button under
  Harbor Lite's greeting, so its Harbor Lite hero card was dropped as redundant.
- **Harbor Lite runs setup, founder 2026-09-23:** the steps are scripted lines,
  not model output, so a small model cannot garble the walk; the model answers
  only the off-script questions, told the current step in one short prompt line.
  Order is Harbor first (a long download that runs while the rest is set up),
  then computer, repository (skipped until a computer is connected, since a
  phone's repositories live there), and key. Coming back to the chat happens
  only for the step whose page the walk sent the person to, so a key added from
  Settings a week later never yanks them into the guide's chat.
- **The first chat is a conversation first, founder 2026-09-23:** Harbor Lite
  wants to set a new person up and has the buttons to, but its first goal is a
  pleasant, useful chat. "Not now" or "I just want to chat" is read by a pure
  phrase matcher (`setupIntent`, not the model, so it is reliable on a small
  seat) and pauses the walk; the message still goes to the guide, whose prompt
  now says setup is off the table until asked. A resume or a bare "skip" is
  answered by the walk itself, not the model.
- **Every push to main is a desktop release, founder 2026-09-23:** versions are
  the next patch after the newest `v<major>.<minor>.*` tag, cut by CI, so
  nobody has to tag by hand and a desktop is never quietly behind. Pushes that
  touch only the iOS project or Markdown do not release. macOS updates in place
  by swapping its own unsigned bundle (Squirrel.Mac cannot verify an unsigned
  build) and only to a release that carries a Mac zip, since the Mac build
  lands after Linux and Windows; the bar never promises an update a Mac cannot
  fetch.
- **Harbor Lite's floor is raised by the harness, not the model, founder
  2026-09-24:** a 135M model cannot decide when to search, hold the whole app,
  or size a machine, so a pure planner does each and hands over only what the
  question needs. Search is harness-triggered (a factual question no card
  covers), not a SEARCH: line the model must emit, since a model this small
  will not emit it reliably. Setup sizing reuses `resolveHarborMaster`, so the
  guide and the First Seat card can never disagree. The past-my-size line is a
  fixed note after the reply, not left to the model. Stays on SmolLM2-135M: the
  360M would break the 170 MB bundle budget, a Board call if ever wanted.
- **Onboarding runs on first open only, founder 2026-09-24:** Harbor Lite's
  setup walk starts only when `settings.onboarded` is unset, and it is set the
  moment the walk begins, so an update (TestFlight or App Store keeps app
  data) never shows it again; only a fresh install or a delete and reinstall
  does. A returning launch opens a new chat on the stack. Anything skipped
  waits on the Set up OpenShore page.
- **The first open is a letter, not a page, founder + Creative Studio
  2026-09-24:** Harbor Lite's scripted walk reveals in whole-word groups at its
  own pace (slower for the greeting, brisker for the walk), with a reading
  pause after the greeting and the step buttons arriving last. Every beat is
  scheduled from the exact reveal plan in `lib/introWalk.ts`, never a guessed
  timeout; a tap or keystroke skips to the end; live model replies keep the
  stream smoother's pace. Chosen over "Quiet Chapters" (whole bubbles, reads
  as a slideshow) and "Harbor Light" (a splash screen, a new room that holds
  the reader up).
- **The letter rolls in on a swell, founder + Creative Studio 2026-09-24:**
  "Swell Line": characters rise 0.14em, crest 0.05em above the baseline, and
  settle, far longer than the step between them, so many move at once and it
  reads as one wave. Chosen over "Harbor Light" (a teal crest; teal means
  local here) and "Chart Pen" (a measured line mask, fragile at wraps).
  Characters are inline-block only while rolling; a settled line renders plain
  so kerning, selection, and find are normal.
- **The stack is named "Stack", founder 2026-09-24:** not "Your stack" or "My
  Stack". The room, the model sheet row, and any label say Stack; "your stack"
  survives only as plain English mid-sentence ("add it to your stack"). Part
  of the Creative Studio brand sweep (`docs/brand-sweep-2026-09-24.md`).
- **Brand sweep calls, founder 2026-09-24:** the machine is "your computer"
  in all copy; room names take Title Case only as proper nouns (My Crew, Cloud
  Connections, Stack Health), Sentence case otherwise (Stack, Desktop + phone,
  Crew command, Launch with Codemagic), spelled once in `lib/navRooms.ts`; no
  price shows while pay gates are off (`shownPrice`). Color meaning: `--local`
  teal only for local, `--cloud` amber only for spend, `--accent` for chrome,
  `--attention` plum for "needs you". Harbor's license line is unchanged until
  the Qwen2.5-Coder-3B model card is checked.
- **Zed's first-run options, CX 2026-09-24:** of Zed's eight setup options,
  only the trust question fits, and it becomes one narrow choice: how edits
  are handled, asked at the end of the repository step (Ask me first / Let
  edits flow), and kept in Settings > Approvals as a device setting, not per
  project. Theme is already in Settings. Keymap and Vim are skipped because
  there is no editor. Agent install is skipped because CLI Pairing is per
  project, so it is a guide opener instead. There is no settings import,
  since instruction files are already read. Usage data and crash reports are
  never on by default, and there is no second switch that sends anything.
  The walk stays at four steps.
- **A short GitHub list is explained, not worked around, founder review
  2026-09-25:** OpenShore signs in as a GitHub App, so it sees only the
  repositories the App was given on each account. The picker reads
  `/user/installations` and links to that installation's settings page (or the
  App install page) rather than asking for a broader OAuth scope; a pasted
  token gets the token page instead.
- **A connected token rides one clone, never more, 2026-09-25:** host-scoped
  (github.com, gitlab.com, bitbucket.org, https only) as an `http.extraheader`
  through git's `GIT_CONFIG_COUNT` environment, so it is never in the process
  arguments, `.git/config`, the remote, or an error. The phone sends it to its
  own paired computer's admin-only clone route for that one clone. No push
  credential is stored on the computer: the App token lasts eight hours and
  refreshes only through the app, so a durable one is a separate call.
- **"Clone to your computer" puts the clone first, 2026-09-25:** the repository
  the person tapped is where the agent works; the platform id stays selected
  as context and as the phone's project-memory read path.
- **A switched-in model hears the setup step only while it is live, chat
  review 2026-09-25:** Harbor Lite keeps its whole walk line (first-chat
  persona, finished, paused). Any other model in the walk's chat gets a
  step-only line while a step or the edit choice is live, and nothing once
  setup is done or set aside, so a coding seat is never told its job is a
  pleasant chat. The walk's buttons follow the walk whichever model answers.
- **Every in-app send is painted busy at once, chat review 2026-09-25:** the
  user bubble lands the moment text leaves, for every driver but this
  machine's own engine (which may reword the input), and the driver's echo
  folds in. The ethics screen runs before a driver's task-start, so without
  the paint a quick second message or a model switch met a chat that looked
  idle. A screen that throws closes the turn with an error, never a hang.
- **Free desktop chat takes the chat's context as its own field, chat review
  2026-09-25:** `/chat` keeps dropping client system turns and instead
  appends a capped `context` string (8,000 characters) below its fixed line,
  so the project brief and setup step reach it. An older daemon ignores it.
- **Setup forks after Harbor, founder 2026-09-25:** once the Harbor step ends
  (taken or skipped) and setup is still ahead, the guide asks "start chatting
  or keep setting up" and holds for a tap. Start chatting is listed first and
  pauses the walk where it stands (Pick up setup resumes it); a bare "skip"
  at the fork means chat, "next" means carry on. There is no fork when
  nothing else is left, and a step cannot be skipped while the fork waits,
  since that step has not been introduced yet.
- **Reconcile pushes with the app's connected token, 2026-09-25:** only for an
  https remote on that token's own platform, per git command, host-scoped
  through the environment, never stored. This supersedes "no push credential
  on the computer" above for the desktop's auto-push; a phone never pushes.
  The engine's own GitHub token (Settings or `osc auth github`) is the
  fallback when the app has none.
- **A started engine session keeps its folder, 2026-09-25:** the engine cannot
  move a session, so a different first folder in the picker is offered as a
  new chat, not a silent move. Chat-model drivers (cloud, on-device, Stack)
  pick up a repository change on their next turn instead.
- **Every local model searches the web, founder 2026-09-25:** "local" means a
  model you control: on the phone, your own server (BYOM), or the desktop's
  free chat; Agentic Current bench models bring their own tools and are left
  out. Small models ask with one `SEARCH:` line rather than a tool schema they
  may not reproduce; Harbor Lite keeps its harness-planned search. The search
  runs unprompted, as Harbor's always did, once per message, and never on the
  Offline profile. The desktop's `/chat` stays inert: it only adds the
  instruction, and the phone does the fetching.
- **An image asks before it leaves, founder 2026-09-25:** "Ask first unless
  the stack has a model there that is dedicated to image reading, then it's
  just automatic." Only a model placed in the Image reading category (either
  slot) takes an image without a card. Every other reader asks, including an
  anchor that can see and the connected cloud model the stack falls back to:
  the amber Cloud spend card for a cloud reader, a plain card for your own
  server. The route itself is unchanged from "it can go to a cloud provider";
  the person taps it. The Image reading cloud slot's default (the most capable
  cloud model, shown until a person assigns one) is not a placement, so it
  asks.
- **Correction to the short-list ruling, 2026-09-25:** the founder's list was
  short because the sign-in saw public repositories only (the App already had
  All repositories). GitHub's authorize call now asks for `repo read:org`,
  ignored by a GitHub App and required by an OAuth App, and the app names the
  sign-in kind, account, and private count so the cause is read, not guessed.
- **Chain of Thought (2026-09-25):** off by default; the app switch overrides
  the engine config in BOTH directions (`chainOfThoughtEnabled`), unlike the
  humanizer's off-only override, because it is the person's display choice,
  not a project policy. Native reasoners are judged by model name
  (`reasonsNatively`) so the app and engine agree with no probe; everything
  else is prompted to think in `<think>` tags and split by one shared
  splitter. Claude gets adaptive thinking with `display: "summarized"`
  (newer models return empty thoughts without it) and no temperature, and its
  signed blocks are replayed with its tool calls. Harbor Lite's guide turns
  are exempt (a 512-token scripted reply cannot carry a thought). The store
  drops thinking events while off, so a flip hides reasoning at once even in
  a desktop session that started with it on.
- **Claude temperature (2026-09-25):** the Anthropic provider sends a
  `temperature` only to models known to accept one (Opus and Sonnet 4.6 and
  older, Haiku 4.5, Claude 3), an allowlist rather than a denylist, so a
  Claude model newer than the list gets none; leaving it out is always valid,
  sending it to Opus 4.7+, Sonnet 5, or Fable is a 400.
- **Vault v1 rulings (founder, 2026-09-27):** every recommendation in
  `docs/design/vault-v1-plan.md` accepted as written, D1 to D15, with one change:
  opening an existing Obsidian vault in place on iPhone moves INTO v1 (it is
  the only way the same notes show in Obsidian and OpenShore on a phone,
  since Obsidian on iPhone opens vaults only in its own local folder or in
  `iCloud Drive/Obsidian`). Multiple vaults stays v1.1. The rulings in
  short: Google Drive held back (not selectable for a new vault, an existing
  Drive vault read-only and movable); a paired phone defaults to "Your
  computer", an unpaired one to this device, and the iPhone may instead pick
  its Obsidian vault; handoff notes reach the vault only by the person's one
  tap; agent writes stay always-ask with one batched card per task; the
  context pack goes to cloud seats for pinned and retrieved notes with an
  amber card, `Private/`, `Journal/`, and `#private` local-only, nothing to
  the cloud under a secrets lockdown; lean classes get the pack only when
  `osc eval --deep` shows no loss on the reference box; the desktop moves to
  the folder by a one-tap card, keeping the Local copy; vault settings live
  in `.oscode/vault.json` and can only narrow reach; shared-hub members get
  their own roots; the team vault ships at the M2 bar or as BETA; the editor
  stays a textarea in v1; each claim needs the evidence D12 names; no
  sealing of notes in v1; the team vault joins model context in v1.1.
- **Project trust (founder "do project trust first", 2026-09-27; v1 Phase 0
  item 1, `docs/zed-proposal.md` and `docs/v1-direction-review.md`):** a
  folder's own `os-code.config.json` can make OpenShore stricter from any
  folder, but anything that loosens it waits until the person trusts that
  folder on this machine, and some keys never come from a project file at
  all. Every config key is classified once in
  `os-code/src/config/projectPolicy.ts` (project, tighten, trusted, machine),
  and a test fails on any key left out. Trust and the "always allow in this
  project" grants live in `~/.os-code/trust.json`, keyed by the folder's real
  path and its origin, with a digest of what trust vouched for, so a pull
  that changes the check command, an allow rule, or a `.claude` hook asks
  again. The person trusts from one card in the chat ("Use them" / "Not
  now"; `POST /sessions/:id/trust`, owner only on a shared hub; IPC
  `osc:trustFolder`) or `osc trust`; it applies from the next session.
  Judgment calls: `providers` is machine-only even for a trusted folder (a
  project picks among this machine's providers through `stack` once trusted,
  and can never name a server or a key variable); a project's rules never
  replace the person's (its ask and deny rules go first, then the person's,
  then the grants, then a trusted folder's allow rules); "local" is judged
  by address everywhere it gates something (the cloud card, the pill, the
  secrets gate, free desktop chat), through a separate `remote` flag on
  providers so cost accounting and model classing keep reading `kind`; a
  `*.ts.net` host is local only under this machine's own tailnet suffix; the
  agent never writes under `.git`, and writes to `os-code.config.json`,
  `.claude/`, and `.codex/` always ask, in every mode; CLI Pairing refuses in
  an untrusted folder that carries `.claude` or `.codex` settings, since
  `claude -p` skips Claude Code's own trust prompt. **Supersedes** the
  2026-09-05 DAE-9 scope (only `daemon.*`, later `vault.*`, was machine
  config; now the policy table decides every key), the storage of "always
  allow in this project" (it wrote into the repo's tracked file; now the
  machine), and board call 5's project opt-in for pushing the default branch
  (still the project's switch, but only once the folder is trusted).
- **Vault M0 build calls (2026-09-27, builders, confirmed by the CTO):** a
  relative `vault.dir` falls back to `~/OSCode/Vault` with a warning instead
  of failing config loading; on a shared hub the session owner's role decides
  the vault gate and an owner missing from the credential store gets no vault
  tools, and a member is refused a session whose workspace is the vault, is
  inside it, or holds it (this isolates the agent's no-ask tools, not a
  member's own approved shell, so no copy claims more until 5.2); team text
  follows its account: an expired sign-in keeps it sealed for the same
  account only, text arriving after sign-out stays in memory, and a
  voluntary sign-out asks before it deletes unsent team text; a move never
  overwrites a note at the target, which keeps its name while the moved copy
  lands beside it as a conflict copy and the result names it (who keeps the
  name is the person's choice in M1's resolve sheet, never a cross-provider
  clock); dot-led note names are cleaned for links and paths, but the create
  field refills with the cleaned name instead of renaming silently, and the
  engine refuses a dot-led `vaultWrite`; saves run one at a time per note.
- **Vault M0 advisor rulings (2026-09-27):** CTO: linkedom is an app
  devDependency pinned to the engine's version, never reached through
  os-code; the iOS export skips a file edited in Files since the last export
  and says so, instead of overwriting it. CMO: the iCloud storage line names
  Obsidian nowhere until a real Mac opens the folder (8.1) and iCloud writes
  are safe for a second writer (2.1, 2.9); an unpaired phone gets one neutral
  pointer in the empty-vault ramp only ("Your agent works on a computer you
  pair, with its own vault there."); a forked move line keeps "the one you
  moved". CX: the Vault list's fault fallback reads "Back to Chat"; a Drive
  vault on a build that cannot reach Google gets "Open Google Drive" and
  names the `vault.personal` folder. Creative Studio: on a read-only vault
  every control that writes is hidden, not dimmed, and the card is the one
  action at every folder level; the + is an `icon-btn press-fb`; the storage
  sheet's three states clarify the 2026-08-25 not-ready ruling: coming to
  this device later wears the Arriving pill, possible here but switched off
  wears a pill naming the state (iCloud: "Turned off"), and impossible on
  this device is left out.
- **Vault M1, the CTO's rulings before the build (2026-09-27):** (F1) a
  folder note's version is the bigint lstat token `ino:mtimeNs:size`, made by
  one function (`noteVersion`), carried as an opaque `version` on the seam
  and compared with === only; a token that moves while the bytes stay the
  same is adopted silently by the store. (F2) every save to an existing note
  is a temp file in the same folder then a rename (never in place, so no torn
  write), a new note is published with link() so nothing is replaced, and
  the note's creation date is carried on macOS and Windows; on Linux the file
  system cannot keep it and no copy claims it. (F3) change detection is a
  hint, never the protection: one recursive `fs.watch` on macOS and Windows,
  the root plus the open note's folder on Linux, debounced to 300 ms, with
  one `vaultRecheck` on every event, focus, and visibility; no chokidar, no
  polling timer. (F4) `write` itself changes on every provider in one commit,
  with an optional guard and a discriminated result; a conflict is a result,
  never a throw. (F5) the engine's `vaultWrite` writes through the same
  `writeNote` as the app and checks a content hash of the bytes the person
  approved at execute time. (F6) `memory.enabled` is off-only in project
  policy: a project may turn memory off from any folder, turning it on waits
  for trust, and the app override can only turn it off. (F7) only the
  Electron main process picks, validates, and writes `vault.dir` (an
  absolute realpath, file mode kept); the renderer never passes a vault path,
  no daemon route sets it in M1, and open engine sessions keep their root.
- **Vault M1 engine build calls (2026-09-27):** `memoryEnabled` lives in a
  pure `core/agent/memorySwitch.ts`, re-exported from `projectMemory.ts`,
  because `projectMemory.ts` imports node:path and `os-code/protocol` must
  stay free of Node built-ins. The routine scheduler's run note uses
  `writeNewNoteSync`, the synchronous twin of `writeNote`'s `ifAbsent` path
  (temp, sync, link, O_EXCL fallback), since a run's end, its note path
  included, is recorded in one tick. Always-ask only turns an allow into an
  ask: a deny rule and a deny default (`permissions.defaults.write: "deny"`)
  both refuse `vaultWrite`, and a session grant is never consulted for an
  always-ask tool, so it cannot hide a deny. `vaultList` hides a note when a
  deny closes reading or listing it (through a `ToolContext.denies` accessor
  the loop sets from the session's permission engine), names a fenced folder
  as closed instead of listing it, and says how many notes it hid.
- **Vault M1 1.1 build calls (2026-09-27):** where Creative Studio's and CX's
  resolve-sheet rulings differ, Creative Studio's hold for the sheet's copy
  and layout (Keep both, Keep yours, Keep the other version; the Changes,
  Yours, Other version compare; two taps for the rows that drop a side; no
  writer named, since the banned-word guard forbids "agent" and "theirs"),
  and CX's hold for behavior (typing while a choice is open goes to the
  stash, the replay skips that note, leaving a changed note keeps both and a
  gone one goes under Not saved, leaving the room is not leaving the note,
  focus goes to the dialog rather than to Keep both). Not built in this
  phase: CX's "Add theirs to mine" append row, the Undo after Keep yours or
  Use theirs, crediting the agent by name, and the move-mode sheet for a
  move's forked pairs (it ships with 1.3's move card). The sheet waits for
  1.2 s of quiet in a focused editor (twice the autosave debounce). Main's
  vault file work lives in `app/electron/vaultFs.ts` and the watcher in
  `app/electron/vaultWatch.ts`, both plain Node so tests call them as main
  does. A replayed stash whose note was deleted since comes back under its
  name with `ifAbsent` (the M0 rule), while a live save that finds its note
  gone on a closed note holds the text under Not saved. The compare ignores
  line endings and trailing spaces, so a spacing-only difference says so.
- Creative Studio, Vault M1 (2026-09-27): the resolve sheet calls the sides
  yours and the other version (a move: the one you moved and the one already
  there), names no writer it cannot prove, shows a neutral compare, and
  recommends Keep both; closing it defers and leaving the note keeps both; a
  clean note reloads in place with 'Updated from elsewhere' and no toast; the
  desktop move card sits at the Vault root until the person moves or keeps
  the vault on this device, then never returns; the storage sheet shows This
  folder's path with an open-folder button and Open in Obsidian only for a
  folder Obsidian already knows, and Use a folder… repoints without copying;
  the desktop Keep as plain files row is retired as a duplicate of This
  folder.
- CX, Vault M1 (2026-09-27): who lands on the folder is decided by what the
  Local store holds (a new desktop vault is made on the folder, an empty
  default Local one repoints with one toast, one with notes gets the card, a
  vault the person placed is left alone and every move stamps `chosenAt`); a
  declined card returns once, seven days on, only if the folder grew; a move
  holds the room still; the picker refuses with a code whose words live in
  the copy map, never refuses a synced folder, asks one question for a folder
  in or around Obsidian vaults, walks a folder within 10,000 notes, 50,000
  entries, or 3 s, reads Linked mentions on request above 1,000 notes, and a
  missing folder locks writes without ever falling back to another folder.
- **Vault M1 1.3 and 1.4 build calls (2026-09-27):** as in 1.1, Creative
  Studio holds for copy and layout and CX for behavior. So the card reads
  Creative Studio's words ("Keep it on this device", "Move to This folder")
  but follows CX's return rule (once, after seven days, only if the folder
  grew; a second decline is final), and its one return lead is CX's line
  reworded to that button: "{folder} has N new notes since you kept your
  vault on this device." A refused move from the card is said inside the
  card with Try again (CX); from the storage sheet it stays a toast. The
  task named the move-mode sheet, so a move with forked pairs opens it on its
  own after the storage sheet's exit (Creative Studio 1d), not CX's fork
  card. Refusals use Creative Studio's sentences keyed by CX's codes, shown
  inline under the picker row with the macOS privacy button (CX), except
  from the card, where the sheet is not open and a toast carries it; a list
  failure other than a macOS denial reads "That folder could not be read."
  The picker row is Creative Studio's "Use a folder…"; the result block is
  CX's (heading, facts, one question, the sync line, the large-vault line,
  the open-chats line only while a desktop chat is open, Go back, and from
  This device the move), and its Bring action is not built until the CTO
  signs off on `osc:vaultBringPrevious`. Text stashed in a folder the vault
  no longer uses carries that folder on its stash entry and is held under
  Not saved naming it, on its own entry id, instead of keying the stash by
  folder; the folder's cached bodies are dropped on a repoint. Main never
  creates a configured folder that has gone missing (only the default), so
  a write there fails into the 0.4 stash. `saveGlobalConfig`'s writer now
  keeps the file's mode (0o600 for a new file) and fsyncs before the rename;
  `vault.dir` is an existing machine key, so no new key is classified.
- **CTO, Vault M1 Bring (2026-09-27):** "Bring N notes from" the previous
  folder is one argument-free IPC, `osc:vaultBringPrevious`, that copies with
  ifAbsent only: main copies from the folder its own last successful pick or
  refinement left (never a path from the renderer, extra arguments ignored)
  into the folder `loadVaultDir()` names now; both must be folders and pass
  `refusePick`, the same folder and one inside the other are refused (`same`,
  `nested`), one runs at a time, the walk does not sweep temps, prunes dot
  entries, takes only `.md`, follows no link, and stops at 10,000 notes
  (`capped`); a note already here with the same text is left, different text
  lands under `vaultConflictCopyPath` (now one pure helper in os-code on the
  protocol, shared by main and the store) with up to 20 tries, nothing is
  ever removed, nothing is written into the previous folder, and the result
  is the move's shape (`ok` only when nothing was skipped). The button shows
  only after a pick whose previous folder held notes, this session only, with
  CX's copy; forks open the move-mode sheet. New run records keep the note's
  absolute path, with the vault-relative path read from the current folder as
  the fallback, so an earlier Crew run's note opens again after Bring.
- **CTO, Vault M1 review fix M1-4 (2026-09-27):** a write-risk tool whose
  jailed absolute path lies inside `ctx.vaultRoot` (symlinks resolved through
  the vault's own jail) gets always-ask semantics in the loop, the same as
  vaultWrite: Accept edits, Bypass, a trusted repo, a session grant, and an
  "always in this project" rule cannot quiet it, and a deny still wins. The
  optional pick-time line for a folder inside a trusted repo is not built;
  the prompt itself carries the protection.
- **CTO, Vault M2 G1 (2026-09-27):** the Local version is a fresh
  `crypto.randomUUID()` per write, kept in the body and the index and compared
  with `===` only; a pre-M2 body's version is its `updatedAt`; the body is the
  truth, the index a list hint; no per-key counter (it repeats after a delete).
- **CTO, Vault M2 G2 (2026-09-27):** iCloud's version is one Swift `lstat`
  token (the desktop's format); guarded writes swap and verify inside
  coordination, a stale or not-yet-downloaded note is a conflict, and all of
  it lives in a Foundation-only `CoordinatedTree.swift` with a static guard
  (`nativePlugins.test.ts`, first version in M2 wave 0) and a Swift test target.
- **CTO, Vault M2 G3 (2026-09-27), changes the plan:** the team version is
  `String(rev)` and the base lives only in the open note and the stash; the
  server gets new `org_vault_write` and `org_vault_remove` RPCs (migration
  0019, never-repeating revs, a revisions table) instead of changing
  `org_vault_put`/`org_vault_delete`, which stay for builds in the field.
- **CTO, Vault M2 G4 (2026-09-27):** pgTAP runs in CI through the Supabase CLI
  (`supabase db start`, `supabase test db`), never a bare postgres image or a
  stubbed auth schema, pinned by SHA and CLI version.
- **CTO, Vault M2 G5 (2026-09-27), changes the plan:** the single-writer lease
  is advisory on every provider with compare-and-swap (in v1, every writable
  one) and enforced only on one without it, by the rule
  `leaseEnforced = writable && !compareAndSwap`; only iCloud writes a lease
  file, held while typing, with a device-kind `label`; the enforced interim is
  not built.
- **CTO, Vault M2 G6 (2026-09-27):** the team vault polls the open note's head
  every 30 s (jittered, visible and online only, backing off to 300 s) through
  `vaultRecheck({ reason: 'poll' })`; `StoredFileMeta.editedBy` is set by the
  team vault only, labelled with the email's local part.
- **CTO, Vault M2 G7 (2026-09-27):** split by file ownership: wave 0 fixes the
  seam (`remove` answers a `RemoveResult` and takes an `ifMatch` guard,
  `editedBy`, `Lease.label`), wave 1 runs SQL, Local, iCloud, and the team
  client in parallel, and wave 2 is one owner of `store.ts` and
  `VaultScreen.tsx`, one item per commit.
- **Vault M2 wave 0 build calls (2026-09-27):** the desktop folder already
  honors a remove's `ifMatch` (main reads the note through the engine's
  `readNote`, checks again with one `statNote`, then unlinks); the gap between
  that last check and the unlink is left for wave 1. Every store delete is
  guarded with the open note's version; a stale one takes the M1 recheck path
  (a clean note reloads the newer version, one with edits raises the changed
  sheet) and toasts "Not deleted", and a metadata-only change still deletes.
  A move's take-back and a fork's settle remove only the version they wrote or
  read. `nativePlugins.test.ts` covers every plugin, not only iCloud.
- **Vault M2 wave 2 item 2.1, store (2026-09-27):** every provider write
  patches the list and the body cache from its own result inside
  `putVaultNote` (only for a caller that names its vault, so a move's copies
  never touch the list on screen); the body cache is keyed by `versionOf`; the
  store keeps no team rev at all, and a replay against a team vault without
  compare-and-swap reads the note first (which teaches that provider its rev)
  instead of seeding one; the one-time stash conversion to `base = String(rev)`
  runs only once the team provider reports `compareAndSwap`, so today's
  provider keeps its old entries as they were.
- **Vault M2 wave 2 item 2.2 (2026-09-27):** the save chip sits in the note
  bar and reads Saved, Saving (typed text waiting for the debounce, or a save
  on its way), or "Offline, kept on this device" with "N notes waiting" and
  Try again (the house word, per the copy glossary, where the plan said
  Retry); its count is every stash entry of the vault on screen except the
  note whose choice is open, and Try again is the room's refresh, which
  replays the stash; a replay that lands on the open note becomes that note's
  version, so a Try again never meets its own write as a conflict; the tree
  badges conflict copies with the existing `isConflictCopy`; every return to
  the window re-checks the open note on any compare-and-swap storage, and the
  separate refresh on becoming visible is folded into that re-check's relist;
  the team RPC's `conflict_path` toast is superseded by G3 (the resolve
  sheet instead).
- **Vault M2 wave 2 item 2.6 (2026-09-27):** an expiry with a team note open
  keeps team scope and that one note (the list is cut to it, so no other team
  title stays on screen), read-only, with "Sign in again to save to your
  team."; the room lists nothing meanwhile; leaving the note returns to the
  personal vault; the same account signing back in goes on with the note and
  replays what was kept for it, and any other account, or a sign-out, drops
  it as before.
- **Vault M2 2.5, plan 8.2 (2026-09-27):** The single-writer lease is advisory
  on every provider with compare-and-swap; it is enforced only on one without
  it, and v1 has none that can be written.
- **Vault M2 wave 2 item 2.5 build calls (2026-09-27):** the rule lives in a
  pure `lib/vaultLease.ts` (`leaseEnforced = writable && !compareAndSwap`, and
  with compare-and-swap only `icloud` keeps an advisory lease, keyed by
  provider id since no seam flag names "a storage one person's devices share");
  the seam's `acquireLease` gains an optional `label` so the device kind can
  reach the lease file; the lease is taken on a keystroke and renewed at most
  every 60 s (TTL 150 s), and released when the note, the scope, or the room
  changes, with no mount heartbeat; the advisory line shows once this device
  types (no peek, since reading the lease file without writing it is not in
  the seam); on an enforced lease a create or delete asks for the lease first
  and is refused while another device holds it, a save stashes with its base,
  the stash does not replay into that vault meanwhile, and Take over editing
  releases the other holder through the seam before acquiring; today's team
  vault (no compare-and-swap until its client lands) falls under the enforced
  rule but its lease grants trivially and writes nothing.
- **Vault M2 wave 2 item 2.7 (2026-09-27):** the poll's timer lives in the
  store (`vaultStartPoll`, `vaultStopPoll`, one timer, stopped on a scope
  change and on any end of the session) and the screen only starts it with a
  team note open, stops it when hidden, and starts it checking at once when
  visible or back online; "available" is the store's `teamVaultAvailable()`,
  the same predicate `isOrgVaultAvailable()` defers to; offline waits a
  normal round without a request; `vaultRecheck` now answers
  checked/failed/skipped so the poll can back off, a poll skips a tick while
  a save for the note is settling, and a poll never re-lists the tree; the
  open note carries `editedBy` from the list at open and from the re-check's
  `stat`, cleared by this device's own save, shown as " · Edited by sam,
  2 min ago" on the meta line (the time from the note's `updatedAt`).
- **Vault M2 wave 2 item 2.8 (2026-09-27):** the team vault exports to
  "Vault Team/<org>" on both platforms: on the iPhone under Files beside
  "Vault", with a manifest key of its own per org and folder; on the desktop
  through `osc:vaultTeamExport` into `Vault Team/<org>` beside the default
  personal vault folder (`~/OSCode/Vault Team/<org>`), main choosing the
  folder and checking every path, with the same manifest rule kept in the
  folder's `.oscode/export.json`, and a refusal if that folder is, holds, or
  lies in the personal vault. The org's name becomes one plain folder name
  by one rule held in the app and in main, tested for parity. The row is an
  "Export as plain files" link in the team vault's lead line, shown on the
  iPhone and the desktop once the team vault holds a note; the personal
  export and its row are unchanged.
- **CTO, Vault M3 H1 to H6 (2026-09-27):** the rulings the M3 streams build
  to, recorded once here.
  - **3.0 (plan change):** the purity guard could not be green on the tree as
    it stood, since `harness/verify.ts` imported `node:child_process`.
    `runVerify` moved to `core/agent/verifyRun.ts`; `harness/verify.ts` keeps
    the types and `verifyRetryPrompt`. `test/harnessPurity.test.ts` walks
    every `src/harness/**` file plus `src/protocol.ts` through relative
    imports and fails on a Node built-in, a package outside {zod, js-yaml},
    `require(`, `__dirname`, `Buffer`, or `process.env`; type-only imports are
    erased at build, so they are not followed. The walk also caught `Buffer`
    in `core/ethics/guardedProvider.ts` (reached from protocol), now plain
    `atob`/`btoa`.
  - **H1:** a hand-rolled scanner in the core (`harness/vault/scan.ts`), not
    remark: speed on the reference box, no wikilink grammar in remark, weight,
    and exact offsets. Indented code is not skipped and `---` setext
    underlines are ignored, both documented divergences.
  - **H2 (plan change):** frontmatter parses with `js-yaml` 4.3.1 (exact pin,
    `CORE_SCHEMA`, read-only; nothing serializes YAML). No
    `remark-frontmatter`: the renderer shows `text.slice(fm.end)`, so the core
    and the renderer never disagree on where frontmatter ends.
  - **H3 (plan change):** the index persists outside the sealed store, which
    cannot hold a multi-MB blob: `oscHome()/vault-index/<key>.json` on the
    desktop folder provider, a device-key-sealed file in `Directory.Cache` on
    the iPhone, memory only for other desktop providers. Reconcile compares
    `versionOf` only.
  - **H4:** one shared core surface in `harness/vault/` (paths, scan,
    frontmatter, resolve, rewrite, excerpt, types) through `os-code/protocol`,
    one new-name rule for engine and app, and a pinned five-step resolution
    order; `scheduler.ts safeName` becomes `safeNoteName` with no folder
    migration.
  - **H5:** `readConfig` is an optional provider member over logical names
    only (`VaultConfigName`), answering `ConfigRead`, capped at 256 KB; plugin
    folders and `workspace*.json` are never readable.
  - **H6:** wave 0 (this: the guard, `harness/vault/types.ts`, js-yaml), then
    wave 1 streams A to D split by file ownership, then wave 2 with one owner
    of `store.ts` and `VaultScreen.tsx`.
- **Vault M3 wave 1 stream C, engine and main (2026-09-27):** the routine
  scheduler names a routine's folder with the core's
  `safeNoteName(name, 'Routine')` in place of its own `safeName`, so the
  folder follows the vault's one new-name rule (no `# ^ [ ]` either, no
  dot-led or dot-ended segment, reserved names made safe, 255 bytes at most).
  A routine named "Q3: #auth [review]?" now writes under "Crew/Q3 auth
  review/". There is no folder migration: old runs keep the absolute note
  path their record holds (M1 Bring ruling), so when the new rule cleans a
  name differently, new runs land in the new folder and older notes stay
  where they are. `vaultWrite` checks
  only NEW notes with `checkNewNoteName` and refuses with the clean name; an
  existing exact path always updates, and a new name that folds (`foldPath`)
  onto an existing note is refused naming that note, never redirected, so a
  permission rule on the typed path cannot be stepped around. `vaultRead`
  names a fold twin the same way and never reads it in the typed path's
  place. Main's `listVaultFolder` is an async walk (same order, same limit,
  8 lstats at a time per folder) and lists only paths the note rule accepts,
  so on Windows a name NTFS cannot open never lists.
- **Vault M3 wave 2, the store and the Vault screen (2026-09-27):** H1 to H6
  are done on this branch; the store gained call sites only. The index is fed
  only for the vault on screen (a move's writes to another vault never touch
  it). A watcher hint that names paths goes to `host.watched`; a tree change
  reaches the index through the relist it already scheduled, so one change
  never runs two reconciles. A save whose CRLF-restored text equals the open
  note's text, with no save for it in flight and no standing save error,
  writes nothing, so opening and leaving an all-CRLF note never rewrites it.
  Linked mentions read excerpts through a new `vaultReadBody` (the body
  cache) and say when more than 50 notes link in. A folder pick does not
  close the index yet: `afterVaultPick` is the held native branch's ground,
  and until it closes the index there, the next list's reconcile drops and
  re-reads what the new folder does not share.
- **Vault M4, context layer I (2026-09-27):** the CTO's rulings I1 to I16
  are built as written, in waves (0 contracts, 1 seven parallel streams, 2
  one integrator). I1: `providers.<id>.numCtx: 'auto' | 'off'` in the
  provider, so the engine, `/chat`, routines and eval send the same served
  window; Ollama only; the class from name and size only; memoized per
  model. I2: `vaultPackFraction`, `vaultReadCapChars`, `mergedVaultTool` on
  the class policy (placeholders), only `mergedVaultTool` a project may
  override; `VAULT_PACK_MAX_TOKENS` 4000. I3: `vault.exclude` and
  `vault.localOnly` machine, `vault.context` off-only (a project's `'off'`
  applies anywhere, its `'full'` waits for trust). I4: one judge,
  `harness/vault/privacy.ts`, hand-rolled glob on the folded path, a pin
  never lifts a restriction, local judged by address. I5: tools enforce it;
  a local-only tool result is marked and a leaving turn sends a stub. I6:
  the pure two-phase pack builder. I7: one engine index per root, a 250 ms
  cold budget. I8: the pack rendered per turn for the answering seat. I9:
  `PACK_BY_CLASS` is Current State only for every class, mid and large too,
  until the eval. I10: the additive `context-pack` event and card. I11:
  tools that search first, one merged read for merged classes. I12: the
  harness's dated Current State line. I13: Crew notes with frontmatter.
  I14: the eval fixture and variants in the sandbox, no number claimed.
  I15, I16: the stream split and what waits for M5 and M7. Deviations worth
  knowing: `numCtx` has no schema default (unset reads as off, so a config
  file never gains a key it did not have); privacy lives in
  `harness/vault/privacy.ts`, not `vaultContext.ts`, so tools use it without
  the pack; the pack sits after the code map and before the text protocol,
  not after the memory block (KV reuse for the multi-KB standards); the card
  re-fires when an escalation changes the seat, and counts only real vault
  notes (pins, search hits, links), never the map, the handoff, or Current
  State; the loop's vault menu and the small-seat priority are the
  registry's `seatOffersVaultTool` and `withVaultLookupPriority`, one
  implementation; bootstrap builds the engine source whenever a caller
  passes none, so the CLI, the daemon, routines and the desktop all carry
  Current State, a session with no vault root included; a reply seeded from
  the journal after a local-only read comes back marked, so a daemon
  restart keeps the note off a leaving seat (the tool results themselves
  are not seeded), and live history holds the same rule: once a task has
  read a local-only note, every assistant turn it records is marked too,
  since a reply may quote the note; the deep eval builds each task's vault index before the
  run (a person's vault is indexed long before a task), closes it and
  removes its saved file after, and a variant run with no task vault gets no
  vault, so the person's notes never enter a benchmark. Founder gate, open:
  `osc eval --deep` with `--vault-pack on` and `off`, and `--num-ctx auto`
  and `off`, per class on the reference box (tiny and small local, large by
  an approved reference run), with the numbers recorded here and in
  PROGRESS before any class flips to the full pack or `numCtx` defaults to
  auto (tenet 2).
- **Vault M5, context layer II (2026-09-27):** the CTO's rulings J1 to J21
  are built as written, in waves (0 contracts and stubs, 1 nine parallel
  streams A to I, 2 two integrators: the engine in `os-code/**` and
  `app/electron/**`, the app in `app/src/**`). J1: one pack core in the app,
  `createAppVaultPack` over `planContextPack` and `buildContextPack` from
  protocol, prepared once per send inside `VAULT_PACK_COLD_MS` (250),
  rendered per seat with the loop's render key and card dedupe, no project
  secrets ever. J2: one Node-free judge, `harness/locality.ts hostIsLocal`,
  that `egress.ts isLocalHost` delegates to and the app's `packSeatFor` and
  `byomReach` call with the paired hub's tailnet suffix. J3: app privacy
  from the desktop bridge, the paired hub's `GET /vault/privacy` (cached
  sealed), or D5 defaults; the device setting only narrows, and no rules
  loaded means D5, never none. J4: class by `deriveModelClass`, windows per
  seat kind (device 4096, BYOM `contextTokens` else 8192). J5, J6: every app
  driver emits the card after `turn-start` and places the pack last; desktop
  chat builds its pack on the daemon (`/chat` `vaultPack`, `memory: false`).
  J7: the daemon's `/vault` routes (notes, config, privacy, index with an
  ETag), every path through the Jail and the note rule, every write a
  compare-and-swap. J8: `vaultRootFor(auth)` and `vaultRootForOwner`: the
  owner on the machine vault, each member on
  `oscHome()/vaults/members/<sha256 16 hex>` (0700); sessions get
  `BootstrapOptions.vaultRoot` at create and the stored OWNER's root at
  rehydrate, and the old `BootstrapOptions.vault` flag is gone. J9: the
  `hub` provider "Your computer" with a sealed stash, read-only out of
  reach, and the D2 repoint rules. J10: `vaultTool.ts` on cloud and BYOM
  single turns, writes batched into one always-ask card. J11: pure
  extractive `buildHandoff` and `fitSeed`. J12: the switch seeds with
  `fitSeed`, a handoff only when turns drop; the desktop agent takes
  `BootstrapOptions.handoff` (16 KB) on its first task. J13: the engine
  writes the latest handoff per owner, real cwd and project after a
  compaction, each completed task and dispose (`core/agent/handoffStore.ts`,
  redacted and sealed), the app per project; both cleared with the chats;
  read on a first send at most 7 days old as a full-mode layer. J14:
  `Project.vaultPins` (at most 8, editors, device-local), in both pack
  modes. J15: the `[[` picker, "Ask about this note", "Pin to project
  context", "Recently from your agent". J16: the app's stable-then-volatile
  prefix and `claudeCache.ts`. J17: `providers.<id>.promptCache` on the
  engine's Anthropic provider, split at `ChatMessage.cacheAt`; the loop
  forwards `cacheReadTokens` and `cacheWriteTokens` onto the `usage` event.
  J18: `vault.handoff` off-only, `promptCache` machine. J19 to J21: the gates
  below, no held native branch needed, the stream split. Deviations worth
  knowing: E reads only bodies some seat can render (a hidden note is never
  read, and no index means no read, so the team vault never enters a pack);
  C refuses an unguarded `DELETE` (it must carry `ifMatch`), and makes a
  member root on first use, not at pairing; A gives `HandoffTurn` a
  `localOnly` flag (such a turn is left out) and `hostIsLocal` ignores an
  own-tailnet suffix that is not a real tailnet, so a bare `ts.net` cannot
  make every Funnel host local; D's handoff eval task runs on an empty vault,
  so only the handoff can carry its decision, and the person's own handoffs
  are never read; B drops a handoff over the cap whole with a warning, never
  cut mid-line; H's switch to the desktop opens a new agent chat whose
  session create carries the handoff, rather than reseeding the open chat;
  the BYOM locality change: `byomReach` now judges by `hostIsLocal`, so
  another tailnet's `*.ts.net`, `0.0.0.0`, `169.254/16`, `fc00::/8` (only
  `fd*` stays local) and IPv4-mapped IPv6 spellings read cloud (amber) where
  they read local before. Engine integrator calls: a Crew (headless) run
  neither writes nor reads a handoff, the safer of the two options, since a
  scripted run's summary must never become the person's "where you left
  off"; clearing is `DELETE /handoffs` (the owner of the computer only, since
  the store is keyed by a hash and holds every owner's) and the desktop IPC
  `osc:clearHandoffs`, and `DELETE /sessions/:id` also removes that session's
  handoff; the engine's cache-token dollars are not yet priced (cache reads and
  writes ride the event and the eval's trace; the dollar rail still prices
  `input_tokens` only, which with the cache on undercounts, so `promptCache`
  stays off until J19). Founder gates, open (J19): on the reference box per
  class, the open M4 runs, `vault-continue-handoff` with and without the
  handoff layer, and `--prompt-cache on|off` on an approved large reference
  run (input tokens, cache reads and writes, dollars per completed task),
  recorded here and in PROGRESS before `PACK_BY_CLASS`, `numCtx`, the
  handoff layer or `promptCache` flip; and the device checks in the plan's
  8.1 list for M5.
  App integrator calls: a reply after a local-only read is marked by an
  additive `localOnly` on `text-final` (`textFinal`, `isLocalOnlyFinal`),
  carried onto the assistant item and the seed, so a leaving seat gets
  `LOCAL_ONLY_STUB` and a handoff drops the turn. Memory off withholds the
  pack and the Stack's vault tools and sends `/chat` `memory: false`;
  `vaultContext: 'off'` drops only the pack. One index lifetime rule:
  `closeVaultIndex` is leaving the Vault room (personal parked warm, team
  closed), `shutVaultIndex` is a storage move, a sign-out or a pairing change.
  One pairing rule, `hubPairPlan` ('repoint' | 'offer-move' | 'stay'). Privacy
  source order: the desktop bridge, then the paired hub, then the device
  setting, each within 2 s, else D5 unioned with the device setting (fail
  closed), cached 60 s. The composer keeps stream I's `ComposerVault` shape
  and takes the stricter of the listed and the note's own visibility.
  `clearConversations()` clears every chat and every handoff store (local,
  the desktop bridge, the hub's `DELETE /handoffs` unless a member). The
  flaky `vaultStore` sign-out row was real async work (`crypto.subtle`, the
  sealed store) outlasting one `setTimeout(0)`; it now waits on the outcome.
  Pre-ship fixes: (1) a Stack play tracks local-only taint per step output
  (its pack carried a local-only note, or a tainted output reached its local
  seat whole), and every step, replan and synthesis prompt for a leaving seat
  gets `LOCAL_ONLY_STUB` in a tainted output's place (`resultsForSeat`); a
  step run on the paired computer's engine is tainted too when its session
  read a local-only note (a `tool-end` or reply carrying the mark, which
  `PackLocalOnlyMarker` now also takes from a local-only `tool-end`);
  (2) `ContextPack.localOnly` and the `context-pack` event's additive
  `localOnly` say a local seat's pack carried a local-only note (judged in
  `buildContextPack`, which the app's pack now reads too), and the desktop
  chat, remote and Electron drivers mark the reply's `text-final` after such
  a card until the next `task-start`; (3) with prompt caching off, the Stack
  and the Claude driver send `system` as one plain string byte-identical to
  before M5 (the pre-M5 piece order too, on every Stack seat), the pack
  appended last; blocks, the stable-to-volatile order and `cache_control`
  only with caching on.
- **Vault M6, Obsidian day one (2026-09-27):** the CTO's rulings K1 to K19
  are built in waves (0 contracts, stubs and mechanical moves; 1 streams A1,
  A2, B to H; 2 one app integrator). In brief: K1 one pure `vaultCaps`
  lights every M6 action by capability, never by provider id, and every
  write-shaped cap needs `compareAndSwap`; K2 the seam's optional members
  (`rename`, folders, Trash, attachments, `readBytes`); K3 rename by
  compare-and-swap that never replaces (`exists`, `missing`, `changed`,
  `downloading`), with a create-if-absent then remove fallback only on a
  compare-and-swap storage; K4 a pure link-rewrite plan (`move.ts`) and a
  host apply in `vaultOps.ts`; K5 folders as derived paths plus
  `listFolders`, Local's empty folders remembered on the device; K6 Trash
  per provider (`.trash/<path>` on a folder, sealed keys on Local); K7 a
  pure Today core with moment tokens, refusing an unknown token by name;
  K8 the search grammar (`tag:`, `path:`, `file:`, phrases, `-`); K9 the
  switcher and Recent; K10 remark plugins, sanitized, no `id` from note
  text; K11 embeds one level deep, checkbox write-back, attachments and
  refcounted blob URLs; K12 `0020_org_vault_move.sql`; K13 the engine,
  main and daemon routes; K14 linking by keyboard with the accessory bar;
  K15 outgoing links, unlinked mentions, the outline; K16 the 5,000-note
  budgets; K17 no new `OscConfig` key; K18 motion and honest copy; K19 what
  waits for the held branches. Reconciled with CX, final: a rewrite
  conflict skips that note and the pass continues (a re-read and re-plan
  once, a standing card with "Update the rest"; only a storage-level failure
  stops it); one-tap delete only where Trash is real, and any permanent
  delete keeps two taps worded "for good" with a courtesy in-memory Undo;
  team Trash is Restore only, no Empty; a restore beside a taken name is
  "{title} (restored)" on every provider. The CX memo's key calls: search
  lives in the tree on every platform and the phone gets no switcher (its
  field is one, over K9); titles first, then text, with `<mark>`; Recent
  merges the agent's notes, labelled only where the agent is real; rename is
  one sheet with Name and Folder; "Update links?" only when links point in;
  a partial pass names the notes it skipped; Undo is a 6 s toast that pauses
  under a hand and says "Also in Trash."; Trash is the last row at the root,
  shown only when it holds something; Today sits beside the house +, opens
  an existing note with no write and no toast; callouts use four token
  families, never teal or amber; the only haptics are a commit when a
  destructive or multi-note change lands and a tick on a checkbox. Stream
  deviations: B keeps accents distinct while it folds case and Unicode
  normalization (a filesystem's truth and 0019's `lower(path)`; K3 had said
  accent-insensitive), and Local, the hub and the rename sheet use the same
  `foldPath`; unlinked mentions carry a guarded Link button (CX X16) though
  K15 said read-only, the person's own compare-and-swap write, refused while
  a choice is open on that note; K14's insert tries `execCommand('insertText')`
  first and falls back to `setRangeText` with an `input` event, unverified on
  a device; a rename adopts the path the storage returned, never the one
  asked (B re-cases parents to the disk's spelling); 0020 lives on the held
  team branch, and that branch's `listTrash` lists a tombstone only when its
  newest revision of any reason is `deleted` (a moved-away path's newest is
  `renamed`). The app integrator's calls: the store binds the screen's
  autosave (`vaultBindAutosave`, `take()`) so a stale save never recreates a
  trashed note; a permanent delete stays M2's guarded `vaultDelete` plus the
  bytes for the courtesy Undo, a Trash-real one goes through
  `vaultOps.deleteNote`; an operation's write to the open note reloads it in
  place; the rewrite pass writes a moved note at its landed path; one fold
  rule for a taken name (`foldPath`, pinned for every provider in
  `providerContract`); remembered empty folders (`vaultEmptyFolders`) and
  Recent (`vaultRecent`) are device settings keyed `providerId::resourceId`,
  Recent cleared on a repoint and with the chats; search uses the host's
  `search(q, opts)` memoized on list, index state and scope; Today's
  refusals say the storage's own line; a `#tag` in reading view is a small
  button that searches `tag:x`; blob URLs are revoked with `shutVaultIndex`,
  on leaving the room and on iOS backgrounding, the reader re-keyed on
  return; the outline scroll finds `[data-heading-index]` outside embeds;
  Options says why a row is missing where the storage itself lacks it
  (`vaultCapLine`); the class-name guard reads `className` values only; new
  strings sit in an "M6 wave 2" section of `vaultCopy.ts`; folder options
  show in a folder view only. The tree to note and read to edit swaps began
  as arrival fades and are now true crossfades: `hooks/useViewGhost.ts`
  clones the leaving view's root in React's commit (typed text copied, ids
  dropped) into an inert, aria-hidden snapshot inside the room's scroller
  that fades out on `--dur-3` and `--ease-standard` while the arriving view
  fades in; a re-key of the same view leaves none, and reduced motion (or a
  host with no `matchMedia`) leaves none. `vaultViewGhost.test.tsx` fails a
  Vault view root rendered without its ghost binding. The Trash page still
  only arrives with a fade, since it replaces the whole screen.
- **Vault M7, the customization surface (2026-09-27):** the CTO's rulings L1
  to L20, built in waves (0 contracts; 1 streams A to G, H on the held team
  branch; 2 one app integrator). In brief: L1 one pure settings core
  (`harness/vault/settings.ts`, Node-free, through `os-code/protocol`) with
  the tolerant Obsidian readers moved into it; L2 the in-vault file
  `.oscode/vault.json` (new notes, daily, templates, attachments, links,
  editor, tree sort, delete, agent folder, exclude and local-only), each
  field with a runtime consumer pinned by a table test; L3 plan change: a
  convention Obsidian sets wins and its row reads "From Obsidian", then the
  in-vault field, then the default; L4 the file only narrows (an allow-list
  parse, widening keys set aside with a plain line, the lists union only),
  and the honest limit: it binds every model and the agent, not a person who
  can edit the folder, so the durable floor is machine config and the device
  setting; L5 who reads it per host (`vaultSettingsFor`, a refreshed privacy
  holder per root); L6 caching (2 s engine memo, 60 s app map keyed
  `providerId::resourceId`); L7 the sheet writes the file through a seam
  `writeConfig`, compare-and-swap, the agent never may; L8 a hard deny under
  `.oscode/` on every write path; L9 plan change: provenance as flat
  top-level `oscode-*` keys (`source`, `model`, `where`, `size`, `provider`,
  `created`, `reviewed`), `oscode:` stays the privacy marks, and the merge
  runs before the approval so the person approves exact bytes; L10 the pure
  textual merge, byte for byte, skipping rather than making bad frontmatter
  worse; L11 `delete: permanent` turns Trash caps off; L12 the starter
  layout, empty personal vaults only, opt-in, every write `ifAbsent`; L13
  reach switches stay out of the vault (`vaultContextOn`, `vaultHandoffOn`,
  `vaultPackSize`, the app may only lower, riding
  `BootstrapOptions.vaultOverrides`); L14 new keys classified (`vault.packSize`,
  `vault.packMaxTokens`, `vault.provenance` machine; the device settings);
  L15 one sheet, seven sections, three Wayfinding rows after Memory; L16
  Local on its sealed key, the team vault read-only defaults on main; L17
  team settings and entitlement on the held branch; L18 no-config parity;
  L19 purity; L20 this entry. Three holes closed on the way: a symlinked
  note pointing into `.oscode/` (the resolved path is checked, not only the
  typed one), `writeFile` and `editFile` reaching `.oscode/` under an
  always-allow grant (refused for the machine vault and every member root,
  whatever the grant), and a nested `oscode:` provenance map that would have
  made a duplicate key and dropped every privacy mark (hence flat keys).
  `runShell` is not covered: it stays under its ask rule and nothing claims
  otherwise. Reconciled with CX: flat `oscode-*` keys; Memory's sub says it
  gates the vault too, and "Off applies to new chats" is the floor (an
  engine session takes its options at open); the line "This vault's
  settings keep anything in Private or Journal off cloud models" shows only
  when the starter's settings file actually landed (a machine
  `vault.localOnly` replaces the D5 default, so without the file the line
  would not be true); Handoff is an off-only override that takes effect at
  the next model switch on app seats and for engine sessions opened after,
  and off means no handoff at all (the passed switch text is dropped too).
  Entitlement (CFO + CTO; founder sets the date): 2026-09-27: Team vault
  writes for an org with no entitlement row are open until
  no_entitlement_vault_until() (null in the beta); when pay gates return,
  one migration sets it at least 30 days out as the notice; a lapsed paid row
  is read-only with export regardless. The SQL is on the held team branch as
  `0021_org_vault_settings.sql` (after 0019 and 0020): `org_vault_settings`
  (conventions only, `delete_role`, a `context_folder` column with no row
  until v1.1), admin-only compare-and-swap `org_vault_settings_put`,
  `org_vault_entitled`; every write RPC raises `OV402` when not entitled,
  `OV403` refuses a member's delete when only admins may, and a move is not
  gated by the delete role (a rename keeps the note and its history). The
  integrator's key calls: run note provenance has one owner
  (`runNoteFrontmatter`), and an unreadable `daily-notes.json` writes no day
  link; K16 timings are best of five while counts stay exact; one override
  rule (A's three helpers); vaultWrite's description stays static (a
  per-session description would break the prompt cache prefix for no
  measured gain); the settings writer is a direct import, proven end to end
  through the daemon and the desktop bridge; a retrieval skip for the
  templates folder and Obsidian's plain ignore filters (not privacy, and no
  copy says so); the settings live in the store keyed like Today's cache;
  room for notes on an app seat is the device's choice, lower-only against
  the machine elsewhere; the project lock line is not shown (the app cannot
  read a project's config; the engine still enforces its off); links write
  markdown or wikilinks by the vault's style and format only when the
  resolver reaches exactly that note; Mark as reviewed is the person's
  compare-and-swap write. Approval honesty, fixed after integration: an
  addition to an existing note had its provenance merged at write time
  while the card showed only the added text. Now the app computes the exact
  final text before the card (the note as the model read it, the addition,
  the property change), the card names the change ("Also records in its
  properties: Edited by {model} · Local."), and the write lands exactly
  those bytes by compare-and-swap on the version read, refusing a changed
  note instead of merging; the engine's approval basis carries the hash of
  the exact bytes its diff showed, and execute writes those bytes or nothing
  (a seat that changed under the card is refused). Tests:
  `os-code/test/vaultApprovedBytes.test.ts`, `app/test/vaultTool.test.ts`.
- **Vault M8, the ship gate (2026-09-27, plan 8.2):** the standing record
  of what Vault v1 settled, gathered in one place; each ruling's own entry
  above stays the detail. (1) **The base revision lives in the editor.** The
  version a save is typed against is carried by the open note and by its
  stash entry, never by a provider or a device clock; a provider answers a
  guarded write with `ok`, `changed` (with theirs), `missing`, `exists`, or
  `downloading`, and never overwrites on a mismatch (M1 F4, M2 G3, 2.1). On
  `main` the team provider still remembers the revs it read (0.9 stopped
  `list()` and `stat()` from moving them) until `vault-m2-team` lands its
  client on 0019's `org_vault_write` and `org_vault_remove`. (2) **The lease,
  revised (2.5, supersedes the CTO's "single-writer lease from day one").**
  `leaseEnforced = writable && !compareAndSwap`: on a compare-and-swap
  storage the lease is advisory ("also open on X"), and only iCloud writes a
  lease file, taken on a keystroke, renewed at most every 60 s, TTL 150 s;
  a storage without compare-and-swap enforces it (create and delete refused,
  Take over editing). (3) **The trash convention (6.3, K6).** A delete goes
  to `.trash/<path>` on a folder and on Your computer (the folder Obsidian
  uses, already hidden by the 0.6 note rule), to sealed trash keys on Local,
  and on the team vault to its tombstones and revisions (Restore only, no
  Empty; held branch). Delete is one tap only where Trash is real; any
  permanent delete takes two taps worded "for good" with an in-memory
  courtesy Undo; a restore beside a taken name lands as "{title} (restored)";
  `delete: permanent` in `.oscode/vault.json` turns Trash off. (4) **The pack
  budgets are placeholders until 4.8.** `PACK_BY_CLASS` is Current State only
  for every class; `vaultPackFraction` 0.08 (tiny, small, mid) and 0.04
  (large) of the served window, capped at `VAULT_PACK_MAX_TOKENS` 4000;
  `vaultReadCapChars` 6,000, 12,000, 32,000, 64,000 by class; the merged
  `vaultLookup` for tiny and small; a 250 ms cold budget; pins at most 3 in
  half the budget; the composer excerpt min(2,000, 25% of the window), 1,024
  on a device seat; a device seat's 4,096 window gives 327 tokens; the
  handoff to the desktop agent at most 16 KB; `numCtx`, the handoff layer,
  and `promptCache` off. Each changes only in its own commit citing the
  reference box numbers recorded here. (5) **The team vault's permission
  model.** Reads are RLS-scoped to active members (a removed member reads 0
  notes and 0 revisions); writes only through SECURITY DEFINER RPCs
  (`org_vault_write`, `org_vault_remove`, `org_vault_move`, with the legacy
  put and delete kept for builds in the field); revisions are append-only
  and no member writes them directly; bodies cap at 1 MB; paths are unique
  on `lower(path)`; tombstones and revisions purge past a window. On the held
  0021: `delete_role` (admins or members) set by an admin through a
  compare-and-swap `org_vault_settings_put`, `OV403` for a member's delete
  under admins-only, a move never gated by the delete role, `OV402` on every
  write when not entitled, a lapsed org reading and exporting everything, and
  an org with no entitlement row writing until `no_entitlement_vault_until()`
  (null in the beta). The team vault is for people only in v1: no pack, no
  vault tool, no agent line (D15); project pins stay device-local and never
  sync. (6) **Founder decisions still open:** push 0019, then 0020, then
  0021 to production, after the case-duplicate preflight, and confirm the
  purge cron; merge `vault-m2-team`, `vault-m2-icloud`, and `vault-m2-native`
  (in that dependency order: icloud before native); the date in
  `no_entitlement_vault_until()` when pay gates return (at least 30 days
  out); one recorded `xcodebuild test` run of the Swift tests on the Mac that
  builds the iOS app; the reference box evals (M4 `--vault-pack` and
  `--num-ctx`, M5 `--handoff` and `--prompt-cache`, M6's K16 timings), with
  the thresholds D12 leaves to the founder; the device checklist
  (`docs/vault-v1-device-checklist.md`); and the CFO's seat-ceiling dissent
  (2026-09-05 entry: the Micro band for an org with no entitlement row),
  which the founder decides beside pricing, a Board gate. The must-fix map is
  `docs/design/vault-v1-test-map.md` (101 findings: 96 covered on `main`, 2 on the
  held team branch, 2 device-only, 1 missing, orgvault-19).

- **Vault M8 code pass (2026-09-27, plan 8.4 and the M6 and M7 follow-ups):**
  (1) the copy gate covers the whole vault copy map and the Vault's UI
  strings: `VAULT_EVAL_CLAIMS_UNLOCKED = false` in `vaultCopy.ts` waits on
  the 4.8 pack and 5.4 handoff results, and until then `vaultCopy.test.ts`
  refuses faster, slower, cheaper, better, smarter, remembers, learns, and
  "picks up where you left off"; "always" stays refused after the flag,
  since it is not a measurement. (2) The computer's own Room for notes rides
  read only on the privacy answer both hosts already give
  (`VaultPrivacyWire.packSize`, one `machineVaultWire` helper); the sheet
  says "Sessions on this computer use its own setting, Normal." whenever
  those sessions use another size, and "can use its own setting instead."
  when the computer does not answer; `packMaxTokens` is not sent (nothing
  reads it). (3) Play-step engine sessions carry the device's
  `vaultOverrides`. (4) The Trash page renders inside the room's screen, so
  it crossfades in and out on the view ghost, under the M6 guard. (5)
  orgvault-19: `os-code/test/vaultClaims.test.ts` keeps the team vault's
  "never lost" claim out of source, docs, and migration comments;
  `0010_org_vault.sql` is exempt by name because an applied migration is
  never edited, and 0019's revisions supersede its header. (6) Not built:
  the "This project's settings turn this off." line, because an honest one
  needs the active project's config read on demand (a session's report goes
  stale, and a project can span several repos); the engine still enforces
  a project's off.

- **Team vault M6 and M7 client (2026-09-27, held `vault-m2-team`, plan 6.2,
  6.3, 7.4):** the team client gains `rename` (`org_vault_move`, adopting the
  answered path and rev), `trash`, `listTrash` and `restore` (a tombstone is
  listed only while its newest revision of any reason is `deleted`; entries
  are keyed by path, restore takes the newest `deleted` revision, and a name
  that already holds exactly that text counts as the restore done, so a
  second tap makes no copy), no `emptyTrash` (R3, the purge), and
  `readConfig`/`writeConfig` over `org_vault_settings_get`/`_put`. The
  settings text is the jsonb rendered in Postgres's key order, so the
  writeConfig contract row for the team compares the JSON the column holds
  (a per-row `same`, the identity for every file row); `vaultCaps` takes
  `settingsAdmin` so only admins save; OV402 marks the plan lapsed (the room
  read-only, Export kept) and OV403 is the whole Y14 line, carried to the
  toast as `line`. Trash entries carry `size: 0` (the listing reads no
  bodies; the Trash view never shows size). A member under admins-only sees
  Delete disabled with "Only admins can delete team notes here." rather than
  absent.
- **v1 for the first-time person (founder "build all of your recommendations",
  2026-09-27; the customer is a non-developer using Claude Code today; the
  founder asked that the core design and feature set not change):** everything
  new is additive, and anything that would change a default for the person
  ships behind config or a build flag until a number or the founder says
  otherwise. Undo: a checkpoint per task in a shadow git folder under
  `~/.os-code/checkpoints` (not the project's git, so it works in a folder
  with none and never touches its index or history), taken by `LocalDriver`
  so every host has it; restore refused while a task runs, journaled so every
  device folds; the route is the session owner's like every control (it only
  ever touches files that session's task changed); a folder past 20,000
  files, files over 20 MB, dependency folders and OpenShore's own state are
  left out. Verify: a configured check now runs on a paired phone with a
  verify grant on this machine keyed by folder, command and a digest of what
  it runs (members never grant, routines never run an ungranted one, bypass
  mode counts as a yes); a found test script always asks first, desktop
  included, being the repository's own code; the page check runs nothing the
  project wrote (compiles scripts, never runs them); `detect` and `pageCheck`
  read off until `osc eval --floor` measures them (tenet 2), and the floor
  plan measures each change against the same plain run. First run: the First
  Seat fetches Ollama's own installer and opens it (marked as a download so
  Gatekeeper checks it; the page opens on any failure) rather than
  installing silently, and on Linux names the command instead of running a
  sudo installer in a hidden terminal; the sample page's tap sends its ask at
  once, since that tap is the request. Signing: unsigned stays the default;
  a Mac certificate without notarization credentials is ignored, since it
  would still warn. Focus flag: build time, off; it hides the review's 8/8
  and 7/8 rooms and both Currents groups; the Crew scheduler still runs if a
  routine exists (the engine does not read the app's build flag; a
  follow-up). What leaves this device: disclosure first; the review's
  changes that would alter what a feature does (web search asking first,
  updates asking before downloading, the guardrail record's named person,
  the repo sign-in exchange) are listed as they stand and left to the
  founder; the privacy paragraph's false claim ("nothing leaves", "no IP
  address, ever") is corrected; a test fails on any host not on the list.
  Eval: the everyday suite has no test scripts on purpose (a person's folder
  has none); the Claude Code baseline is internal, never copy, runs hermetic
  (a scratch config, the same doors as the engine's eval approver), and the
  eval approver gained a file-move door (mv, cp, mkdir, ls inside the
  workspace, no chaining, nothing outside).
- **Release tiers (founder, 2026-09-27):** "pull crew and terminal into standard
  v1. V2 will be currents, stack health, and launch. V3 marketplace. And v4 is
  the enterprise track with admin configuration and project permissions ...
  Let's just build personal for now and get that working fully." One gate,
  `app/src/lib/focus.ts` (the earlier focus flag, rebuilt as tiers), read by
  every door; a build is Personal unless `VITE_RELEASE_TIER` names 2, 3 or 4,
  and nothing shipped sets it, so every build is Personal today. The test
  suite runs at tier 4 so the later tiers' code stays tested, and
  `test/tierPersonal.test.ts` reloads the modules as a Personal build.
  Judgment calls: Vault stays in v1 (the founder named no later tier for it);
  Wayfinding Memory stays (Skills and Browser switches are hidden because
  nothing reads them, not because of a tier); "teams" covers team projects,
  sharing, the roster, project permissions, the team vault and the Business
  account choice, so a new account in a Personal build is Personal with no
  question; an account saved as a company by an earlier build keeps its type
  on disk (its team surfaces are hidden, its data untouched); a Current placed
  in a stack by an earlier build sits out of a Personal turn without losing its
  placement; the Harbor download stays in place instead of the Library intro
  over the Local Library; the guide's cards and facts name only the build's
  rooms; What leaves this device lists only what the build can do. Unlocking a
  tier for release is a founder call recorded here. `docs/release-tiers.md`.
- **Personal v1 readiness (2026-09-27, from an audit of the Personal flows):**
  the Personal price label is $50 a year (the founder's figure and the CFO's
  ruling; the Board vote stands) and the App Store's own localized price wins
  wherever StoreKit reports one; the paywall carries Terms of Use and the
  Privacy Policy (Apple 3.1.2, `openshore.ai/terms/` and `/privacy/`). Copy
  says what is true: chatting and building need no account, buying Personal
  does, chats are not synced between devices. An offline launch keeps the last
  server-verified entitlement until it lapses, else on an iPhone StoreKit's own
  verified subscription (a local unlock only; the server still decides once
  reached). Settings shows Personal's standing and Restore. Crew's create and
  Run now sit behind `personalUnlockedNow()` like the coding agent (no effect
  while the gates are off). A Claude key needs a workspace id only when Claude
  says so. Install by name moved into Stack (the Local Library is v3). The
  terminal says when it lost the computer or was refused. A revived daemon
  session keeps the app's Humanize, Memory and Chain of Thought switches
  (info.json `switches`). Undo's snapshots are held by per-record refs and
  collected after 20 records age out, never objects younger than two days, so
  a running task's starting point is never taken.
- **The four privacy calls (founder "take care of the privacy calls based on
  your recommendations", 2026-09-27):** each held by
  `app/test/privacyCalls.test.ts`. Web search asks once: nothing reaches a
  search service until the person allows it in one sheet (`WebSearchAsk`),
  saved as `webSearchConsent: 'allowed'`; "Not now" holds for this run only,
  so it asks again next launch rather than never; the model is told plainly it
  did not search; Settings, Harbor, "Let models search the web" switches it.
  Every app search runs through `localSearch.ts`'s one gate, and the desktop
  engine is built without the `webSearch` tool (the registry's
  `webSearch: false`, through the bridge and the daemon) until allowed; `webFetch`
  stays, since it fetches a page the person or the task names, and the CLI,
  routines and config keep searching (undefined is on). Desktop updates ask
  before downloading on every platform: `autoDownload = false`, the bar says a
  version is out, the Update click downloads, installs and restarts; the
  check stays and is listed. The guardrail record never uploads the name of a
  person a request was about (`subject: null` on the account; the device copy
  keeps it; consents were already device-only). The repository sign-in
  exchange was verified to keep nothing (no database, no storage, no token in
  a log line) and says so. CX's further point, keeping the guardrail record
  off the account entirely, is not taken: enforcement has to survive a
  reinstall; it is the founder's call if wanted.
- **Accounts (founder + CX, 2026-09-27; `docs/accounts-cx-memo.md`):**
  chatting needs no account (Harbor Lite and Harbor, the Stack, a model you
  connect); everything else is behind a free sign-in: the coding agent,
  Projects, Terminal, Repositories, Vault, Crew, Cloud Connections, pairing
  (and the later tiers' rooms). One pure gate, `app/src/lib/accountGate.ts`,
  classifies every room with a `Record<ViewName, ...>` so a new room is a type
  error until it is; `setView` and `newConversation` open the sign-in sheet
  (`AccountGateSheet`, the sign-in card inside it) instead, a typed first
  message goes back to the composer, and signing in carries on to the room. A
  build with no account backend stays open (`needsAccount`). No account at the
  free gate, per CX (Apple 5.1.1(v), Baymard's 18%, and Harbor Lite's promise
  of answers with no signal). The founder asked for a signed-out reset to
  defaults at each launch and deferred to CX; CX advised against it (iOS ends
  a suspended app without notice, an update relaunches the desktop app, a
  blanket reset reruns onboarding and re-offers a downloaded model), so it is
  NOT built: settings stay on the device for everyone. The benefit of signing
  in is additive instead: eight plain preferences (theme, effort, Humanize,
  Chain of Thought, both notice switches, voice replies, voice speed) follow
  the person to every device they sign in on. Every AppSettings key is
  classified in `app/src/lib/settingsReach.ts` (a Record over the AppSettings
  keys); prompts, work, addresses, keys and consents never follow (web search
  consent and insights included: a consent is made on the device it applies
  to). The copy rides on the account's own user record (`oscode_prefs` in
  `user_metadata`, as `{ v, at, prefs }`), so no table and no migration: pulled at
  launch and at sign-in, pushed 1.5 s after a change, the newer side wins, a
  device that never set one takes the account's, values of the wrong shape are
  dropped. Listed in What leaves this device. A signed-out desktop whose Stack
  can answer opens its composer on the Stack. Someone who used OpenShore
  before the gate, signed out, hears once that their work is still here.
  Offline with an expired token already stays signed in (only a refused
  refresh signs out); sign-out keeps everything on the device. If the founder
  overrules and wants the reset: reset only the 'follows' keys, never a
  'device' one, and say so when the change is made (the memo's copy). Open
  (What remains): in-app account deletion before the App Store build carries
  the gate; a free desktop chat with no Stack set up.
- **The premium build (founder "do the entire build, push to main, make
  this a truly premium coding agent", 2026-09-29):** the plan in
  `docs/next-build-2026-09-29.md` plus a third wave, built as seventeen
  packages in parallel worktrees and merged in order. Every fork went to an
  advisor; the rulings are `docs/design/build-2026-09-29/advisor-rulings.md` and
  each package's own calls are in `docs/design/build-2026-09-29/<package>.md`. The
  calls a later session should not reopen:
  - Gate: the account check sits where a coding driver is built, so an old
    coding chat reopened signed out never drives the engine; sign-out lets go
    of attached coding sessions; `newConversation` returns undefined when
    gated.
  - Headless means offline (CTO 3): a Crew routine has no web, network,
    Codemagic, currents, specialist, vision or image tools, a network-risk
    call is denied (never asked), and the run note says so. "Crew routines
    never search the web." There is no per-routine web opt-in in this build.
  - The served window (CTO 5): the engine budgets against what Ollama
    serves, `numCtx: 'auto'` is not flipped by default, and the "Give it more
    room" action writes it to machine config for one provider.
  - Harness lifts (CTO 6): alternating-repeat detection is on; retrieval
    before turn one (`harness.retrieval.firstTurn`) and union decoding
    (`harness.decoding.union`) are off with `--retrieval` and
    `--union-decoding` eval switches; a seat whose served window cannot hold
    the full prompt gets the lean one whatever its class; a running
    program's reads (`readProcess`) are volatile and never count as repeats.
  - Streaming (CTO 7): Electron streams model replies through a guarded main
    channel (`osc:chatStream`, POST to chat paths only, plain http only to
    loopback, LAN and the tailnet); iOS through the WebView with one fallback
    to the shim; Stop closes the turn at once and the partial answer stays.
    The founder's 2026-09-23 arrival (no caret, a fade over `--dur-6`) stands
    over CX 5's caret.
  - Release integrity (CTO 1, 2, reconciled with CX): every desktop update
    is checked against pinned Ed25519 keys (`app/electron/releaseKeys.ts`,
    empty until the founder runs `docs/release-signing.md`); releases keep
    publishing on every push to main with the write token on the publish
    job only; a signature that is present and fails installs nothing and
    opens nothing; a missing signature or empty key opens the release page.
  - Migrations (CTO 4): account deletion is `0022`, the org free caps are
    `0023`, both pushed from main only; `vault-m2-team` renumbers its
    0020 and 0021 above main's newest when it merges. `0022` also fixes
    `record_enforcement`, which had errored on every call since 0016.
  - The free desktop chat (CTO 8): one engine function serves the phone's
    `/chat` and the desktop's `osc:freeChat`; signed out, the desktop's
    default is this free chat; it builds no vault pack.
  - Store split (CTO 9): not in this build; new logic lives in sibling
    modules (`state/gateOps.ts`, `signinOps.ts`, `firstRunOps.ts`,
    `accountDeletion.ts`, `rewindOps.ts`, `harnessOps.ts`); Launch and
    Repositories are the pilot slice of the next build.
  - Windows (CTO 10): Git Bash, else pwsh, else powershell.exe, never WSL's
    bash; a `windows-latest` CI job runs the engine and the Electron-side
    tests.
  - Wave 3 (CTO): long-running processes, rewind, and repository commands
    (`.claude/commands`, skills) are in; MCP servers, hooks, subagents, a
    classifier call, and vision on desktop sessions wait for a design pass.
  - Sign-out is local (`scope=local`) with a separate "Sign out everywhere"
    (CX 4); preferences sync is per key (`v: 2`), still without a server
    compare-and-swap.
  - Lockdown is enforced at the one execution seam: every command, commit
    and check asks under Tokens and Secrets, and a commit's flagged files
    start unticked (CX 7).
- **Migrations (CTO 11, 2026-09-29):** production's history decides a
  number. It holds 0001 to 0020, whose 0019 and 0020 are the privacy branch's
  files, pushed from that branch on 2026-09-24 before CTO 4. Main holds them
  byte for byte and never renumbers them, `0019_org_vault_v1` became
  `0021_org_vault_v1` unchanged, 0022 to 0025 keep their numbers, and 0026
  adds the export's new tables and tombstone retention.
  `supabase/production-history.tsv` pins every applied file. CI replays
  production before pgTAP. Every push uses `--skip-vault`. The deletion
  function is one design: main's with the legal-hold copy. This extends CTO 4
  and replaces nothing in it (CTO 1 to CTO 10 are the premium build's). The
  full ruling, with founder decisions F1 to F6, was advisory; the calls a
  later session should not reopen:
  - Never renumber or re-apply the privacy files: a second run of 0019 keys
    every unsubmitted fingerprint twice (its lines 316-326 are not
    idempotent) and brings back its broken `record_enforcement`. Rejected:
    renumbering main's five unapplied files to 0026 to 0030 (churn, breaks
    CTO 4's pinned names), and `migration repair` on production (it rewrites
    a true record).
  - Unapplied files change only where the ruling names them: 0022's appeal
    address is os-code@openshorellc.com (what production shows; F1 may
    change it before the push), 0023's refusal says a deleted note frees its
    space when its history is cleared, about a month later (resolves the
    gate 1 runbook's 0.3a), and 0024 and 0025 change comments only.
  - `export_my_data` is version 2 (0026): 0019's nineteen keys plus the
    caller's revision and settings rows, the tombstone's level (never its
    hash) and the staff flag. `abuse_reports` stay out until counsel rules
    (F4), so no copy says "everything". Every table a migration creates is
    classified as read or left out with a reason in
    `app/test/supabaseMigrations.test.ts`.
  - Tombstones are deleted after two years by `oscode_guardrail_retention`,
    the same bound as enforcement actions, unless the founder records an
    exemption.
  - `delete-account` is not deployed from main until the merged function is
    on main (package C): main's planner and contract, plus the privacy
    function's legal-hold copy into `deletion_holds`, the email cleanup,
    level 2 tombstones only, and an answer both clients read. Production's
    2026-09-24 function keeps working after 0021 to 0026.
  - Guards: the text tests (applied files by hash, unapplied files above
    production's newest, no two files with the same bytes, no `[db.vault]`
    in `config.toml`, every documented push with `--skip-vault`, no stale
    org vault name); `.github/workflows/migrations.yml`
    (`supabase/scripts/check-migrations.mjs`, warnings for other branches on
    a push to main); the founder's `supabase/scripts/push-preflight.mjs`,
    which connects to nothing; and CI's `sql-replay` job beside `sql`.
  - Owners, in order (the repo is the channel): A, the reconcile (this
    change); B, reviews (an app session: `reviews.ts`, `reviewsMath.ts`,
    `ReviewsSection.tsx`, urgent, since production's 0020 took anon reads off
    `model_reviews`); then the founder's push of 0021 to 0026; C, deletion
    (the E1 successor: the function merge, the interim app fix first, then
    Download my data, the owner flow and re-authentication per F2 and F3);
    the held branches (the Vault session merges main into `vault-m2-team`,
    `vault-m2-icloud` and `vault-m2-native`); D, app compliance; E, legal
    drafts; F, the Qwen 3B pull (waits on F5); G, DeepBlue and eval docs.
    Every session merges main before it touches `supabase/`. When B to E are
    on main, the privacy branch is recorded here as superseded, kept, and
    its head `d3d4bb7` tagged `prod-source-0019-0020`.
  - Build calls made while landing package A: the replay fixtures live in
    `supabase/replay/`, not `supabase/tests/replay/`, because
    `supabase test db` runs every `.sql` file under `tests/` through pg_prove
    (checked on 2.118.0). The file hashes read CRLF as LF, so a Windows
    checkout pins the same value. `check-migrations.mjs` never counts a file
    production ran (named and hashed in main's history) against a branch,
    and lets one of main's unapplied files move, bytes unchanged, to a number
    above production's newest; only while main has no history file yet does
    the branch's own copy stand in. The tag waits for the founder's go-ahead,
    since creating it is a push.
- **Guardrail data has retention limits and a keyed hash (advisory org,
  2026-09-24, founder delegated; arrived through the privacy branch, recorded
  on main by CTO 11).** Block rows are kept 180 days and enforcement actions
  two years; block rows carry no subject name; allowed-with-consent rows stop
  going to the server and existing ones are purged (consent assertions
  already stay on the device); the text hash becomes a server-side HMAC;
  records tied to a submitted report are held at least one year under 18
  U.S.C. 2258A(h). Production's 0019 embodies it. Stands until a later ruling
  names it.
- **Account deletion ships with Download my data (advisory org, 2026-09-24,
  founder delegated; arrived through the privacy branch, recorded on main by
  CTO 11).** Owners transfer ownership or delete the org inside the same flow;
  deleting an org cancels its Stripe subscription under the refund rule, with
  "Cancel renewal instead" offered first; Apple subscriptions are cancelled by
  the person in iOS Settings; rows under legal hold outlive the deletion until
  the hold ends. CX dissent recorded (pro-rata refund on org deletion).
  Production's 0019 and its 2026-09-24 function embody it; main's owner flow
  and refund differ, and those are founder decisions F2 and F3 (CTO 11).
  Stands until a later ruling names it.
- **Community ratings show the raw average (advisory org, 2026-09-24, founder
  delegated; arrived through the privacy branch, recorded on main by
  CTO 11).** Raw mean with the count, no average under five reviews, the
  benchmark fit on its own labeled axis, no `user_id` for anonymous readers,
  a server-set "OpenShore team" label on staff reviews, published community
  guidelines, and a 24-hour look at reports. Supersedes the benchmark-shrunk
  average. CTO dissent recorded (shrinkage resists brigading). Production's
  0020 embodies the server half; the app half is package B. Stands until a
  later ruling names it.
- **Contact inboxes are role addresses on openshore.ai (advisory org,
  2026-09-24, founder delegated; arrived through the privacy branch, recorded
  on main by CTO 11).** support@, privacy@, legal@, and copyright@ route to one
  monitored inbox once a test message makes the round trip; until then
  os-code@openshorellc.com is the only published address, in the repo Terms
  and on the site alike. Production's 0019 and main's 0022 warn with that
  address, and since package C (below) the app's `SUPPORT_EMAIL` and the
  Terms say it too. Stands until a later ruling names it.
- **Published address is a commercial virtual mailbox (advisory org,
  2026-09-24, founder delegated; arrived through the privacy branch, recorded
  on main by CTO 11).** It appears in the site footer, the privacy policy, the
  Terms notices, the App Store listing, and list email; the registered agent
  address is for service of process only, and a residential address is never
  published. The founder supplies the literal address. Stands until a later
  ruling names it.
- **Account deletion is one design, and main reads reviews from production's
  view (packages B and C, the CTO closure memo, 2026-09-29; founder yes to
  its item 1a).** Built on `prod-reconcile` with package A; unapplied, pushed
  from main only through `docs/vault-gate1-runbook.md`. The calls a later
  session should not reopen:
  - The deletion's database writes are four SECURITY DEFINER functions in
    0022 section 6 that only the service role may call, so each rule lives
    beside its pgTAP: `account_deletion_hold` (the privacy function's
    legal-hold copy into `deletion_holds`, same shape, under a SHA-256 of
    the user id; append-only: identical held rows add nothing, changed ones
    add a newer copy, nothing is edited or removed, and an advisory lock
    keeps two taps from both inserting), `account_deletion_orgs` (the owned
    teams, all or none, in one delete statement after locking the teams and
    their member rows, only while nobody else is active; an active row with
    no user id is nobody), `account_deletion_tombstone` and
    `account_deletion_memberships`. `delete-account` keeps main's planner
    and fixed error codes and answers
    `{ ok: true, deleted: true, appleNote }`, so either app contract reads
    success.
  - Order: plan and refuse, cancel Stripe, copy held rows (before anything
    is deleted), delete the teams (fewer back than planned answers
    `owns_org`), tombstone, clear team history, memberships, `deleteUser`.
    Since the review (2026-09-30, below): the team delete comes before the
    held-row copy, so the order is plan and refuse, cancel Stripe, delete
    the teams, copy held rows, tombstone, team history, memberships,
    `deleteUser`.
    Known limit, accepted: in the moment between the plan and the team
    delete a teammate can turn active; then nothing is deleted and the
    answer is `owns_org`, but that team's subscription is already
    canceled. Billing stays first because a Stripe failure must leave the
    account whole and a retry must still see the team's billing.
  - Tombstones (item 4a): level 2 only, `check (level = 2)`, CTO 11's
    domain; written only for an operator's confirmed termination (action
    `terminate`, actor not `system`, record_enforcement's own test), never
    for the ladder's automatic one, including the one a tombstone itself
    causes on a returning account. `terminated_at` is that termination's own
    `created_at`; a second write keeps the later of two terminations' times
    and never the time of the write, and 0026's retention deletes a tombstone
    two years after `terminated_at`. Rejected: main's first design (level 1
    and 2, `recorded_at` refreshed on every deletion), which turned an
    automatic decision into a binding ban and let a ban renew itself past two
    years by deleting the returning account.
  - Email cleanup (finding (c), CX: erase it): rows bound to the account go
    by id; rows nobody has claimed (user id null) go by the account's
    confirmed email, lowercased, as `claim_membership` and `export_my_data`
    match it. A row bound to someone else stays whatever its email says.
  - Download my data includes the caller's `push_sends` and
    `likeness_consents` (0026): both are keyed to the person and no schema
    reason keeps them out.
  - F1 (superseded 2026-09-30, below: support@openshore.ai):
    os-code@openshorellc.com is the one published address in 0022's
    ladder, the engine's `SUPPORT_EMAIL` (the block card and, through
    `os-code/protocol`, the Delete account sheet) and `docs/terms-of-use.md`;
    `app/test/contactAddress.test.ts` fails when any of them differs. F1 may
    switch it later only through a new migration for the ladder (0022 is
    never edited once production runs it) plus the constant and the Terms in
    the same change.
  - The interim app fix reads both functions: `ok` or `deleted` is success
    (a missing `appleNote` shows the Apple note as an if), `code` is read
    before `error`, `transfer_or_delete_org` is `owns_org`, and
    `reauth_required` says the account was not deleted and asks for a fresh
    sign-in. It shipped with the function, so a build from main is right
    whichever function is live.
  - Deploy: `supabase functions deploy delete-account --use-api` on push
    day, after all six files applied (runbook 7.4), never before; the
    runbook first checks the live function's deployment date (2026-09-24 is
    the privacy branch's). Deploying drops the 2026-09-24 function's
    ten-minute re-sign-in check, deleting a team that still has members, and
    refunds, until the privacy branch's own PR (F2, F3).
  - Package B ports what production's 0020 requires and nothing more: every
    list reads `model_reviews_public` (no author id; `is_mine`, `is_staff`
    and the "OpenShore team" label), and Block names the review
    (`block_review_author`) and reloads. The raw-average half of the
    2026-09-24 ratings ruling (no benchmark shrinkage) is app behavior
    production does not run, so it rides with the privacy branch's own PR.
  - `supabase/scripts/local-vault.sh` is an allowlist: only `start`,
    `db start`, `db reset` and `db push --local` run, and every flag naming
    a project or another `supabase/` folder is refused first.
  - The collision guard's known limits (`check-migrations.mjs`,
    `migrations.yml`): it compares one tree with `origin/main` and main's
    `production-history.tsv` only. Two unmerged branches that take the same
    new number both pass until one merges; then the other fails on its next
    push or PR, and main's scan lists it as a warning, never a failure. It
    sees production only through the history file on main, so a push made
    outside the runbook and never recorded there (the 2026-09-24 case) is
    invisible to it; only the founder's `push-preflight.mjs`, comparing the
    live history's CSV with the file, catches that, on push day. It runs on
    pushes that touch `supabase/` and on PRs, and it compares names, numbers
    and bytes, not what a file does.
- **The review of prod-reconcile (2026-09-30).** Unapplied, on
  `prod-reconcile` with packages A to C. The calls a later session should
  not reopen:
  - Push day is six files, 0021 to 0026. The closure memo says "push 0021
    to 0025" and leaves the export's coverage of `org_vault_revisions`,
    `org_vault_settings` and `enforcement_tombstones` to the privacy
    branch's PR (its item 7); both are read under CTO 11, which adds 0026:
    it carries the memo's ruled two-year tombstone expiry (a cron change has
    to live in a new file, since 0019 is applied) and the export additions
    item 7 had deferred. The runbook, the README and PROGRESS say six.
  - Delete account, `unauthorized` (main's function) or `not_signed_in` (the
    2026-09-24 one): neither function can tell a dead sign-in from an
    account already gone, so the app asks `GET /auth/v1/user` once with the
    same token. 403 `user_not_found` (gotrue v2.197.0, checked on the local
    stack) is a deletion: the goodbye, signed out, the Apple note as an if.
    Any other 401 or 403 (`session_not_found` after a sign-out everywhere,
    `bad_jwt`) signs the device out with a sheet that claims nothing about
    the account, and keeps a pending Apple receipt. A 200 is a failure.
    When the auth server cannot be asked either, it is a failure (the one gap
    left, PROGRESS What remains). No session at the door (the refresh token
    was dead) is the same signed-out sheet. Neither function changes.
  - `billing` and `billing_failed` have their own line, which names the
    published address; `failed` keeps naming the connection. The re-sign-in
    line names the live function's ten minutes.
  - PostgREST answers a void function with 204 and no body (postgrest
    v16.3); `rpc` and `rpcPublic` read that as no value. It broke Block this
    user, and every void call through them (`delete_org_project`,
    `set_org_project_access`, `revoke_org_project_access`,
    `org_vault_delete`, `admin_set_review_status`,
    `admin_mark_report_submitted`).
  - `local-vault.sh` refuses every argument that starts with a project flag's
    name (`--linked=true`, `--linked=1` and the rest are `--linked` to the
    CLI), marks the local stack only by `--local` or `--local=true` and
    refuses any other `--local=`, and reads past the values of the CLI's
    value-taking global flags (`--agent no`) to find the subcommand.
  - `account_deletion_orgs` is all or none over every team named, not only
    the ones still owned: a named team that support handed over after the
    plan returns `{}`. `delete-account` copies the legal hold after the team
    delete (deleting a team touches no held row), so `owns_org` leaves no
    copy behind for an account that stays.
  - `export_my_data` matches by email only rows nobody has claimed (a row
    bound to another account under the same address is theirs, as 0022 6d
    keeps it), and finds a tombstone by the account's confirmed email, not
    the token's.
  - 0026 stops, naming the owner, when another role owns
    `oscode_guardrail_retention` (pg_cron re-schedules only the current
    role's jobs); runbook 5.2 shows `username` and stops first.
  - `check-migrations.mjs` now fails a tree missing a file production
    applied, and a copy of a file beside its original (the relief rule
    covers a move only); the known-limits bullet above no longer covers
    those two.
  - The "OpenShore team" label reads `--wave-ink` (`#3a6f7d` light, 4.5:1 on
    `--surface`), ported from the privacy branch.
  - Second review of these fixes (2026-09-30, low findings only), on the
    same branch:
    - Delete account: only GoTrue's `session_not_found` reads as a dead
      sign-in, and `user_not_found` stays gone. `bad_jwt`, and a 401 or 403
      with no GoTrue code, cannot tell, so they never sign the device out.
      When the function answered its no-user code and the auth server
      cannot tell (offline, a 5xx, `bad_jwt`, no code), the outcome is
      `unconfirmed`: "We could not confirm whether your account was
      deleted. Check your connection and try again.", the device untouched,
      never "was not deleted". This supersedes the bullet above that read
      `bad_jwt` as a dead sign-in and the double failure as failed.
    - A request that broke on the way (a dropped connection, an answer cut
      short, anything but an answer from the function or its gateway) is
      settled the same way, since the function may have finished (deleting
      the user is its last step) or may still be running: gone is the
      goodbye, a dead sign-in is signed out, and an account still here, or
      no answer, is `unconfirmed`. "Not deleted" is said only when nothing
      was sent (the session door failed), the function answered that it
      failed, or the function found no account and the auth server shows
      it still here (the final review caught the dropped connection).
    - A dead sign-in (`signed_out`) ends the way the session door ends one
      on `AuthExpiredError`: `forgetSession(true)`, through the new
      `endSignIn` dep, so unsent team vault text stays sealed for the same
      account. A deletion keeps the plain `forgetSession()`. The signed-out
      sheet fits a deletion on this device or another: "If your account was
      already deleted, here or on another device, it is gone."
    - `local-vault.sh` refuses `--wizard` in any spelling, a bare `--` and
      every `--no-<flag>` anywhere (2.118.0 reads `--no-linked` as
      `--linked` and `--no-wizard` as `--wizard`, checked offline; the final
      review caught it), and before the subcommand (and between `db` and its own)
      lets through only 2.118.0's global flags, each checked against its
      `--help`. On 2.118.0 a target flag counts once given, whatever its
      value (checked offline in a folder linked to nothing:
      `db push --linked=false --dry-run` looks for the linked project,
      `--local=false` connects to the local database), so `--linked=false`
      targets the linked project. The earlier comment that `--local=false`
      after `--local` would reach the linked project was wrong; any
      `--local=` but `true` stays refused so a command never says one thing
      and does another. Its test runs every use the runbook, the README and
      CI document.
    - `check-migrations.mjs --scan-remotes` (a push to main, warnings only)
      reports check (d) as one line per branch, "behind main; merge main
      before touching supabase/", with the count; the single-tree check
      still fails (d) file by file.
    - Known limit, accepted: `account_deletion_hold` (step 5) reads the held
      rows once. A legal hold an operator sets between the team delete and
      `deleteUser` (while steps 5 to 8 run) and after that read is not
      copied, and the row cascades with the account. Nothing in the database copies on
      delete. If counsel wants the window closed, the privacy branch's PR
      may add a BEFORE DELETE trigger on `guardrail_events` and
      `enforcement_actions` that copies a held row into `deletion_holds`.
    - The runbook's Status now points to push day: packages A to C are on
      main (41bea18), section 0 ran clean on 2026-09-30 and is marked done,
      and push day waits for this branch's PR, which changes the unapplied
      0022 and 0026 (2.3 checks for it).
- 2026-09-29: **Desktop releases publish to the public
  `openshore-labs/openshore-releases` repo, not this one.** This repo went
  private (founder, so the code stays closed while the GitHub profile goes
  public), and a private repo's releases are invisible to openshore.ai's
  download buttons and to every installed app's update check. The releases
  repo holds installers only; the publish job uses `RELEASES_TOKEN` (release
  environment) and Codemagic's `GH_RELEASE_TOKEN`, both scoped to that repo
  alone; notes are a fixed line, never generated from this repo's commits; the
  version job reads tags from both repos so patch numbers keep climbing.
  Installs from before the move cannot see the new feed and reinstall once.
- 2026-09-30: **Founder decision F1: support@openshore.ai is the one
  published address.** The founder confirmed its round-trip test. 0022 was
  unapplied, so its warning changed in place with `SUPPORT_EMAIL`, the Terms,
  the pgTAP and replay checks, and the runbook's 8.10; production's 0019
  (applied) keeps its old text and is replaced by 0022's function on the push.
  F6, first fact: the founder ran the 2026-09-24 push; the live
  `delete-account` was deployed that day (the privacy version). Gate 1's
  section 0 ran clean the same morning: history equal to
  `production-history.tsv`, the Vault key present, no leftovers, pg_cron on
  with both jobs, and no rows from 4.2 to 4.5. The founder said yes to landing
  `prod-reconcile` (packages A, B and C) on main.
- 2026-09-30: **The Mac build runs only when started by hand in Codemagic.**
  Founder: Codemagic minutes are metered and every push to main is a release,
  so the release workflow no longer starts `mac-desktop` after it publishes.
  Linux and Windows still ship on every push; Macs update to the newest
  release a hand-started Mac build has uploaded into.
- 2026-09-30: **The curated models move to Apache weights: Harbor and
  DeepBlue's floor are Qwen3-4B-Instruct-2507, not Qwen 2.5 Coder 3B.** Founder:
  update the three to the commercially viable Apache 2.0 versions, evals later.
  Of the two routes the 2026-09-24 item named, Qwen3 4B over Qwen 2.5 Coder
  1.5B: a 2025 4B is the stronger coder and reasoner (the catalog's phone pick
  already), the 1.5B scored 0.48 on the published probe, and one set of
  weights serves both slots. The 2507 Instruct build, not the hybrid
  `qwen3:4b`, so no model thinks unless Chain of Thought asks, and the Ollama
  ref is the full tag so a retag cannot change it. The desktop catalog entry
  stays `orchestratorCapable: false` until the box number exists rather than
  inventing an eval. Older Harbor weights are deleted at launch by a recorded
  version, since the slot id did not change. Cost: 2.5 GB instead of 1.9 on
  the phone (a 6 GB iPhone), and a 4 GB CPU computer reads too big for
  DeepBlue. Harbor Lite was already Apache (SmolLM2-135M-Instruct).
- 2026-09-30: **0021 to 0026 are applied, through the SQL editor (founder's
  call).** With one person on TestFlight, the founder chose the Supabase SQL
  editor over `sb db push`. Each of the six files ran on its own, bytes as on
  main at 4ffe370, with a guard above it (runs as `postgres`, the file is not
  applied yet, and the newest applied version is the one before it) and, in
  the same transaction, the history row `supabase db push` writes
  (`version`, `name`, `statements` null). The section 0 preflights had run
  clean that morning. A check afterwards listed 0021 to 0026 in
  `supabase_migrations.schema_migrations`, matched all 31 function bodies the
  six files define to the repo by md5, and found `oscode_guardrail_retention`,
  `oscode_ledger_retention` and `oscode_vault_purge` scheduled.
  `production-history.tsv` gains the six rows. CI's `sql-replay` now skips
  its push-shaped steps (production's rows and the after-push checks) when
  nothing is pending; the next push that adds a file brings fixtures for its
  own rows. The runbook's `sb db push` stays the default for a push with real
  users. Open: the `delete-account` deploy (runbook 7.4) and the section 11
  hand-off (held branches, PR #1).
- 2026-09-30: **Main's `delete-account` is deployed.** The founder ran
  `supabase functions deploy delete-account --use-api` (CLI 2.118.0) from
  main at 81253d0, after 0021 to 0026 were applied. The runbook's no-sign-in
  check answered `{"error":"unauthorized"}`, main's answer (the 2026-09-24
  function answers `not_signed_in`), so the privacy branch's function is
  replaced. In-app account deletion is live for builds from main.
- 2026-09-30: **Release signing keys are pinned.** The founder ran
  `app/scripts/release-keygen.mjs`, put the Windows and Linux private key in
  GitHub's `release` environment (`OPENSHORE_DESKTOP_SIGNING_KEY`; the
  environment already allowed only `main` and `v*`, with no reviewer) and
  the Mac private key in Codemagic (`OPENSHORE_MAC_SIGNING_KEY`, group
  `openshore-mac-signing`, secure), then sent the two public keys, which
  `app/electron/releaseKeys.ts` now pins. From the first build carrying them,
  every Windows and Linux update and every Mac update must be signed with the
  matching private key. Private keys never passed through a session.

- **The team migrations renumbered 0024 and 0025 (CTO 4, 2026-09-29,
  `vault-m2-team`, merged with main at a5c14c3):** `git mv` keeps the bodies;
  only comments changed. `0020_org_vault_move.sql` is
  `0024_org_vault_move.sql` and `0021_org_vault_settings.sql` is
  `0025_org_vault_settings.sql`, above main's 0022 and 0023, so production
  takes 0019, 0022, 0023, 0024, 0025, in that order and from `main` only
  (`supabase/README.md`, Ship order; PROGRESS, What remains, the held Vault
  branches item, now the one sequence both founder gates point to). This
  supersedes every earlier mention of pushing 0020 or 0021 (the K12, L17 and
  M8 entries above), which stay as written. The bodies were checked against
  main's: 0025 re-creates the write RPCs whole, and 0023's caps live in
  triggers for exactly that reason, so they hold; 0022 and 0023 redefine none
  of the functions 0024 and 0025 create; 0023's `org_is_entitled` and 0025's
  `org_vault_entitled` share the row rule and differ on purpose for an org
  with no entitlement row (0025 lets it write in the beta, 0023 still caps
  its bytes). Main's 0022 and 0023 still name 0020 and 0021 in their
  comments; they are left alone, since they go to production from main
  before this branch merges and an applied migration is never edited. The
  merge made `SupabaseRequestError.code` one field for both sources:
  PostgREST's SQLSTATE (OV402, OV403, PGRST202) and an Edge Function's
  refusal word (`owns_org`).

- **The team migrations after the 2026-09-29 interaction review (held `vault-m2-team`, 0024 and 0025, neither applied anywhere):** fixed in the held files, never in main's applied ones: 0025 section 10 keys `org_vault_settings.updated_by` and `org_vault_revisions.updated_by` to `auth.users` on delete set null (catalog-guarded, NOT VALID, orphans cleared through 0022's trigger exception, validated; a partial author index), so deleteUser clears a leaver's id in its own transaction (findings 1 and 3); `org_vault_move` in 0024 and in 0025's re-creation writes its `renamed` revision after the destination, so a free org at 0023's cap can rename (finding 4); the Ship order gains the 0020/0021 preflight (finding 5); findings 2, 6 and 7 are main's account-deletion calls, recorded in PROGRESS, What remains.

- 2026-09-30: **`vault-m2-team` takes main's migration numbers (CTO 11, the
  merge of main at ef3bd2f).** The branch's `supabase/migrations` is now
  exactly main's: the org vault file is `0021_org_vault_v1.sql` (bytes
  unchanged), the team files are main's `0024_org_vault_move.sql` and
  `0025_org_vault_settings.sql` (CTO 11 changed comments only in both), and
  the branch keeps no copy under another number. The two branch entries just
  above stay as written; where they have production take 0019, 0022, 0023,
  0024, 0025, or call the org vault file 0019, CTO 11 supersedes them:
  production holds 0001 to 0020, and the next push is 0021 to 0026 from main
  (`docs/vault-gate1-runbook.md`). The team client merges only once 0021 to
  0026 are in production (the runbook's section 11). `rpc` keeps the branch's
  coded error (`requestError`, so OV402, OV403 and PGRST202 still reach the
  team client) and takes main's 204 read, so a void RPC answers `undefined`.
  The merge of main at 4ffe370 gave main's own text back its bytes where the
  branch had edited it outside the team feature: the M8 entry's founder item
  (6), phase E1's migration line in `docs/next-build-2026-09-29.md`, three
  migration lines of `docs/design/vault-v1-plan.md` (6.2, K19 and L17; the team
  paragraphs the branch adds there stay), and the held-branches line of
  `CLAUDE.md`. The pointer lives here instead: the K12, L17 and M8 entries
  still name 0020 and 0021 as written, and the push they point to is now
  0021 to 0026 from main, per `docs/vault-gate1-runbook.md`.

- 2026-09-30: **The team vault never offers or applies Delete "For good"
  (held `vault-m2-team`, a HIGH review finding).** 0025's
  `org_vault_settings_ok` accepts `delete: "permanent"`, and with it the team
  room armed "Really delete X for good?" and the sheet said "Deletes skip
  Trash and ask twice", but every team delete is `org_vault_remove`, which
  keeps a tombstone and a `deleted` revision (0024) that Trash lists and any
  member restores until the 30-day purge: the copy called a restorable delete
  permanent. The rule is a provider member, not an id check:
  `StorageProvider.unappliedSettings` names the fields a storage does not
  carry out, and the team's (`ORG_VAULT_UNAPPLIED_SETTINGS`) are `delete`,
  `attachments.folder` (a team vault holds notes only) and `templates.folder`
  (its one reader keeps templates out of a model's notes, and no model reads
  team notes in v1, D15). The sheet shows no row for them, `saveVaultSetting`
  answers read-only for them, `vaultCaps` keeps one-tap Trash under a stored
  For good there (so `capsOf` needs no id check), and the team provider
  drops them on every read and every write (setting who may delete
  included). No SQL change: 0025 is main's and about to be applied, and a
  key the row still holds is inert. The other team rows (new notes, open
  mode, sort, Today's folder, format and template, link style and paths,
  font, size, who may delete) were checked against the server and do what
  they say. The same Attachments folder row on a personal Local vault (which
  also keeps notes only) is left for a personal-sheet pass.

- 2026-09-30: **The team room offers only what the server takes, and its
  Trash says the purge's number (held `vault-m2-team`, three medium review
  findings).** (1) The team Trash said notes were "kept in your
  organization's history", but 0021's `org_vault_purge` (default 30 days, run
  weekly by pg_cron with no argument) clears tombstones and revisions past
  that window. The lead now reads "Deleted team notes can be restored from
  here for 30 days." and the line "After that they are cleared from your
  organization's history."; 30 is `VAULT_TEAM_TRASH_DAYS`, a lower bound, and
  `vaultCopy.test.ts` reads the default and the cron line from the
  migrations. (2) The folder sheet offered Delete folder to a member under
  admins-only (0025 refuses it, OV403); it now leaves Delete out and shows the
  note sheet's admins-only line. Rename, Move, New folder, Restore and the
  settings save were checked against 0024 and 0025: a move is not gated by
  the delete rule, a restore is a write any member makes, settings are
  admins only already, and a lapsed plan turns every write cap off. (3) A
  lapsed plan's empty vault offered New note and promised a first note
  (0025 refuses it, OV402); one answer (`newNoteOffered`) now gates the
  header's New note and the card's, and the card keeps only its heading, since
  the lapsed lead above says why. The same class turned up in links: a
  missing link offered "Tap to create it" while lapsed, so the row reads "Not
  created yet." without a tap, and a tapped unresolved link says the lapsed
  line without asking the server.

- 2026-09-30: **Every team write the room can still hand over says the
  plan's line before the server is asked, and a folder's Undo brings back
  only what it took (held `vault-m2-team`, two medium review findings).** (1)
  The quick switcher offered "Today's note" and 'New note "x"' on a lapsed
  plan; New note did nothing and Today said the generic "Could not open
  today's note". The switcher now takes Today and New note from the header's
  own answers (`todayOffered`, `newNoteOffered`, which now also leaves out an
  expired team sign-in), and the store's Today says the lapsed line. The
  sweep of every other write found: no drag and drop, paste or write-back
  from the link suggest in the room (the editor, the only place they could
  live, is not shown while locked); the task checkbox, Mark reviewed, Link
  and the settings save already follow the caps; the agent's approval card
  writes the personal vault only (D15). What could still be tapped after the
  plan lapsed under it now refuses before any server call through one pure
  answer, `vaultTeamRefusal` (`state/vaultTeamGate.ts`): the Undo toast and a
  Trash page's Restore ("Not restored."), a new note from any caller ("Not
  created.", a listed note still opens), a delete ("Not deleted.", which
  also stops the for-good path the caps would pick once Trash is off, and
  says the admins-only line to a member before OV403), the resolve sheet's
  Keep both and Keep yours (the text goes under Not saved with the plan's
  reason and the note shows the vault's version, nothing sent), and a
  rename sheet already up (it says the plan's line and plans nothing). The
  links-left card leaves out Update the rest while links cannot be
  rewritten, where it used to do nothing. (2) A team folder's trash returned
  `f:<folder>` and its Restore brought back every Trash entry under the
  folder, so a teammate's earlier delete came back and the Undo named the
  wrong note. The entry's id now carries the paths that trash tombstoned,
  and Restore brings back only those still in Trash; an id that does not
  say (the old shape) restores nothing. The other providers keep a folder
  trash as one entry of exactly what it took (Local's trash doc, the desktop
  folder's own directory in `.trash`, " 2" beside a name already there, and
  the hub through the same engine), and a new provider contract row holds
  all four to it.
- 2026-09-30: **The team vault says 0023's free space refusal for what it
  is, and inserts beside main's lines instead of rewriting them (held
  `vault-m2-team`, a high and a medium review finding).** (1) 0023 caps every
  team with no live plan (the beta's teams included) at 25 MiB of note and
  revision bytes and refuses growth with check_violation (23514, a 400).
  `refusing` in `orgVault.ts` turned it into a plain refusal, only save said
  it, and Restore, Undo, Today and a rename near the cap said "Try again in a
  moment", which a retry cannot make true. It is now `OrgVaultFull`
  (permanent), matched by its code and 0023's own words (a check constraint
  on a vault table raises the same code in other words and stays the server
  line), and says `VAULT_TEAM_FULL` in 0023's and the runbook's 4.5 terms.
  The copy leaves out 0023's "start a plan to add more": no build offers a
  plan yet, and no price or plan name (a Board gate). `vaultOps` carries any
  refusal for good through `attempt` (its line, and `whole` for a line that
  already names what did not happen), and the store puts the verb first:
  "Not saved.", "Not restored." (Trash and Undo), "Not renamed.", "Not
  started." (Today), "Not deleted.". A folder's Restore is caught note by
  note: a note refused for good stays in Trash and the rest are still tried
  (a smaller one may fit); a plan that is not active, or a failure that may
  pass, stops there; the answer says how many came back and which stayed
  (`RestorePartial`), or throws the refusal when none did. 0023's other cap
  (one team without a plan per owner) is on `public.orgs`, which no vault RPC
  writes, so it cannot reach the vault client; mapping it at org creation
  (`pushOrgToServer`) stays open with deletion.md. The shared fake server
  models the cap in each RPC's write order (0024 moves write the tombstone
  first, so a team at the cap still renames). The resolve sheet's Keep yours
  and the links rewrite pass near the cap still say their generic lines; not
  in this finding. (2) `restoredPath` and `VAULT_SETTINGS_PATH` are back in
  `local.ts` (the team vault imports them from there, no cycle), and main's
  lines in the room, the store, `vaultCaps`, `vaultOps`, `providers.ts`,
  `supabase.ts`, the settings sheet and host, the folder sheet and backlinks
  are restored with insertions beside them (a later JSX prop or object
  spread, a pushed note line, an added union member, a comment after
  main's). What still changes a main line is listed with its reason in the
  change that made this entry.

- 2026-09-30: **Round 5's review: every team refusal says what happened and
  keeps the text (held `vault-m2-team`, one blocker, two high, four medium).**
  (1) A save whose answer came back after its note closed, meeting a
  teammate's change, wrote a keep-both copy outside `saveVaultNote`'s try;
  at 0023's cap the copy was refused and the text was dropped with the
  rejection. The settle is caught and the text rescued (held with
  `VAULT_TEAM_FULL`, or stashed when the failure may pass). (2) The resolve
  sheet's Keep both, Keep yours and Save it again hold the draft with the
  refusal's line on a refusal for good (the cap, or OV402 before the plan
  was read), as the lapsed branch does; a failure that may pass keeps the
  sheet up. (3) The link pass after a rename or move carries the refusal in
  its report (`VaultRewriteReport.refusal`); the toast says "Its links were
  not updated" with the reason, and the links-left card says "Not updated."
  with it and offers no Update the rest. (4) Linking a mention, Mark
  reviewed, a settings save and who may delete answer the storage's line
  verb first ("Not linked.", "Not marked.", "Not saved."), and a settings
  refusal reads the row again. (5) A gone note is gone and a taken name is
  taken: the org Trash answers `missing` for a note already deleted
  (`TrashResult` gains that member, inserted above main's), a delete or a
  rename of it says `vaultGoneToast` and relists, and a folder moved note by
  note carries the conflict that stopped it (`stoppedOn`, `stoppedAt`,
  `theirs`) so the room names the taken note (letter case counts). (6) A
  create that meets 0021's `exists` opens theirs at its own path. (7) Main's
  two throw lines in `supabase.ts` are back, with the coded throw inserted
  above each. The sweep of every other path found four more, fixed the same
  way: a tick refused by OV402, a Restore or Undo of what is no longer in
  Trash ("no longer in Trash", not "still in Trash"), a folder move that met
  a note already deleted (it passes over it, nothing to move and nothing
  lost), and a folder whose first note changed mid-move (no "newer version
  is open" for a folder). Main lines this changes, each because the change
  needs the value main's line cannot carry: `vaultResolve`'s, the link
  write's and the mark write's `} catch {` in the store and `writeOnce`'s in
  `vaultSettings.ts` become `} catch (err) {` (the refusal is read from the
  error); `vaultRewriteNote` and `vaultMarkReviewed` in `AppState`, and
  `VaultMarkResult` in `VaultAboutNote.tsx`, widen their answer by the
  refusal's line (the union a caller must handle). Left as it is: main's team
  export line blames device storage for a failed list (a read, nothing typed
  at risk, and the fix would edit main's catch).
- 2026-09-30: **The Personal paid gate (CTO, CFO, CX).** Only coding,
  building and agentic work is paid, and the gate sits on actions, not rooms.
  Paid (Personal, after the free sign-in; the paywall opens after the sign-in
  sheet when both are needed): starting a coding session (source `desktop`)
  on the desktop or the phone; reattaching or rebuilding one and a command
  inside a coding chat (checked at the build, so a turn already running is
  never cut); the sample project, before anything is copied; creating,
  editing, resuming and Run now of a Crew routine. Free: every chat (device,
  cloud, Stack, a model you connect, `desktop-chat`), web search in chat, the
  Stack, Projects, Repositories, your own Vault notes by hand, the plain home
  shell in Terminal, pairing, Settings, Cloud Connections, reading an old
  coding chat from its saved copy, and pausing, deleting or stopping a
  routine and reading its runs. Enforcement is app-side only: the person owns
  the engine and the daemon. The switch is the build flag `VITE_PAY_GATES`
  (`app/src/lib/payGate.ts`), off by default and set to `1` only in the build
  submitted to App Review; `PAY_GATE` classifies every account feature, so a
  new one is a type error until it is. Stripe on the desktop and the web (the
  `stripe-checkout` function, `{ tierId: 'personal' }`, in the system browser)
  supersedes the 2026-08-31 Apple-only decision; iOS stays the App Store only,
  and its sheet names no other way to pay (App Store 3.1.1). $49.99 a year on
  both rails. No trial at launch (CX); the CFO wanted 14 days, which needs an
  Apple introductory offer and a Stripe trial set the same way, so it is a
  hook to revisit, not a switch. No double purchase: `stripe-checkout`
  refuses while an Apple subscription is active and opens the portal for a
  live Stripe one. A lapsed subscriber keeps everything; only the paid moments
  reopen the sheet, which then says "Your Personal year has ended." and
  offers Renew. Known limit: routines already scheduled keep running on the
  person's own engine after a lapse. The account id rides on an App Store
  purchase as `appAccountToken`, so `apple-notifications` finds the account
  for a purchase Apple completes later (Ask to Buy) when no link row exists.
  CX's bullet "Routines that leave a note in your Vault" reads "in the vault
  folder on your computer" (`ROUTINE_NOTES_PLACE`), since the Vault copy rule
  bars the shorter claim.
- 2026-09-30: **Personal only; the team side waits (founder).** "We're not
  doing the enterprise/team side until later. We're just starting with
  personal." The only thing sold is Personal ($49.99 a year, Stripe on the
  desktop and the web, the App Store on iPhone and iPad). Team setup, Admin
  and a team's plan line in Settings ship only at tier 4 (`SHIPS_TEAMS`,
  `featureOn('teams')`), so no team plan or price reaches a Personal build.
  The team prices in `app/src/lib/plans.ts` (20/100/250/500) are stale
  against the Board's (100/250/500/1000) and are deliberately left alone
  until the v4 tier opens; that session sets them, with a new Stripe price
  object per band.
- 2026-09-30: **The paid plan is called OpenShore Plus (CMO and Creative
  Studio, at the founder's ask).** "No need to call it personal in customer
  copy." Weighed Premium (clashes with the site's free "Premium by default"
  promise), house water names (unclear in a subscription list), and the
  founder's "OpenShore Code" (names the app, not a plan, so it reads as "the
  app costs money"; "Code" leaves out routines and tells non-developers it is
  for programmers; looks like a second app in the App Store; no clean team
  name above it). Plus reads as "more than free", and "OpenShore Team" can
  sit above it in v4. Customer words: App Store subscription and group
  "OpenShore Plus" (1 year), Stripe product "OpenShore Plus" with price
  nickname "Yearly" and statement descriptor "OPENSHORE PLUS"; buttons "Get
  Plus" (not "Start": there is no trial) and "Renew Plus"; lapsed headline
  "Your Plus year has ended."; the Settings row "OpenShore Plus" (Active, Not
  yet); badge "Plus"; unlock toast "Plus is on. The agent can build on your
  computer."; the signed-in account row reads "Your account". Internal names
  stay: the v1 release tier is still Personal, and `personal` ids, the
  product id `ai.openshore.oscode.personal.yearly`, `STRIPE_PRICE_PERSONAL`,
  `buyPersonal` and friends are unseen and unchanged.
- 2026-09-30: **Desktop + phone is part of OpenShore Plus (founder, over the
  advisors' "pairing free").** "Also make the computer+mobile feature gated."
  `PAY_GATE.pairing` is 'personal', on actions like the rest: on a phone,
  Scan and Connect (before the one-time code is spent, so a refused claim
  never leaves a device on the computer this phone did not save), every chat
  with the computer's models, and the computer's home shell; on the desktop,
  the pairing code and QR (Revoke, Turn off and Forget stay free), and
  Connect under "Run on another computer". The free chat with a computer's
  own models stays free on that desktop (CTO ruling 8); the same chat from
  another device is Desktop + phone, so the build refuses it with
  `PaywallLockedError('pairing')` and a parked message opens the sign-in
  sheet first, then the paywall. A lapse keeps the pairing and cuts no turn:
  the next chat or shell on the computer opens the sheet; the vault a pairing
  pointed at the computer stays reachable, since the paid gate never locks
  what a person made (nothing moves, so no J9 step runs). The hub still
  starts with the desktop app (routines need it). The sheet gets its own
  headline, "Reach your computer from your phone.", and a bullet, "Your
  computer from your phone, while it is on". Found on the way: after a
  sign-in, a parked message on a paid chat waited no longer for the
  entitlement read, so a subscriber met the paywall; with the gates on the
  build now waits for that read.

- 2026-09-30: **Round 7, batch 1: team text belongs to its account and to the
  version it was typed on (held `vault-m2-team`, two blockers, six high).**
  (E1) A team resolve choice and the editor's live text leave with a
  sign-out or another account's sign-in; an expiry keeps them only on the
  kept note for the same account, and a team choice is settled only while
  its account is signed in and its vault is on screen (the room shows a
  choice only on its own note, vault and account). (E5) Every team target's
  storage is bound to its account (`state/teamOwner.ts`): each call checks,
  in the turn the provider reads the session for its token, that the
  account is still the one signed in, and refuses for good otherwise; a
  save answered after its account left keeps the text for that account; a
  replay stops when its account leaves; a team ref naming no account speaks
  for nobody; `isActiveVault` compares the team vault's account. (E6) After
  an expiry, a choice tapped waits for the same account's return with its
  words in the sealed stash, and that account's holds stay sealed. (E7) A
  Not saved entry's id names the note, the account and the sitting (the
  open note's `loadedAt`, now always later than the last); a hold replaces
  only its own sitting's older text or the same words, and a refused save
  keeps an earlier sitting's stashed words beside it. (E2) A task tick reads
  the note once and toggles and guards on that read, and the body cache
  never pairs an older body with the open note's version. (E3) Opening a
  note leaves an open one as it is, waits up to 2 s for this device's save
  or replay of it, and drops an open a later tap came after; a save landing
  on a note opened after it began reloads a clean editor or asks. (E4) A
  save's metadata-only retry, and the delete's, compare theirs with the text
  they began on. (E8) A replay landing on the open note reloads a clean
  editor or asks, never adopts under an older read. Main lines this
  changes, each because the fix lives in them: in the store, the sets in
  `forgetSession` and `onSignedIn`, `vaultTarget`, `vaultTargetFrom`,
  `isActiveVault`, `putVaultNote`, `readBodyOf`, `reloadOpenNote`,
  `recheckOpenNote`'s adopt, `heldDraft`, `keepNewest`, `holdVaultDraft`,
  `keepUnsentTeamText`, `rescueVaultDraft`, `adoptReplayed` (now async),
  `replayVaultPending`'s filter and loop, `leaveVaultConflict`,
  `saveVaultNote` (its retry and success), `settleSaveConflict`, `vaultOpen`,
  `vaultCloseNote`, `setVaultScope`, `vaultSave`, `vaultDelete`'s retry,
  `vaultDiscardHeld`, `vaultToggleTask`, and each `loadedAt: Date.now()`;
  `toggleTask` and `tickOnce` in `vaultOps.ts`; `conflictHere` in
  `VaultScreen.tsx`. Main tests: the room's choice fixture names the vault
  the room is on (`local`), and the frontmatter tick expects no write
  attempt on a changed note.
- 2026-09-30: **Plus opens every room but five, and the free sidebar shows
  it (founder, with a screenshot of the drawer).** "Basically everything
  except chats, projects, stack, cloud connections and settings should be
  gated." This supersedes the advisors' "on actions, never rooms" for rooms:
  `PAY_GATE` now marks Terminal, Repositories and Vault paid beside coding,
  Crew and pairing, and Stack Health (v2) gains its own feature, `health`,
  behind the sign-in and paid (so `ROOM_ACCOUNT.stackhealth` is no longer
  null). `roomPaid(view)` reads the classification; `setView` and `goBack`
  open the paywall for a paid room after the account door, remember it, and
  a purchase carries on there; dismissing forgets it. A sign-in carried on
  to a paid room waits for the entitlement read, so a subscriber walks in.
  The sidebar: with Plus (and in every build while `VITE_PAY_GATES` is off),
  the layout as it was; without, the free rooms move up top (Chats,
  Projects, Stack, Cloud Connections, Settings, derived from the same lists
  in order), the sign-in card stays between the groups, and the bottom group
  is a gold "Upgrade to OpenShore Plus" banner (its own `--plus` token, kept
  apart from spend amber and the people-signal honey; it opens the sheet)
  above every Plus room, greyed but live (a tap opens the paywall; the label
  says "part of OpenShore Plus"). The sheet's headline for a room or the
  banner is "All of OpenShore, with Plus.", its body names the free four,
  and a bullet names Terminal, Repositories, and Vault; the sign-in sheet
  says Plus comes next for a paid feature while the gates are on. Kept: what
  someone made is never locked away (notes on disk and in Obsidian, a
  pairing, a routine already scheduled), and a chat's vault pack still reads
  notes that exist; Projects stays free, so a project's repository link
  opens the paywall only at Repositories.

- 2026-09-30: **Round 7, batch 2: nothing of a note, a draft or a name is
  lost or shown to the wrong account, and the room says what is true (held
  `vault-m2-team`, eight high).** (E9) A stashed draft whose guarded replay
  finds its note moved or deleted is held under Not saved with the gone
  reason and the gone toast, never made again: this supersedes the Vault M1
  line above that brought it back with `ifAbsent` (the M0 rule), for every
  storage with compare-and-swap; only a draft with no base (a note made
  offline) is written as a create. (E10) Every stash entry carries its
  sitting (the open note's `loadedAt`) and a stash time always later than
  the last, and each save carries the time it was asked for: a save settles
  only its own sitting's older entries (data-1 still holds there), one
  writer (`stashDraft`) never writes over newer words, and an earlier
  sitting's words no editor showed go under Not saved before newer text
  takes their place, or stay for the replay, which keeps them beside the
  note. (E17) A save to a storage whose writes cross the network (the team
  vault, your computer) writes its words to the sealed store first
  (`oscode.vault.inflight`, apart from the stash, so the chip and the
  replay never see a save still running) and removes them once it settles;
  what a launch that ended left there goes to the stash on the next refresh
  and replays at its version. Team entries follow R-19. (E12) One helper
  clears what the room holds of a vault (list, note, folders, Trash, the
  folder to return to, whether it listed) at a scope switch and at both ends
  of a sign-in. (E13) A team vault's remembered empty folders and Recent are
  keyed by account (`org::<org>::<uid>`), a sign-out drops them all and a
  sign-in or an expiry keeps only that account's, and the role is read in
  the org this device points at, so an account outside it gets no team
  vault. (E18) The open note says `held` once the last save of its sitting
  is set aside, and the chip says Not saved (no Try again) while it is.
  (E20) A team folder delete stopped part way answers ok for what went,
  with `partial` (how many, what is left, why, `lapsed` for OV402); the room
  says so, stays in the folder and offers that Undo unless the plan lapsed.
  (E22) The team client makes no note and moves none onto a name in Trash
  (the tombstone would be revived and the deleted note would leave Trash):
  a refusal for good, "is in Trash. Restore it from Trash, or use another
  name."; Restore still revives its own name and passes over a
  "(restored)" name in Trash, a keep-both copy goes on to the next name,
  and Save it again on a note a teammate deleted meets the same rule (the
  text is held; Restore brings back theirs). The race between the check and
  the write needs a 'trashed' conflict in 0021's and 0024's functions, a
  later migration and a founder gate. Main lines this changes, each because
  the fix lives in it: in the store, the sets in `forgetSession`,
  `onSignedIn` and `setVaultScope`, `editEmptyFolders`,
  `refreshVaultFolders`, `editVaultRecent`, `noteVaultRecent`,
  `vaultRecentRing`, `refreshOrgRole`'s query, the `VaultPendingEntry` type,
  `pendingEntry`, `rescueVaultDraft`, `stashConflictText`,
  `keepUnsentTeamText`, `replayVaultDraft`, `replayVaultPending`'s toast,
  `saveVaultNote`'s success, `settleSaveConflict`'s stash drops,
  `reloadOpenNote`, `writeConflictCopy`, `vaultCreate`'s offline branch,
  `vaultSave`, `vaultRefresh`, `vaultDeleteFolder`, `forgetTeamVaultDrafts`,
  `settleTeamVaultDrafts`, `countTeamDrafts` and the `vaultNote` and
  `VaultDeleteOutcome` types; `VaultDeleteResult` and `deleteFolder` in
  `vaultOps.ts`; `VaultSaveStatus` and `vaultSaveChip` in `vaultCopy.ts`;
  in `VaultScreen.tsx`, the save status, `SaveChip`'s role, `offerUndo` and
  the folder delete; `.vault-save-chip.offline` in `theme.css`. Main test:
  the Trash contract's "restore never overwrites" has another writer take
  the name, since the team vault no longer makes a note over one in Trash.

- 2026-09-30: **Round 7, batch 3: the team vault answers only for itself,
  and a late answer, a removal or a rename never says what is not true
  (held `vault-m2-team`, two high, six medium).** (E26) The server's "not
  a member of this org" (a plain P0001, matched by its words) is
  `OrgVaultNotMember`, said as "You are no longer a member of this team.";
  from any call it drops this device's role for that org and takes the room
  back to the personal vault the way a sign-out does, words typed into the
  open note held under Not saved. A removed member's selects answer no rows,
  so one settings read confirms membership before a team note is called
  gone or a team list that had notes is taken as empty; a read that does not
  answer concludes nothing. (E30) A tick is refused while the open note's
  editor holds text the note does not (held, kept for later, or a choice
  open), and an operation that writes the open note reloads the editor only
  when its text is the note's. (E11) A sign-out stops team text speaking
  from its first step, so a save failing while it runs is memory only, and
  `stashDraft` never seals team text for an account that no longer speaks
  (an expiry still keeps it for the same account). (E14) The team provider
  and the settings loader keep a generation that each sign-in end moves on:
  an answer to a call made under an earlier one is returned but never
  remembered, told to the store or cached. (E15) Only a personal rename
  moves a project's pins. (E16) An answer with theirs at another spelling
  of the same name moves the open note, its draft, its stash and the choice
  there, keeping the version this device typed on; Keep yours is guarded
  where theirs is, and lands at once over a pure rename. (E19) OV403 marks
  the plan admins only, as OV402 marks it lapsed. (E21) A team folder
  delete names the notes a teammate saved while it ran, stays in the
  folder, and says nothing moved when nothing did. Main lines this changes,
  each because the fix lives in it: in the store, `speaksNow`,
  `keepUnsentTeamText`'s type and toast, `forgetSession` (now a wrapper
  around `endSession`), `rekeyVaultPath`, the `putVaultNote` of `opsDeps`,
  `recheckOpenNote`'s gone branch, `settleSaveConflict`'s open branch,
  `vaultResolve`'s `done`, Keep theirs and Keep yours, and
  `vaultLoadSettings`'s paint; `resolveEntry` and `loadVaultSettings` in
  `vaultSettings.ts`; `deleteFolder` in `vaultOps.ts`. Main tests: two
  store tests and two provider tests that used "not a member of this org"
  as their example of a server refusal keeping its own line now use 0021's
  "that note path is not allowed", since that raise now has a line of ours.

- 2026-09-30: **The CTO's calls on the widened paid gate (founder: "Have my
  CTO make any outstanding calls").** (1) Stopping, revoking, forgetting and
  exporting are always free: `roomPass` opens Crew while routines exist and
  Desktop + phone on the desktop (Revoke) or on a phone with a paired
  computer (Forget), every paid action inside keeping its door; crew-member
  create and edit gained doors; the routine list is read live at launch with
  the gates on; Settings carries the iPhone's Export your notes (Local
  vault) and Remove per git host while those rooms are shut. Rejected: moving
  the lists into Settings (two copies to keep in sync) and leaving it (a
  routine or a phone credential nobody could stop). (2) Account copy follows
  the flag (`accountCopy(gates)`; the guide card and Harbor Lite too): off,
  no buying; on, signing in opens Projects and Cloud Connections and never
  "building". (3) A free chat keeps reading the vault; writing is Plus
  (`canWrite` drops the proposal tool per turn; handoff save and the pack
  opener hold at the door). (4) Routines keep running after a lapse:
  accepted, since the engine is the person's and pausing on lapse would cut
  scheduled work; Crew says so and stays open to stop them. (5) Launch waits
  up to 500 ms for the cached entitlement with the gates on, a read that
  finds Plus closes an open sheet, and the server's answer outranks a late
  offline one. (6) The flag goes on in TestFlight only after the App Store
  product, the Apple functions and secrets, and the G3 root, through the
  `store_release` input (never the `Harbor-os-code` group). (7) The held
  Vault branches stay as they are (already merged through 48436ff and
  4ffe370); PR #1 merges after the review binary. (8) App Store 3.1.1: the
  restore miss names no other way to pay, the Stripe rows leave the iPhone's
  egress list, and Get Plus signed out opens the sign-in sheet. The gold
  banner still opens the sheet first (it explains Plus), and its Get Plus
  then asks for the sign-in: a deliberate step short of routing the banner
  itself through the sign-in. Founder-only: the store setup and the flag-on
  sandbox run, the desktop flag with Stripe, the sandbox policy before any
  public TestFlight, the review notes and a demo video, and a device check
  that Stop still works on a process after a lapse.
- 2026-10-01: **Paths behind a symlink compare in one space (the Mac build's
  test gate).** Codemagic's iOS build stopped at "Gate the build on the test
  suite": on a Mac every temp folder sits behind a symlink (/var is
  /private/var), which GitHub's Linux CI never sees. Four tests failed there,
  three on real bugs: the harness's Current State line measured jail-resolved
  paths from the raw cwd ("changed ../../private/var/.../a.txt"; now from
  `jail.root`); `realOrResolve` fell back to an unresolved path for a folder
  not made yet, so the vault overlap guard could miss a vault behind a symlink
  (now the deepest existing ancestor, the jail's `deepestRealpath`); and the
  syntax check's error named the probe file by its resolved path (both
  spellings now map back, the resolved one first since it contains the plain
  one). The fourth was a test whose readdir stub keyed on the unresolved root.
  New tests in `security.test.ts` and `loopVaultContext.test.ts` go through a
  real symlink, so Linux CI watches it too; both full suites also pass with
  TMPDIR pointed at a symlink.
- 2026-10-01: **Codemagic builds only when started by hand (founder).** "Codemagic
  should only be triggered for openshore.code.ai if I manually start a new
  build." `ios-testflight` lost its `triggering:` block, so a push to `main`
  starts no iOS build; `mac-desktop` never had one. Every build starts from
  Codemagic's Start new build (or its Builds API), `store_release` off for
  TestFlight and on for the App Review build. The desktop release in
  `.github/workflows/release.yml` (GitHub Actions, not Codemagic) still runs
  on pushes; this call does not touch it.
- 2026-10-01: **GitHub Actions runs only what a push needs (founder: "It makes
  me run out of mins. I'm a one man team so I put everything on main").** The
  repo is private, so Actions minutes are counted, and Windows minutes count
  double. The desktop release (`release.yml`) no longer runs on a push to
  `main`: it runs by hand (Run workflow, Publish on by default, off for build
  and smoke only) or on a `v*` tag; this supersedes 2026-09-23's "every push
  reaches the desktops". CI keeps `check` on every push and gains `changes`,
  which diffs from the last green CI run on main (so a cancelled run never
  lets a change skip) and runs `sql` and `sql-replay` only when `supabase/`
  changed and `windows` only when the engine, the desktop shell, its tests or
  the dependencies did; Markdown is left out of both. CI can also be run by
  hand, which runs every job. Codemagic is already by hand (same day).

- 2026-09-30: **Round 7, batch 4: the team vault says what is there and what
  it did, and a personal vault keeps main's resolve sheet (held
  `vault-m2-team`, eight medium).** (E23) A Trash entry names the rev its
  delete took (`n:{path}@{rev}`, a folder's `took` as [path, rev] pairs;
  that rev is the 'deleted' revision's, the one the remove matched), and a
  restore reads exactly that revision. It takes its own name back only
  while its delete is still the newest ending there; when a later delete of
  the name is in Trash, that one keeps the name (E22's rule) and this comes
  back beside it as "(restored)", and the line says why. A folder's Undo
  brings back each note it took, at its name or beside what holds it now,
  never passing one over. Ids without a rev restore the newest delete, as
  before. Kept as a limit: Trash lists one entry per name, so an older
  delete at a name that was made and deleted again is reached by its Undo
  only; listing every delete needs a way to tell a restored one apart (a
  migration). (E24) An empty read of a note is always followed by a stat:
  evicted still says downloading (iCloud only), a note that is there is
  read once more, and a listed note the storage no longer holds is said
  gone once, the list taken again, a case twin opened at its spelling.
  Today and New note on a gone name go on to their guarded create. (E25) A
  folder moved note by note moves, once, what is still in the folder after
  the planned notes (a teammate's note added since, one renamed by case),
  as a storage's own folder rename does; nothing left to move is `missing`
  ("has no notes left to move"), never Renamed; links are planned again for
  what moved. (E27) 0023's refusal marks the team `full` (like OV402's
  lapsed mark); a settings read keeps it, a refresh or a new note with text
  landing clears it. While full, New note, Today, Restore, Undo and Keep
  both are refused before the server is asked, and a save that adds text is
  held unsent, said once per sitting; a trim, a delete and a rename still
  go. The first New note at the cap still makes one empty note (nothing
  tells the client sooner). (E28) A save the lapsed plan refused reloads the
  open note to the team's text once its words are held. (E29) vaultResolve
  holds a refused draft for the team vault only; Your computer asleep keeps
  main's { ok: false, failed: true } and the sheet. (E31) Held text follows
  its note through a rename. (E32) A team list that fails after its account
  left says nothing in the next one's session. Main lines this changes, each
  because the fix lives in it: in the store, the `vaultOpen` type and its
  signature, its empty-read branch, `vaultCreate`'s listed branch,
  `vaultToday`'s plan and its made-elsewhere open, and `rescueVaultDraft`'s
  refusal toast (now quiet when the sitting said it); in `vaultOps.ts`,
  `planMoves`'s source read and `applyMove`'s note-by-note loop (now
  `moveNoteByNote`); in `VaultScreen.tsx`, the Undo's and Trash's restored
  toasts and `vaultFolderMovePartial`'s count. No main test changes.

- 2026-10-01: **Round 7, batch 5: the team vault says what is gone, moved
  and refused, truly (held `vault-m2-team`, eight medium).** (E34) A tick,
  Mark reviewed or Link a mention that reads nothing, or whose guarded
  write answers `missing`, asks before it says gone (noteGoneHere: the open
  note rechecked in its save chain, any other stat'd and the membership
  asked, E26) and then says vaultGoneLine, "Not ticked/marked/linked." and
  the gone line, never "try again" or "the newer version is open"; a read
  that throws keeps "try again", a note made offline is never called gone.
  (E35) recheckOpenNote acts only for the sitting it looked at (path and
  loadedAt) and never while, or across, this device's own rename or delete
  (asOwnMove counts them); the save chain is not held for those, since
  they flush it first and would wait on themselves. vaultDelete, main's
  path with no Trash, is left as it was. (E36) A rewrite whose linking note
  answers `missing` looks for it once: another spelling of its name, then
  up to ten notes this device did not know, by text (the one the plan
  rewrites exactly as planned is that note, moved); found, it is rewritten
  there by compare-and-swap; not, its links leave `total` and the toast
  names it ("moved or deleted while this ran"), with no Update the rest.
  (E38) A Trash page Restore of a note goes on only while the note is still
  in Trash by listTrash's own rule (restore takes `{ listed }`); an Undo
  keeps E23's rule, since the server cannot tell a teammate's restore from
  a new note at the name. (E40) A stash moved by this device's rename takes
  the landed version as its base when its base is the rename's guard; a
  storage's own folder rename names no guard, so it keeps both as before.
  (E41) Folder membership is the folder's own spelling (inFolder), the rule
  the tree and every storage's trash use; a new folder's name still folds.
  (E42) A save or new note that waits says why: the team vault being
  updated (OrgVaultNotReady, its line now vaultCopy's), a storage that did
  not answer (5xx, 408, 429), or the connection; the chip says "Offline"
  only for the last, and a stash from before a relaunch keeps today's chip.
  (E43) Team paths follow 0015's 512 characters: keep-both and restored
  names are fitted in the note's own name, and a new note or a rename over
  it is refused before it is sent with VAULT_TEAM_PATH_TOO_LONG; the
  server's own refusal still passes through in its words, as main's tests
  pin it. The shared fake checks path_ok first, in 0025's order. Main lines
  this changes, each because the fix lives in it: in the store,
  `vaultToggleTask`'s read and its `missing` branch, `vaultMarkReviewed`'s
  empty read and `missing` mapping, `vaultRewriteNote`'s empty read and
  result, `recheckOpenNote`'s after-read check, `rekeyVaultPath`'s stash
  line and the deps' `rekey`, `writeConflictCopy`'s and
  `raiseVaultConflict`'s copy names, `rescueVaultDraft`'s stash toast,
  `vaultCreate`'s stash toast and stat catch, and the calls into
  `opsApplyMove`, `opsDeleteNote`, `opsDeleteFolder` and `opsRestoreEntry`;
  in `vaultOps.ts`, `inFolder`, `createFolder`'s exists check,
  `rewritePass`'s `missing` skips, `updateTheRest`'s read loop,
  `VaultOpsDeps.rekey`, `settleMoved`, the note-by-note `moveOne`, and
  `restoreEntry`'s signature; `StorageProvider.restore`'s signature;
  `vaultSaveChip`'s label; in `VaultScreen.tsx`, `notesLeft`'s comment and
  `SaveChip`'s call. No main test changes.

- 2026-10-01: **Round 7, batch 6: the team vault says what it can do now,
  truly (held `vault-m2-team`, three medium, five low).** (E46) Export as
  plain files reads the team vault in its own try: a list that did not
  answer says VAULT_TEAM_EXPORT_UNREACHABLE, a refusal for good says
  "Nothing was exported." and its reason; only the device write keeps
  main's storage line. The personal export's same catch (a hub vault with
  the computer off) is main's and left for a main-side change. (E51) The
  Trash page takes `refused`: on a lapsed plan it says the lapsed lead (and
  the web's export line where Export is not offered) in place of the 30-day
  promise, and offers no Restore; rows stay, named. (E55) Who can delete
  team notes on a plan never read goes to the write, whose own settings
  read answers; a plan read as not an admin is refused here, "Not saved."
  first; setOrgVaultDeleteRole refuses what that read says 0025's put
  would (not an admin, a lapsed plan) before the put. (E33) A list saved on
  the device names each team index as it opens (ids only); a sign-out drops
  every one its account built, a sign-in every one another account built
  (and the last account's team by prefsOwner, for an index from before the
  list); an expiry drops none. (E37) A plan that would refuse a write is
  read again first (teamRefusalNow: one settings read, only on the refusal
  path, only while its account is signed in); a read that fails keeps the
  refusal; a refusal for the free space alone asks nothing (no read answers
  it). A plan learned from a refusal drops that team's settings cache, so
  the next relist reads it. (E39) Trash leaves out a deleted note whose
  text a "(restored)" name beside it already holds exactly (putBack's own
  rule: nothing new would land), found by one plain `like` on "restored";
  edited since, it is listed again; anything that fails keeps every row;
  E38's listed-row check follows the same rule. No twin check: a note whose
  text is live beside it is back, whoever holds its old name. (E44) The
  1 MB refusal's size rounds up to two places through vaultCopy's
  vaultTeamTooLargeLine; main's hubTooLargeLine has the same toFixed(1)
  edge at 4 MB and is left for main. (E45) An open team note on a lapsed
  plan says VAULT_TEAM_LAPSED_NOTE (no export promise; the note offers
  none); the expired sign-in's line wins when both hold. Main lines this
  changes, each because the fix lives in it: in `VaultScreen.tsx`,
  `exportTeam`'s read (`const notes = await vaultReadAll();`, now in its
  own try above main's); in `VaultTrashView.tsx`, the lead and team lines
  and the Restore button (wrapped, so re-indented); in `orgVault.ts`,
  `write`'s 1 MB lines. The store's `endSession`, `onSignedIn`,
  `openVaultIndex` and `vaultToday` gain lines without changing main's. No
  main test changes.
- 2026-10-01: **PR #1 merges with nine low findings open, behind the
  teams switch (founder).** The edge-case review of the team client (six
  lenses, each finding reproduced by a test, then confirmed by a second
  reproduction) found 57: 2 blocker, 16 high, 25 medium, 14 low. The
  founder ruled the rest overkill once the serious ones were fixed: 48 are
  fixed, every blocker, high and medium among them, each with a test that
  fails before its fix; the re-review round was skipped. Open, all low, all
  must-fix before `featureOn('teams')` ships (PROGRESS, What remains): E47
  (an OV402 met before the plan is read makes an admin read as a member),
  E48 (the fake server snapshots every overwrite and models neither
  `org_vault_path_ok` nor RLS for a non-member), E49 (after a renewal the
  Trash row waits for a second relist), E50 (a never-paid team's notice
  can name a passed deadline), E52 (the expired sign-in's kept note is
  never on screen; Today is still offered then), E53 (below), E54 (after a
  scope switch the room runs on the other vault's settings until its own
  read lands; main's `!team` guard was dropped), E56 (DECISIONS lacks a
  reason line for some changed main lines). E57 (a DECISIONS merge
  conflict) is resolved by the merge. E53, the one that reaches a shipping
  build: the branch's refusal and gone handling is provider-agnostic, so
  the personal vaults (Your computer, the desktop folder, Local) now give
  the specific line where main said "try again": a refused delete or Today
  on Your computer names the reason ("Not deleted.", "Not started."), a
  note or Trash entry already gone says so and relists, a refused link or
  settings save says "Not linked." or "Not saved." with the reason, and a
  closed note's keep-both copy that fails is stashed instead of rejecting
  the save. Each is truer than main's line and none loses text; the
  personal-provider tests that pin them are part of E53.
- 2026-10-01: **The app's tests ignore the build machine's `VITE_` values.**
  Codemagic's test gate failed 27 app tests on main once the engine's Mac
  failures were fixed (they had stopped `pnpm -r test` before the app's turn,
  so these had hidden behind them). The `Harbor-os-code` group sets
  `VITE_SUPABASE_URL` and friends for the app build, and those were present in
  the test step too, so every test met an account backend it does not have
  (coding chats behind a sign-in). `app/vite.config.ts` now blanks every
  `VITE_` value from the environment for the test run (keeping the suite's
  `VITE_RELEASE_TIER=4`), the way GitHub's CI runs; a test that needs a value
  stubs it. Both suites pass with the group's values set and TMPDIR behind a
  symlink, the Mac's shape.
- 2026-10-01: **A save keeps a note's creation date to the microsecond.**
  The Mac test gate's next failure: after two saves the creation date had
  moved 1.9 ms earlier (`noteFile.test.ts`, F2, a 1 ms bound). The backdate
  handed `utimes` the stat's whole-millisecond Date; the call takes float
  seconds, and libuv truncates them (to whole microseconds on a Mac, through
  `futimes`), so a whole millisecond landed just below itself and each save
  lost about a millisecond. `writeTemp` now passes `birthtimeSeconds`, the
  birth time's whole microseconds plus half of one, which stays above the
  float's error and reads back to the same microsecond save after save. Kept
  the backdate rather than dropping it (the F2 fallback): the fault was the
  conversion, not APFS. A round-trip test models both truncations on every
  platform, so Linux CI now watches what only the Mac could see.
- **Boot splash restored (founder, 2026-10-01):** the founder asked for the
  previous opening back, "don't make something new, just use what we had", so
  `app/index.html`'s splash is `0eed51c`'s again, byte for byte: the letters
  surface through the waterline with the bounce, ripples, droplets and
  reflection. This reverses the splash part of `60e6ff1` (the Swell Line, the
  dark splash ground); the rest of that brand sweep stays, as do the head's
  dark theme-color metas and the Fraunces preload.
- **The sidebar is the person's to arrange (founder, 2026-10-01):** every room
  moves, in its group or across the recent chats to the other; Settings and the
  sign-in card are pinned under them. The order stays on the device
  (`navOrder: 'device'`), not among the preferences that follow an account,
  since a desktop's and a phone's rooms differ and that list is a short
  allowlist. Recents follow the Chats room's reach (the active project), so
  View all continues the same list. The free layout honors the saved order
  but is not draggable: its two groups are set by the pay gate, not by hand.
- **Voices: English, hand-picked, premium first (founder, 2026-10-01):** "The
  voices are insane and such low quality... just do English... narrow the
  list." The picker offers only catalog voices (`voiceCatalog.ts`), at most
  twelve, each with its accent and a one-word persona; novelty voices and other
  languages never show. The gold standard stays on the device: Apple's premium
  (neural) voices, which the picker names and says where to download when none
  is installed, since no API downloads them for us. A browser's online voices
  are dropped (they send the words to a speech service the egress list does not
  name). A cloud or bundled neural voice would be a separate call.
- **Voices: Siri's where offered, female and male, ten at most (founder,
  2026-10-01):** "just the Siri voices since those all sound the best... a split
  in male/female... no more than 10." Apple keeps the Siri voices for Siri and
  the system; a third-party app's synthesizer is not given them. So a Siri
  voice leads the list, under its own name, wherever a device does list one to
  the app, and otherwise the best on offer are Apple's premium neural voices,
  with the download hint when none is installed. Names only (accents and
  personas dropped), Female then Male, five of each at most. Gender comes from
  the system on iOS (the plugin now reports it) and from the catalog by name
  on the desktop.
- **Chats room polish (founder, 2026-10-01):** "a little more delightful, not
  revolutionary", so the Claude-app shape stays (one flat list, no date
  captions, no cards). Added: a search pill with its icon and a clear button
  that searches inside each chat too, marking the hit and showing its line
  under the title; a reach dot on each row in the house colours (teal local,
  amber cloud) read from the last served model, else the source, and a faint
  ring when unknown rather than a guess; a real plus badge on New chat, hidden
  while searching; Enter opens the top result, Escape clears; and one quiet
  line under the list naming the swipe and the hold. Date grouping was left
  out on purpose, since the earlier Creative Studio call ruled it out.
- **Web search is on by default (founder, 2026-10-01):** "Make sure the default
  setting for models go on the internet is turned on so a user can get actual
  answers from openshore models out of the box." This reverses the 2026-09-27
  privacy call (web search asks once). Unset now reads as on (`webSearchOn` in
  `app/src/lib/webSearch.ts`); only a Settings off is 'declined'. The ask
  sheet is removed rather than left unreachable. A person who once tapped
  "Not now" had nothing saved, so they now search too; one who turned it off
  in Settings stays off. What leaves this device says it is on by default, and
  only the search words leave, as before. Crew routines still never search.
- **Harbor warms up as part of its download, and is the phone's model in every
  status (founder, 2026-10-01):** the load into the one model slot happens
  before Harbor is called ready, so the first message skips "Warming up".
  Load only: the runner sets the system prompt and history fresh on every
  reply, and nothing shows LLM.swift keeping a prompt's cache between replies,
  so a warm-up generation was left out until a device run says it helps.
  Skipped while a chat is writing (a load ends that reply). Promotion runs over
  every status with the existing rule, so a model the person placed in Stack
  is never replaced; a launch does not re-warm Harbor (it would hold 2.5 GB of
  memory on every open), so a relaunched app warms it on the first send.
- **The break after the setup intro, Slack Water, and "help me get set up"
  (founder, 2026-10-01, with the Creative Studio; `docs/design/slack-water.md`):** the
  walk's opening is now the intro alone, then two buttons, Just chat (ghost,
  first) and Start setup (filled); step one waits for Start setup. Just chat
  says the chat-later line, which teaches the phrase "help me get set up", and
  after the reading pause Slack Water carries the person to the main chat page,
  once (the break is asked once per walk). It never moves someone who went
  elsewhere or sent a message meanwhile. "Help me get set up" is heard in any
  chat, including a new chat's first words, and never reaches a model: the
  walk moves to that chat as a list of what is not set up (skips forgotten,
  since the person asked), a picked step is walked without a step number, and
  the list comes back when it lands or is skipped. Pick up setup after Just
  chat opens the same list. The desktop's list is the repository and the API
  key (Harbor and pairing are the phone's). Not built from the Studio memo: the
  buttons fading out before the line inks, and a tap starting the water early.
- **The pairing room is named Pairing (CX-led Creative Studio, 2026-10-01;
  `docs/design/pairing-review.md`):** the founder floated "Hub Pairing"; CX chose
  "Pairing", since "hub" is retired from customer copy by the glossary test and
  one plain word reads right from either device. The glossary retires
  "Desktop + phone" and "Hub pairing". The review's eight bugs are fixed (a
  revoked phone is told so, a spent code is saved before it is checked, Turn
  off holds across launches, revoking cuts open streams, Forget revokes the
  phone on the computer through `DELETE /pair/self`, iPad and time on each row,
  a pairing QR only for the person's own network, a launch-at-login switch),
  and the QR is an `oscode://pair` link the iPhone Camera opens, which always
  asks before it pairs.
- **The sidebar is one group (founder, 2026-10-01):** Crew, Cloud Connections
  and Pairing sit straight under the Vault, with no separate section; the
  later tiers' rooms follow them. An order saved under the old two-group
  default is set aside once (`NAV_ORDER_VERSION` 2); the person can still drag
  a room below the recent chats.
- **Smarter chat names (founder, 2026-10-01):** a chat is named by its first
  message's subject (`app/src/lib/chatTitle.ts`): the polite lead-in and a
  trailing please go, the first sentence stays, the cut lands on a word, the
  first letter is raised; a bare link is "Link from {site}", code is "Code
  snippet", and "help me get set up" is "Getting set up". The setup walk's chat
  is "First-time setup" (the founder's "First time set up and onboarding", in
  sentence case and short enough for the sidebar). A launch tidies chats still
  carrying the old 48-character cut, and never a name the person chose or an
  engine's own title.
- **Your writing voice is its own setting, beside Humanize Writing (founder, 2026-10-01):** the founder allowed either a layer or a separate choice; it is separate, so it works with Humanize on or off, and both ride together when both are set. A prompt in the person's words, so `device` in `settingsReach.ts` (it never follows the account), and it reaches every app-side seat, cloud included, the way a project's standing instructions do: it is the person's instruction, not app state.
- **App actions are proposals the person taps, told only to local seats (founder, 2026-10-01):** "local models should be able to access all of the app components ... excluding the cloud providers". A model never changes the app itself; it puts one exact value in a fence tagged `openshore-set:<key>`, and the chat's card writes it only on Add to Settings. The contract that names the keys rides only to a seat whose requests stay on this network, judged by address (`leaves`), so a cloud provider learns nothing of the app's controls; a cloud seat's answer is copied in by hand. One list, `APP_ACTIONS`, with a value check per key; an unknown key renders as code. The contract rides small local seats too (a few lines; the 2 KB small-seat budget in `stackPromptSize.test.ts` still holds).
- **Nightshore is the dark theme (founder, 2026-10-01):** "make dark mode in
  this theme", from openshore.ai. The dark tokens are the site's own
  (openshore.css): the abyss ground #0b1417, deep-teal cards #10202a and
  #162831, hairlines #24424d, paper text #f6f4ef (never pure white), mist
  #a9bac0 for secondary text, and the bright wave #5bb6cb for the accent, so
  a primary button is turquoise with abyss text, as on the site. It replaces
  the warm brown-black of the first Creative Studio ruling. The ground is
  also what the native shells paint before the page (index.html, the
  Electron window, the iPhone's SceneDelegate, the dark launch splash, which
  now carries the site's turquoise tile so it never vanishes on the abyss).
- **The app icon is a choice (founder, 2026-10-01):** Settings, Appearance,
  under System, Light and Dark: Ink (the default), Turquoise (the openshore.ai
  header tile) and White (an all-white tile, the shore and wave in near-black
  #0b1417). One list, `app/src/lib/appIcon.ts`. On the iPhone it is a real
  Home Screen icon (iOS alternate icons, AppIcon-Turquoise and AppIcon-White,
  compiled in through ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES and set by
  the app's own plugin's `setAppIcon`); iOS shows its own "icon changed"
  alert, which no app can hide. On the desktop the Dock (Mac) or window icon
  changes while the app runs; the installed icon on disk does not, and the
  copy says so. The in-app mark wears the picked tile. Device-local.
  `scripts/gen-icon.py` renders all three; the default PNG is byte-identical.
- 2026-10-01 (founder): the first App Store submission ships with the pay gates off; Plus is built after approval. The gate code stays in the tree dormant (`VITE_PAY_GATES` unset), `codemagic.yaml` drops the `store_release` input, and Settings hides the Plus row while off.
- 2026-10-01 (founder, overriding CTO 3 for search only): Crew routines follow the one "Let models search the web" switch. `webSearch` stays on a headless run when machine config `routines.webSearch` is true (the app carries its switch there through the daemon's `POST /routines/web-search` and the desktop's `osc:routinesWebSearch`, and re-syncs when Crew loads); `webFetch`, Codemagic, the currents and the model handoffs stay off, and an egress lockdown still drops search. Results are titles, links and snippets. Known risk accepted: an unattended run reads search snippets other people wrote.
- 2026-10-01 (CTO security and privacy review, founder-directed, the Proton standard): `docs/security-privacy-review-2026-10-01.md`. Calls: a routine's search runs only on a result-only backend with a short plain query, and stops for the rest of a run once it read anything local-only or secret-shaped (`core/security/routineSearch.ts`); the run note never copies a query. The push token is declared linked. Only blocks the ladder counts reach the server. iCloud Drive is held out of the App Store build (`ICLOUD_HELD`). Plain http to a public host is refused for a model server you connect. A build without Harbor Lite's weights fails. Settings links the privacy policy and terms in every build. Web search stays on by default (founder, 2026-10-01); the CTO recommends asking once, left to the founder. Server minimization is five SQL blocks in the review doc, unapplied.
- 2026-10-02 (founder, taking the CTO's recommendation from the security and privacy review): web search asks once again, superseding on-by-default of 2026-10-01. `webSearchOn` reads only 'allowed' as on; the ask sheet (`components/WebSearchAsk.tsx`) is back; the desktop engine and Crew routines get no search until the person allows it. Guards: `app/test/privacyCalls.test.ts`, `app/test/egressManifest.test.ts`.
- 2026-10-02 (founder): the review's five SQL blocks are applied in the SQL editor and recorded as `supabase/migrations/0027_privacy_minimization.sql` with its row in `supabase/production-history.tsv`. The founder adds the matching `supabase_migrations.schema_migrations` row so a later `db push` skips it.
- 2026-10-02 (founder): the three desktop follow-ups from the CTO review. Desktop secrets sealed under an OS-held key (macOS Keychain, Windows DPAPI) with a one-time move from the hostname key; pairing needs the computer's Allow in a native dialog with a matching four-digit code; opening web pages is a machine setting (`tools.webFetch`: ask by default, always as a blanket yes the founder asked for, or never), never loosened by a repo, and a page on the person's own network always asks.
- 2026-10-02 (founder: "Do it now"): DNS rebinding on a page fetch is closed. `web-fetch` requests go through `pinnedFetch` (Node http/https with a connect-time lookup that is the check), never the platform fetch; `web-search` keeps the platform fetch since its hosts are fixed or configured. No new dependency.
- 2026-10-02 (CTO, delegated by the founder): `claude/settings-polish` fast-forwards to main once the profile stops claiming more than the code does ("Not copied to your account": OpenShore does not copy chats, projects, keys or vault to the account; a desktop vault can sit in a synced folder and Repositories push to git hosts). The iOS "You have changed the icon" alert stays (no private selector, no present swizzle while App Review is pending). No display name on the personal account (the email names it; a member name is designed with v4 teams). Cross-device vault: iCloud Drive after `vault-m2-icloud` CAS; end-to-end encrypted account sync is a later-tier design with a full privacy review first.
- 2026-10-02 (CX, delegated by the founder): a focused field lifts its form's primary action with it only where the form opts in (`data-reveal-with`, `data-reveal-primary`), capped so the field stays in view; Cloud Connections' key form opts in, with `enterKeyHint="go"`, and its workspace hint is one sentence. Projects keeps the Chats room's times ("2h ago", "Yesterday", "Sep 1"); the project room's chat rows keep the reach dot (tenet 4) and drop the model source; the active project keeps its accent edge. The profile's sign-in card drops the repeated perks line (`SignInCard variant="profile"`), What leaves this device opens in place, and Preferences that follow you lands on Settings, This device. Settings keeps its Account group (Restore for App Review).
- 2026-10-02 (Creative Studio, delegated by the founder): light `--ink-soft` #424f57 restores the step over `--muted` #606a6f; an empty sidebar group collapses (`.sidebar-nav:empty`); the desktop Stack joins the Settings ledger (Runs the show, Specialists, prefab stacks, which lead while nothing runs the show; Turn off moves into the picker); a room with a large title tucks the bar's title until it scrolls under the bar (`BackBar titleHiddenUntil`); the icon picker's ring gap is 7px so `--radius-lg` runs concentric with the tile.
- 2026-10-02 (founder, screenshot of Harbor answering a briefing request with an empty writingVoice fence): the app actions contract rides a local seat only once a person's turn in that chat asks for a listed setting (`asks` per `APP_ACTIONS` entry), not on every turn; a prefix-less fence naming a listed key reads as the card, and an empty finished proposal renders as nothing.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Stack's status switch draws its dots by class (`profile-dot docked`, `offshore`, `offline`), never an inline colour from PROFILES, so Offline is the hollow ring there as in the Status sheet and the bar. The `reachDot` rule in app/test/support/uiGuards.ts fails an inline dot background in any file but the Local Library (v3, no door in Personal).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): STACK_LEAD goes back to the Keep list's words, "One model runs the show and hands each task to the specialist that fits. Anything without a specialist, it does itself." The anchor's name stays on the Runs the show row and in the model sheet, and the constant stays, so D2 is still a one-place change.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a guide door on its own line in a card (Walk me through it, Get Tailscale, Can't scan? Type it in) is `.linklike.door`: 14px, one step under the 15px card title, on its own line, and centred under a full-width primary. The centring rule uses the general sibling, so Pairing's typed-entry link holds its place when a status line appears above it. A link inside a `.lead` keeps the lead's size.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Terminal room's first run takes Repositories' order: the steps, Connect your computer as a block primary, then Walk me through it, all in the card, with Not now as a quiet block under it. Crew command's hero keeps Walk me through it as its glass button, because the Creative Studio's sign-off names the two hero buttons on one baseline as a gain. A link there is held with D15.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Terminal room's first-run lead names no switch the page lacks: "Run builds and tests yourself, or let the model run them when you allow it." Terminal Control is named only once a computer is reachable and its switch is on the page.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a Cloud Connections row reads its model count alone ("1 model", "9 models"), since the lead already names your own API key, and a platform without one-tap sign-in reads "Personal access token". Repositories' card no longer names the three platforms, which the list below it shows.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the crew editor takes SheetHead's round close, which stays in view while the form scrolls, and drops Cancel, the same exit as New project.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the composer's + sits 4px into the field, not 8px, so its press disc keeps about 10px from the field's curve, close to the send side's inset.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): while the empty Vault ramp shows, the room draws no lead paragraph, and Where it lives ends the ramp's own sentence ("Sealed on this device. Not a folder other apps can open. Where it lives"), beside the claim it backs.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Vault cover's wash centres at 16% 0%, up by the kicker instead of behind the heading, and in light it is 60% of --accent-soft, which read as a grey smear on paper. Nightshore keeps the full tint. The edge mask is unchanged.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the pinned-notes card's eyebrow is "In every chat here", and its line opens with the button's verb, "Pin notes from your Vault and every chat here starts with them". "Rides into" has left the project room.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the repository sheet's empty action reads "Add a repository", the label of the pill that opens it.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a chat whose reach is not known yet draws no dot, never the hollow ring, which now means Offline only. The span keeps its width, so every row's second line starts at the same edge.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): in Select model, a sub of two sentences ends with a full stop ("Not set up yet. Build your stack.", "Not reachable right now. Reconnect."), and a single phrase does not. Both empty Image reading slots read "None yet", and the local slot says "The cloud model reads images for now."
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Settings, Approvals says what Repositories says: "Commands ask first unless you allow them. Plan and Bypass are set from a coding chat." Terminal Control and a project's always allow both run commands without asking, and the mode pill shows only in a coding chat. The setup walk's "Commands always ask before they run" (guidedSetup.ts, pinned in guidedSetup.test.ts) and the guide's knowledge line are left for a copy pass, since each is true at the moment the walk shows it.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): before pairing, Docked's line names the condition, "Your computer's models, once you connect it.", because its row is disabled and "Connect your computer" is kept for doors that open Pairing.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Pairing's bar tucks the h1's own words, one constant per platform ("Connect your computer" on the phone, "Put this on your phone" on the desktop). The nav row and every Back to label keep the room's name, Pairing.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Add the advisor team shows a count only when part of the team is already there; the line above it already says eight.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Crew command door's unpaired line describes what is behind it, "Routines run on your computer while it is on.", since the door opens Crew command, not Pairing.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the composer's model pill judges an open chat by its own model (`sourceReady(composerSource)`), so a chat opened on a stack that cannot answer yet reads Choose a model too. A pending desktop status still counts as ready, so a launch never flashes the label.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): an empty terminal-mode send waits on the surface like every other send (`.send-btn.terminal:disabled`), so its $ in ink-soft reads 7.0:1 in light and 7.6:1 in Nightshore, where it read 1.1:1 and 1.2:1 on the accent. contrast.test.ts pins the rule and the pair.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a titled chat's bar holds the 61px hairline: the name sits at line-height 1.25 and the repository pill under it at 1.4 with 1px vertical padding, so the two stack in 37.5px of the 40px slot. polish-standards computes the stack from the stylesheet.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Status sheet marks its current choice with the drawn check and aria-current, as Select model and the crew editor do, on a quiet surface fill instead of an accent-bordered card.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the greeting's lines use straight apostrophes like every other line in the app, until a sweep moves all visible copy to typographic ones under a glossary check.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): one rule gives a sheet a 16px beat where a hint or a check list runs straight into its actions (`.sheet .hint + .sheet-actions`, `.sheet .check-list + .sheet-actions`), and Choose repositories drops its inline margin. Block margins collapse in a sheet, so a hint with its own margin takes the larger one.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): on the desktop a Chats row's keyboard ring is drawn on a layer inset 14px each side, its inner edge on the search pill's edge, instead of an outline across the full-bleed row.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Settings' Harbor Lite row reads "Works offline. Here from first launch." (HARBOR_MINI_ROW_SUB) beside its Built in value. HARBOR_MINI_BYLINE keeps all three beats for the model sheet, which has no Built in value, so the byline itself is not cut there.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the API key guide is "Add an API key" everywhere (the setup page, the walk's step, the guide). The step's what line becomes "Use Claude, OpenAI, or Gemini on your own account.", so the step's title is not followed by the same words.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the desktop Stack names each role's model as a noun phrase: the sheet is "Fast model" or "Image reading model", and the danger button "Turn off the fast model". "Model for fast" read wrong for that one role.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the full-screen terminal and the embedded one share one line for a chat with no terminal, NO_TERMINAL_LINE: "This chat has no terminal. Open a repository on your computer to use one."
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the paired Terminal room's Open a repository is a ghost button beside Open a shell and the primary when it is the card's only way forward. A bare .btn read as unstyled text.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the composer's pill keeps "Claude" for a Claude model while the reply label says "Opus 5". The brand sweep (2026-09-24) names a cloud model by its provider in the pill, and sourceShortLabel.test.ts pins it, so matching the two is a separate call.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a SwipeRow paints its action only while the row is pulled (`.swipe-row.open`) and through the --dur-5 spring back. At rest the action's colour bled through a group's antialiased corner as a faint arc (Cloud models). A radius on the swipe layer did not remove it, because both layers sit under the same antialiased clip.
- 2026-10-07 (final check, UI/UX review): the Status sheet's text column takes the row (`.profile-row > .grow`), so the drawn check sits on the trailing edge as in Select model; `.grow` grows only inside `.card-row`, so the check had sat beside the end of the line.
- 2026-10-07 (final check, UI/UX review): the Stack's Local image slot reads "None yet · Nothing reads images." The title already says yet, so the line drops it.
- 2026-10-07 (final check, UI/UX review): a platform row without one-tap sign-in reads "Paste an access token", the form's own noun and a verb like "Authorize with one tap". "Personal access token" was untrue for Bitbucket, which takes an Atlassian API token or a repository access token.
- 2026-10-07 (final check, UI/UX review): Settings, Approvals with Bypass on reads "Bypass is on, set from a coding chat. Commands run without asking. Cloud spend still asks.", not "unless Bypass is on" while it is; Plan reads "Commands ask first unless you allow them." The guide's knowledge line says the same ("unless the person allows them", naming Always allow this in the project and Terminal Control), since the guide answers at any time. The setup walk's pinned "Commands always ask before they run" stays for a copy pass, as recorded above.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): "within the bounds of the current state" (founder brief) is read as polish what exists and build no new feature, room or navigation path. Anything bigger went to the founder as a direction, never straight into build. The pay gate and the later tiers' rooms were left out of the review.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the items routed to the founder and the advisors' direction questions became 23 directions, D1 to D23 in docs/ux-review-2026-10-07.md, each held with its options, a recommendation and the ruling it touches. Questions both advisors raised were merged into one direction each (the reach pill, the anchor's name, the accent's meaning, the empty Vault's story). Where a direction is open, the pass ships only the copy that is true whichever way it is ruled (the unpaired status lines, Image reading naming no model).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): four verified items were dropped. Offshore's grey (C-28) is moot once its dot is neutral and Offline is a ring. The Tailscale download tiles keep their solid accent (C-29), the deliberate app-icon look, now in the Get Tailscale sheet with no primary beside them. Today's note stays on an empty Vault (D-30), a labelled action people use to start a journal. "What it has learned" stays the one name for project memory (D-31) instead of adding "What your agent has learned".
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the review's UI rules live in one helper, app/test/support/uiGuards.ts, as eight rules over source files: the large-title tuck, retired words, button sizes by class, drawn glyphs, teal only for local, the reach dot by class, the icon scale, and the shared stagger. app/test/uiGuards.test.ts runs them over every file no room package owns and each room's uiGuards.<room>.test.ts over its own (ROOM_FILES), so a new file is covered the day it lands and no test file has two owners. One helper was chosen because the TSX rules would have failed on room files in the system wave, before the room packages built their fixes.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): every v1 room whose page title is a large h1 tucks the bar title (BackBar titleHiddenUntil, the 2026-10-02 ruling): the Stack on both platforms, Cloud Connections, Repositories, the Terminal room, Pairing, the Vault tree and note view, Crew, Settings, What it has learned and its note views, and the setup page. Crew command's hero headline is exempt. Pairing is included over its proposed exemption, so the room shows one name at a time. A room with two returns declares one ref per branch, above any early return, because BackBar persists across the branches and re-observes only when its ref changes.
- 2026-10-07 (UI/UX review, system): the tuck rule's exemption for the Vault's bare BackBar is scoped to the VaultFault function, because the Vault room's own BackBar has the same text and a text-only match would exempt the room the rule exists for. uiGuards' stripComments clears whole-line comments first and opens a block comment only at a line's start or after a space or brace, because a glob in a string or a comment ('Private/**', 'lib/voice/*') otherwise blanked up to 41 lines of real code from every guard. copy-glossary.test.ts keeps its own stripper.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): retired words, guarded in every source file through the helper: "Reasoning model" and "lead model" (the name stays Reasoning LLM until D2 is ruled), "Pair your computer" and "Set up pairing" (Connect your computer), "main computer" and "central computer" (your computer), and "About" before HARBOR_APPROX_LABEL, which already starts with about. The match is case sensitive and word-bounded, so modelFamilies.ts's "Reasoning models" stays clear.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): base rules at the root. .sub is muted at --text-3 wherever it sits, so a description never outranks its title (InfoSheet's body drops the class, because it is the copy the sheet exists to show). h1 to h4 default to --weight-semibold, so no heading falls back to the browser's 700, which is off the three-weight scale. A fenced code block draws one frame: .md-code draws it and its corners, and the pre inside drops its own border and radius.
- 2026-10-07 (UI/UX review, system): the root .sub sets colour and size only, no display or line-height, because spans such as Repositories' capitalised .sub and the Vault top-sheet chips sit inline. The press and hover guards in polish-standards walk the stylesheet with comments blanked and read each block's own declarations; the later tiers' and the pay gate's selectors are skipped by name, each with its reason. PROFILES keeps its dot field (ink-soft for Offshore), because the Local Library (v3) still reads it.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Settings group heads and one shared .section-head are the iOS grouped-list head (13px semibold muted, sentence case, on the rows' 14px edge, one rule so the two never drift), so a person can scan eleven groups; the Stack ledger and the profile sheet share it. One .eyebrow replaces the Crew, project and Vault eyebrows, and the old rules (.stack-eyebrow, .project-eyebrow, .vault-kicker) left with their markup. The Claude-style Chats caption, Crew command's section titles, the hero kicker and the sheet group label keep their own roles.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): .btn.sm (the existing 7px 14px compact size, folding in .stack-place) and .btn.block (full width) replace inline padding and width patches, keeping today's shapes; the btnSize rule fails an inline padding or width on a .btn outside the later tiers and the pay gate.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): every press rides the scale property on one of three tokens (--press-scale-btn, -row, -tile), so press-fb and a component's own press set the same property and a button dips once; a .btn.block presses like a row. Every :hover sits inside @media (hover: hover) or (pointer: fine), with active, selected and focus states split out ungated, so a tap on a phone leaves nothing tinted.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a focused field shows one ring, its accent edge and a 3px accent-soft halo (the Chats search's pattern), with no outline, and form textareas drop the browser's resize grip and keep their set rows. Content-sized fields were not taken, because they would start the seven-row Instructions field at four rows on the desktop. The global keyboard ring sets no radius (text links keep a 4px corner), and rows in clipped groups (Settings, the model sheet, Chats, the project room) draw it inset. The focus-trap change was dropped, because the drawer ring in the shots was a harness artifact.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): .topbar holds the phone's 61px plus the safe area as a min-height on every room and device, so the hairline never jumps between rooms. The sidebar head was not resized, since it already centres on that line.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): in-app links (.linklike) and the armed terminal key wear --accent, per the 2026-09-24 meaning split; --link stays on reply links, citations and the Vault's external chip, where blue means the link leaves the app. A selected segment rides one token, --seg-thumb (--bg-raised in light, --surface-hover in Nightshore), so it lifts in both themes instead of sinking in the dark.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): teal means local and private only. A state (Active, Top sheet, Here now, Move here, the active computer) wears the new .pill.ink, a count wears pill muted, and a chosen chip is .suggestion[aria-pressed='true'] in the accent with no weight change. The pillLocal rule allows pill local or an inline --local only on listed lines, each with its reason (a prefab stack's local download size, the via-current chip, a crew member at work on its own computer). In the Vault's Where it lives sheet the ink pill takes a hairline, because its row is a ghost button on the pill's own surface (places sign-off).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the reach dot speaks in ink: Docked green, Offshore --ink-soft, Offline a hollow ring (an inset box-shadow in --muted), so amber stays for spend and the three states still read apart. This was chosen over keeping Offshore amber. The pill, the Status sheet and the Stack draw the dot by class, where the colour guard can see it.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): one profileBlurb in lib/profiles.ts serves the Status sheet and the Stack's status note. Before a computer is connected, Offshore reads "Online. Cloud models and this device's models." and speaks of no computer out of reach, and a row that cannot be picked adds "Not reachable right now." only once one is connected. On the desktop the device is the computer, so it counts as connected and keeps the paired lines.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Vault cover's wash keeps its size and reach and is masked on the top and both sides (mask-composite: intersect), so no seam shows at any width. This was chosen over pulling the inset to 0 with a top mask, which left an edge on the phone's gutter.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): one drawn glyph set in SheetGlyphs.tsx (chevron, check, plus, send arrow, stop, terminal, file, paste, note, lock, more) replaces typed carets, chevrons, checks and emoji, and a disclosure chevron turns on --dur-3 instead of swapping characters. The composer's chips draw a page for a file, a clipboard for pasted text and the Vault's gem for a note, in muted line icons. The terminal's typed $ stays, and its keyboard's arrow keys stay typed, now arrows with spoken labels instead of the words up and down.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): icon sizes stay numeric but sit on 12, 14, 16, 18, 20, 22, 26 and 30, an odd outlier rounding up one pixel. One --disabled-opacity (0.4) serves every disabled control, the Status rows and the Switch included (its inline style went); sheets dim on --scrim; rows that step carry an index (--i) times --stagger, never a step written inline. In Nightshore the default ink app tile takes the White tile's 0.6 hairline in --border-strong, and :where keeps it under the icon picker's own stroke.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): local heroes start on a new :root-only --hero-local-start (#24454f, light's --local-deep), so Crew command and its door are deep water in both themes, and the white primary's label uses the same stop, leaving light mode as it was. The ghost is a 12 percent on-fill glass (the badge's own value), not transparent. The pair shares a row on wide screens and stacks at equal full width on a phone (a 200px basis).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the toast centres with left and right at 0, auto margins and a max-content width, never a transform, so its rise composes and a wrapping toast is not held to half the screen. It wraps on balanced lines up to 440px on --radius-lg, sits 120px up clear of the composer and the Projects dock, and centres on the room beside the desktop sidebar (--sidebar-width, the one copy of 272px). Messages are wrapped, not shortened.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the connection sheet is titled Status and keeps its card rows, the smaller change, rather than the model sheet's grouped rows. Its lede says which models can answer depends on what this device can reach; "the same everywhere" went, since chats, stacks and keys live on the device. Its descriptions sit under their titles in ink-soft, which holds contrast on the current row's fill.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the composer's model pill reads Choose a model, in muted ink with no place dot, until the chosen brain can answer. The chooser's toasts say Choose a model, and the empty Local models line names Harbor in Settings. "On your own API key" stays, since it is the house phrase across the guide and the Stack.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the mode pill shows only for a chat on your computer's coding agent, the one brain that enforces the mode; the Stack's engine step runs Accept edits on its own. Under 430px it folds to its mode's glyph instead of a bare dot, and a touch screen's label leaves out the Shift and Tab hint.
- 2026-10-07 (UI/UX review, chat): the Terminal pill folds to its $ in the same 430px query, keeping its label for assistive tech, because while Terminal kept its word the model pill still cut to "Your ..."; composerPolish.test.ts's pinned mode-fold block is left whole. Select model's subs balance their lines (text-wrap: balance, scoped to .model-sheet, chosen over pretty for iOS WebKit), so a two-line sub never strands one word. The font rules that only styled the removed typed glyphs (.composer-add's size, .send-btn.stop's size) went with them.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a transcript note is neutral ink-soft on the surface fill. The warning ink is kept for a note that reports a failure (.msg-note.warn: a setting that did not save, a trust, window-cut or changed-files error).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): with nothing picked, the repository pill reads Add a repository everywhere it shows, one string in chatRepos.ts rather than a new prop; on the empty home it matches the status chip's 30px height, and the chip drops its stroke. An empty Repositories sheet drops its Search, and its body clears the home indicator itself.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): in Select model every setup route is a full row with a chevron, and Build your stack is the one verb. The Stack row says "Your Reasoning LLM picks which model answers", the desktop engine is "this computer", and the pairing row says "from here, while it is on", since "from this phone" would be false on an iPad. Busy lines use three dots, the house majority, not the ellipsis glyph. The current pick wears a trailing drawn check and aria-current instead of a tint, and Effort moves below Cloud models and Local models, so the sheet reads as one list of models, then one setting.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): on an iPhone the First Seat names Harbor, the model Set up opens, says "Writes and explains code in the chat." and its download size (from HARBOR_APPROX_LABEL), drops the computer's fit and class lines, and its line says "runs on this phone". DeepBlue stays the desktop's seat (founder, 2026-09-21), and the Local Library is never a door from the seat. The offline banner names what still answers on the device in hand: this computer's models on the desktop, this phone's on a phone.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a reply's model label is set in the body face and names the model the way the sheet does (Opus 5, not a raw id). The store hands the cloud drivers the display name (modelLabel), so the drivers stay label-agnostic.
- 2026-10-07 (UI/UX review, chat): "this phone" stays the non-desktop wording (the offline banner, the First Seat) even though an iPad is a target. The app says "this phone" in more than forty places, Harbor's greeting among them, so iPad wording is one later rule, not a per-line fix; the plain browser build is dev only.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the small model's transcript note says the harness carries the checklist once (loop.ts reads the class blurb first). Whether the harness and seat words stay in copy is direction D3, since the convergence memo blessed that sentence.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the chat header's context bar shows from half full and keeps its 75 and 90 percent steps; below that, /cost gives the figure. /help on a phone leaves out the keyboard keys. The midday greetings drop "A good stretch ahead." and swap the two lines that landed at the wrong end of 11:00 to 14:00 for "Midday. Where to next?" and "Plenty of day left." The working row drops Listening (voice mode's word for an open mic) and Gathering (it claims work), and Holding the line stays.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a chat whose project was deleted (unfiled) shows in Chats and in Recents whatever project is active, marked No project in Chats, until the person deletes it, so Delete project's promise holds ("Its chats stay in Chats, outside any project."). One helper, lib/chatScope.ts, keeps Recents on the Chats room's reach (founder, 2026-10-01), so a project-only Recents was not taken.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the room you are in is a filled row (--surface) with ink text, an accent glyph and aria-current="page", stronger than the lighter hover wash. The surface fill was chosen over an accent-soft fill, keeping selection out of the teal that also means private. A page inside a room keeps that room lit: the project room lights Projects, Crew command lights Crew, the full-screen terminal lights Terminal, and project notes light Vault or Projects by where they were opened. Drawer rows reach 44pt; the desktop sidebar keeps 38px.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Chats names its scope in the search field (Search chats in {project}), and Recents names it in the sidebar once there is more than one project, truncating on one line. No switcher or Change link was added.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): an empty Chats shows only its centred empty state and the brand sweep's Start a chat; the New chat row and the search arrive with the first chat, so the compose icon and one more way in stand at every moment. Removing Start a chat was not taken. The empty title stays "Nothing here yet", since the list is one project's and "No chats yet" could be false, and with no project the line says the first chat starts a project called My work. Empty-room titles drop the full stop and share --text-7.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a form sheet has one way out, the round close: New project, Instructions and Pin notes lose their Cancel or Done. The manage-repositories sheet gets the house head titled Choose repositories, with Open Repositories as its exit (its one button when there is nothing to choose; otherwise Save, then a quiet Open Repositories), and its empty line names every host it lists. Delete chat's Cancel becomes Keep it, the brand sweep's Keep-then-danger grammar. A sheet whose body already ends in Cancel, Got it or Close is named by SheetTitle and gains no round close (SheetHead.tsx's own rule).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Chats rows take keyboard focus on the row, not on SwipeRow: Enter or Space opens, Delete or Backspace asks. The hint shows the mouse wording ("Drag a chat left to delete it. Right-click to rename it.") under (hover: hover) and (pointer: fine), and the touch wording everywhere else. On the desktop the row separators stop at the search pill's edge.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the project room's floating pill says New chat; the instructions field says every chat in this project starts with these; the repositories sheet says every new chat here starts with them attached, not that their files ride into every chat; and the Projects empty line drops "rides into". The New project sheet keeps the Claude app's two questions (D12). Making a project active says "{name} is your active project." in both rooms. One glyph per idea: the project tile and the repositories door draw the sidebar's own Projects and Repositories glyphs through an exported RoomGlyph, Instructions gets a three-line glyph, and every more button draws the shared MoreGlyph.
- 2026-10-07 (CMO, UI/UX review): a project with no instructions shows how many chats it holds (No chats yet, 1 chat, 3 chats) instead of Private, a word this app keeps for what never leaves the network.
- 2026-10-07 (UI/UX review, shell): a project pill door keeps its 18px glyph at every width, and below 375 (the narrowest iPhone the app supports) its label ends in an ellipsis instead of the glyph being crushed to a dot. Project notes light Vault when the view trail holds the Vault, and Projects otherwise.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): project memory is What it has learned everywhere (the room's menu, its door, the guide), draws the line lock instead of an emoji, says "Not written yet" for an absent note, and its Turn on in Settings lands on Settings, This device, where the switch lives.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the setup page gets the house top bar with a back to Chat (BackBar) rather than a round close, keeps Back to chat at its foot, drops the leftover "When you're ready to go further" label for one lead ("Everything below is optional."), wraps each headline phrase in a nowrap span so a phone breaks between phrases, and tucks its bar title. Its cards title the thing (Harbor, Your computer, Your code, Your own API key) and keep the verb on the button; "Harbor" was chosen over "Harbor, a coder on this iPhone", which would be untrue on an iPad and the web. The card shape waits for the founder (D9). The Harbor card reads the approved HARBOR_BYLINE plus "Downloads once, about 2.5 GB.", with no new size constant; "real reasoning" leaves the setup copy until an eval backs it; the ready card names Harbor rather than "the coder", and the cancel reads Cancel download.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): repository copy stops promising an ask before every change, since Accept edits is the starting mode. Repositories' lead and the guide say OpenShore shows every change and asks before it runs a command unless you have allowed it, and the setup page says it shows you every change. "Asks before every change" and "with your approval" left repository copy.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): pinned notes no longer claim they stay on this device, since they ride into cloud chats. The card says notes marked private stay off cloud models, and the picker says private notes never reach a cloud model, naming no place, so it is true on a phone, a desktop and the web.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): on the phone's Pairing screen the five Tailscale downloads move into a Get Tailscale sheet and Walk me through it ends the lead, so Scan, the hero path CX set, sits in the first screen. This was chosen over filtering the rows by platform. The steps are a real numbered list (.setup-steps, shared with the Terminal room's first run). On an iPhone the sheet lists macOS, Windows, Linux and iPhone or iPad; the web build keeps Android.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): on a device not yet connected to a computer, Repositories opens with one card above Connect a platform: the code lives on your computer, one Connect your computer primary, and one Walk me through it link. The hint links, the bottom card and the "Menu, then Pairing" line went, the room's heads are .section-head, and the clone flow shows only once connected.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): every button that sends a person to connect a computer says Connect your computer, the pairing review's phone heading, rather than Open Pairing, Pair your computer or Set up pairing: the button names the outcome, and the page it opens wears the same words. Pairing stays the room's name in the nav and the back labels, and the live terminal's door for a device the computer refused reads Open Pairing, since that device was paired once and is sent back to the room.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Terminal room's first run leads with Connect your computer, its only filled button, which opens Pairing and retires the intro. A quiet Not now is kept, so the intro can still be retired without pairing ("Got it" went). One Walk me through it opens the pair-computer guide, which covers Tailscale, rather than a second Tailscale-only link.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): disconnecting a cloud provider, a repository platform or your own model, and forgetting a computer, ask first in the confirm grammar (Keep, then the danger button) in Cloud Connections, Repositories, the Stack and Pairing, and the verb is Disconnect, not Remove. The forget confirm says the computer drops this device only if it is on, because the revoke there is best effort.
- 2026-10-07 (UI/UX review, machines): Pairing's Forget confirm sits outside the Your computers card and stays open while a name is set, so forgetting the second of two computers hides the list and the confirm still plays its exit. The Terminal room's unpaired card ("The terminal lives on your computer") makes Connect your computer a primary, the weight of Repositories' card, because as a bare .btn it read as indented text.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the live terminal's dead ends carry their own door inside the frame, Connect your computer when the computer refuses this device and Try again when it cannot be reached, with the status text in --term-fg. This was chosen over a new prop that swaps the frame for a card. The terminal opened from a chat keeps its own header, so the computer's name stays under the title, and borrows BackBar's chevron and label. End asks first ("Anything running in it stops."); Close, after the shell has exited, does not. End and Close are the small button, so the bar keeps its 61px and the hairline does not jump when the shell becomes ready (machines sign-off).
- 2026-10-07 (UI/UX review, machines): an unavailable answer from openTerminal gets a door like a thrown one, Connect your computer on a 401 or 403 and Try again otherwise, because a paired phone's driver answers rather than throws and a revoked phone's 401 carries no CORS headers. Try again reruns the mount effect through an attempt counter, and the room's key still remounts it for each session.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): one vocabulary for the machines rooms. Place is the one verb for putting a model in the stack, and connecting your own model says Connect. Status pills and chips are Sentence case (Connected, Active, Admin only, the kind chips), the active computer wears the ink pill like every Active pill, and a refused pairing reads Not accepted, a status, because the Scan button below is the action; uppercase stays only for the NOW, GET and BETA tags. The desktop Stack takes the phone's category names and hints, and its anchor chip reads On this computer or Cloud.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Stack's model pickers use the house pick row (.profile-option) with the teal or amber chip and list the current model first, marked Current. SettingsRow was not used, because it puts a chevron on every row.
- 2026-10-07 (UI/UX review, machines): the chosen picker row wears the accent through .btn.profile-option.selected, because .btn.ghost has the same specificity and comes later, so no picker, the old vision one included, had shown its choice. The desktop picker lists the current model first only when Ollama lists it as installed, so it never offers a model that is not there.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Stack keeps the Runs the show head, and one STACK_LEAD in lib/stack.ts serves the phone and the desktop. The anchor row says what that anchor does: a cloud or server anchor "Plans every task and routes it.", a device anchor "Answers each task, or hands it to a specialist.", and Harbor Lite "The built-in guide. Place a bigger model here for real work."
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Stack's Image reading rows name no model they have not been given. With no choice made, the Cloud row says each image asks first and goes to a connected cloud model, or that none is connected; the slot once called On device is Local, matching its intro. Which model the cloud default names is the founder's call (D13), and the play.ts mismatch with the chat path goes to the CTO.
- 2026-10-07 (UI/UX review, machines): the cloud preselect in an Image reading sheet is Claude's default only when Claude is connected, otherwise the first connected model that reads images, so Save never lands on a model this device cannot reach.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Stack's sheets are named by SheetTitle and titled by what they act on (the specialist's or connection's name, Place {model}, Local image reading), the more button is drawn, and How connecting works rises from the bottom like every sheet in the room. Its empty states say where to go in plain words instead of adding door rows, and an unpaired phone's status note no longer says its computer is out of reach.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): where a key lives is said as "on this device", true on an iPhone, an iPad, the desktop and the web, rather than a per-platform keychain line. The camera line says Settings, not iPhone Settings, and Pairing's connected card and forget toast say this device.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a provider row counts the models the bench really offers (nine for Claude), from one helper, providerBenchModels in lib/providers.ts, and the key or token format lives only in the field's placeholder. Claude's workspace field appears only after Claude asks for it, or when an ID is already saved on this device, labelled Workspace ID with its one-sentence hint. The Cloud Connections lead says keys stay on this device and a cloud model runs only when you choose it, and ends in Walk me through it. The inline key and token forms gain Cancel now, and the token form's Save waits for a token; moving them into a Connect sheet waits for the founder's call on the ledger layout (D14).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): while the empty Vault ramp shows, the ramp alone says where the notes live and how the agent fits, so no sentence shows twice on any platform or storage. This was chosen over dropping the storage line from the ramp, which fixed only the Local case. The cover stays as the 2026-09-15 redesign shipped it, and the ramp's two ways in share a 200px basis. The Vault's did-not-load card comes from the copy map per storage (vaultLoadFailed in vaultCopy.ts): only a network storage (iCloud, Google Drive, the team vault) is told to check its connection; Local, This folder and Your computer each say where the notes are safe and to try again.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): every Crew line about unattended work says "while your computer is on": the empty headline is "Your crew is ready to work while your computer is on.", the away blurb says routines run there while it is on, and the door's line wraps to two lines instead of cutting off. Crew command's kicker is just the computer's name, "your computer" replaces "your main computer" wherever a person reads it, and the not-set-up lead says what is true away from the computer (you see the last picture; back in reach, you take control) instead of "steer them from here, anywhere". The hero's unpaired line says "Connect this device to it", the verb of the button under it (places sign-off).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a crew card shows its when-called line, held to two lines by CSS rather than sliced in code. A member written without one shows the person's own persona, untrimmed: it is their text, and stripping a leading "You are" with a regex would cut real words. A member's delete says Delete from the button to the toast, names the member, and says routines that use it keep their schedule, which is true because a routine snapshots the persona; the card-tap and swipe pattern waits for the founder (D18).
- 2026-10-07 (Creative Studio and CMO, UI/UX review): with no crew yet, Add the advisor team is the one filled action and New crew member steps back to ghost; once a crew exists, New crew member is primary again. The typed "+" left both Crew rooms, the duplicate "No crew yet" hint was cut, and the advisor card says the team in one line (one reviews the work, three step in, four answer when asked), pinned against the preset. The Crew lead stays as written. The advisor toast says only who joined: the member's name when one joins, the count when several do.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the three activity levels read as one accent hue at three weights: Reviews the work on the soft accent fill, Joins on its own outlined in the accent, When you ask outlined in neutral. Joins on its own gave up the attention plum, which stays for "needs you" only. In the editor, Activity level is a three-row radio list in the mode sheet's row style with the drawn check, so the choice and what it does are read before it is made, and every label in the crew and routine editors names its field.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Settings lead is "What this app keeps, and where.", and the tagline stays only in the footer, whose edition reads iPhone, Desktop or Web; the "is under Privacy" lead was not taken. The Account group is left out of a build with no account backend (SettingsGroup's hidden prop, which keeps the pinned rows' indentation), and signed out the Sign in row shows no value. Appearance's line follows the sign-in; a signed-out person keeps "Stays on this device", true in every build. Notes in chats says "its project's Current State".
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the privacy explainer row and its sheet are titled How your data is kept, and its value shows Sealed only when the seal was measured good. Ethical boundaries is an untitled group whose row names it once ("Three narrow limits, on every model, local included"). The clear row is Clear chats, named for the room, its confirm reads "Clear every chat on this device?", and a danger row carries no chevron, since it asks before it acts and leads nowhere.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a Web search group just above Harbor holds Let models search the web and a Search service row; the search sheet keeps its title, Web search, and the Harbor group keeps Harbor Lite, Harbor and DeepBlue, so every pointer to the models stays true. The spoken-voice group is Voice mode. The writing-voice field drops its visible Voice label for an aria-label, chosen over a visually hidden label, and Shape it in a chat becomes a quiet bordered row with a chevron instead of a dashed accent box.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): in Settings the sign-in form sits on the sheet with no card and no second title, under a head that follows its mode (Sign in or Create account). Forgot your password sits on the Password label through a shared .field-label-row, and busy buttons say "Signing in...", "Creating account..." and "Saving..." in the house's three dots.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Humanize Writing's explainer says only what the code does (it is on by default, and off drops the standard so a model reads a shorter prompt), with no claim about how many people keep it on or how fast a model answers, and calls Harbor and Harbor Lite on-device models, not guides.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Settings' segmented single choices are radios, not tabs; the icon picker gets the ledger's hairline; Research's line links to Cloud Connections and names a Perplexity API key; the DeepBlue install toast and the setup guides say Reasoning LLM. Built in stays the Harbor Lite row's status in its slot (2026-09-04) but reads as a value in the ledger value's size, weight and ink, never as a quiet button (places sign-off).
- 2026-10-07 (Creative Studio, UI/UX review): Harbor Lite's guide cards describe today's one-group sidebar, the Chats room's reach, the 2026-10-02 project room and every control this review renamed, keeping later-tier room names behind their flags. The reach-pill card names no colour for Offshore, since its dot is neutral now, and "amber" left its keywords.
- 2026-10-07 (UI/UX review, record pass): the last three doors on the old words follow the review's own rules: the live terminal's refused-device button says Connect your computer, the First Seat's and the Offshore pack's API key door says Add an API key, and a connected Repositories platform row says "Its repositories are ready to add to a chat." instead of how to connect, as Cloud Connections' connected row says what connecting gave you.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): D1's step down is built where the recommendation put it. Under the Stack's status note, while no computer is connected to this device, a quiet link (Choose Offline, or Follow the connection once Offline is chosen) opens the same Status sheet the pill opens; while the connection itself has dropped it is not offered (the tab already says Offline and the lone pill is in the bar). The CMO's Status ledger row was not taken, since the link is the smallest true door. The desktop gets no door: its Stack room is the engine's, whose chats do not follow the reach profile (only an app-side Stack chat does), so a door there would promise more than it changes.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the phone's Stack status switch holds Offshore and Offline until a computer is paired, and Docked joins the day one is (isDesktop() or settings.daemon), the same rule D1 gave the pill, so the weathers the bars hide never debut as the Stack's first control.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a room's bar with no control in it (the desktop, where the sidebar is the way around) drops its hairline and fill while the large title is on screen, and both arrive with the bar's title on --dur-3, the iOS large-title bar. It is one CSS rule (.topbar:has(> .topbar-title.is-tucked):not(:has(button, .pill))), so the bar regains them the moment a pill, a back or an action joins it, and the 61px height is kept.
- 2026-10-07 (Creative Studio and CMO, UI/UX review, final check): up to 560px, the composer's own fold, a chat's bar (the one with a title and a repository line) folds the reach pill to its dot in a round 30px chip with a 44pt reach, as the Studio asked first: the dot tells Docked (green), Offshore (plain) and Offline (a ring) apart, the aria-label keeps the word, and a tap opens the same sheet. The Studio named 400px, but at 402pt (an iPhone Pro) the name still had 135px, so the fold takes the chat screen's one phone breakpoint. A paired computer chat's name and "Add a repository" then read whole at 375pt, so the repository pill keeps its words (the first pass folded it to a glyph and left the name at "Sign-in scre..."). The rooms' bars and an empty chat's bar keep the word.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): D11 is carried one room deeper and to its sibling. At 900px and wider the project room's New chat and the Chats room's New chat are the bar's labelled primary, the same button as Projects' New project; the project room drops its dock and Chats its in-list New chat row there. The phone keeps the dock, the pen and the row.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): at 900px and wider, under the top pill, the Projects list and a project room's chats stop bleeding a gutter past the column: they sit on its edge and their rows step in by --card-pad, so the active rule lands on the line the pill and the cards draw. spacing-elevation.test.ts pins both overrides beside the phone's bleed.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): D23 reaches its last two places. The Settings foot reads "OpenShore 0.1.0 · Web" over "Your models. Your keys.", and Harbor Lite's app facts open with the same two sentences as its overview card.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Harbor Lite's cards follow the directions. The connection pill shows once your computer is connected (a green dot, a plain dot, a hollow ring), with Choose Offline in Stack before then; setup picks up on Keep setting up; the chat header lists Terminal, the New chat pen and the pill once connected; the chat box has one round button, voice mode while empty and send once you type; the Menu says Terminal sits after Vault on a phone not yet connected; and the Stack keeps Docked's stack once a computer is connected.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): once the guided walk is finished, the hello carries the Set up OpenShore door every other Harbor Lite chat has, so the wrap-up's "from the button under my first message" points at a button that is there; the wrap-up keeps its words.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the Runs the show row's sub opens with "Reasoning model ·" on the phone and the desktop, so the name the other rooms use is introduced where the slot is picked. The CMO's renaming of the group head was not taken, since D2 keeps "Runs the show" under every option.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): Image reading's Cloud row takes the Local row's shape, "None yet · Claude Haiku 4.5 reads images for now, asking before each one.", still built from the reader the driver picks (D13). The private-notes promise is one constant, VAULT_PRIVATE_OFF_CLOUD in vaultCopy.ts, read by the Vault ramp and both states of the project room's pins card.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a card that is itself a button titles itself with a span, .card-title in the h3's type, on Crew's quiet door and member cards, as the setup page's .path-card-title does, so no heading sits inside a button.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the one-way-out rule reaches Pairing's Name this computer and the Vault's folder options: each keeps its round close and drops its Cancel. The confirm card pads on --gutter and sits on --elev-3, the sheets' depth, held by spacing-elevation.test.ts.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the account pitch and the sidebar's sign-in line say "connect your computer", every Pairing door's words, instead of "pair your phone", which read as pairing the phone with itself on an iPhone and named the wrong device on an iPad. D19's few-that-follow clause is unchanged.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the setup page keeps its verbs through Harbor's states (Get Harbor again when a download stopped, with Try again), the busy line reads "Downloads once. Then it chats, and looks things up when it needs to.", the inline margins and danger colour moved to classes, and three lines say who does what: "A model that runs on this computer", "OpenShore edits, commits, and shows you every change", and "Claude, OpenAI, or Gemini. You pay them directly."
- 2026-10-07 (Creative Studio and CMO, UI/UX review): crewHeadline says every routine is paused only when every routine is switched off; an enabled routine with no next run yet reads "Quiet. Waiting for the next run." Crew command's one-member line reads "1 member, and it has a routine." or "1 member, with no routine yet."
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a connected provider or platform row asks a question (Disconnect?), so it wears no chevron, through SettingsRow's new asks flag, and a connected provider's sub says "Its 9 models are on your bench." The CMO's manage sheet (Replace key, Disconnect) was not taken: D14 ruled that a connected row's tap opens the Disconnect confirm, and round one also took a disconnect to replace a key.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): a link out of the app (Get a key, Get a token, Launch's Codemagic key) draws ExternalGlyph from SheetGlyphs.tsx, and the typedGlyph guard now fails a typed ↗. The public-only token line says "then come back here", true in every room that shows it, since each re-reads on return.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): New chat is one drawing, ComposeGlyph in SheetGlyphs.tsx, used by the Chats room and an open chat's bar, and it is the square-and-pen compose mark rather than a bare pen, which beside a chat's own name read as rename.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): before a computer is connected, the offline banner says "Offline. Models on this phone still answer. Cloud models wait for a connection." and names no computer, the same rule as the pill. In Nightshore the Crew room's ghost New crew member is an outline on the page, so it never reads as a twin of the door card above it.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): the engine's two lean notes share one verb, "gives it N of the M actions". The Chats and Projects search pill pins under the room's sticky bar (top: the bar's 61px plus the safe area) rather than at 0, where it hid behind the bar. defaultVisionCloudRef, uncalled since D13, is gone.
- 2026-10-07 (Creative Studio and CMO, UI/UX review): not taken here: an approval card before a play's unplaced image step (CMO-16) is new behaviour for the CTO, so the Stack's "asking before each one" still speaks for chats only and no copy widens it; and the web build keeps the phone's device words, since a plain browser is the dev shell (lib/platform.ts), recorded in deviceNoun.ts for the day a web build ships (CMO-17).
- 2026-10-07 (founder, the review's recommendations): D1, the reach pill before a computer is paired: built as B, show it once it can mean something. Until a computer is connected to this device (no settings.daemon), no top bar shows the pill while online, a lone Offline pill shows when the connection drops, and Docked, Offshore and Offline show once a computer is paired; on a phone or the web the step down is Choose Offline under the Stack's status note (the step-down line above), and the one condition is reachPillShown in lib/profiles.ts. The desktop follows the same rule (decided from the code, below). This narrows CX's "Reach is always visible" (docs/premium-harness-first-seat-convergence.md, 2026-09-15) on the founder's word; the three weathers keep their names.
- 2026-10-07 (founder, the review's recommendations): D2, the name of the model that runs the show: built as B, "Reasoning model". Every string a person reads says Reasoning model, in the app, Harbor Lite's guide and the engine's router note, and "Runs the show" stays the Stack's group head; uiGuards' retired list now holds "Reasoning LLM" and keeps "lead model". This reverses the founder's 2026-09-15 "Reasoning LLM everywhere".
- 2026-10-07 (founder, the review's recommendations): D3, harness words in copy a person reads: built as B, the CMO's plain rewrite. The class lines read tiny "Takes one step at a time. Best for quick edits and questions.", small "Handles short plans. OpenShore keeps the checklist for it.", mid "Plans and carries out multi-step work." and large "Plans and hands off whole tasks." (os-code/src/harness/profile.ts, mirrored in app/src/lib/firstSeat.ts), and the engine's lean notes say OpenShore and actions, never harness, seat, tools or subagents. This replaces the wording the Creative Studio's convergence memo set (2026-09-15) and keeps its one-sentence rule, so tenet 1 now holds in the transcript and on the card too.
- 2026-10-07 (founder, the review's recommendations): D4, setup as a noun on the setup walk's buttons: built as C, verbs only, reusing a label. The break reads Just chat and Set up OpenShore, the paused walk's way back in reads Keep setting up (the fork's own label, SETUP_RESUME_LABEL), and the guide's lines around the buttons use setup only as a verb. This replaces the 2026-10-01 Start setup and the 2026-09-25 Pick up setup; Just chat and Start chatting stay as ruled.
- 2026-10-07 (founder, the review's recommendations): D5, the desktop empty state: built as A, one centred group. On a fine pointer the empty chat's greeting and composer sit together a little above the middle; on a first send the composer glides to the foot (a FLIP translateY over --dur-7 on --ease-glide) and it glides back up on a new chat, while reduced motion, a touch screen and Slack Water's landing swap at once. No ruling is changed: the phone's opening, set from the founder's device, is untouched, and the landing swell still lands on the greeting.
- 2026-10-07 (founder, the review's recommendations): D6, the composer's round button: built as A, voice in the round slot until there is text. With an empty field the round button is voice mode on the accent fill, and the first character turns it into Send as the two glyphs cross on the spring; the separate wave button is gone, the dictation mic stays, and Stop, queue and terminal mode are as before. No ruling is changed; the voice-mode rulings stand.
- 2026-10-07 (founder, the review's recommendations): D7, one tap to a new chat: built as D, a compose icon in the chat's own top bar. An open chat's bar carries New chat, the square-and-pen compose mark, beside the status on phone and desktop; it starts a chat in the active project the way the Chats room's compose does and is not shown on the empty new chat. The side panel still carries rooms only (the founder's side panel ruling, DECISIONS "The side panel is the main navigation"), so nothing it set is narrowed.
- 2026-10-07 (founder, the review's recommendations): D8, what the accent means: built as A, the shared teal held and the dock in the accent. The phone's Projects dock (New project) and the project room's New chat pill wear --accent with --accent-ink text, deep water in light and turquoise with abyss text in Nightshore, so the paper-white slab is gone and ink means text. It follows the brand sweep (2026-09-24) and Nightshore (founder, 2026-10-01); B, teal for private only, is to be revisited after the founder sees this pass on a device.
- 2026-10-07 (founder, the review's recommendations): D9, the setup page's shape: built as B, tidy cards. Each idle path is one tap target titled with its verb (Get Harbor, Connect your computer, Set up a repository and Add an API key on a phone; Build your stack, Open a repository and Add an API key on the desktop) over one muted line and the drawn chevron, Harbor's download and retry states keep their controls, and the page fits one phone screen. This narrows the 2026-09-02 starting paths call (cards in onboarding, rows in Settings): the cards stay, each now one tap, and nothing renders the rows today.
- 2026-10-07 (founder, the review's recommendations): D10, Terminal's place on a phone with no computer: built as B, the default order from navRooms per device. On a phone with no computer the drawer runs Chats, Projects, Repositories, Stack, Vault, Terminal, Crew, Cloud Connections, Pairing, and Terminal moves up to third the day the phone pairs for anyone who never moved a row; a desktop or a paired phone keeps Terminal third, and a saved order still wins. This changes the founder's 2026-10-01 default order only for Terminal on a bare phone.
- 2026-10-07 (founder, the review's recommendations): D11, New project on the desktop: built as B, New project in the bar and search on top. At 900px and wider New project is the bar's accent button with the drawn plus, search is the Chats room's pill on top of the list, and the floating dock is the phone's only; the fix pass carried the same bar button to the project room's and the Chats room's New chat (the line above). "Identical to the Claude app" (founder, 2026-10-02) now applies per device.
- 2026-10-07 (founder, the review's recommendations): D12, two held lines in the project room: ruled as A, no change. The New project sheet's labels and the room's quiet Chats caption stay as the Claude app has them, because the founder's 2026-10-02 ruling made Projects and the project room identical to the Claude app, and round one already fixed the wording around both.
- 2026-10-07 (founder, the review's recommendations): D13, image reading's cloud default: built as B, keep Claude Haiku 4.5 and name it. With a Claude key the Stack's Cloud row reads "None yet · Claude Haiku 4.5 reads images for now, asking before each one.", built through cloudImageReaders() in lib/providers.ts (from visionFallbackClaudeModel() and claudeModelLabel()), the list the chat path's fallback and the approval card read, and a plan's unplaced image step runs on the same reader, so play.ts no longer names Opus 5. This reverses the 2026-09-25 default, the most capable cloud model until manually adjusted (first set 2026-09-06), and supersedes round one's interim lines that named no model.
- 2026-10-07 (founder, the review's recommendations): D14, Cloud Connections and Repositories in the Stack's ledger: built as A, ledger rows with a connect sheet. Each provider or platform is one row (its model count or how it connects, and a Connected pill once connected); a tap opens a pinned sheet with the key or token link, the field and Save, and a connected row opens the Disconnect confirm (Keep, then Disconnect). Repositories keeps its computer card first, then Connect a platform, On your computer and Recent. This extends the Creative Studio's 2026-10-02 ledger ruling to these two rooms.
- 2026-10-07 (founder, the review's recommendations): D15, one notice for rooms that need your computer: ruled as B, no change. Repositories and the Terminal room keep the one card shape round one built (a line in the room's words, one Connect your computer primary, one Walk me through it link), because two rooms do not yet earn a shared component; the day a third room needs the notice, NeedsComputer is a straight extraction.
- 2026-10-07 (founder, the review's recommendations): D16, what Settings' first screen says: built as A, Privacy lifted under Account. Settings runs Account, Privacy (What leaves this device, How your data is kept, the policy and terms), the untitled Ethical boundaries row, then This device, with Privacy first on a build with no account backend; no row or copy moved, and the profile's link still lands on This device. Nothing is reversed; the Creative Studio's index of ledger pages (C) is not built.
- 2026-10-07 (founder, the review's recommendations): D17, Crew as one idea across two rooms: built as A, two rooms with a quieter door. With no computer paired and no routine, Crew's door to Crew command is a plain card row with the drawn chevron, the dark hero returns once a computer is paired or a routine exists, and Crew command's roster is one count line with Manage back to Crew. It keeps the 2026-09-05 shape (Crew command reached from Crew); the Creative Studio's segmented single room (B) is not built.
- 2026-10-07 (founder, the review's recommendations): D18, how a crew member is edited and deleted: built as B, the card opens the editor and a swipe deletes. Each crew card is one button that opens the editor, inside a SwipeRow with a danger Delete as Crew command's routines are, and the editor's foot holds a quiet "Delete {name}" for a pointer or a screen reader; the Edit and Delete pills are gone. This settles docs/design/crew-page-redesign.md, "Open, for the founder: Card actions" (2026-09-15).
- 2026-10-07 (founder, the review's recommendations): D19, the account pitch: built as B, name the few that follow. ACCOUNT_PITCH reads "Sign in to build, connect your computer, and take your theme and a few preferences to every device. Your chats stay on your devices.", with "connect your computer" in place of the recommendation's "pair your phone" (the line above), and the pay-gates-on pitch and the guide's Account card name the same few. This narrows the CX pitch of 2026-09-27 (docs/accounts-cx-memo.md section 4) on the founder's word.
- 2026-10-07 (founder, the review's recommendations): D20, the empty Vault's story: built as B, the order kept and the phone's pointer replaced. On an unpaired phone or the web the empty ramp's agent point is "How your models use it": "Pin a note to a project and every chat there starts with it. Private notes never reach a cloud model.", and the pointer to a computer is said only once one is paired, all through vaultCopy.ts. This reverses the unpaired pointer of the Vault v1 plan's copy map 0.19 (docs/design/vault-v1-plan.md) and keeps the 2026-09-15 Vault page rebuild's Coding projects card above the ramp.
- 2026-10-07 (founder, the review's recommendations): D21, the switch at rest: built as B, an outline at rest, filled when on. Off is a surface track ringed 1.5px on --control-edge, on fills with the accent, the knob has a hairline and a soft shadow, and a disabled switch fades and drops the knob's shadow, so it never reads as off. The founder's 2026-10-02 3:1 rule holds, drawn as a ring; contrast.test.ts pins the ring instead of the fill.
- 2026-10-07 (founder, the review's recommendations): D22, a spacing and elevation scale: built as B, structural tokens only. --gutter 16px, --card-pad 14px, --row-pad 12px, --section-gap 22px and --elev-1 to --elev-3 (a resting card, a raised dock or toast, a sheet) sit on the room gutters, cards, ledger rows, docks, the toast, sheets and their heads, each at the value the app already used most, so the look holds and sheets move onto the page's 16px gutter. Nothing is reversed; it extends the brand sweep's Wave 3 method, held by app/test/spacing-elevation.test.ts.
- 2026-10-07 (founder, the review's recommendations): D23, one line for what OpenShore is: built as A, "Your models. Your keys." everywhere. The setup page's h1 is the App Store's line, with a lead for the device in hand ("Chat and build on this phone and on your own computer.", "this iPad" on an iPad, and "Chat and build on this computer, and from your phone." on the desktop), and Harbor Lite's overview card, its app facts and the Settings foot say the same two sentences. No earlier ruling covered the in-app line; "Your computer. Your models. Your keys." and the Settings tagline retire.
- 2026-10-07 (UI/UX review, chat): D1 on the desktop was settled by evidence. refreshConnectivity probes only settings.daemon, and the Electron app never sets it for itself, so the desktop showed Offshore while the person sat at the computer. The desktop now follows the hidden-until-paired rule rather than showing Docked, because forcing homeReachable would also change the per-status stack, whether home models may be used, and Crew's control state. It has no Offline choice of its own (declined, the step-down line above: its Stack is the engine's, whose chats do not follow the reach profile).
- 2026-10-07 (UI/UX review, chat): D1's Offline before pairing is a lone pill, not the offline banner, because the pill sits in every bar and also covers an Offline the person chose. It fades in and out, keeps its last word while it leaves (so a leaving Offline never flashes Offshore), and settles in on every return to a bar (awayInBar), never on a room change.
- 2026-10-07 (UI/UX review, chat): D5's glide also covers the First Seat handing the room to the greeting and any move of the group that is not a resize, and it glides down only over open paper: a chat opened from the side with a full transcript lands its field at the foot at once instead of sliding across its words, while a first send's single bubble still glides. A touch screen returns before any layout read.
- 2026-10-07 (UI/UX review, chat): D6's spring is on the glyph, because voice and send are both full-size accent buttons and a scale spring would never fire between them; the two glyphs cross in one cell on --dur-4 and --ease-spring, and a tap within 400ms of a send never opens voice.
- 2026-10-07 (UI/UX review, chat): the setup walk's equal-width rows inset their buttons 8px, not 16px, so Set up OpenShore stays on one line from 375px up. The guide's prose around the buttons drops setup as a noun too: the fork ends "They wait for you either way" ("It waits" for one step), the paused line reads "When you want the next step, tap Keep setting up under my first message", and the wrap-up opens "That's every step."
- 2026-10-07 (UI/UX review, chat): the walk's repository step says "Every command asks before it runs, unless you allow it.", matching Settings, Approvals and Repositories, which settles the CX line round one left open. The composer row's fold (the mode pill to its glyph, Terminal to its $) reaches 560px, measured, since at 520px the model pill was still cut. A device the computer turned down reads "Your computer turned down this phone. Connect your computer again from Pairing.", the device named through thisDeviceNoun.
- 2026-10-07 (UI/UX review, foundation): every switch is the shared <Switch>, Crew command's routine switch included, so each answers the finger, and a bare .switch no longer counts as a press in polish-standards, since .switch has no :active rule of its own. Nightshore's knob is warm paper (--switch-knob: var(--ink)), because the raised-ground knob vanished on the outlined dark track; light keeps the raised paper knob.
- 2026-10-07 (UI/UX review, foundation): a class worn beside press-fb that sets its own transition ends it with scale var(--press-out), or the press release snaps. It is fixed on the switch, the Chats rows, the First Seat's more row, the chat search's clear, the project memory link and Crew command's day chips and segments, and a polish-standards guard holds it, with the Local Library's family chip (v3) exempt.
- 2026-10-07 (UI/UX review, foundation): the toast, the jump chip and the Projects dock share --elev-2, which softens the toast's shadow, and every sheet takes --elev-3, the phone's bottom sheet included, so its shadow now falls under the scrim. The composer keeps its own soft shadow (founder preference) and the popover menus stay as they were, both off the scale on purpose.
- 2026-10-07 (UI/UX review, foundation): on a phone the full-bleed lists (Chats, Projects, a project's chats) cancel exactly one --gutter (one --card-pad inside a project card) and pad their rows back on --row-pad and --gutter, so the room gutter is one value end to end; the docks moved to padding-block and padding-inline so their gutter is a token the guard can read. The values did not change.
- 2026-10-07 (UI/UX review, foundation): one shared row arrival, .stagger-in with an inline --i capped at 8, steps rows in on the house rise, stilled under reduced motion. The Vault's recent agent notes use it, and uiGuards' inlineStagger rule also fails an inline --i that no stylesheet rule reads.
- 2026-10-07 (UI/UX review, foundation): copy names the device in hand through thisDeviceNoun in lib/deviceNoun.ts: "this iPad" on an iPad (the user agent and touch points, the test vaultDeviceKind uses) and "this phone" elsewhere, read once. The module has no imports, so a copy module can build its strings when it loads without every platform mock naming it. The "this iPhone" lines about the device in hand go through it too, so an iPhone reads "this phone" everywhere, and deviceNoun.test.ts fails a typed "this phone" or "this iPhone" in v1 copy.
- 2026-10-07 (UI/UX review, foundation): lines that name another device or Apple's own settings keep "your iPhone" (the subscription lines in Delete account and the Paywall, which App Review tests pin; the desktop's "On your iPhone, point the Camera"; vaultCopy's "your iPhone's iCloud vault"; the notification-token entry), and the later-tier Local Library, Stack Health and bundle lines keep theirs, exempt by name, until their tiers open. The pair guide's "point the iPhone Camera" says "the Camera app".
- 2026-10-07 (UI/UX review, foundation): the model sheet's Stack row reads "Your Reasoning model routes each task", because "picks which model answers" repeated the noun after D2. The planner prompt in play.ts and the code comments were renamed too, and Harbor Lite still matches "reasoning llm" as a keyword beside "reasoning model".
- 2026-10-07 (UI/UX review, shell): navRooms' second-session order is Crew, Cloud Connections, Pairing, the later tiers' rooms, then Settings, the order the sidebar has shown since 2026-10-01, so the Sidebar reads its default from navRooms (defaultNavOrder) and only Terminal moves. The order is worked out on every render, so pairing with the app open moves Terminal at once. The web shell reads as a phone here and on the setup page, since isDesktop() means Electron.
- 2026-10-07 (UI/UX review, shell): a setup card's line is one short phrase, and the longer explanations (Tailscale, the battery, keys staying on the device) live in Pairing and Cloud Connections, which already say them; Harbor's line is built from thisDeviceNoun and HARBOR_APPROX_LABEL rather than HARBOR_BYLINE. The card reuses the house card-as-button (.card-disclosure with press-fb, as InfoSheet) and its CSS-drawn chevron, and titles itself with spans, since a heading inside a button is not valid HTML.
- 2026-10-07 (UI/UX review, shell): the setup paths' names and lines live in one table, PATH_COPY in components/StartingPaths.tsx, which the cards and the unrendered rows variant both read, so the 2026-09-02 "never drift" stays true while the rows wait on a later call. D23's lead keeps "Everything below is optional." as its second sentence, the page's one lead from round one, and drops "Add any of it now or later."
- 2026-10-07 (UI/UX review, shell): the Chats search pill is one component, SearchPill, used by Chats and by Projects on the desktop, where the Projects room takes Chats' 8px top so the two pills sit on one line. Enter opens the top match without the title flight, since no row was tapped, and a window narrowed below 900px with a query typed opens the phone dock on its search field, so the list never reads as filtered by nothing.
- 2026-10-07 (UI/UX review, shell): a chat whose reach is not known draws no dot and takes no space (ReachDot returns nothing), so the second line starts on the title's edge in Chats and in the project room. The phone's Projects dock is one grid track the width of its padded box (minmax(0, 1fr)), so New project keeps the 16px gutter the round search keeps, where the search field's own width had pushed it 8px past; its plus is the shared PlusGlyph the desktop bar draws.
- 2026-10-07 (UI/UX review, machines): the Image reading rows name the model the chat path would really use in that status: a model in the stack that can see goes first (a cloud Reasoning model such as Opus 5), then the first connected cloud reader, so a row never names Haiku while an image would go to the anchor. With no cloud reader the Cloud row says "None yet · Connect a cloud model in Cloud Connections to read images.", and Offline says "None yet · No cloud model is used while Offline."
- 2026-10-07 (UI/UX review, machines): a play reads a PlayStack whose imageReader is the driver's routeVision pick, so an unplaced image step is briefed as, and runs on, the model an image in a chat would go to. The brief tags it (reasoning) only when that model is the anchor, and a stack with no Reasoning model briefs Harbor Lite, the anchor the driver runs.
- 2026-10-07 (UI/UX review, machines): a reader's name carries its provider only when the model's own label does not ("OpenAI GPT-5", "Gemini 2.5 Pro", "Kimi K3"), so the approval card no longer says "Gemini Gemini 2.5 Pro". The Image reading slot sheets name the stand-in reader only while the slot is empty, since a chosen cloud model never asks, and the Local sheet names the reader instead of "the cloud model".
- 2026-10-07 (UI/UX review, machines): D14's connect sheets (a provider's key, a platform's token, Clone from a URL) have one way out, the round close, and no Cancel, taking the 2026-10-07 form-sheet rule over the build note's literal "keep Cancel": in a sheet the round close does the inline forms' Cancel's job and stays in view above the keyboard. The head sits straight in the sheet, outside data-reveal-with, so it stays pinned.
- 2026-10-07 (UI/UX review, machines): the key sheet's Save waits for a key as the token sheet's does (disabled={checking || !value.trim()}), and Enter, a second door to Save and Clone, waits while a key is checked or a clone runs, so nothing checks or clones twice. The key and token links sit on the field's label row, and the Local Library's Connect opens that provider's key sheet.
- 2026-10-07 (UI/UX review, machines): a one-tap platform's sheet leads with its sign-in and keeps "Use an access token instead" and the refused redirect's Callback URL. Reconnect GitHub opens GitHub's sheet before it signs in, so a refusal shows the Callback URL where the person is, and GitHub's row says what the sign-in sees in words ("none private", never "0 private", and "It sees no repositories." at zero). Clone from a URL is its own row and sheet, and waits for an address.
- 2026-10-07 (UI/UX review, places): Your computer (the hub vault) carries no ramp point while unpaired, since it cannot be read then and no chat starts with its notes. VaultCopy.models replaces agentPair, and PHONE_PAIR_LINE retires for VAULT_MODELS_TITLE and VAULT_MODELS_LINE.
- 2026-10-07 (UI/UX review, places): the guide's Settings card names every group in the screen's order, Ethical boundaries, Approvals and Reasoning included, held by app/test/settingsOrder.test.ts, and the guide's Crew card says Delete sits at the foot of a member's editor as well as on the swipe, so it is true for a mouse on the desktop.
- 2026-10-07 (UI/UX review, places): away from the computer, Crew's hero door says "Routines run on your computer while it is on. Reconnect to take control.", in the voice of the lines around it, and its kicker keeps "Crew command · View only".
- 2026-10-07 (UI/UX review, places): Crew command's count line counts settings.crew only, and an Agentic Current's member card (v2, through activeContribution) stays under it, since Crew does not list it. When routines outlive every member it says "No crew members. The routines below keep their schedule.", the delete confirm's own words, never "The first routine adds a Reviewer".
- 2026-10-07 (UI/UX review, places): a crew card is a real button inside SwipeRow, whose own tap does nothing, as on a routine card, so a key and VoiceOver open the editor; SwipeRow's action is aria-hidden, so those users delete from the editor's foot. The editor's Delete closes the editor before the confirm opens, so no two sheets stack, and Keep returns to the roster.
- 2026-10-07 (UI/UX review, places): a swipe row that hosts a card (a routine or a crew member) carries the card's --elev-1 and no hairline of its own, so its clip neither cuts the shadow nor draws a second edge. Under a crew card the swipe layer paints nothing, so a held press shows the page around the card, and the card's keyboard ring is drawn inside the row's clip (outline-offset -2px).
- 2026-10-07 (UI/UX review, places): the sidebar's one-line sign-in sub names only what signing in opens and makes no settings claim, because D19's preferences clause clipped it in its 193px line; with the gates on it reads "For Projects and Plus". The pitch carries the preferences.
- 2026-10-07 (founder): image reading. "Image step: I agree with this default practice. Let's have the 'thinking' note say that no image model selected in stack, using optimal cloud connection. Or if there is no image model selected, respond in the chat with what local model you suggest to download and assign to image processing in stack and/or the need for a cloud connection." A play's image step with nothing set for Image reading keeps running on the chat path's reader (routeVision's pick: a Reasoning model that can see, else the first connected cloud reader, Claude Haiku 4.5 first) with no approval card, and its working note says so: "Read the chart. No image model is set in Stack, so Claude Haiku 4.5 reads it on your Claude connection." When nothing can read images, the chat answers with what is missing and two doors, Source a local model and Connect a cloud model, each opening a step-by-step guide chat. This narrows tenet 4 ("every cloud call is a card the person taps") for that one step, and CLAUDE.md's tenet 4 carries the exception; the CTO's open item from the review (an approval card before a plan's image step, CMO-16) is closed as ruled, keep it and name the model.
- 2026-10-07 (founder): desktop Offline. "Desktop app can use offline when there is no internet and it needs to use just the local models, where the cloud connections are no longer viable options for work." The desktop and every engine session it hosts (its own chats, a paired phone's through the daemon, routines) follow this computer's own network state and the person's Offline choice, live, before every turn, on local models only: a cloud Reasoning model gives way to the best model on this network and comes back when the computer is online, with one note each way; with no model here the turn ends on one plain line and the stop card offers Install DeepBlue; the desktop Stack gets Choose Offline and Follow the connection; cloud models are shown as waiting, never picked, and nothing is sent to them. This reverses the review's decline of an Offline door on the desktop (D1's step-down line and the D1 desktop line above: "its Stack room is the engine's, whose chats do not follow the reach profile"), since the engine now follows.
- 2026-10-07 (image reading): the chat path keeps its ask-first card for any reader not placed for Image reading (founder, 2026-09-25). After the tap, with both Image reading slots empty, its status line reads "No image model is set in Stack, so {model} reads this image on your {Provider} connection.", or names the Reasoning model by its role, or "a model you connected"; a placed model or any filled slot keeps "Reading this image with {model}." A play's image step speaks the same words (lib/imageNote.ts), and a model set for Image reading that cannot take the step here (a model on this phone, or one out of reach) gets its own note naming it and the Reasoning model that covers the step from the text, never "Handing to" a model that does not run it. Who runs the step is unchanged.
- 2026-10-07 (image reading): on a phone or an iPad a Stack chat's composer takes a picture whatever its stack can read, so a picture nothing can read gets the in-chat offer instead of the old toast and the old finish('error') line. The desktop and every other chat keep the toast: the desktop's Stack is the engine's, with no Image reading row for the doors to point at, so the desktop-only door wording was dropped with it.
- 2026-10-07 (image reading): the offer is its own additive engine event, image-reader-offer { from, cloud, placed?, status? }, beside clarify, and its own transcript item, image-offer. It is emitted between text-final and task-done on a complete turn only, so it follows any answer and a stop drops it; a play shows it once however many image steps it holds, still runs those steps on the Reasoning model from the text, and reaches its synthesis; seedEntries and handoffs leave it out, so it never reaches a model's history. No voice-mode break: voice mode sends no pictures.
- 2026-10-07 (image reading): the card wears the changed-files card's neutral frame, never the accent's or an error's; teal marks only the Local door and amber only the Cloud door, and the two buttons (Source a local model, primary; Connect a cloud model, ghost) stack full width on a phone. Its lead names what holds reading back: a model set for Image reading that cannot read here (on this device, cannot see, out of reach), a connected cloud reader out of reach or none, and, whenever cloud reach is off, the status ("Nothing can read images while Offline"), where a reader already set up is told to send again on leaving Offline, never to add a second. Once stackVisionReady is true the lead and doors fold away, the title becomes "Ready to read images", and one line says "Send the picture again." (a play: "Attach the picture and ask again.", since a play never carries the picture itself).
- 2026-10-07 (image reading): the local pick reads llava-7b (about 4.7 GB) and moondream (about 1.7 GB) from the bundled catalog; LLaVA leads, with Moondream for a computer with little room. localImagePick takes a fit so Moondream can lead alone once a phone can read its computer's memory; nothing passes one today. The local guide (8 steps) reaches Ollama on the computer as a model you connect (Stack, Bench, Connect a model) at http://{Tailscale address}:11434/v1: byom.ts judges a 100.64/10 address local, so plain http is allowed, iOS allows it, a CORS refusal falls back once to the native shim, and the address is inline code so the chat renders no dead link.
- 2026-10-07 (image reading): the local guide sets OLLAMA_HOST=0.0.0.0 the way Ollama documents per system (launchctl setenv on a Mac, said again after a restart; a systemd drop-in on Linux; the account variable on Windows), never a hand-run "ollama serve", which on Linux reads another model folder than the service; it says Ollama then answers on the home network too, and never to forward port 11434. The cloud guide (4 steps) names Claude first, then the other readers from cloudImageReaders (OpenAI GPT-5, Gemini 2.5 Pro, Kimi K3), and walks Cloud Connections' own sheet: tap the provider, Get a key, paste, Save, and a Workspace ID when Claude asks.
- 2026-10-07 (image reading): imageReading.ts (the offer and the catalog picks) stays clear of stack.ts, because stack.ts reaches the guide cards through harborMini.ts and the guides read imageReading; the notes, which need refName, live in imageNote.ts.
- 2026-10-07 (desktop offline): one machine-wide flag in os-code core/agent/offline.ts (through os-code/protocol), set only by Electron main. Every session the process hosts reads it before every turn through BootstrapOptions.offline, a reader that defaults to the machine flag. It is the computer's own state, never a field on the daemon's create route, so a phone cannot tell the computer it is online.
- 2026-10-07 (desktop offline): detection is main's NetworkWatch reading net.isOnline() (no request, no new host) every 3 s, again on powerMonitor resume and on each report from the window. The computer is offline when there is no network or the person chose Offline, and no network wins over the choice. The window counts as offline when navigator.onLine or main's read says so, reports the choice as a boolean only (osc:setOffline), and hears main on osc:network; a send to a window going away is dropped, never thrown out of main's timer. A LAN with no internet beyond it reads as online, and no copy claims otherwise.
- 2026-10-07 (desktop offline): the seat is Router.localSeat: the orchestrator if it stays on this network, else a local specialist the stack places (coding, analysis, writing, fast), else the best chat model a server on this network lists within 3 s (rankLocalModels: no embedders, coders first, larger first), judged by address, never by a label. The seat from before comes back when online. With no model here the task ends before anything is sent, on "Offline, and no model on your computer can answer yet." with the way on worded by reason. One-shot summaries (an idle /compact, a title) run on the same offline seat and are priced on the seat that answered.
- 2026-10-07 (desktop offline): while offline, cloud specialists are skipped, nothing escalates, the Jev judge is off, and the routine slice's network tools (web search, page fetch, Codemagic, the currents) leave the menu and are refused by name ("Your computer is offline, so nothing here reaches the web."); generateImage is cut only when its server leaves this network; delegate and analyzeImage stay, kept on this network by the router; repo search keeps to the keyword index when the embedder leaves this network; and OFFLINE_PROMPT reaches both the lean and the full prompt.
- 2026-10-07 (desktop offline): the notes are said once per change, and only when a model in the session's stack leaves this network (Router.anySeatLeaves: the orchestrator, a specialist, or a ready escalation), so an all-local stack says nothing but still loses its web tools and is told. Engine words say "your computer", because they also show on a paired phone. A seat off this network that fails with a connection-shaped error (fetch failed, ENOTFOUND, EAI_AGAIN, ECONNREFUSED, ENETUNREACH, EHOSTUNREACH, "Connection error") says "Could not reach {provider}", never "server is busy" or the raw error; the 2 s retry pause doubles as the moment the flag catches up, and otherwise the turn ends on "Could not reach {provider} from your computer. Check its internet connection, then try again."
- 2026-10-07 (desktop offline): Install DeepBlue, the stop card's door for the no-model line, shows only on the desktop and only while the network is up, and pulls DeepBlue without seating it, so the person's cloud Reasoning model stays their pick. A model pull while the flag says no network answers OFFLINE_DOWNLOAD ("Offline. Models download once your computer is back online.") before any request; a chosen Offline still downloads.
- 2026-10-07 (desktop offline): on every device, offline (the network down or Offline chosen), a direct cloud chat's send ends in the store with a plain line naming the model and no request; the model sheet's cloud sheet says "Offline. Cloud models wait for a connection." once at the top over muted names that cannot be picked or pinned and carry no spend mark, the first page's cloud rows say "Waits for a connection", and a new chat never starts on a cloud pick; Cloud Connections says it once at the top, holds Save with its reason only while the network is actually down (the key check needs it), and Disconnect always works.
- 2026-10-07 (desktop offline): on the computer itself, the desktop Stack takes the phone's quiet door (Choose Offline, or Follow the connection once chosen) under a status line, opening the same Status sheet; it is not offered while the connection dropped by itself or while the desktop is pointed at a remote hub. Runs the show says when a cloud model waits and whether a model here answers meanwhile. The Status sheet reads Docked "For your phone, when it reaches this computer. Not used here.", Offshore adds "No connection right now." when it cannot be picked, and Offline describes this computer's models. EngineHost.status() judges the orchestrator's kind by address, not by the "anthropic" label.
- 2026-10-07 (desktop offline, d8fd423): the chat's offline banner also shows while Offline is chosen, on every device, in its own words (offlineBannerLine in state/offlineOps.ts): "Offline, by your choice. Models on this computer answer. Cloud models wait until you follow the connection again." (a phone names itself, and a paired one says "Your computer and cloud models"), so a working network with cloud models set aside never reads as a fault. With Offline chosen and no model here, the stop card offers Follow the connection beside Install DeepBlue.
- 2026-10-07 (desktop offline): the Offline status's own line is an option as much as a state, so it no longer says "No connection": "Only the models on this device. Your computer and cloud models wait.", and before a computer is connected "Only the models on this device. Cloud models wait.", true whether the network is down or Offline was chosen (lib/profiles.ts).
- 2026-10-08 (database tests): the `sql` and `sql-replay` jobs were red on main from 0027 (2026-10-02) to 0662756, because 0027 revokes the app's insert on model_reviews while the Local Library is shut and the tests still wrote reviews as signed-in people. guardrail_privacy.test.sql seeds its two reviews as the table's owner (what 0020 holds is how reviews are read), and rls.test.sql's third BE-6 line pins that no new review goes in. The Local Library migration that grants the insert back returns that line to BE-6's own rule. No migration changed.
- 2026-10-08 (follow-ups, offline): the daemon tells a paired phone that the computer is offline on GET /health and GET /stack, as `offline: 'network' | 'chosen'`, left out while online so an older daemon reads as online; while offline, /stack also names `offlineSeat`, from the engine's own Router.localSeat through offlineSeatFor (online, it lists no models). Both routes stay behind the daemon's auth, and nothing new leaves the tailnet. The phone keeps it as connectivity.homeOffline, which changes no status: the phone stays Docked and its own cloud models are untouched, so only the computer's rows speak of it.
- 2026-10-08 (follow-ups, offline): with a cloud model running the computer's show, the phone's model sheet reads "Offline, so {seat} on your computer answers for now" and stays a pick, or, with no model there, a muted row that is not a pick: "Offline, and no model on your computer can answer yet." The phone's Stack (Docked) reads "Connected to your computer, which is offline. Models on your computer still answer. Its cloud models wait for its connection.", and a chosen Offline says "by your choice" and "until you follow the connection there", since it is undone on the computer; the middle sentence waits until the computer has said what answers. Chat with your computer shows only while a model on the computer's network runs its show (the desktop's engineChatReady rule), since the daemon's free chat refuses a cloud orchestrator by address.
- 2026-10-08 (follow-ups, offline): GET /stack reads the config fresh, as sessions and the free chat do, and judges the orchestrator's kind by address; a config that no longer reads answers from the one the daemon started with. EngineHost.status() picks its model server by address (leavesThisNetwork), never the kind label, and Stack picks, pulls and the Ollama probe use that server through localEndpoint, so the picker never lists or writes to a hosted OpenAI-compatible endpoint. status() reports offlineSeat from the same localSeat, so the desktop model sheet, Runs the show and the Stack's status note name the model that answers ("{seat} on this computer answers for now") or say "No model on this computer can answer yet.", never a count of the first server's list.
- 2026-10-08 (follow-ups, offline): a pull that fails with the network up says what failed and the way on (os-code market/pullLine.ts, through os-code/protocol): not found, needs a newer Ollama ("Update Ollama, then try again", since trying again alone cannot help), disk, unreachable, stopped partway, or a plain failure. Ollama's text only sorts the cause and is never shown; pull results carry the reason additively; the network-down words are unchanged. DeepBlue's lines say "this computer" (they show only on the desktop); a DeepBlue that downloaded but could not be seated says so, never that the download failed; after a failure the stop card's door reads "Try DeepBlue again".
- 2026-10-08 (follow-ups, image reading): with a model set for Image reading, the ask-first card shows only when that model cannot take the picture (a model on this device, or a cloud model that does not read images), and it names the model and why in the offer's words (heldImageModel in lib/imageNote.ts), with "Set a model that reads images for Image reading in Stack"; with nothing set it keeps "Nothing in Stack is set for Image reading". The stack driver's "Or press Stop to skip it." joins a one-paragraph detail with a space, since ApprovalSheet shows any detail with a line break as code.
- 2026-10-08 (follow-ups, image reading, for the CTO): stepRunner in lib/play.ts is the one rule for who a play step runs on: its owner, unless that owner is a model on this device or out of reach in this status, when the Reasoning model covers it. The task list, the working note and the driver's runner all read it, for every category, so a phone model is never named as the owner of a step it does not run. Who runs each step is unchanged; whether an image step should go to a usable Cloud slot before a phone Local slot (ownerFor takes Local first) is left for the CTO.
- 2026-10-08 (follow-ups, image reading): a turn whose only result is the image offer ends complete without the success haptic (state/turnEndOps.ts); a turn that answered keeps it. Every working-row note other than the rotating word wraps and reads whole (the image note takes three lines at 360 to 430pt), and on the exit a wrapped note keeps only its first line, anchored at the slot's foot, so no line rides over the model's name. A thumbnail in a sent picture's bubble is not built: a sent message keeps only its text, so it needs a stored preview, a decision under the Proton standard.
- 2026-10-08 (follow-ups, polish): the setup paths render one way, as the setup page cards; StartingPaths' rows variant, unrendered since D9, is deleted with its pins, ending the 2026-09-02 starting paths call's rows in Settings. The sign-in sheet offers two lines under its button in either mode; Resend confirmation takes the magic link's line only while the email field holds an address waiting on its link (one a sign-up sent, or one refused as not confirmed), and a sign-up's own toast is the sheet's last word.
- 2026-10-08 (follow-ups, polish): relativeTime starts a word with a capital ("Just now", a locale's lowercase weekday or month), since every caller sets it at the head of a line or a " · " part beside "Yesterday". Enter in the desktop Projects pill flies the first row's name into the room's title, as a tap does. At 320pt, "about 2.5 GB" and "is optional." hold with no-break spaces and a room's lead wraps pretty. A chat row outside .chat-list pads var(--row-pad) var(--card-pad), held by spacing-elevation. A platform whose sign-in is configured reads "Sign in, or paste an access token" (the CMO's alternative). Four docs gain a dated line pointing at D18, D19 and D20 instead of rewriting history.
- 2026-10-08 (privacy review): the CTO's checklist runs before a release (CLAUDE.md, the Proton standard), so the desktop release started at 7d7cf22 was cancelled before it published and the review ran first: five reviewers, each with an adversarial verifier, then six fix packages with their own sign-offs (`docs/security-privacy-review-2026-10-08.md`). Its verdict before the fixes was do not ship; after them, ship.
- 2026-10-08 (privacy review, the seat judge): a seat is judged by its server's address and its model's name, `seatLeaves(provider, model)` = `leavesThisNetwork(provider) || isOllamaCloudTag(model)` (os-code/protocol), where a cloud tag is the tag after the last colon reading `cloud` or ending in `-cloud`, in any case, on any provider (the safe reading). `leavesThisNetwork` stays the judge of a server (which Ollama the Stack lists and pulls to); every seat check reads `seatLeaves`: the router (roleFor, localSeat, anySeatLeaves, delegate), the loop (the cloud card, followOffline, the vault seat, the pill, the handoff refusal, /compact and the title), bootstrap's secrets gate, the free chat, a routine's local-model rule, `GET /stack`, `EngineHost.status()`, `osc stack` and `osc doctor`. `rankLocalModels` never ranks a cloud tag, so Offline never seats one.
- 2026-10-08 (privacy review, the seat judge): the desktop picker keeps cloud tags pickable (the person's own choice), listed apart under "Cloud models your Ollama lists" with the Cloud chip; their card names the model as one of Ollama's cloud models and ollama.com, never this computer's own Ollama as a server off the network. What leaves this device gains an Ollama cloud entry (start off, no host of ours, no pill claimed, since a cloud tag placed as a specialist answers with no pill of its own), and the downloads entry limits "nothing about you rides along" to a model that runs on your computer. Spend still counts a cloud-tag turn as local (Ollama bills it), left open.
- 2026-10-08 (privacy review, image reading by address): Image reading's Local and Cloud slots split by where a model answers (`refStaysLocal`, or the driver's packSeat judgement), never by kind, so a model you connect at a public address, or a cloud tag, is the Cloud slot. A second vision placement judged to the same side by an older stack shows under Specialists as Image reading, where it can be moved to the bench. The rows name the model the chat path really picks (`pickVisionRef`); when the Local slot reads images itself, the Cloud row says so and names no stand-in.
- 2026-10-08 (privacy review, local-only marks in the engine): a local-only note's text keeps its mark however it travels (D5): a fold's summary built from marked text is marked; a reply is marked when its task read such a note, or its seat stays on this network and the pack or kept history holds such text, and the mark holds for the rest of the chat (the app's sendLocalOnly rule; seed.ts rebuilds it after a restart); a stubbed reply's tool calls keep their ids and names with empty arguments; /compact and the title resolve their seat first and fold the stubbed history off this network; the Jev judge sends nothing marked. The safer reading is kept: later local replies in such a chat reach a cloud seat as the stub.
- 2026-10-08 (privacy review, handoffs): delegate, analyzeImage, generateImage, and a webSearch on the Perplexity backend (its answer is a cloud model's) are refused at `executeCall` when the seat that wrote the call stays on this network, the chat holds local-only text, and the target leaves this network (judged by `seatLeaves`, or the image server by address): "This chat has read a note that stays on this computer, so it is not handed to a cloud model." Offline the router keeps the subtask here. Search on a result-only backend after a private read stays a follow-up.
- 2026-10-08 (privacy review, a chosen Offline's words): this supersedes the 2026-10-07 denial line for a chosen Offline: `offlineNowDenied(reason)` says "Offline is chosen, so the web tools wait until you follow the connection again.", since the network is up; the network-down line is unchanged. A chosen Offline's note says models on your own network do the work, since localSeat can seat a LAN or tailnet server.
- 2026-10-08 (privacy review, a plan that read a private note): a plan whose Reasoning model stays on this network is local-only once that model read a private note (its framing pack, a marked turn its digest carried, a marked result it replanned over); while marked, every step bound off this network runs on the Reasoning model with a note saying why, a file-editing step is described here instead of sent to the paired computer's engine (whose model the app cannot judge), and the reply is marked. A reply from a seat that stays is marked whenever the chat it reads holds a marked turn, on every driver.
- 2026-10-08 (privacy review, the plan's image step in the claims): the founder's 2026-10-07 ruling is now in the claims: What leaves this device's cloud entry says that while nothing in the Stack reads images, the Image reading row's cloud model takes a plan's image step without asking and gets text, never a picture, and its note names it; the Stack, Cloud Connections, Privacy plainly, the guide cards and Harbor Lite say the same. A play emits the chat's reach as a turn-start, cloud from the first step that leaves, and What leaves this device says "An amber pill or dot marks a chat whose latest turn went to one".
- 2026-10-08 (privacy review, a vault inside a project): a workspace file whose real path lies in the vault folder is judged as the vault tools judge a note (`core/tools/workspaceNotes.ts`): readFile, grep, glob (names follow vaultList), a failed edit's echo, git diffs and patches, repo search and its query, the code map (names, never outlines), retrieval before turn one, the repo's instructions and Current State (by the whole file), analyzeImage, Trash (by the place a note left, and local-only at the least), a note too large to judge (local-only), and the person's deny rules. Near the vault on a cloud seat, a command or readProcess asks every time, past bypass and every allow, and its card says it can read the vault; on a seat that stays, its output is marked.
- 2026-10-08 (privacy review, the private-notes promise): a command can read any file, and a local model that read a note can write its words where a cloud model reads them later, so the promise carries one caveat in one place: `VAULT_CARRY_CAVEAT`, "Private notes never reach a cloud model unless you run or allow a command or change that carries them." (the pins card, the empty Vault ramp, the plan's private-step note, the local-only folder line, the own-model egress entry). The excluded-notes line keeps `VAULT_COMMAND_CAVEAT` ("unless a command you run or allow reads them"), since no model reads an excluded note. Making the unscoped promise true (no shell or terminal read for a cloud seat while a vault exists, and every write after a private read asking) is the founder's call.
- 2026-10-08 (privacy review, the shells): a chosen Offline is kept in Electron main as an `offline-chosen` marker in userData (the hub pause's pattern), restored as main loads, so a hidden login launch on Windows or Linux serves the phone and runs routines offline; the window stays the authority. Every iOS purpose string names every use the code has, a chat's photo and video included, and is pinned in `app/test/iosPurposeStrings.test.ts`. The image-reader guide says plainly that `OLLAMA_HOST=0.0.0.0` makes Ollama, which has no password, answer on every network the computer joins, and gives each OS a way back (on Linux, systemctl edit again, never systemctl revert); `tailscale serve` waits on a device check.
- 2026-10-08 (privacy review, copy): an API key is "stored only on this device and sent only to" its provider or address; the signed-in card and the preferences entry list every preference that follows, from `settingsReach.ts`; the writing voice line names what never gets it ("except your computer's coding agent, its free chat, and Crew routines"; carrying it to the engine would write it into the computer's journals); the Add to Settings card renders only for a key the chat's own turns asked for, and a cloud seat's answer in such a chat keeps it (this amends the 2026-10-01 line); the profile's account line follows the tier.
- 2026-10-08 (privacy review, the database): pgTAP pins 0027's likeness and review-report revokes and both of its retention jobs (`supabase/tests/rls.test.sql`, `guardrail_privacy.test.sql`); CI's `sql` and `sql-replay` jobs are their first run. No migration changed.
- 2026-10-08 (privacy review, Windows): the vault judge reads one realpath. `realOf` in `core/tools/workspaceNotes.ts` walks to the deepest existing ancestor with the native realpath, never the jail's `deepestRealpath`, since on Windows the native call spells a folder by its long name where Node's other realpath keeps an 8.3 short one, and the mix judged a note under `Private/` that was not on disk (a Current State, a note deleted in git) as outside the vault. Found by CI's windows job on 6bbd3c2, which then ran green on 05916ae7. The glob tool matches the walk's paths with forward slashes, so a folder pattern matches on Windows too.
- 2026-10-08 (release): OpenShore v0.1.64 for Linux and Windows, published by hand from `main` at 05916ae7 (Release run 71) after the privacy review's fixes and a green CI; the version follows openshore-releases' newest tag (v0.1.63), not this repository's. Each file's sign step reads `Signed`, and the printed public key is the pinned `DESKTOP_RELEASE_PUBLIC_KEY`, so the founder's "a release run whose sign step says Signed per file" is seen. The cancelled run 70 published nothing.
- 2026-10-08 (founder): "For the decisions have my CX and CMO decide." The eleven calls the privacy review left open (A to K, the brief's) went to CX and the CMO: each wrote a memo, read the other's and concurred, revised or held; where they still split, CX's position decided behaviour (what asks, what runs, what is refused) and the CMO's decided words, unless that made a claim untrue. Their rulings follow, built in four packages with adversarial sign-offs.
- 2026-10-08 (CX and CMO, for the founder): the private-notes promise stays scoped and reads 'OpenShore never sends private notes to a cloud model. A command you run or allow, or a change you allow, can still carry their words to one.' (VAULT_CARRY_CAVEAT is that second sentence, and the Vault rows say 'Private notes'); projectMemoryWrite, the one write the engine allows by name, asks every time once a chat on a seat that stays holds a private note's text, in every mode and past every grant, and a routine leaves the memory notes as they were (the one narrowing of the founder's silent memory-write rule); files in the vault's dot folders are private at the least, a Crew run note written after a private read carries oscode: local-only, and handoff records from before 0.1.64 are swept once; no general write-ask (the CMO's held reading) and no option 2.
- 2026-10-08 (CX and CMO, for the founder): Ollama cloud tags stay on the desktop picker as built; the install card drops its cloud example for 'A name whose tag (after the colon) is cloud or ends in -cloud runs on Ollama's cloud, not on this computer.', a cloud tag's pull says where it runs, and Runs the show and every Specialists row wear a chip judged by seatLeaves and hostIsLoopback: Cloud, On this computer, or On your network (the CMO's words; CX held the Cloud chip only).
- 2026-10-08 (CX and CMO, for the founder): the cloud-tag picker line and card say 'your messages and the files the agent reads', end at ollama.com, and call a loopback server 'Ollama on this computer' (hostIsLoopback, never isLocalHost, which passes the LAN and the tailnet); the remote-server card takes the same noun.
- 2026-10-08 (CX and CMO, for the founder): on the computer a placed cloud specialist asks on the amber card before its first handoff in each task, per model (delegate, analyzeImage, generateImage, an Ollama cloud tag included), the approval keyed by provider and model so the orchestrator's does not cover it; its transcript row names the model with the Cloud chip and an additive reach event turns the turn cloud; in the app's Stack chats placing stays the yes (founder, 2026-09-25). CX's behaviour call; the CMO held no card on either host.
- 2026-10-08 (CX and CMO, for the founder): the founder's 2026-10-07 exception comes off, since a plan never carries a picture and, with a cloud Reasoning model, the cloud reader sent the chat to a second provider the person did not pick (both advisors' reason, the founder's bar): with nothing set for Image reading a plan's image step runs on the Reasoning model from the text, the two-door offer still shows when nothing reads images, PLAN_IMAGE_STEP_LINE and every footnote go, and tenet 4 loses the exception. The CMO's final kept the rule for a cloud Reasoning model.
- 2026-10-08 (CX and CMO, for the founder): the sticky local-only reply mark stays; once per chat for each model that leaves, on the first turn it is sent the placeholder, the transcript says 'This chat drew on a private note, so {model} sees your local models' replies since then only as a placeholder.', remembered in the session only; no model-sheet line (the CMO's held addition) and no badge.
- 2026-10-08 (CX and CMO, for the founder): a private pin keeps holding every cloud handoff in its project; the refusal names its cause (HANDOFF_PIN_DENIED for a pin alone, HANDOFF_LOCAL_ONLY_DENIED for a read, both 'private note'), a private pinned row and the picker wear the lock and 'Private', and under the list, while a pinned note is private and Memory carries pins to the coding agent: 'A private note is pinned here, so while the coding agent runs on a local model, it hands no step in this project to a cloud model.'
- 2026-10-08 (CX and CMO, for the founder): once a chat on a seat that stays holds a private note's text (a read, a marked turn, or a private pin), every model-written search on a result-only backend and every page fetch asks first, every time, on a card with the exact words or address, past session allows, Always and Bypass; Perplexity stays refused on both hosts, before any ask; Harbor Lite's search of the person's own question and a clean chat keep today's ask; a routine's search guard also counts a private note carried in the pack.
- 2026-10-08 (CX and CMO, for the founder): Add to Settings stays on a cloud seat's reply in a chat that asked for a writing voice, with no per-reply reach; when Settings already holds a different value the card says 'Nothing changes until you tap Add to Settings, which replaces the one in Settings, Writing.'
- 2026-10-08 (CX and CMO, for the founder): a private plan's file-editing step runs on the paired computer when a fresh GET /stack says its Reasoning model stays on its network and the daemon accepts local-only turns (acceptsLocalOnly); the step goes marked local-only (POST /input localOnly), so the engine's D5 rules hold, and a session holding local-only text never escalates to a seat that leaves; a cloud model there gets a description and a note saying so, an older daemon today's note. CX's behaviour call; the CMO held the stricter every-seat test.
- 2026-10-08 (CX and CMO, for the founder): Image reading falls back once: when the Local model errors on a picture before writing anything and the Cloud slot holds a reachable model that reads images, a card (amber for a cloud model) asks before the picture goes to it, and a no sends nothing; the intro, the Cloud row and the Cloud sheet say so.
- 2026-10-08 (release): OpenShore v0.1.65 for Linux and Windows, published by hand from `main` at 42abf645 (Release run 72) with CI green on every job, Windows included: the CX and CMO rulings A to K, the Claude workspace fix (eb765d39), and two CI fixes made on the way (two lines put back on Prettier's style; the idle-eviction test widened to 1 s, since a first session's start on Windows now crosses 50 ms and the daemon's real window is 30 minutes). Each file's sign step reads `Signed` with the pinned desktop key.
- 2026-10-07 (founder, connect anywhere; `docs/design/connect-anywhere-proposal.md`): the phone's Pairing room is named **Computer** (`ROOM_LABELS.pair`, on every platform, so the room has one name), and linking a device to a machine is **docking** in copy; "CLI Pairing", a current's name, stays. Docking is free: `PAY_GATE.pairing` is `'free'` ("Do not gate anything. Assume we've made this app free completely"), so Computer, Scan, Dock, another computer from the desktop, and a chat with the docked machine meet no paywall. The other Plus rooms are unchanged by this call; the account gate at the Computer room's door is unchanged too. The founder ran with the proposal's recommendations: a model on the person's own server is judged local by address (teal, Crew may use it) with one plain line that the hosting company can reach its disk; Tailscale is the only door (no SSH-tunnel path, no public bind); the subscription door (CLI Pairing) stays a tier-2 current and is not shown in Personal.
- 2026-10-07 (connect anywhere, engine): a server's yes is typed in its SSH terminal. `osc serve` starts the daemon with `pairingConsole` and `kind: 'server'`; with no approver a pairing request waits for an admin's answer (`POST /pair/requests/<id>`, `{allow}`) and is a no when it expires unanswered; an admin mints the QR's claim at `POST /pair/claims`. Any admin credential may answer, so a phone already docked as admin can let the next one in (a docked admin already holds the terminal, so this widens nothing). The desktop keeps its native dialog and passes `kind: 'desktop'`; a daemon with neither still refuses at once (F3, held by `daemonLifecycle.test.ts`).
- 2026-10-07 (connect anywhere, install): `install-server.sh` is fetched from the public `openshore-releases` and trusts only a package signed with the pinned desktop release key (the same message as `releaseVerify.ts`, checked with `openssl pkeyutl -rawin`), never installs Tailscale itself (it prints Tailscale's own line and stops), and runs the daemon under systemd as a non-login `openshore` user on the tailnet bind. Node is bundled in the package, so a server needs none; x64 only for now. The script itself rides TLS from GitHub, the same trust as Tailscale's own installer.
- 2026-10-07 (connect anywhere, providers): Venice and OpenRouter list no typed model ids; their models load from `GET {base}/models` on the person's key (`liveModels`), because a router's list changes weekly and a typed id is a dead button. The first set is every Venice text model (capped at 24) and, for OpenRouter, the newest tool-taking model from each of ten well-known makers, chosen by maker prefix, never by a typed id; the person changes it under Choose models. Privacy words are Venice's own and attributed ("Venice says"), and OpenRouter's say it forwards to the model's own provider. The model-list request is on the egress list's `cloud-models` entry.
- 2026-10-08 (CTO review of connect anywhere before main, founder-directed): three reviewers (the daemon, pairing and the installer; what leaves the device and the claims; conflicts with what 2026-10-07 and 2026-10-08 shipped), each verified against the code. Fixed before merge: the admin pairing routes answer only on a server (`pairingConsole`), so the desktop's yes stays in its own dialog and a docked phone cannot let another device in there; a server whose loopback port is held by someone else refuses to start, since `osc pair --server` sends the shared token there; the server package is root-owned in the archive and on disk (`--owner=0`, `--no-same-owner`, `chown -R root:root`), so the runner's uid never owns the engine; the unit gains `SHELL=/bin/bash` for the docked terminal and `ProtectSystem=full`, `ProtectHome`, `PrivateDevices`, `RestrictSUIDSGID`, `ProtectKernelTunables`, `ProtectControlGroups`; the installer asks for OpenSSL 3 by name; device labels in the terminal lose control and format characters; the release installs with `SKIP_NATIVE_REBUILD=1` and smoke-loads node-pty on the bundled Node, and the server steps cannot hold a desktop release back until the first server release has gone out. Vault and Crew name a docked server Your server, and Vault's where-it-lives line carries the renting line; Venice's taglines say no privacy words until a real `/models` answer is pinned; the egress entry says when the model list is asked for; the paywall no longer sells docking; the guides name the new labels (Code, Dock, Docked devices); Scan stays in the first screen, the two docking paths one choice above it and the other ways in below. Kept: every door to the room says Connect your computer, the room is named Computer (founder's later instruction over the 2026-10-07 nav note). Follow-ups in PROGRESS.
- 2026-10-09 (bring your own keys, Part 1, the named providers): Groq, Together AI, DeepSeek, Mistral, xAI, Cerebras, Hugging Face, Nebius Token Factory, Novita AI, MiniMax and NVIDIA join `PROVIDERS` after OpenRouter as data (`liveModels`, `more`), ids lowercase and clear of every other `oscode.secret.*` name. A key page is the URL the provider's own docs confirm (Mistral, Hugging Face, Novita AI, NVIDIA), else the console's root (Groq, Together AI, DeepSeek, xAI, Cerebras, Nebius, MiniMax), never a path only third parties give; a key hint is the key's prefix only where the provider documents one (hf_, sk_ for Novita, nvapi-), else "a Groq API key". Taglines say whose key ("On Groq, on your key."), and Hugging Face's says it forwards to one of the providers it lists, as OpenRouter's does; no provider is called private or fast.
- 2026-10-09 (bring your own keys, Part 1, the list reader): `parseLiveModels` takes a `data` list or a bare one; a row with a type is kept for text, chat or model, or a Mistral base or fine-tuned card whose capabilities say completion_chat (fine-tuned added: it is the person's own model); a row that says nothing of what it is (a plain OpenAI list) is dropped only when its id plainly names an embedding, rerank, speech, image, video or safety model; Groq's `active: false` is dropped. A list that says nothing about tools marks the row `toolsUnknown`: categories stay `writing` and the picker claims neither way. Hugging Face takes tools when any provider it lists does and the smallest window listed. A `created` before 2020 is never a release date, for every provider (NVIDIA stamps every row 1993; Venice and OpenRouter send real dates, so their results are unchanged). A first set for a named provider is tool-taking models first, then unknown, newest first where dated, an alias once, capped at 24; Venice and OpenRouter keep their own rules. A key check reads 401 and 403 as rejected everywhere and a provider's own `rejectsWith` too (only xAI, 400, today).
- 2026-10-09 (bring your own keys, Part 1, Cloud Connections): the familiar seven are the providers without `more`, then each named provider once its key is in, in list order, then one More providers row (gone when every named one is connected) opening a searchable sheet; a tap there closes it and, after the sheet's exit (sheets never stack), opens the same key sheet. A last row, Any other provider, shows away from the desktop only, on a phone, an iPad or the web (the desktop's Stack has no address form) and says OpenAI-compatible, since the Stack's form takes only that until Part 2 lands. Disconnecting any provider, Claude included, now takes its `cloud:<id>:*` placements off every status's stack, the anchor falling back to the built-in guide, as disconnecting a connected model does (`state/providerOps.ts`).
- 2026-10-09 (bring your own keys, Part 1, fixes): the desktop's guarded fetch passes `x-api-key`, `anthropic-version` and `anthropic-workspace-id` (the last added beyond the brief, since an identity-linked Claude key's check needs it), and a cross-origin redirect drops `x-api-key` and `anthropic-workspace-id` with `authorization` and `x-auth-token`; the list lives in `electron/mainGuards.ts`. A tool round's replay carries `reasoning_content` back only when the reply sent that field (DeepSeek, Kimi), never `reasoning`, and never into the answer or a later turn's history. A cloud seat with no key is named by its provider's name. What leaves this device's cloud-models entry names all eighteen providers and now says saving a key sends it to its provider to check; the Local Library shelf's line no longer says its models are hosted by their makers; the release script still keys only typed providers (no Perplexity row added: its list path is undocumented).
- 2026-10-09 (bring your own keys, Part 1, review fixes): a key check's yes counts only once the same request with a made-up key (`KEY_CHECK_CONTROL`, nothing of the person's) is turned down, for every provider but Anthropic, since a model list some providers serve to anyone (NVIDIA's and OpenRouter's are reported to be) would pass any string; a control that also gets the list is the new `unchecked` result, saved with a toast that says the first chat is the check, never "connected". No per-provider key path was added (Hugging Face's whoami, OpenRouter's key route): none could be confirmed from here, and a wrong one would turn a good key away. Disconnect's question now says its models leave the bench and every stack, and offers Replace its key, which saves over the key and changes nothing else, so rotating a key keeps its placements. Mistral's chunked `content` (a thinking chunk, then text) is read on both the streamed and the whole reply: text is the answer, thinking is thinking and is not replayed. A list that stamps every row alike is undated (no release date, no newest-first order), and a first set skips a model when any of its aliases is taken. More providers' search also reads `searchTerms` (grok, hf, nim, ai studio), Hugging Face's key sheet says the one token permission it needs (`keyNote`), and the guide card's keywords name every provider in Cloud Connections.
- 2026-10-09 (keys on your server, engine; `docs/design/byok-any-provider-plan.md` part 3): the key routes (`GET /keys`, `PUT /keys/:id`, `DELETE /keys/:id`, `DELETE /keys`, `POST /stack/orchestrator`) answer on the switch the pairing console routes use (`pairingConsole`, 404 on a desktop, which takes its keys from its own app) and only to an admin device, with an 8 KB body cap and ten key writes per device credential, then one every six seconds; the server never checks a key with its provider (no outbound call, no oracle), and the Claude key's `sk-ant-` shape is the only check, made locally. `osc key` writes the same store directly (`auth/providerKeys.ts`), so it works with the daemon down and a key added over SSH never passes through a phone.
- 2026-10-09 (keys on your server, engine): a provider key lives at `provider-key:<id>` and an endpoint names it with `apiKeyRef`, limited by the schema and again at the read to that namespace; any id but `anthropic` is written as an OpenAI-compatible endpoint with `versionedBase` (the engine adds /models, /chat/completions, /embeddings with no /v1). The Claude key on a machine is one key whichever door wrote it (`osc login` or a route): `GET /keys` lists it, and removing `anthropic` or forgetting the server deletes it with its workspace; a Claude record pointed at another address is left alone (409, "osc login --logout"). The Claude workspace id goes only with the Claude key to `https://api.anthropic.com`; an Anthropic-compatible endpoint with a key of its own is never the escalation target.
- 2026-10-09 (keys on your server, engine; the J4 rule): a remote keyed model is budgeted against the window the app knows for it, kept per model on its endpoint (`providers.<id>.contextWindows`, machine config) by `POST /stack/orchestrator` or `osc stack use --context`, and read only for an endpoint whose address leaves this network, so a local server is still budgeted against the window it serves. The class follows the existing rule: a size in the name, else a window of 100k or more is 'mid', never 'large' until the eval says so (tenet 2); a model with no window kept stays the 8192 guess. No dollar price is invented for a non-Claude model: its spend stays uncounted and the per-task card still asks. `contextTokens` for a seat on this network is ignored, not refused.
- 2026-10-09 (keys on your server, engine): the four unauthenticated backend probes are skipped for an endpoint off this network that has a key (`apiKeyRef` or `apiKeyEnv`) or a versioned base, which is a provider's API; an unkeyed server at a public address is still probed, since its flavor sets the window it serves.
- 2026-10-09 (keys on your server, engine): `osc key add` knows the base for every provider the app names plus the eleven named on 2026-10-09 (ids groq, together, deepseek, mistral, xai, cerebras, huggingface, nebius, novita, minimax, nvidia), held to the app's `PROVIDERS` bases by `test/providerKeys.test.ts`; their hosts join the `cloud-models` entry of the egress list, since the engine's table names them. A server with no model answers a session create with how to choose one (in OpenShore, or `osc stack use` as the server's account); routines and the free chat still refuse a seat that leaves (CTO 3).
- 2026-10-09 (keys on your server, engine, review fixes; supersedes today's probe and no-model lines): the key door (`osc key add`, `PUT /keys`) takes only an https address off this network, so a keyed endpoint always reads as leaving and a gateway on the server's own network (LiteLLM passing turns to Bedrock or Azure) can never reach routines, the free chat or private notes through it; a model server on this network is set up in the stack until Part 2's forwards-to-a-cloud mark lands. The four probes are skipped only for an endpoint `osc key` wrote (`apiKeyRef`) or a versioned base off this network, so a hand-written `apiKeyEnv` server at a public address is probed as before, and a versioned base is probed at its root (its trailing /v1 taken off). A server with no model names only the SSH way (`osc stack use ... --context <tokens>`) until the app's "Use on your server" ships, and `osc key remove` names only `osc stack use`.
- 2026-10-09 (keys on your server, engine, review fixes; supersedes the Anthropic part of today's namespace line): `apiKeyRef` is dropped from the Anthropic endpoint, since nothing writes one and its copy, label and pricing are Claude's; an Anthropic endpoint someone points at another address keeps the Claude key and no workspace, and its cloud card names the host instead of "cloud Claude". OpenAI's own API (api.openai.com) is sent `max_completion_tokens` for the cap and no temperature on a reasoning model (gpt-5, the o series), which refuse `max_tokens` and any temperature but the default.
- 2026-10-09 (keys on your server, security and privacy run): one medium finding, open. On a server with no libsecret the credentials file's key is derived from the machine (hostname and /etc/machine-id, which is world-readable), so any process running as `openshore` (the admin shell, a command a person approves) or anyone holding a copy of the disk can read every provider key there. Copy never calls that holder encrypted: `osc key add`, `osc login` and `osc doctor` word it through `auth/keyHome.ts` ("a file only this account and root can read", and why). Follow-up: wrap the file key on a server (systemd-creds, or a passphrase), and consider denying member sessions on a server a shell read of the engine's home. No key reaches a log, a URL or an answer; nothing is stored beyond the key and the provider's address; the routes are admin-only on the tailnet; the redactor now knows the key shapes of the named providers that have one (OpenRouter, OpenAI project keys, Groq, xAI, Cerebras, NVIDIA, Hugging Face, Together, Perplexity, Novita), held per provider beside the base table.
- 2026-10-09 (keys on your server, engine, review fixes): the hidden key prompt skips only the bracketed-paste markers; any other escape sequence (an arrow, Home, End, Delete, a lone Escape) refuses the line and saves nothing, since a key edited with keys the prompt cannot show would be stored wrong without a word. Forgetting a server (`DELETE /keys`) deletes every `provider-key:` name in the store, a stray one with no provider entry included, and `GET /keys` lists such a stray (host '') so it can be removed; a locked store refuses the list (503) rather than read as none.
- **Greeting styles (2026-09-27):** the splash greeting's tap and hold come
  in four decks picked in Settings, Greeting (Languages stays the default).
  The founder's "Trivial Pursuit" ships as "Trivia Night", since that is
  Hasbro's game name and the questions are not from it; "Popsicle Jokes"
  keeps the founder's name, as the common phrase for the genre. The landing
  line stays the time-and-day greeting in every deck, so the splash still
  opens on a welcome and the egg is found by the tap, as before.
- **Greeting decks at volume (2026-09-27):** each deck ships as its own lazy
  JSON chunk rather than inline, so thousands of cards cost the first load
  nothing. Only reviewed content ships: a card a fact-check agent doubted is
  dropped, never argued back in, and trivia and sports carry no result from
  2023 on (the edge of what the writers reliably knew). Fortune numbers are
  drawn at deal time, not stored. Spare, unreviewed Word of the Day top-ups
  were not shipped, since the reviewed deck already met the count.
- **Greeting decks DEI audit (founder, 2026-09-27):** the trivia and sports
  decks are selected for balance, not just accuracy: answers about women
  roughly match answers about men, the US is capped near a tenth of trivia
  and a quarter of sports, and team names drawn from Native peoples are left
  out while the deck can do without them. Athletes are named by the names
  they chose, never birth names they left. Jokes use "they" or vary
  characters rather than defaulting a job to one gender. When an auditor kept
  a card that carries history (blackface, the Lost Cause, a hate movement's
  slogan), it was dropped by hand.
- **Greeting decks web audit (2026-09-27):** in this sandbox WebFetch is
  blocked for every reference site, so a card counts as web-confirmed when a
  WebSearch result summary states the fact and names a trustworthy source
  (cited in the audit notes). Every new or changed card had a second,
  independent reader with its own searches. Cards that could not be
  confirmed were cut rather than shipped as read-only: all 206 capital-city
  cards and the "In what year" run left with the NBA and World Series
  champion-by-year runs, and several long template runs (rivers through
  European cities, chemical symbols, SI units) gave up part of their length.
  Scores are written "New Zealand won, 34 to 31." so no hyphen reads as a
  dash, and competition names are pinned (FIFA, men's, Summer Olympics)
  wherever another event shares the year.
- 2026-10-09 (porting the greeting decks to main): main was re-rooted on
  2026-09-30, so the branch's 15 commits came over as one change rather than a
  merge. The decks follow main's 2026-10-07 ruling: straight apostrophes and
  quotes, like every other line, until the app-wide typographic sweep (the
  deck test now holds that, not the reverse). The pick is a device setting
  (`settingsReach.ts`), kept off the account's eight preferences, and the
  Settings check is the drawn `CheckGlyph`.
- 2026-10-09 (bring your own keys, Part 2, the form): the Stack's Connect a model reads the address's own list on Load models and makes one connection per ticked model, sharing an `addressId`, with the key written under each connection's own `byomSecretKey(id)`, so every reader, sweep and `byom:<id>` placement works unchanged (`state/byomOps.ts`, wired into `connectByom`, which now takes `models` and returns the connections). One model keeps the typed name; several are named "Name · model". A list with one model starts ticked; no list (no answer in 8 seconds, another failure, an unreadable or empty one) falls back to a typed name, while a refused key is said as one (see the review-fixes line on the sheet below), and the person can switch either way. A change to the address, the format or the key sets a loaded list aside, and a late answer for an address since changed is dropped. `addressId`'s one reader is the options sheet's "Disconnect all N at host", offered once an address has several models. The desktop's Stack still has no form.
- 2026-10-09 (bring your own keys, Part 2, the list read): `lib/byomList.ts` asks `GET {base}/models` with a Bearer key (OpenAI format) or `GET {root}/v1/models?limit=1000` with `x-api-key` and `anthropic-version: 2023-06-01` (Anthropic format, one page as long as the format allows), through `nativeFetch`, and reads the answer with Part 1's `parseLiveModels`. `nativeFetch` gains `timeoutMs`: CapacitorHttp's connect and read timeouts on the iPhone, an abort held until the body is read on the web; the desktop's guarded fetch keeps its own 30-second cap. The plain-http-to-a-public-host refusal runs before the read as well as before Connect, since both carry the key.
- 2026-10-09 (bring your own keys, Part 2, the mark): `forwardsToCloud` ("Passes requests to a cloud provider", `BYOM_FORWARDS_NAME`) rides on `ByomConnection` and the byom ref (`byomRef` copies it, the format and `addressId` only when set, so a legacy ref is unchanged and reads as OpenAI-compatible and not forwarding). Stricter only: `byomReach` takes it as a fourth argument, `refStaysLocal` passes the ref's, and `packSeatFor` reads the ref's or the connection's (`byomForwardsToCloud` in the store's seat context), so a ref placed before a mark still leaves. The plain-http refusal stays judged by address alone (the hop to a gateway on your own network stays on it). A window the list reports is kept as `contextTokens` only when the address leaves this network or carries the mark (`keepsListedWindow`); the class stays the BYOM rule (by name, kind local) until the CTO rules on J4 for an address off this network. The switch shows for every address, and its line says an address outside your network already counts as cloud.
- 2026-10-09 (bring your own keys, Part 2, the Anthropic format): `runByomAnthropic` and `completeOnce` send the Anthropic SDK with `baseURL` set to the address's root (`normalizeAnthropicBase` takes a pasted /v1/messages or /v1 off), the person's key or none (`apiKey` null and `x-api-key` sent as omitted), `authToken` null, `maxRetries` 0 like the OpenAI path, no workspace header, none of the SDK's own client and platform headers and no bearer (see the review-fixes line on the address client below), no thinking parameter, no cache markers, `max_tokens` 4096 (`BYOM_ANTHROPIC_MAX_TOKENS`), the system prompt as one plain string, empty turns dropped, turns from one side merged and the chat opened on a person (`anthropicTurns`). It streams on `streamingFetch`, the Claude path's transport, so unlike the OpenAI format there is no native-shim retry on the iPhone for a server that refuses cross-origin calls (LiteLLM allows them by default). The tool loop is one (`runToolLoop`) for both formats: the vault slice and the codemagic tool where the OpenAI path offers them, the fall back to no tools on a 400, 404 or 422 in round one, the search pass. A replay carries any thinking blocks the server sent, the answer text with its tag thought left out, and the tool_use blocks (see the review-fixes line below). A failure is said in the address's name ("Gateway answered 401.", "Could not reach Gateway."), never in `describeError`'s Claude words.
- 2026-10-09 (bring your own keys, Part 2, Chain of Thought): on an Anthropic-format address the prompted `<think>` path applies to a model whose name is not a native reasoner by the shared `reasonsNatively`, and the client splits the tags out of the text; a model named for Claude behind an address is neither prompted nor sent a thinking parameter on this conservative wire, so with the setting on it shows no thinking, as an OpenRouter Claude model already does. Off, nothing asks it to think and a thought it writes anyway stays out of the chat.
- 2026-10-09 (bring your own keys, Part 2, copy): the Connect a model row, How connecting works, the sheet's lead, Cloud Connections' Any other provider row and More providers' no-match line, and the byom and Cloud Connections guide cards say any address, in the OpenAI or the Anthropic format; the private-notes line keeps OpenShore as its subject ("OpenShore never sends it private notes"). The own-model entry of What leaves this device names the list read on Load models and says a model at an address on your own network counts as local unless you mark that address as passing requests on. Cloud Connections' list picker is now the shared `ModelChecklist`, its behaviour unchanged.
- 2026-10-09 (bring your own keys, Part 4, the gateway guide): `connect-own-gateway`, titled "Use Bedrock, Azure, or Vertex", opens from How connecting works. It is strictly the person's own LiteLLM on their computer or server with their own provider keys: install (`pip install 'litellm[proxy]'`), a long random master key starting sk-, a config to paste, `litellm --config config.yaml --host 100.x.y.z` on the machine's Tailscale address only (see the review-fixes line below), connected at `http://100.x.y.z:4000/v1` in either format with the master key and the mark on. LiteLLM's quick start is a link-only host (`docs.litellm.ai`). The guide card `own-gateway` carries a prose summary, not `guideStepsCompact`, so Harbor Lite does not pace it and `GUIDES_PACED_BY_HARBOR_LIGHT` is unchanged; `guideHarness.ts` needed no new term, since the card's keywords route a Bedrock, Azure or Vertex question to it (eval case `own-gateway`). The quick start's site could not be fetched from this sandbox; its claims were checked against LiteLLM 1.104.2's own source from PyPI instead (the review doc lists each).
- 2026-10-09 (bring your own keys, Part 4, review fix: the bind): LiteLLM's proxy listens on 0.0.0.0 by default, so the gateway guide starts it with `--host 100.x.y.z` after a `tailscale ip -4` step, the docking rule (tailnet only, never a public bind) applied to a gateway on a rented server. A typed placeholder over `--host "$(tailscale ip -4)"`: a missing or logged-out tailscale would make that an empty host, which binds every network, while an unreplaced placeholder fails to start. Reaching the gateway over a home network by its LAN address is dropped from the guide, since the bind makes it tailnet only. The master key is `echo "sk-$(openssl rand -hex 24)"`, written into a config copy block whose example is the Bedrock model LiteLLM's own example config uses; the step that pastes it says it is the gateway's admin key and that a virtual key limited to the configured models is better where LiteLLM runs with its database (virtual keys need it).
- 2026-10-09 (bring your own keys, Part 2, review fix: the address client): `app/src/drivers/addressClient.ts` builds the Anthropic-format client on a subclass whose `_shouldResolveDefaultCredentials` is false (the SDK's own hook for a client with its own auth), so with no key it never resolves a profile or token of the machine's, and on a fetch wrapper that deletes `ADDRESS_DROPPED_HEADERS` (the SDK's version and platform headers, retry count, timeout, the per-request `x-stainless-helper-method` that `defaultHeaders` cannot null, and `authorization`) from every request. `anthropic-dangerous-direct-browser-access` still goes: Anthropic's own API asks it of a browser, and it names nothing of the person. Held on the real SDK by `app/test/byomAnthropicHeaders.test.ts`.
- 2026-10-09 (bring your own keys, Part 2, review fix: the mark after connecting): a connected model's options sheet has the same switch, set or cleared for every model from its address in one save, and every placed ref of theirs is rewritten (`markByomForwarding`), so `refStaysLocal` and `packSeatFor` agree. It clears as well as sets: unmarked, the address is judged by where it is, the person's word as at connect. Clearing drops a listed window where it is no longer the window served; setting brings none back (the list is not kept), so a newly marked seat keeps the 8192 guess. The sheet's last button reads Done, since the switch applies at once.
- 2026-10-09 (bring your own keys, Part 2, review fixes: the wire): an image sent with no words to an Anthropic-format address opens a user turn of its own (`withTurnImages`) rather than folding into the reply before it, with no empty text block. The replay of a tool round keeps any thinking or redacted_thinking blocks the server sent unasked, ahead of the split answer text and the tool calls, as Claude's replay does, for servers that always think.
- 2026-10-09 (bring your own keys, Part 2, review fixes: the sheet): a list read refused with 401 or 403 is said as a refusal ("That address refused the key", or "asks for an API key" with none) and leaves Load models to try again, never a typed name on a key just turned down; a 404, an unreadable or empty list, or no answer still falls back to a typed name. The shared checklist shows its search from 8 models up, and Connect carries a count only for two or more. Disconnecting one of several models from an address says only its own copy of the key goes and names Disconnect all; `disconnectByom` takes several ids and saves once. More providers answers a search for Bedrock, Azure, Vertex or AWS (away from the desktop) with a Walk me through it door to the gateway guide. The byom and own-gateway guide cards say the door is on a phone, an iPad or the web; the marked-gateway promise is one vaultCopy constant (`VAULT_PRIVATE_OFF_MARKED`), the carry caveat after it.
- 2026-10-09 (keys on your server, app; `docs/design/byok-any-provider-plan.md` part 3): Cloud Connections gains two rows under each docked server, Keys on your server and Model on your server, only when its `/health` says `keysOnServer` and answers this device as admin (read fresh when the room opens, never from `settings.hubRoles` alone), so a member device, a computer, an older server and one that does not answer show nothing new. The server is the source of truth: no settings key was added, and the sheets read `GET /keys` and `GET /stack` each time. Its providers are this device's connected ones a server can take (Claude, and every provider with an https `openaiBaseUrl`), each with a switch; a key only the server keeps (added over SSH, or from another device) gets Delete, after a word in the same sheet, since this device cannot put it back.
- 2026-10-09 (keys on your server, app): a key goes in one `PUT /keys/:id` body read from this device's secret store at the moment it goes; Claude's with `anthropicWorkspaceId` and no address (the engine sends it only to Anthropic), every other provider's with its `openaiBaseUrl` and name. Model on your server offers the models this device knows for each provider the server keeps a key for (`providerBenchModels`, a live provider's picks; an image-only model is left out, since it cannot run a coding session) and sends the window only for a non-Claude model whose list gave one in the engine's range; a provider with no known models here is named with the SSH way (`osc stack use`).
- 2026-10-09 (keys on your server, app, the lifecycle): forgetting a server (`removeHub`) and re-pairing over it (`saveHub`, with the old credential) send `DELETE /keys` before `DELETE /pair/self`, as the brief asks, so this device is never left unable to delete the keys there (this device forgets the hub at once and holds the credential in memory for the two calls); a device that is a member there sends neither delete, the confirm says so to any other, and a server that did not answer opens a note with `osc key list` and `osc key remove`, run as the server's own account (`SERVER_ACCOUNT_PREFIX`, held to the engine's). Forgetting deletes every key there, one added over SSH or from another admin device too, which is the engine's `DELETE /keys` and is said before the tap. Disconnecting a provider asks each docked server this device is not a member of (`GET /keys` spends no key write) and deletes the key only where it is kept; the question names the servers this room last read as keeping it, and a note follows only for a server that did not answer and was not last read as keeping none.
- 2026-10-09 (keys on your server, app, copy): a docked machine's cloud model reads "<model>, at <company> on your key, from your server" (Anthropic, Google and Moonshot by company, every other provider by its name, an unknown or Ollama cloud tag as "a cloud model reached from"), in the model menu, the desktop's own row (the same false "running on this computer" for a cloud seat), the Stack's docked card and the server's own sheet; a machine with no model says how one is chosen (Cloud Connections or `osc stack use` on a server, an admin's call for a member, the Stack on a computer). The Connections lead, What stays on this device and the Cloud Connections guide card say the server exception; the connect-step lines in `setupGuides.ts` and `guidedSetup.ts` ("stored only on this device and sent only to that provider") stay, since they describe the moment a key is saved, before any server has it. The app cannot tell which holder a server's store uses, so the copy describes the no-keychain file most rented servers have, in `keyHome.ts`'s words, never "encrypted".
- 2026-10-09 (keys on your server, app, review fixes; supersedes the re-pairing half of today's lifecycle line): re-pairing over a saved server only revokes the old credential (`DELETE /pair/self`, sent once the new credential is saved, so nothing waits between a spent pairing code and the save) and never sends `DELETE /keys`: the new credential manages the same keys and model, so nothing is stranded, and deleting keys added over SSH or by another device without a word broke "deletion asks every time" (interaction model, tenet 5). Forgetting alone deletes them, as the plan says. A device re-paired as a member leaves the keys to the server's admin or `osc key remove`.
- 2026-10-09 (keys on your server, app, review fixes; supersedes today's copy line where they differ): the server says which providers it keeps a key for, never whose key it is, so the keys sheet says "<server> keeps a <name> key." and, for a provider this device has no key for, "<server> keeps it; this device has no key for it.", never "too" or "added there". Replacing a key here, or Claude's workspace, offers after the key sheet leaves to send the new one to each server last read as keeping that provider (one `PUT`, which replaces it there), and says which did not take it. Routines and Chat with your server refuse a cloud model on a server (CTO 3), so the copy says they stop while one is its model (`SERVER_MODEL_LOCAL_ONLY`), never that they "stay on a local model"; placing a cloud model over a local one, and turning off the key the server's model runs on, each ask first, the first with the command that puts the local model back. The SSH way is a copy block run as the server's account (`serverStackUseCommand`), never an inline `osc stack use`, and a row's no-model line names only Cloud Connections. The connect-step lines now carry the server exception too, held by an over-claim pattern for an unqualified "sent only to its provider." that also reads Harbor Lite's app knowledge; the App Store draft says the same.
- 2026-10-09 (keys on your server, app, review fixes, the rest): each way a key leaves a server is tried once, so the lead, the egress entry and the review doc say "if the server answers then" and that OpenShore shows the SSH way otherwise; the note after a failed delete says OpenShore "could not delete" (the server may have answered and refused), names the provider, rises only after the confirm's exit, and is skipped for a server whose `/health` answered without offering this device keys. A server's cloud model is named by the host `GET /keys` gives when that is not the provider's own address, in the admin's sheets only: `GET /stack` carries no host, so the model menu and the Stack's card still name the company by id (review doc follow-up). The two rows under Your server step in on the shared stagger when the server answers (`SettingsRow` `arrive`), each sheet reads the server again when it opens, and a tapped switch moves at the tap and goes back on a refusal. A forget the app is closed during is not retried (review doc follow-up; the verdict no longer promises no key is ever left).
- 2026-10-11 (founder, open source): OpenShore goes open source under the Apache License 2.0, and the pay gate goes. The founder's terms, verbatim in substance: "Get rid of the pay gate and open up the license. I still want sole ownership over what gets shipped and actual ownership over the repo and applications. Say it gets thousands of users, I want to be able to run the app and build the company. I'll pay out contributors but won't promise anything." Apache 2.0 over AGPL for adoption and its patent grant, matching the Apache weights of the three curated models. A CLA (`CLA.md`, modeled on the Apache ICLA: copyright stays with the contributor, a broad license to Open Shore LLC that includes relicensing, no payment owed, discretionary rewards only) over a DCO, because a DCO alone would leave every contributor's code under Apache only and the company could never change terms. Ownership of what ships rests on the merge rights, the signing keys and the marks (`TRADEMARKS.md`), not on the license. `NOTICE` names Open Shore LLC, the holder the old `LICENSE` named. The CLA and the trademark policy are drafts for a lawyer to read before the repository goes public.
- 2026-10-11 (founder, the pay gate removed): the OpenShore Plus gate (2026-09-30) is deleted, not switched off: `payGate.ts`, `payOps.ts`, the Paywall, PlusNote, `lib/iap.ts` and the `oscode-iap` plugin, the `VITE_PAY_GATES` flag, the Apple roots release check (it guarded a build that could sell, and none can), the free sidebar layout, the Plus rows in Settings and the profile, and the paid egress entries. Each paid door that also held the free sign-in keeps it (`requireAccount`: making, editing or running a routine, making or editing a crew member), so a shipped build, which ran with the gates off, behaves as it did. The device keys the plan wrote (the cached entitlement, an unlinked Apple receipt) are deleted once at launch. Kept: a commercial org's seat billing (v4, door shut; `lib/entitlement.ts`, `refreshEntitlement` now reads only the org), the server's Stripe and Apple functions and the entitlement tables (production history is never edited; whether to undeploy is a founder step in PROGRESS), and the server's `appleNote` on account deletion, which still tells anyone the server knows bought through Apple to cancel. The engine's `osc license` client (`src/license/`, the `license` config section) goes too: a key that unlocked "the curated feed and updates" does not fit open source; an old config's `license` section is stripped on load.
- 2026-10-11 (founder, the Local Library unlocked): "bring back the marketplace section so I can get help there too." The Local Library moves from tier 3 to a plain v1 room (no `FEATURE_TIER` entry, no `SHIPS_MARKETPLACE`), loaded lazily in every build; tier 3 is reserved. Community reviews stay off (`REVIEWS_OPEN = false`): production's 0027 revoked review writes, so posting would fail with a raw database error and review text without a working Report breaks App Store 1.2; reopening them needs a migration above production's newest, a reviews egress entry and a moderation surface outside Admin. First-run Harbor setup still downloads in place and never detours into the room. The room's Stack Health usage sort reads only when Stack Health ships, so a v1 room depends on no later tier. Its UI guard exemptions are kept and relabeled as known polish debt open for contributors (the founder snaps UI). It stays behind the free sign-in like the other rooms. A model kept in iCloud from it is on the egress list.
- 2026-10-11 (founder, contributors): contributors are asked for working features only; formatting, design and copy are snapped to the brand by the maintainer, so CONTRIBUTING.md lists the house-style test files a contributor may leave red. The two rules that are not style and still block a merge: every new network call on the egress list, and project config only ever stricter until the folder is trusted.
- 2026-10-11 (going public): a full-history scan found no real secret; the company's internal documents moved to openshore-hq (`openshore-code/internal-docs/`), and the publishing procedure there strips them and the founder's personal email from every commit with git filter-repo before the repository goes public. The security reviews that list open items stay private until those are fixed; two (repo hooks seeing the engine's keys, case-insensitive deny rules) were fixed the same day.
- 2026-10-11 (founder, the CLI back): "bring back the terminal CLI ... Keep the CLI version called OS Code to keep everything in tact that has already been built." `osc` (parked 2026-08-18) is supported again under its name, OS Code, with every command as built; nothing in the engine forks for it. It ships to npm as `os-code` (the name was free on 2026-10-11): `package.json` lists `files` (dist, the bundled catalog the market reads, the example config, NOTICE), `.github/workflows/cli-publish.yml` publishes on a `cli-v*` tag once `NPM_TOKEN` is set (its own version line, apart from the apps' `v*`; provenance once the repository is public, since npm refuses it for a private one), and CI installs the packed tarball into an empty prefix and runs it. A clean install found one bug, fixed: piping osc into `head` crashed on EPIPE; it now exits quietly like any Unix tool.
- 2026-10-11 (the case-insensitive deny-rule fix, reverted): resolving the jail's paths with `realpathSync.native` broke the Windows CI job: the native call expands a short temp path (`RUNNER~1`) while the vault's root is resolved the JS way elsewhere, so the two stopped matching and the guard that keeps a model from writing under `.oscode/` did not apply. The jail is back on `realpathSync`; the case-insensitive item stays open (hq, `security-open-items.md`) until every root and target in the engine resolves through one helper.
- 2026-10-11 (published as a fresh repository): the code goes public in a new repository named `openshore.code.ai`, with only `main`, the tags and the CLA branch; the old repository is renamed `openshore.code.ai-old` and stays private. Reason: a mistaken push during the cleanup left another private project's code in the old repository's hidden pull-request refs, which cannot be deleted by the owner and would be fetchable once public; a new repository carries no old pull-request refs and no stray objects. The cleaned history was rebuilt with the verified strip list and mailmap (`openshore-hq`, `openshore-code/PUBLISHING.md`) and checked after the push: no internal path in any commit, no trace of the founder's personal email, no secrets, and `main`'s files identical to the verified tree. Every other branch stays private in the old repository.
- 2026-10-11 (founder, the npm name): the first publish of the CLI was refused, since npm judged `os-code` too close to the existing `ts-node`. The founder kept the name OS Code, so the package publishes scoped as `@openshore/os-code` (needs the `openshore` organization on npm, free for public packages): `cli-publish.yml` stamps the name next to the version, and the workspace name stays `os-code` so every `--filter os-code` and the app's imports are untouched. The command stays `osc`. Install: `npm install -g @openshore/os-code`.
- 2026-10-09 (bring your own keys, whole-feature review): the keys sheet and `osc key --help` now say Crew routines and the free chat run only on a local model and do not run while a cloud model is the server's model (one claim, no "stay on a local model"); the server's no-model line names the app's door (Cloud Connections, Your server, Model on your server) before the SSH way; Settings, Privacy no longer says nothing sits in between (OpenRouter and Hugging Face pass a turn on, as What leaves this device says) and lists a provider key you turn on for a server. The OpenAI-compatible provider keeps a DeepSeek-style `reasoning_content` with a tool round and sends it back inside the same user turn only (`ChatMessage.reasoningContent`, event `reasoning-content`), and reads Mistral's chunked `content` as text and thinking. Disconnecting a provider opens by reading every docked server, deletes a key only on the servers its question named (`disconnectProvider(id, onlyServers)`), and gives one not read yet the note that its key may still be there.
- 2026-10-12 (chat versus project chat, founder): a plain chat works like claude.ai, with no repository picker and no repositories; a project chat (started from a project, or a coding session on a computer) works like Claude Code and keeps the picker. The line is `Conversation.projectChat`, set by `newConversation`; a chat that predates it keeps its picker only if it already has repositories. A plain chat still files under the active project for Recents; whether it should stand outside every project is left to the founder (new-chat proposal, docs/design/new-chat-buttons-proposal.md).
- 2026-10-12 (staying open, founder): neither iOS nor the desktop window can promise "never restarts", so the app does three honest things: iOS asks for the short extra time a task in flight gets when the app is left, the desktop window is not throttled while hidden, and a cold start within 12 hours returns to the chat that was open with a quick splash (`lib/resumePoint.ts`). Copy claims none of it as "always on".
- 2026-10-12 (new chat doors, founder took the Creative Studio's proposal): New chat is an action, never a nav row. The drawer's floating button and the tray and Dock items always open a plain chat (they are global); the shortcut opens a project chat only from inside a project's room. The shortcut is Cmd+N in the desktop app and Cmd+Shift+O on the web, where the browser keeps Cmd+N. `/new` joins the engine's reserved names, so a command file named new loses. The Projects row swipe and the iOS quick action are held: the row's open is a shared-element move a swipe would have to keep, and the quick action needs a native plugin and a device run.
- 2026-10-12 (resume, founder "Do 1, 2, and 3"; supersedes the 12-hour part of today's staying-open line): a deliberate Quit on the desktop opens fresh (the main process leaves a `quit-clean` marker in userData, the next launch takes it and hands the page `afterQuit`, which clears the point); the resume clock is stamped every time the app goes to the background, so it counts from when the person left; and the iPhone's window is 30 minutes, since it cannot tell a swipe away from the system reclaiming it. The desktop and the web keep 12 hours, because their only unasked cold starts are a crash or a reboot.
- 2026-10-12 (open-source tidy, founder, option A): the maintainer runbooks (TestFlight, push setup, release signing, the Mac desktop build, the gate 1 runbook, the vault device checklist, the App Store screenshots) move to the private hq repository at the same path, so the public tree keeps contributor-facing docs only. Feature reviews, plans, proposals and redesigns move to `docs/design/`, indexed by `docs/README.md`. The three tests that read the gate 1 runbook now read the files that stay public: the `--skip-vault` and stale-name checks cover `supabase/`, the local-vault check covers the README and CI, and the free-space month is read from migration 0023 itself, which says the same words.
- 2026-10-12 (many machines and Runs on, founder: "a great scalable way to allow use of remote servers like from Hetzner: VPS and shared vCPU servers... in your projects, you can choose the Hub to run your project from, either your home computer, home server, or remote server"): built on connect anywhere (2026-10-07) and keys on your server (2026-10-09), not beside them. A device docks to as many machines as the person likes; a project names one (`Project.runsOn`: a docked machine's address, or `THIS_COMPUTER` on a desktop; unset follows the device); each coding chat records the machine its session opened on (`source.hub`) and always goes back to it, never to another machine. The device's active machine (`settings.daemon`) keeps what is the device's own (the Stack room, the Vault on it, Crew, push, the keys sheet), so choosing a project's machine never moves the Vault. One pure rule, `app/src/lib/runsOn.ts`; the store reads it through `conversationWhere` and `newChatWhere`.
- 2026-10-12 (Runs on, copy): the founder said "Hub"; copy says Runs on and machine, since "hub" stays out of copy (CX, 2026-10-01, the glossary guard). The three kinds read Computer (never "at home": a docked desktop may sit anywhere), Server at home, and Rented server; a server docked before the question is just Server. Where a server lives is the person's answer, kept on this device (`DaemonTarget.place`), since a server cannot tell; the renting line shows only for a rented server or one whose place is unknown (the Vault's storage line included).
- 2026-10-12 (Runs on, what follows the chat): the chat's session, its free chat with the machine's model, its shell approvals (Terminal Control is per machine), its foreground beat and push, its model menu, a plan's engine steps, and its repository picker and clones all go to the chat's machine. A chat that recorded none (from before) follows the device's default, as it always did. A session listed from a machine (the Chats list, a routine run, a Repositories folder) records that machine when it opens. Forgetting a machine clears it from every project and leaves its chats saying where they ran; they never fall through to another machine.
- 2026-10-12 (Runs on, the desktop): docking a server from the desktop no longer turns on "Run on another computer" for every session; the project chooses it under Runs on, and the switch under More options still sends everything there. A desktop whose new chats run on a docked machine shows no First Seat and holds no send for want of a local model (`runsElsewhere`). The model menu lists the chat's own machine, the docked rows when that is a server, which also ends the desktop's old mismatch of showing this computer's engine while "Run on another computer" was on.
- 2026-10-12 (servers, scale): `/health` carries the machine's size (`machine`: memory in GB, cores, processor family; `os-code/src/daemon/machineFacts.ts`), read from the process with no probe, and nothing about a graphics card, which a server's sandboxed engine cannot see; rows say "Rented server, 4 GB memory, 2 cores, Arm". The rented path says what each size can do by the same fit rule the First Seat uses (2 to 4 GB: OpenShore and a cloud model on your key; 8 GB or more: a 3B or 4B of its own; a GPU server: big models, billed by the hour), names no provider and promises no speed (tenet 2). Several servers are set up the same way with a cloud-init the person pastes at creation (Tailscale's install line, `tailscale up` with a one-off auth key in place of the capitals, then the same signed installer); with no terminal the installer prints the pairing command instead of a code, so the yes is still typed on the server by a person.
- 2026-10-12 (servers, arm64): the installer and `pack-server.sh` take arm64 (the cheapest shared-vCPU plans at several providers are Arm), and `release.yml` packs it on GitHub's `ubuntu-24.04-arm` runner in its own job, which may fail without holding a release; publish now names the desktop jobs' success itself. No copy promises Arm until a release carries the arm64 asset; a docked machine's own "Arm" is a fact it reports.
- 2026-10-12 (Runs on, the door): the Runs on sheet's link to Computer reads "Dock another machine", not "Connect your computer": the pill shows only once a machine is docked, so it is a docked device's way to add one more, like the Manage row the 2026-10-07 rule exempts.
- 2026-10-12 (the model library, founder): "It needs to feel like the Apple AppStore with different categories that match the required categories for the stack... limit the number of models per category... expand outside of just hugging face... a true library of recommended models", with a "don't see your preferred model?" door. Asked, the founder ruled the cap as one pick per device size (phone, laptop at 16 GB, workstation at 48 GB, server), asked for every kind of work ("photo editing now along with... video, voice, audio, music... legal, music, math, science, health... Don't overwhelm the marketplace but make it feel complete"), and opened the sources ("I don't want it limited. The catch is it must have a license that allows for commercialization"). Plan: `docs/design/model-library-plan.md`.
- 2026-10-12 (the library, shape): sections, categories, shelves and Made for collections are code (`os-code/src/market/library.ts`, through `os-code/protocol`); only the picks ride the catalog (`library.picks`, keyed by shelf and size class), so the one-per-size cap is the data shape and a catalog cannot invent a shelf. A collection only points at shelves, never adds a model. Category names are the Stack's own (Overall, Reasoning, Coding, Image reading and so on), so a pick and the slot it fills say the same word.
- 2026-10-12 (the library, size classes): each class has a largest download the builder enforces (phone 3.5 GB, laptop 12, workstation 30, server none), so a laptop pick is never a 20 GB file. A shelf leaves a size empty rather than stretch a pick (video has no laptop pick). "Best for this computer" goes to the largest class that also passes the store's own fit check (`fitsHere`), after `osc library` showed a laptop pick as best on a CPU-only 16 GB box whose fit pill said it needed more memory.
- 2026-10-12 (the library, what was cut): IOPaint is dropped (its repository was archived 2025-08-13), and LaMa runs in ComfyUI through `comfyui-inpaint-nodes`. The legal and data-analysis shelves are dropped: general models beat every legal specialist found (SaulLM is 2024, Lawma only classifies) and nothing showed evidence for spreadsheets, so lawyers get a Made for collection of general shelves. Art and photo pictures merge into one shelf, since the same models win both.
- 2026-10-12 (the library, licenses): every pick allows commercial use; a pick with conditions (MedGemma's HAI-DEF terms, the SAM License, Stability's Community License under $1M) says them on its page. LTX-2.5 (community license under $10M and a no-competing use policy), Qwen3.8-Flash-Next (Qwen Community License carve-out) and VibeVoice-ASR (research only) are held for the founder and counsel, not shipped. The founder's action list is in the plan.
- 2026-10-12 (the library, sources): `os-code/src/market/sources.ts` names every host a download may start at (Ollama, Hugging Face, GitHub, Civitai; a publisher's own site one named host at a time, never a wildcard), the builder refuses a file anywhere else, and the What leaves this device list reads the same table. Civitai is allowed but carries no pick: none checked passed the commercial bar (Juggernaut bars paid APIs; Illustrious and NoobAI are share-alike).
- 2026-10-12 (the library, discovery): live Hugging Face discovery writes `build/candidates.json` for the curators and no longer joins the published catalog, since a found model has no shelf and the library is curated picks only.
- 2026-10-12 (the library, older apps): the library publishes as `catalog.v2.json` and the default `catalog.url` moves there; `catalog.json` keeps serving released apps, narrowed by `scripts/build-catalog/v1.ts` to what they parse (models that run in Ollama, from Ollama or Hugging Face, in the first eight categories, with no library block), since one unknown enum value made them reject the whole catalog. An app or engine reading a catalog without picks borrows the bundled library (`withLibrary`).
- 2026-10-12 (the library, media runtimes): photo editing, video, transcription, voices, music and sound are Stack media slots, one model per job, run by programs on the person's computer: ComfyUI, a speech server in the OpenAI format (LocalAI recommended, its gallery fetches the model), audio-separator, and DeepFilterNet's deepFilter. OpenShore never installs a program; Get says the exact install line when one is missing. Where the servers are and ComfyUI's models folder are machine config (`media` is `machine` in `projectPolicy.ts`), set in Stack, Media servers.
- 2026-10-12 (the library, media ethics): every media prompt is screened by `MediaGuard` (handed out by the provider registry); every picture is labeled AI-made; a video or sound of an authorized likeness is refused because its format cannot carry the label here; cloning a voice runs only on a placement marked watermarked, so "Your own voice" holds Chatterbox (PerTh watermark) and VoxCPM2, which clones without one, sits on "Many languages" only.
- 2026-10-12 (the library, reach): the media tools ride with the other model handoffs, so an egress lockdown and an offline run (a Crew routine included) leave them out, and a media server off this network makes its tool a network-risk call that asks first.
- 2026-10-12 (the library, the store): the family rail and Compare are removed (`modelFamilies.ts`, `CompareSheet.tsx`), since the library answers which size to take. The room's title, lead and search show only on the front and in search; a category page leads with its own name. A phone pick's Get on a computer installs to the computer, never the iPhone runtime (`toDevice`).
- 2026-10-12 (the library, the request door): "Don't see your preferred model?" offers Install by name on the desktop and Connect a model in the Stack elsewhere, then a mailto to `SUPPORT_EMAIL` with the model's name and link to fill in; the person's mail app opens and nothing is sent until they send it.
- 2026-10-12 (the library, security and privacy review): the CTO's checklist (`.claude/skills/security-privacy-review/SKILL.md`) run on the library diff by an independent reviewer: "ship with these must-fixes" (H1, H2, M1, and the egress list's "asks first" line), all fixed in the same branch; the record is in openshore-hq at `docs/security-privacy-review-2026-10-12-model-library.md`. No Supabase change and no new table.
- 2026-10-12 (the library, review H1, pins): nothing a media model downloads was checked, since the catalog carried no SHA-256 and Hugging Face sends X-Linked-Etag on its redirect, not the file. Now the builder pins every file before publishing (`scripts/build-catalog/pinFiles.ts`: a Hugging Face file to its repo's commit and its LFS SHA-256, a GitHub release asset to GitHub's published digest; metadata only, no weights read), drops a model with any file left unpinned (its picks with it), and the gate refuses an unpinned file (`filePinned` in `src/market/sources.ts`). The downloader refuses a file with no SHA-256, follows only https addresses off this network on every hop (`model-pull` in `EgressPolicy.fetch`), and stops a file past its stated size. The etag fallback is gone. An offline build publishes no media model, by design.
- 2026-10-12 (the library, review H2, reach; supersedes the reach line above): a media tool's risk was network when its server left, but network steps approve themselves at the desk, so nothing asked. Now the loop judges each media call by the server its job is placed on (`MediaHost.target`, `callJob` and `callFiles` in `src/media/jobs.ts`): off this network it asks on the amber card once per task per model (generateImage too, when a library picture model is placed); it is refused before anything asks when the seat that wrote it stays and the chat holds a local-only note; a vault file kept on this computer is never sent to it (`MEDIA_LOCAL_ONLY_DENIED`); and a result read from such a file on this computer is marked local-only. The card names the model and says the file and the step go to the server's host.
- 2026-10-12 (the library, review M1, voice; supersedes the media ethics line's watermark rule): the watermark flag rode the placement, so a deep-merged save, a Get from the wrong shelf, or a trusted project could set it. Now copying a voice is a rule in code (`WATERMARKED_VOICES`, `cloneAllowed`: Chatterbox, placed as itself), the placement has no watermark field, Get replaces a job's placement whole (`saveMediaPlacement` in `src/config/load.ts`, also the desktop's Remove), and Get fills a job only from a shelf the model is a pick on. "Your own voice" no longer says "Only your voice, with your yes", since no consent or sample flow exists: it says the sample lives on the speech server, that everything is watermarked, and to copy only your own voice or one you have permission to use.
- 2026-10-12 (the library, review M2, M3 and the low findings): a media server off this network takes https only (the desktop setter and the engine's media host both refuse plain http there; the tailnet counts as this network); the egress list now says ComfyUI keeps each picture it is sent and makes, names Civitai and the source's own file storage, says audio-separator and DeepFilterNet fetch their model files from their publishers on first run, and its "asks first" is true; the media clients follow no redirect; a runtime name refuses `..` and a drive letter; the install line for a program is fixed in code, never the catalog's; `destPath` takes a models folder with a trailing slash; the Stack's Media intro no longer says "on this computer"; and the app clears the catalog cache key from before the library. Held as follow-ups: a signed catalog, AI labels on video and audio, screening an edit's input picture, an edit's mask path in permission rules, marking a file made from a private one, clearing media outputs with the chats, deleting a removed model's files, and a per-file license check for files a pick pulls from another repository.
- 2026-10-13 (the library, the review's follow-ups, founder "Do the follow-ups"): all seven held items from the 2026-10-12 security and privacy review are built on `claude/Local Library-library`, one line each below.
- 2026-10-13 (the library, a signed catalog, L7): `catalog.v2.json` is signed in CI with an Ed25519 key whose public half is pinned in `src/market/catalogSignature.ts` (`CATALOG_PUBLIC_KEY`, through `os-code/protocol`), over `openshore-catalog-v1\n<file>\n<sha256>`, the release signature's shape. The engine and the app's standalone loader take the published catalog only when its `.sig` checks and its `updated` is not older than the copy already trusted; otherwise the last verified copy stays, with a note saying so. A catalog at an address the person set (machine config) is theirs to trust and is not checked. Verification is WebCrypto, so the iPhone checks as the engine does; a device that cannot check Ed25519 is refused (fail closed). The key is empty until the founder runs `node app/scripts/release-keygen.mjs catalog`, saves the private half as the `CATALOG_SIGNING_KEY` repository secret, and pins the public half: until then catalogs are taken unsigned, as before. `pnpm --filter os-code sign:catalog` fails the job when a key is pinned and the secret is missing or does not match it, so nothing every app would refuse is published.
- 2026-10-13 (the library, sound and video provenance, L8): every clip and sound a media job makes carries the picture's self-attested record (`src/core/ethics/mediaProvenance.ts`: a WAV INFO comment, a FLAC Vorbis comment, an MP3 ID3 TXXX frame, an MP4 top-level `uuid` box appended so no offset moves), through `MediaGuard.labelMedia`, which replaces `checkUnlabeled`: an authorized likeness is now made and labeled where the format allows, and refused only where it does not. An edit or an animation of a person's own picture is recorded as `c2pa.edited` (IPTC composite). Stems and a cleaned recording are the person's own audio and are not labeled. The ethics layer reads text, so an edit's screen reads the words and the input picture's file name; no classifier looks at the picture itself, and the docs say so rather than claim it.
- 2026-10-13 (the library, every path an edit reads, L4): a tool can report further paths (`morePathsOf`, an edit's mask); the loop jails each and judges it by permission rules as it does the primary path, and the strictest decision stands, so a deny rule on a mask's folder denies the edit.
- 2026-10-13 (the library, files made from a private one): the media host logs every file it writes (`savedCount`, `savedAfter`); the loop records the outputs of a call whose input was a local-only vault file and treats them as local-only for the rest of the session (never sent to a server off this network, marked when read on this computer), so the stems of a private recording stay private. The record is the session's, not kept on disk.
- 2026-10-13 (the library, clearing what the media jobs made): the desktop Stack's Media group shows "Made here" (count and size of `media/` and `images/` under the engine's home) with Clear behind a confirm. Clearing chats on a phone does not reach them, as it does not reach the session journals ("Session journals on your computer stay there"), so they are cleared where they live rather than tied to the phone's Clear chats.
- 2026-10-13 (the library, a removed model's files): Get records each file it downloads into ComfyUI's models folder in `media-downloads.json` beside the config (machine-only, never a project file). Remove asks first and can delete the files Get wrote for that model, and only those: never a file the person already had, and never one another placed model uses (a shared text encoder). A speech model stays on the speech server.
- 2026-10-13 (the library, each file's license, L9): a file a pick pulls from another repository must name its own license (`files[].license`) from the fail-closed allow-list with a commercial posture, or the builder drops its model and the gate refuses it (`scripts/build-catalog/fileLicenses.ts`). Named: the Qwen3-4B and Qwen2.5-VL encoders, the Qwen-Image VAE, UMT5 and LaMa's weights (Apache 2.0), the FLUX.2 VAE (Apache 2.0, as BFL released it, on the founder's click-through list), and T5Gemma (Gemma terms). The lightx2v Lightning LoRA named none until the founder read its card (apache-2.0, 2026-10-13), then it was named too, and Qwen-Image-Edit 2511 publishes.
- 2026-10-12 (open-source polish, founder: "Do the fixes, the nice to haves, the founder and CTO language and all the smaller items"): the individual paid rails are removed, since OpenShore is free for a person and had no paying individual (`link-apple-purchase`, `apple-notifications`, `_shared/apple.ts`, the Apple helpers and the cross-rail guard in `_shared/entitlement.ts`, and the Personal price path in `stripe-webhook`); the tables and applied migrations stay, and `delete-account` still reads any leftover Personal or Apple row. The deployed copies of the two Apple functions stay on the hosted project until a maintainer deletes them. On a pull request the house-style checks (format, lint, the style tests) run in their own `house-style` job, and the required `check` runs the behavior tests (`OSC_TEST_SET` in both vitest configs); a push to main still runs everything. Source comments and test titles name reviews, not roles ("tech review", "UX review", "copy review", "design review", "a maintainer"); strings, DECISIONS, PROGRESS, CLAUDE.md, design history and applied migrations keep their words. The public `supabase/README.md` is a contributor guide; the operations record moved to hq (`openshore-code/internal-docs/supabase/OPERATIONS.md`).
- 2026-10-12 (founder, sign-in without passwords): passwords are removed everywhere. One email carries a 6-digit code and a sign-in link; passkeys come next as the faster way in, with email as recovery; App Lock is an optional device lock. The founder took all four recommendations after asking what the security experts say (a magic link alone is single-factor on the inbox; passkeys are the phishing-resistant standard). Runbook `docs/passwordless-runbook.md`, review `docs/security-privacy-review-2026-10-12-passwordless.md`.
- 2026-10-12 (CTO, passwords on the server): migration 0028 empties every `auth.users.encrypted_password` and a trigger keeps it empty on every write, since hosted Supabase cannot turn off the password grant alone (it goes only with the whole email provider) and GoTrue refuses the grant when the column is empty. The trigger never raises, so no GoTrue flow becomes a 500. Existing sessions stay. Confirmations stay on (P0-4).
- 2026-10-12 (CTO, the code and the link): codes are 6 digits, live 10 minutes, one email a minute; the code is the main path and the link a shortcut. The link is PKCE (verifier in the platform secret store for the same 10 minutes, one at a time), so it signs in only on the device that asked; a link carrying tokens in its address (the old implicit flow) is never accepted, which also retires the confirm sheet for unasked links (APP-6 now rests on PKCE). The return address rides `?redirect_to=` (GoTrue never read the old body field, so links had fallen back to `site_url`). The link goes through `openshore.ai/sign-in/continue/`, which moves on only on a tap and only to this project's own `/auth/v1/verify` returning to the app, so a mail scanner cannot use up the token the code shares.
- 2026-10-12 (CX, the sign-in sheet): one email field and one button, "Email me a code"; no Sign in / Create account toggle and no copy that says whether an address has an account; a Terms line under the button, since the first email now makes the account; the check step names the address and both ways in, signs in on the sixth digit, waits out the resend limit, and goes back with "Use a different email". Someone who signed in on a device before passwords went sees "Passwords are gone." once there.
- 2026-10-12 (CTO, passkeys): GoTrue's own passkeys (`/auth/v1/passkeys`, not our own function: ours would need a service-role session-minting path the CTO will not hold), relying party `openshore.ai`. Only a native ceremony can speak for that origin from inside the app, so iOS uses a new plugin (`oscode-passkey`, ASAuthorization, user verification required); the desktop waits for a browser handoff design. Adding a passkey needs an email sign-in on a live session in the last 10 minutes, held by 0028's trigger on `auth.webauthn_credentials` and checked first in the app. Off until the founder's gate: `[auth.passkey] enabled = false` and `VITE_PASSKEYS` unset; the associated domain and the Apple association file wait for the Team ID.
- 2026-10-12 (CX, passkeys in the UI): never a prompt after an email sign-in; one offer card in Your account, whose Not now is final on the device; a Passkeys list with each one's name, added and last used dates, and Remove (the confirm says the password manager keeps its copy); the sign-in sheet leads with a passkey only on a device that has used one.
- 2026-10-12 (CX, App Lock): off by default, no account needed, first row in Settings, Privacy. The device's own unlock only (biometrics with the device passcode as fallback), never an OpenShore passcode, so there is no forgot-passcode path. Locks at launch and after Immediately, 1 minute (default) or 15 minutes away; turning it on, off or changing the time takes one unlock. While locked only the lock screen renders, the app switcher shows a plain cover, and a notice says only "A reply is ready." Work keeps running; approvals wait for the unlock. iPhone and iPad only: Electron's Touch ID prompt has no passcode fallback.
- 2026-10-12 (CTO and CX, App Review sign-in): Apple's reviewer signs in through a dedicated review mailbox (its own Proton account on our domain, plus-addressing, our auth sender's mail only, kept 7 days, rotated after every review), reading the 6-digit code there. Auth has no exception: no reviewer password, no fixed code, no server path that mints a session (`app/test/passwordless.test.ts` holds both). The notes text is in openshore-hq.
- 2026-10-12 (CTO review of the build, before main): two must-fixes, fixed. App Lock decides a return natively (`oscode-applock`): time away on the system uptime clock, so setting the date back cannot skip the lock; only a real trip to the background counts, never our own Face ID or passkey sheet; and the cover over the app stays up until the lock screen is drawn, so the last screen never shows for a frame. Also fixed: a session the server made that the app then refused is ended there, the account switch guard compares account ids, a renewal by code ends the session it renews, the reset-password email says there are no passwords and carries no link or code, the continue page takes only a PKCE link back to the iPhone or desktop app, and the Swift passkey state stays on the main queue. The auth settings go in by the dashboard, not `config push` (config.toml's `site_url` is local).
- 2026-10-12 (CTO, accepted residual risks): (1) the passkey step-up cannot tell which session registers, so a stolen live session could add a passkey in the 10 minutes after the owner's own next email sign-in; GoTrue sends no "passkey added" email, so the follow-up is that notice (an auth hook or our own mail) and showing passkeys in Your account is the check meanwhile; when the trigger refuses, GoTrue answers a generic 500 and the keychain may keep an orphan passkey, which the app's message covers. (2) GoTrue limits code checks per IP only, so a guesser spread over many addresses is not capped per account; 6 digits stay for now, with 8 the move if sign-in abuse shows. (3) A brand-new account's link expires after 5 minutes (GoTrue's sign-up flow state) while its code lives 10, so the copy promises 10 minutes for the code only.
- 2026-10-13 (Runs on made simple, founder "Build it all" on a CX-lens read): one idea, the default machine, replaces two. On a phone Active reads Default, and a tap on another machine makes it the default; on a desktop the "Run on another computer" switch is retired and This computer is a row in Your machines beside every docked machine, the default chosen there (`setDefaultMachine`: This computer turns `preferRemoteHub` off; a docked machine selects it and turns it on, so the stored state is unchanged). The address-and-key form stays under More options as Dock by address and key and no longer moves sessions. Runs on's first choice reads Automatic ("Follows this device's default").
- 2026-10-13 (Runs on made simple, Computer): once a phone is docked, the ways in fold behind one "Dock another machine" button, the way the desktop folds its QR after a phone docks (CX 2026-10-01); a docking link opened from outside unfolds them, since its confirm lives in the dock form, and a first dock keeps the form open through its check. The size guide folds behind "Which size do I need?". The three-way choice reads Computer, Home server, Rented server, sharing the width and wrapping on a 320px phone.
- 2026-10-13 (Runs on made simple, the chat): a coding chat on a docked machine says "on {machine}" in its bar, a name and never a control; a chat whose machine was forgotten shows where it ran with Dock again (no dead end), its line ending before the door (`goneLine(key, name, false)`).
- 2026-10-13 (the library, licenses): OpenShore never mirrors, caches, modifies or bundles model weights; they go from the publisher's host to the person's machine. Get for a pick whose license sets conditions or is gated (HAI-DEF, SAM, Stability Community, Gemma, Llama) asks the person to accept the license first, in the app (a confirm sheet, Accept and get) and in the CLI (typed, default no), from one pure helper (`market/terms.ts`); nothing about the tap is stored or sent. VibeVoice-ASR moves to excluded (research and development only). LTX-2.5 waits on a written OK from Lightricks; Qwen3.8-Flash-Next on reading its license.
- 2026-10-13 (founder, the Local Library): the Marketplace is renamed the Local Library everywhere, to say it is free and communal, not a store. The room id is `library` (a saved sidebar order's `marketplace` maps to it), the screen `LocalLibraryScreen`, the docs `os-code/docs/LOCAL-LIBRARY.md`, and the CLI `osc library` with `osc market` kept as an alias so scripts keep working. `Marketplace` joins the retired copy words; lowercase `marketplace` stays a guide match keyword. Founder quotes, applied migrations (0011, 0027) and the internal `market/` module path keep their names. The room still lists hosted cloud models on its frontier shelf, labeled cloud (amber) as before.
