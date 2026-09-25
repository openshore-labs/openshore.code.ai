# The v1 direction, reviewed: the advisor team's consensus (2026-09-25)

Status: REVIEW. Nothing is built. The founder received advice setting the
direction for OpenShore v1 and asked the team for a consensus go or no-go that
closes the gap on what v1 needs. All eight advisors read the direction, the
facts verified in code before the review, PROGRESS, DECISIONS, and the Zed
documents (`zed-proposal.md`, `zed-research.md`, `zed-advisory-memos.md`), then
wrote independently. Their memos are in `v1-direction-advisory-memos.md`. The
direction is quoted in full at the end of this document.

## The verdict

**GO WITH CONDITIONS, eight of eight.**

Every advisor calls this the right v1. It is the first plan in a month that
cuts scope. It picks one person and one promise, and it puts project trust
first. The Corporate Strategist calls it the product the founder already chose
on 2026-09-22 when declining the relay.

But as written, the direction cannot meet its own definition of done, and its
headline promise is not literally true in the code today. The conditions below
close that gap. With them, the team says go.

## Why it cannot be done as written

Every memo found the same four problems.

1. **The phone cannot run the check or undo a change.**
   - `maybeVerify` skips whenever shell cannot auto-run (`loop.ts:341`), and
     every session the phone drives runs on the `remote-attached` profile,
     where that is never allowed (`profiles.ts:34`, `serve.ts:966`). So the
     phone shows no pill at all, not even "Not checked".
   - Undo has no daemon route.
   - Verify runs through `execSync` in the Electron main process, which also
     hosts the daemon (`verify.ts:65`, `engineHost.ts:900`). A long test
     freezes the window, and the phone's 4-second probe then reports "Can't
     reach your computer" (CTO).

   The recording's "fixes a failing test from the phone, the pill turns green,
   and undo puts it back" cannot happen until Phase 1 names this.

2. **The only measured free model cannot be sold beside.** The recorded floor
   is Qwen2.5-Coder-3B under the Qwen Research License, which is
   non-commercial. `qwen3:4b` (Apache) has waited for a run on the reference
   box since 2026-09-05, and the deep suite has no fix-a-failing-test task
   (CTO).
3. **"No one, including us, is watching" is false in code.**
   - A signed-in person's blocked request, and allowed likeness records too,
     post to our own `guardrail_events` table. Fields include the request
     hash, the signals, and the named person. The records feed a server-side
     ladder that can close the account (`app/src/lib/ethics.ts:116-140`,
     `chokepoint.ts:65`, `:168`).
   - Push passes through our `push-send` function (`daemon/push.ts:211`).
   - The catalog is fetched from openshore.ai daily (`market/catalog.ts:52`).
   - Update checks go to GitHub every 30 minutes, with automatic download and
     no off switch (`electron/main.ts:1106`, `:1175`).
   - The repo OAuth code exchange runs on our edge function, so the person's
     token passes through our server (`supabase/functions/repo-oauth/index.ts:206`).
   - Every local model searches DuckDuckGo by default (`webSearch.ts:71`).
   - Tailscale's coordination server sees device metadata.
   - Buying Personal requires an account, so we hold an email and a payment
     record.
4. **Ninety unedited seconds cannot hold a stranger's setup.** Setup means
   Ollama, a 2 to 5 GB model, Tailscale on two devices, and a CPU model at
   single-digit tokens per second. A 7B reads its prompt at 6.7 tokens a
   second on the reference box.

The team also found new release blockers the direction does not name:

- The engine treats any `*.ts.net` host as local, including a stranger's
  public Funnel host, which is the key-theft vector Phase 0 exists to close
  (`egress.ts:58`; CTO).
- macOS 15 removed the right-click Open bypass for apps that are not notarized
  (CX, citing Apple, 2024). Our Mac copy still tells people to do it
  (`MAC-DESKTOP.md:18`).
