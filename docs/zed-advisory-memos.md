# The advisor team on the Zed analysis: the eight memos (2026-09-25)

The founder asked for a deep analysis of Zed against the OpenShore desktop and
a clear proposal of what to remove, change, and fix, and said "you can talk to
my team about this." Each advisor (the personas in `uki-audio/.claude/agents`,
serving OpenShore here) read the draft proposal, the four research passes
(condensed in `zed-research.md`), the standing docs, the site copy, and the
code their role needed, then wrote independently. The memos are recorded here,
condensed but faithful, so no finding evaporates. The consensus they produced
is in `zed-proposal.md` under "Where the team agreed, and where it split."

Every memo returned the same first call: close the project-trust gap before
anything else, and build no editor. The draft they reviewed is summarized in
the proposal; where a memo says "the draft", it means that first version.

## CTO

**Verdict.** Go on the draft's direction (trust machinery, no editor), but widen the trust fix and land it before any ACP, MCP, or distribution work.

**Must-fix.**

1. A cloned repo's config file can run code and steal keys. loadConfig merges the project file over the global one and strips only daemon.* (config/load.ts:79-91). The desktop runs local-interactive (engineHost.ts:255-257).
   - Silent command: with no card, harness.verify.command runs through execSync with the full environment (harness/verify.ts:61-69) after any write (loop.ts:338-342, 1196). projectMemoryWrite is a write the engine auto-allows (permissions/index.ts:170-172), so "Ask first" does not help.
   - Silent shell: {"tool":"*","decision":"allow"} makes shell and push silent (permissions/index.ts:179-190).
   - Key theft: providers.anthropic.baseUrl sends the stored key as x-api-key to any host (providers/registry.ts:46, anthropic.ts:67-72); apiKeyEnv sends any env var as a Bearer token (openaiCompatible.ts:57-62).
   - Secrets to a remote host: a remote openai-compatible orchestrator stays kind 'local' (openaiCompatible.ts:37): no cloud card (loop.ts:635), a teal pill, and the decrypted project secrets pass the gate (bootstrap.ts:177-181).
   - Reads anywhere: vault.dir points silent reads at any folder (agent/registry.ts:145).
   - Phone and routines: the remote and headless profiles block only the shell paths; routines treat any clone under ~/OSCode as admin-provisioned (security/workspaces.ts:36-45).
     Fix: until a folder is trusted, its project file may only tighten settings. Trust lives in global config, keyed by realpath, normalized origin, and a hash of the gated keys, so a pull that changes the command asks again. Some keys never come from a project file: *KeyEnv, a provider's baseUrl or kind, vault.dir, catalog, license, trustedRepos. A CI test fails on any schema key that has not been classified.
