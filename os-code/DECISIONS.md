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
  with zero setup and is the default offered.
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
