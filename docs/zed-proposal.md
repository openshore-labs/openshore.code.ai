# Proposal: what OpenShore takes from Zed, and what it leaves (2026-09-25)

Status: PROPOSAL. Nothing is built. Founder brief, 2026-09-25: a deep analysis of
the Zed editor against the OpenShore desktop, focused on what Zed has that
OpenShore does not and how it works; what people like, what does not work, and
what they wish for; a clear proposal of what to remove, change, and fix, including
what is not worth doing; and how to take a slice of that market, "remembering,
too, that the point of OpenShore is to lower the barrier of entry, where Zed
kind of does that, but it is still developer-focused."

The evidence is in `zed-research.md` (Zed's docs read from source, GitHub
reaction counts pulled live, a sweep of this repo, and the market). All eight
advisors reviewed a first draft; their memos are in `zed-advisory-memos.md`.
This document is the draft revised by their consensus. Where they split, the
split is named and the call is left to the founder.

## The answer in ten lines

1. Zed is an editor for experienced developers that grew an agent. OpenShore
   is an agent for people who do not live in an editor. Build no editor. All
   eight advisors agree.
2. What is worth taking from Zed is its trust machinery, not its editing
   machinery. A folder's own settings do nothing until the person allows them,
   a checkpoint is taken before every prompt with a one-tap restore, and the
   approval is short. A non-expert needs these more than an expert does,
   because a non-expert cannot judge a diff or a shell command.
3. The analysis found a live hole in OpenShore, and fixing it comes first. A
   cloned repository's `os-code.config.json` can silently loosen OpenShore on
   the desktop:
   - run its own command after the agent's first edit;
   - make shell and cloud spend silent;
   - send a stored API key to another host;
   - route the project's secrets to a remote server that OpenShore labels
     local;
   - write "always allow" grants that ship to everyone who clones.

   Fix it before the next distribution build and before the GitHub App goes
   public.

4. Seat the local context window. The engine sends Ollama no `num_ctx`, so
   Ollama serves its small default while the engine plans against the model's
   trained 32K. This is the same "silently crippled" local setup Zed users
   complain about, and it may be costing the eval points today.
5. Offer undo rather than review. Put "Undo these changes" (with Redo) on
   every task, say honestly what undo cannot reach, and add a per-file Undo on
   the Changed files card. Do not ask a non-expert to keep or reject hunks.
   This is checkpoints and Rewind, already step 2 of the harness plan, built
   inside the Rewind design settled on 2026-09-14.
6. Make verify need no setup: detect the project's own check and show the
   result as a pill. For someone who cannot read "42 passed", add "See it
   running" and "It works / Not yet". Zed's most-voted open request is test
   runner integration (875 votes).
7. Fix the public copy that is false today. "Edits with diffs you approve" is
   false under the Accept edits default. "Your keys never leave your devices"
   stays untrue until the trust fix lands. Also correct "Harbor Light", the
   Marketplace pillar while the room is grayed out, and every $20.
8. Treat the Agent Client Protocol (ACP), Zed's protocol for plugging in
   outside agents, as later work in both directions, each behind its own gate.
   That means never before trust and undo, a license on the engine, an eval
   number measured on an Apache-licensed model, and each agent vendor's terms
   in writing.
9. The slice to take is not Zed's fans. It is:
   - the people Zed bounces at setup;
   - the agent delegators who use Zed only as a viewer;
   - local-first users put off by Zed's telemetry and silent downloads;
   - next door, Ollama's 8.9M developers, and non-developer builders tired of
     paying credits to fix the AI's own mistakes.

   The villain is the meter, not the editor.

10. Do not build any of these: a code editor, edit predictions, an inline
    assistant, keymaps or Vim mode, a debugger, a language-server client, an
    extension platform, live multiplayer, SSH remoting, dev containers, a
    native rewrite, or a plan that resells tokens.

## Zed in one paragraph

Zed Industries has raised more than $42M, including a Sequoia-led Series B in
August 2025. Zed 1.0 shipped on 2026-04-29 and the repository has 90.9k GitHub
stars. It had 150K monthly active developers in August 2025, claimed "hundreds
of thousands" daily at 1.0, and is used by 7.3% of Stack Overflow 2025
respondents.

It is a GPU-rendered Rust editor for experienced, keyboard-heavy developers,
strongest with Rust and Go, and best on macOS. Its fans praise, in order:

- speed and a native feel;
- bringing their own agent (through ACP) and their own key;
- an AI that stays out of the way, with a real off switch;
- the way it lets them review what an agent did.

