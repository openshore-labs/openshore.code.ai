# Parked feature ideas (founder-requested build prompts)

> Historical reference. All three features are BUILT; see CLAUDE.md.
>
> Moved out of `PROGRESS.md` on 2026-09-05. BYOM, gitOS ("Repositories"), and
> Vault all shipped in August 2026; the prompts below are kept only as the
> record of what was asked for.

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