- Windows SmartScreen blocks the unsigned installer (`release.yml:277`; CX).
- When the pay gates return, the desktop has no free local chat. The composer
  defaults to the paid engine session (`ChatScreen.tsx:191`, `store.ts:3829`),
  and the paywall sends Linux and Windows people to buy on an iPhone
  (`Paywall.tsx:61`; CX).
- The Sign in card promises "Sync chats across your devices"
  (`Sidebar.tsx:291`), but no chat table exists (Creative Studio, CTO).

## The direction, amended

### Before Phase 0: paper and the founder's hours

- **Write the supersession lines in DECISIONS (Chief of Staff).**
  - The phone-alone host from 2026-09-14 is superseded. The 2026-08-25 ruling
    ("a remote control and a viewer, not the compute") is reaffirmed.
  - The Air program (2026-09-21) is parked.
  - The team ladder (2026-09-14) moves to v2.
  - Hidden, not deleted: the grayed-out Marketplace (09-21), Agentic Currents
    (09-09), Harness Currents (09-23), and Crew routines (09-05).
  - The harness ends at step 2 for v1.
  - The ethics ladder change and the free chat ruling follow the founder's
    picks below. Personal Apple-only (08-31) changes only if web checkout is a
    yes.
- **Put a "v1 plan of record" section at the top of CLAUDE.md** (Chief of
  Staff, Corporate Strategist). It holds the promise, the stranger test, the
  phases, and the not-in-v1 list. Mark each BUILT section "hidden in v1, code
  intact, unhide is a founder call". Add an egress rule beside the em-dash
  rule: every outbound host is a listed line and a test. Add a stop rule: no
  new room, Settings group, BETA switch, or model integration until launch,
  enforced by a test (Board, Corporate Strategist).
- **Hold a Board vote on $50 Personal with no team tiers**, the gate from
  2026-09-05.
- **Take the false copy down now.** It is copy only, a few hours. The
  downloads sit under "No phone-home, ever" (`viz.njk:151`), and every $20 is
  still live (CMO, Board).
- **Book the founder's hours** (Chief of Staff): one hour on the reference box
  for the eval, one device sitting, and the stranger sessions. Since
  2026-09-14, every plan has stalled on founder hours, not on code.

### Phase 0: release blockers

The direction's two items, plus four more.

1. **Project trust.** As written. Add: "local" means loopback, LAN, or the
   person's own tailnet, and never any `*.ts.net` host.
2. **The context window.** As written. Add:
   - Keep `num_ctx` the same for every call to a model, because a change
     reloads it.
   - Feed `compactAtContextFraction`.
   - Detect Ollama behind a BYOM `/v1` address and use its native API.
   - Redo the fit table with the context included.
3. **New: the ethics upload.** Screening stays on the device. What happens to
   the server upload and ladder is the founder's pick below.
4. **New: the floor-model eval.** Run `qwen3:4b` beside the 3B, with and
   without `num_ctx`, at three attempts. Add a fix-a-failing-test task (the
   Board asks for 20 tasks or more).
   - Gate: an Apache-licensed model scores within ten points of the 3B, or
     Qwen grants a commercial license in writing.
   - If none passes on the reference box, the copy says 16 GB.

Phase 0 gate: each trust vector has a test that fails before the fix and
passes after, and `ollama ps` shows the planned context.

Sizes: the CTO estimates 6 to 7 days; the CFO 2 to 2.5 session-days plus a run
on the box.

### Phase 1: first-run success

Reordered: undo, verify, the hide flag, then first run. That way strangers
test the surface v1 will actually ship (CTO, Creative Studio).

1. **Undo.**
   - Storage: a shadow git directory outside the project. It works without
     git and is never pushed (CTO; the Board cites Cline). The touched-file
     map in the loop is not undo: it misses files a command wrote, and it is
     lost when the process ends.
   - Daemon routes for restore and redo, refused while a session is busy and
     journaled so both devices see them.
   - The Creative Studio's "Tide": the task's cards fold in reverse, dimmed
     but never deleted, leaving "Undone · Redo" and the honest sentence. No
     "Are you sure".
   - Gate: 50 restores, with and without git, on desktop and phone, with zero
     files lost (Board).