Its critics cite:

- a thin extension API;
- "AI eating the editor";
- memory spikes from language servers;
- the September 2025 move to token pricing;
- telemetry on by default;
- silent Node downloads, and no offline mode.

Beginners bounce off it. They cite JSON settings and a UI that runs through
the command palette. Setting up an outside agent confuses them. Local models
are crippled by a 4,096-token default unless you edit a settings file.

## What Zed has that OpenShore does not, how it works, and the call

TAKE means build it, adapted. ADAPT means take the idea, reshaped for a
non-expert. LATER means build it behind a gate. SKIP means not worth it here.
HAVE means OpenShore already has an equivalent.

| Zed has                                                                                   | How it works in Zed                                                                                                                                                                                                                         | OpenShore today                                                                                                                                                                                  | The call                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree trust                                                                            | A newly opened folder's project settings, language servers, and MCP servers do nothing until the person trusts the folder.                                                                                                                  | A repo's `os-code.config.json` is merged over the person's config, with only `daemon.*` dropped (`config/load.ts:66`). The desktop loads it for every chat in that folder (`engineHost.ts:255`). | TAKE, first, as an allowlist. See Fix now.                                                                                                                    |
| Checkpoints                                                                               | Before each prompt, Zed writes the working tree into a commit that no branch points to. Restore rewinds the thread and puts the files back. Large and binary files are skipped. An open issue calls it "irreversibly destructive" (#28676). | No undo for the person. The best-of-N picker restores touched files internally. Accept edits is the default.                                                                                     | TAKE, as harness step 2. Restore is itself checkpointed so an undo can be redone.                                                                             |
| Review changes                                                                            | A multi-file buffer where each hunk is kept or rejected.                                                                                                                                                                                    | Diffs appear in cards. Approval is all or nothing per edit, and nothing can be rejected once it lands.                                                                                           | ADAPT: per-file Undo on the Changed files card, with hunks behind a disclosure at most. No Keep button where the change has already landed.                   |
| Tool permissions                                                                          | Allow, deny, and confirm patterns. Chained shell commands are split and each part is checked. The card offers Allow once, Always for tool, and Always for pattern.                                                                          | Four modes. "Always allow in this project" is scoped to a folder or a command's first word, and chained commands are split already (`permissions/index.ts:58`).                                  | HAVE. Keep our plain "Always allow in this project" over a regex pattern. Move where the grants are stored (Fix now).                                         |
| OS sandbox for the agent's shell                                                          | Seatbelt on macOS, bubblewrap on Linux. Writes are limited to the project, `.git` is read-only, and the network is off, with grants through a proxy. On by default since about August 2026.                                                 | Approvals, a file jail, and egress rules for web tools.                                                                                                                                          | LATER, on evidence. Linux first. Never say "safe".                                                                                                            |
| ACP host                                                                                  | Outside agents (42 in the registry, among them Claude Agent, Codex, and Gemini CLI) run as subprocesses. Their tool calls, diffs, and permission requests show in Zed's panel. The agent owns its model, auth, and billing.                 | CLI Pairing runs `claude -p` or `codex exec` as one approved shell command and returns text.                                                                                                     | LATER, as CLI Pairing's new transport ("Guest agents"). See the gates.                                                                                        |
| ACP agent                                                                                 | Any editor that speaks ACP (Zed, JetBrains, Neovim, and about 50 more) can run a registered agent.                                                                                                                                          | Absent.                                                                                                                                                                                          | LATER, a measured bet. See the gates.                                                                                                                         |
| MCP client                                                                                | Tools and prompts from outside servers. A project's servers wait on trust.                                                                                                                                                                  | Absent; "MCP-stdio on the engine" is open in PROGRESS.                                                                                                                                           | LATER, after trust. Named "Tools", per app.                                                                                                                   |
| Skills and instruction files                                                              | `SKILL.md` folders in `.agents/skills`. Reads the first of `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, copilot instructions, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`.                                              | Reads OSCODE.md, CLAUDE.md, or AGENTS.md (`instructions.ts:9`). The Wayfinding Skills switch gates a recipes note.                                                                               | ADAPT, small. A project from Cursor, Windsurf, Cline, or Copilot is understood on day one.                                                                    |
| Test runner and diagnostics                                                               | A diagnostics tool fed by the language server. Test runner integration is the most-voted open request (875).                                                                                                                                | Verify runs only if the person writes a command into config, and the result shows as an ochre note.                                                                                              | ADAPT: verify with no setup, shown as a pill.                                                                                                                 |
| Parallel threads in git worktrees                                                         | Each thread can run in its own copy of the repo.                                                                                                                                                                                            | Routines edit the working copy.                                                                                                                                                                  | LATER, for routines, after a routine's first real scheduled run. The copy says "on a copy".                                                                   |
| Follow the agent                                                                          | The editor jumps to each file the agent touches.                                                                                                                                                                                            | Tool cards name each step.                                                                                                                                                                       | ADAPT, minimal: an "Open in your editor" link on the Changed files card now. A read-only Files view waits until testers ask for it.                           |
| Git panel                                                                                 | Staging, branches, conflicts, blame, and history. No pull-request review.                                                                                                                                                                   | Agent git tools, and the branch and a dirty dot in the header.                                                                                                                                   | SKIP.                                                                                                                                                         |
| Edit predictions, inline assistant, keymaps, Vim, themes                                  | Editor features.                                                                                                                                                                                                                            | No editor.                                                                                                                                                                                       | SKIP (CX, 2026-09-24).                                                                                                                                        |
| Debugger, REPL, tasks                                                                     | Developer tooling.                                                                                                                                                                                                                          | The verify loop.                                                                                                                                                                                 | SKIP. For this person, the debugger is the agent running the tests and fixing what fails.                                                                     |
| Live multiplayer                                                                          | Channels, shared projects, calls, and screen share. Most users ignore it, it is off by default on Business, and its vision moved to Delta, a separate app.                                                                                  | Org projects and a Team vault.                                                                                                                                                                   | SKIP. Watch Delta.                                                                                                                                            |
| SSH remoting, dev containers                                                              | A headless server on the remote machine, with the UI kept local.                                                                                                                                                                            | The daemon over Tailscale, with phone pairing.                                                                                                                                                   | HAVE, done differently, and better suited to this person.                                                                                                     |
| Extensions (WebAssembly)                                                                  | Languages, themes, debug adapters, and MCP servers. No custom UI. Thin extensions are the top reason people do not switch to Zed.                                                                                                           | Currents, a fixed list.                                                                                                                                                                          | SKIP. MCP, skills, and ACP are our extension story.                                                                                                           |
| GPU-native speed                                                                          | GPUI, the most-praised thing about Zed.                                                                                                                                                                                                     | Electron, with no footprint numbers.                                                                                                                                                             | SKIP a rewrite. Measure idle RAM, startup time, and time to first token on the reference box. Every megabyte the shell holds is one a local model cannot use. |
| Hosted models at list price plus 10%; Business at $30 a seat a month; a free student year | Revenue from tokens and seats.                                                                                                                                                                                                              | Flat bands, your own keys, no markup.                                                                                                                                                            | SKIP the token business. Reach education through the teacher (below).                                                                                         |
| Telemetry on by default; silent downloads; no offline mode                                | Zed's open pain points.                                                                                                                                                                                                                     | No telemetry, downloads ask, and it works offline.                                                                                                                                               | HAVE. Say so without naming Zed.                                                                                                                              |

## What people love, what fails, and what it means here

These are Zed users' own votes and words. Details and links are in
`zed-research.md`.

- **What they love:** speed and a native feel first. Next comes bringing their
  own agent or key: "I can leverage my Claude subscription instead of paying
  for API tokens". After that come an AI with an off switch, and reviewing the
  agent's work. For us, the lesson is predictability and control, not speed.
  We cannot win on speed and should not claim it.
- **What fails:**
  - Thin extensions, and "AI eating the editor". These are editor fights we
    skip.
  - Token pricing: "sucks for forecasting".
  - Node downloaded without consent: 285 votes, severity S1, open since June 2024.
  - No offline mode.
  - Beginners who "didn't understand how to set up claude code integration".

  For us, the pricing, downloads, offline, and setup complaints are openings.
  Each is a promise OpenShore makes and must keep.

- **What they wish for:**
  - Test runner integration (875).
  - Planning mode (135).
  - Voice input (83).
  - "A mobile app to control my Agents panel runs remotely" (75).
  - Offline mode (165 plus 151).
  - Per-project AI settings (32).

  OpenShore has built most of these, but several have never been checked on a
  real device (voice mode, the phone driving the desktop's terminal, per-project
  currents). Until they are, no copy says they ship.

## The proposal

### Fix now (session 1, before the next distribution build)

1. **Project trust as an allowlist.** The CTO verified the hole in code, and
   the Chief of Staff, CMO, CX, and Board widened it.

   What the hole is today:
   - The verify command in a repo's file runs through `execSync` with the full
     environment after any write (`loop.ts:338`, `harness/verify.ts:61`).
   - A project-memory write is auto-allowed, so "Ask first" does not stop it.
   - A wildcard allow rule or a loosened default silences shell, push, and
     cloud spend (`permissions/index.ts:179`). `guardrails.maxDollars` can
     raise the spend cap.
   - `providers.anthropic.baseUrl` sends the stored key to any host
     (`anthropic.ts:67`), and an `apiKeyEnv` sends any environment variable
     as a bearer token (`openaiCompatible.ts:57`).
   - Every OpenAI-compatible provider reports itself as local
     (`openaiCompatible.ts:37`). So a remote address gets no cloud card and a
     teal pill, and it receives the project's decrypted secrets
     (`bootstrap.ts:177`).
   - `vault.dir` points silent reads anywhere.
   - `sync.autoPushDefaultBranch` lets a repo opt itself into pushing main
     (`git/reconcile.ts:193`).
   - "Always allow in this project" writes into the tracked file
     (`load.ts:173`). `gitCommit` stages everything and the app pushes, so one
     person's grant reaches every clone.
   - The agent can write `.git/config` (a `core.fsmonitor` entry then runs on
     the next `gitStatus`) and the config file itself.
   - `claude -p` skips Claude Code's own folder-trust prompt, so CLI Pairing
     in a clone runs that repo's `.claude` hooks.

   The fix, as the CTO and Chief of Staff shaped it:
   - A project file may set `ux` and `humanizer`, and may only tighten
     anything else (a stricter rule, a lower cap).
   - It may propose a verify command. That asks once in plain words, and the
     answer is remembered on this computer, keyed by the folder's real path,
     its origin, and a hash of the command. A pull that changes the command
     asks again.
   - These never come from a project file: a provider's `baseUrl`, `kind`, or
     any `*KeyEnv`; `stack`; any loosening of egress, permissions, or
     guardrails; `trustedRepos`; `vault.dir`; `catalog`; `license`;
     `sync.autoPushDefaultBranch`.
   - Allow grants live in the machine's config. Grants already sitting in
     repo files are read as proposals.
   - "Local" is judged by address (loopback, LAN, tailnet), not by provider
     kind: for the cloud card, the pill color, and the secrets gate.
   - Agent writes to `.git/**` are denied. Writes to `os-code.config.json`
     always ask.
   - CLI Pairing asks before its first run in a cloned folder.
   - A CI test classifies every config key as project-allowed, tighten-only,
     or machine-only, and fails on any key it has not classified. Each vector
     above gets its own test.
   - Two supersession lines go in DECISIONS: the 2026-09-05 `daemon` ruling
     widens into this allowlist, and allow rules move to the machine.

   Sizes differ by basis: the CFO says 1 to 1.5 session-days, the CTO 3 to 4
   days.

2. **Seat the context window.** The engine calls Ollama's native `/api/chat`
   with no `num_ctx` (`openaiCompatible.ts:214`). It budgets 70% of the
   model's trained context (`compaction.ts:66`), so Ollama drops early turns
   before compaction ever fires, and the context meter reads low.
   - Send `num_ctx` sized to RAM. Keep it the same for every call to a model,
     because a change reloads the model.
   - Report the same number from `capabilities`, and wire up
     `compactAtContextFraction`, which nothing reads today.
   - A 3B's cache is about 0.6 GB at 16K, so seat 16K on the 7.6 GB reference
     box.
   - Show the window on the seat pill ("16K context on this computer").
   - A BYOM seat pointed at Ollama's `/v1` cannot carry the option, so it says
     so.
   - Re-run `osc eval --deep` with and without, and watch for the swap stall
     that sank the 7B.
3. **The eval that decides the floor model.** The founder runs
   `osc eval --deep` once on the reference box with `qwen3:4b` (Apache,
   fits the box) beside the 3B (Qwen Research License, non-commercial).
   This eval has been open since 2026-09-05. No paid claim, listing, or public
   number rests on the 3B.
4. **The copy that is false today (CMO).** Make these changes on the site
   this week:
   - "Edits with diffs you approve" becomes "Edits your project and shows
     every change" (`oscode.js:171`, `:263`). After undo ships, it becomes
     "Shows every change, and you can undo any of them."
   - "Your keys never leave your devices" (`oscode.js:36`) holds only once
     item 1 lands. Hold any campaign until it does.
   - "Harbor Light" becomes Harbor Lite.
   - The Marketplace pillar comes off while the room is grayed out.
   - Every $20 goes, in the pricing mirror pass the CFO ruled on 2026-09-14,
     which still waits on a Board vote.
   - "Nothing leaves your computer" is never used, because local models search
     DuckDuckGo by default.

### Change (session 2, harness step 2 as already planned)

5. **Undo.** The storage is the CTO's call:
   - The CTO would keep checkpoints under `refs/openshore/`, which git's
     cleanup keeps and the auto-push never ships.
   - The Board would use a separate hidden repository that also works in a
     folder without git, the way Cline does it.

   Either way, a checkpoint is taken before each task, and before each outside
   agent's prompt once one exists. Restore is itself checkpointed.

   What the person sees:
   - The Changed files card (which is the task-done card) carries "Undo these
     changes", and the person's own message carries "Go back to here".
   - Rewind stays on the tool card as the settled gesture.
   - After an undo, one line: "Undone · Redo".
   - It tells the truth: "Files are back. The npm install it ran stays."
   - Per-file Undo sits on the card.
   - Motion follows the Creative Studio's "Tide": the turn's cards fold in
     reverse stagger on the glide curve and the door clock, dimmed, never
     deleted, in neutral ink, never red.

6. **Verify with no setup.**
   - Detect the check (a `test` or `typecheck` script in `package.json`,
     pytest, `cargo test`, `go test`) and ask once.
   - Show the result as a pill in the head of the Changed files card: `pill ok`
     for "42 passed", muted for "Not checked", danger only on a final fail.
     Never the ochre note or teal. `hapticSuccess` fires only on the final
     pass.
   - Where there is no check, show "It works / Not yet". Where there is a dev
     server, show "See it running".
   - CX's line from 2026-09-14 stands: "This project has no tests. Want one?"
7. **The desktop first run.** The guided walk starts only on the phone
   (`store.ts:5776`), so a desktop person lands in Accept edits unasked.
   - Until undo ships, ask the 2026-09-24 edit question once, in the first
     coding chat.
   - Add a "Start something new" row that makes a folder in `~/OSCode`, runs
     `git init`, and opens a chat. Today, desktop coding needs an existing
     folder.
8. **Instruction files and skills.**
   - Read the wider list of instruction files Zed reads.
   - Read `.agents/skills` and `.claude/skills` behind the Hermes reader's jail
     and size cap. That makes the Wayfinding Skills switch honest.
9. **Measure what we build (CX).**
   - Fix two event names that mislead: `first_accepted_edit` fires on any
     landed edit (`store.ts:1958`), and `first_local_reply` fires for cloud
     replies too (`store.ts:1951`).
   - Add opt-in, on-device events with each build: trust, context, verify,
     undo, outcome, first run, and later the guest agent.

Session 2 ends with the Board's recording: a free model on the reference box
fixes a failing test, the pill says so, and Undo puts it back. That recording
is the marketing unit.

### Remove

- The Wayfinding Browser switch, which gates nothing. It has been flagged on
  09-09, 09-14, and today. Add a test that every switch names what it gates.
- The `auth: 'subscription'` stub (`schema.ts:26`).
- `trustedRepos` from project files (it becomes machine-only).
- Every $20, and the site's stale lines (Fix now, item 4).

Kept, where a memo suggested removing:

- **Vellum and OpenAGI rows.** The draft wanted to fold them into ACP, but
  neither is in the ACP registry, and removing them would reverse the
  founder's 2026-09-09 call. Keep them unless the founder rules otherwise.
- **CLI Pairing's shell-out.** It stays until something replaces it on a real
  box, and it is gated by item 1.

### Later, each behind its own gate

- **ACP host, renamed "Guest agents".** It becomes CLI Pairing's transport,
  under the same Currents rules.

  Gates:
  - Trust and undo have shipped.
  - CLI Pairing has run on a real box, and five testers other than the founder
    have used it on their own hardware (Board).
  - Each vendor's terms are answered in writing. The CTO read Anthropic's Agent
    SDK page today: "Unless previously approved, Anthropic does not allow
    third party developers to offer claude.ai login or rate limits for their
    products, including agents built on the Claude Agent SDK." That page also
    bars "Claude Code" as a product label. OpenAI's rules for ChatGPT sign-in
    and Gemini CLI's free-tier data terms need the same check.

  How it behaves:
  - It detects an installed adapter and never installs one. Downloads ask.
  - Before the handoff: an amber card ("Claude Code sends this project to
    Anthropic, on your Claude account"), an amber rail, and the ethics screen.
  - Nothing registers under egress lockdown.

- **ACP agent.** OpenShore's engine inside Zed, JetBrains, and Neovim.

  Gates:
  - The engine has a license (the root LICENSE still reads "no license
    granted"; the CFO recommends BSL 1.1 with a lawyer pass).
  - An eval number exists on an Apache-licensed model.
  - A stranger can reproduce it with one command.
  - The deep eval run through Zed lands within 5 points of the desktop number
    (the CTO's kill line).

  The CMO's listing copy is held until every clause is true. The Board's
  warning stands: Continue lived as a guest in other editors and was squeezed
  when those editors shipped their own agents.

- **MCP client, named "Tools".** It comes after trust.
  - Servers come only from the machine's config.
  - Unknown tools are treated as shell risk.
  - Downloads ask.
  - Nothing registers under egress lockdown.
- **The sandbox.** It comes only on evidence: more than three approvals per
  task in Ask first, or a real incident. Linux first.
  - Check the license of Anthropic's open-source sandbox runtime, and Pop!_OS's
    AppArmor rules.
  - Copy says "Stays in this project", never "safe".
- **A read-only Files view.** It comes when testers ask for it. It is a sheet
  off the Changed files card that follows edits, not reads, and it is never a
  room.
- **Routines on a copy.** This comes after a routine's first real scheduled
  run. The one preset routine is read-only today.
- **A footprint budget for the Electron shell.** Measure it on the reference
  box first.

Rough sizes: the CFO puts the whole list at 14 to 21 session-days. The CTO puts
the ACP host at 2 to 3 weeks, the ACP agent at 1 to 1.5 weeks, the sandbox at
1 to 4 weeks, and MCP at 1 to 2 weeks. None of it needs a server of ours.

### Do not build

| Not worth it                                                              | Why                                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A code editor, file tree as a room, edit predictions, an inline assistant | Editor features for a person OpenShore does not serve; the one fight Zed is losing (extensions against VS Code) we would lose worse. |
| Keymaps, Vim mode, themes beyond System, Light, and Dark                  | Ruled by CX on 2026-09-24.                                                                                                           |
| A debugger, a language-server client, a REPL                              | Expert tooling; the verify loop is this person's debugger.                                                                           |
| An extension platform                                                     | Zed's biggest complaint is its extension API, even after years of work. MCP, skills, and ACP cover the need.                         |
| Live multiplayer, channels, calls                                         | Zed's own users mostly ignore it; Zed moved the idea to a separate app.                                                              |
| SSH remoting, dev containers                                              | The daemon over Tailscale already does this job for this person.                                                                     |
| A native GPU rewrite                                                      | Years of work to win a speed contest we should never claim.                                                                          |
| Hosted models with a markup                                               | It breaks "your keys", adds cost of goods, and joins the metering wave the market is angry about.                                    |
| Per-hunk Keep and reject as the main review                               | Asks a non-expert to judge a diff; undo does the job.                                                                                |

## Taking a slice of the market

Who it is. Zed's fans are experts who love an editor. Zed's own local and
bring-your-own-key users already pay Zed nothing, so price will not move them.
The winnable part of Zed's base is narrow:

- agent delegators who use Zed only as a fast viewer for Claude Code;
- local-first users who hit telemetry, silent downloads, no offline mode, and
  a crippled Ollama default;
- the people Zed bounces at setup.

The larger pools sit next to Zed:

- Ollama's 8.9M monthly developers, doubled in six months. They already run
  the runtime OpenShore uses.
- Non-developer builders: 60 to 80% of Lovable, Bolt, and Replit users. Their
  top complaint is paying credits to fix the AI's own mistakes, which does not
  happen on a local model, where a retry costs time, not money.

The same evidence carries a warning: these users leave when the app breaks,
and a 3B on a CPU breaks more often than the cloud models they use. So
OpenShore courts them only after trust, undo, and verify ship.

The Corporate Strategist's "extra mile". Against Zed, the platform is a path,
not a list. The person says it to the phone. The Stack plans it in plain
words. The desktop and its models run it, verified and undoable. A routine
carries on while the computer is on, the Vault remembers it, and Launch ships
it to a store, with the ethics floor underneath. Zed ends at a diff; OpenShore
ends at an app in a store. Every stage exists, but no handoff between them has
been proven on a device. One recorded run through the path would clear about
half the device backlog and become the marketing unit.

The sentence. The CMO owns the copy. The team offered:

- "Build real software on the computer you already own. No meter running."
  (CMO; recommended as the headline)
- "A free model on your own computer. No meter. Every file change can be
  undone." (CX; the proof line, once undo ships)
- "Real work from a model you already own." (the 2026-09-14 one-liner)
- "No meter, no markup, no telemetry. Your models, your computer, and an agent
  that checks its own work." (Board)

The villain is the meter: the credit you pay to fix the AI's own mistake.

Against Zed, say nothing. The CMO's line when it matters: "Works inside Zed and
JetBrains. Works if you have never opened either."

Never claim any of these (the union of the memos):

- Speed or "lighter than" anything.
- "Safe", "sandboxed", or "safe to open any repo".
- "Undo anything". Commands and ignored files are not restored.
- "Always on", "trains itself", "feels like Claude Code", or parity with
  Claude.
- "Use your Claude subscription" before the terms check.
- A dollar saving before `osc eval` shows one.
- "Frontier" for a local model. Keel. "Open source".
- "Ships" for anything not verified on a device.
- A free 3B for commercial use.
- "75%" without "four tasks, one CPU-only box, best of two".
- A context window the box does not actually serve.

Channels, in the CMO's order:

1. r/LocalLLaMA (about 0.8M) and an Ollama integrations listing, with a
   60-second demo on the reference box.
2. The ACP registry, once its gates pass.
3. One Show HN when the eval posts (HN adds about 289 stars in a week on
   average).
4. Non-developer demos on X and YouTube after undo ships.

The CMO also flags the setter-upper: the Zed user we can reach often sets up
computers for family. Sell them the hub, and hand the phone to the person who
does not code.

Price:

- One price on record first. The site says Personal and Micro are $20 while
  CLAUDE.md says $50 and $100; that takes a Board vote and a mirror pass.
- Keep it flat. After Zed Pro's $5 monthly credit is spent, Zed keeps about
  $58 per payer a year (CFO estimate). Personal keeps $42.50 to $48, at 42% of
  Zed's sticker, with no token cost or overage risk.
- Reach education through the teacher rather than a free student year. Small,
  at $250 a year for 30, is $8.33 a student on one lab hub (CFO).

The numbers that say the slice is real. There is no telemetry, so every count
is public or opted in. The team proposed four reads; run them in this order:

1. **Watch ten people build.** Ten non-developers from the early-access list,
   each on their own laptop, one task, unassisted, with the founder watching.
   It is real if 6 of 10 reach a green verify pill in their first session and
   nobody loses work (Corporate Strategist). This is the cheapest read.
2. **The kept-first-build rate, in an opt-in cohort of 30** (CX, with the
   Board's mix of 20 local-first developers and 10 non-developers). The
   measure: within 14 days, a task that changed files, passed its check or was
   marked "It works", and was not undone, then a second task on a later day.
   - Twelve or more means court non-developers.
   - Six or fewer means the harness comes first and the developer channel
     leads.
   - Anything in between means fix the top stall and run it again.
   - Guardrails: zero files lost to undo, and fewer than one in five switching
     to Ask first in session one.
3. **Release downloads the week after one r/LocalLLaMA post of the
   recording** (CMO, Chief of Staff). The slice is real if downloads pass
   1,000 and one early-access sign-up in four answers "no" to "Do you write
   code?".
4. **Paid Personal accounts from strangers** through a refundable
   founding-year pre-sale on the existing checkout (CFO). Run it only after one
   price, a license, and an Apache-licensed number exist. The CFO's steering
   projection, labeled as assumption only: on 2,000 desktop downloads, 10
   payers (bear), 40 (base), or 80 (bull). Under 10 means a hobby market at any
   price.

## Where the team agreed, and where it split

All eight agreed on four things:

- No editor.
- The project-trust fix comes first, and it is wider than the draft said.
- Nothing is called shipped until it is verified on a device.
- The honest default promise is "every change can be undone", not "every diff
  is approved". The Corporate Strategist would rewrite interaction-model
  tenet 5 in the commit that ships undo.

Most agreed on three more:

- Per-hunk review is expert furniture. The Corporate Strategist, Creative
  Studio, CX, and Chief of Staff want per-file or per-task undo. The CTO,
  CMO, and CFO sized per-change Keep and Undo. The proposal takes per-file
  Undo, with hunks behind a disclosure at most.
- The context window is a real bug, and the fix is one field per seat plus
  an eval. The CTO, CX, and Chief of Staff corrected the draft's mechanism.
- Build ACP in neither direction before trust and undo.

They split on four things:

- **Which ACP first.**
  - Host first (5 of 8: CFO, Chief of Staff, Board, Corporate Strategist,
    Creative Studio). It upgrades an existing current, keeps the phone a
    remote as ruled on 2026-08-25, and reaches people already paying for
    Claude Code (39% of developers at work, per JetBrains).
  - Agent first (3 of 8: CTO, CX, CMO). It adds nothing to the device
    backlog, and the vendor terms bear on the host.
- **A freeze.**
  - The Board, Corporate Strategist, and CX want no new rooms, Settings
    groups, or BETA switches until fewer than five device checks are open.
    The Corporate Strategist would enforce it in `progressShape.test.ts`.
  - The Chief of Staff notes that the Board's 2026-09-14 "under five" gated
    only the phone-alone host, so a freeze would be a new founder rule. The
    CoS recommends one device sitting with a device-pass sheet instead.
- **Vellum and OpenAGI.** The Board and CMO would remove the rows. The Chief
  of Staff and Corporate Strategist would keep them. This proposal keeps them.
- **Smaller calls, one advisor each:**
  - Hide Harness Currents until Jev has its eval (Board).
  - Park the Air program (Board and Corporate Strategist).
  - Reopen a web checkout for Personal (CFO).

## Founder decisions owed

The first three are needed before session 1 or 2. The rest can wait. The
recommendation comes first in each.

1. **How project trust works.**
   - (a) Recommended: an allowlist. A repo may only tighten settings; it may
     propose a verify command, which asks once. No other new question
     (Chief of Staff, CTO's tighten-only rule, CX's "card only when needed").
   - (b) A Zed-style "Use this project's settings?" card for every folder that
     brings settings (CMO, Creative Studio).
2. **The floor model.**
   - (a) Recommended: measure `qwen3:4b` (Apache) on the reference box and move
     Harbor and DeepBlue's floor to it if it holds.
   - (b) Ask Qwen for a commercial license for the 3B.
3. **Verification before more building.**
   - (a) Recommended: one device sitting with a sheet grouped by device before
     any build past session 2 (Chief of Staff).
   - (b) A coded freeze on new rooms, Settings groups, and BETA switches until
     fewer than five device checks are open (Board, Corporate Strategist, CX).
4. **Which ACP first, once its gates pass.**
   - (a) Recommended: the host first, as CLI Pairing's transport (5 of 8).
   - (b) The agent listing first (3 of 8).
5. **Personal checkout.**
   - (a) Recommended by the CFO: add a web checkout beside the App Store, so a
     desktop-only person (Linux, Android) can pay. This reverses the
     2026-08-31 Apple-only ruling and nets about $48 against $42.50.
   - (b) Keep Personal Apple-only.
6. **The Air program.**
   - (a) Recommended by the Board and Corporate Strategist: park it. It puts a
     coding agent's compute on the phone, against the 2026-08-25 ruling that
     the phone is "a remote control and a viewer, not the compute".
   - (b) Keep it as planned on 2026-09-21.
7. **A sixth tenet for CLAUDE.md** (Corporate Strategist). "No editor, no
   expert gate. Borrow trust machinery, never editing machinery. Every feature
   passes one test: can someone who has never opened an editor use it, and
   undo it? Experts get a door, never a room." Add it on a yes.

Everything else is delegated:

- CTO: the allowlist, moving the existing grants, checkpoint storage, the
  context seat, and later ACP, MCP, and the sandbox.
- CMO: the copy fixes and the never-claim list.
- Creative Studio: undo inside the Rewind design, and the verify pill.
- CFO: the pricing mirror pass, after the Board vote.
- CX: the events and the cohort.

## Order of work

**Session 1: fix now.**

- The trust allowlist, with a test for each vector.
- "Local" judged by address.
- Grants moved to the machine.
- The context seat and the seat pill.
- The site copy fixes, the same week.
- It ends with the founder running the eval once: the 4B beside the 3B, with
  and without the context seat.

**Session 2: harness step 2.**

- Checkpoints and Undo with Redo.
- Per-file Undo on the Changed files card.
- Verify with no setup, and its pill.
- The desktop's first-run edit question and "Start something new".
- The instruction-file and skills reading.
- The funnel events.
- It ends with the recording.

**Then:** the device sitting (or the freeze, per decision 3). After that, the
first read of the slice numbers. Then each later item on its own gate.

Why this order: the harness plan already names checkpoints, rewind, and
verify as step 2, and the Chief of Staff is right that the harness order, not
Zed, should set the rest. What Zed adds is the trust fix, which the harness
plan never saw, and a sharper answer to who the product is for.