2. Trust must not live in the repo. "Always allow in this project" writes to the repo's own file (load.ts:173-209). gitCommit stages -A (tools/git.ts:137) and the app auto-pushes, so my allow becomes my teammate's.
3. The jail protects nothing inside the tree (security/jail.ts:28-40). Accept edits is the default (app/src/lib/permissionMode.ts:19), so a model steered by the repo can silently write os-code.config.json. It can also write .git/config with core.fsmonitor, which runs on the next gitStatus, a read tool (tools/git.ts:15). Deny writes to .git/** and make the config file always-ask.
4. claude -p skips Claude Code's own trust check (Anthropic's security page documents this), so CLI Pairing in a clone runs that repo's .claude hooks (cliAgent.ts:39). Gate CLI Pairing on our trust.
5. The draft's context finding is half right. The engine talks to Ollama's native /api/chat and sends no num_ctx (openaiCompatible.ts:214-218). It budgets 70% of the trained 32K (openaiCompatible.ts:131, compaction.ts:66), so Ollama trims turns before compaction fires, and the context meter (loop.ts:1539) reads too low. Fix: send num_ctx and keep it the same for every call to a model (a change reloads the model); report the same number from capabilities; wire compactAtContextFraction (harness/profile.ts:78), which nothing reads today. A BYOM seat on an Ollama /v1 address cannot carry num_ctx (stackDriver.ts:1157-1183); there only OLLAMA_CONTEXT_LENGTH or a derived model works. RAM: a 3B's KV cache is about 36 KB a token, 0.6 GB at 16K, 1.2 GB at 32K; seat 16K on the 7.6 GB box. Prefill time is the real cost (a 7B prefills at 6.7 tok/s there, DECISIONS.md:1324); run the eval with and without.
6. Check terms before any copy. Anthropic's Agent SDK page, read today: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." claude-agent-acp is built on that SDK. Get answered in writing: whether hosting the person's own logged-in CLI counts; the same page's ban on "Claude Code" as a product label (cliAgent.ts:52 uses it); OpenAI's rules for ChatGPT sign-in through codex-acp; Gemini CLI's free-tier data terms against our privacy promise; each adapter's license. Also delete the auth: 'subscription' stub (schema.ts:26).

**Positions.**

1. Agree, no editor. The Files view comes after trust, undo, and review.
2. OpenShore as an ACP agent first, the host second, both after trust; the host also waits for checkpoints so an outside agent's edits can be undone. Order and rough size: trust fix 3 to 4 days; num_ctx 1 day plus an eval run; checkpoints with "Undo this turn" 1 week; per-hunk keep or undo, diffed against the checkpoint, 1 week; osc acp 1 to 1.5 weeks; sandbox for runShell and verify 1 to 2 weeks if Anthropic's open-source sandbox runtime fits (license and Pop!_OS AppArmor to check), otherwise 3 to 4; ACP host 2 to 3 weeks; MCP client 1 to 2 weeks, servers only from trusted config, unknown tools treated as shell risk.
3. Real and wider than the draft says; must-fixes 1 to 3 are the fix.
4. Also remove the subscription stub and trustedRepos. Keep CLI Pairing's shell-out until the terms check passes; keep A2A, because ACP does not reach remote agents.
5. Public counters only: npm weekly downloads of osc acp and release downloads. Kill line: the deep eval run through Zed must land within 5 points of the desktop number.
6. Never claim "safe to open any repo", "sandboxed", "undo anything" (shell side effects and ignored files do not restore), "your Claude subscription", or a context window the box does not actually serve.

**Elevations.** Keep checkpoints under refs/openshore/, not as dangling commits: git's cleanup keeps them and the auto-push never ships them. The sandbox would also let verify run on phone sessions, which skip it today (loop.ts:341).

**One thing.** Before the next distribution build, make it so a repo's own file can tighten OpenShore but never loosen it until the person trusts that folder, with the trust stored on the machine.

## CMO

**Verdict.** Go, but in a different order. Fix what the site breaks today before any post, and treat Zed as a doorway, never an opponent. The villain is the meter, not the editor.

**Must-fix.**

1. The trust gap leaks keys. A cloned repo's os-code.config.json overrides the person's config, stripping only daemon (config/load.ts:72-91). The Anthropic provider then sends the stored key to whatever baseUrl that file names (providers/anthropic.ts:37,160). That makes two site lines false: "Your keys never leave your devices" (oscode.js:36) and "Nothing leaves unless you tap to send it" (tabpages.js:54).
2. "Edits with diffs you approve" is false under the Accept edits default (oscode.js:171, :263). Now: "Edits your project and shows every change." After review ships: "Shows every change. You keep or undo each one."
3. ACP and MCP can bring back the silent download. Registry agents install through npx, uvx, or binaries; many MCP servers start with npx -y. Zed has had the same problem open as severity S1 for 27 months (#12589). It breaks "downloads ask" and the CX ruling against installing another company's agent. Use only what is already installed, or show a download card.
4. A guest agent sends the project to its own company every turn. Starting one is the tap, so it needs an amber card ("Claude Code sends this project to Anthropic, on your Claude account"), an amber pill, and the ethics screen before the handoff, as the trust statement claims (oscode.js:362).
5. Two draft words fail the plain test: "turn" is jargon, and "connections" already belongs to Cloud Connections. Rulings: checkpoint is "Undo these changes" on the task card and "Go back to here" on your message, with "Redo"; review is "Keep" or "Undo" per change; worktree is "on a copy"; sandbox is "Stays in this project", never "safe"; trust is "Use this project's settings?"; MCP is "Tools" in Wayfinding, named per app; CLI Pairing (a mechanism name) becomes "Guest agents".
6. No dollar comparison. The research compares a $50 price to Zed's $120, but the site says $20 (oscode.js:225), and no price shows while pay gates are off. "No meter" needs no number.

**Positions.**

1. Agree, no editor. Files is a panel behind the Changed files card, not a room, with "Follow along" and "Open in your editor". That button makes Zed a friend.
2. Trust, Undo, review, then the agent listing once the eval number exists, then the host last, since a guest agent needs Undo first. Listing copy, held until every clause ships: "OpenShore. Real work from a model you already own. Runs on Ollama or any local server, runs your project's checks before it says done, and lets you undo any change. Cloud only when you tap, on your own key. A 3B on a CPU-only computer: X of Y tasks with OpenShore, Z without." Replace the placeholder LICENSE first.
3. Worse than described. A repo can also opt itself into pushing main (git/reconcile.ts:193). Ignore a project file's providers, stack, egress, permissions, verify, and sync settings until one card is answered: "This project brings its own settings. It runs npm test after changes and lets npm commands run without asking. Use them?" Ask again when a pull changes the file.
4. Browser, Vellum, OpenAGI: agreed. Also remove the site's Marketplace pillar (oscode.js:113) while the app shows it grayed out; "Harbor Light" on the site where the app says Harbor Lite; and the draft's unmeasured "makes small local models work".
5. Public counts only, never a ping. Channels in order: r/LocalLLaMA and an Ollama integrations listing with a 60-second demo on the reference box; the ACP registry; one Show HN when the eval posts; non-developer demos on X and YouTube after Undo ships. The slice is real if release downloads pass 1,000 and one early-access sign-up in four answers "no" to "Do you write code?"
6. "Build real software on the computer you already own. No meter running." Villain: the meter, the credit you pay to fix the AI's own mistake. Against Zed, nothing: "Works inside Zed and JetBrains. Works if you have never opened either." Ours to name: meters, credits, surprise bills, setup that assumes you code. Not ours: speed, memory, extensions, Zed's telemetry or pricing by name, and the 4K Ollama default until our own box proves we do not have it. Never claim: faster, lighter, native; always on; trains itself; a dollar saving; safe; "use your subscription" before the terms are read; undo for what already left; open source; frontier for a local model; Keel.

**Elevations.** The setter-upper: the Zed user we can reach often sets up computers for family; sell them the hub, and hand the phone to the person who does not code. The envelope is the undo: break the app, tap Undo, it is back, then "Checked: 42 passed." The receipt: "Ran on your computer. $0 in API calls," or "$0.14 on your Anthropic key." A fact, not a saving.

**One thing.** Close the key leak and fix the diff line before anyone is invited in, then let Undo be the demo.

## CFO

**Verdict.** Go with conditions. The trust machinery is right and needs no infrastructure. But nobody in this slice can pay us today: two price ladders are on record, the headline model is non-commercial, and Personal is sold only on iPhone.

**Must-fix.**

1. Settle one price before any "no meter" line goes out. The site (oscode.js), plans.ts, and Paywall.tsx still show Personal $20 and Micro $20 up to Scale $500; CLAUDE.md and DECISIONS (2026-09-14) say $50 up to $1,000, and the draft already quotes $50 against Zed. My ruling said fix the site that week, eleven days ago. Needed: a Board vote, four new Stripe prices, one mirror pass across the site and app, and a refund of the $20 Micro test charge.
2. No paid claim on the 3B. The 75% is Qwen2.5-Coder-3B under the Qwen Research License, non-commercial (PROGRESS, 2026-09-24). An independent HumanEval rerun got 45.1 against the 84.1 claimed. The draft gates the ACP listing on that number. Run osc eval --deep on qwen3:4b (Apache, fits the box): the Board's "one thing" on 2026-09-14, still unrun.
3. License the engine before a registry hands it to strangers. The root LICENSE says "no license granted" (DECISIONS, 2026-09-05). My BSL 1.1 recommendation stands, with a lawyer pass.
4. Let the slice pay. Personal is Apple-only (DECISIONS, 2026-08-31), but this slice lives on desktops. A Linux user with an Android phone cannot give us $50. Reopen Stripe beside the in-app purchase: Apple's multiplatform rule allows it, and checkout proved live on 2026-08-21. It nets about $48 against $42.50 on Apple. Founder's call.
5. Verification is the constraint, not code. What remains holds 18 builds not yet checked on a device or the box, plus the unrun 4B eval; the Board set "under five" when it was eleven. Pace: 4 to 9 thousand lines per build day (git shows 6 to 9K a day for 23 to 25 Sep). Sizes in session-days: trust 1 to 1.5; context 0.5 plus box time; undo 1.5 to 2; per-hunk review 1 to 1.5; ACP host 2 to 3; zero-config verify 0.5 to 1; instruction files 0.5; routines on a copy 1; ACP agent 1.5 to 2.5; MCP 1 to 1.5; sandbox 2 to 4 (Linux only); Files view 1 to 1.5; removals 0.5. Total 14 to 21. Cost of goods: no item needs a server of ours; the ACP listing is a pull request plus a package; MCP and the sandbox proxy are local processes. Ship osc acp ungated so the hosted license-verify stub never has to exist. Cost moves to the person's machine: 32K context on the 3B is roughly 1.2 GB of KV cache (estimate).

**Positions.**

1. Agree, no editor. Cut the Files view to its "Open in your editor" button; this slice already owns an editor.
2. Trust, undo, host, then agent. The host connects us to people already paying for Claude Code (39% of work use, JetBrains 2026) and gives the phone its job. The agent brings in users who pay Zed nothing, so it waits on must-fixes 2 to 4.
3. The gap is as described: config/load.ts strips only daemon from a project file. A paid product that runs a cloned repo's command without asking is a liability. Ignore the project file's permissions, providers, egress, and verify until the folder is trusted, with one card.
4. Not worth it now: the sandbox (costliest, Linux only, no demand evidence from our users; confirm bubblewrap runs unprivileged on Pop!_OS first), the Files view beyond its button, routines on a copy (the one preset routine is read-only). Also remove every $20.
5. The number is paid Personal accounts at $50 from strangers within 60 days, counted in Stripe with no telemetry. Cheapest test: a refundable founding-year pre-sale on the existing checkout, about half a session-day. Steering projection, assumption only, on 2,000 desktop downloads: base 2% buy, 40 payers, about $1,900 net; bear 0.5%, 10 payers, about $480; bull 4%, 80 payers, about $3,800. Under 10 means a hobby market at any price.
6. "No meter. No markup. Your models, or your own key at your provider's price, and every cloud call asks first." Never claim "unlimited" or "free" where a cloud key is in play; "use your Claude subscription" before vendor terms clear; a dollar saving before osc eval shows one; any number from the 3B.

**Elevations.** The Board line: once Zed Pro's $5 monthly credit is spent, Zed keeps about $58 per payer a year after card fees (estimate); Personal keeps $42.50 to $48 at 42% of Zed's sticker, with no token cost or overage risk. In education the buyer is the teacher: Small at $250 for 30 is $8.33 a student on one lab hub; a student year costs us only forgone revenue, while Zed's costs up to $120 a head in credits. When gates return, a school email writes a one-year entitlement row: a quarter session-day, no verification vendor.

**One thing.** The slice cannot pay us yet: one price, an Apache-licensed number, and a web checkout come before any listing.

## CX

**Verdict.** Go with conditions. A non-expert activates on seeing the thing work, not on reviewing hunks, so turn undo is a retention lever and per-hunk review is expert furniture; and the desktop cannot yet measure any of it.

**Must-fix.**

1. Re-grade the slice evidence. Real for the non-expert: the setup bounce (Benchmarked, weak: one HN quote, beginner roundups); the crippled local context (Benchmarked, Zed's docs); fear of the meter (Benchmarked, moderate: six vendors, credit complaints at Lovable and Bolt); the test-runner ask (875) but only as automatic verify. Local-first users only: silent downloads, offline, telemetry. Expert-only: extensions, Vim, fonts, debugger, git depth, the AI off switch. Planning, voice, and phone remote (75 to 135 votes) are small developer samples, and two are not fully verified on a device, so "already ships" cannot go in copy.
2. The desktop first run skips the phone's one choice. beginGuidedSetup returns unless isPhone() (store.ts:5776), so the person whose files get edited lands in Accept edits unasked, with no undo, and interaction-model step 5 ("Edits are diffs to approve") is false by default. Measured. Until undo ships, ask the 09-24 question once in the first coding chat.
3. The funnel mislabels (Measured): first_accepted_edit fires on any successful edit tool (store.ts:1958), so under Accept edits it counts edits that landed; first_local_reply fires for cloud too (store.ts:1951), so "on a free local model" cannot be read; my 09-14 events never landed. Add with each build: project_trust_shown {keys} and _decided; context_seated {tokens}, context_overflow; verify_detected, verify_result {pass, retries}; turn_undone {files}, restore_failed; outcome_marked; first_seat_shown, first_task_started {local}, new_project_started; external_turn {agent}, approval_answered {where}. The ACP agent carries none.
4. Seat the context before any cohort. The engine calls Ollama's native /api/chat with no num_ctx (openaiCompatible.ts:214), so the server default applies. The fix may be one request option. Measured; the window size is Assumed until ollama ps. A test on a 4K window measures the bug, not the person.

**Positions.**

1. No editor, agreed. A Files view is expert comfort. This person's proof is the app running (Benchmarked, weak transfer: app builders show a preview and hide the code, but they host). Build "See it running" before Files.
2. Both after trust, context, verify, undo, and the cohort read. Agent first: it adds nothing to the device backlog, while host swaps one untested transport for another. Both serve developers.
3. Real (Measured, load.ts:66, loop.ts:338). Smallest honest fix: a repo file's verify, permission, provider, stack, and egress keys are ignored until the person trusts the folder; the card appears only when such keys exist, with "Not now" first; "Always allow" grants stay on the device too (today they go into the repo's own config, load.ts:173, so a cloned stranger's grant looks like yours). Non-experts clone templates (Assumed) and cannot judge "allows npm" either.
4. Drop per-hunk review: the draft's own premise says this person cannot judge a diff. Turn undo plus per-file undo on the Changed files card covers them (Assumed). Keep the freeze: at least 13 device checks are open, and none of the five latest log entries has been tried on a device.
5. Kept-first-build rate: within 14 days, a task that changed files, passed its check or was marked "It works", and was not undone, then a second task on a later day. Hypothesis: with must-fixes 2 to 4 done and undo in, 40% of non-developers get there on their own 8 to 16 GB computers. Sample: 30 from app-builder communities, insights on, logs shared from a day-14 card; silence counts as a miss. Guardrails: zero files lost to undo (Zed #28676); fewer than one in five switch to Ask first in session one; 80% of DeepBlue installs finish. Decision: 12 or more, court non-developers; 6 or fewer, harness first and the developer channel leads; in between, fix the top stall and rerun. At n=30 the margin is plus or minus 18 points: a threshold, not an A/B. Build three weeks, run four, read by day 60. Top of funnel: public Release download counts, no telemetry.
6. The CMO writes it. Test, once built: "A free model on your own computer. No meter. Every file change can be undone." Never claim: safe to open any repo, undoing commands, Claude parity, beating Zed, "use your subscription", savings, or anything not yet tried on a device.

**Elevations.** Start something new: desktop coding needs an existing folder (ReposScreen.tsx); a row that makes one in ~/OSCode, runs git init, and opens a chat gives a non-expert a start, and checkpoints from turn one. See it running on the task-done card: the non-expert's verify pill ("42 passed" means nothing to them). It works / Not yet on that card when no check exists: the only honest ground truth, and the metric's source.

**One thing.** Seat the context, fix the funnel's names, and put 30 non-developers through the desktop first run: the kept-first-build rate says whether this slice exists before any Zed feature is built for it.

## Creative Studio

**Verdict.** Go with conditions. The draft takes the right thing from Zed, its trust machinery, and one wrong thing, the expert's posture: it asks a non-expert to judge every hunk, and none of the new surfaces has a motion, an exit, or a color yet.

**Must-fix.**

1. Keep is homework. The draft says a non-expert "cannot judge a diff", yet puts Keep and Undo on every hunk. Under Accept edits the change has already landed, so Keep does nothing. In chat, offer only Undo: per file on the card, per hunk one level down. Keep shows up only where nothing has landed yet, such as a routine's copy.
2. Two undos on one card. "Undo this turn" and "Undo all" both sit on the Changed files card and read the same. Keep one.
3. Undo tells the truth and never asks for confirmation. Restore puts files back but does not undo commands. After an undo it says: "Files are back. The npm install it ran stays." Restore is itself checkpointed, so offer Redo instead of "Are you sure" (Zed #28676, "irreversibly destructive").
4. Verify reads as a warning today. transcript.ts:314 pushes the result as a note, and `.msg-note` is warn ochre (theme.css:1456). A pass should be `pill ok` "42 passed", no check `pill muted` "Not checked", a final fail danger. Never teal: the 2026-09-24 sweep kept `--local` for local and private only, which retires the 09-14 "skipped stays teal".
5. Nothing can leave the transcript. `.changed-card` and `.tool-card` arrive on `msg-in` (theme.css:8208, 1681) and have no exit. The polish guard still checks only scrims (polish-standards.test.ts:141); the 09-14 card clause never landed.
6. Outside agents wear the wrong color. `.pill.current-pill` is teal because "a current runs on a machine you own" (theme.css:11159), but Claude Code and Codex think in the cloud. Color by where the thinking happens: amber for them, teal only when the agent runs a local model.
7. The trust card holds one decision. Adding the Approvals choice to it breaks one-step-at-a-time. No card when the repo brings no settings, and no standing "Restricted" banner after Not now.

**Positions.**

1. Agree, no editor. The Files view is a pane that glides into Chat from a card row, not a room, so the freeze holds.
2. Trust first, then checkpoints, then the ACP host, then the ACP agent. An outside agent with no undo is the least calm thing in the draft.
3. The mechanism is the CTO's. As the person feels it: ignore project settings until trusted, one inline card in plain words, ask again only about lines a pull changed.
4. Also remove the per-hunk Keep, the second undo, and `msg-note` as the carrier for verify. Keep "Always allow this in the project" over Zed's "Always for pattern": a regex is how an expert thinks.
5. CX owns the number. What we would watch: the share of first sessions that reach a green verify pill, and how often an undo is followed by a retry versus the person leaving.
6. The CMO decides. Our offer: "Watch every change. Undo any turn. No meter." Never claim undo covers commands, never say "safe" before the sandbox ships, never knock Zed by name.

**Elevations.** Learn from Zed: trust off until granted, a checkpoint before every prompt (outside agents' prompts too), a short approval. Leave: the pattern rule, the banner, the view that jumps.

Three directions. A, the Ledger: every surface is one more tool card; cheapest, but undo looks like any other button. B, the Desk (Zed's): a review pane and a file tree that follows the agent beside the chat; an editor under another name. C, the Tide (recommended), extending the Current in the Thread:

- Undo a turn: the turn's cards fold in reverse `--stagger` on `--ease-glide` over `--dur-7`, dimmed but never deleted, one line stays: "Undone · Redo". `hapticCommit` marks the restore landing. Neutral ink, never danger red, because undo is safe.
- Per change: a row opens with `.reveal`; Undo slides the hunk out (translateX and opacity, `--ease-accel`, `--dur-4`) and the counts crossfade; on the phone SwipeRow arms it.
- Trust card: arrives on `msg-in` with an `--attention` badge, no haptic; provider lines use `pill cloud`; once answered it folds to "Using this project's settings · Change".
- Outside agent: the same cards plus one owner line ("Claude Code is working"); an amber rail on the left edge rises on `--ease-glide` and ebbs when the run returns; approvals through ApprovalSheet with `hapticApproval`.
- Files view: follows edits, not reads; the file crossfades (`--dur-4`), changed lines get one wash in the owner's color (`--dur-6`), switches at most once every 1.5 s; any scroll by the person ends following; no haptic.
- Verify pill: in the head of the Changed files card (the task-done card, transcript.ts:371): "Checking" with the spinner, then the check draws once; `hapticSuccess` only on the final pass.
- Routine copy: a `cc-presence waiting` row opens the same card; Keep lands with `hapticCommit`, Drop leaves a Redo toast; both exit on `--ease-accel`.
  Also: Undo on the Stopped card, where people want it most, and on the phone. Haptics only on the phone. Reduced motion turns every fold into a crossfade.

**One thing.** Give undo one button, a Redo and one honest sentence, and a non-expert will let the agent work.

## Chief of Staff

**Verdict.** Go now on one item, the project-trust fix, a live security hole wider than the draft says. The rest is mostly harness step 2 under a Zed label, or new surface that should wait for the device backlog (about 18 open checks, up from eleven on 09-14).

**Must-fix.**

1. The trust gap is real, and worse than drafted. A repo's os-code.config.json merges over the global config with only daemon dropped (config/load.ts:66). Its verify command runs without asking (loop.ts:338). Its permissions.defaults can make shell, push, and cloud spend silent, even in Ask first, and guardrails.maxDollars can lift the spend cap. Every OpenAI-compatible provider reports kind 'local' (openaiCompatible.ts:37), so a repo that changes providers.ollama.baseUrl sends code, and that project's secrets, to a remote host while the secrets gate still calls it local. "Always allow in this project" writes into that tracked file, so one person's grant ships to everyone who clones. Fix it as an allowlist, the inverse of the 2026-09-05 daemon ruling, not as a card a non-expert cannot judge. Supersession lines needed: that ruling's scope, and where allow-rules live. Land it before the GitHub App goes public.
2. Two reversals without a supersession line. Making the trust card the "home for the Approvals choice" reverses CX 2026-09-24, which made Approvals a device setting; drop that clause. Folding Vellum and OpenAGI into an ACP roster reverses the founder's 2026-09-09 "find a way to connect them", and the research contradicts the premise: neither is among the 42 registry agents, and OpenAGI is an in-process Python framework. Keep both rows.
3. Item 16 misquotes the Board. "Backlog under five" gates the phone-alone host, not new rooms, and my 09-14 memo said the backlog must not queue behind the harness. A room freeze would be a new founder rule, and item 12 (the Files view) already breaks it.
4. Items 3, 4, and 6 are harness step 2; item 2 is step 1's context budget, and its mechanism is wrong. Track them in the harness plan. Rewind's surface is already decided: on the tool card through SwipeRow, founder call 4, "final as written". The engine uses Ollama's native /api/chat and sends no num_ctx (openaiCompatible.ts:190). The fix is one field per seat, sized to RAM, then a re-run of the eval, since a bigger KV cache could push the 3B into the same swap stall that sank the 7B on this box.
5. Legal. The pitch leads with a 3B under Qwen's non-commercial license. osc in a public registry would carry the placeholder "no license granted". Zed's editor crates are GPL-3.0, so checkpoints and ACP are built clean-room. MCP and ACP tools never register under egress lockdown (2026-09-09).
6. Order. The ACP host waits for CLI Pairing's first run on a real box. Routines on a copy wait for a routine's first real scheduled run. Session 1: the allowlist with a test for each vector above, judging "local" by address, num_ctx, then the founder runs the eval once with qwen3:4b beside the 3B. Session 2 finishes step 2: checkpoints, Rewind, per-file Keep and Undo on the Changed files card, verify autodetect and its pill, ending in the Board's recording.
7. Three founder picks; the rest delegates. (a) Trust: the allowlist with no new question (recommended), or the draft's card. (b) The floor model: measure Apache-licensed qwen3:4b and move to it if it holds (recommended), or ask Qwen for a license; this eval has been open since 2026-09-05 and was the Board's one thing on 09-14. (c) One device sitting before any Zed build past session 2 (recommended), or the room freeze. CTO: the allowlist, moving existing allow-rules, checkpoint storage; ACP and sandbox later. CMO: the never-claim list, and fixing the site's stale $20 first. Creative Studio: Keep and Undo inside the Rewind design.

**Positions.**

1. Agree; CX ruled no editor on 09-24. A Files view is a sheet off the Changed files card, never a room, and comes later.
2. Both, after trust and step 2. Host first: it upgrades an existing current and keeps the phone a remote. Detect the adapter, never install it. Agent last: it serves experts without the app, and waits on both licenses and a published number.
3. Yes, plus the secrets hole. Smallest honest fix: a repo may set ux and humanizer, and may propose a verify command that asks once and is remembered on this computer. Everything else is ignored, with one note.
4. Remove the Wayfinding Browser row (flagged 09-09, 09-14, and now) and add a test that every switch names what it gates.
5. No telemetry, so count public or opted-in signals: opt-in testers who reach first_accepted_edit with no cloud_key_added (CX 09-14), and Release downloads the week after one r/LocalLLaMA post of the recording.
6. "Real work from a model you already own." Against metering: "No meter. No markup. Your keys." Never claim: safer or more private than Zed (it has Restricted Mode and a sandbox; OpenShore has neither today); "feels like Claude Code"; "use your subscription" before a terms check; "ships" for anything not verified on a device; a free 3B for commercial use.

**Elevations.** Judge "local" by address (loopback, LAN, tailnet), not by provider kind. Show the context on the seat pill ("8K context on this computer"), which answers Zed users' "silently crippled" complaint. One device-pass sheet grouped by device, so one sitting clears most of the backlog.

**One thing.** Close the repo-config hole before anyone else can clone into OpenShore, then let the harness order, not Zed, set the rest.

## Board

**Verdict.** Proceed with conditions on the first half; not yet on the second. Trust, undo, keep-or-undo, zero-config verify, and the context check are harness step 2 plus a security fix. ACP in either direction, the sandbox, MCP, and the Files view are new surface the backlog cannot absorb.

**The angel.** The cost we are counting is still the founder's attention. There were 71 commits in the last three days, against about 8 a day at our last memo. At least sixteen device checks are open, against eleven then and a gate of under five. All five of today's log entries end unverified on a phone. Personal is sold only in-app on the iPhone, so the Ollama users this draft courts cannot pay without one. The ACP listing is free to list but not free to support, and it earns nothing. Stop adding switches and BETA groups (Chain of Thought today, Jev two days ago), and park the Air program.

**The operator.** The tools that earned trust each won one loop. Aider committed every change with /undo from the start and published a leaderboard across many models. It also sets Ollama's context on every request because the default cuts it off silently. That is three of this draft's fixes, and Aider treated them as table stakes. Cline saves its checkpoints in a separate hidden git repository that leaves the person's history alone and works without git. Copy that. LM Studio tells you what fits before you download. Continue is the warning: it lived as a guest in other people's editors and got squeezed when those editors shipped their own agents. Zed teaches pruning and a real off switch. The 75% is three of four tasks, best of two, from one run, after earlier rounds that swung between 25% and 50%. That is a regression test, not a headline.

**The contrarian.** The ACP listing puts a CPU-bound 3B next to Claude Agent, Codex, and Gemini CLI, in front of experts the draft says it is not targeting, inside someone else's panel where undo, the verify pill, and the phone do not come along. The number it would lead with was measured on a Qwen model under a non-commercial license, and the engine itself has no license yet. The ACP host upgrades CLI Pairing, a path nobody has run on real hardware, into a phone remote for agents whose own vendors already ship one. The sandbox has a long tail: Zed's own docs list ways out of it, and with the network off, npm install turns into a network approval the person still cannot judge. It also misses the hole that is actually open, which is in config, not the shell.

**Conditions to unlock each phase.**

- Trust fix: now, before any distribution build. Done when a test clones a repo carrying harness.verify.command, a runShell allow rule, and a provider baseUrl, and none takes effect until the trust card is tapped.
- Step 2: now. Closes when: ollama ps has been read on the box and the eval re-run; restore round-trips in a folder without git; the suite has 20 tasks, run at three attempts, with and without the harness; the floor model is Apache-licensed, or Qwen has granted a commercial license.
- ACP host: the backlog is under five, five testers other than the founder have used CLI Pairing on their own hardware, and the CTO has read each vendor's terms.
- ACP agent: a stranger can reproduce the step 2 numbers with one command, the engine has a license, and the listing hands off to the app.
- Sandbox and MCP: after trust, and only on evidence (more than three approvals per task in Ask first, or a real incident). Linux first.

**Positions.**

1. Agree, no editor. Ship "Open in your editor" now; the Files view waits until testers ask for it.
2. Neither before trust and step 2. After that, host first, then agent, each on its own gate.
3. Yes, and wider than described. A project file can also set trustedRepos, and "Always allow in this project" writes its grants into that same file inside the repo, so a grant can reach every clone. The smallest honest fix uses a seam that already exists: read trustedRepos and grants only from the machine's own config, and apply a project file's security settings only for folders on that list.
4. Also remove Vellum and OpenAGI now, take the grayed-out Marketplace out of the sidebar, and hide the Harness Currents group until Jev has its eval. Keep the CLI Pairing shell-out until something replaces it on a real device.
5. Recruit an opt-in cohort of 30 (20 local-first developers, 10 non-developers) who export their metrics by hand. The slice is real if half reach a verified task in their first session and a third are back in week four. Cheapest experiment: one recorded, verified fix posted on r/LocalLLaMA with a signup link.
6. "No meter, no markup, no telemetry. Your models, your computer, and an agent that checks its own work." Never name Zed. Never claim parity with Claude Code; "nothing leaves your computer" (local models now search DuckDuckGo by default); a sandbox; "use your subscription"; a saving; 75% without "four tasks, one CPU-only box, best of two".

**Elevations.** A public leaderboard showing each model with and without the harness on the reference box: marketing and tenet 2 at the same time. "Undo this turn" on every task-done card, including the phone.

**One thing.** Ship the trust fix this week, then start nothing new until the device backlog is under five.

## Corporate Strategist

**Verdict.** I endorse the spine of the draft: no editor, and take Zed's trust machinery while leaving its editing machinery. But the draft sells an unverified platform as a checklist and leans toward the expert in review. Reshape it: project trust and undo first, then one device-proven path from a sentence on the phone to an app in the store.

**Must-fix.**

1. The slice rests on unverified builds. Point 5 says voice, the phone remote, planning and offline "already ship". What remains lists 16 open device checks, voice and routines among them. On 09-14 the Board counted eleven and gated new work at under five. Since then, at least 66 non-merge commits landed from 09-21 to 09-25. Call nothing shipped until it is checked.
2. Per-hunk review serves the expert. The draft's own premise is "a non-expert cannot judge a diff", and a per-hunk Keep or Undo asks exactly that. The person's unit is the turn: a plain summary, the verify pill, and "Undo this turn". Hunks sit behind a disclosure. The Files view waits, because it is an editor's first brick.
3. The trust gap is worse than the draft says. loadConfig strips only daemon from a repo's config. maybeVerify runs the repo's own command with no prompt wherever shell may auto-approve. "Always allow in this project" (addProjectPermissionRule) writes into the repo-root os-code.config.json, so a push can carry it to the next person who clones. Repositories made every GitHub repo reachable today (ec34079), and CX's 09-24 ruling treated Zed's trust option as a question about edits.
4. The default breaks a written tenet. Interaction-model tenet 5 says "Edits are diffs to approve." The default is acceptEdits, and the site says "diffs you approve". How the founder actually works shows the real tenet: every change can be undone. Rewrite both the tenet and the site line in the commit that ships undo.
5. Pricing rests on unsettled ground. The 3B floor model is under the Qwen Research License, which is non-commercial. The site says Personal is $20; CLAUDE.md says $50. "No meter, no markup" copy waits on both, and both are a Board gate.

**Positions.**

1. Editor: agree, no editor. Defer the Files view. "Open in your editor" can be one link on the changed-files card: a door for experts, not a room.
2. ACP: trust, then undo, then the host, used as CLI Pairing's transport with a few curated agents. That makes the phone the remote Zed users asked for (75 votes). The agent side comes last, once the host passes on a device. It serves experts in someone else's room and markets our least unique part, a Claude Code-shaped loop on local models.
3. Trust: yes, see must-fix 3. The smallest honest fix: from a repo's file, apply only instructions and UX or humanizer notes until the person accepts one plain card. Trust and granted allow rules live on the device, never in the repo. The mechanism is the CTO's call.
4. Missed: the site lines that are now false (the grayed-out Marketplace still shown as a pillar, "Harbor Light" renamed to Harbor Lite, and "diffs you approve"). The Air program puts a coding agent's compute on the phone, against DECISIONS 2026-08-25 ("a remote control and a viewer, not the compute") and skipping the Board's hardest gate; park it. Keep Hermes, A2A, and the one-at-a-time rule. Item 14 fails: neither Vellum nor OpenAGI is in the 42-agent registry the research lists.
5. Number: with no telemetry, this cannot be a funnel metric. Take ten non-developers from the early-access list, on their own laptops, one task each, unassisted, with the founder watching. The slice is real if 6 of 10 reach a green verify pill in their first session and none loses work.
6. Sentence: "Build software without learning an editor. Your models, your machine, no meter, and your phone is the remote." Never name Zed, because our person has never opened it. Never claim "always on", "trains itself", "as good as Claude Code", "safe for any repo" before project trust ships, "your Claude subscription" before the CTO checks vendor terms, or a dollar saving from Jev.

**Elevations.**

- The extra mile is a path, not a list. You say it to the phone. The Stack plans it in plain words. Your desktop and your models run it, verified and undoable. A routine carries on while your computer is on. The Vault remembers it, and Launch ships it. The ethics floor holds the whole way. Zed ends at a diff; OpenShore ends at an app in a store. Every stage exists, but no handoff between them has been proven on a device. That chain is what is honestly unique.
- The path is the backlog plan. One recorded run through it clears about half of the 16 device checks. The recording is also the Board's marketing unit.
- Enforce the freeze in code. Restating the Board's gate did not hold: the count went from eleven to 16. Let progressShape.test.ts fail when a new room or Settings group is added while five or more device checks are open.
- Tenet 6 for CLAUDE.md: "No editor, no expert gate. Borrow trust machinery, never editing machinery. Every feature passes one test: can someone who has never opened an editor use it, and undo it? Experts get a door, never a room."

**One thing.** Ship project trust and one-tap undo, prove one path from a sentence on the phone to an app in the store on real devices, and let everything else, ACP included, wait.
