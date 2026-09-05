# PROGRESS

The recent-state source of truth for OS Code, kept in the same spirit as the
Uki app repo: current state first, then what remains, then the log.

## Current state (2026-09-05, always-on ethical guardrail layer)

Founder brief: a safety-critical filter layer that wraps every model
interaction, always on, not disableable in the app, blocking a narrow set of
serious harms while staying out of the way of legitimate edgy work. Branch
`claude/openshore-guardrail-layer-kl4bvr`.

- **One chokepoint, two install points.** `os-code/src/core/ethics/` holds the
  whole layer (read `index.ts` first, it names the reading order). It is
  installed by construction, not by remembered call sites: `ProviderRegistry`
  wraps every provider in `GuardedProvider` before anything can hold one, so the
  agent loop, `Router.delegate`, `summarize`, the daemon's free `/chat`, and the
  eval harness are all covered; in the app, `buildDriver` wraps every
  `ChatDriver` in `guardDriver`, covering cloud Claude, every OpenAI-compatible
  provider, BYOM, the on-device models, the paired desktop, and the demo driver.
  `register()` wraps too, so a test double is screened like a real endpoint.
- **Both sides, and streaming is not an excuse.** Input is screened before a
  model sees it; output before a person does. `StreamScreener` releases text only
  after a screen that covered it came back clean, so a blocked answer is never
  partially shown and streaming survives.
- **Fail closed.** Any throw or timeout is a block. A check failure is recorded
  as `check-failed` and never counts toward enforcement: that is the layer
  failing safe, not the person misbehaving.