2. **Verify.**
   - Detect the project's check automatically.
   - Make it asynchronous.
   - Hold a verify grant on the machine, keyed by real path, origin, and a
     hash of the command. The owner grants it once from either device through
     the existing approval card; members cannot grant; a changed command asks
     again. With that grant, verify runs on phone sessions. Shell still asks
     every time.
   - The pill reads:
     - "Checking" while it runs;
     - "All 12 passed" in green (green means only this);
     - "1 of 12 failing" in red, only after the final attempt;
     - "It works / Not yet" where there is no check.
   - The green pill folds with an undo.
   - Gate: the pill turns green from the phone.
3. **New: the hide flag.**
   - It is build-time and stops code from running. The routine scheduler and
     the Currents probes start on their own today (`scheduler.ts:189`,
     `store.ts:3391`).
   - One gate at the source: `navRooms`, read by the Sidebar.
   - `agenticView` and `harnessView` return nothing under the flag.
   - A test fails on any link to a hidden surface.
   - Close today's holes: pairing's next button opens Terminal
     (`PairScreen.tsx:390`, `:520`), Harbor's intro lands on the Marketplace
     (`store.ts:5683`), and six setup guides lead to hidden features.
4. **First run and pairing.** The four named failure states, plus the stuck
   points CX and the CTO found. Each gets a test, one plain line, one button,
   and a "Copy details" block.
   - Mac notarization and Windows code signing.
   - A sample project with one failing test, one tap from the First Seat.
     Strangers have no failing test, and desktop coding needs an existing
     folder.
   - The Ollama install bridge actually wired up. Today it is built but never
     called, and the card says "ollama serve".
   - Hardware that cannot be read no longer gets the 7B.
   - Tailscale install links for Windows and Mac, instead of
     "sudo tailscale up".
   - Phone and desktop on different Tailscale accounts.
   - The Windows firewall.
   - Ollama installed but stopped.
   - A full disk mid-download.
   - A sleeping desktop.
   - A phone-first walk that says where to get the desktop app.
   - The phone's empty chat as one card: "Your computer does the thinking.
     Connect it." (Creative Studio).
   - The phone's Harbor 3B download hidden.

Phase 1 exit: ten strangers on their own computers, with the founder watching
and silent. It passes if six reach a green pill and none loses work. Every
stall is filed as a bug. The device backlog must also be under five (Board,
Corporate Strategist).

Sizes: the CTO estimates 12 to 16 days plus a device pass on all three desktop
systems; the CFO 5 to 8 session-days.

### Phase 2: launch surface

Reordered: the egress audit before the copy, so the copy matches it (CTO).

- **The audit.** Change these defaults:
  - Web search asks once.
  - Updates ask before downloading, and the check is listed.
  - Push stays off until the person turns it on.
  - The catalog fetch stops with the Marketplace, or is listed.
  - The repo OAuth exchange moves off our server, or is listed.
  - Cloud providers go through `EgressPolicy`, which raw `fetch` skips today.
  - Spellcheck dictionary downloads are checked.
- **The test.** On the desktop, in CI: hook `net` and `tls` connect and
  `dns.lookup`, Electron's `session.webRequest`, and a wrapper around spawned
  git, ollama, curl, and CLI agents. On the phone: a static manifest over
  every host and fetch call site, plus a proxy pass on a device.
- **"What leaves this device."**
  - A row, not a room, first under Settings, Privacy.
  - Grouped by recipient, with "Open Shore (us)" first.
  - Amber for what leaves, teal for what stays between your devices.
  - It renders from the same list the test reads.
  - The Stack Health privacy seal moves here.
- **The copy.** The CMO's line-by-line list across the site, the app, and the
  App Store listing, which must also declare the email, the push token linked
  to the account, and any guardrail record. "Sync chats across your devices"
  comes out.
