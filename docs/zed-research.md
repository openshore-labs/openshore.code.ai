# Zed, researched: what it has, what people say, and the market around it (2026-09-25)

The evidence behind `zed-proposal.md`. Gathered on 2026-09-25 by four research passes: Zed's features and how each works, public opinion, a sweep of the OpenShore desktop, and the market. Zed's docs were read from their source in the `zed-industries/zed` repository at `main` (zed.dev itself is blocked from the sandbox), GitHub reaction counts were pulled live, and most other pages came through search extracts. "[3P]" marks a figure seen only through a third party or a search extract; "[C]" an unaudited company claim; "[est.]" an estimate. Treat this as a dated snapshot, not a live source.

## 1. What Zed is

- Zed Industries' GPU-rendered Rust editor. 1.0 shipped 2026-04-29; stable v1.21.0 on 2026-09-23; weekly releases with a preview channel a week ahead.
- 90,877 GitHub stars and 10,773 forks (2026-09-25). 150K monthly active developers at the Series B (Aug 2025); "hundreds of thousands" of daily developers claimed at 1.0 [3P]. 7.3% of Stack Overflow 2025 respondents use it [3P], against VS Code 75.9%, Cursor 17.9%, Claude Code 9.7%, Windsurf 4.9%.
- Funding: $10M Series A (Redpoint, 2023); $32M Series B led by Sequoia (2025-08-20); more than $42M in total. Revenue is not disclosed.
- Platforms: macOS and Linux; Windows stable since 2025-10-15. No official web or mobile editor. Its collaboration vision now lives in Delta, a separate app in public beta since 2026-09-16.
- License: the editor is GPL-3.0-or-later; GPUI and the extension API are Apache-2.0; contributors sign a CLA.
- Telemetry (crash reports and metrics) is on by default and can be turned off. A `disable_ai` setting (since 2025-07-30) turns off every AI surface.

## 2. What Zed has, and how each piece works

### The agent