- **The tiers.** Tier 1 (CSAM, non-consensual intimate imagery of a real person,
  concrete CBRN and high-yield explosive uplift) is a hard block with no consent
  override. Tier 2 (synthesizing a real person's face or voice) is gated behind
  an authorization assertion the person can make in one sentence, recorded, with
  provenance on the output. Tier 3 is protected: legal adult content, dark
  fiction, horror, satire and parody, security research, dissenting opinion. No
  block rests on a single keyword; every one needs a co-occurrence in a proximity
  window, and suppressors (stated adult age, fiction marker, defensive framing)
  are first-class evidence.
- **No toggle exists.** No config key, no env var, no setting. The layer reads
  no configuration at all, and `test/ethicsNoBypass.test.ts` greps the tracked
  source to keep it that way.
- **Provenance.** Generated images carry a C2PA-vocabulary record (`c2pa.actions`
  with `trainedAlgorithmicMedia`) as a PNG `iTXt` chunk, leaving every other
  chunk byte-identical. It is unsigned and says so in its own text: there is no
  signing certificate, and claiming a signed manifest would be the overclaim this
  work refuses. Provenance on an input is never stripped or overwritten.
- **Enforcement, and the part that is deliberately not automatic.** Migration
  `0015_guardrail_enforcement.sql` adds `guardrail_events`, `likeness_consents`,
  `enforcement_actions`, `ip_ban_proposals`, `abuse_reports`, and a separate
  `abuse_reviewers` allowlist. Any Tier 1 attempt is termination plus a prepared
  report. An IP ban is only ever a PENDING proposal a human decides with an
  expiry: there is no apply function in the module or the migration, and a test
  fails the build if one appears. The report hook prepares and stores; it never
  claims a submission that did not happen.
- **Honesty fix owed regardless.** Settings said "OpenShore does not filter what
  a local model says," which is no longer true. Corrected, and the trust
  statement now ships in Settings from one source shared with the marketing site.
- Gates green: os-code typecheck + lint + 493 tests + build; app typecheck +
  lint + 613 tests + vite build; marketing site builds and passes its copy gate.

**What remains (this arc):** the C2PA signer seam is real but unwired (needs a
certificate). The report hook has no submission integration by design; an
operator wires a destination. Approved IP bans are applied at the edge by an
operator, not by this code.

## Current state (2026-09-04, Stack Health: daily cadence, admin-gated visibility, Run leaner)

Founder: update Stack Health on a daily basis (no on-demand refresh), and build
the two deferred items, with the CTO and CMO agreeing the design calls. Same
branch `claude/stack-health-sustainability-9wnf1y`.

- **Daily cadence, no manual refresh.** The pull-to-refresh gesture and its hook
  are gone. `app/src/lib/stackHealth.ts` now caches a per-range fold for 24h and
  only refolds on open past a day; the screen shows "Updated <when>. Refreshes
  once a day." Honest and quiet.
- **CTO + CMO agreed both deferred items** (run as advisor subagents; one
  synthesized direction, one disagree-and-commit noted). Details in DECISIONS.md.

- **Item A, enterprise admin-controlled visibility (server-enforced).** An admin
  sets whether everyone or only admins may see Stack Health on a shared hub. The
  setting lives in daemon config (`DaemonSchema.stackHealthVisibility`, default
  `admins`), enforced by a FRESH config read in `GET /stack-health` (no restart),
  with a distinct 403 `restricted` the phone renders as its own calm state.
  Admin-only `POST /stack-health/visibility` sets it; a member-readable `GET`
  backs the Settings control. No Supabase migration: the data is folded on the
  hub and enforced on the hub, so authority stays co-located. A Settings "Stack
  Health" group (shown when a hub is paired) lets an admin flip it.
- **Honesty fix the CTO surfaced (owed regardless).** `computeStackHealth` folds
  EVERY session on the machine, so on a shared hub a member sees a machine-wide
  aggregate. The payload now carries `scope: 'personal' | 'machine'` (stamped by
  the route from the auth source) and the screen states it: "Across every session
  on this hub. Never broken down by person." The false "user's OWN usage" comment
  is corrected. Default-closed means a shared hub does not leak until an admin
  opens it. Three daemon tests pin the gate, the scope stamp, and the no-restart
  toggle.
- **Item B, "Run leaner" (advisory, read-only).** A greener-stack recommender.
  `app/src/lib/stackOptimizer.ts` (pure, 7 tests) proposes at most one leaner
  local peer per role, behind a capability-parity gate: a candidate is surfaced
  only when it preserves the role's capability, clears a quality floor, AND is
  meaningfully leaner, so the size-proxy energy score can never quietly gut the
  stack. One basis (`modelEnergyPer1kTok`), estimates labelled, a cloud model is
  never called greener (the win is running a capable local peer). It renders on
  the Stack Health green card with the swap, the estimated saving, the model's
  OpenShore fit beside it, and a "Browse lean models" link. NO-GO (CTO) on the
  open "greener stack for a workload" framing; per-suggestion Apply on the Stack
  screen is the fast-follow.
- Gates green: os-code typecheck + lint + 420 tests + build; app typecheck +
  lint + 604 tests + vite build; motion/polish and total em-dash guards clean.

## Current state (2026-09-04, Stack Health sustainability: all the polish)

Founder: "Do all of the polish," on the sustainability + carry-through drop
below. Same branch `claude/stack-health-sustainability-9wnf1y`.

- **The green card arrives one piece at a time.** Each element (eyebrow, water
  hero, the three tiles, the read lines, the basis) steps in on the house
  `--stagger` via a shared `sh-green-in` entrance (`--i` inline index, backwards
  fill, arrive curve). The water count-up gained an optional lead-in delay so it
  starts as the hero slides into its slot rather than counting before the card
  has landed.
- **The shore edge fills like water.** The static teal box-shadow became an
  animated `::before` bar that scales up from the bottom once on first reveal
  (`sh-water-fill` over the door clock, arrive curve), reduced-motion safe.
- **Every green figure is marked an estimate.** A quiet "almost-equal" glyph
  (`.sh-approx`, muted, sub-scale) sits before the water hero and the energy and
  carbon tiles, so the card reads as "about this" at a glance, not a meter.
- **Pull-to-refresh, to the house gesture bar.** New `app/src/hooks/usePullToRefresh.ts`:
  engages ONLY at the top of the scroll on a real downward touch, tracks the
  finger 1:1 through asymptotic damping to a ceiling, arms past a distance
  threshold (a light haptic marks the arm), commits on release (a success
  haptic), and settles back on the arrive curve. Safety rails match the drawer:
  a lost pointer capture counts as a release, capture refusal stands down, and a
  move that is not a top-of-scroll pull is left entirely to the browser so
  normal scrolling is untouched. The loader is now one `load(quiet)` callback
  shared by the range effect and the refresh; a quiet refresh keeps the current
  numbers on screen (pinned under the finger) while it re-fetches. The indicator
  rides the gap the pull opens (a chevron that flips to point up when armed, a
  spinner while refreshing) and never clips.
- Gates green: app typecheck + lint + 565 tests + vite build; the motion-token,
  polish-standards, and total em-dash guards all pass over the new files.

## Current state (2026-09-04, Stack Health goes to the phone, gains a sustainability read, marketplace runs lean)

Founder ask, off the phone Stack Health screen (which said "lives on your
desktop"): you should be able to monitor stack health on mobile and have it
carry through to every device; there should be a sustainability bend showing the
electricity, power, and water saved by running local models instead of a
hyperscale data center, with a clear comparison to a cloud provider; and the
marketplace should let a team optimize a stack for sustainability. Branch
`claude/stack-health-sustainability-9wnf1y`.

- **Sustainability read, folded from the same tokens as the dollars figure.**
  `os-code/src/insights/sustainability.ts` (pure, no fs, no clock) reprices the
  local and cloud token totals into energy (kWh at the wall, PUE folded in),
  carbon (gCO2e), and water (liters): what your local work actually drew, what
  the SAME work would have drawn on the cloud reference model in a data center
  (the counterfactual), the difference kept off the grid (`avoided`), and the
  honest other half, the real footprint of the cloud turns you did send
  (`cloudActual`). Every number is an estimate, never a meter reading; the basis
  (`SUSTAINABILITY_BASIS`, cited to Epoch AI, IEA, Google/Meta PUE reports, and
  Li et al. "Making AI Less Thirsty") travels in the payload so the screen can
  show what it assumed, held conservative so "avoided" is a floor. Wired into
  `computeStackHealth`; `test/sustainability.test.ts` (7) plus a wiring assertion
  in `stackHealth.test.ts` pin the math and the floors.
- **The screen renders it in the teal/water family, never a new green** (keeps
  Stack Health's discipline: teal is local/private, amber is spend, and
  everything saved here is a consequence of staying local). A "The greener way to
  build" card: a count-up water hero (the founder singled out water), three tiles
  (energy avoided, CO2e avoided, percent lighter than the cloud), a plain-English
  comparison with relatable equivalents (phone charges, glasses of water, km not
  driven, each with a stated conversion), the cloud turns' real footprint, and a
  one-line honesty note that it is an estimate. New `.sh-green*` tokens in
  `theme.css`, all static (no motion-guard surface).
- **Stack Health now reaches the phone over the hub.** New member-auth
  `GET /stack-health?range=` on the daemon (`serve.ts`) folds it on the machine
  that runs the models and sends only the aggregate; `app/src/lib/stackHealth.ts`
  `loadAppStackHealth` tries the desktop bridge, then the paired hub, then a
  no-window state. The screen reads the active hub from settings; the old "lives
  on your desktop" card became "See it on every device you pair" plus an honest
  "your hub is not answering" state. This keeps the foundation intact: the phone
  is a window onto that machine, never a copy of the sessions.
- **Marketplace "Runs lean" axis.** A new `greenest` sort and a "Runs lean" shelf
  order models by `modelEnergyPer1kTok` (estimated from on-disk size, on-device
  build preferred), a relative browse guide so a team can optimize a stack for
  sustainability. Honest subhead names it an estimate. Tests extended.
- Gates green: os-code typecheck + lint + 409 tests + build; app typecheck +
  lint + 565 tests + vite build; the total em-dash guard passes over all new
  files.

**What remains (this arc):** two founder asks are captured for sign-off rather
than shipped half-built. (1) Enterprise admin-controlled visibility: on a shared
org, an admin sets whether everyone or only admins may see Stack Health,
server-enforced like `org_projects`/`org_vault` (needs a migration + RLS + RPC).
Today the hub endpoint is member-auth, matching `/stack`. (2) A deeper
stack-level sustainability optimizer in the marketplace (beyond the "Runs lean"
browse axis): recommend a greener stack for a given workload, model the
tradeoffs. Both are in `DECISIONS.md` and the marketplace/enterprise follow-up
lists.

## Current state (2026-09-04, App Launch: the model can drive Codemagic builds, default-off gate)

Founder ask: rename Launch to "App Launch with Codemagic" and give the model
full ability to drive Codemagic the way it drives the terminal, behind a
Settings toggle (default off), so it can trigger builds, read failures, fix, and
rebuild until green, then say where it landed (TestFlight, App Store, Google
Play). Founder chose BOTH surfaces (engine tool AND phone loop). Branch
`claude/launch-codemagic-rename-mckuh2`.

- **Rename.** Nav item, screen title, back bar, and `ROOM_NAMES.launch` all read
  "App Launch with Codemagic" (`Sidebar.tsx`, `LaunchScreen.tsx`, `BackBar.tsx`);
  `wayBack.test.ts` updated. The `view: 'launch'` id is unchanged.
- **The gate, modeled on Terminal Control.** `app/src/lib/codemagicControl.ts`
  is a pure module (default off, deny-reason) keyed on the single `codemagic`
  tool. Setting `codemagicAccess` is a single device-local boolean (NOT a
  per-target map like Terminal Control): the BYO token lives in this device's
  Keychain and only ever runs on this device. The store's approval handler asks
  the Codemagic gate first (`decideCodemagicApproval`), then falls through to
  Terminal Control. Settings shows an "App Launch" group with the Codemagic
  Access switch (admin-gated in an org). `test/codemagicControl.test.ts`.
- **Shared safety, one source.** The redact-then-extract build-log safety moved
  into `os-code/src/core/codemagic/safety.ts`, exported from `os-code/protocol`,
  so the app's Launch flow and the engine tool apply the identical guarantee.
  `app/src/lib/codemagic.ts` re-exports the pure surface for back-compat.
- **Engine surface (desktop, phone-paired-to-desktop).**
  `os-code/src/core/tools/codemagic.ts` is a `cloud-spend` tool (trigger,
  status, logs) that self-degrades without a token. The token and saved target
  ride into `ToolContext.codemagic` via a `codemagicToken` bootstrap option,
  delivered ONLY to the in-process local engine (createSession -> engineHost ->
  bootstrapSession), never to the remote daemon (same stance as project
  secrets). Registered only when a token was delivered, dropped under egress
  lockdown with the web tools. `test/codemagicTool.test.ts` (os-code).
- **Phone surface (StackDriver, client-brain).** A contained Codemagic tool-use
  loop engaged only when Access is on, so the existing single-turn/tool-less path
  is untouched otherwise. It covers EVERY network backend: the Anthropic path
  (native tool use) and the OpenAI-compatible path, which serves the built-in
  cloud providers AND a bring-your-own-model endpoint (function calling, native
  shim on device/desktop and true SSE on the web, streamed tool-call fragments
  joined by index). One `codemagic` tool, executed on-device via
  `app/src/lib/codemagicTool.ts` (mirrors the engine tool), bounded to 16 rounds.
  App Launch gains a "Have the model launch it" button backed by
  `launchWithModel`. `app/test/codemagicTool.test.ts` covers the handler, the
  OpenAI tool spec, arg parsing, and the streamed-tool-call accumulation.
- **Honest limits.** The phone can trigger, diagnose, retry, and report, but
  cannot edit the repo, so code fixes are described for the person or their
  paired desktop; the engine surface is what actually edits code and loops to
  green. On-device pocket models (the bundled 135M-class guides) stay guidance
  only: they are too small for reliable tool use, and driving Codemagic needs the
  network anyway, so the device-only case coincides with not reaching Codemagic
  at all. Suites green: app 595, os-code 410.

## Current state (2026-09-04, renamed to Harbor Light, all Creative Studio microcopy applied)

Founder call: the built-in guide is now named **Harbor Light** (was Harbor
Mini), and every Creative Studio proposal from the "Standing Light" pass is
applied. Branch `claude/harbor-settings-rows-bundle-tbu2ct`, then to `main`.

- **Rename.** Every user-facing "Harbor Mini" string reads "Harbor Light"
  (`HARBOR_MINI_MODEL_NAME` = "Harbor Light", greeting, cards, personas, docs,
  privacy copy). The code identifiers (`HARBOR_MINI_*`, `harborMini.ts`) and the
  model id `"harbor-mini"` are kept as the stable slot: the id rides persisted
  settings, stack refs, and the bundled `harbor-mini.gguf`, so it never moves on
  a rename (same pattern as `HARBOR_MODEL_NAME` "Harbor 1.0" over id "harbor").
  A test pins that no "Harbor Mini" survives in shipping copy.
- **All studio microcopy wired.** Byline is now the three-beat promise "Built
  in. Offline. Always on." A Harbor Light chat's composer rests on "Still here.
  Ask me anything about the app." (`HARBOR_MINI_EMPTY_HINT`). Starting a Harbor
  download toasts "Bringing it in. I'll be right here."
  (`HARBOR_MINI_HANDOFF_LINE`). Greeting, First Moves, hero card, "go further"
  tier, graceful-limit tone, and motion (stagger, press-fb, no first-run
  spinner) were already in from the prior pass. `test/harborGuides.test.ts`
  covers the rename and the new microcopy.

## Current state (2026-09-04, Harbor Mini optimized for guiding, delightful first-run by the Creative Studio)

Founder ask: with Mini now SmolLM2-135M, optimize it purely for guiding around
the app. Its only reasoning is navigating the app, knowing where it is not
capable, and routing the person to get Harbor / connect a cloud provider / open
the Marketplace, then walking each activation step by step. And bring in the
Creative Studio to shape a delightful first experience even though the model is
limited. Branch `claude/harbor-settings-rows-bundle-tbu2ct`.

- **Mini scoped to a guide, not a builder (app).** `harborMini.ts` persona
  rewritten: it navigates and explains, notices its edge, and hands off warmly
  (never grovels). It recites three activation walkthroughs verbatim rather than
  reasoning them out, spliced from a single source: `setupGuides.ts`
  `guideStepsCompact(id)` for `get-harbor` (new guide), `connect-cloud-key`, and
  `pick-a-model`, so the scripts cannot drift from the real UI. Front-end open,
  backend private, and "grounded in its own repository" kept.
- **Delightful first-run: Creative Studio "The Standing Light" (app).** A harbor
  light is small, always lit, and guides bigger vessels in. Because Mini is
  bundled, onboarding leads with it as the one hero card ("Harbor Mini is already
  here" / "Say hello"), and Harbor / cloud key / Marketplace drop to a quiet
  "When you're ready to go further" tier (`StartingPaths.tsx`, cards variant).
  The seeded greeting is warm, honest, and ends by inviting a first move; a new
  `MiniFirstMoves` component renders tappable openers under it on a fresh Mini
  chat (`ChatScreen.tsx`), stepped in on `--stagger` with `press-fb`
  (`.first-move` in `theme.css`). Graceful-limit example lines documented in
  `harborMini.ts`. `test/harborGuides.test.ts` extended to pin all of it.

## Current state (2026-09-04, Harbor + Harbor Mini rows in Settings, Mini bundled with the app)

Founder ask: add two rows to the Settings > Harbor group, below the web-search
row, one for Harbor Mini and one for Harbor, each with a one-sentence byline and
a single install/uninstall control on the right. Harbor Mini should come native
with the app (bundled), so it is present on first launch. The guides are
grounded in this repo: open about every front-end feature so people can go deep
on setting their system up, silent on backend build internals. Mini is the app's
guide that knows its limits and tells you when you need a bigger model and how to
set one up; Harbor is a reasonably capable first coding agent and app expert.
Branch `claude/harbor-settings-rows-bundle-tbu2ct`.

- **The two rows (app).** `SettingsScreen.tsx` Harbor group now carries a Harbor
  Mini row and a Harbor row under web search, gated to non-desktop (the guides
  are the iOS on-device path). Each byline wraps to a full sentence (new
  `subWrap` on `SettingsRow`, `.settings-row-sub.wrap` in `theme.css`).
- **The single control (app).** `HarborInstallButton` (in `SettingsScreen.tsx`,
  styled `.harbor-action` on the house press physics): **Built in** for a bundled
  model (Harbor Mini), else **Install** / live percent (tap to cancel) / **Retry**
  / **Uninstall** for Harbor. Uninstall is a new store action `removeHarbor`
  (delete weights, drop `harborReady`, re-heal any stack anchored on Harbor to
  Mini). Harbor stays re-installable from the same row.
- **Harbor Mini bundled (native).** `HARBOR_MINI_BUNDLED` in `harborMini.ts` is
  the JS flag; the native `ModelStore.swift` carries `bundledModelIds` and
  resolves/lists/ensures a bundled model from `Bundle.main` (`bundledURL`), never
  re-downloads it, and never deletes it, so "Built in" is honest and it loads
  offline with nothing downloaded. The weights file is dropped into the app
  bundle at build time (not committed).
- **Mini's model, sized to a 170 MB app (founder cap, 2026-09-04).** The whole
  App Store download must stay under 170 MB with the guide bundled, so Mini moved
  from Qwen2.5-0.5B (380 MB GGUF, over budget) to **SmolLM2-135M-Instruct**
  (Apache-2.0), whose Q4_K_M GGUF is about 105 MB (SmolLM2-360M at 271 MB did not
  fit either). Total lands around 150 to 165 MB; verify the base app size in a
  TestFlight build, with Q4_0 (~92 MB) as the fallback if tight. The id stays
  `harbor-mini` (a stable slot); only the URL, labels, and attribution changed.
  Being 135M it is a grounded guide over the injected app facts, not a reasoner,
  and hands off to Harbor for real work. `harbor.ts`/`docs/HARBOR.md`/
  `MODEL-LICENSES.md`/Settings privacy copy all updated.
- **Personas + knowledge.** `harbor.ts` / `harborMini.ts` personas and the shared
  `guideKnowledge.ts` now carry the front-end open, backend private boundary,
  "grounded in its own repository," Harbor as a first coding agent, and Mini
  owning its limits and pointing to a bigger model. `docs/HARBOR.md` and
  `app/MODEL-LICENSES.md` rewritten (Mini is now redistributed in the bundle
  under Apache-2.0). `test/harborGuides.test.ts` pins all of it.
## Current state (2026-09-04, Humanizer: written output avoids AI writing patterns by default)

Founder ask: OpenShore harnesses the active models, and one way it does that is
by running any written output through a Humanizer Mechanism so published
material avoids AI writing patterns. The main source is Wikipedia's "Signs of AI
writing." Because that page is world-editable, ingest what is on it today as a
snapshot (data, not instructions), and keep humanizing the voice of written
output unless a given project's instructions say otherwise. Branch
`claude/humanizer-ai-writing-patterns-sv9j3b`.

- **The standard, distilled from the source.** `os-code/src/core/agent/humanizerStandard.ts`
  is a curated, dated snapshot (captured 2026-09-04) of the prose-voice tells
  from the "Signs of AI writing" page, rewritten as avoid-this build
  instructions the model acts on while it writes. It carries the twenty-plus
  signs (inflated significance, canned notability, superficial trailing
  analysis, promotional tone, vague attribution, outline-style "faces
  challenges" conclusions, negative parallelisms, rule of three, Title Case
  headings, excessive boldface, bold-lead-in lists, em dashes, decorative emoji,
  unnecessary tables, curly quotes, leaked assistant chatter, knowledge-cutoff
  filler, unfilled placeholders, model-internal markup leftovers) plus the
  overused "AI vocabulary" word list. The Wikipedia-specific signs (wikitext vs
  Markdown markup, heading levels, category and template hallucinations, DOI and
  ISBN integrity) were dropped as out of scope for general written output. The
  header records the source URL, the capture date, and the rule that the page is
  refreshed deliberately, never wired to a live fetch.
- **The mechanism is injection, not a rewrite pass.** Rather than a second model
  call over finished output, the standard rides into the writing agent's system
  prompt (`humanizerStandardPrompt`, injected in `loop.ts` beside the UX
  standard) so output is born humanized in one pass. Local-first friendly, no
  extra cost.
- **On by default, with an off switch.** `humanizer.standard` defaults to `on`
  (`config/schema.ts`, `HumanizerSchema`). A project sets `humanizer.standard:
  "off"` in `os-code.config.json`, or adds its own voice rules in
  `humanizer.notes`, or a person says "skip the humanizer" in the chat. Mirrors
  the UX standard's off switch exactly. Documented in
  `os-code.config.example.json`.
- **Proven by a test.** `test/humanizer.test.ts` checks the standard through a
  real AgentSession on the mock provider: it reaches the model by default, a
  project can turn it off, and project voice notes ride along. The full suite is
  green (389 tests), and the total em-dash guard passes over the new files.
- **User-facing setting "Humanize Writing" (app).** Founder follow-up: expose it
  as a plain on/off setting, default on, named so a person can see what it is
  and so it can be renovated as its own feature. Added `humanizeWriting` to
  `app` settings (default on), a "Writing" group in `SettingsScreen` with a
  Switch and a "How this works" info sheet for transparency, and threading
  through `StackDriver` (`humanizerApplies`, `StackContext.humanize`) so app-side
  chats carry the standard unless it is off. On-device pocket models are skipped
  to protect their small context, the same carve-out the UX standard makes; the
  desktop engine still carries the standard through its own config. Off means a
  shorter prompt, so the model runs a little faster. `app/test/humanizeWriting.test.ts`
  pins the wiring; the full app suite is green (524 tests).
- **The setting now reaches the desktop engine (CTO/CMO follow-up).** The app
  toggle is sent as a per-session override into `bootstrapSession`
  (`BootstrapOptions.humanize`), threaded through both session paths: the daemon
  (`POST /sessions` body, `daemonCreateSession`) and the electron bridge
  (`engineHost.createSession`, IPC, `electronBridge`). Precedence lives in one
  pure helper, `humanizerEnabled(configStandard, override)`: the override can only
  turn the humanizer OFF, never force it on, so a project's `humanizer.standard:
  "off"` (or `notes`) always wins while the app toggle's OFF propagates to a
  paired desktop. Applied in bootstrap so `loop.ts` keeps reading `config.humanizer`
  as its single source. The Settings info sheet now states the true scope (app
  chats and paired desktop sessions; a project config still wins; the on-device
  guides are left as they are). Gates green: os-code 402 tests, app 540 tests,
  typecheck and lint across both packages.

## Current state (2026-09-04, Tokens and Secrets: a per-project encrypted note, local models only)

Founder ask: a private "tokens and secrets" note per project so the project and
the model keep track of credentials and the person does not have to hunt them
down or rotate them for lack of a record. Gated by a Settings toggle (privacy),
off by default, opt-in. Branch `claude/openshore-vault-presets-bscvtq`.

- **Sealed, device-local, never in a repo.** The note lives in the encrypted
  device store (`app/src/lib/projectSecrets.ts`, secretGet/secretSet, keychain
  or secure enclave on iOS), keyed per project. It is NOT a vault note (a vault
  can move to iCloud/Drive) and NOT in the repo (the repo is pushed by the
  reconcile feature), so it never leaves the device. Emptying it deletes the
  sealed entry.
- **Local models only, enforced in one place.**
  `os-code/src/core/agent/secretsGate.ts` `gateProjectSecrets` carries the
  secrets and turns on egress lockdown ONLY for a local orchestrator; a cloud
  orchestrator has them dropped in bootstrap before they can reach a prompt.
  A secrets-bearing session runs under egress lockdown: `buildToolRegistry`
  drops webSearch, webFetch, and every specialist/vision/image tool (they could
  route to a cloud model), and `loop.ts maybeEscalate` never escalates to the
  cloud. The secrets block is added to the system prompt only when the session
  carries secrets; it is built per request and never stored in history or the
  journal (which is redacted anyway).
- **The toggle and the note.** Settings gains "Store tokens and secrets" (device
  local, off by default). In the project's Vault view a "Tokens and Secrets" row
  is editable when on (with a clear "encrypted here, never pushed or synced"
  note) and grayed with "Toggle on in Settings to enable" when off. Secrets flow
  to the model only over the in-process desktop engine, never over the daemon to
  a remote machine.
- **CTO review: safe to ship, one must-fix folded in.** The review confirmed the
  local-only guarantee airtight on every path (cloud orchestrator, mid-session
  escalation, specialist/vision/image delegation, web tools, the daemon on both
  ends, and logging: the secrets block is never journaled and the journal is
  redacted). The one gap it found: `searchRepo` could still reach a cloud
  embedder under lockdown, because `buildToolContext` was not given the lockdown
  flag. Fixed: lockdown now forces on-device keyword search (no embedder), with a
  guard test. Also folded in the daemon-opts hardening (the daemon path builds
  its own opts without secrets, pinned by a wire test) and a sealed-secret wipe
  on project delete.
- Gates green: os-code typecheck + lint + 394 tests + build; app typecheck +
  lint + 527 tests + build; Prettier clean.

## Current state (2026-09-04, Terminal Control strict OFF, remote hubs, polish)

Follow-on to the Terminal drop, all founder-requested in one pass. Built on
`claude/termius-terminal-integration-xspkyn`, recursive gate green (os-code 356
tests, app 497 tests, typecheck, lint, prettier, build), pending the CTO's
pre-push pass, then to `main`.

- **Stricter OFF: the model and the terminal are fully separate.** Off no longer
  means "ask per command"; it means the model is not allowed to run shell on the
  hub at all. A desktop `runShell` approval is auto-denied with a reason that
  tells the model to send the person to the Terminal Control switch (in Settings
  or the Terminal room), or to hand them the command to run themselves. To carry
  that guidance into the model's turn, `ApprovalAnswer` gained an optional
  `reason` (os-code `types.ts`), used on decline in `loop.ts`, and forwarded
  across the daemon (`serve.ts`) and the electron host and IPC. Absent reason is
  the old generic decline, unchanged.
- **The approval assembly is now a pure, tested function.** `decideDesktopShellApproval`
  in `app/src/lib/terminalControl.ts` folds the driver-kind fence, the shell-only
  gate, target resolution, the On/Off decision, and the deny reason into one
  place the store calls; new tests pin approve / deny / passthrough and the
  member case (the CTO's earlier nice-to-have, done).
- **A desktop can drive a remote hub (fast-follow).** `buildDriver` uses this
  machine's own engine unless `settings.preferRemoteHub` is set, then it runs
  sessions on the active hub over the tailnet, the way the phone does. Terminal
  Control keys to the hub URL in that mode, so an On state never leaks between a
  desktop's own engine and a hub.
- **Multi-hub (fast-follow).** `settings.daemons` holds the saved hubs; the
  active one is mirrored into `settings.daemon`, so every existing single-hub
  reader keeps working. `hubList()` folds a legacy single hub in (no migration).
  Store actions: saveHub / selectHub / removeHub / renameHub / setPreferRemoteHub.
  PairScreen gains a "Your hubs" switcher (rename, forget, switch active) and, on
  a desktop, a "Use a remote hub" panel with the preferRemoteHub toggle and a
  connect form. `DaemonTarget` gained an optional `name`.
- **Terminal Control also lives in Settings** now (the founder's "turn the toggle
  on in settings"), showing the target and gated to admins on a shared hub.
- **Polish.** The room's sections assemble on the arrive curve with the house
  stagger (reduced-motion safe), a calm status dot sits by the running host, and
  turning Terminal Control on fires the firmer decisive-commit haptic over the
  Switch's tick.

## Current state (2026-09-04, offline reconcile: project commits push to the remote on open and reconnect)

Founder ask: nothing should linger only on the device. If you are offline, the
app buffers your changes and pushes/merges the markdown updates into your repos
when you reconnect, and every app open checks for pending local activity to push
to wherever the project points. Because the notes are committed with the code,
"pending local activity" is unpushed local commits on the desktop clone; the
build is desktop-side. Branch `claude/openshore-vault-presets-bscvtq`.

- **Reconcile engine (os-code).** `os-code/src/git/reconcile.ts`
  `reconcilePush(cwd)`: pushes the current branch's unpushed commits to its
  tracking upstream; on a moved-on remote it fetches and merges, then pushes; a
  real conflict is aborted (tree left exactly as it was) and reported. Rails:
  only pushes a branch that has a tracking upstream, never force-pushes, never
  merges over a dirty tree. `reconcileRepos` runs several, isolating failures.
  Tested against real temp repos (fast-forward, merge, conflict-abort).
- **Desktop host + bridge.** `EngineHost.reconcileRepos` runs the engine on the
  real clones; exposed as the `reconcileRepos` bridge method (main.ts ipc +
  preload + electronBridge type). The result type rides the browser-safe
  `os-code/protocol` barrel as a type-only export.
- **Triggers + surface (app).** `store.reconcileProjectRepos(trigger)` gathers
  each project's primary local clone (`app/src/lib/repoReconcile.ts`), guards to
  desktop + online + single-flight, and runs on every app open and on the
  `online` event. Quiet toast on a push, a plain reassuring toast plus a Vault
  notice on a conflict (work is never lost). iOS has no local clone, so it just
  reads the always-current remote.

## Current state (2026-09-04, per-project memory notes, stored in the repo, kept current by the harness)

Founder ask: a coding project should carry a few preset markdowns that run as
historical knowledge, kept up to speed by the harness and organized by project,
so a model reads the "top sheet" first and digs deeper page by page only as
needed, for planning and debugging. On storage the founder was explicit: the
notes live INSIDE the project's primary attached repo, in a folder named
"OpenShore Project <name> MDs/", committed with the code, not hosted by the app.
Branch `claude/openshore-vault-presets-bscvtq`.

- **The five presets, per project, in the repo.** The primary repo gets a folder
  "OpenShore Project <name> MDs/" holding Current State, Progress, Decisions,
  Action Items, and Skills. Current State is the pinned top sheet: a 2 to 5
  minute catch up with five sections (what last landed and launched, key
  outstanding build actions, key outstanding test actions, immediate blockers,
  suggested next steps). Progress is the fuller record and log; Decisions is one
  line per ambiguous call; Action Items is the ranked to-do; Skills is the
  project's reusable build/test/ship recipes and gotchas. The literal
  prefix/suffix wrapper on the folder name means the enclosed project name can
  never be a bare ".." that climbs out of the repo.
- **One shared spec.** `app/src/lib/projectMemory.ts` and
  `os-code/src/core/agent/projectMemory.ts` are the mirrored source of truth for
  the file set, order, seed templates, folder convention, and path predicates. A
  test in each package pins the shape so they cannot drift.
- **The harness keeps them current.** A project-memory protocol rides into the
  coding agent's system prompt (`projectMemoryPrompt`, injected in `loop.ts`
  beside the UX standard): read the Current State top sheet first, dig page by
  page only as needed, and update the five notes as work lands. The project name
  is threaded from the app (`store.ts`) through the Electron bridge, the daemon,
  and `bootstrapSession` into the tool context, so the agent's folder matches
  the project.
- **Narrow silent auto-write, into the repo.** A dedicated `projectMemoryWrite`
  tool (`os-code/src/core/tools/projectMemory.ts`), hard-scoped to the five files
  inside the current project's memory folder in the repo working tree, lands its
  writes without the always-ask prompt: the permission engine auto-allows it by
  name for a managed memory path, while every general write (writeFile, editFile,
  vaultWrite) still asks. It seeds the full set from templates on first touch,
  and the notes ride into the agent's commit with the code (no separate commit).
  This is the founder's "narrow exception," pinned by tests.
- **App read-only view, cross-platform (BUILT).** The founder chose full
  cross-platform, so the notes are readable in the app's Vault section on both
  platforms. A "Coding projects" list in the Vault opens a read-only
  `ProjectMemoryScreen` (view `projectmemory`, reached via `openProjectMemory`)
  that lists the five notes (Current State pinned, "Top sheet" marker) and
  renders each read-only. The source is chosen per platform
  (`app/src/lib/projectMemoryRead.ts`): the local clone on desktop (new
  read-only bridge `repoReadDir`/`repoReadFile`, jailed to the repo root in the
  main process), else the primary GitHub repo (new read-only contents client
  `app/src/lib/github.ts`, using the existing OAuth token). Friendly states for
  no-repo, not-created-yet, and unreachable.
- Gates green: os-code typecheck + lint + 374 tests + build; app typecheck +
  lint + 495 tests + build; Prettier clean on all changed files.

## Current state (2026-09-04, Terminal room and Terminal Control, shipped)

Founder ask: bring a Termius-style in-app terminal to OpenShore as a dedicated
section below Projects, so the active model can run commands and read output
while coding instead of the person copying results back into the chat by hand,
gated by a "Termius Control" toggle people can leave off if they do not want to
hand over their terminal. Termius itself is a closed third-party app with no
embed or automation API, so it cannot be wrapped; the app already has the exact
capability built natively (a PTY over Tailscale, xterm.js, an agent
command bridge, four permission modes), so this drop surfaces and gates that.
Shipped to `main` at the founder's direction, after a CTO pre-push pass.

Decisions taken with the founder and the CTO: use the native terminal (not
Termius); name it "Terminal Control"; one central hub; toggle default OFF;
the terminal follows the active session's host (no machine picker); a second
desktop driving a remote hub and multi-hub are approved fast-follows, not in
this drop.

- **A Terminal room below Projects.** `app/src/screens/TerminalRoomScreen.tsx`
  (view `terminalroom`, nav entry + icon in `Sidebar.tsx`, route in `App.tsx`).
  First run names the two one-time steps (install the OpenShore desktop engine
  on your hub, put both devices on one Tailscale network) and hands off to
  Desktop and phone, which owns the real download and pairing steps. After that
  the room shows the live terminal when a desktop-backed session is active, a
  "no session open" or "connect your hub" state otherwise. The terminal view is
  `app/src/components/DesktopTerminal.tsx`, a sibling of the shipped from-chat
  takeover (`screens/TerminalScreen.tsx`), which is left untouched.
- **Terminal Control, per target, default OFF.** `app/src/lib/terminalControl.ts`
  holds the pure rules; `app/test/terminalControl.test.ts` pins them (17 tests).
  On lets the model auto-run `runShell` on the machine the session runs on; Off
  keeps every command on the approval sheet, so nothing runs without a tap. It
  is scoped per target (the local engine key, or a hub's base URL) so an On
  state never follows a session to another machine, admin-only in a commercial
  org (matching the daemon, which keeps the raw shell admin-only), and it gates
  exactly `runShell`, never edits or cloud spend. Settings gain
  `terminalControl` and `terminalRoomSeen` (both device-local, never synced);
  the store's approval handler auto-approves through `shouldAutoRunShell` ahead
  of the existing mode rules, which are otherwise untouched.
- **CTO pre-push review: safe to ship, no must-fixes.** All four security
  checks pass (default OFF holds, no cross-target leak, gates only runShell and
  not for a commercial member, existing daemon admin gate and mode rules
  untouched). Two non-blocking hardenings were folded into the same deploy: a
  `driver.kind === 'desktop'` fence on the shell gate (also the correct meaning,
  since Terminal Control governs the hub's own terminal), and a final keystroke
  flush on the terminal's unmount. The CTO named plainly that On is functionally
  `bypassPermissions` for shell on that one machine, which is the intended,
  admin-gated, default-OFF design.
- Gates green: app typecheck, eslint --max-warnings 0, 489 vitest tests,
  prettier, vite build. Em-dash-total respected.

## Current state (2026-09-04, Projects get their own room and enterprise sharing)

Founder arc off the Projects screen: "you should be able to click into a project
and it shows all of the chats and the instructions and files and repos tied to
that project ... a sub-interface for the coding agent tailored to the project at
hand. Also for the enterprise version you are able to handle permissions of who
is permitted to read, write, and/or edit by email." Then: "build the enterprise
permissions so they can be deployed in projects." Built end to end and shipped to
`main` (gates green). The permissions half is server-enforced but needs
`supabase db push` (0014) before it lights up; it degrades to local-only
projects until then.

- **A project detail room.** Tapping a project on the Projects list opens its
  own room (`app/src/screens/ProjectDetailScreen.tsx`, view `project`): its
  chats (tap to open, with a way back), standing instructions (edited inline),
  the repositories and their files it works in, and a New chat scoped to it. The
  Projects list is now lean tap-to-open cards. Navigation reuses the back-trail
  grammar, so a chat opened from the room returns to it.
- **Enterprise project sharing, server-enforced.**
  `supabase/migrations/0014_org_projects.sql`: `org_projects` +
  `org_project_members`, a SECURITY DEFINER `project_level()` resolver (an org
  admin/owner always holds edit; everyone else holds their grant, matched by
  verified uid OR email, never client input), RLS that hides other orgs, and
  the ONLY write path is a set of level-checked RPCs (list/create/update/delete
  - set/revoke access). Direct table writes are revoked, the same lockdown shape
    as `org_vault` (0010). A grant can only be handed to a real member of the org.
- **The read/write/edit ladder.** read = open the project and its chats; write =
  read plus start/run chats in it; edit = write plus change its instructions,
  repos, and access. `app/src/lib/projectAccess.ts` answers the ladder; a shared
  project reflects the server-resolved level, a local project is always the
  owner's own (its grant roster is a draft that ships when shared).
- **Client wiring.** `app/src/lib/orgProjects.ts` maps rows and wraps the RPCs;
  the store gains shareProject / unshareProject / syncOrgProjects and routes a
  shared project's content and roster writes through the server (local projects
  stay device-local). Shared projects sync on sign-in and drop on sign-out so a
  handed-off device never leaks another account's team projects. The detail room
  shows a Share button (admins), a Shared badge, and gates editing by the
  person's level.
- Gates green: app typecheck, lint, 472 tests, vite build; Prettier clean; the
  migration's shape is pinned by a test. Not exercised against a live database
  until `supabase db push` runs 0014.

## Current state (2026-09-04, reviews scale path baked in + TestFlight incident closed)

Two things this session: the CTO's reviews scale path is built, and the
2026-09-03 TestFlight publish incident is resolved (the app is installed and
signed in on device, reviews backend live, moderator seeded).

- **Reviews scale path (CTO), BUILT.** A whole-catalog review-aggregate snapshot
  is baked into the daily catalog build, so a browse row shows its community star
  straight from the shipped `catalog.json` with ZERO per-view request to
  Supabase. Migration `0013_review_snapshot.sql` adds `model_review_snapshot()`
  (count + average per model over VISIBLE rows only, no id list, safe for anon,
  validated against a real Postgres: the hidden row is correctly excluded). The
  builder (`os-code/scripts/build-catalog/reviews.ts`, `SupabaseReviewSource` +
  a pure `mergeCommunity`, mirroring `sources.ts`) reads it once per build when
  `CATALOG_REVIEWS_URL`/`CATALOG_REVIEWS_ANON_KEY` (fallback `SUPABASE_URL`/
  `SUPABASE_ANON_KEY`) are set, and stamps a top-level `reviewsSnapshotAt`. The
  app (`MarketplaceScreen`) seeds browse stars from the baked `community` fields
  and, when the stamp is present, STANDS THE LIVE BROWSE RPC DOWN entirely; the
  product page still fetches the live number when a reader taps in, so a daily
  snapshot on browse costs no freshness that matters. Fully back-compatible:
  no stamp (older catalog, or the reviews backend unconfigured in CI) means the
  app falls back to the live browse RPC, exactly as before. Gates green:
  os-code 356 tests, app 442, lint, typecheck, app vite build.
  TURNED ON and verified live: the two `CATALOG_REVIEWS_*` secrets are set on
  the catalog workflow, `0013` is applied to the live database (`supabase db
push`), and a dispatched catalog run baked the snapshot cleanly (run 24 hit a
  404 because `0013` was not yet pushed, run 25 read the RPC and baked with no
  404). The published `catalog.json` on the marketing site now carries
  `reviewsSnapshotAt: 2026-09-04` over 174 models, 0 currently carrying a
  `community` field because no reviews are written yet. The moment reviews land,
  the daily build bakes their aggregates with no code change.
- **TestFlight publish incident (2026-09-03), CLOSED.** The only real blocker
  was ITMS-90474 (an iPad app declaring no landscape orientation must also
  declare `UIRequiresFullScreen`), fixed in `Info.plist` (`d3f3c90`). Two
  build-number rewrites made on a guess during the incident were both reverted
  (`bf37c7a`): the stamp is back to Codemagic's own `$BUILD_NUMBER`, the
  mechanism that had shipped ~62 builds without a duplicate. The query-Apple
  rewrite was the likely cause of the `previousBundleVersion: 62` duplicate
  (a build still processing is not yet the "latest," so `LATEST + 1` lands on a
  taken number); the codemagic comment now carries that history so it is not
  redone. App installed, sign-in works (the build now carries the Supabase env),
  moderator seeded and verified (`founder@openshore.ai`).

## Current state (2026-09-03, a broader marketplace and community run reports)

Founder, from a "best local LLM" list: carry essentially every available local
model and stay current weekly, and add App-Store-style user reviews and stars so
browsing is community-guided. Ran it past CTO, CMO, CX, and Creative Studio.
Founder decisions: broaden coverage but stay curated (not "open everything");
any signed-in user may review; build both together. Built end to end; the
reviews half needs `supabase db push` (0011) and Supabase env before it lights
up (it degrades to benchmark-only otherwise).

- **Broader coverage, still curated (Ask 1).** The discovery builder
  (`os-code/scripts/build-catalog/discover.ts`) keeps its trusted-publisher
  guardrail (opening it would readmit clean-named guardrail-stripped models, per
  CTO) but grows the roster to ~70 labs and curated quantizers, teaches
  `pickWeights`/`shardSet` to accept complete multi-part GGUF shard sets (the
  flagship 40 to 70GB quants that a single-file pick rejected), parallelizes the
  detail reads through a bounded pool, follows Link-header pagination, and lifts
  the caps (250 models, 200GB ceiling, 400 reads). `gate.ts` gains a
  `CATALOG_ALLOW_LARGE_DROP` escape hatch for a deliberate prune. The app renders
  the sortable list incrementally (an IntersectionObserver window) so a few
  hundred models stay smooth.
- **Two rating axes, never blurred (Ask 2, CMO/CTO).** Benchmark "OpenShore fit"
  is unchanged and still never crowd-sourced. Community is a SEPARATE axis in a
  new warm `--voice` token, a single star that ALWAYS carries a count (the tell),
  so it can never be read as the measured score. The header contract and
  CLAUDE-level honesty framing are reworded to name both truths.
- **A review is a run report (CMO/CX).** Star plus the hardware, quant, and felt
  tokens/sec it ran at, prefilled from the device, so the product page can say
  "runs well on machines like yours" (a benchmark cannot). Hardware and speed are
  shared only on submit; local usage stays device-local. Sparse averages are
  hidden below a count floor and shrunk toward the benchmark prior (CX), so one
  early report never stamps a score. `reviewsMath.ts` is pure and tested.
- **Apple 1.2 UGC, all four (CTO).** `supabase/migrations/0011_model_reviews.sql`
  carries model_reviews / review_reports / user_blocks / review_eula_acceptance
  with RLS (anon reads visible rows, minus blocked authors; writes own only), an
  auto-hide trigger past a report threshold, and server-side aggregate RPCs
  (single and batched) so browse rows get a crowd star in one call without
  shipping raw rows. The write flow gates on EULA acceptance and a first-line
  objectionable-content filter; every review row has report and block controls.
- **Direction C UI (Creative Studio).** Community line on browse rows and the
  full "room" on the product page: a display-face average, a `--voice`
  distribution, the hardware/tok-s signal, the review list, and a sheet-based
  write flow whose distribution settles on submit. Cold start is an invitation,
  never a zero-star.
- Gates green: `pnpm -r lint`, `-r typecheck`, `-r test` (os-code 343, app 442),
  app vite build. Not device-verified; the reviews backend is unexercised until
  `supabase db push` runs and the RPCs are live.

## Current state (2026-09-03, BYOM pill, per-status stacks, cloud favorites and direct chat)

Founder-driven arc off the phone Stack screen and the model picker, shipped to
`main` end to end (gates green, then merged with the storage/iCloud work below).

- **BYOM control is a labelled pill with a top-sheet explainer.** The round
  plus on the Stack header became a "BYOM +" pill with a small info glyph
  hanging off its top-right corner; the glyph lowers a sheet from the top
  edge that says what bringing your own model means. `Sheet.tsx` gained a
  `top` variant (the same door hinged at the top, dragging up to dismiss);
  the drag math runs in dismiss-positive travel space so one path serves both.
- **A stack per connectivity status, chosen automatically.** The single stack
  became one per status (`settings.stacks`, keyed docked/offshore/offline);
  routing already knew the effective status, so the matching stack is used
  automatically. The status row on the page is a dropdown (large title, byline
  beneath, a "now" chip). First launch pins the old single stack to the status
  the user is in and leaves the other two anchor-only. Edit actions take a
  target status; BYOM disconnect clears every status; healing runs per status.
- **Fuller Claude lineup with a visible favorite star.** `claudeModels.ts`
  gained a tier field: the current family up top, older models (Opus 4.8, 4.7,
  4.6, Sonnet 4.6, Fable 5) behind a new "More models" sheet, in the Claude
  app's shape. Favoriting is a visible star on every model row (swipe still
  works); a pinned model rides the top of Select model for one tap.
- **Favorites and direct chat for every cloud provider.** The conversation
  source's provider widened from the anthropic literal to any provider id, so
  any connected provider's model can be pinned and picked. A new
  `CloudOpenAiDriver` speaks OpenAI-compatible `/chat/completions` (streaming
  on web, the native shim's whole-answer path on device); `buildDriver` routes
  Claude to the Anthropic SDK and everything else to it. The chat sheet lists
  every provider's models as pinnable rows; the Stack bench surfaces favorites
  first for each. Image attach follows the chosen model's real vision
  capability; the context meter fills for every provider (a local token
  estimate fills in when a provider reports no usage).
- **Model dev check.** `app/scripts/verify-cloud-models.ts`
  (`pnpm --filter oscode-app verify:models`, tsx): reads each provider's live
  `/v1/models` with keys from the environment and reports any offered model
  that is a dead button or newly available. Manual, network + keys, out of CI.
- Gates green before the push: app typecheck, lint, 424 tests, vite build;
  Prettier clean. Open caveat: the older Claude ids and context windows in the
  `more` tier follow the house convention and want a `verify:models` pass with
  real keys before the next device ship.

## Current state (2026-09-03, large models are never restricted: storage, iCloud home, machine hint)

Founder, from the Kimi marketplace screen: "I don't want any models restricted
from download just because they are large. There should be a storage capacity
monitor and a recommended machine based on required RAM. The monitor looks at
total storage remaining on the local device but also lets you download a model
to connected cloud storage like iCloud that you can draw from when online." Then
"get creative studio and cto involved to get this right," and "keep iCloud as
the cloud home, made honest," "build the full premium treatment," native side
included, to TestFlight. Built end to end.

- **Size decides where the bytes land, never whether you may have them.**
  `app/src/lib/modelStorage.ts` (pure, 19 tests): a storage-fit check with a
  3 GB reserve, a required-RAM estimate (prefers the catalog's `minRamGB`
  floor), a recommended-machine mapping, and a default download-target chooser.
  No function has a "blocked" return.
- **Storage capacity monitor, ambient (Creative Studio Direction C).** An
  ambient capacity chip (free space, iCloud dot) opens the full readout in a
  Sheet, so status never sits as a card over the store front. The real meter
  lives on the model's product page, where the choice is made, with a
  footprint block (`.cap-ghost`) that shows the model claiming space and lifts
  off the bar when you switch to iCloud. Low space is amber (`--warn`), never
  red: owning models is not an error.
- **Recommended machine as an opening, not a rejection.** When the phone is
  short on memory the page leads with the model's ambition, then two calm equal
  paths (keep it in iCloud, or pair a machine over Tailscale). Never "Too big"
  on the decision page.
- **Download to iCloud, drawn from when online (native, built).** The
  `OscodeLlama` plugin gains `deviceCapacity()` (free/total storage plus
  physical memory), a `target` on `downloadModel` that places the GGUF in the
  app's iCloud Drive container under Documents/Models (the same container as the
  Vault), `ensureLocal()` that materializes an evicted iCloud model before a
  load, and `location`/`evicted` on `listModels`. The device home stays
  backup-excluded; the on-device and stack drivers call `ensureLocal` before
  `Llama.load`, with a guided offline message. Store tracks `cloudModels`
  parallel to `deviceModels`, adopted on launch and treated as run-ready.
- **iCloud honesty (CTO):** the target consequence line and toast say plainly
  the iCloud copy uses your iCloud storage and loads when you are online; the
  fit lines are `isPhone`-gated so mock capacity never renders on web or
  desktop. CTO verdict was safe to ship; the open native caveat is below.
- **Connected cloud storage in the meter (founder follow-up).** The capacity
  sheet now carries a "Connected cloud storage" section with a row per cloud.
  iOS gives apps no way to read iCloud's own free space, so the iCloud row
  shows what your models occupy there plus a plain note about the missing
  number, never a fabricated free-of-total. Google Drive does report a real
  quota (about.get, `gdriveStorageQuota` in `gitos/gdrive.ts`), so its row is a
  true free-of-total bar when Drive is connected, or a used-only line for an
  uncapped Workspace account. `gdriveQuota.test.ts` pins the parsing.
- Gates green: `pnpm -r lint`, `-r typecheck`, `-r test` (os-code 338, app
  414), app vite build. Not device-verified (no iOS here); first TestFlight run
  is the proof, exactly like the earlier native plugins.

## Current state (2026-09-03, a page inside a room has a way back in the top bar)

Founder, from the Kimi K3 page in the store: "Need a back button when you
enter into any of the navigations within marketplace so I can go back to
marketplace. That's the pattern that needs to exist across the main pages."
Room-to-room already had it (the `viewTrail`, 2026-09-02); what was missing
was the second depth, a page a room opens over its own list, which kept the
menu in the top bar.

- **`BackBar` takes an in-room `back`** (`{ to, onBack }`, exported as
  `InRoomBack`). It wins over the room trail, because the nearest step back
  is the one the eye expects; the chevron, the desktop label, and the aria
  name all read from it. Nothing changes for rooms without one.
- **Three rooms carry an inner page and now hand it over.** The Marketplace's
  product pages (catalog and hosted) go back through the same tile hop as
  "All models", and the page's title becomes the model's name. An open Vault
  note goes back to the tree, saving first, the same handler as the "All
  notes" crumb. Launch's embedded Codemagic page goes back to Launch.
- `docs/interaction-model.md` gains a "Navigation" section stating the
  grammar at both depths, and for sheets. `test/wayBack.test.ts` pins the
  three rooms. Gates green: app typecheck, lint, 390 tests.

Open: an audit of every sheet for a visible dismiss control is in progress;
any sheet whose only way out is the scrim tap gets the round close button.

## Current state (2026-09-03, the drag dims the room, the title carries direction)

Founder: "Do all the polish," the pass on the sheet-and-back bundle.

- **The scrim dims with the drag.** `Sheet.tsx` captures the card's height at
  grab start and sets the scrim's opacity inline in step with the pull, so the
  room comes back as the sheet leaves rather than staying dark until it is
  gone. `.sheet-scrim.dragging` kills the transition so it tracks the finger.
- **The title cross-fade carries direction.** A page opening inside a room
  (`data-depth="page"`) slides its title in from the right, going deeper; a
  return to a root arrives from the left (`title-in-deeper` / `title-in-back`).
- **The grabber is hidden on a fine pointer.** On desktop nobody flicks a
  sheet, and the close button and scrim are the way out, so the handle is
  hidden under `(hover: hover) and (pointer: fine)`; the drag stays for touch.
- **InfoSheet is folded onto the shared Sheet.** It kept its own copy of the
  grabber gesture and `useSheetExit`; now it is a trigger plus `<Sheet>` body,
  so it inherits drag-to-dismiss, the velocity release, and the scrim dim with
  every other sheet. ProfileStatus stays on its own markup, the one sheet that
  must portal past the top bar's backdrop-filter; its `.info-sheet` rules now
  serve only it.
- `wayBack.test.ts` pins all four. Gates green: app typecheck, lint, tests.

Held for sign-off, not built: an interactive left-edge swipe to go back from a
page (a product page, a note). The left edge is the drawer's open gesture, and
a page's back closure lives in the screen's local state, not the store, so
routing the edge to it needs App-level arbitration between "open drawer" and
"go back" and lifting that state up. That alters the edge gesture, which has
wedged the app before (2026-09-03 fix), so it wants an explicit yes and a
design call first.

## Current state (2026-09-03, every sheet drags to dismiss; the top bar cross-fades)

Founder: "Do all of the Polish," the pass on the way-back bundle.

- **Every bottom sheet drags to dismiss.** `components/Sheet.tsx` grows the
  grabber and the gesture the two info sheets already had, done to the
  drawer's standard: the sheet sits exactly under the finger, rubber-bands
  past the top with asymptotic damping, releases on distance or a downward
  flick (velocity read over the last 80ms), and a lost pointer capture is a
  release too. A committed drag keeps its inline position until `closing`
  lands, so the exit transition continues from where the hand left it; a
  short release springs back on `--ease-spring` over `--dur-5` (`.settling`)
  rather than the door's glide. Haptics mark the lift and the drop. The
  confirm variant stays a card.
- **The top bar cross-fades.** The title is keyed by its text, so a page
  opening inside a room (a model's name, a note's name) fades and rises in
  rather than swapping; the chevron slides in from the left edge it points
  at, and the menu fades back when the page closes. `title-in` and
  `leftslot-in`, both on the glide over `--dur-4`, backwards fill.
- **An open note titles the bar with its own name**, the way Notes does; the
  chevron still says Vault.
- `wayBack.test.ts` pins all three. Gates green: app typecheck, lint, tests.

## Current state (2026-09-03, every step in has a step back, and all the polish)

Founder, from the Kimi product page in the store: "Need a back button when you
enter into any of the navigations within marketplace so I can go back to
marketplace. That's the pattern that needs to exist across the main pages,
when you navigate within the subsequent pages/sheets need back buttons to the
main page you started navigating from." Then: "Do all of the Polish. Push to
main."

**The way back, at every depth** (`docs/interaction-model.md`, "Navigation"):

- Room to room already had the `viewTrail` chevron (2026-09-02). What was
  missing was a page inside a room: the store's product page kept the menu in
  its top bar. `BackBar` now takes an in-room `back` (`{ to, onBack }`) that
  wins over the trail, because the nearest step back is the one the eye
  expects. The Marketplace hands it on both product pages (hosted and
  catalog), with the model's name as the title and the same tile hop as "All
  models"; an open Vault note goes back to the tree, saving first; Launch's
  embedded Codemagic goes back to Launch.
- Sheets dismiss rather than go back. The audit found eight whose only visible
  way out was the scrim tap: Settings (account, activity log, web search, add
  to your setup), Your stack's model picker, the Vault's note options and
  storage sheets, the source picker, the info sheet, and the connection sheet.
  Each now opens with `components/SheetHead.tsx`, the round close over a
  hairline (RepoPicker's shape). Sheets that end in Cancel or Done are left as
  they are. `test/wayBack.test.ts` pins the rooms with an inner page and the
  eight headers.

**All the polish**, both assessments (the close button's and the drawer's):

- Sheets are doors from the bottom edge: `sheet-up` slides the phone's sheet
  solid from below the edge on `--ease-glide` over `--dur-7`, the exit is the
  same transition, and the scrim dims on the same clock. A wide screen keeps
  the centered card, which rises a short way with a fade (`sheet-rise`) on the
  same curve and clock. `useSheetExit`, `Sheet.tsx`, and `ProfileStatus` hold
  the unmount for `sheetExitMs()` (the door clock plus a hair) instead of a
  340ms literal, so the tail is never clipped.
- Room changes ride the glide over `--dur-6`.
- The menu bars fold into a back chevron while the drawer is open
  (`MenuIcon` takes `open`; transform and opacity per bar on the door clock),
  seen as the door approaches and again as it leaves.
- The door brings its contents: the wordmark and each row arrive a step apart
  (`drawer-row-in`, delay `--dur-2` plus `--i` times the new `--stagger`
  token, 40ms), skipped when the finger opened it. Rows are indexed inline by
  Sidebar so the bottom group carries on counting.
- The sheet header carries a hairline shelf; the round close collapses to the
  tile scale on press; the Repositories empty-state card lands a beat after
  the header; the search field's rule and glyph lift on focus.
- The composer's attachment chips use the drawn close glyph at 12px in an
  18px round target with a color fade, no typed character left in the app.
- `CLAUDE.md` rule 1 names the glide and the stagger.

Gates green: app typecheck, lint, 391 tests. The sheet entrance and the folded
menu glyph were rendered at pinned times in headless Chromium.

## Current state (2026-09-03, the drawer glides on its own curve and clock)

Founder, with a screen recording: "I need the panel coming in and out to be a
smooth motion. Right now it's a bit jumpy. It needs to slide with a smooth
animation. Slow things down if needed." The recording, pulled apart at 60fps:
the whole slide, in and out, took about four frames. Root cause is the curve,
not a bug: both directions ran on the iOS standard curve over `--dur-5`, and
that curve puts about two thirds of its travel into the first fifth of the
clock. On a 310px door the visible slide was roughly 110ms of 320ms, then an
invisible crawl of the last few percent. A pop, then nothing.

- **Two new tokens, with the reason beside them.** `--ease-glide:
cubic-bezier(0.3, 0.1, 0.15, 1)`, a bezier fit of UIKit's critically damped
  spring (response 0.5s): soft start, one long even slide, a settle with no
  overshoot. `--dur-7: 520ms`, the door clock, for a surface that crosses the
  screen. The family was closed on purpose; this is the stated-reason door,
  and the tokens test pins both values. Recorded in `DECISIONS.md`.
- **The door, the scrim, and the shadow share the clock.** `drawer-in`, the
  scrim's `fade-in`, and the shadow pseudo-element's fade all run `--dur-7`
  on `--ease-glide`, so the room dims at the rate the door covers it (before,
  the scrim landed dark in 220ms, ahead of the door). The exit keyframes take
  `var(--drawer-exit, var(--dur-7)) var(--drawer-exit-ease, var(--ease-glide))`:
  a tap-close is the entrance run backwards.
- **A drag-to-close keeps its velocity clock and the standard curve.** The
  gesture already sets `--drawer-exit` from the release speed; Sidebar now
  hands `--drawer-exit-ease: var(--ease-standard)` alongside it, because a
  moving finger's momentum wants the front-loaded start and the glide's soft
  start would read as a hitch.
- **The unmount hold matches.** `lib/motion.ts drawerExitMs()` reads
  `--dur-7` plus a hair (540ms fallback). App holds the drawer mounted that
  long instead of the generic `EXIT_MS` (340ms, which would have clipped the
  glide's tail), and the gesture hook holds the finger's position for the
  same length, since dropping `--drawer-x` from a still-mounted panel would
  re-resolve its exit mid-hold.
- Verified frame by frame in headless Chromium on virtual time: the old
  entrance is at rest by 150ms; the new one is still travelling at 300ms and
  settles by 520ms. Gates green: app typecheck, lint, 386 tests
  (`motion.test.ts` pins the clock on all three surfaces, the curve hand-off
  in Sidebar, and both holds).

## Current state (2026-09-03, the sheet close button is a drawn glyph, centered)

Founder, with a screenshot of the Repositories sheet: "The x on the repository
box is off center. Make it more premium." Root cause: the round `.mode-close`
button typed a "×" character at 22px. A character carries its font's side
bearings and baseline into the box, so the ink sat low and to the left of the
circle, and it moved with whatever font the WebView loaded. Fix, in all three
sheets that share the button (Repositories, Select mode, Select model, plus
the model sheet's back chevron):

- **`components/SheetGlyphs.tsx`** draws `CloseGlyph` and `BackGlyph` as
  stroked SVG paths in a square viewBox, centered by geometry. The chevron is
  nudged one unit left so its visual mass reads centered.
- **`.mode-close`** rests in the soft ink and lifts to the full ink on hover
  (hover-capable pointers only) and on press; `line-height: 0` and a block
  glyph remove the last stray baseline. The color fades ride `--dur-2` /
  `--ease-standard`. The shorthand lives on `.mode-close.press-fb` because
  `.press-fb` is declared later at equal specificity and its own
  `transition: scale` would have reset the fades; press-fb's curt press-in
  and spring-out are unchanged.
- Verified centered in headless Chromium against the old glyph. Gates green:
  app typecheck, lint, 384 tests.

Left alone: the composer's attachment-chip "×" (a 16px chip, no circle to be
off-center in), and the search glyph in the same sheet, which was already SVG.

## Current state (2026-09-03, Repositories connect over OAuth, the GitHub App path)

Founder: the Repositories cards paste a GitHub/GitLab/Bitbucket token. "Possible
to change these to OAuth? Just do the same path Claude uses if possible." Claude
Code connects through a GitHub App whose secret lives on a server; that is now
OpenShore's path too, and the server already existed (the Supabase project that
runs the Stripe functions). Shipped for GitHub; GitLab and Bitbucket stay on the
token path for now (founder has no GitLab account, and one provider proves the
seam), and light up with no code change once their client ids are set.

- **`supabase/functions/repo-oauth/`** holds each provider's client secret and
  does the only secret-using work: `GET /callback` is a dumb https landing that
  bounces the provider's single-use code into the app over `oscode://repo-oauth`
  (GitHub rejects a custom-scheme redirect URI, so the https hop is required);
  `POST /exchange` and `POST /refresh` trade the code or a refresh token for
  access tokens using the secret, over TLS. `verify_jwt = false` (the provider
  redirect carries no bearer). The app never sees a secret.
- **`app/src/lib/gitos/repoOAuth.ts`** runs the app side: open consent (in-app
  browser on iOS, system browser on desktop), capture the bounce on the deep-
  link bus the app already uses (`appUrlOpen` on iOS, the Electron forward on
  desktop, no Electron changes), verify `state`, post the code to `/exchange`,
  store the tokens under `repoSecretKey(id)` so the connected badge and any
  future token reader work for OAuth and pasted tokens alike, plus `.refresh`,
  `.expiresAt`, `.mode` bookkeeping. `repoAccessToken(id)` refreshes through the
  function near expiry.
- **`ReposScreen`** shows one-tap "Connect <name>" when a provider is
  configured (`VITE_*_CLIENT_ID` present), with "Use a token instead" beneath
  it; a provider with no client id keeps only the token path. Remove clears both
  credential shapes. Reverses the "no OAuth app id" line in `DECISIONS.md` for
  the app; the zero-setup token path stays as the documented fallback.
- Gates green: app typecheck, lint, 8 new tests in `repoOAuth.test.ts`
  (secret never posted, state verified, tokens stored, refresh, remove).

**Live setup (GitHub, done 2026-09-03):** a GitHub App "OpenShore Code" is
registered under openshore-labs, set to "Any account" so any user connects
their own repos, permissions Contents + Pull requests read/write and Metadata
read, callback `https://lzlrlfdffwiypzreoldb.supabase.co/functions/v1/repo-oauth/callback`.
Its `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are set as
`repo-oauth` function secrets in Supabase; `VITE_GITHUB_CLIENT_ID` (the public
id) is a Codemagic build var. **Remaining to go fully live:** deploy the
function (`supabase functions deploy repo-oauth`); the TestFlight build for the
`VITE_GITHUB_CLIENT_ID` bake happens on this push to `main`.

## Current state (2026-09-03, the header picks repositories, not a model name)

Founder: "In the header let's replace the model name with a repo drop down
that allows you to select multiple repos that are connected to your account
like you can do in Claude Code. That should be possible in basic chats and
also in projects."

- **What a connected repository is here.** Two roads, one list
  (`hooks/useConnectedRepos.ts`): the paired computer's workspaces (a clone
  on disk, id = its path, the id `Project.repoIds` has always used) and the
  connected GitHub account's repositories, listed on the stored token
  through `/user/repos` (`lib/chatRepos.ts`, id `github:owner/name`, newest
  push first, up to 300, cached on the device for ten minutes). GitLab and
  Bitbucket tokens connect but list nothing yet; their rows are a follow-up
  on the same seam.
- **The picker (`components/RepoPicker.tsx`).** A quiet pill in the header's
  subtitle line where "model · kind" was (the model still lives in the
  composer pill): a branch glyph, the first repo's name and a count, a live
  desktop session's branch and dirty dot. Tapped, a repositories sheet rises
  in the Claude app's shape (the founder's reference screenshot): a title
  with the count, a Selected card of what is checked, a Repositories card of
  the rest, owner over name with a check on the right, search pinned at the
  foot, and a foot line that says plainly where the agent works. The sheet
  is portaled to the body: the top bar's backdrop-filter would otherwise be
  the containing block for its fixed scrim. Nothing connected yet opens on
  one button to the Repositories room. The empty-state top bar carries
  the same picker so repos are chosen before the first message, seeded from
  the active project; the first send carries them onto the new chat.
- **Per chat, seeded by the project.** `Conversation.repoIds` is new; a chat
  starts with what was picked, else its project's list, and keeps its own
  from then on (`setConversationRepos`). The project sheet offers the same
  combined list, so a project's default can name a GitHub repo too.
- **What the selection does, honestly.** The engine works in one directory
  per session, so the first selected workspace is the session's cwd when the
  source names none, and every selected repo rides into the chat's context
  by name (the desktop session's instructions, the stack's project
  instructions, a new `extraSystem` line on the cloud driver). A GitHub repo
  with no clone is context until it is cloned; a live session's cwd cannot
  change after it starts, and a changed list reaches the model on the next
  session. The panel's foot states the first half of this in one line.
- `test/chatRepos.test.ts` pins the ids and labels, the summary, the
  first-workspace rule and the context line, the GitHub mapping, paging, and
  auth header, a refused token surfacing as an error, and the wiring in the
  header, the first send, the store, and each driver. Gates green: app
  typecheck, lint, 376 tests. Verified headless against a stubbed GitHub
  API: pick two, search, dismiss, start a chat, the selection persists.

## Current state (2026-09-03, the text box never sits under the keyboard)

Founder, from a second recording: "Keyboard bug. Blocking text box. UI
should work like Claude (image selector expands chatbox too)." The path was
Control Center, the drawer, the Chats room, a tap on a chat, a tap on the
field; the keyboard rose clean over the composer and it never lifted. The
same build, the same chat, had lifted correctly minutes earlier, so the DOM
and the CSS were fine and the plugin's `keyboardWillShow` road had simply
not delivered a usable number that time. The root cause is not pinned (the
native plugin's zero-height rewrite is iPad-only, the listener lives at the
shell from boot, nothing on that path touches the root's inline style), so
the fix is resilience: the lift no longer hangs on one event with one good
number.

- **Belt and braces in `hooks/useKeyboardInset.ts`.** Both `keyboardWillShow`
  and `keyboardDidShow` feed the inset, and the plain window events the
  plugin also fires are read as a second road. A real height is remembered
  on the device (`lib/keyboardHeight.ts`, device-local by design, default
  336 before any reading); a reported zero or a bare accessory bar lifts by
  the remembered height instead of collapsing the composer to 4px. A text
  field that takes focus and hears nothing within 420 ms is lifted on the
  remembered height anyway, and that fallback lets go on blur, while a lift
  the plugin confirmed waits for the plugin's own hide. Verified headless:
  with no native keyboard at all, a focused composer lifts at the fallback
  beat and drops on blur.
- **The attach tray, Claude-style (`components/AttachTray.tsx`).** On a
  phone the + no longer jumps straight to the file picker: it opens a tray
  in the keyboard's slot, sized to the remembered keyboard height, so when
  the keyboard swaps for it the composer does not move. Three tiles, each a
  real picker: Camera (`capture="environment"`), Photos (`accept="image/*"`),
  Files (anything; a text file folds into a pasted chip as before). The root
  class and `--tray-inset` are set in the tap itself, before the field
  blurs, so the composer never dips between the keyboard's hide and the
  tray's arrival; focusing the field closes the tray and the keyboard swaps
  back in on the same y. Slides in and out on transform; the desktop + is
  unchanged. Verified headless: tray up, refocus, blur, the composer holds
  at the same top through the swap.
- `test/keyboardInset.test.ts` pins the remembered height and its floor,
  the zero-to-remembered rule, both show and hide listeners plus the window
  road, the fallback beat, the shell-only registration, and the tray's
  slot, exit, three sources, and close-on-focus. Gates green: app
  typecheck, lint, 365 tests.

**Open for the founder:** if the keyboard still ever rises over the field on
the device, the next step is a one-line breadcrumb (which road lifted, and
what the plugin reported) surfaced in Settings, so the root cause can be
read off the phone rather than guessed from a recording.

## Current state (2026-09-03, the wait has a shore)

Founder, from a screen recording of the chat: "make the OpenShore shapes move
like waves with some sort of thinking words like Claude does while it's
preparing a response and a more graceful typing of the response," and ask the
Creative Studio what would make it more delightful. The recording showed
three bouncing dots beside a fixed "Thinking 3s", then the whole reply popping
in at once. All three asks landed, shaped by the Studio's brief.

- **The mark rolls as surf.** The working row's dots are gone; in their place
  is `components/WaveMark.tsx`, the brand mark's own geometry (the horizon
  line held still, the shore wave `q4.5-3.3 9 0t9 0` drawn two wavelengths
  wide inside a clip) carried one wavelength to the right per 2.6 s loop on
  transform only. The loop seam is invisible because the travel is exactly
  one wavelength. Under reduced motion the still frame is simply the mark.
  The Studio's call: nothing new is introduced, the mark-as-loader is the
  most premium read, and the horizon takes muted ink because cream on cream
  would vanish.
- **The word turns over, honestly.** `lib/thinkingWords.ts` holds the house
  lexicon: plain "Thinking" always first, then a calm coastal set
  (Considering, Weighing it, Reading the tide, Between sets, ...) every
  3.6 s without repeats, and after fifteen seconds an honest long-wait set
  (Still thinking, Taking its time, Waiting on the model). No word claims
  work the model is not doing; the Studio cut Composing, Drafting, Searching,
  and the borrowed Pondering and Musing. Only a plain "Thinking" note
  rotates; "Writing", tool summaries, and "Waiting for your approval" hold
  verbatim. The swap is a small rise (the old word rises out, the new one
  rises in beneath it, `--dur-6 --ease-arrive`), the counter arrives at two
  seconds with the same rise, and the rotating text is hidden from the screen
  reader behind a static "Thinking".
- **The reply types, and finishes its tail.** `lib/streamSmoothing.ts` now
  reveals at a calm fixed pace (4 characters per 24 ms tick, about 165 a
  second) and only speeds up past a bounded lag (a fiftieth of the backlog
  per tick, so a long code answer trails by about a second, never ten). The
  real burst in the recording was `useSmoothedReveal` snapping the rest in
  the instant streaming ended; it now keeps ticking until the last character
  lands, and the caret stays through that tail and fades out (`--dur-4`)
  rather than unmounting. The caret breathes on `--ease-loop` instead of a
  hard `steps(1)` blink, and now rides a pseudo-element on the reply's last
  text line (`.md-caret > p:last-child::after` and its siblings, driven by a
  `caret` prop on `Markdown`), so it sits inline at the end of the words
  instead of hanging as its own block beneath the paragraph. The terminal's
  smoother keeps its brisker cadence; see DECISIONS.
- **The seam.** The working row eases out (`useExitPresence`, fade and a 3 px
  rise) instead of vanishing, and when the reply is what ended it, the slot
  gives up its height and the thread gap so the row plays its exit on the
  reply's first line: the wave and the word dissolve into the text on the
  same spot and nothing below jumps when the row unmounts. The exit holds
  the word the row was saying (the first token flips the note to "Writing" in
  the same reduce, so MessageList freezes it on the synchronous signal). A
  pinned thread
  now follows the revealed text, not only the incoming deltas.
- `test/workingRow.test.ts` pins the lexicon rules and the draw, the mark's
  verbatim motif and one-wavelength loop, the reduced-motion rest, the row's
  exit binding, the seam, and the caret's settle. `streamSmoothing.test.ts`
  pins the pace and the lag bound; the inline caret is pinned too. Gates green: app typecheck, lint, 356
  tests. Verified in a headless phone viewport on the scripted tour.

**Studio extras left for the founder's call** (ranked by the Studio, none
built): the "Thought for Ns" fold taking the counter's final value so the
numbers agree; a shared-element move where the wave translates into the
bubble's top-left and dissolves (about 30 LOC, medium risk); no sound (Brand
Exec veto: a quiet tool in a quiet room).

## Current state (2026-09-03, every store tappable answers the finger)

Round five, and the last one worth the squeeze. Three controls in the store
had no press feedback: the sort tabs, the "Details and license" disclosure,
and the phone's Filters button. All three now carry `press-fb`. The sort tab
declares its own transition shorthand (background, color), which would have
swallowed press-fb's scale release, so `.seg.press-fb` restates the shorthand
with `scale var(--press-out)` alongside; the guard pins that. Gates green:
app typecheck, lint, 342 tests.

Checked and left alone, on purpose: remembering search and filter facets
across a room round trip (the open product page and the scroll offset already
come back, and a typed query is a cheaper thing to re-enter than a wrong one
to notice); an entrance stagger on the hosted rows in the list (they sit in
their own section above staggered cards, and a second cadence would read as
two lists); and a press state on the compare checkbox (a native control, and
a scale on the label would fight the checkbox's own feedback).

## Current state (2026-09-03, the store front dissolves into the list)

Founder: "keep doing the polish until the juice isn't worth the squeeze."
Round four, the three items left on the store.

- **Search and filters crossfade on the boundary.** Every facet change now
  lands in `applyFacets`, which knows whether the store is crossing between
  the front and the list (or leaving a product page) and runs a root
  crossfade (`fade`, on the same View Transitions seam as the hop) only
  then, never per keystroke, since a transition per key would drag the
  caret. The search field and the category rail carry their own
  view-transition names (`market-search`, `market-rail`), so they hold still
  while the shelves below dissolve. The Discover chip, the shelf heads, and
  both Clear filters buttons route through the same helper; a guard fails
  any `onClick` that calls `setFacets` directly.
- **The filter sheet's count ticks.** The number in "N models match" and on
  the "Show N models" button is a `count-tick` span keyed on the total
  (catalog plus hosted), on the result bar's `count-pop`, so each facet tap
  answers.
- **The shared name is `product-tile`.** Renamed from `hosted-tile` in CSS,
  code, and the guard now that both product pages use it.
  Gates green: app typecheck, lint, 341 tests.

## Current state (2026-09-03, the whole store hops)

Founder: "do all the polish," round three, the two items left from the
frontier assessment.

- **The tile hop is store-wide.** A catalog hero, shelf row, or preset
  member now flies its tile into the model's product page the same way a
  hosted one does, and "All models" flies it home. The focused catalog card
  gains a `ModelTile` in its head (it had none), and `.product-page` is the
  one class both product pages share for the CSS-side shared name; hosted
  keeps `.hosted-page` for its own layout. `openModel` takes the origin and
  where it was tapped (`hero`, `row`, `preset`) and rides the same `hop` as
  the hosted page; `closeModel` mirrors `closeHosted`. `renderCard` grew a
  `focused` flag, so the list's `visible.map` now passes the index
  explicitly rather than the array.
- **Real progress on the Ollama pull.** "Pull through Ollama instead" on the
  hosted page subscribes to the bridge's install progress for its ref, so the
  bar and the percent are the same ones a catalog row shows, and the listener
  comes off in `finally`. The page's bar reads `indeterminate` and `percent`
  instead of always shimmering.
- `frontier-polish.test.ts` pins the shared class on both pages, all three
  tile origins, and the progress subscription with its teardown. Gates
  green: app typecheck, lint, 339 tests.

## Current state (2026-09-03, frontier shelf polish, all three tiers)

Founder: "do all the polish," the six items from the frontier-shelf
assessment. Four landed; two were re-checked and found already right.

- **The tile hops (Tier 1).** A hosted hero or row and its product page
  share one `ModelTile`, so opening the page is that tile flying into place
  and "All models" is the same tile flying home, on the View Transitions
  API (iOS 18, Chromium; a plain swap elsewhere and under reduced motion).
  The page tile carries `view-transition-name: hosted-tile` in CSS; the
  origin tile is handed the name inline for the one hop and `tileHome`
  remembers which tile (hero or row) to fly back to, since a duplicate name
  makes the platform skip the transition. Root rides `--dur-3` on
  `--ease-standard`, the tile group `--dur-5` on `--ease-arrive`; reduced
  motion kills every view-transition pseudo. `flushSync` inside the callback
  so the new snapshot is the finished render.
- **The connected moment (Tier 1).** `connectProvider` sets `justConnected`;
  the next store open reads it, fires `hapticSuccess`, and the "on bench"
  pills (and the page's connected pill) pop in on `pill-pop` (`--dur-4`,
  `--ease-spring`, `backwards`), then the flag rests. A forward hop to any
  room but the Marketplace or the Stack clears it, so a store opened days
  later never pops.
- **Amber light per capability (Tier 2).** The cloud hero now carries
  `data-cap` and `.hero-card.cloud[data-cap=...]` shifts the amber light the
  way the teal heroes shift theirs, so the row reads as one family.
- **Where the eye left (Tier 3).** The window never scrolled here; `.screen`
  is the room scroller, so the store's two `window.scrollTo` calls were
  no-ops. Now a `screenRef` scrolls the right element, `lib/scrollMemory.ts`
  keeps an offset per room, `hooks/useScrollMemory.ts` saves the outgoing
  room's offset in the same synchronous store subscription the room ghost
  uses (the old DOM is still there) and restores in a layout effect when the
  room was reached by going back (`arrivedBack`, set by `goBack`, cleared by
  `setView`). The Marketplace restores again once the catalog has given the
  shelves their height, and reopens the hosted page it left, so Connect from
  a page comes back to that page. A fresh open from the panel starts at the
  top, the way a tab does.
- **Checked, not needed.** The result count re-keys on one number computed
  in the same render as the hosted matches, so it never jumped twice; and
  the hosted page carries no inline stagger delay, so it already enters at
  index zero. Both assessment lines were wrong and are withdrawn.
- `test/frontier-polish.test.ts` pins the hop's tokens and reduced-motion
  kill, the pop's spring and `backwards`, the no-`window.scrollTo` rule, and
  the back-versus-forward arrival flags; `test/scrollMemory.test.ts` pins the
  memory. Gates green: app typecheck, lint, 338 tests.

## Current state (2026-09-03, Kimi in the store: the frontier shelf)

Founder, with a Marketplace screenshot: "I'm not seeing the new Kimi model.
I want it and I want that level of selection." Two things were wrong. The
Kimi provider added on 2026-09-02 listed Moonshot's July-2025 ids
(`kimi-k2-0711-preview`, `moonshot-v1-128k`), all retired since (the K2
previews on 2026-05-25, K2.5 and the moonshot-v1 series on 2026-08-31), so
every Kimi row was a dead button. And a cloud model was only reachable from
Cloud Connections, a settings room, so the store never showed it at all.

- **The Moonshot lineup is current.** `providers.ts` now lists Kimi K3 (the
  flagship, 1M context, API 2026-07-16), Kimi K2.7 Code (2026-06-12) plus its
  high-speed lane, and Kimi K2.6 (2026-04-20), under Moonshot's live ids, the
  console link moved to platform.kimi.ai. `RETIRED_PROVIDER_MODEL_IDS` names
  the sunset ids and `moonshotProvider.test.ts` fails on any of them. Every
  provider model (Claude, OpenAI, Gemini too) now carries store copy: a plain
  tagline, capability categories, context, release date, open-weights flag,
  and the Ollama `:cloud` tag where Ollama hosts the same model.
- **"Frontier, on your key" in the Marketplace.** `lib/hosted.ts` derives a
  browsable list from the BYOK providers (so the store and Cloud Connections
  can never drift) and the store renders it three ways: the newest release
  (Kimi K3) leads the hero row on an amber cloud card, a shelf sits right
  under the heroes, and search or a capability chip folds matching hosted
  rows in above the catalog list. The control is Connect, not Get: it opens
  Cloud Connections with that provider's paste field already open and
  scrolled into view (`openConnections` in the store, `connectionsFocus`
  honored once by the screen). A connected provider reads "on bench", since
  the Stack already derives its cloud bench from the same providers. Each
  model has a product page: what it is good at, who bills, open versus closed
  weights, and on a desktop with Ollama a second path, "Pull through Ollama
  instead", which runs `kimi-k3:cloud` through the install-by-ref seam.
- **Honesty kept.** Hosted rows show for search and capability facets only;
  hardware fit, license, size, source, and on-device facets are about
  downloads and hide them. Hosted search is a substring match, not the
  catalog's subsequence fuzzy: "kimi" must not surface Haiku. Cloud wears the
  amber spend family everywhere (tile, hero, pill); teal stays local.
  `hosted.test.ts` pins the lineup, the retired-id ban, search, the facet
  rule, and the newest ordering.
- Note: Moonshot's docs and ollama.com were unreachable from the sandbox, so
  the lineup was cross-checked across OpenRouter, Ollama's announcements,
  DeepInfra, and the Kimi Code CLI docs. A console verify of the four ids
  before the next release is still the right habit.
  Gates green: os-code build; app typecheck, lint, 327 tests.

## Current state (2026-09-03, the door leaves at the speed the hand gave it)

Founder: "do all the polish," the second round, the two items captured
from the first assessment:

- **Velocity-aware drag-to-close.** On a committed drag the gesture hook
  takes the distance still on screen over the release speed, clamps it to
  `--dur-3`..`--dur-5` (read from the stylesheet), and hands it to panel and
  scrim as `--drawer-exit`; every closing keyframe runs on
  `var(--drawer-exit, var(--dur-5))`, so a tap-close keeps the unhurried
  default and a flick finishes brisk. The exit hold in App stays at
  `EXIT_MS`; a shorter animation just rests hidden a little longer.
- **The shadow fades with the scrim.** The panel's box-shadow moved to a
  `.sidebar.drawer::after` pseudo-element (absolute, inset 0, z-index -1,
  pointer-events none), which fades in with the entrance and out on the
  exit clock, opacity only. The panel itself stays solid the whole way, so
  the sliding-door read is untouched. `test/motion.test.ts` pins the seam
  and that the panel carries no shadow of its own.

## Current state (2026-09-03, drawer polish, all three tiers)

Founder: "do all the polish." Three changes around the drawer gesture:

- **A 30px edge strip** (was 22px), about iOS's own back-swipe zone, so the
  reopen swipe lands reliably now that a release is guaranteed.
- **The settle spring scales with distance.** `useDrawerGesture` reads
  `--dur-3` and `--dur-5` out of the stylesheet and picks a duration between
  them from how far the panel still has to travel, then hands it to the
  panel as `--drawer-settle`, which the CSS transition consumes. A nudge back
  is brisk, a full-width return glides; the timer that clears the inline
  position uses the same number, so JS and CSS never disagree.
- **One copy of the drawer width.** `--drawer-width: min(310px, 84vw)` in
  `:root`, registered as a `<length>` with `@property` so its computed value
  comes back in pixels; `lib/motion.ts` (`drawerWidth`, `durationMs`) reads
  it and App no longer carries its own `min(310, innerWidth * 0.84)`.
  `test/motion.test.ts` pins the registration and the readers' fallbacks.

## Current state (2026-09-03, the edge swipe no longer wedges the app)

Founder, with a screenshot: after the drawer retracted nothing was tappable,
and the app had to be quit. Root cause in the day-old gesture: a touch on
the 22px left edge made the edge zone capture the pointer and set `peek`,
and App rendered the zone only while `!gesture.peek`, so the very next
render removed it. A removed element loses its capture, the release handler
never fired, the gesture stayed armed, and the drawer stayed mounted with
its scrim at opacity 0 over the whole room, eating every tap. Any touch
near the left edge (an edge swipe to reopen, a thumb resting there) did it.
Fix: the zone is rendered under `!drawerOpen || gesture.peek`, so it
outlives the gesture it started; and both gesture surfaces bind
`onLostPointerCapture` to their release handler, so a pointer the platform
takes away still releases (the echo after a normal pointerup is a no-op).
`polish-standards.test.ts` pins both.

## Current state (2026-09-03, the drawer is a sliding door)

Founder, with a screen recording: the phone drawer retracted as a ghost, a
24px nudge while it faded to transparent. Wanted: still a slide, never a
transparent object, "just like a sliding door being moved out of the way,"
smooth. Now in `theme.css`: `drawer-out` carries the panel, fully opaque, off
the left edge (past its own shadow, so nothing lingers) on `--ease-standard`
over `--dur-5`; only the scrim fades (`drawer-scrim-out`). The entrance
(`drawer-in`) is the same door coming the other way, so in and out match.
A drag-to-close no longer jumps back to open before leaving: the gesture
hook holds the finger's position through the exit and Sidebar hands it to
the keyframes as `--drawer-x` (and the scrim's held opacity as
`--drawer-scrim`), so the door keeps going from where the hand left it.
`via-gesture` stays on through that exit so the entrance cannot replay in
the render before `closing` lands.

## Current state (2026-09-03, every connection point is a real link)

Founder, from the phone, on Repositories: the connection points should carry
actual links you can navigate in-app, the way Cloud Connections does. Built
on the same two primitives Cloud Connections already uses:

- **Token pages open in-app.** Each platform card's token form now leads with
  `Get a GitHub token ↗` (GitLab, Bitbucket likewise) via `openInAppBrowser`:
  an in-app browser sheet on the phone with the standard Done button, the
  system browser on desktop and web. The bare URL in the hint is gone; the
  Keychain line stays. Launch gets the same for Codemagic
  (`CODEMAGIC_TOKEN_URL` in `lib/codemagic.ts`, the Teams page where the API
  token lives).
- **"Menu, then Desktop + phone" is a link, not directions.** Repositories'
  lead hint offers `Open Desktop + phone` beside the walk-through, the
  "Repos also live on your desktop" card has a Connect button plus an inline
  link, and Your stack's phone hint links `Connect your desktop`. All go
  through `setView('pair')`, so the back chevron returns to where you were.
- **Polish pass, all three tiers (founder: "do all the polish").** `.linklike`
  now shares the press-fb scale in `theme.css` (declared beside press-fb, and
  killed under reduced motion with it), so every inline link answers the
  finger like any other tappable. `openInAppBrowser` marks the hop to the
  browser sheet with `hapticTick` (a silent no-op off the phone), one seam
  instead of four call sites. Cloud Connections' "your stack" link is a
  `.linklike` like the rest, not an inline-styled hint button.

## Current state (2026-09-02, New chat opens like the first launch)

Founder: after tapping New chat the composer sat under the keyboard, while
the first-launch greeting was right. Root cause: the keyboardWillShow
listener was registered per ChatScreen mount, and asynchronously. Opening a
new chat from the Chats room remounts ChatScreen; the composer's autofocus
effect runs before the parent's (child effects first) and raises the
keyboard while the listener is still registering, so the event was missed
and `--kb-inset` never applied. Fix: `hooks/useKeyboardInset.ts`, called
once in `App`, from boot; and the composer's autofocus waits one frame so
the room has laid out before the keyboard rises. The first-launch path was
never affected because it waited for the splash to lift.

## Current state (2026-09-02, quick chat is gone; the Chats room breathes)

Founder: get rid of the quick chat feature altogether. Removed end to end:
the `ephemeral` flag on Conversation, `quickChat`, `keepQuickChat`, and the
prune-on-navigate logic in the store, the "not saved, keep this chat" offer
in the chat top bar, the link in the Chats room, the dashed dot, and the
tests. Every chat now belongs to a project and persists; a persisted row
from the quick-chat era is dropped on load. The "follow their guidance" was
the Creative Studio's: their Chats spec (56px rows, 16px title, 13px
secondary, one flat list with no grouping of any kind) stands as built; a
brief detour that stretched the rows and added a gap where the day changes
was reverted the same day, since the Studio had argued against soft
grouping on purpose.

## Current state (2026-09-02, the Chats room is the Claude shape)

Founder, from the phone: the Chats room "looks a little off"; partner with
the Creative Studio and make it near identical to the Claude app. The
Studio's diagnosis: the room announced itself three times (nav title, serif
h1, lead), two big buttons and a boxed search pushed the list below the
fold, and beige cards with TODAY / THIS WEEK captions chopped a short list
into boxes. Built their spec:

- **Nav bar** keeps the menu, "Chats", and the status pill, and gains a
  compose icon (`BackBar` has an additive `action` slot now). A plain "New
  chat" first row is the second path to the same verb. Quick chat is a text
  link at the foot, "Quick chat, not saved".
- **A search pill** first in content, always present, sticky under the bar.
- **One flat list** sorted by recency, no cards, no captions: 56px rows,
  16px title, 13px `2h ago · Claude` (the source survives as the quiet half;
  never colorized), hairline separators inset to the text edge, the active
  row's 3px teal bar. `relativeTime()` (tested) does the recency job the
  date buckets used to do. Desktop sessions with no chat here sit in the
  same list with a wave dot and "Running on desktop".
- **Motion.** Rows enter on the house stagger; a deleted row leaves
  (`chat-row-out`) before it unmounts; swipe to delete and hold to rename
  are unchanged. Empty state is a serif "Nothing here yet." with one line.

## Current state (2026-09-02, the room top bar is pinned)

Founder: freeze the top header row (menu, room name, connection status)
throughout the app so it never leaves the screen. Every room places its top
bar as the first child of the scrolling `.screen`, so one rule pins them
all: `.screen > .topbar { position: sticky; top: 0 }`. The bar already had a
blurred, translucent ground and a z-index, so content scrolls under it
cleanly. Chat's bar sits outside its scroller and was already fixed.

## Current state (2026-09-02, sub-rooms have a way back)

Founder, from the phone: a room reached from inside another room (Settings,
Add to your setup, Connect your computer) had only the hamburger, so there
was no way back to Settings. Now the store keeps a `viewTrail`: a room opened
from the side panel is a root (the trail clears, the top bar shows the menu);
a room reached from inside a room pushes, and its top bar shows a back
chevron (with the previous room's name on the desktop) that returns there.
Chat is always a root. `setView(view, { root: true })` is the panel's call;
everything else pushes; `goBack()` pops. The drawer's edge swipe still opens
the panel from anywhere.

## Current state (2026-09-02, identity-linked Claude keys work)

Founder connected Claude on the phone and the first turn failed with the raw
API error: an identity-linked key (a key tied to a person, not a workspace)
now requires the `anthropic-workspace-id` header. Built the fix on every
Claude path:

- **The header.** `anthropicHeaders(key, workspaceId)` in the app
  (`lib/providers.ts`) and `anthropicAuthHeaders` in the engine
  (`auth/claude.ts`) add it when a workspace is set. The phone's cloud chat
  and the stack driver pass it as an SDK default header; the engine's
  provider sends it on every request; `ANTHROPIC_WORKSPACE_ID` is the env
  fallback there.
- **Where it is entered (founder simplified it).** Cloud Connections: the
  Anthropic card always shows a Workspace id field (`wrkspc_...`), required,
  preset to the id last saved on this device, with inline instructions to
  copy the Default workspace's id from the Console (or a different one to
  bill). No hidden link. There is no universal default id to preset: every
  org's Default workspace has its own, so the preset is the person's own
  last value. The key check still catches a rejected id before it claims
  connected. Stored in
  `settings.anthropicWorkspaceId`; the key stays in the Keychain. On the
  desktop, connecting Claude in the app now also hands the key and workspace
  to the engine (`bridge.setAnthropicKey(key, workspaceId)`), so the coding
  agent gets it too; `osc login` asks for the workspace when the API wants
  one.
- **The message.** Both drivers and the engine turn that 400 into "This key
  is linked to your identity, so Claude needs the id of the workspace it
  acts in..." with where to find it, instead of the JSON.
- **Not device-verified**; the founder's next attempt with the workspace id
  is the proof.

## Current state (2026-09-02, the composer row is quiet type)

Founder, from a screenshot: the buttons in the chat box look weird, not
premium. Four stroked chips at four widths, a `</>` glyph, a truncated
"Claude · Fa..." label. Now, in the Claude app's rhythm: everything but send
is quiet type on the field itself, no strokes or fills at rest, a soft fill
on press. The add and mic are bare glyphs; the model pill is a short name
("Claude", the repo name, "Harbor") with a small chevron; the mode pill is a
colored dot plus the mode name (teal accept-edits, blue plan, amber bypass,
grey default); Stop is a filled ink circle; Queue a soft fill. One filled
control on the row, so the eye knows where the action is.

## Current state (2026-09-02, Settings is a ledger)

Founder, from a screen recording: make Settings delightful, with the
Creative Studio partnering. The Studio diagnosed a flat pile of unlike cards
(no grouping, three button dialects, the onboarding paths pasted in as five
tall cards, the version string in the lead slot, a destructive Clear with no
confirm) and offered three directions: Tidy, The Ledger, The Manifest. Built
the recommended one, **The Ledger**, the iOS grouped-settings shape on paper.

- **Structure (founder reordered it 2026-09-02 from the phone).** Serif group
  heads over inset cards, one row per thing, the current value on the right,
  a chevron when a row opens a sheet. Groups in order: Account (always shown;
  the row opens the sign-in sheet only when accounts are configured) ·
  Privacy (one row, "Privacy and Conditions", opening one sheet with Privacy
  plainly, Encrypted on this device with the live seal, and Local models
  honestly, in that order) · This device
  (Appearance with the segmented control inline, Help improve the test build
  on a real switch, an Activity log row that appears when it is on) · Harbor
  (Web search, value DuckDuckGo or the chosen provider) · Privacy, plainly
  (one row, "Where your data lives", value Sealed or On this device, opening
  the draggable InfoSheet with the live seal on top and the three honest
  sections) · Go further (Add to your setup, a sheet of the starting paths as
  rows) · Clear conversations, in danger ink, now behind a confirm.
- **Pieces.** `components/SettingsRow.tsx` (SettingsGroup, SettingsRow),
  `components/Switch.tsx` (role switch, knob on transform, haptic tick),
  `InfoSheet` gains `renderTrigger`, `StartingPaths` gains `variant="rows"`
  (onboarding keeps the cards; one source, two renderings). The lead is now a
  sentence in the house voice; version and platform moved to the footer.
  Groups arrive staggered on the tokens; every sheet exits.
- **Not chosen, on the record.** Tidy (label the pile) was too little; The
  Manifest (settings as a readable letter with inline tappable values) was
  the boldest, and UI/UX Eng would not sign its tap targets today.
- **Not device-verified.** The recording also shows the phone still on the
  pre-panel-rearrangement build, so the next TestFlight build carries the
  panel, the parity work, and this.

## Current state (2026-09-02, Codemagic runs inside Launch, contained)

Founder: host codemagic.io as a contained entity inside the Launch section,
signed in and working as it would in a browser, but unable to browse anywhere
else. Built for the desktop app (an iframe is not an option: authenticated
dashboards refuse to be framed, and Safari's cookie rules would break the
session anyway).

- **`electron/embeddedWeb.ts`.** One `WebContentsView` on its own persistent
  cookie partition (`persist:embedded-codemagic`), so the sign-in survives
  relaunches and never mixes with the app's session. The renderer names the
  site (`'codemagic'`), never a URL; the main process owns the allow list:
  `*.codemagic.io` in full, the sign-in providers held to their sign-in paths
  (GitHub `/login`, GitLab `/oauth`, Bitbucket `/site/oauth2`, Atlassian id,
  Google accounts). `will-navigate`, `will-redirect`, and the window-open
  handler enforce it; an OAuth popup gets its own fenced child window on the
  same partition; anything outside goes to the system browser. Sandboxed, no
  preload, no Node. The Electron token is stripped from the user agent so the
  dashboard treats it as a normal Chrome.
- **`components/EmbeddedSite.tsx`.** Measures its host rectangle live
  (ResizeObserver, resize, scroll) and keeps the native view placed over it;
  a toolbar with Back, Reload, the site and path crumb (tap for home), Open
  in browser, Sign out (clears the partition), and Done; hides the view while
  the drawer is open. Launch gets a "Codemagic dashboard: Open here" card on
  the desktop only; the phone never sees it.
- **Caveat, by design.** Google refuses to complete OAuth inside any embedded
  view. A GitHub, GitLab, or Bitbucket sign-in to Codemagic works; a
  Google-backed Codemagic account will see Google's notice. Not device
  verified; the first run in the built desktop app is the proof.
- **The API-token path stays** as the substrate for triggering and following
  builds; the contained dashboard is where builds are watched and managed
  with the full Codemagic UI.

## Current state (2026-09-02, chat and projects work the way Claude Code works)

Founder: "make sure that the way chat and projects work is exactly like
Claude Code in how it builds and works with the user... top notch premium
feel for coding... do all the little things," then "Do all of the polish." An
audit against Claude Code produced a 34-item gap list; all of it is built.

**Engine (`os-code`).**

- **Four permission modes, enforced in the loop.** `PermissionMode` is
  `default | acceptEdits | plan | bypassPermissions`. `loop.ts` consults the
  mode before it asks (accept-edits lets `editFile`/`writeFile` flow, bypass
  runs everything but cloud spend and the always-ask tools); plan mode
  filters the tool specs to read and network, denies any mutating call with a
  plain reason, carries a PLAN MODE block in the system prompt, and emits
  `plan-proposed` with the turn's final text. `setMode` emits a `mode` event
  so every client sees the switch.
- **Task list.** New `todoWrite` tool (read risk); the loop mirrors it as a
  `todos` event after every tool-end and the system prompt tells the model
  when to use it.
- **Standing instructions.** `instructions.ts` reads OSCODE.md, CLAUDE.md, or
  AGENTS.md from the repo (24k cap) into the system prompt; the daemon and
  the Electron host take `instructions` and `permissionMode` at session
  create, and `POST /sessions/:id/{mode,instructions,compact}` plus
  `GET /sessions/:id/files?q=` give the person live controls. `INIT_PROMPT`
  (exported via protocol) backs `/init`.
- **Approval rules that persist.** `ApprovalAnswer.alwaysInProject` writes an
  allow rule scoped to the path's directory (or the command's first word) into
  the project's `os-code.config.json` (`addProjectPermissionRule`).
- **Resilience and identity.** Transient provider failures (429, 503,
  overloaded, ECONNRESET...) retry twice with backoff before a stop;
  `compactNow(focus)` folds the history on demand; `generateTitle()` names
  the session after the first exchange and the daemon seals it (`title`
  event); `emitRepoInfo()` reports cwd, branch, and dirty state (`repo-info`)
  before and after each run. `test/agentModes.test.ts` covers the modes, the
  events, and the retry.

**App (`app`).**

- **Transcript feel.** A working row ("Thinking", "Search /foo/ in src/\*\*",
  elapsed) fills the gap before the first token; reasoning folds to "Thought
  for 12s"; tool cards name the step the way Claude Code does ("Read src/x.ts
  (lines 1-40 of 120)", "Edit src/x.ts (+3 -1)", "$ npm test") with a live
  counter, a +N -M pill, a diff with a line gutter, and long output folded to
  head and tail; the task list pins above the composer; a plan card carries
  "Start building" (accept-edits, then the go-ahead) and "Change something";
  a changed-files card closes each task; a stopped turn offers Retry; a
  "New message" pill offers the way back down; the model chip names a
  specialist's answer. Markdown renders diff fences with the gutter and
  closes an open fence while streaming.
- **Composer.** Queue while busy (flushed on task-done, dashed bubbles in the
  thread), Esc stops or clears, Up recalls earlier messages, Shift+Tab cycles
  the mode, `/` opens the command menu (`/help /clear /compact /model /cost
/mode /init /rename`), `@` offers repo files ranked by the engine, `#` saves
  a line to the project's instructions and pushes it to the live session, a
  long paste folds into a chip, files and images drop onto the field.
- **Approvals, modes, top bar, chats.** The approval sheet counts the stack
  ("1 of 3"), offers Approve all, Always allow in this project (path-bearing
  tools on an engine session), y / a / n keys, and a mode footer. The mode
  sheet shows the four modes and switches the live session. The top bar
  carries a repo chip (folder · branch ● dirty), spend, and a context bar
  that warms at 75% and reddens at 90%; the title is tappable to rename; an
  offline banner appears when the device loses the network. The Chats room
  groups by Today / Yesterday / This week / Earlier, searches by title, names
  a chat on long press, marks a working chat with a pulse, and lists sessions
  running on the paired desktop that have no chat here yet. A reopened
  desktop chat shows a skeleton while its journal replays.
- **Wiring.** `ChatDriver` gains optional `setMode`, `setInstructions`,
  `compact`, `listFiles`; both engine drivers implement them (IPC and the
  daemon routes). Sessions are created with the project's instructions and
  the composer's mode. The engine's `title` replaces the first-line
  placeholder unless the person renamed the chat (`Conversation.renamed`). A
  stored `'auto'` mode maps to bypass on load. A completed task taps the
  success haptic.
- **Polish pass, all three tiers (founder: "Do all the polish").** The
  approval sheet orders its buttons by likelihood (once, then the project
  rule, then session-only) with the skip quieted; the plan card settles its
  border to green on `--ease-arrive` when approved; the task list folds
  itself 600ms after the last check lands (a grid-row reveal, never a height
  transition). The command menu and the file popover share one `ComposerMenu`
  whose highlight glides between rows on transform, scroll-snapped; the
  context bar's warm and hot colors settle on `--dur-5`. The resume skeleton
  takes its shape from `Conversation.lastItemCount`, saved at persist.
- **Polish, round two (founder: "keep polishing until it is not worth it").**
  Every new surface now leaves the way it arrived: the new-message pill, the
  command and file menus, and the offline banner play exits on
  `useExitPresence`; tool detail and the plan card's buttons open and close on
  a shared grid-row `.reveal` (never a height transition). A stack of
  approvals no longer bounces the sheet closed and open per question: the
  sheet stays up and the body swaps, keyed on the request. Queued bubbles
  are tappable to remove. A hold on a Chats row names the chat (the gesture
  lives in `SwipeRow` as `onLongPress`, with the tap suppressed, since
  WKWebView never raises contextmenu for a hold). `/help` writes its list
  into the transcript as a note. The mode sheet carries the Shift+Tab hint
  on a pointer device. Stopped here: what remains (a working-row crossfade
  into the first token, a dirty-dot animation) would read as fidget rather
  than calm.
- **Not device-verified.** Everything here is built in a web session and
  gated (typecheck, lint, 307 app tests, 338 engine tests, both builds). The
  first real run on the desktop app and a TestFlight build is the proof; a
  new Codemagic build is needed to see it on the phone.

## Current state (2026-09-02, the Uki motion standard applies across OpenShore)

Founder: apply the transition standards set for the Uki app across all of
OpenShore so it feels premium as you navigate. The tokens and two guard tests
already existed here; what was missing was adoption and exits.

- **One vocabulary, enforced.** 109 declarations in `app/src/theme.css`
  moved from raw `ease` / ad-hoc seconds / inline `cubic-bezier()` to the
  `--dur-*` and `--ease-*` tokens. `polish-standards.test.ts` now fails CI on
  any raw easing keyword, raw `cubic-bezier()`, or sub-second raw duration in
  a transition or animation (loops and delays of a second or more are
  allowed), on any layout-property transition (one documented exemption: the
  composer's keyboard inset), and on any JSX scrim without a `closing`
  binding.
- **Everything that animates in now animates out.** New
  `components/Sheet.tsx` owns its presence (`hooks/useExitPresence.ts`): the
  fifteen inline sheets and confirms across StackManager, Stack, Projects,
  Vault, Marketplace, Crew, and Chats were converted to it, so a parent can
  drive a sheet from plain state and it still plays its exit. InfoSheet and
  SourcePicker adopted `useSheetExit`. The drawer (the main navigation) and
  the toast ride `useExitPresence` with new `slide-out`, `fade-out`,
  `toast-out`, and `confirm-out` keyframes.
- **Asymmetric press everywhere.** `.btn`, `.icon-btn`, and `.card-disclosure`
  press on `--press-in` and release on `--press-out`; the hamburger carries
  `press-fb` and a haptic tick, since it is the main navigation.
- **Documented as a standing rule** in `CLAUDE.md` (seven rules, mirrored
  from Uki) and `docs/interaction-model.md`.
- **All three polish tiers, built.** Tier 1: rooms dissolve instead of
  hard-swapping; `useRoomGhost` clones the outgoing room's DOM into an inert
  overlay that fades and lifts away (`room-out`, --dur-3) under the incoming
  fade, a snapshot rather than a second mount so no effects re-run and a
  streaming transcript is never duplicated. Tier 2: the drawer is a physical
  object; `useDrawerGesture` gives a left-edge swipe that pulls it in 1:1,
  a leftward drag that pushes it back, release on velocity (a fast flick
  under the distance threshold commits) with asymptotic rubber-banding past
  rest, scrim opacity tied to progress, and haptics at the arm and the drop.
  Tier 3: loop durations are tokens too (`--loop-1..3`, pinned by
  `motion-tokens.test.ts`), so the vocabulary is now complete.

## Current state (2026-09-02, the side panel is the main navigation)

Founder, from the phone: the left panel is the main navigation, so it should
read as one. Changes, all in the app:

- **Sidebar regrouped.** The project card, "+ New chat", and "Quick chat" are
  gone from the panel (both live in the Chats room already; the project
  switcher is the Projects room). The day-one rooms sit at the top under the
  wordmark: Chats, Projects, Repositories, Your stack, Vault. The
  second-session rooms stay at the bottom under "More rooms", with Settings
  moved to the very end. `sidebar-nav--primary` drops the top rule and
  safe-area padding for the upper group.
- **Rooms open the panel, not chat.** The room top bar's left control is now
  the hamburger (opens the drawer) instead of a back-to-chat arrow, on the
  phone; on desktop the persistent sidebar is already beside it, so the left
  slot is empty. The duplicate menu button on the right is gone.
  `useCompact` moved to `hooks/useCompact.ts` so BackBar and App share it.

## Current state (2026-09-02, the catalog is living and breathing)

Founder: "build that, would love it to be living and breathing." The browse
list now grows on its own. Every catalog build asks Hugging Face for the
trending and the newest GGUF repos and turns the ones that clear an honesty
bar into entries, no seed edit needed:

- **`scripts/build-catalog/discover.ts`.** Two listing axes (trendingScore,
  createdAt) unioned, then one metadata read per repo (file list with sizes,
  license tag, gated flag; never weights). Bar: public, not gated, license on
  the allow-list, a single-file GGUF at a supported quant (Q4_K_M first),
  under 40 GB, no denylisted name (uncensored, nsfw, roleplay...). Category is
  a heuristic from name + tags (coder, vision, embed, r1/think, size for fast).
- **Honest by construction.** A discovered entry carries `discovery: {source,
repo, foundAt}` (new optional schema field), is never `orchestratorCapable`,
  has no ratings (the card shows a "New · unrated" pill and the existing
  not-rated row), ranks after every seed model, and publishes a conservative
  8192 context floor with a note saying so. Enrich keeps a discovered model
  as unrated instead of applying the eval/star bar, and drops it if it ever
  claims orchestrator. Presets never name a discovered model.
- **Never collapses.** The seed wins an id collision; last time's discoveries
  carry forward (with their first-seen date) and age out only when newer ones
  push them past the cap (25), so a quiet HF day never empties the shelf or
  trips the 25 percent count gate. Any discovery failure degrades to "seed
  only." `CATALOG_DISCOVER=0` turns it off; `CATALOG_OFFLINE=1` still skips it.
- **Pull path is what already ships:** `ollama pull hf.co/<repo>:<QUANT>`
  (small ones also get a phone download straight from huggingface.co, which
  the gate's host check still enforces).
- **Quality bar, tightened from the first live crop.** The first live run
  published 25 discoveries but shelved abliterated and merge variants, a
  speech model, four uploads of the same weights, and a 0.1 GB file. Now: the
  shelf is `TRUSTED_PUBLISHERS` only on both axes (the second crop under open
  trending was merges riding a lab's name; unlisted publishers are logged so
  the list grows on evidence), plus a third axis that actually fills the
  shelf: each trusted publisher's own latest uploads, read round-robin (the
  global listings held six trusted repos in eighty). Cap 40, metadata reads
  bounded per build. A quantizer's upload must also name a known lab family
  (bartowski and unsloth convert community models too); speech, reranker,
  guardrail-classifier, and translation-only uploads are denylisted; dated
  versions of one model (Magistral-Small-2506/2507/2509) collapse to the
  newest. The fifth live crop (run 18) shelved 37 lab models, clean. Trending needs 100+ downloads, carried entries
  re-clear today's bar, one entry per underlying model (`baseKey` collapses
  quantizer and imatrix twins), 0.3 GB floor, denylist covers every
  guardrail-removal spelling seen plus speech.
- **Publish step fixed.** The last three catalog runs (two scheduled) failed
  at the push: the marketing repo's default branch is a feature branch, so the
  shallow clone landed the catalog there. The clone is now `--branch main`
  and the retry rebases onto FETCH_HEAD. Founder: set that repo's default
  branch back to main.
- **Cadence is now daily** (`catalog.yml` cron `17 8 * * *`); the no-op stamp
  guard keeps an unchanged day from committing.
  `test/catalog.builder.discover.test.ts` (12 tests, fixtures only). Gates
  green: os-code build, typecheck, lint, 323 tests; app typecheck, lint, 296
  tests; offline `build:catalog` still writes 27 models, 4 presets.

## Current state (2026-09-02, the desktop coding path works)

**Founder ask: "every feature fully functioning so I can start coding on
OpenShore."** This pass made the desktop (Pop!\_OS) path real and proved it as
far as a headless session can, all on `main`:

- **`pnpm install` now actually builds the natives.** pnpm 10 skips every
  dependency build script unless allowlisted, so a fresh clone had NO Electron
  binary and NO node-pty, and `pnpm desktop` would have died on first run.
  Root `package.json` now carries `pnpm.onlyBuiltDependencies` (electron,
  node-pty, esbuild, electron-winstaller). The app's `postinstall` runs
  `electron-rebuild` for node-pty so the desktop terminal loads inside
  Electron's ABI (`rebuild:native` re-runs it). Note the inherent split: a
  node-pty built for Electron serves the desktop app and its in-app daemon;
  the `osc` CLI (system Node) then reports its terminal as not installed,
  honestly, via TerminalUnavailable.
- **The real Electron shell boots headless** (`OSC_SMOKE=1` under xvfb: `page
loaded; window.oscode is object`) on today's full build, with the Electron
  zip side-loaded into `@electron/get`'s cache (the sandbox proxy cut Node's
  fetch; curl through the proxy worked, checksum verified). electronjs.org
  (Electron headers) is blocked by org policy here, so the Electron-ABI
  node-pty rebuild could not be verified in this sandbox; it runs on the
  founder's machine at install.
- **First-run wall removed.** A fresh desktop with no model configured used to
  throw the engine's CLI wording ("run osc init") when a folder was opened, and
  still created a dead chat. Now: the store caches the engine status
  (`desktopStatus`, refreshed on init and after Stack changes); `sourceReady`
  on Electron means "an orchestrator is configured"; Repositories routes to
  Your stack with a plain toast when none is; the desktop error text is
  app-appropriate. The desktop empty chat now defaults to the engine on this
  machine (`{kind:'desktop'}`), and the model sheet has a top "This computer"
  row (engine model, or "No model set up yet. Build your stack").
- **Hermetic engine-host test** (`app/test/engineHost.test.ts`, temp
  OSC_HOME, no Electron): fresh install reports unconfigured and refuses a
  session; with a model configured a session opens for a folder; with Ollama
  unreachable a message ends in an honest task-done error, never a hang or a
  fabricated answer. The daemon test now injects a no-pty TerminalManager
  (additive `terminals` option on startDaemon) so the 503 path is reproducible
  on machines that DO have node-pty built.
- **Polish and hardening from the P0 list:** a global sheet focus trap
  (`useSheetFocusTrap`, wired in App, guarded by test); "Keep this chat" in
  the header of a quick chat once it has three user turns; deep links matched
  by exact scheme+host (no substring routing); auth callbacks bound to the
  email the app sent the link to and refused when the token yields no user
  (the CSRF binding a custom oscode:// scheme cannot get from a browser
  origin); pure-web `?checkout=success` reconciles entitlement on boot.
  Gates green: app typecheck/lint, app 275 tests (46 files), os-code 302 tests.

**Same day, second batch (founder: "keep it moving"):**

- **QR pairing on the phone, no native plugin.** `QrScanner` uses
  getUserMedia plus jsQR on a canvas (pure web, so nothing new to compile for
  the iOS build), decodes the desktop's `{u, t}` payload, fills both fields,
  and connects in one motion; a foreign QR is reported, never half-applied.
  `NSCameraUsageDescription` added to Info.plist. The decode path is proven
  in Node: `qrDecode.test.ts` encodes the real payload with `qrcode`,
  rasterizes it like a camera frame, and decodes it back. Camera behavior on
  a real iPhone is still a TestFlight verify.
- **One-tap starter model on desktop** (CFO ruling): with no local models,
  the Stack's "Who runs the show?" sheet offers "Get the starter model (Qwen
  2.5 Coder 7B, 4.7 GB)", which pulls it through the engine with progress and
  makes it the orchestrator. `starterModel.test.ts` pins the id and Ollama
  ref against `os-code/catalog.sample.json` so a catalog rename cannot orphan
  the button.
- **Display preflight.** `pnpm desktop` now prints what is wrong and the exact
  `DISPLAY=:N XAUTHORITY=...` launch line when run from a shell with no
  display (the founder hit this over SSH; the live display was `:1`).
  Gates green: app typecheck/lint, app 279 tests (48 files).

**Third batch (founder: bundles, guided setup, "make the whole app work the
way I work with Claude Code"):**

- **Stack bundles in the Marketplace.** Five one-tap profiles, each showing
  its total download summed from the live catalog: Pocket (iPhone, on-device),
  Starter, Coding, Creative, Performance (desktop via Ollama; Starter, Coding,
  and Performance mirror the engine's own `osc init` presets). Install pulls
  each model through the existing install channel and progress UI, then sets
  the orchestrator and specialists (phone: sets the on-device Reasoning LLM).
  `app/src/lib/bundles.ts`; `bundles.test.ts` pins every id, platform, role
  category, and size against `catalog.sample.json`.
- **Walk me through it.** Every setup surface (Cloud Connections, Desktop +
  phone, Tailscale, Your stack, Repositories, Launch) has a button that opens
  a chat seeded with the guide: the goal, the numbered plan, one step at a
  time, how you know it worked. Steps are written, not generated, so they are
  right on a small model; the model answers questions between steps. Runs on
  whatever brain can answer here (this computer's engine, a Claude key, or
  Harbor Mini, downloaded on the spot). `newConversation` gained an additive
  `seedItems`/`title` option so seeded turns render and enter the model's
  history. `app/src/lib/setupGuides.ts`; Harbor's knowledge base learned both
  features and the working loop.
- **The interaction model, written down.** `docs/interaction-model.md`: the
  eight tenets of how the founder works with a coding agent (goal, plan,
  forks as pickers, one step at a time when the person acts, every change
  shown before it lands, verify then report plainly, honest states, keep it
  moving), and the checklist every new surface is held to.
  Gates green: app typecheck/lint, app 285 tests (50 files).

**Fourth batch (founder: "CLAUDE.md, PROGRESS.md, and my advisor team are
how I want OpenShore oriented to serve the user"):**

- **The advisor team ships as a Crew preset.** My Crew gains "Add the advisor
  team": eight named perspectives written to OpenShore from the canonical
  charters (CTO reviews every build; CMO, CFO, and Creative Studio
  auto-engage; CX, Chief of Staff, Board, and Corporate Strategist by
  request), each advisory, the person decides. Adds only missing members, so
  the tap is safe to repeat. `app/src/lib/crewPresets.ts`, pinned by test
  for shape and org structure.
- **The interaction model is grounded in its sources.**
  `docs/interaction-model.md` now maps every tenet to the standing rule it
  came from (one command at a time, the sign-off gate, foundations
  additive, the communication format, no em dashes, PROGRESS as source of
  truth, advisory and the founder decides, the motion and polish bar).
- **The engine's own agent now speaks the same way.** The coding agent's
  system prompt (`loop.ts`) and the phone-to-desktop chat prompt
  (`serve.ts`) gained the working loop additively: lead with the outcome,
  one step at a time when the person must act, never claim an unverified
  result, name the blast radius before touching something working, end on
  the next step. Harbor's knowledge base learned the advisor team.
- **Tenet 9, copy blocks (founder: "it's highly efficient").** Anything the
  person must paste (a command, a query, a config line) is its own fenced
  code block, one per step, nothing else in it, and the chat renders every
  block with one-tap Copy (already there, now honest on failure via a new
  clipboard helper with a textarea fallback). The rule is in all seven model
  prompts (stack, Claude, on-device, Harbor, Harbor Mini, the engine agent,
  the desktop chat) and in Harbor's knowledge; setup guides carry a `paste`
  per step that renders as a fence. `copyBlocks.test.ts` pins all of it.
- **Tenet 10, premium UX out of the box (founder: "everything that's
  created is premium unless rerouted").** The twenty laws of UX plus the
  house bar (calm motion, every state designed, honest copy, accessible)
  are written as build instructions in `uxStandard.ts` and injected into the
  coding agent's system prompt by default. Reroute on purpose only: a
  project sets `ux.standard: "off"` or adds `ux.notes` in
  `os-code.config.json`, or the person says "skip the UX standard".
  Exported through `os-code/protocol` so the app's coding specialist shares
  it. `uxStandard.test.ts` reads the system message a real session sent:
  on by default, off in config, notes ride along. Standing rule added to
  `CLAUDE.md`; Harbor knows it.

## Current state (2026-09-02, prefab stacks in My Stack + self-refresh)

Founder: the marketplace should stay current from live sources with no manual
intervention, and My Stack should offer downloadable prefab stacks that
constantly reassess as models change. Most of the plumbing already existed and
is now surfaced and closed out:

- **Already there:** the catalog is fetched from a live feed with a 24h cache
  and stale/bundled fallback (`market/catalog.ts`), and the build-catalog CI
  already runs on a schedule (`catalog.yml` cron, twice weekly) plus on push,
  re-fetching HF metadata and re-ranking. So the marketplace already refreshes
  itself.
- **Prefab stacks in My Stack (new).** StackScreen reads the catalog's presets
  and shows them as one-tap "Download this stack" cards (total size, VRAM
  hint), so a person fills their whole stack without opening the Marketplace.
  Because presets ride the live feed, they refresh on their own.
  `app/src/lib/presets.ts` (pure helpers) + `app/test/presets.test.ts`.
- **Presets reassess themselves (new).** The builder now DERIVES presets from
  the current model set and eval scores (`build-catalog/presets.ts`): a pocket
  stack for the phone, a starter, a coding stack with embedding + fast
  specialists, and a performance stack led by the highest-scoring coder. So the
  prefab stacks track what is available with no hand-authoring; the regression
  gate validates, and it falls back to the seed's presets if derivation is
  empty. `test/catalog.builder.presets.test.ts`.
- **Live discovery:** BUILT in the next entry up (`discover.ts`).
  Gates green: os-code build, typecheck, lint, 312 tests; app typecheck, lint,
  296 tests.

## Current state (2026-09-02, marketplace is open-ended + Kimi)

Founder: "why aren't there any Kimi models, can we expand past Hugging Face to
have all SOTA new models." Two things were true and one was a misread:

- The marketplace was never Hugging-Face-only. Desktop models come from Ollama
  (`ollama pull`), phone models from HF GGUF; HF is used only to fetch
  popularity metadata (`build-catalog/sources.ts`). The catalog itself is a
  hand-curated editorial seed (`catalog.sample.json`) frozen in the Qwen2.5
  era, which is the real reason newer models are absent.
- Fixes landed on `main`:
  - **Install by name (the durable answer to "all SOTA").** New engine seam
    `installOllamaRef(ref)` (install.ts) plus a bridge method and a desktop
    Marketplace card: type any Ollama library name (qwen3-coder:30b,
    gemma3:12b, ...) and pull it, so the newest models are installable the day
    they land, no catalog update needed. A bad name returns Ollama's own error,
    never a fabricated success. Pinned in install.test.ts.
  - **Kimi as a cloud provider.** Kimi K2 is a ~1T-param MoE that does not run
    locally, so Moonshot is added as an OpenAI-compatible BYOK provider
    (providers.ts) alongside Claude/OpenAI/Gemini; key validation and the stack
    router treat it like the others. moonshotProvider.test.ts pins it. Model
    ids follow Moonshot's current API and want a console verify before release.
- Still open (offered, not done): a refresh of the browsable curated seed with
  current local SOTA (Qwen3, DeepSeek latest, GLM, Devstral, Gemma 3, Llama
  3.3). Held back deliberately: the seed is also the app's offline fallback, so
  an unverified ref or size there is a dead button. The right path is editing
  `catalog.sample.json` then running `build:catalog` (needs network) so refs
  resolve and real sizes and popularity are filled; "Install by name" covers
  the gap meanwhile.
  Gates green: os-code build, typecheck, lint; app typecheck, lint.

## Current state (2026-08-31, P0 beta remediation)

**Full P0 beta audit + first four remediation phases landed on the feature
branch `claude/openshore-audit-p0-roadmap-o1e3vj` (NOT main).** A four-track
audit of the sign-in, pay, and start-building journey is written up in
`AUDIT-P0-BETA-ROADMAP.md`; the founder-facing config/verification checklist
is `AUDIT-P0-ACTION-ITEMS.md`. What was built (all gate-green: workspace
lint/typecheck, os-code 302 tests, app 268 tests):

- **Phase 0, truthfulness + money path.** The web/desktop llama fallback no
  longer fabricates a "(demo)" answer: it reports the device unsupported,
  fails load with a real message, and refuses to generate. A shared stack
  readiness definition (`stackReady`/`refReady` in `app/src/lib/stack.ts`)
  gates the empty-state composer, so a first message opens a guided model
  chooser instead of dead-ending. Entitlement now re-checks on app foreground
  and polls after Stripe checkout; a new `checkout-return` edge function
  deep-links back into the app over `oscode://checkout-success`, and the
  Electron `oscode://` protocol handler is wired (the old 127.0.0.1:4817
  redirect had no listener). Auth dead ends closed: sign-up confirmation
  redirect, forgot-password (recover + set-new-password), resend confirmation.
- **Phase 1, honest first-answer paths + calmer nav.** Sidebar trimmed to a
  primary five (Chats, Projects, Repositories, Your stack, Settings) with the
  rest under "More rooms" (CMO). BYOK reframed as the free on-ramp (CMO copy);
  desktop free onboarding no longer dead-ends at the Marketplace paywall (CFO:
  Marketplace stays Personal). Provider keys are validated before "connected".
  Inert Dropbox/Proton storage rows collapsed to one "arriving" line.
- **Phase 2, distribution config.** Codemagic gates on the test suite before
  TestFlight; mac/win electron-builder targets added (unsigned closed beta, no
  auto-update yet, per CTO); `oscode://` registered.
- **Phases 3-4, honesty + money-safety.** Phone Repos says tokens activate
  after pairing; terminal shows a Connecting state; a drift test fails the
  build if the commercial seat bands in `plans.ts` and the server
  `entitlement.ts` diverge.

Advisor rulings that shaped the forks are recorded in the action-items doc
(CFO: BYOK-only fallback, one free starter model; CMO: primary nav + BYOK
framing; CTO: checkout-return host, unsigned desktop beta, keep Tailscale-only
bind). Remaining P0 work is founder config + on-device verification + a few
native items (QR pairing, low-storage preflight, first-repo desktop golden
path), all listed in `AUDIT-P0-ACTION-ITEMS.md`.

**Follow-up (2026-08-31): Personal is Apple-only.** Founder call: the $20/yr
Personal tier is bought ONLY as the Apple auto-renewable subscription in the
app on iPhone/iPad. There is no Stripe purchase for Personal. On web/desktop
the paywall points the user to buy on their iPhone, then "I bought it"
(restorePurchases -> refreshEntitlement) unlocks the same account there, since
the entitlement is one server row read on every device. `buyPersonal` no longer
opens Stripe on web/desktop; `Paywall` shows no web price/button. Stripe stays
ONLY for commercial team plans (seat-based SaaS, which Apple forbids in-app).
The public pricing page's Stripe "Get Personal" button still needs to change to
an App Store call to action (marketing repo, tracked in the action items). This
supersedes the earlier "Apple IAP on iOS and Stripe on web/desktop" framing for
Personal specifically. On `main`.

**Follow-up (2026-08-31): all Personal pay gates OFF for the beta.** Founder
call: run the beta with no paywall. The coding agent and the Marketplace are
free for everyone right now. Implemented as one reversible switch,
`PAY_GATES_ENABLED = false` in `store.ts`, which short-circuits
`personalUnlockedNow()` to true, so every gate (coding-source `newConversation`,
`setView('marketplace')`, the sidebar lock pill, the paywall triggers) is off
from one place. Flip it back to `true` to re-enable the $20 Personal gate; no
other change needed, and the Apple purchase/link/entitlement plumbing stays
built and ready underneath. Commercial team-seat billing
(`growthGatedByBilling`) is a separate gate and is unchanged. On `main`.

## Current state (2026-08-27, greeting)

**Long-press language reveal added to the greeting line.** A second, quieter
Easter egg alongside the existing tap-to-rotate: holding the greeting line
down for 450ms now pops a small pill bubble above it naming the language's
English name (e.g. "Hungarian"), fires a light haptic tick, and fades the
bubble out again after 1.4s or on release. A `longPressFired` ref suppresses
that gesture's own click so it never also triggers the tap-to-rotate. Bubble
styling rides the existing motion tokens (`--ease-spring`/`--ease-standard`,
`--dur-3`/`--dur-4`) and the base UI font rather than the greeting's display
serif; relies on the global `prefers-reduced-motion` reset rather than a
separate override, since it is a plain transition, not a keyframed animation.
Code in `app/src/screens/ChatScreen.tsx` and `.greeting-lang-bubble` in
`app/src/theme.css`.
Gates green: 41 files / 258 tests, typecheck (app + electron), lint
--max-warnings 0, Prettier clean. Pushed straight to `main` (fast-forward,
commit `9291d76`), which fires deploy.yml. Not device-verified.

## Current state (2026-08-26, keyboard)

**Greeting-anchoring saga closed out: stopped WKWebView from scrolling the
page for the keyboard, instead of continuing to chase it from the web layer.**
The empty-chat greeting kept moving whenever the keyboard opened or retracted,
across many rounds of founder-tested-on-device fixes this session: a
`--kb-inset` threshold, that threshold plus a settle debounce, watching the
composer's own position, a static pixel-measured height with no JS at all, and
finally `position: fixed` with a `translateY(visualViewport.offsetTop)`
compensation for the classic WebKit "fixed elements drift during a scroll"
bug (commit `3676c21`). Each still let the greeting move on the founder's
actual device in some new way (most recently: header scrolling fully
off-screen and the greeting overlapping the composer). The real cause was
never in the web layer: WKWebView itself was performing a genuine native
scroll to keep the focused composer above the keyboard, which no
`visualViewport`-based trick can fully out-guess.

- Installed `@capacitor/keyboard` and set `resize: 'none'` in
  `capacitor.config.ts`, which stops WKWebView from resizing or scrolling the
  page at all when the keyboard shows. With nothing left to drag it, the
  greeting's existing `position: fixed` + static pixel-measured height (see
  `.greeting`'s touch rule in `app/src/theme.css`) simply holds, with zero JS
  involvement, for both keyboard states.
- The composer's gap above the keyboard (`--kb-inset`, in `ChatScreen.tsx`)
  and `App.tsx`'s "recenter a focused field the keyboard is covering" effect
  (for non-composer inputs elsewhere in the app) both used to read
  `visualViewport`, which no longer shrinks under `resize: none`. Both now
  read the real keyboard height directly from the plugin's
  `keyboardWillShow`/`keyboardWillHide` events instead.
  Gates green: 41 files / 258 tests, typecheck, lint --max-warnings 0, Prettier,
  vite build, `npx cap sync ios` (confirms the plugin registers and
  `resize: 'none'` lands in the native config). Pushed straight to `main`
  (fast-forward, commit `c0d5a9f`). **Founder-confirmed on device: the greeting
  holds its spot through both keyboard states.** This closes out the saga; the
  greeting's positioning is locked in and should not be revisited without a new
  founder ask.

**Follow-on polish, same day:** the composer's padding-bottom jump when
`kb-open` toggled had no transition, so it snapped to its final position the
instant `keyboardWillShow` reported a height instead of riding up with the
keyboard's own slide. Added a `transition: padding-bottom var(--dur-4)
var(--ease-standard)` on `.composer-wrap` (touch only, killed under
`prefers-reduced-motion`), matching the keyboard's own animation duration.
Positioning math untouched, only how the change between states plays out.
Gates green (same suite), pushed straight to `main` (fast-forward, commit
`14072c7`). Not yet device-verified.

**Second follow-on, same day:** founder caught the mark itself moving too,
on languages whose greeting wraps to two lines at phone width (English
mostly does not, several others do). The column is flex-end anchored from
its bottom, so a second line grew the stack and dragged the mark and first
line up with it. Capped `.greeting-line`'s own box to exactly one line
(`1lh`, with an `em` fallback for pre-16.4 iOS, plus `min-height: 0` to
defeat flexbox's automatic content-based minimum size), so a second line now
spills below the capped box instead of pushing anything above it. Gates
green (same suite), compiled output checked for the rule, pushed straight to
`main` (fast-forward, commit `84a5cfa`). Not yet device-verified.

## Current state (2026-08-26, greeting)

**Empty-state greeting reworked, composer moved back to the bottom, plus a
polish pass.** Two founder-requested changes to the chat splash, then a polish
follow-on, all on main.

- **Composer back at the bottom.** The earlier keyboard-steady work pinned the
  greeting out of flow (position: fixed on pointer: coarse) so the keyboard
  could not drag it, which left the composer with nothing to push it down and it
  floated up under the header. Anchored it with margin-top: auto scoped to
  pointer: coarse, the spot it holds once a transcript is open. Desktop is
  unchanged (the flex:1 greeting already keeps it at the foot of the column).
- **English lands, tap rotates languages.** English is now the landing line on
  every startup and every return to the empty state, instead of a random
  language. Tapping the line rotates on through the languages (replacing the old
  tap-to-translate toggle), in an order freshly shuffled each time we reach the
  empty state so the sequence past English differs on every launch. Expanded the
  set from 18 to 53 languages. `buildRotation()` puts English first, then a
  Fisher-Yates shuffle of the rest; the English translation rides along as the
  accessible label so a screen reader still announces the meaning of a
  non-English line. Code in `app/src/lib/greeting.ts` (ENGLISH_GREETING,
  GREETINGS, buildRotation) and `app/src/screens/ChatScreen.tsx`.
- **Polish.** The language swap crossfades (outgoing word lifts up and fades,
  incoming rises in beneath it, sharing one inline-grid cell so neither reflows
  the centered line; the exiting layer drops itself on animationend). A single
  slow one-time discovery nudge a beat after landing hints the line is tappable
  without breaking the Easter-egg quiet, riding translateY not scale so it never
  fights the press-fb press. A light haptic tick fires on each rotate through
  the haptics bus (silent no-op off device). Reduced motion is honored: the
  incoming word appears instantly, but the exiting layer stays on the global
  reset rather than animation:none so its animationend still fires and layers
  never pile up.
  Gates green: app 41 files / 247 tests (em-dash, motion-tokens, and
  polish-standards fill-mode guards included), typecheck (app + electron), lint
  --max-warnings 0, Prettier clean. Straight to main (fast-forward, commits
  `fbffc50` then `a6b44aa`), which fires deploy.yml. Not device-verified (no iOS
  here); founder to confirm the bottom composer, tap-to-rotate, and the swap
  crossfade on device.

## Current state (2026-08-26, later)

**Your model, on your machine, from your phone (the daemon path, celebrated).**
Founder call: rather than build phone-side BYOM streaming (R-16, which makes
the phone run the loop and fights iOS suspension), deliver the same vision the
durable way, on the already-built desktop-daemon path where the box runs the
loop and the phone is the remote control. Two pieces landed:

- The model sheet now shows a "My computer" group on the phone: it reads the
  paired box's stack (daemonStack / the /stack endpoint) and, picking it,
  starts a box-run session over the daemon (RemoteDriver), so the model runs on
  the machine and a long answer keeps going when the app is backgrounded. States
  cover not-paired ("Connect your computer" to pairing), unreachable
  ("Reconnect"), and no-model-configured. A box model can be any provider the
  box config names, including an OpenAI-compatible BYOM endpoint the box reaches
  (the engine's provider schema already expresses this, so no engine change was
  needed).
- Pairing is now the celebrated first-run path: the onboarding "Connect your
  computer" card is primary and framed around the value prop (your machine does
  the work, nothing drains the phone, nothing gets cut off on background), and
  the PairScreen lead matches. Daemon tests added for the box-run path (the
  /stack report and a no-cwd box-run session). R-16 stays the narrow escape
  hatch for bare hosted endpoints with no daemon, still deferred.
  Gates (on the merged tree, after rebasing onto the parallel review-remediation
  pass already on main): os-code 34 files / 276 tests, app 39 files / 226 tests,
  lint/typecheck clean, vite build passes.

## Current state (2026-08-26)

**Chat-surface refinements + a polish pass landed on main.** Four
founder-requested changes to the chat surfaces, then a polish follow-on. The
menu (hamburger) is a drawn, fuller-weight glyph on a larger tap target; the
empty-state greeting is anchored just above the composer (Claude-style) so the
keyboard lifts it with the composer instead of shoving it into the status bar; a
freshly downloaded guide (Harbor or Harbor Mini) is promoted to the stack's
Reasoning anchor, with an init reconcile that heals a seeded-but-absent Mini
anchor, so "My Stack" chat starts right away; and chat history moved out of the
drawer into a new Chats room reached from a nav button. Polish: capped
easeOutQuint row stagger, an opacity-only room cross-fade (keyed on the view so
a live transcript never remounts mid-stream), a menu-glyph press spring, and
grouped flat rows that swipe left to delete behind a confirm. Gates green: app
37 files / 209 tests, typecheck (app + electron), lint --max-warnings 0, vite
build, em-dash, and the polish-standards fill-mode rule (animations use
`backwards`, never `both`). Not device-verified (no iOS here); founder confirms
the keyboard-anchored greeting and swipe-delete on device.

**Review close-out: dark-mode audit + remaining polish and vault follow-ups.**
The deferred items from the remediation are now done: the dark theme's
elevation shadows are tokenized to flip to a black base on dark (syntax tints,
accents, and status colors were already token-driven, so they flip too); the
Tier 2/3 UI polish landed (download progress animates a transform not width,
small icon buttons get ~44pt hit areas, landscape safe-area insets,
room-change fade-and-rise on screen navigation, Escape-closes-sheets, toast
role=status, press feedback broadened to the primary navigation and vault
rows); and the vault got a body cache so backlink derivation re-reads only
changed files (R-8) plus an export that clears stale files and reports a real
device error distinctly (R-13). BYOM/OpenAI-compatible on-device streaming
(R-16) is the one item left deferred: it needs new native plumbing (an
Electron IPC streaming channel and an iOS URLSession SSE bridge) that cannot
be verified in a headless web session, so it stays a scoped follow-up rather
than ship untested native code. Gates green: os-code 30 files / 238 tests,
app 37 files / 210 tests, lint/typecheck clean, vite build passes.

## Current state (2026-08-25)

**Local-first review remediation landed (7 waves).** A full review
(`CODE-REVIEW-LOCAL-FIRST.md`) covering the Vault, gitOS, the driver/model
stack, and the UI against the Uki polish bar was addressed end to end:
Vault data-loss holes (autosave flush, offline save error surfacing with
draft rescue, iCloud placeholder clobber, path jail), the dead wikilink
renderer, mid-chat switch reseed and rollback, driver abort and stack
degradation, the daemon outbox path allowlist, the Drive sync data-loss
cluster (index merge with tombstones, conflict copies, dup-root and delete
fallthrough) behind a new mock-transport harness, the motion-token vocabulary
and two enforcement tests, the sheet-exit sweep, chat autoscroll, warm dark
mode, and the single-writer lease wiring. Gates green: os-code 30 files / 238
tests, app 37 files / 209 tests, `pnpm -r lint`/`typecheck` clean, `vite
build` passes. Founder decision points were resolved by the advisors (CTO on
the outbox gating, lease, and daemon allowlist; Creative Studio on warm dark
mode). Follow-ups captured below.

## Current state (2026-08-20)

**All planned layers are built, tested, polished, and green.** `pnpm install
&& pnpm build` compiles clean; `pnpm typecheck`, `pnpm lint --max-warnings 0`,
and the test suites (os-code 28 files / 222 tests, app 16 files / 90 tests,
plus a passing `vite build`) all pass, both locally and in CI on every push to
`main`. Live commercial platform is wired:
Supabase sign-in, org write-through, and web-only Stripe billing (Apple 3.1.1
compliant, no in-app purchase). Two dashboards shipped this cycle: a rich
Marketplace storefront fed by a CI catalog builder, and Stack Health, a fully
local read of how the stack is being used. The public product page lives at
openshore.ai/os-code (a scoped "Nightshore" dark theme), linked from Products,
not the landing. The CLI runs end to end:
`osc doctor` renders the full health report on a bare machine, and the
complete task path (read, web search, edit with approval and diff, run a
command, commit) passes against the mock provider in `test/endToEnd.test.ts`.
Proven live over real HTTP against a scripted Ollama-protocol server: `osc
run` streams and exits clean, and the daemon serves token-authed sessions with
full SSE replay. On a machine with Ollama, the same path runs against a real
local model with `osc init` then `osc`.

Layer status:

- **Core (agent loop, tools, web, edit engine, local provider, TUI):** built
  and tested. Streaming Ink TUI with static-scrollback transcript, status
  line, approval prompts with diffs, citations panel, slash commands, and a
  considered `--plain` fallback.
- **Security:** enforced, not deferred. Jail, redaction, egress policy,
  daemon bearer auth with a hard no-`0.0.0.0` bind rule, default-deny shell,
  stricter phone/headless profiles, and guardrails that actually halt.
- **Breadth:** router/stack with graceful degradation, cloud escalation with
  confirm-before-spend, RAG (embedding index + keyword fallback) and code
  map, marketplace catalog with hardware fit ratings and preset stacks,
  daemon + reattach + pairing wizard, vision ingest inbox.
- **Polish (delight pass):** streaming smoother (bursty local token streams
  read as calm typing, `tui/smoothing.ts`); a model-load ticker that names
  GPU warmup time instead of a silent hang (`statusLine.busyNote`);
  syntax-tinted diffs at the approval moment (warm strings, teal keywords, dim
  comments, `tui/syntax.ts` + `DiffLine`); a blinking input cursor and a
  pressed-state flash on approval keys; a real byte-level download progress bar
  driven by the Ollama `/api/pull` stream (with a CLI fallback); a low-color
  terminal fallback that downsamples truecolor to xterm-256 or ANSI-16 by
  detected depth (`theme.colorDepth`/`fgSequence`); and a `/find` transcript
  search in both the TUI and plain renderers. All covered by
  `test/polish.test.ts`.

## What remains (known follow-ups, none blocking)

- [x] **Terminal Control: the approval-handler assembly is pinned by tests.**
      Extracted to the pure `decideDesktopShellApproval` in
      `app/src/lib/terminalControl.ts` with tests for approve / deny / passthrough
      and the member case (2026-09-04).
- [x] **Terminal Control OFF semantics, founder call: stricter OFF shipped.** Off
      keeps the model out of the terminal entirely and sends the person to the
      switch; it no longer asks per command (2026-09-04).
- [x] **Terminal: a desktop drives a remote hub, and multi-hub.** Both built
      (2026-09-04): `preferRemoteHub` in `buildDriver`, `settings.daemons` with
      the active one mirrored into `settings.daemon`, and PairScreen management.
- [x] **Project memory: read-only view in the app (DONE, cross-platform).** The
      founder chose full cross-platform. Built: a desktop read-only repo bridge
      (`repoReadDir`/`repoReadFile`, jailed to the repo root), a read-only GitHub
      contents client (`app/src/lib/github.ts`) for iOS and clone-less devices,
      the source chooser (`app/src/lib/projectMemoryRead.ts`), and the
      `ProjectMemoryScreen` reached from a "Coding projects" list in the Vault.
- [ ] **Project memory: a "note updated" nudge (P3, optional).** The
      `projectMemoryWrite` tool lands silently by design, and `mode: 'replace'`
      can overwrite a note the person hand-edited. The full diff is emitted on
      tool-end (visible in the transcript), so it is not truly silent, but a
      lightweight "memory note updated" toast would let a person notice when the
      agent rewrote something they touched. CTO-suggested, accepted as a
      non-blocking nicety (2026-09-04).

- [x] **Community reviews: LIVE.** The backend was validated against a real
      Postgres (0011 + 0012 + 0013 apply clean; anon reads visible rows,
      per-reader block, single/batched/snapshot aggregate RPCs, one-per-user
      upsert, the report auto-hide trigger at 3, and the moderator guard all
      exercised), which caught and fixed two bugs that would have 403'd in
      production: missing table grants, and the block subquery in the read policy
      locking anon out of every review (now a SECURITY DEFINER `author_blocked`
      helper). All founder steps are done: `supabase db push` applied 0011/0012/
      0013; a build shipped with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set,
      installed and signed in; the founder is seeded into `review_moderators`
      (`founder@openshore.ai`), so the Admin queue is reachable. The scale-path
      snapshot is turned on and verified (see the 2026-09-04 entry).
      `first_successful_run` (per model, via logOnce) fires so the activation
      funnel can be measured later. Still deferred, non-blocking: sybil hardening
      (account-age weighting or an installed-signal gate) if astroturfing
      appears, since "any signed-in user may review" leans on one-per-user +
      report/block + auto-hide + the count-gated average.
- [ ] **Large-model iCloud home, TestFlight validation + the CTO caveat.** The
      "download to iCloud" path (ModelStore places the GGUF in the app's iCloud
      Drive container, ensureLocal materializes it before a load) is unverifiable
      in a web session, so first TestFlight download-to-iCloud, evict, and
      draw-back-when-online is the proof. The CTO's HIGH caveat, held for the
      native pass and the founder's "iCloud, made honest" call: multi-GB
      re-downloadable GGUFs in an iCloud container brush against Apple's data
      storage guidelines (regenerable content), and the free 5 GB iCloud tier
      means most single models push the user toward paid iCloud. Mitigations in
      place: the device home stays backup-excluded, and the UI states plainly the
      iCloud copy uses the user's iCloud storage. Revisit whether the concrete
      backend should stay iCloud Drive vs. an on-device eviction cache if Review
      pushes back; the JS seam (`target: 'device'|'icloud'`) survives either way.
- [ ] **BYOM on-device streaming (R-16), still deferred:** true streaming and
      cancel for BYOM/OpenAI-compatible endpoints on iOS and Electron
      (buffer-then-dump today). Needs an Electron IPC streaming channel and an
      iOS URLSession SSE bridge, both native and unverifiable in a web session.
      The full press-fb adoption sweep across every remaining chip/row, and a
      focus-trap on sheets, are the last cosmetic bits of the UI polish (Escape,
      dialog roles, and primary-navigation press feedback already landed).
- [ ] **Repositories offload: wire the producer + homePath picker** to flip
      `REPO_OUTBOX_ENABLED` on (its own scoped feature, per CTO FD-1). Also
      PAR-3: platform-remote (GitHub/GitLab) home repos have no push path yet.
- [ ] **Claude Code parity roadmap (Part 5a)**, remaining after the
      2026-09-02 parity build (modes, plan mode, todos, instructions, slash
      and @ and #, queue, approvals stack, repo chip, chats grouping all
      DONE): MCP-stdio on the engine; checkpoints/rewind;
      replace the stack regex classifier with a Harbor Mini classification call;
      vision beyond Claude; a phone-side read-only tool slice for the pure-chat
      case. (Making desktop pairing the celebrated first-run path, and routing a
      box-hosted BYOM model through the daemon, are DONE.)
- [ ] **Founder config before Drive/dark ship:** Google OAuth client ids (see
      DECISIONS gdrive entry); the warm dark palette accents are a first pass,
      a designer contrast/shadow audit pass is the polish (Creative Studio
      flagged it as the non-mechanical half of dark mode).
- [x] **Native iOS voice dictation: BUILT (2026-08-25), on-device only.**
      Founder chose on-device-only (mic audio never leaves the phone) and to
      build now rather than wait for the clean TestFlight. New `oscode-speech`
      Capacitor plugin (SFSpeechRecognizer + AVAudioEngine, JS-registered so no
      pbxproj linking). See the log entry. Not device-verified (no iOS here);
      first real dictation on TestFlight is the proof.
- [x] **Mid-chat model switching, Claude-style: BUILT (2026-08-25).** Founder
      wanted the Claude behavior (keep the thread, change the model for the next
      turn). Not the CTO's feared live hot-swap: switch only when idle, reseed
      the new driver with the transcript, keep the same conversation. See the
      log entry.
- [ ] **Vision beyond Claude:** extend `sourceSupportsVision` when a direct
      BYOM/OpenAI/Gemini vision chat, a vision pocket model, or image blocks over
      the desktop-daemon SSE protocol land (daemon is text-only for now).
- [ ] **[TOP] Individual Personal tier + free/paid gating + iOS IAP -- BUILT
      (2026-08-21), pending founder config + sandbox validation before deploy.**
      Model: FREE = chat only (Harbor/Ollama + stack chat); PERSONAL = $20/yr
      unlocks the coding agent + Marketplace for one person, via Apple IAP on iOS
      and Stripe on web/desktop; commercial teams unchanged. All four phases are
      built, CTO-reviewed (money-path + Apple crypto), gated, and pushed to main.
      **Founder config before deploy (one at a time):** 1. Stripe: create a $20/yr **Personal** price; set `STRIPE_PRICE_PERSONAL`
      as a function secret. 2. `supabase db push` (applies 0006, 0007, 0008) then
      `supabase functions deploy stripe-checkout stripe-webhook stripe-portal
link-apple-purchase apple-notifications`. 3. Apple: create the auto-renewable sub `ai.openshore.oscode.personal.yearly`
      in App Store Connect; add `oscode-iap` to app/package.json is done, but
      confirm `cap sync ios` links it; enable the In-App Purchase capability. 4. Apple secrets: paste the real Apple Root CA DER base64 into
      `_shared/apple.ts` (egress here blocked www.apple.com) OR set
      `APPLE_ROOT_CA_G3_DER_BASE64`; set `APPLE_BUNDLE_ID`, `APPLE_APP_APPLE_ID`.
      Register the `apple-notifications` URL as the App Store Server
      Notifications V2 endpoint. Set `APPLE_ALLOW_SANDBOX=1` ONLY during Apple
      review, clear it after. 5. Sandbox-validate the Apple purchase/restore + notification loop on device.
      **Deferred (CTO F4/F5, low):** apple-notifications rollback-delete
      escalation; pre-link refund/revoke handling via App Store Server API lookup.
      **Public pricing page: LIVE (2026-08-21).** Open-Shore-LLC-Homepage
      `main` `bab2418` -- founder picked "Free to chat. $20 to build." for the
      headline and the feature-led paywall subhead. Free / Personal ("Most
      popular", $20/yr, App Store fine print, real Stripe individual buy button)
      / four commercial tiers, reassurance row. Founder must still: purge
      Cloudflare cache (edge-cached HTML) for it to show at openshore.ai/os-code,
      and finish step 1-2 above (`STRIPE_PRICE_PERSONAL` + redeploy) before the
      Get Personal button actually completes checkout instead of erroring.
- [ ] **Live billing config was blank (fixed 2026-08-21).** On project
      lzlrlfdffwiypzreoldb, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` were
      set to EMPTY strings (digest = SHA256 of ""), so checkout 401'd from
      Stripe. Founder pasted real live values; a live $20 Micro purchase then
      succeeded end to end (checkout + webhook + entitlement write), confirming
      P0-1. Migrations 0004/0005 applied and stripe-checkout/-webhook/-portal
      redeployed on that project; refresh-token rotation already on. Refund the
      $20 test charge + cancel that sub.
- [ ] **First desktop run on the founder's machine** (`pnpm install` then
      `pnpm desktop`) against real Ollama models.
- [ ] **First Codemagic build to TestFlight** (walkthrough in
      `docs/TESTFLIGHT.md`); the Swift side compiles for the first time
      there, so expect one round of fixes. Founder confirmed the one-time
      Apple/Codemagic setup is done; trigger the `ios-testflight` workflow on
      the `claude/os-code-openshore-styling-4bk7mp` branch.
- [x] **At-rest journal encryption:** done. Engine-side sealing
      (`core/security/atRest.ts`) in the exact app `enc:v1:iv:ct` format
      (bidirectional WebCrypto cross-test), data key in the OS keychain via the
      existing credential store (encrypted-file fallback at 600, honest backend
      reporting, self-upgrades into a keychain), per-line journal + title
      sealing tolerant of legacy plaintext, atomic idempotent boot migration in
      both the Electron host and the daemon. The Stack Health seal is now
      measured: green only when the keychain holds the key AND a full-disk scan
      finds zero plaintext lines.
- [ ] **Stack Health Phase 2 (named agents):** add an `agents` record to
      `ConfigSchema` and an opaque `agentId` to `task-start`/`turn-start`
      (stamped as a stable record key, never a display name), threaded through
      `loop.ts` and `router.delegate`. Upgrades the crew view from stack roles
      to the user's named agents with per-agent stats. Phase 3: one-tap
      suggestions + thumbs feedback.
- [x] **Catalog builder wired in CI and publishing.**
      `.github/workflows/catalog.yml` (weekly + on curation/builder/schema change + manual) builds, gates, and publishes `catalog.json` by committing it to
      the marketing repo at `src/static/os-code/catalog.json`, which Cloudflare
      Pages serves at `openshore.ai/os-code/catalog.json` (the default
      `config.catalog.url`). Verified end to end: run #3 published commit
      `aca6186` to the marketing `main`. Auth is a classic PAT in the
      `MARKETING_DEPLOY_TOKEN` repo secret (an earlier fine-grained token 403'd
      on a wrong-repo selection; fixed).
      Follow-up: (1) DONE, the builder now carries the previous `updated` stamp
      forward on a true no-op build (chooseUpdated/contentSignature in
      enrich.ts), so an unchanged run no longer commits. Seed
      `os-code/curation/*.json` as the roster grows.
- [x] **Marketplace popularity axes + landscape breadth.** Two honest axes plus
      an editorial shelf, no telemetry. LANDSCAPE ("Popular across local LLMs"):
      fixed the enrichment that published empty (HF per-segment slash encoding;
      removed the phantom Ollama JSON endpoint for an optional back-compat
      `source.popularityRef` naming each Ollama model's HF GGUF home; per-ref
      resolution logging + soft online-only 0-popularity warning; fixture tests).
      Broadened the catalog 12 -> 27 (real refs, licenses on the allow-list, no
      fabricated stars: the 15 new models show "Not yet rated"). INTERNAL ("Your
      most-used"): fully local, from StackHealth `modelUsage` (existing
      `turnsByModel`), read via the stackHealth bridge, hidden when no bridge or
      no usage; never cross-user. EDITORIAL ("Staff picks", "chosen not counted")
      from recommended/curation. Gates green (os-code 177 tests, app 76, vite
      build).
- [ ] **PARKED (founder-gated): cross-user "Popular in OS Code" leaderboard.**
      A real cross-user popularity number requires a first-ever phone-home and a
      rewrite of the Stack Health privacy seal, which literally promises "no
      telemetry." Both CTO and CMO ruled it out without an explicit, anonymized,
      OPT-IN community-share designed as its own build (edge function + aggregate
      table + consent UX + state-aware seal). Deliberately NOT built; the three
      honest axes cover the user job. Build only on the founder's explicit yes.
- [~] **Stripe went live + email confirmation ON.** Supabase "Confirm email" is
  ON (verified in the dashboard). Stripe is in live mode: live secret key,
  the OS Code webhook (`lzlrlfdffwiypzreoldb.../stripe-webhook`) enabled and
  livemode, and all four prices live and yearly. Caught and fixed a Scale
  price that was created as $500/MONTH instead of $500/year (a 12x
  overcharge); its price id is unchanged, so `STRIPE_PRICE_SCALE` needed no
  update. Verified against the Stripe API directly (key mode, per-price
  interval, webhook status). NOTE: this account is shared with another
  product (a second `riziqavmckobtcyiazht` webhook is Uki's); each webhook
  ignores prices it does not recognize, so cross-talk is safe.
  **Still open:** one real end-to-end purchase to prove the Supabase
  function secret VALUES (live key, THIS webhook's signing secret, the four
  price ids) are wired. Secret values cannot be read back from Supabase; a
  live transaction (refundable) is the only proof, and its success or its
  failure point names any stale secret.
- [x] **Slim git history:** done, founder approved. `git filter-repo`
      stripped node_modules from every commit on `main` and this session
      branch (verified: identical tree hash at HEAD before/after, file
      lists match, workspace gate still green post-rewrite). Fresh clone
      is now 680K instead of ~177MB. Anyone with an existing local clone
      needs to re-clone or hard-reset to the new hashes; a third,
      unrelated branch on the remote was left untouched.
- [x] **Real openshore.ai brand palette: finalized (already matched).** Verified
      the app's tokens against the canonical brand in the marketing repo
      (`Open-Shore-LLC-Homepage/src/static/styles.css`): paper/ink/ink-soft/
      ink-faint/water/water-deep/hairline and Fraunces+Inter all match
      token-for-token. The `OPENSHORE:` markers were gone because the real values
      were already in; the to-do was stale. Amber (`--cloud`) is the intentional
      OS Code product accent on top of the OpenShore base (teal = local/private,
      amber = cloud/spend). No palette value changed.
- [x] **Brand audit + finalization (Brand Exec + CMO).** One audit pass, all
      consistency fixes, no foundation change. Replaced the sidebar's mismatched
      Unicode nav glyphs (several rendered as color emoji, breaking the palette)
      with a coherent hand-drawn inline-SVG line-icon set in the wave-mark
      language, currentColor so the active state tints teal. Reserved teal for
      local/private only: connection/build "connected"/"finished"/"connected"
      status moved off `pill local` to a neutral `pill ok`, plan price to a
      `pill price` (spend). Token-routed the Stack Health ring gradients + legend
      (added additive `--flow`/`--flow-deep`/`--cloud-bright` naming existing
      values; rings render identically), unified the mono font on code surfaces
      (`--font-mono`), added `--code-surface`, and swapped the last stray text
      glyphs (check/X/arrow/chevron) to inline SVG. Gates green (app 76 tests +
      vite build). BrandMark and the frozen mark SVGs/PNGs left untouched.
- [x] **App polish bundle, Tier 1:** done. Navy launch continuity (iOS),
      sheet spring physics, haptics (first token, approval, download
      success), token-stream smoothing in the app transcript.
- [ ] **App polish, Tier 2** (proposed, not yet picked): drag-to-dismiss
      with rubber-banding on sheets, a "new tokens" scroll pill, dark/
      tinted iOS 18 icon variants, model-chip shared-element morph.
- [ ] **Live-fire pass on a machine with Ollama + a GPU.** Everything is
      wired and covered by tests against the mock and mocked HTTP; the first
      session against real weights should confirm streaming feel and the
      capability probe on all four backends (Ollama, LM Studio, llama.cpp,
      vLLM).
- [ ] **ComfyUI image path** needs a bundled txt2img workflow graph (A1111
      and OpenAI-images endpoints work today).
- [ ] **Tree-sitter code map** behind the existing `extractSymbols` seam,
      when install-weight is worth it.
- [ ] **Hosted license-verify endpoint** (documented stub; client is real).
- [x] **A11y pass over TUI colors** for low-color terminals: done. Ink
      downsamples on its own; the hand-rolled ANSI surfaces now do too, by
      detected color depth.
- [x] **In-TUI transcript search:** done via `/find` (TUI and plain). A custom
      mouse-free scrollback pager was deliberately NOT built: over SSH the
      terminal's own scrollback already pages, and a custom pager fights it;
      `/find` is the genuinely additive capability.

### Parked feature ideas (founder-requested build prompts)

> Captured 2026-08-24 from founder voice notes. Full, build-ready prompts
> written to hand straight to Opus 4.8.
>
> STATUS (2026-08-25): ALL THREE ARE BUILT and on `main`. BYOM shipped
> 2026-08-24 (`243e43e`); Vault + the gitOS storage seam shipped 2026-08-25
> (`b8e1658`, `ac74f77`, `3b28146`; gitOS ships as "Repositories"). The
> standing "surface until built" reminder is RETIRED now that every checkbox
> below is checked. The build prompts are kept only as historical reference.
> Remaining follow-up: Vault's ORGANIZATION tier still needs a real
> multi-writer backend (tracked as its own item, not a reason to re-surface).

- [x] **Scope and build gitOS: BUILT (2026-08-25).** Shipped as "Repositories"
      (gitOS is the internal name for the storage seam). Framing + seam in
      `b8e1658`, iCloud Drive provider in `ac74f77`, Google Drive provider
      (OAuth PKCE, drive.file) in `3b28146`. Code lives in
      `app/src/lib/gitos/`. The original build prompt is kept below for history.
      (decentralized, local-first Git hosting; storage location chosen per repo
      instead of centralized hosting).

      **Partial (2026-08-25): the storage seam is framed and live, and the
          full advisory org ruled on every decision point** (founder delegated
          the calls to the advisors, then build; rulings logged in DECISIONS.md).
          Shipped: `app/src/lib/gitos/` with the path/bytes StorageProvider seam
          (list/stat/read/write/remove plus single-writer lease ops, per the CTO
          must-fix), the Local provider over the sealed store, and the provider
          roster with Dropbox/Proton registered but honestly marked not ready
          pending OAuth wiring. Vault ships as the seam's first consumer (see the
          Vault item). Two cloud providers landed the same day: iCloud (native
          Capacitor plugin, `app/plugins/oscode-icloud/`, ubiquity container,
          needs the App ID capability enabled in the Apple Developer portal
          before each distribution build) and Google Drive (`app/src/lib/gitos/
          gdrive.ts` + `gdriveAuth.ts`, drive.file scope only per the CFO, real
          folder tree with a `.oscode/index.json` cache, OAuth PKCE with an iOS
          client via the app's own URL scheme and a Desktop client via a
          loopback redirect for Electron, per the CTO's architecture ruling;
          founder still needs to register both OAuth clients in Google Cloud
          Console and fill in `VITE_GDRIVE_*` before either build can connect).
          STILL OPEN: real-git shell-out on the desktop engine, the Repositories
          surface merge, Dropbox (app-folder scope per CTO), Proton (no public
          OAuth API today, stays an honest stub), a Google Drive disconnect
          affordance beyond the storage sheet's inline button, and the per-repo
          secrets key model. Ships as "Repositories"; gitOS is the internal name
          (CMO, Git trademark policy). Personal-gated (CFO).

  ```
  ROLE
  You are the lead engineer scoping and building gitOS. Work in strict phases:
  deliver a plan and get it approved BEFORE writing any feature code. Where a
  decision below is unresolved, ASK the founder rather than assume. A wrong
  assumption at the storage/secrets seam is very expensive to unwind later, so
  treat the "resolve first" list as a hard gate, not a formality.

  MISSION (one sentence)
  GitHub, functionally identical, except the user chooses WHERE each repository
  physically lives at creation time (their own device, their own network
  storage, or a cloud drive they already pay for) instead of it being centrally
  hosted on someone else's servers.

  THE INSIGHT THAT DRIVES THE ARCHITECTURE
  A Git host is a specialized file store wrapped in a UI plus an
  integration/secrets layer. gitOS keeps the UI and the integration layer and
  hands the file store to the user. So the entire design pivots on ONE seam: a
  storage-provider interface that the Git logic and the UI never see past. Get
  that seam right and every backend (local, iCloud, Dropbox, Drive, Proton)
  becomes an additive plugin. Get it wrong and the Git logic leaks
  provider-specific assumptions everywhere. Spend your hardest thinking here.

  THIS STORAGE SEAM IS SHARED WITH VAULT, DESIGN IT ONCE
  Vault (the parked prompt below, likely built in the same cycle) needs the
  exact same thing: a folder of files on a storage location chosen per resource
  (local, iCloud, Dropbox, Drive, Proton), synced across the user's own
  devices. The storage-provider interface you design here IS that shared
  abstraction. Design it so a Vault folder is just another resource sitting on
  it, not a Git repo, and do not let Git-specific concerns leak into the
  interface. If you build gitOS first, name this seam as the thing Vault will
  adopt; if Vault is being scoped alongside, reconcile the two before either
  freezes the interface. The one exception is Vault's ORGANIZATION tier, which
  needs a real multi-writer backend (see Vault's prompt) rather than this
  synced-folder model; the personal tiers of both features share this seam.

  WHERE THIS LIVES
  A new, native "Repositories" section of OS Code (native, not a wrapped web
  view). Confirm the exact surface with the founder before scoping downstream.
  Note Vault proposes living in this same file-browsing surface, so scope the
  navigation with both in mind.

  RESOLVE WITH THE FOUNDER BEFORE BUILDING (do not guess silently)
  1. Which surface in OS Code does the "Repositories" section live in?
  2. Implementation approach, the pivotal call. Strong default: shell out to
     real `git` against a working copy that sits inside the user-chosen storage
     location. This gets true Git semantics (branches, merges, history, diffs)
     for free and makes every cloud drive "just a folder." The alternative,
     reimplementing Git operations against each provider's raw API, is far more
     work and more failure modes. Recommend the real-`git` default explicitly
     unless the founder has a reason to want otherwise.
  3. Secrets on untrusted storage. When a repo lives on a consumer cloud drive
     the founder does not control, how are its secrets (CI tokens, deploy
     hooks, API keys) stored and encrypted so the drive provider never sees
     plaintext? This needs a real answer (for example client-side encryption
     with a key the provider never holds), not "we'll store them in a file."
     OS Code already has an at-rest sealing format (`enc:v1`) and a credential
     store; reuse them rather than inventing a second mechanism.
  4. Multi-device conflict handling. Dropbox, Google Drive, iCloud, and Proton
     Drive do NOT provide Git-aware locking or merge semantics; they are naive
     folder syncs. Is a lock file or lease enough for v1, or is real 3-way
     merge on top of the synced folder required? Decide before committing to a
     backend model; do not assume "it's just a folder, it'll be fine."
  5. Per-provider auth. What OAuth scopes do Dropbox, Google Drive, and Proton
     Drive each need, and what is the simplest on-device iCloud path (native
     Files picker vs. CloudKit)?

  CORE REQUIREMENTS
  1. Storage-location picker on repo creation. Backends for v1:
       - Local device storage, including any path reachable from the device (a
         Tailscale-mounted share or NAS is just a filesystem path, no bespoke
         network protocol). OS Code already pairs desktop and phone over
         Tailscale, so this backend runs with the existing grain.
       - iCloud Drive (via the OS's own Files/iCloud connection, not a bespoke
         API).
       - Dropbox.
       - Google Drive.
       - Proton Drive.
     Build these behind the pluggable storage-provider interface so new
     backends land without touching Git logic.
  2. GitHub stays available, additively. The section also offers "Connect to
     GitHub" (note GitLab and Bitbucket as later additions). gitOS is a new
     option ALONGSIDE GitHub, never a removal of it.
  3. Full functional parity, not just file sync: branches, commits, merges,
     diffs, history, AND the secrets/integration layer so a repo's wiring (CI,
     deploy hooks, keys) clones and reconnects exactly like today, regardless
     of which backend holds the bytes. The bar is "clone this and everything
     just works," not "clone this and get plain files."
  4. Coding-agent workflow parity. Selecting a repo to work in feels identical
     to selecting a repo in a modern coding agent today: pick the repo (any
     backend), an agent or the user makes changes, changes commit; the backend
     is invisible. OS Code's own agent loop is the consumer to satisfy here.
  5. Backups as a first-class feature, near-zero effort. Because the repo
     already lives on storage the user owns, add a Settings toggle plus an
     interval picker (daily, weekly, custom) that snapshots the repo to a
     second user-chosen location. This is gitOS's headline differentiator
     versus GitHub, not a bolt-on: the wiring already exists, so backup is
     gold-standard by construction. Design it as such.

  NON-GOALS FOR V1 (flag, do not build)
  - Do not try to match GitHub's collaboration surface (PRs, issues,
    Actions-equivalent CI runners) in v1. Scope v1 to solo or small-team repo
    storage plus core Git operations plus backups.
  - Do not assume the cloud-drive providers solve real-time multi-device
    conflict resolution. They do not.

  DELIVERABLE FOR THIS PASS (plan, not code)
  1. The storage-provider interface: its surface, and how local, iCloud,
     Dropbox, Drive, and Proton each satisfy it.
  2. The repo-creation flow end to end.
  3. The secrets/integration-wiring design, including the untrusted-storage
     encryption model.
  4. The backup feature design.
  5. A clear v1 vs. later-phase cut line.
  Present the five "resolve first" questions as explicit decision points at the
  top. Do not write feature code until the plan is approved.

  DEFINITION OF DONE (v1)
  A user can create a repo on any of the five backends, do real Git work in it
  (including via a coding agent), have its integrations reconnect on clone, and
  turn on scheduled backups to a second location, with secrets never landing in
  plaintext on a provider the user does not control.
  ```

- [x] **Scope and build Bring Your Own Model (BYOM): BUILT (2026-08-24).**
      Shipped in `243e43e` ("connect a model you control, from the Stack"). Code
      in `app/src/lib/byom.ts`, tests in `app/test/byom.test.ts`. The original
      build prompt is kept below for history.
      (a first-class "connect
      any model you control" capability). NOTE: this overlaps heavily with what
      OS Code already does, so the prompt is framed as an EXTENSION of the
      existing model/router layer, not a new build. Below is the optimized Opus
      4.8 build prompt.

      **Partial (2026-08-24): the individual in-stack connector shipped.** The
          founder's concrete ask (a "+" button top-right of the Stack, point at a
          model you control, it lands on the Bench and places into the stack) is
          built: `app/src/lib/byom.ts`, a `byom` `StackModelRef` kind, `connectByom`
          / `disconnectByom` in the store (key in the device secret store, never in
          settings), and the StackManager connect/disconnect UI. It reuses the
          existing OpenAI-compatible adapter (now endpoint-driven, with an optional
          key so keyless local servers work). STILL OPEN from the prompt below:
          org-level configuration (set once for a whole team), a pre-flight
          capability check, and graceful degradation when a connected model lacks a
          needed capability. Keep this item open until those land.

  ```
  ROLE
  You are the lead engineer extending OS Code with an explicit "Bring Your Own
  Model" (BYOM) capability. IMPORTANT FIRST STEP: OS Code is already a
  bring-your-own-stack product (local models as the default, a
  router/quarterback, Ollama-native and OpenAI-compatible adapters, a manual
  cloud flip for the user's own Claude or ChatGPT account, a marketplace
  catalog). So this is very likely an EXTENSION of the existing model/router
  layer, not a new subsystem. Before proposing anything, audit what already
  exists (the router, the provider adapters, the cloud-connect flow, the config
  schema) and design the DELTA that turns today's capability into a first-class,
  user-facing "connect any model you control" feature. Do not duplicate what is
  built. Work in phases: plan first, get it approved, then build. Where a
  decision below is unresolved, ASK.

  MISSION (one sentence)
  A clear, first-class setting that lets a user or an organization point OS Code
  at a model THEY control (their own fine-tuned or local model, a self-hosted
  endpoint, or another provider's API) with as little friction as selecting a
  built-in model, framed as an explicit "Bring your own model" entry point
  rather than something only power users discover.

  THE GAP TO CLOSE (audit first, then build)
  OS Code can already talk to local and OpenAI-compatible backends. BYOM is
  about making "add a model I control" an obvious, safe, org-aware first-class
  action, plus honest capability handling when a connected model cannot do what
  the agent loop needs. Identify and close the gap between what the
  router/adapters do today and:
    - a discoverable "Bring your own model" action in the app (not just a config
      file edit),
    - organization-level configuration (a company sets it once for the team),
    - a pre-flight compatibility check and graceful degradation.

  TWO AUDIENCES, DESIGN FOR BOTH
  1. Super users: individuals swapping in a specific model for preference, cost,
     or performance.
  2. Companies (the primary long-term case): organizations running a local or
     fine-tuned model tailored to their own codebase and conventions, with the
     CTO's time going into shaping that model rather than rebuilding the generic
     agent tooling every company now has. Treat the org case as first-class.

  THE HARD PART, THINK HERE
  The agent loop, tool-calling, and context management must work against a BYO
  model exactly as against a built-in one. Endpoints disagree on tool-call
  format, streaming, context window, and system-prompt handling. The crux is a
  clean model-adapter contract plus honest capability detection: when a
  connected model cannot do something the stack needs, detect it and tell the
  user precisely what is missing, rather than failing mid-agent-loop. Spend your
  reasoning budget on the adapter contract and the degradation path. Reuse OS
  Code's existing "specialist tools register only when the stack can serve them"
  pattern rather than inventing a parallel one.

  RESOLVE WITH THE FOUNDER BEFORE BUILDING (do not guess silently)
  1. How much of BYOM does OS Code's current router/adapter layer already
     cover, and what is the exact remaining delta? (Answer from the code first,
     then confirm scope with the founder.)
  2. How are credentials for a self-hosted or local endpoint stored and
     secured? (OS Code already has a credential store; extend it, do not add a
     second.)
  3. Does connecting a model require a pre-flight compatibility check (tool-use
     format, context window, streaming) before it can go live?
  4. How does a BYOM connection interact with the existing spend-confirm and
     billing model that governs cloud escalation?

  CORE REQUIREMENTS
  1. A discoverable "Bring your own model" entry point that connects a model
     endpoint (self-hosted, local-network, or third-party API) with its own
     credentials, clearly distinct from the built-in local stack and the cloud
     flip.
  2. Fully first-class, not a stub: the agent loop, tool-calling, and context
     management all function against the connected model as they do against
     built-ins.
  3. Build on the existing OpenAI-compatible adapter as the baseline (it already
     covers most self-hosted and local servers such as vLLM, Ollama, and LM
     Studio), and keep the adapter layer open so named providers can be added
     later.
  4. Org-level configuration: a company sets this once for its whole team or
     workspace, not only per individual user, wired through the existing org
     write-through where possible.
  5. Graceful degradation: when the connected model lacks a needed capability,
     detect it and explain what is missing rather than failing silently or
     breaking the loop.

  NON-GOALS FOR V1 (flag, do not build)
  - Not a marketplace or discovery surface for models (OS Code already has a
    marketplace catalog; BYOM is the "I already have my own model" path, not a
    new catalog).
  - Not model fine-tuning tooling. Assume the org already has, or is training,
    its own model elsewhere; BYOM only connects to it.

  DELIVERABLE FOR THIS PASS (plan, not code)
  1. An audit of what OS Code's model/router layer already provides and the
     exact remaining delta.
  2. The connection UX (individual and org).
  3. The model-adapter contract and the capability-detection and degradation
     model, expressed as an extension of the existing adapters.
  4. Individual-vs-org scoping and credential storage.
  5. A clear v1 vs. later-phase cut line.
  Present the "resolve first" questions as explicit decision points at the top.
  Do not write feature code until the plan is approved.

  DEFINITION OF DONE (v1)
  An individual or an org can connect a model they control through a
  discoverable setting, run the full OS Code agent workflow against it exactly
  as against a built-in model, and get a clear, specific message (never a silent
  break) when the connected model lacks a capability the stack needs.
  ```

- [x] **Scope and build Vault: BUILT (2026-08-25).** Shipped on the gitOS seam
      in `b8e1658` ("Frame gitOS and ship Vault on it"). Code in
      `app/src/lib/vault.ts`, `app/src/lib/vaultExport.ts`,
      `app/src/screens/VaultScreen.tsx`, `app/src/components/VaultMarkdown.tsx`;
      tests in `app/test/vault.test.ts`. The organization tier (multi-writer
      backend) remains the open follow-up. The original build prompt is kept
      below for history.
      (a native, Obsidian-style markdown knowledge base built into OS Code,
      personal by default with an organization tier). Working name only, the
      founder is not settled on it.

      **Partial (2026-08-25): the personal Vault shipped, on the gitOS seam,
          after the full advisory org answered the decision points.** Name: Vault
          ships (CMO: generic term, safe, and earned because compat is TRUE).
          Compat ruling: true Obsidian compatibility. Plain .md paths, Obsidian's
          own [[wikilink]] grammar including alias and heading-ref tolerance,
          bare-name resolution with shortest-path tiebreak, and export as real
          files (Documents/Vault via the new @capacitor/filesystem plugin plus
          UIFileSharingEnabled, so the Files app shows the folder and Obsidian
          mobile opens it as a vault). Shipped surface (`VaultScreen`, in the
          sidebar nav): folder tree with breadcrumbs, edit/read toggle, autosave
          as you type (debounced), clickable wikilinks that create missing notes,
          Linked mentions backlinks card, the storage-location sheet with Local
          live and the other providers honestly Arriving, and the export action.
          Free tier (CFO: the daily-habit hook; the agent side is what Personal
          gates).

          **Org tier BUILT (2026-08-25).** The shared, multi-writer team vault
          shipped: a Supabase-backed gitOS provider ('org', Team vault) behind the
          same seam, so the Vault UI never learns the bytes live in Postgres.
          Migration `supabase/migrations/0010_org_vault.sql` adds `org_vault_notes`
          (keyed org_id + path), RLS so only active members read (is_org_member),
          table writes revoked so the two SECURITY DEFINER RPCs are the ONLY write
          path, `org_vault_put` doing last-write-wins with a conflict copy (the
          overwritten body is preserved as a "(conflict ...)" note, never lost),
          and `org_vault_delete` as a tombstone. The Vault screen gains a
          Personal | Team switcher (Team shown only to signed-in org members), and
          `[[` autocompletion landed for both vaults (pure `wikilinkContext` in
          vault.ts, a mobile-first chip row in the editor). iCloud sync for the
          PERSONAL vault is already covered by the landed iCloud gitOS provider.
          The founder must apply the migration (supabase db push) for the live team
          vault to work. (Applied 2026-08-25.)

          **Agent vault writes BUILT (2026-08-25), daemon side.** The founder chose
          a PRIVATE ON-DEVICE vault (local-first, no token crossing to the daemon)
          over the team vault as the agent's write target. New daemon tools in
          `os-code/src/core/tools/vault.ts`: `vaultRead` and `vaultList` (read risk,
          flow) and `vaultWrite` (write risk, alwaysAsk). Notes are plain markdown
          under `~/OSCode/Vault` (config `vault.dir`), path-jailed to that root, so
          Obsidian or any editor opens the folder. "Never silent" is enforced hard:
          a new `ToolDef.alwaysAsk` flag, honored by the permission engine BEFORE
          any auto-allow path (session grant, rule, trusted repo), so no setting can
          make an agent vault write skip its approval diff. The approval reuses the
          existing app ApprovalSheet + CLI/TUI prompt (a unified diff). 236 os-code
          tests green (adds vaultTools.test), lint, em-dash.

          **App folder view BUILT (2026-08-25), desktop.** The paired follow-up
          shipped: a file-backed gitOS provider ('files', "This folder") that the app
          points the personal vault at, reading and writing the SAME `~/OSCode/Vault`
          folder the agent writes, so agent notes show in the app's Vault and vice
          versa, and Obsidian opens the folder. New Electron IPC (osc:vaultList /
          Read / Write / Remove in electron/main.ts, path-jailed with os-code's Jail),
          exposed on the bridge + preload; the provider (app/src/lib/gitos/
          deviceFolder.ts) is a thin client over it, in PROVIDER_ROSTER and offered
          in the "Where it lives" sheet on desktop only (probeReady gates it off the
          phone). Move the personal vault to it from that sheet. Green: app typecheck
          (incl. electron), lint, 176 tests (adds deviceFolder.test), vite build,
          em-dash. Not device-verified (no Electron in the web session); founder
          confirms on Pop!_OS. Minor known gap: no live fs-watch, so an agent write
          appears in the app on the next Vault refresh (navigate away and back), not
          instantly.

  ```
  ROLE
  You are the lead engineer scoping and building Vault, a native markdown
  knowledge base inside OS Code. Work in phases: deliver a plan and get it
  approved BEFORE writing feature code. Where a decision below is unresolved,
  ASK the founder rather than assume, especially anything touching where org
  data physically lives or how it syncs across members.

  MISSION (one sentence)
  A folder of markdown files the user (or, on the organization tier, the whole
  team) reads and writes by hand and the agent reads and writes as part of its
  own work, rendered with a consistent, native visualization inside OS Code
  instead of a separate app, so the record of what the agent has done and what
  the user knows lives in one place.

  WHY THIS FITS HERE
  OS Code already runs the agent loop locally and already owns the file
  browsing surface (Repositories). Vault is the natural extension: the same
  agentic work already happening in the app gets a durable, readable home
  instead of living only in chat transcripts, and the user gets a real
  organizing layer for notes, decisions, and reference material the agent can
  actually use as context.

  THE ARCHITECTURE QUESTION THIS SHARES WITH GITOS, RESOLVE TOGETHER
  gitOS (see the prompt above, if built or being scoped in the same cycle)
  already needs a storage-provider abstraction: local device, iCloud, Dropbox,
  Google Drive, Proton Drive, chosen per resource instead of centrally hosted.
  A personal Vault is the same problem at smaller scale (a folder of files,
  chosen storage location, needs to sync across the user's own devices). Do
  not build a second, parallel storage abstraction. If gitOS's
  storage-provider interface exists or is being scoped concurrently, Vault's
  personal tier should sit on top of it. If gitOS is not yet built, design
  Vault's storage layer so gitOS can adopt it later instead of the reverse.

  THE HARD PART, THINK HERE
  The organization tier is a different problem than the personal tier, not a
  bigger version of it. A personal vault is one folder on storage the one user
  already controls, so it can be local-first. An organization vault is shared,
  read-and-written-to by multiple members across their own devices, which
  means it needs real multi-user sync and a permission model, the same
  multi-device conflict problem gitOS's prompt flags for cloud-drive backends,
  now with concurrent writers instead of one. Consumer cloud drives (Dropbox,
  Drive, iCloud) do not provide this out of the box. Spend your reasoning
  budget on whether the org tier needs its own real backend (for example
  Supabase, mirroring how org accounts and entitlements already work
  elsewhere in this codebase) rather than trying to force a synced-folder
  model to do multi-writer duty.

  RESOLVE WITH THE FOUNDER BEFORE BUILDING (do not guess silently)
  1. True Obsidian compatibility (plain `.md` files plus an `.obsidian/`
     config folder, so the same folder also opens correctly in the real
     Obsidian app) versus an Obsidian-INSPIRED native experience that is not
     actually interoperable. This changes the file format contract
     completely; get it settled first.
  2. Where does a personal vault live when the user has only ever used the
     phone (no desktop paired over Tailscale)? Device-local storage, iCloud,
     or does it require pairing a desktop first?
  3. Organization vault backend: real multi-user store (see THE HARD PART
     above) versus a synced folder with a lock/lease model. Pick one
     deliberately, do not default into the weaker option.
  4. Permission model for the organization vault: can every member write
     everywhere, or is it scoped (a member's own subfolder plus a shared
     shared/ area, admin-only areas, etc.)?
  5. How does the agent decide what to write into Vault versus keep in a
     session's own journal? Automatic (the agent files things itself) versus
     user-directed (the user tells it to save something) versus both; get this
     wrong and Vault either fills with noise or stays empty.
  6. Final product name. "Vault" is a working name only.

  CORE REQUIREMENTS
  1. Personal tier, on by default for every signed-in account: one vault, one
     folder of markdown notes, the agent's own read/write target alongside the
     user's own notes.
  2. Organization tier: one shared org vault per organization, alongside each
     member's own personal vault, mirroring how OneDrive separates a personal
     drive from an org's SharePoint-backed one. The org decides internally
     what belongs there; OS Code does not police content, only access.
  3. A native, consistent visualization inside OS Code: browse the folder
     structure, open and edit a note, see backlinks/references if the
     Obsidian-compatibility decision above calls for them, all rendered in the
     app's own design language rather than an embedded web view.
  4. Agent integration: the agent can read Vault content as context and write
     new notes or update existing ones as part of its own work, gated by
     whatever the resolve-first decision on automatic-vs-directed lands on.
  5. Reuse OS Code's existing at-rest sealing (`enc:v1`) and credential store
     for anything sensitive that ends up in a note, rather than inventing a
     second encryption path.

  NON-GOALS FOR V1 (flag, do not build)
  - Not a real-time collaborative editor (two people typing in the same note
    simultaneously). Start with save-and-sync, not live co-editing.
  - Not a plugin ecosystem or Obsidian plugin compatibility, even if the file
    format is made Obsidian-compatible per the resolve-first decision above.
  - Not a replacement for the session journal or chat history; Vault is a
    curated knowledge layer, not a raw transcript store.

  DELIVERABLE FOR THIS PASS (plan, not code)
  1. The file-format decision (true Obsidian compatibility or not) and why.
  2. The personal-tier storage design, and its relationship to gitOS's
     storage-provider interface.
  3. The organization-tier backend design and its permission model.
  4. The agent read/write integration design (automatic vs. directed).
  5. The native browsing/editing UI's shape inside OS Code.
  6. A clear v1 vs. later-phase cut line.
  Present the six "resolve first" questions as explicit decision points at the
  top. Do not write feature code until the plan is approved.

  DEFINITION OF DONE (v1)
  A signed-in user has a personal vault the agent reads from and writes to
  alongside their own notes, rendered natively in OS Code. An organization has
  one shared org vault alongside each member's personal one, with a real
  permission model and a genuine multi-writer sync story, not a
  best-effort synced folder.
  ```

## Log

- **2026-08-26: Desktop (Electron) interactive PTY terminal wired (the one
  documented Phase 2 follow-up).** The interactive terminal already ran
  phone-to-desktop over the daemon; this wires the same TerminalManager into
  the Electron desktop app, so a desktop-backed chat opens a real local PTY
  over IPC (not only remotely). EngineHost holds a TerminalManager and forwards
  output on a new channel; six osc:terminal\* IPC handlers + preload/bridge
  methods + onTerminalData; ElectronDriver implements the ChatDriver terminal
  methods (the output listener registers before subscribing so ring replay is
  never missed, and tears down on abort). A terminalReader is also passed into
  both bootstrapSession calls so read_terminal sees PTY scrollback on desktop.
  Owner is the local user on desktop, so no cross-user gate is needed here; PTY
  output rides its own forwarder and is never journaled; stdin is never logged.
  3 new ElectronDriver tests. Gates green (os-code 36 files, app 41 files,
  typecheck incl. electron tsconfig, lint --max-warnings 0, vite build).
  Still needs the machine: electron-rebuild of node-pty for the Electron ABI to
  run a real PTY (absent, openTerminal reports unavailable and chat is unaffected).

- **2026-08-26: Second round, founder-approved builds + all scoped follow-ups.**
  The founder approved both team recommendations and asked for every "left for
  their own scoping" item. All built, test-backed, merged to main. Gates green
  (os-code 302 tests, app 239, typecheck, lint, vite build).
  - **Free desktop chat (paywall change, C-suite approved, CTO-designed).** Chat
    with a paired desktop's own local models is now FREE; the coding agent,
    Marketplace, and repo writes stay Personal. The CTO rejected a
    "zero-tools session" (the command lane would have bypassed the tool registry
    and let a free session run shell) and specced a stateless daemon route POST
    /chat that builds only a provider and streams one completion: no
    AgentSession, no LocalDriver, no ToolRegistry, no command lane, no journal,
    pinned to the local orchestrator (no cloud spend). It cannot act by
    construction. A distinct source.kind 'desktop-chat' (not a flag on
    'desktop') keeps the free path off the session-creating branch; the gate is
    unchanged. New DesktopChatDriver; a free-chat picker row beside the merged
    "My computer" agent entry. Honest limit (CTO): the $20 wall is not
    server-enforceable against a user's own daemon; this confines the free
    surface, it does not police entitlement. Logged in DECISIONS.md.
  - **Terminal bridge Phase 2: a full interactive PTY.** xterm.js on the phone
    driving a live PTY on the desktop over new daemon term routes; agent reads it
    with a new readTerminal tool (no writeTerminal). node-pty is an OPTIONAL dep,
    lazy-imported: absent, the create route returns 503 and the daemon keeps
    serving (the whole tree stays green with no native module). Security
    reviewed: the terminal surface is ADMIN-only and owner-only; PTY output
    rides its own SSE endpoint, never the journal (only content-free
    opened/closed markers); stdin is never journaled or logged. Ring buffer with
    absolute byte offsets for lossless reattach. Electron terminal wiring was
    the one documented follow-up; it is now DONE (see the 2026-08-26 desktop
    PTY entry at the top of the Log).
  - **MP-F2:** a paired phone installs a desktop model over the tailnet (daemon
    /models/install + progress polling).
  - **MP-F4:** pocket models that finished downloading while the app was closed
    are adopted instead of re-downloaded (app adoption + a native guard).
  - **TS-P2-4:** per-device, revocable pairing credentials; the QR no longer
    hands out the shared admin token (mint-once, cached, revoke rotates the QR).
  - **TS-P1-5:** the home-repo path writer, so "Sync now" stops being
    enabled-but-doomed (pick an on-desktop cloned workspace).
  - **Still needs founder / device:** confirm the free-chat and P0 streaming on a
    real iPhone; node-pty built for the machine's ABI to run the real PTY (and
    electron-rebuild for the Electron terminal follow-up); the Swift changes
    compile on TestFlight.

- **2026-08-26: Review remediation, full pass, merged to main.** Acted on the
  2026-08-25 review (`CODE-REVIEW-FINDINGS-2026-08-25.md`) across the three
  focus areas, closing out the substantive findings and a full premium-polish
  pass, each fix test-backed; gates green (os-code 275 tests, app 192,
  typecheck, lint, vite build). Founder directed the push to main.
  Additions beyond the first pass below: the chat-to-terminal bridge now works
  on the DESKTOP app too (Electron command lane over IPC) and gains a composer
  Terminal mode ($) for typing your own command; the Marketplace got a premium
  pass (a real single-model product page replacing the fuzzy-search stand-in, a
  browsable Starter-stacks preset shelf, a shimmer skeleton loader, an installed
  state for desktop models, a quantization gloss, brand-safe hero variety, a
  button-in-button a11y fix, a filter-clear empty state); macOS Tailscale
  detection and CGNAT alignment; honest loopback pairing state (no unreachable
  QR); SSE write backpressure; a cached Tailscale probe so the Pair poll never
  freezes the desktop; and polish haptics on the terminal commits. Still a
  founder decision, deliberately NOT built: the desktop-chat paywall change
  (C-suite recommended opening free desktop chat, a monetization-foundation
  change needing explicit approval) and terminal-bridge Phase 2 (full PTY tab).
  Still needs founder/device verification: the P0 streaming fix on a real
  iPhone, and the native Swift changes compile on TestFlight. Larger follow-ups
  left for their own scoping: the daemon model-install endpoint (MP-F2),
  background-download adoption (MP-F4), per-device pairing credentials (TS-P2-4),
  and the home-repo path writer (TS-P1-5).
  - **Tailscale / phone (P0 + P1s).** Fixed the flagship phone bug: the daemon
    SSE stream and Anthropic SDK were routed through Capacitor's native-HTTP
    fetch (buffers, cannot stream), so a paired phone rendered nothing during a
    run. New `streamingFetch` reaches the unpatched WebView fetch
    (`window.CapacitorWebFetch`); the global patch stays on so web search / Drive
    / Supabase are untouched (safe failure mode). Also: `/outbox/apply|verify`
    now admin/workspace-gated (a member token could push to any repo, security
    must-fix); the tailscale-bound daemon also listens on loopback so `osc
attach` reaches it; a daemon restart seeds the agent's history from the
    journal (no more amnesia) and clears zombie approvals; the reconnect loop
    stops on 401/persistent-404 with actionable copy instead of retrying forever;
    phone POSTs get a 10s timeout.
  - **Chat-to-terminal bridge, Phase 1 (the founder's game-changer).** A
    first-class command lane: run a command on the paired desktop from chat,
    watch output stream live, answer prompts, kill it, and the model reads the
    result on its next turn (no screenshot loop). New
    `core/exec/commandRunner.ts` (shared with runShell), three `command-*`
    driver events, `LocalDriver.runCommand/writeCommandStdin/killCommand`, daemon
    routes under the owned-session block (owner's tap is the approval, audited in
    the journal), a `contextPreamble` seam into `AgentSession.run`, and the app
    side (command ThreadItem + reducer, `CommandCard`, RemoteDriver methods,
    store actions, a Run/Copy button on shell code blocks). Also fixed the tiny
    high-leverage bug: the app discarded all shell output past its first line.
    Follow-ups: desktop (Electron) command lane, a composer terminal-mode
    toggle, and Phase 2 (full PTY tab) which is a founder decision.
  - **Marketplace (premium + functional + HF automation).** A standalone iPhone
    now fetches the published catalog directly (Preferences-cached, graceful
    fallback) so ratings/popularity/staff-picks appear without a paired desktop;
    the Staff axis hides when empty; copy fixed (popularity is HF-only; the "over
    Tailscale" note is phone-only). Builder: an HF outage no longer strips
    popularity (carry-forward + coverage gate); HF_TOKEN + bounded concurrency +
    retry; a license-drift warning; a published commercial-posture flag; a gate
    that rejects any non-huggingface.co `onDevice.url` (plus the native client
    check), closing a redirect-to-anywhere download vector.
  - **Advisor ruling captured (founder decision needed).** The C-suite (CFO lead,
    CMO weighed) recommends opening FREE desktop CHAT (route it like `stack`,
    read-only) while keeping the $20 Personal gate on the coding agent,
    Marketplace, and repo writes. This is a monetization-FOUNDATION change, so it
    was deliberately NOT built; it needs the founder's explicit yes. Gate lives at
    `app/src/state/store.ts` around the desktop-conversation check.
  - **Needs founder / device (cannot verify in a web session):** confirm the P0
    fix on a real iPhone (streaming); the Swift `downloadModel` host check and
    any native change compile on TestFlight; wire an optional `HF_TOKEN` repo
    secret if you want the authenticated popularity fetch.
- **2026-08-26: Chat-surface refinements + polish (bigger menu, anchored
  greeting, guide-as-reasoning, a Chats room).** Founder asks over four
  screenshots. (1) Menu button: a drawn SVG glyph (`components/MenuIcon.tsx`),
  fuller weight in the primary ink on a 40px target, in the chat top bar and the
  room BackBar. (2) Empty-state greeting: `.greeting` switched to
  `justify-content: flex-end` so the mark + line sit just above the composer and
  ride up with it under the keyboard, instead of centering and colliding with
  the status bar. (3) Downloaded guide becomes the Reasoning anchor:
  `reasoningPromotion` in `state/store.ts` promotes a just-downloaded Harbor /
  Harbor Mini when there is no anchor or the anchor is a guide not on the device
  (Harbor also upgrades a ready Mini); a matching init reconcile heals the seeded
  Mini anchor a Harbor-only user hit ("download it first"). Cloud/BYOM/user
  device anchors untouched. (4) Chats room: new `chats` view +
  `screens/ChatsScreen.tsx` lists the active project's chats with an easy new
  chat; the recent-chats list left the drawer, New chat + Quick chat stayed.
  Polish: capped row stagger, opacity room cross-fade (keyed on view),
  menu-glyph press spring, grouped flat rows that swipe to delete behind a
  confirm (SwipeRow gained an optional label + danger variant + style, pin
  behavior unchanged). Dead `.conv-list`/`.conv-empty` pruned. Animations use
  `backwards` per the polish-standards rule. Green: 209 app tests, typecheck,
  lint, build, em-dash. Not iOS-verified here.

- **2026-08-25: App Vault opens the on-disk folder (file-backed provider).** The
  paired follow-up to agent vault writes: the app's Vault can now live in the
  same `~/OSCode/Vault` folder the agent writes, so notes flow both ways and
  Obsidian opens the folder. A new gitOS provider 'files' ("This folder") is a
  thin client over new Electron IPC (osc:vaultList/Read/Write/Remove in
  electron/main.ts), each path jailed to the vault dir with os-code's own Jail
  (symlink-safe). Exposed on the bridge interface + preload; registered in the
  seam and PROVIDER_ROSTER; probeReady('files') gates it to the desktop app
  (the phone shows it as "Open OpenShore on your computer"). The user moves the
  personal vault onto it from the existing "Where it lives" sheet, which needed
  no change (it renders the roster generically). Green: app typecheck (app +
  electron tsconfig), lint --max-warnings 0, 176 tests (adds deviceFolder.test
  with a no-bridge-throws case), vite build, em-dash. Not runnable in the web
  session (no Electron), so founder verifies on Pop!\_OS. Known gap: no fs-watch,
  so an external write (the agent's) shows on the next Vault refresh, not live.

- **2026-08-25: Agent vault writes, with an always-ask approval (daemon side).**
  The last Vault follow-up. The agent can now read, list, and WRITE the user's
  knowledge vault as part of its work, but never silently. Founder chose a
  private on-device vault (plain markdown under `~/OSCode/Vault`, config
  `vault.dir`) over the team vault, so nothing crosses to the daemon and Obsidian
  opens the folder. New tools in `os-code/src/core/tools/vault.ts`: `vaultRead` /
  `vaultList` (read, flow) and `vaultWrite` (write, always-ask, append or
  replace, unified-diff preview), path-jailed to the vault root so a note can
  never escape it. The "never silent" guarantee is structural, not a convention:
  a new `ToolDef.alwaysAsk` flag that the permission engine honors before every
  auto-allow path (`decide()` returns 'ask' ahead of session grants, rules, and
  trusted repos), and the loop refuses to grant "allow for this session" on such
  a tool. Reuses the existing approval surface (app ApprovalSheet + CLI/TUI diff)
  for free. Green: os-code build, lint --max-warnings 0, 236 tests (adds
  vaultTools.test with an escape-rejection and an always-ask-beats-trusted-repo
  case), em-dash policy. FOLLOW-UP (paired, not blocking): the app's Vault screen
  does not yet show this on-disk folder; wiring it needs a file-backed gitOS
  provider over new Electron IPC (the bridge exposes no generic fs today),
  desktop-only and not testable from the web session.

- **2026-08-25: Vault organization tier (shared multi-writer team vault).** The
  last open Vault follow-up. A Supabase-backed gitOS provider ('org', "Team
  vault") slots behind the existing storage seam, so the Vault UI is unchanged
  above it. Migration `supabase/migrations/0010_org_vault.sql`: `org_vault_notes`
  keyed (org_id, path); RLS so only active members read (reuses is_org_member);
  table INSERT/UPDATE/DELETE revoked from clients so the two SECURITY DEFINER
  RPCs are the sole write path (same lockdown shape as 0005); `org_vault_put`
  does last-write-wins with a CONFLICT COPY (the body that would be overwritten
  by a concurrent write is first preserved as a "(conflict ...)" note, so no
  member's work is ever silently lost); `org_vault_delete` is a tombstone so
  peers converge on removals. Client: the provider tracks the rev it last read
  and hands it to the RPC as the base for conflict detection; a Personal | Team
  switcher on the Vault screen (Team shown only to signed-in org members); the
  personal vault's storage-location sheet stays personal-only. Also shipped `[[`
  autocompletion for both vaults: a pure `wikilinkContext(text, caret)` helper in
  vault.ts (tested) drives a mobile-first suggestion chip row in the editor, one
  tap to link an existing note or create a new one. The store's vault actions are
  now scope-aware (personal path behavior unchanged); the org provider
  authenticates via a token getter the store registers, never importing the
  store. FOUNDER ACTION: apply the migration (supabase db push) to enable the
  live team vault. Green: typecheck, lint --max-warnings 0, 168 app tests, em-dash
  policy, vite build. STILL OPEN as its own subsystem: agent-proposed vault
  writes with approval (spans the desktop daemon's tool/approval protocol; the
  app is chat-only). CTO reviewed the migration/RLS: SAFE with one P1 fixed in a
  follow-up commit before the migration is applied. The P1 was an
  account-separation leak (team-vault state and the provider base-rev cache
  survived sign-out, so a handed-off device could show the previous org's note
  titles / open note); fixed by clearing vaultScope/vaultFiles/vaultNote and
  calling resetOrgVault() on sign-out, and resetting to the personal scope on
  sign-in. Also took the CTO's anon-select revoke (defense in depth). Left as
  noted, non-regression: repo-wide search_path hardening (pg_catalog, public).

- **2026-08-25: connection status sheet fix + a full sheet-dismiss polish.**
  Tapping the connectivity pill (Docked/Offshore/Offline) opened its Connection
  sheet clipped at the top of the screen, behind the status bar, unreadable. Root
  cause: `ProfileStatus` rendered the sheet from inside `.topbar`, which sets
  `backdrop-filter`; a non-none backdrop-filter makes the element the containing
  block for its position:fixed descendants, so the full-screen `.sheet-scrim` was
  trapped in the thin bar instead of the viewport. Fix: portal the scrim to
  `document.body`, so its fixed positioning resolves against the viewport. Keeps
  the top bar's backdrop blur intact and fixes both places the pill appears
  (ChatScreen, BackBar). Then the polish the fix invited: the sheet slid in but
  snapped out, so it now drags to dismiss (grab handle, 1:1 finger tracking,
  velocity-free threshold with spring-back) and always animates out (scrim fade +
  slide-down, unmount held for the full exit so the tail is never clipped, a fixed
  timer so it also lands under reduced motion). Haptics on the lift and the drop
  via `lib/haptics`. `prefers-reduced-motion` now suppresses the sheet rise,
  slide, and scrim fade (was previously unhandled for sheets, an app-wide win).
  Green: typecheck, lint, 147 app tests, em-dash policy. Follow-up (not done):
  bring the same real exit to InfoSheet, ModelSheet, and the mode sheet, which
  still snap-unmount.

- **2026-08-25: polish pass, swipe physics + a tappable out-of-usage fallback.**
  Both polish bundles surfaced this session, built. Swipe-to-pin now reads as
  native: (1) axis lock, the gesture decides horizontal vs vertical in the first
  ~8px and only captures the pointer once horizontal, so a vertical list scroll
  is never stolen; (2) velocity commit, a quick leftward flick fires Pin/Unpin
  even short of the distance threshold; (3) a reveal-edge haptic tick the instant
  the action is fully revealed (armed), on top of the success haptic at commit.
  Out-of-usage is now actionable: the stopped message carries a "Switch to a
  local model" button that opens the Local LLMs sheet directly. The exact
  fallback phrase moved to `lib/usageFallback.ts` (a leaf module the cloud driver
  emits and the transcript matches, so they cannot drift), and `ModelSheet` takes
  an `initialStage` so the tap lands straight on the Local LLMs sub-sheet. Green:
  typecheck, lint, 153 tests, vite build, cap sync ios.

- **2026-08-25: OpenShore stops pricing usage; at account limits it points to
  local.** Founder call: OpenShore is a connection to the user's own Anthropic
  account (subscription or pay-as-you-go), so their account owns all billing.
  The app no longer fabricates or shows a per-turn dollar estimate. Removed the
  `inPerM`/`outPerM` rates from `lib/claudeModels.ts` (catalog now keeps only the
  real context window, the honest non-pricing signal the meter reads) and the
  token-times-rate cost math from the cloud driver. The shared `usage` protocol
  event still carries a `dollars` field for the CLI, so the driver sends 0 rather
  than invent a number (the shared protocol/CLI cost path was left intact, not
  renovated). Out-of-usage handling: a depleted balance (400 naming the credit
  balance) or a usage cap (429) now reads "No more Claude usage on your account
  right now. Switch to a local model to keep going," instead of the old
  rate-limit hedge, so the local fallback is always offered. The chat status line
  drops the `$X.XX` segment; model, kind, and context percent remain. Green:
  typecheck, lint, 151 tests, vite build. Follow-up (not done): make the
  out-of-usage message tappable to jump straight to the Local LLMs sheet.

- **2026-08-25: swipe-to-pin for models in the model sheet.** Founder wanted a
  swipe-left-to-pin on selectable models, pinned ones surfacing under My Stack
  on the root sheet where they can be unpinned by swipe. New pure helpers in
  `lib/pins.ts` (`pinKey`/`isPinnable`/`isPinned`/`togglePin`, tested) key each
  concrete source (`cloud:anthropic:<model>`, `device:<id>`); the stack and mock
  never pin. New `SwipeRow.tsx` is a pointer-driven row: a tap picks the model,
  a swipe past a short commit distance fires Pin/Unpin with a success haptic, and
  the foreground tracks the finger 1:1 then springs back on release (reduced
  motion honored). `AppSettings.pinnedModels` persists the list. The model sheet
  renders pins under My Stack (swipe to unpin) and wraps the Cloud Providers /
  Local LLMs model rows in SwipeRow (swipe to pin). Green: typecheck, lint, 151
  tests, vite build, cap sync ios.

- **2026-08-25: complete Claude model lineup, and a corrected model catalog.**
  Founder wants OpenShore to be a full Claude client: every model the user's key
  can reach, listed and usable, no need for the Claude app. Added Fable 5
  (`claude-fable-5`) so the Cloud Providers sheet now lists Fable 5, Opus 5,
  Sonnet 5, Haiku 4.5 with blurbs. Centralized the catalog into one leaf module
  `lib/claudeModels.ts` (single source of truth for id, label, blurb, pricing,
  context) that the cloud driver, the model sheet, and `sourceLabel` all read.
  Fixed stale data against the first-party API rates: Sonnet 5 was listed at
  3/15 per MTok, it is 2/10; and the context windows were all a flat 200k when
  Fable 5 / Opus 5 / Sonnet 5 are 1M (Haiku 4.5 is 200k), which had been reading
  the context meter about 5x too high. The composer pill now shows a clean name
  ("Claude · Opus 5") instead of the raw model id. The cloud-driver context-meter
  test was asserting the old wrong 200k window; updated to the real 1M with the
  200k fallback for unknown models. Follow-up (not done): wire the real
  `output_config.effort` API param for the cloud path instead of the current
  system-prompt effort directive; the request shape already works with Fable 5
  (no thinking/budget_tokens/prefill sent). Green: typecheck, lint, 147 tests,
  vite build.

- **2026-08-25: model sheet restructured to the Claude "Select model" shape.**
  Root is now a header (X + "Select model"), My Stack as the default, an Effort
  row (opens a High/Medium/Low sub-sheet), and two category buttons that open
  dedicated sheets the way Claude's "more models" does: Cloud Providers and
  Local LLMs. Each has an honest empty state that routes to setup: Cloud with no
  connected providers shows "No connected providers, add your API to get
  started" to Connections; Local with no downloads shows "No connected local
  LLMs, download a model from the Marketplace to get started" to the
  Marketplace. When no stack exists yet (`settings.stack` undefined), My Stack is
  greyed and carries a "Create your stack to get started" link to the Stack
  screen. Rows are now grouped into rounded cards with dividers, matching the
  Claude grouping. Effort no longer lives in the composer; it is a selection in
  this sheet. Green: typecheck, lint, 143 tests, vite build.

- **2026-08-25: composer refinements (founder pass on the live app).** Boot
  splash hold cut to 1.5s (`SPLASH_MIN_MS`). Greeting is now the tile mark plus
  the line only, the OpenShore wordmark removed. Composer mic swapped from the
  emoji to the iOS keyboard dictation microphone (an inline outline SVG, matching
  Claude). The effort pill is replaced by a Claude Code style permission-mode
  pill: `</> Accept edits` by default, opening a Select-mode sheet with the three
  modes (Auto, Accept edits, Plan) and their descriptions. Effort stays a
  selection pinned at the top of the model sheet, as before. New
  `permissionMode` in settings (default acceptEdits) and `lib/permissionMode.ts`;
  it functions on the coding-agent surface, the driver event handler
  auto-answers tool approvals per mode (Accept edits approves file edits, Auto
  approves all tools, Plan approves nothing, cloud spend always asks), and is
  inert for plain chat, exactly as the mode picker is in Claude Code. Tests
  added for the mode logic; app suite 143. Green: typecheck, lint, 143 tests,
  vite build.

- **2026-08-25: native iOS voice dictation, on-device only (founder call).**
  Founder chose on-device-only recognition (mic audio never leaves the phone,
  matching the "your machine, your keys" posture) and to build now rather than
  wait for a clean TestFlight. New `oscode-speech` Capacitor plugin, third local
  SPM plugin, mirroring oscode-iap: `SFSpeechRecognizer` +
  `SFSpeechAudioBufferRecognitionRequest` with `requiresOnDeviceRecognition =
true`, driven by an `AVAudioEngine` input tap. Crucially it is JS-registered
  (`registerPlugin('OscodeSpeech')`), NOT imported in AppDelegate, so it needs
  no manual `project.pbxproj` linking, the exact trap that cost four fixes on
  oscode-llama; `cap sync` lists it in `CapApp-SPM/Package.swift` (verified: both
  the package ref and the product link landed) and Capacitor discovers it at
  runtime. CTO must-fixes all in: both `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription` (real sentences, no em dash); separate
  `SFSpeechRecognizer.requestAuthorization` and `AVAudioSession` record grants
  with every denial branch reported; audio session `.record`/`.duckOthers`,
  deactivated with `.notifyOthersOnDeactivation` on stop; interruption observer
  (call/Siri) stops cleanly; `available` reports false where on-device is absent
  so the mic hides instead of falling back to a server. `useDictation` now picks
  the backend: native on iOS, Web Speech on desktop/web, mic hidden where
  neither exists. Green: app typecheck, lint, 140 tests, vite build, and `cap
sync ios` clean. NOT device-verified (no macOS/Xcode here); the native side
  compiles for the first time on the next Codemagic archive, so expect a
  possible round of fixes like the earlier iOS work, and the on-device
  transcription itself is only provable on a real TestFlight install.

- **2026-08-25: mid-chat model switching, Claude-style (founder overrode the
  CTO's fresh-chat default).** The founder wanted Claude's actual behavior:
  keep the conversation, change the model, the next turn runs on the new brain
  with the full transcript as context. This is NOT the live hot-swap the CTO
  NO-GO'd (aborting a stream mid-token, re-homing in-flight approvals). The
  insight that made it safe: `attachDriver` already disposes the old driver and
  swaps in a new one while keeping the thread (it is the production reattach
  path), so the only new work is seeding the new driver with the transcript and
  gating the swap. New `switchModel(source)` store action: refuses to swap while
  a turn is streaming or an approval is pending (CTO guardrails), falls back to a
  fresh chat when there is nothing to carry or the target is a repo agent/demo
  (a different mode), otherwise reseeds and reattaches in place and drops a "Now
  using X." note in the transcript. `seedFromTranscript` carries only the spoken
  user/assistant turns (tool/status artifacts stay behind). The three chat-brain
  drivers (cloud Claude, stack, on-device) gained an optional `seed` constructor
  arg that pre-fills their history. The top-bar model badge clears on switch so
  it reflects the new brain immediately. Tests added (seed extraction); app
  suite 140. Green: typecheck, lint, 140 tests, vite build. Not device-verified
  (no iOS here). Edge left as-is (low risk): switching right after an errored
  turn that ended on a user message could seed two consecutive user turns; the
  Anthropic API merges those, and the idle+approval gates make it rare.

- **2026-08-25: vision routing (CTO-ruled), plus the two composer forks the CTO
  parked.** Built on the composer rework above after a CTO review of the three
  deferred forks. **Fork 2 (GO, shipped):** images now route only to a brain
  that can see them. New `sourceSupportsVision(source)` in `state/types.ts`
  (default false everywhere, true only for a direct Claude chat today; the one
  place to extend for BYOM/Gemini vision or the desktop daemon later). The
  composer + button is gated: on a text-only model it shows "This model reads
  text only. Switch to Claude to send images." instead of stranding the file,
  and a send-time guard strips images if the model changed. No more silent drop
  (the trust hole the CTO flagged). Tests: effort, attachments, and vision
  resolvers added (app suite now 138). **Fork 3 (CTO NO-GO on hot-swap):** kept
  fresh-chat-on-switch (each conversation is bound to one driver; real
  mid-thread driver hot-swap is large blast radius, low value: streaming
  aborts, approval/tool state re-homing, N-by-N history reshaping). NEEDS
  FOUNDER RATIFY that fresh-chat is the intended behavior to keep. A bounded
  later enhancement is captured in the action list: "continue this thread with
  [new model]" = fork a new chat seeded with the transcript, no live handoff.
  **Fork 1 (native iOS voice) BLOCKED, by CTO recommendation + a founder
  decision:** the mic works via Web Speech on desktop/web but the iOS WKWebView
  needs a native SFSpeechRecognizer Capacitor plugin. The CTO says sequence it
  AFTER a confirmed clean TestFlight build (so any red is unambiguously the new
  plugin, not a latent archive issue we just spent four fixes on), and it needs
  the founder's call on the on-device-vs-server speech data-egress posture
  (on-device preferred for an on-device-first tool; server recognition is
  allowed but must be disclosed). Must-fixes captured for when it proceeds:
  both `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`
  (real sentences, no em dash); request both SFSpeech and AVAudioSession
  permissions with every denial branch handled; `requiresOnDeviceRecognition`
  where supported; deactivate the audio session with
  `notifyOthersOnDeactivation` on stop; verify `cap sync` lands the plugin in
  CapApp-SPM and the App target links the product with the correct
  product-vs-module import name (the exact trap from last time). Green through
  Fork 2: app typecheck, lint, 138 tests, vite build.

- **2026-08-25: opening chat reworked to the Claude shape, and a five-control
  composer.** Empty state now mirrors the Claude app: just the wave-mark and a
  time-of-day greeting, no header title, no "chat and build" subtitle, no
  suggestion pills. Top bar keeps only the hamburger (phone) and the OpenShore
  ProfileStatus indicator. The composer gained the five Claude-Code controls:
  add (+), a model pill (default "My Stack"), an effort pill (default High), a
  mic, and send/stop. New model+effort sheet (`ModelSheet.tsx`): effort pinned
  at the very top (High/Medium/Low segmented), then My Stack, then connected
  cloud providers (Claude opens a sub-sheet of Claude models; other providers
  point to the stack, which is where they actually run), then on-device models.
  New state: `effort` in AppSettings (default High), mirrored to a live value
  (`lib/effort.ts`) that the cloud-Claude and stack drivers fold into their
  system prompt, so the choice actually shapes answers. Attachments
  (`lib/attachments.ts`): + captures photos/files via the WebView picker (works
  in the iOS WKWebView, no native plugin), shown as chips, and image blocks are
  forwarded to the cloud-Claude vision path (`ChatDriver.send` gained an
  optional `attachments` arg; non-vision drivers ignore it). Voice
  (`useDictation.ts`): Web Speech dictation where the platform provides it
  (desktop, web); the iOS WKWebView does not expose SpeechRecognition, so the
  mic is honest there (a toast) rather than fake. Green: app typecheck, lint,
  128 tests, vite build. **Known scope / follow-ups:** (1) native iOS voice
  needs a Capacitor speech plugin, deliberately deferred so it cannot
  destabilize the just-fixed iOS archive; (2) vision is wired for the
  cloud-Claude path only, other drivers ignore attachments; (3) switching the
  model while a chat is open starts a fresh chat with the new brain (each
  conversation is bound to one driver), rather than swapping mid-thread. Not
  build-run-verified on device (no macOS/iOS here); validated by the gate.

- **2026-08-25: fixed the real cause of the "Unable to resolve module
  dependency: 'OscodeLlama'" archive failure, a wrong import name.** The
  oscode-llama Package.swift names the library PRODUCT `OscodeLlama` but its
  TARGET (and therefore its Swift MODULE) `OscodeLlamaPlugin`. Swift `import`
  takes a module name, so `import OscodeLlama` in AppDelegate.swift could never
  resolve. The error was byte-identical across builds because the import line
  never changed and no module named `OscodeLlama` exists. Fixed to `import
OscodeLlamaPlugin`. The earlier package-link commit (6fc341d) was still
  necessary and correct: it links the `OscodeLlama` product to the App target,
  which is what makes the `OscodeLlamaPlugin` module available to import; the
  wrong import name was masking whether that link worked. Both classes
  AppDelegate calls (`OscodeLlamaPlugin.deliverPushToken`,
  `ModelStore.handleBackgroundSessionEvents`) live in that module. Still not
  locally build-verifiable (no macOS/Xcode); reasoned from the Package.swift
  product-vs-target naming and Swift's module-import rule.

- **2026-08-25: fixed the first two Codemagic archive failures (fresh iOS
  Swift compile, expected per the earlier note above).** (1)
  `ModelStore.swift`'s four `URLSessionDownloadDelegate`/`URLSessionDelegate`
  methods were missing `public`, required because the class and the protocol
  are both public. (2) `AppDelegate.swift` does `import OscodeLlama` directly
  (to call `OscodeLlamaPlugin.deliverPushToken` for the completion-push
  feature), but the App target only linked the `CapApp-SPM` umbrella package,
  never `OscodeLlama` itself, so the module could not resolve. Added a second
  `XCLocalSwiftPackageReference` + `XCSwiftPackageProductDependency` to
  `App.xcodeproj/project.pbxproj`, pointed at the exact same pnpm virtual-store
  path `CapApp-SPM/Package.swift` already resolves
  (`node_modules/.pnpm/oscode-llama@file+app+plugins+oscode-llama_@capacitor+core@8.5.0/node_modules/oscode-llama`)
  rather than the `app/plugins/oscode-llama` source directly, since pnpm
  copies (not symlinks) into that store, so the two paths are different
  package identities to SwiftPM and pointing at both would risk a duplicate
  package/duplicate symbol conflict. **Known fragility:** unlike
  `CapApp-SPM/Package.swift` (regenerated by `cap sync`), this hand-added
  pbxproj reference does NOT auto-update if that pnpm store hash ever changes
  (e.g. a future `@capacitor/core` version bump). If a build ever fails again
  with "Unable to resolve module dependency: 'OscodeLlama'", recompute the
  path from the current `CapApp-SPM/Package.swift` dependency string. Neither
  fix could be locally build-verified (no macOS/Xcode available in this
  session); both were reasoned from the Codemagic error text and Xcode project
  file conventions. Landed on branch
  claude/splash-screen-openshare-rename-sd0580 for merge to main; next
  Codemagic run will show whether more first-compile issues remain.

- **2026-08-25: boot splash on open, and the app is now named OpenShore.**
  Two founder asks. (1) Opening OpenShore no longer shows a blank window before
  the UI paints: a branded boot splash (the wave-mark plus the OpenShore
  wordmark on the app background) is painted the instant index.html parses, so
  it covers the desktop Electron blank-window gap and the iOS launch-image to
  React-mount gap alike; main.tsx cross-fades and removes it once the first
  frame renders, honoring prefers-reduced-motion. The in-app opening greeting
  (brand lockup plus time-of-day greeting in the empty chat) is unchanged and
  still shows on a cold open. (2) The product display name changed from "OS
  Code" to "OpenShore" everywhere a person reads it: the app/window/bundle
  display names (capacitor appName, electron title, package productName,
  index.html title, iOS CFBundleDisplayName), the topbar and greeting wordmark,
  the guide system prompts ("You are OpenShore..."), and all in-app copy.
  Technical identifiers are deliberately left as-is (appId ai.openshore.oscode,
  the oscode-\* packages, the os-code workspace package, the osc CLI) so bundle
  IDs, IAP, and builds do not break. Green: app typecheck, lint, 116 tests, and
  vite build all pass. Landed on branch
  claude/splash-screen-openshare-rename-sd0580 for merge to main. Follow-up:
  the public product page (Open-Shore-LLC-Homepage, openshore.ai/os-code) still
  says "OS Code"; mirror the rename there when the founder is ready.

- **2026-08-25: completion push, so you can code with the app closed.** Parity
  with Claude Code's "write a prompt, close the app, get told when it is done."
  The desktop path already runs the agent loop on the user's own daemon and
  journals every step for replay, so the run continues while the phone is closed;
  the missing piece was telling the user when it finishes or blocks on an
  approval. Built content-free push across three layers. Supabase: migration 0009
  (push*devices, push_grants, push_sends), a new \_shared/apns.ts ES256 provider
  signer with token caching, and push-register / push-grant / push-send. The
  daemon (src/daemon/push.ts) watches each session's live events and fires a
  push on approval-request (always) or an idle task-done (queue empty), unless a
  fresh phone beat says the user is watching; the grant is sealed at rest, keyed
  per owning user. The app registers for APNs (AppDelegate + the llama plugin,
  aps-environment read from the provisioning profile), hands the daemon a grant,
  and beats while foreground. Auth model per the CTO review (GO with must-fixes,
  all folded in): the daemon is already fully trusted, so the credential is an
  opaque revocable grant, not a signed short-lived JWT; push-send derives the
  target user and devices solely from the grant, with a per-session cooldown, a
  daily ceiling, and (session, kind, seq) de-dupe. On-device (Harbor) and
  phone-orchestrated cloud/stack turns cannot run closed (iOS limit) and are out
  of scope; the standing off-device principle is in DECISIONS.md. Gates green
  (os-code 29 files / 227 tests incl. a new push.test.ts, app 20 / 116, vite
  build, both em-dash guards).
  **Server side is now LIVE (2026-08-25):** the founder set the APNS*\* secrets,
  ran `supabase db push` (0009 applied), and deployed push-register /
  push-grant / push-send. Still needed before the phone can register: confirm
  Push Notifications is enabled on the ai.openshore.oscode App ID (Apple
  Developer, Identifiers), and merge this branch to `main` so Codemagic cuts a
  TestFlight build carrying the entitlement and the new native code (the
  simulator cannot receive a push token; needs a real device).
  Swift builds on Codemagic, not verifiable in this sandbox.
- **2026-08-24: model downloads (and inference) survive backgrounding.** Root
  cause of "the download failed because I closed the app": `ModelStore` ran the
  GGUF download on a foreground `URLSession`, which iOS suspends on background
  and kills on close, and the whole completion contract was a live
  `CAPPluginCall` that evaporated with the app. Rebuilt it on a background
  `URLSession` (`URLSessionConfiguration.background`, fixed identifier, a
  process-wide `ModelStore.shared` singleton): the system daemon keeps
  transferring while the app is suspended or terminated and relaunches the app
  to finish. Each task carries its model id in `taskDescription` so it is
  recovered across a relaunch (`getAllTasks`), with a recovery gate that holds a
  fresh start until recovery reports what is already in flight, so no duplicate
  download. AppDelegate now implements
  `handleEventsForBackgroundURLSession` -> `ModelStore.handleBackgroundSessionEvents`.
  On launch the JS init calls a new `activeDownloads()` and re-drives
  `ensureHarbor` / `ensureHarborMini` for anything still transferring, so the
  progress bar reappears instead of a dead one; a download that finished while
  away was already caught by the `listModels` reconciliation. Also wrapped
  on-device `load` and `generate` in finite-length `beginBackgroundTask`
  assertions so a model load or a mid-stream reply is not cut off the instant
  the app leaves the foreground. No `UIBackgroundModes` entry needed;
  `docs/app-review-notes.md` documents the justification. Gates green (app: 20
  files / 116 tests, typecheck, lint, em-dash guard incl. `.swift`). Swift is
  built on Codemagic, not verifiable in this sandbox.
- **2026-08-21: individual Personal + free/paid gating + iOS IAP (4 phases).**
  Free is now chat only; the coding agent and Marketplace need Personal ($20/yr),
  bought via Apple IAP on iOS and Stripe on web/desktop, both writing one
  account entitlement. Phase 0: `user_entitlements` + `apple_links` (0006/0007),
  the `personalUnlocked` resolver, individual read path. Phase 1: Stripe
  individual checkout/webhook/portal (CTO-reviewed; a HIGH in-place-migration bug
  found and fixed via 0007, plus a cross-rail clobber pre-empted). Phase 2:
  native StoreKit 2 Capacitor plugin `oscode-iap` + the Apple server rail
  (`_shared/apple.ts` via Apple's official verifier, `link-apple-purchase`,
  `apple-notifications` with idempotency 0008; CTO found and fixed F1 cross-rail
  false-revoke, F2 sandbox-in-prod, F3 restore revenue-leak). Phase 3: the gate
  flip -- `newConversation({kind:'desktop'})` and `setView('marketplace')`
  intercept to a Personal paywall (CMO copy), a lock pill, buyPersonal/restore
  actions. All gates green (222 engine, 93 app, vite build); commits across
  e9170a4..f1a70dd. NOT yet deployed: needs the founder config in the action item
  above (Stripe Personal price, migrations + function deploys, Apple product +
  secrets + root CA, sandbox validation). Reversible: the gate only bites once
  the entitlement rails are live, and there are no public users yet.
- **2026-08-20: CI goes green on main.** The new CI workflow (added in the
  review remediation) was red on its first three runs: `pnpm -r typecheck`
  ran before the engine was built, so the app package could not resolve
  `os-code/protocol` (which points at os-code's built dist). Added a "Build the
  engine" step (`pnpm --filter os-code build`) before lint/typecheck/test,
  matching catalog.yml. Run #4 on `73244eb` is fully green: install, build,
  lint, typecheck, and all 312 tests (222 engine + 90 app) pass in CI. Commit
  `73244eb`.
- **2026-08-20: full-platform code review + remediation.** A five-pass senior
  review (engine core/security, engine breadth/builder, money/backend,
  app+electron, infra) produced `CODE-REVIEW-FINDINGS.md` (6 P0, ~28 P1, plus
  P2s). All of it was then fixed in two gated waves, test-backed. Wave 1
  (engine/security/infra): journal-redaction JSON corruption, outbox reverting
  desktop commits, keychain-unreadable key-loss, daemon member-as-admin, egress
  redirect + httpFetch DNS-rebind SSRF, abort/guardrail session-bricking, atomic
  config/usage writes, Stack Health day/DST bucketing, iGPU budget, plus a real
  CI workflow (lint/typecheck/test on every push, which nothing ran before) and
  catalog-pipeline hardening. Wave 2 (billing/app): the live money path per the
  CTO ruling. The billing endpoints authorized the SERVICE-ROLE identity so the
  admin check saw NULL (the purchase path may have been 403ing every real
  admin); now a caller-scoped client makes `auth.uid()` the caller. Entitlement
  is revoked on cancel/past-due/payment-failure (was never revoked), `orgs` is
  RLS-locked against client tier/customer writes (UPDATE and INSERT), the webhook
  500s on a failed write so Stripe retries, idempotency/ordering guard, real
  seats, double-checkout routing. `org_entitlements.status` is the single
  authoritative source; the dead entitlement-claim function was deleted. App
  side: blank-transcript-on-resume, listener leaks, persistence, brand-commit
  a11y. Commits `9c60273`/`d3926fa` here, `53e9c12` marketing.
  **Founder actions before this is live:** apply migrations 0004 then 0005 and
  redeploy the edge functions (with/before the app); enable Supabase
  refresh-token rotation; run one real test-mode purchase to confirm P0-1; add
  the `docs/app-review-notes.md` ATS justification to App Store Connect.
- **2026-08-20: at-rest encryption for the engine.** Session journals and
  titles now seal with AES-256-GCM in the exact app-side `enc:v1` format
  (bidirectional WebCrypto cross-test pins the compatibility). The data key
  rides the existing credential store: OS keychain preferred, machine-keyed
  encrypted file at 600 as fallback, with the backend reported honestly and the
  key self-upgrading into a keychain when one appears. Lines are redacted then
  sealed; readers everywhere tolerate legacy plaintext; a one-shot atomic
  idempotent boot migration (Electron host + daemon) reseals pre-encryption
  sessions. The Stack Health privacy seal is now measured, not asserted: a
  full-disk prefix scan plus the real key backend decide its color, and green
  requires keychain + zero plaintext lines. Settings' "Encrypted on this
  device" card shows the live measured facts. 12 new tests; suites now
  os-code 162 / app 76, all gates green.
- **2026-08-20: Marketplace + Stack Health + Nightshore site.** Three builds,
  branch `claude/os-code-openshore-styling-4bk7mp`, all gates green (os-code
  150 tests, app 76, vite build).
  - **Marketplace** upgraded to a real model store: a CI-only catalog builder
    (`os-code/scripts/build-catalog/`, own `tsconfig.scripts.json`, run via
    `tsx`, isolation-guarded) that reads HF + Ollama METADATA ONLY and computes
    provenance-backed 5-star capability ratings from a data table, with license
    fail-closed (SPDX allow-list), a bad-build regression gate, and an editorial
    overlay. Client storefront: search, filter rail, three sorts (Recommended
    default, popularity labelled honestly, newest, best-fit), osCodeFit set
    apart above true half-star capability lanes with provenance tap-through,
    fit/pick badges, shore-edge accents, and 2-3 model compare. Schema extended
    with optional ratings/popularity/recency/recommended (back-compat). Docs in
    `os-code/docs/MARKETPLACE.md`.
  - **Stack Health** (Phase 1): a fully local dashboard, computed by a new
    engine aggregator (`os-code/src/insights/stackHealth.ts`) folding the
    session journals + `usage.json` into three rings (Local/Private, Flow,
    Saved), a dollars-saved count-up (local tokens repriced at a named Claude
    Sonnet basis, presented as an estimate), cloud flips, tools/approvals,
    outcomes, a session-grained timeline, and a crew view over the configured
    stack. Read-only bridge (`osc:stackHealth`), pure payload types through
    `os-code/protocol`, honest privacy seal (telemetry off true, data-left-
    device reflects real cloud calls, encrypted-at-rest a candid amber until the
    separate sealing task ships). Screen at `app/src/screens/StackHealthScreen`.
    Docs in `os-code/docs/STACK-HEALTH.md`.
  - **Nightshore site**: `openshore.ai/os-code` given a Creative Studio delight
    pass (coda teal accent, hero sub-CTAs, pillar ghost-wave glyph, offer
    hover-spine bloom, contrast + FAB restraint) in the marketing repo.
  - Advisor passes: CTO (go with must-fixes, all applied) and Creative Studio
    (delight/brand pass across all three surfaces, folded in).
- **2026-08-18: native app pivot.** Founder direction: OS Code is a native
  app for iOS and the Linux desktop, cloning the Claude app experience on a
  local stack; the CLI is parked. The repo became a pnpm workspace: this
  package is now the shared ENGINE (browser-safe `os-code/protocol`
  subpath, daemon CORS + phone endpoints, quarterback taxonomy with
  writing/analysis slots, pocket-class on-device models in the catalog).
  `app/` holds the React app, the Electron shell with the engine embedded,
  the Capacitor iOS project, and the `oscode-llama` Swift plugin (llama.cpp
  via LLM.swift v3.0.3). CI to TestFlight via `codemagic.yaml`; founder
  walkthrough in `docs/TESTFLIGHT.md`. Workspace gate green: 97 engine
  tests + 10 app tests. Root README is the product front door now.
- **2026-08-18: delight polish pass.** Streaming smoother, model-load ticker,
  syntax-tinted diffs, cursor blink, approval pressed-state, real download
  progress bar (Ollama `/api/pull`), low-color terminal fallback, and `/find`
  transcript search. New pure modules (`tui/smoothing.ts`, `tui/syntax.ts`,
  `tui/transcriptSearch.ts`) and 16 new tests. Suite: 97 passing.
- **2026-08-18: initial complete build.** Repo scaffolded from empty to a
  working product in three commits (core foundation; breadth layer; TUI,
  commands, tests, docs). Toolchain: Node 20+, TypeScript 5.9 strict ESM,
  Ink 5 + React 18, zod 4, vitest 4, eslint 8 + prettier. See DECISIONS.md
  for every judgment call.