- **Web checkout, the trial, and the license** are settled before Phase 2
  ends.

Sizes: the CTO estimates 6 to 9 days; the CFO 5.5 to 8.5 session-days.

### Launch gate (new)

- **An unmoderated stranger test (CX).**
  - Who: 30 strangers from outside the founder's network, 10 on each desktop
    system, half on 8 GB machines, 20 with iPhones.
  - What: the download page, one written task (fix the sample's failing test
    from the phone, then undo it), and a screen recording sent back.
  - Any request for help counts as a failure.
  - It passes if:
    - 21 of 30 finish the desktop part alone;
    - 14 of 20 finish the phone part;
    - nobody loses files;
    - nobody sees a raw error;
    - no single stuck point causes more than three failures.
- **A refundable founding pre-sale.** It must reach ten stranger payers per
  2,000 downloads (Board).
- **Support.** Email for payers; in-app recovery for everyone (Board, CX).

### The definition of done, amended

Keep the bar. Change its form so it can be true.

- One full, unedited run with a wall clock on screen, however long it takes.
  It is made by someone other than the founder, on their own normal computer,
  with an Apache-licensed model named on screen and the number of takes
  published. Setup may be its own unedited take.
- A 90-second cut from that run, with every cut marked ("+4:12 waiting").
- A logging proxy on the same run whose hosts match "What leaves this device"
  (Board, Corporate Strategist).
- The launch gate passed, and every visible surface run on a device.
- $50 live on both payment rails, with one real stranger purchase through
  each, and a signed LICENSE in place of "no license granted" (CFO).

## The hide list

The v1 sidebar (Creative Studio):

- Chats, Projects, Repositories, Stack, and Desktop + phone;
- then Cloud Connections and Settings.

| Surface                                                                                  | Call                                | Why                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crew and routines, and the scheduler                                                     | Hide (8 of 8)                       | Never run on a real schedule; unattended runs breed tickets; the scheduler must not start.                                                                                                                                                   |
| Launch with Codemagic                                                                    | Hide (8 of 8)                       | A second and third account; the costliest setup to support.                                                                                                                                                                                  |
| Marketplace, the catalog fetch, reviews                                                  | Hide (8 of 8)                       | A grayed-out room is a promise; the fetch is a daily call to us.                                                                                                                                                                             |
| Admin, org projects, org vault, team plans, the Business question at signup              | Hide (8 of 8)                       | v2, and a buyer's asset.                                                                                                                                                                                                                     |
| Agentic Currents and Harness Currents (Jev), with their probes                           | Hide (8 of 8)                       | BETA, cloud calls, unread vendor terms, no eval.                                                                                                                                                                                             |
| Terminal room and its route from the phone                                               | Hide the room (8 of 8)              | An expert's door, and an unjailed shell from the phone. The terminal itself stays for the Linux Ollama install.                                                                                                                              |
| Vault room                                                                               | Hide the room (7 of 8)              | A second product; project memory stays reachable from the Project room. The Board would keep it as project memory.                                                                                                                           |
| Stack Health room                                                                        | Hide the room (8 of 8)              | An operator's view with unmeasured estimates; its privacy seal moves to "What leaves this device".                                                                                                                                           |
| Wayfinding's Browser switch                                                              | Hide (four named it, none objected) | It gates nothing, flagged since 2026-09-09.                                                                                                                                                                                                  |
| Harbor 3B download on the phone                                                          | Hide (5 of 8)                       | Non-commercial, and it implies the phone does the coding. The CFO and Chief of Staff would keep it, reworded as a small helper and moved off the 3B.                                                                                         |
| Google Drive                                                                             | Hide (CTO)                          | OAuth plus traffic to Google.                                                                                                                                                                                                                |
| Voice, Chain of Thought, video attachments, Research                                     | Split                               | The CTO keeps voice. The CMO keeps Chain of Thought (off) and voice after a device pass. The Board and Corporate Strategist hide Chain of Thought. The Strategist hides voice and video. The Creative Studio hides Research. A founder call. |
| Harbor Lite                                                                              | Keep, reword                        | "A small guide on this iPhone. Coding runs on your computer."                                                                                                                                                                                |
| Web search                                                                               | Keep, reword                        | "Searches go to DuckDuckGo", in amber, and it asks once.                                                                                                                                                                                     |
| Docked pill                                                                              | Keep, reword                        | Teal, named for the computer; green is reserved for a passed check.                                                                                                                                                                          |
| Project memory                                                                           | Keep, reword                        | "Notes on this project, on your computer."                                                                                                                                                                                                   |
| Ethics screen                                                                            | Keep, reword                        | "Checked on this device."                                                                                                                                                                                                                    |
| DeepBlue                                                                                 | Keep, reword                        | States its model's license.                                                                                                                                                                                                                  |
| Chats, Projects, Repositories, Stack, Desktop + phone, Cloud Connections, BYOM, Settings | Keep                                | The recording runs through them; cloud is the escape hatch on the person's own key.                                                                                                                                                          |

