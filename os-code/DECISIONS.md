# Decisions

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
- **Em dash policy is TOTAL here** (comments included), stricter than the Uki
  repos: this codebase started under the rule, so nothing can drift from a
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
  models is free; the coding agent, Marketplace, and repo writes stay Personal
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
  beta with no paywall: coding agent and Marketplace free for everyone. One
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
  chats ("Walk me through it"); the Marketplace expresses it as bundles (one
  decision, total size shown) instead of fifteen model choices.
- **Guide steps are written, not generated (2026-09-02).** A guide chat opens
  with a seeded plan so it is correct even on Harbor Mini; the model's job is
  questions between steps, never inventing the procedure.

- **The advisor org is a Crew preset (2026-09-02, founder).** The founder's
  advisory team (canonical in uki-audio/.claude/agents) ships inside OpenShore
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
- **Motion standard ported from Uki, with adoption enforced.** The tokens
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
  one list feeds Cloud Connections, the Stack bench, and the Marketplace, no
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
- 2026-09-03: Marketplace coverage broadened but the TRUSTED_PUBLISHERS
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
  only primary button), demoting Harbor/cloud/Marketplace to a "go further"
  tier. Creative Studio direction "The Standing Light." Mini is instant now, so
  making it the front door is honest, not hype.
- 2026-09-04: Renamed the guide to "Harbor Light" (display only). Kept the code
  identifiers HARBOR_MINI_* and the model id "harbor-mini" as the stable slot:
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
- 2026-09-04: Marketplace "Runs lean" (greenest) axis estimates energy per token
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