- **Three kinds of agent in one panel.** Zed's own agent; outside agents connected over the Agent Client Protocol (ACP); and Terminal Threads (a command-line agent in a terminal, kept as a thread).
- **Tools.** Read, grep, find, list, diagnostics (from the language server), edit (replace a span), write, copy, move, delete, a terminal (a new shell per call), fetch, web search (paid plan), skills, and `spawn_agent` (a subagent with its own context; it cannot use a different model yet).
- **Profiles** (Write, Ask, Minimal, or custom) decide which tools exist. They do not decide approvals.
- **Tool permissions.** A global default of "confirm", per-tool defaults, and `always_allow`, `always_deny`, and `always_confirm` regex patterns matched against the command, path, URL, or query. Deny beats confirm beats allow. Chained shell commands are split and each part is checked. The approval card offers Allow once, Always for tool, and Always for pattern.
- **An OS sandbox** for the terminal and fetch tools, on by default since about v1.14 (Aug 2026) [3P]: Seatbelt on macOS, unprivileged bubblewrap on Linux, WSL on Windows. Writes are limited to the project and temp, `.git` is read-only, the network is off, and network grants go through a proxy with a host allowlist. Zed's docs list known ways out (a Makefile run later, proc macros run by the language server).
- **Checkpoints.** Before each prompt Zed stages tracked and untracked files into a temporary git index, writes a tree, and makes a commit no branch points to (`git commit-tree -p HEAD`). Restore cancels the turn, rewinds the thread, and runs `git restore --source <sha> --worktree .`. Large and binary files are not restored. An open issue calls restore "irreversibly destructive" (#28676).
- **Review changes.** A bar lists edited files and line counts; Review Changes opens a multi-file buffer where each hunk can be kept or rejected.
- **Follow the agent.** The editor jumps to each file the agent touches (for outside agents, from the file locations ACP reports).
- **Instructions and skills.** Personal `~/.config/zed/AGENTS.md`; the first project file found among `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`. Skills are `SKILL.md` folders in `.agents/skills` or `~/.agents/skills`. The Rules Library was removed in v1.4.
- **MCP.** Tools and prompts, servers as extensions or commands. Project MCP servers wait on folder trust.
- **Worktree trust.** Every newly opened folder starts restricted: its project settings, language servers, and MCP servers do not run until the person trusts it. Trust is tracked per host.
- **Parallel agents** (2026-04-22) [3P]: a threads sidebar across projects, each thread with its own agent, optionally isolated in a new git worktree that is saved and removed when archived.
- **Also:** auto-compaction; a token meter; steering (a queued message injected between steps); thread history; AI commit messages; an inline assistant for selections (editor only).
- **Edit predictions (Zeta).** An open-weight next-edit model (Zeta2 on Seed-Coder-8B, about March 2026; Zeta2.1 in May 2026 emits only changed regions) [3P]. It can run locally through Ollama or any completions server. Free is 2,000 predictions a month.
- **Models.** Zed-hosted Anthropic, OpenAI, and Google models at list price plus 10%; your own keys for most providers; ChatGPT and Copilot subscriptions as providers; Claude subscriptions only through the Claude Agent over ACP. Local: llama.cpp, Ollama, and LM Studio as full providers. Ollama's context defaults to 4,096 tokens unless the person edits settings, which a setup guide says "silently cripples" the agent.

### The Agent Client Protocol

- JSON-RPC 2.0 between an editor and an agent subprocess over stdio. It carries streamed tool calls with file locations, diffs, plans, terminals, and permission requests, and can offer the agent the editor's file reads and writes (including unsaved buffers).
- **Timeline.** Launched 2025-08-27 with Gemini CLI. Zed's Claude Code adapter followed on 2025-09-03, JetBrains co-developed from October 2025, the registry opened 2026-01-28, and the SDKs reached 1.0 on 2026-06-25. The protocol now lives in its own GitHub organization.
- **Registry.** 42 agents, among them Claude Agent, Codex, Gemini CLI, Copilot CLI, Cursor, Junie, Devin, Goose, Cline, OpenCode, Kimi, and Qwen Code. Neither Vellum nor OpenAGI is listed.
- **Clients.** JetBrains IDEs, Neovim, Emacs, Sublime Text, Qt Creator, Visual Studio and VS Code through extensions, Obsidian, marimo, and about 50 more.
- **Limits in Zed.** An outside agent owns its model, auth, billing, tools, and instructions. Zed's profiles, skills, and sandbox do not apply, and steering is unavailable. Checkpoint restore varies by agent.

### Everything else

- **Editor.** Tree-sitter plus language servers; multibuffers (edit excerpts from many files in one buffer); Vim mode and a partial Helix mode; a graphical settings editor over JSON; a keymap editor; base keymaps for VS Code, JetBrains, Sublime, Emacs, and Cursor.
- **Onboarding.** Theme, keymap, importing VS Code or Cursor settings, and one switch to disable AI.
- **Git.** A panel with per-hunk staging, a diff view, history and graph, stash, worktrees, branches, per-conflict merge buttons, blame, and permalinks. There is no pull-request review (582 votes).
- **Debugger.** A Debug Adapter Protocol client (June 2025) for C, C++, Go, JS/TS, PHP, Python, and Rust.
- **Tasks, terminal, REPL.** Tasks are detected by Tree-sitter; the terminal is a fork of alacritty; Jupyter kernels run inline in normal files.
- **Remote.** A headless server over SSH with the UI local, dev containers, and WSL.
- **Collaboration.** Channels, shared projects served from the host, per-pane following, and voice and screen share. It is CRDT-based and off by default for Business.
- **Extensions.** WebAssembly (languages, themes, debug adapters, snippets, MCP servers), about 1,533 of them, with no custom UI panels.
- **Plans.** Free (your keys, outside agents, limited predictions). Pro is $10 a month with $5 of token credit, then list price plus 10% (token pricing announced 2025-09-24; before that, $20 for 500 prompts). Business is $30 per seat per month (about May 2026) [3P], with no SSO. Students get a free year.

## 3. What people say

### Why they like it (ranked by how often it comes up)

1. **Speed and feel.** "Zed is probably the best text editor in the last 10 years" (HN, Apr 2026).
2. **Native, not Electron.** Light on RAM and battery (contradicted by the memory reports below).
3. **Bring your own agent and key.** ACP brought Claude Code in (238 votes for it before it shipped). "I can leverage my Claude subscription instead of paying for API tokens." HN liked that it is "too early to try to lock people in."
4. **AI that stays out of the way.** The disable switch won back skeptics (309 votes for a build flag).
5. **Reviewing agent work.** The multi-file diff, following the agent, and parallel threads in worktrees ("a bet on worktrees, not just more AI panels").
6. **Modal editing.** Vim and Helix users.
7. **Built in, not bolted on.** Git, debugger, terminal, and SSH in the box.
8. **Open source and pedigree.** Rust, and the Atom and Tree-sitter team.
9. **Collaboration.** Loved by a few, ignored by most.

### What does not work (ranked by frequency and severity)

1. **Extensions too thin next to VS Code.** The top reason people do not switch (webview request, 438 votes).
2. **"AI eating the editor".** "Zed used to be a good editor but it is increasingly LLM infested."
3. **Blurry text on low-DPI screens.** 514 votes; mostly fixed in 2026.
4. **Memory and CPU spikes from language servers.** Reports of 40 GB and 130 GB (Jun 2026).
5. **The token pricing change.** "Sucks for forecasting"; "little value in subscribing to Zed Pro compared to just bringing my own key."
6. **Edit predictions trail Cursor Tab.**
7. **Privacy and network.** Node and npm downloaded without consent (285 votes, severity S1, open since Jun 2024: "Zed has just eaten up 14 MiB of my plan"); no offline mode (165 plus 151); API keys in plain text; a fork (Zedless) exists for this.
8. **Platform friction.** A Vulkan or DX11 GPU is required; Wayland hangs; a 400 MB Windows install; shortcuts break on non-Latin layouts.
9. **Git gaps.** No PR review (582), no jj (552), and no merging (191).
10. **A young debugger.**
11. **Stability papercuts.** Includes "AI always rewrites entire file" and "Ollama is slow".
12. **Friction for newcomers.** GitHub-only sign-in and settings in JSON.

### What they wish for (open, by votes)

- **Editor.** Test runner integration 875 (the most-voted open issue); smooth scrolling 869; jj 552; multiple windows 449; UI extensions 438; iPad and mobile 256 plus 142.
- **Discussions.** PR review 582; settings sync 370; Jupyter 283; local file history 279; a database viewer 247.
- **AI.** Planning mode or specs 135; a context meter for ACP agents 128; resuming outside-agent sessions 84; voice input 83; "a mobile app to control my Agents panel runs remotely" 75; forking a thread 65; per-project AI settings 32; a cheaper plan with predictions only.

### Who uses it

- **Experienced, keyboard-heavy developers.** Rust (8.9% of Rust developers in 2025) and Go; macOS on Apple Silicon first. Admired by 57% of users against 46.7% for Cursor [3P].
- **Agent delegators.** A new group uses Zed only as a fast viewer while Claude Code does the work ("does not write any code and leaves everything to Claude Code", Zenn, Feb 2026).
- **Beginners.** They bounce off: "tried using zed, didn't understand how to set up claude code integration, went b[ack]..." (HN, May 2026). Beginner roundups send newcomers to Windsurf or Cursor and non-coders to Lovable.

## 4. The market around it

| Metric                                 | Value                                                                                                                                      | Date            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Cursor annualized revenue              | $4B+, then acquired by SpaceX for $60B in stock [C, 3P]                                                                                    | Jun to Aug 2026 |
| Claude Code run-rate                   | more than $2.5B (Anthropic)                                                                                                                | Feb 2026        |
| AI tools at work (JetBrains)           | Claude Code 39%, Copilot 21%, Junie about 9%, OpenCode 7%; 68% use agents daily [3P]                                                       | mid 2026        |
| GitHub Copilot                         | 4.7M paid subscribers [3P]                                                                                                                 | Jan 2026        |
| Codex                                  | about 8M weekly users [3P]                                                                                                                 | Jul 2026        |
| Open agents (GitHub stars)             | OpenCode 210k, Cline 69k, Aider 49k, Continue 36k; Roo Code shut down; Kilo acquired                                                       | Sept 2026       |
| Lovable                                | $500M ARR [C]; about 8M users; 80% of builders non-technical [C]                                                                           | 2025 to 2026    |
| Bolt, Replit                           | 60 to 70% non-developers (Bolt); "75% never write a line of code" (Replit)                                                                 | 2025            |
| Vibe-coding traffic from the 2025 peak | Lovable down 40%, v0 down 64%, Bolt down 27%, while revenue kept rising [3P]                                                               | Sep 2025        |
| Ollama                                 | 8.9M monthly developers, doubled from 4.5M in six months; $65M Series B [3P]                                                               | Jul 2026        |
| r/LocalLLaMA                           | about 0.8M members [3P]                                                                                                                    | Sept 2026       |
| Stack Overflow 2025                    | 84% use or plan to use AI; 46% distrust its accuracy; privacy is the top deal-breaker, pricing second [3P]                                 | 2025            |
| Metering wave                          | Cursor (Jun 2025), Claude Code weekly caps (Aug 2025), Zed (Sep 2025), Windsurf (Mar 2026), Copilot credits (Jun 2026), each with backlash | 2025 to 2026    |
| Small local coders                     | Devstral Small 2 (24B, Apache) 68% SWE-bench Verified; Qwen3-Coder-Next (80B, 3B active) 70.6%; both need 16 to 24 GB or more [3P]         | 2025 to 2026    |
| Qwen2.5-Coder-3B                       | 84.1 HumanEval claimed; an independent rerun got 45.1 (open issue); Qwen Research License                                                  | 2024 to 2025    |
| HN launches                            | an average of +289 stars in a week across 138 AI-tool launches; the posting hour matters more than the "Show HN" tag                       | 2024 to 2025    |

What the evidence points to:

- **Price.** Complaints are about unpredictable bills more than the price level. Six vendors metered or capped usage within a year.
- **Non-developers.** They are most of the users of the leading builders. Their top complaint is paying credits to fix the AI's own mistakes, and they leave when the app breaks.
- **Local runtimes.** Demand is real and growing.
- **Zed's own local users.** They pay Zed nothing, so price will not move them.
- **What grew the builders.** Demos on X, YouTube, and TikTok; community (Lovable's 145K-member Discord); and free student years (Cursor, until fraud closed it in June 2026).

## 5. OpenShore's desktop against the same list (repo sweep, 2026-09-25)

**Present:**

- permission modes and "Always allow in this project";
- instruction files (OSCODE.md, CLAUDE.md, AGENTS.md) and project memory;
- a real terminal (node-pty and xterm.js);
- pairing a phone to the desktop over Tailscale with per-device credentials;
- org projects and a Team vault;
- local models through Ollama or any compatible server;
- the Stack and routing, and `osc eval`;
- voice mode, Crew routines, Vault, and the plan-first play;
- Launch to the app stores;
- releases for Linux, Windows, and macOS (macOS unsigned).

**Partial:**

- diff review (all or nothing per edit, nothing can be rejected after it lands, Accept edits by default);
- code intelligence (a regex code map, an embedding search when placed, cheap structural checks; type errors only if a verify command is set);
- git (agent tools and a reconcile push, no branch or PR surface; `openPullRequest` exists unused);
- outside agents (CLI Pairing runs `claude -p` or `codex exec` as one approved shell command; A2A and Hermes as tools; no ACP).

**Absent:** a code editor or file tree, checkpoints or undo for the person (the best-of-N picker restores touched files internally), following the agent, MCP, edit predictions, LSP, a debugger, keymaps, a desktop guided walk (the Harbor Lite walk starts only on the phone), and any footprint numbers for the Electron shell.

## Sources

**Zed docs and code**

- https://github.com/zed-industries/zed/tree/main/docs/src
- https://github.com/zed-industries/zed/blob/main/crates/git/src/repository.rs
- https://github.com/zed-industries/zed/releases/tag/v1.0.0
- https://zed.dev/blog/zed-1-0
- https://zed.dev/blog/parallel-agents
- https://zed.dev/blog/sandboxing
- https://zed.dev/blog/pricing-change-llm-usage-is-now-token-based
- https://zed.dev/blog/zed-for-business
- https://zed.dev/blog/disable-ai-features
- https://zed.dev/blog/introducing-delta

**ACP**

- https://github.com/agentclientprotocol/agent-client-protocol
- https://github.com/agentclientprotocol/registry
- https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/

**Opinion**

- https://news.ycombinator.com/item?id=45362425 (pricing)
- https://news.ycombinator.com/item?id=47949027 (1.0)
- https://news.ycombinator.com/item?id=47866750 (parallel agents)
- https://news.ycombinator.com/item?id=48077710 (setup bounce)
- https://github.com/zed-industries/zed/issues/12589
- https://github.com/zed-industries/zed/issues/28676
- https://github.com/zed-industries/zed/issues/5242
- https://github.com/zed-industries/zed/discussions/25498
- https://zenn.dev/shimo4228/articles/cursor-to-zed-migration?locale=en
- https://localaimaster.com/blog/zed-ollama-setup
- https://toolchew.com/en/review-zed-2026/

**Market**

- https://www.businesswire.com/news/home/20250820782241/en/
- https://survey.stackoverflow.co/2025/
- https://blog.jetbrains.com/research/2026/08/ai-coding-agent-adoption-2026/
- https://techcrunch.com/2026/07/09/popular-open-source-ai-developer-tool-ollama-raises-65m-grows-to-nearly-9m-users/
- https://thenextweb.com/news/lovable-build-economy-500m-arr-vibe-coding
- https://www.lennysnewsletter.com/p/inside-bolt-eric-simons
- https://github.com/QwenLM/Qwen3-Coder/issues/420
- https://arxiv.org/abs/2511.04453