## The four decisions the direction surfaced

- **License.**
  - Every advisor with a view: publish the engine's source so the privacy
    claim can be checked, keep the app closed, have a lawyer review it, and
    never say "open source" unless the license is OSI-approved.
  - The terms split. BSL 1.1, converting to Apache after a set date (CFO,
    Chief of Staff, Board), against Apache-2.0 now (Corporate Strategist).
  - Recommendation: BSL 1.1, decided before Phase 2.
  - Adopt the Strategist's riders either way: publish the app's egress list
    and its test, build desktop releases in public CI with provenance, keep
    contributions closed in v1, and check the IP first.
- **Trial.**
  - First project, not a clock: six of eight (CMO, Chief of Staff, Creative
    Studio, Board, CX, Corporate Strategist). A clock burns down during setup
    on exactly the slow machines OpenShore is built for. A first-project trial
    shows the paywall only after the person has seen it work.
  - The CFO prefers 14 days starting at the first green pill. The CTO prefers
    a time trial on the entitlement row, because counting projects means
    counting use. CX answers that: the counter stays on the device.
  - Recommendation: the first project free, counted on the device, no card.
    Never lock undo, history, or local chat. Add a 30-day cap only if the
    cohort shows many single-repo users.
- **Founding offer.**
  - No free year: four of the five who ruled on it (CMO, CFO, Board, Corporate Strategist). It delays the one number that
    matters, strangers paying. The Creative Studio dissents with "Your first
    year is free. Then $50 a year."
  - The shape is a refundable founding price. The number splits: $25 for the
    first year, then $50 (CFO), or $50 locked for life (Board).
  - CX adds: claim it with one opt-in tap after the first kept change. That
    call is listed on "What leaves this device", and it counts successes
    without telemetry.
- **Web checkout.**
  - Yes: seven of eight (the Creative Studio defers).
  - On the desktop and the site. The iPhone keeps in-app purchase and never
    links out (guideline 3.1.1).
  - Through a merchant of record that files sales tax and VAT. That nets
    about $46.50 to $47 a payer, against $42.50 on Apple (CFO).
  - It supersedes the 2026-08-31 Apple-only ruling.

## Where the team split

1. **What "15,000" means.**
   - As payers (Board, Corporate Strategist): about $640K to $750K a year.
     Anything less is a hobby.
   - As users (CFO): 750 payers in the base case, about $32K to $36K net. The
     support math favors this reading. 15,000 users adding 1,000 a month is
     about 100 tickets and 17 hours a month. 300,000 users is more than a
     full-time hire.
   - It decides whether the pay gates are on at launch, and the support plan.
2. **Pairing and the paywall.**
   - The direction puts pairing in Personal, and the CFO agrees: Tailscale is
     the costliest support path.
   - The CMO would keep chat from the phone free and charge for the agent
     ("charge for the building, never for where you are"). That matches the
     CTO ruling the founder approved (DECISIONS): "Chat with a paired
     desktop's own local models is free."
   - CX adds that the desktop needs a free chat path at all once the gates
     return.
3. **The promise line.**
   - Narrow it to what a packet capture proves, and let the screen list the
     rest. The CMO proposes "We never see your code or your prompts"; the
     Board adds "or your answers". The Chief of Staff recommends narrowing.
   - The Corporate Strategist would make the sweeping line true instead: move
     the ladder, make search ask, stop the catalog fetch.
   - Even then, a Personal account means we hold an email and a payment
     record. So "no one, including us" cannot be literally true for a payer.
4. **The ethics ladder.**
   - Keep the screening on the device and move the server upload and ladder
     into the team build (CTO, Corporate Strategist; the CFO and CMO accept
     this).
   - Or keep the server ladder and list every field it sends (Chief of Staff,
     Board).
   - A trust and legal call. The ladder exists so a reinstall does not reset
     enforcement, so moving it local gives that up.
5. **Pairing without Tailscale.**
   - The 2026-09-22 ruling allows "Tailscale or the local network", but the
     daemon binds only the tailnet or loopback.
   - The Board and Corporate Strategist ask the CTO to rule on same-Wi-Fi
     pairing for a first try, if the Phase 1 strangers show Tailscale is the
     biggest stall. A relay stays out.
6. **How many strangers.** Ten watched (Board, Corporate Strategist) or 30
   unmoderated (CX). Recommendation: both. Ten are the Phase 1 exit; 30 are
   the launch gate.

## Founder decisions, in the order they are needed

Before Phase 0:

1. Adopt the amended direction as the v1 plan of record. That covers the
   supersession lines, the CLAUDE.md section, and the stop rule.
2. The promise line.
   - (a) Recommended: narrowed ("We never see your code, your prompts, or your
     answers"), with the screen listing everything else.
   - (b) The sweeping line, made true as far as it can be.
3. The ethics ladder.
   - (a) Screening on the device, the server ladder in the team build.
   - (b) The server ladder kept and disclosed field by field.
4. The Board vote: $50 Personal, no team tiers. Take the $20 down now.
5. Book the hours: the box eval, one device sitting, the stranger sessions.

Before Phase 1 ends:

6. Pairing and the free tier.
   - (a) Recommended by the CMO, and consistent with the approved free-chat
     ruling: chat free from any of your devices; the agent is Personal.
   - (b) Pairing inside Personal, as the direction says.
7. What 15,000 means: payers or users.

Before Phase 2 ends:

8. License terms: BSL 1.1 (recommended by three) or Apache-2.0 (recommended by
   one).
9. Trial: the first project, counted on the device (recommended by six), or a
   clock.
10. Founding offer: a refundable founding price. The number is $25 for the
    first year, or $50 locked for life.
11. Web checkout through a merchant of record: yes (recommended by seven).
12. Voice, Chain of Thought, video, and Research: hide or keep for v1.

## The size of it

- The CTO puts the three phases at roughly 24 to 32 days: Phase 0 at 6 to 7,
  Phase 1 at 12 to 16 plus a device pass on three desktop systems, and Phase 2
  at 6 to 9.
- The CFO puts it at 12.5 to 19 session-days.
- None of it needs a server of ours. Every advisor agrees the constraint is
  verification, not code: about 18 device checks are open, and no stranger
  has used the product.

## The direction under review, in full

> Read os-code/PROGRESS.md and os-code/DECISIONS.md first, then the Zed
> proposal, research, and advisory memos (zed-proposal.md, zed-research.md,
> zed-advisory-memos.md). Those set the findings. This prompt sets the
> direction, and where they conflict, this prompt wins.
>
> **The direction (founder-anchored, 2026-09-25).** OpenShore v1 is one
> product for one person: "Your models, your keys, your machine, everywhere
> you go, and no one, including us, is watching."
>
> - Local coding is the principle. The phone and other devices are ways into
>   the same local setup, not a lesser mobile mode. The desktop does the
>   thinking; copy must never imply the phone runs the big model.
> - Private by construction is the moat. Every privacy claim must be literally
>   and provably true. Honest and narrow beats sweeping and slightly false.
> - Cloud is the escape hatch, on the person's own key, never the default.
> - Pricing: free forever for local chat; Personal is $50 a year for the full
>   coding agent and pairing. No team or enterprise tiers in v1. That is v2.
>   Hide team code behind a flag; do not delete it (org vault, admin, the
>   ethics floor companies can tighten all stay intact for v2 and for a
>   buyer).
> - The founder is a team of one. Support load is the enemy. The target is
>   roughly 15,000 people who succeed on their own.
>
> The test for every decision: does this help a stranger succeed alone, on the
> first try? If not, it waits.
>
> **Build order. Stop and report at the end of each phase.**
>
> Phase 0, release blockers. (1) Project trust. A folder's os-code.config.json
> can only tighten settings, never loosen them, until the person explicitly
> trusts that folder. Trust lives on the machine, never in the repo. Covers:
> verify/shell commands, cloud spend, API keys sent to other hosts, "local"
> providers (judge local by address, not by the config's label), and "always
> allow" grants (move them to per-machine storage). One failing-then-passing
> test per attack vector named in the proposal. (2) Context window. Send
> num_ctx to Ollama so the served context matches what the engine plans for.
> Test it.
>
> Phase 1, first-run success. (3) Undo. A checkpoint before every task. "Undo
> these changes" with Redo on every task, plus per-file undo. One honest
> sentence about what undo can't reverse (for example, "Files are back. The
> npm install it ran stays."). (4) Zero-setup verify. Detect the project's own
> check and show the result as a pass/fail pill a non-developer can read. (5)
> First run and pairing. Desktop install, loading a model, and pairing a phone
> must be fully self-serve, with plain-language recovery for every failure
> state (no model, not enough memory, pairing timeout, Tailscale missing).
> Every place a stranger could get stuck is a future support ticket; treat it
> as a bug.
>
> Phase 2, launch surface. (6) Focus. Behind a flag, hide every surface not
> core to "local coding, private, from any of your devices." Propose the exact
> hide list before hiding anything (candidates: Crew/routines, Launch, Vault,
> Stack Health, Terminal Room, Admin, team features). Don't delete code. (7)
> Honest copy, everywhere (site, app, App Store listing). Fix every claim the
> proposal marked false today, including "edits with diffs you approve," "your
> keys never leave your devices," Harbor Light, and the Marketplace pillar.
> Change every price to the v1 plan and remove the team tiers from the site.
> (8) Privacy you can verify. Audit every outbound network call, including
> default web search. Add an in-app "What leaves this device" screen that
> lists each one plainly, and a test that fails on any unlisted egress. "No
> phone-home" ships only if it's literally true.
>
> **Not in v1 (don't start these).** Editor features, the Agent Client
> Protocol, sandboxing, MCP, new model integrations, team/enterprise features,
> and anything the hide list covers.
>
> **Decisions to surface, not make.** Flag these in PROGRESS for the founder
> with a recommendation for each: License: open core (public engine for stars
> and privacy proof, paid app for convenience) vs. closed. Free trial shape for
> the coding agent (trial period or a first project). Founding-user offer, if
> launching free first (for example, first year free, then a discount). Web
> checkout alongside the App Store for desktop users.
>
> **Working rules.** Small commits, tests with each change, one DECISIONS line
> per judgment call. Never mark anything device-verified that hasn't been run
> on a device. Add each phase's checks to the device harness order. Update
> PROGRESS at each phase end with what shipped and what remains.
>
> **Definition of done for v1.** One honest, unedited 90-second recording: a
> stranger's setup, a free local model on a normal computer fixes a failing
> test from the phone, the pill turns green, and undo puts it back. If that
> can't be recorded truthfully, v1 isn't done.
