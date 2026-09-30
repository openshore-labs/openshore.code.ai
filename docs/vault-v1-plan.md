# Vault v1: review and ship plan (2026-09-26)

Status: approved by the founder on 2026-09-27, every recommendation accepted
(D1 to D15 below, recorded in `os-code/DECISIONS.md`), with one change: the
iPhone opening an existing Obsidian vault in place moves into v1 (item 2.10).
M0 to M7 are built (each milestone's shipped notes below; the held branches
and founder gates are in `os-code/PROGRESS.md`), and M8, the ship gate, is
open. The founder asked for a code review
of Vault and a plan to get it ready to ship v1: fully functional, a key feature
for moving between models and for giving them the right context, Obsidian as
the baseline, great out of the box and fully customizable. Every verified
finding behind this plan, with its evidence and proposed fix, is in
`docs/vault-v1-review-findings.md`; the ids in brackets below point there.

## The short answer

Vault is a well-shaped notebook sitting on a good storage seam, and it is not
yet the feature the founder described. Four things stand between it and v1.

1. **It can lose words.** A stale offline draft replays over the save that
   just succeeded [data-1]. Creating a note can blank one that exists but is
   missing from the cached list [data-2]. The open editor overwrites edits the
   agent, Obsidian, or another device made, because no provider checks a
   version before writing [data-3]. The team vault's conflict copy is defeated
   by its own list refresh [orgvault-1], and a Google Drive conflict copy is
   undone by the next autosave [obs-1].
2. **It is three vaults, not one.** The app's personal vault defaults to a
   sealed key-value store on every device, the coding agent and Crew routines
   write `~/OSCode/Vault` on the desktop, and the team vault lives in Supabase.
   On a desktop the person can move the app's vault to that folder by hand; on
   a phone nothing reaches it [keyask-2] [engine-1].
3. **Almost no model can read it.** Only a desktop engine session can, by
   calling `vaultRead` or `vaultList`, and the system prompt never mentions
   them. Small and tiny seats, the class the reference box runs, never see the
   vault tools at all. Stack chats, cloud chats, BYOM, pocket models, and the
   desktop's free chat carry no vault content [keyask-1] [engine-4]
   [engine-5]. A model switch hands over the raw transcript and nothing else
   [keyask-4].
4. **Obsidian parity stops at the link loop, and the copy overclaims.** No
   search in the UI (it is built and tested but never wired), no rename or
   move, no trash, frontmatter renders as a big heading, and no tags, embeds,
   images, daily notes, or templates [ui-10] [obs-7] [ui-12] [ui-7]. "Point
   Obsidian at the same files and it just opens" is true only for the desktop
   "This folder" provider; desktop Export writes into IndexedDB and reports
   success [obs-3] [obs-11].

The plan: a patch release (M0, about two engineer-weeks) that stops every
known silent loss and every false claim; then one vault on the desktop that
holds under concurrent writers (M1, M2); then the context spine that makes
Vault the portable memory every seat reads and every switch carries (M3 to
M5); then Obsidian's day-one features and a real settings surface (M6, M7);
then the ship gate (M8). About 28 engineer-weeks for one person, roughly half
that on the calendar with two tracks.

## How the review was done

- Eight reviewers read the code in parallel, one dimension each: the app data
  layer and storage seam, the Vault screen and renderer, the engine tools and
  permissions, the team vault, Vault as model context, Obsidian parity,
  defaults and customization, and a tests, docs, and claims audit.
- A second agent per dimension tried to refute each finding against the code.
  168 findings survived: 135 confirmed, 19 confirmed in part (the verifier
  note says which part), and 14 found by the verifiers. None was refuted.
  Several defects were proved with throwaway tests that were then deleted.
- Because zero refutations is unusual, six of the load-bearing claims were
  checked again by hand before this plan was written: the stash replay
  (`app/src/state/store.ts:3036-3053`, `6095-6126`), the team base revision
  (`app/src/lib/gitos/orgVault.ts:102-142`), the lean tool cut
  (`os-code/src/core/agent/loop.ts:139-153`, `1475-1485`; the vault tools are
  not in the priority list, and small seats see 10 tools), the Local provider
  being sealed key-value blobs (`app/src/lib/gitos/local.ts`), desktop Export
  passing its web guard on Electron and writing through Capacitor's web
  Filesystem (`app/src/lib/vaultExport.ts:31-57`,
  `app/src/lib/platform.ts:12-18`), and the Memory switch being read only by
  Settings (`app/src/lib/currents.ts:59`). All six hold.
- The existing Vault tests pass: 85 in the app across 7 files and 34 in the
  engine across 2. They cover pure helpers and mocked providers, which is why
  none of the loss paths above was caught.
- Obsidian's help site was blocked by the sandbox's egress proxy, so Obsidian
  behavior comes from reviewer knowledge plus search snippets. M8 closes that
  with a real Obsidian fixture vault.

Sizes used below: S is under a day, M is one to three days, L is about a week,
XL is more than a week.

## What the review found

### Solid today

- A path- and bytes-shaped storage seam with five providers behind it, and a
  path jail on every side: the app normalizer, the iOS plugin, the Electron
  IPC, and export.
- Offline drafts are stashed and replayed instead of dropped (the replay order
  is the bug, not the idea). Evicted iCloud notes are never opened as empty
  editable notes. Pending edits flush on note switch, background, and unmount.
- The desktop "This folder" provider is true Obsidian compatibility: plain
  `.md` files in `~/OSCode/Vault`, dotfolders skipped, shared with the agent.
- The team vault has the right shape: reads scoped by RLS to active members
  (a live Postgres repro returned 0 rows cross-org), writes only through two
  SECURITY DEFINER RPCs, and a server-side revision compare.
- The wikilink loop: `[[target]]`, `[[target|alias]]`, `#heading` and `^block`
  tolerance, backlinks with an excerpt around the link that actually resolves,
  `[[` autocomplete, dashed links that create a note on tap.
- The engine's agent writes are never silent: `vaultWrite` is always-ask, and
  the permission engine honors that before any auto-allow path.
- The markdown renderer neutralizes raw HTML and `javascript:` links.

### The findings that matter most

The same defect often surfaced in several dimensions; each row lists every id
that names it.

| Problem                                                                                                                               | Ids                                                   | Severity |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| A stale offline draft replays over a newer successful save, every provider                                                            | data-1, ui-3, orgvault-2                              | critical |
| Team vault: `list()` and `read()` advance the base revision, so a stale editor overwrites a teammate with no conflict copy            | orgvault-1, data-6, ui-M1, truth-1                    | critical |
| No seat except a desktop engine session can read or write the vault                                                                   | keyask-1                                              | critical |
| No compare-and-swap in the seam; the open note is never re-read, so a stale draft overwrites the agent, Obsidian, or another device   | data-3, ui-1, obs-5, truth-15                         | high     |
| Create and new-link taps blank a note that exists but is missing from the list                                                        | data-2, orgvault-7                                    | high     |
| Google Drive: the next autosave after a conflict overwrites the other device; the index never refreshes in a session                  | data-4, data-5, obs-1, ui-2, truth-2, missed-1/drive  | high     |
| Team delete takes no base revision, blanks the body, and has no restore; same-minute conflict copies collapse onto one path           | orgvault-4, orgvault-3                                | high     |
| The person's vault and the agent's vault are different stores by default                                                              | keyask-2, engine-1, custom-1, truth-4                 | high     |
| Vault tools never reach small or tiny seats, yet their prompt tells them to use `projectMemoryWrite`                                  | engine-4, keyask-6, custom-4                          | high     |
| Nothing puts vault content into any model's context; the per-class budgets in `profile.ts` are dead code                              | engine-5, keyask-7, truth-5                           | high     |
| A model switch carries the raw transcript only; into the desktop agent it drops the thread                                            | keyask-4                                              | high     |
| The engine never sends Ollama's `num_ctx`, so every budget is sized against a window the model is not running                         | missed-1/ctx                                          | high     |
| Shared-hub members' agents read (and can write) the machine owner's vault, including other members' Crew notes                        | engine-2, custom-10                                   | high     |
| A cloned repo's `os-code.config.json` can move `vault.dir`, and `~` is not expanded                                                   | engine-3, custom-5, keyask-9                          | high     |
| Copy promises Obsidian compat and agent read-back that the default setup does not deliver; the Wayfinding Memory switch gates nothing | obs-3, data-9, engine-14, keyask-3, custom-3, data-m1 | high     |
| Desktop Export writes to IndexedDB and says it wrote files; iOS Export deletes the folder, `.obsidian/` included, every time          | data-10, obs-11, ui-14, custom-m1                     | high     |
| Backlinks re-resolve every link on every note open: 0.7 s at 1,000 notes, 5.6 s at 3,000                                              | data-11, ui-17, truth-8                               | high     |
| No search UI, no rename or move, no folder operations, permanent delete with no undo                                                  | ui-10, ui-11, ui-12, obs-6, obs-7                     | high     |
| Frontmatter renders as a rule plus an H2; wikilinks inside code blocks are rewritten                                                  | ui-7, obs-8, ui-6, obs-18                             | medium   |
| Agent-written names with `#`, `?`, `:`, `[` cannot be opened or deleted in the app (the app and engine normalize differently)         | data-12, obs-2, ui-M2, engine-9, truth-7              | medium   |
| A malformed `vault:` link crashes the whole app                                                                                       | ui-9                                                  | medium   |
| iCloud lists `.obsidian/`, images, and JSON as editable notes; a move can overwrite another vault's `.obsidian/`                      | obs-9, data-15                                        | medium   |
| No test proves vault content reaches a model; the team LWW rule is never tested against Postgres, and the SQL tests are not in CI     | keyask-14, orgvault-13, truth-18                      | medium   |

### Which seat can read the vault today

| Seat                                              | Reads the vault                                                                              | Writes the vault                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Desktop engine session, mid or large seat         | By tool only (`vaultRead`, `vaultList`), from `~/OSCode/Vault`; the prompt never mentions it | `vaultWrite`, always-ask                                                                       |
| Desktop engine session, small or tiny seat        | No: the tool cap drops the vault tools                                                       | No                                                                                             |
| Phone-driven desktop session                      | Same as the desktop session, but the phone cannot open the notes it names                    | Same                                                                                           |
| Stack chat, cloud Claude, OpenAI-compatible, BYOM | No                                                                                           | No                                                                                             |
| Pocket models (Harbor, Harbor Lite)               | No                                                                                           | No                                                                                             |
| Desktop free chat (`/chat`)                       | No                                                                                           | No                                                                                             |
| Crew routine                                      | By tool, as a desktop session                                                                | Its dated result note, written by the scheduler; `vaultWrite` stalls with no one to approve it |
| Any seat, team vault                              | No                                                                                           | No                                                                                             |

### Obsidian parity today

| Capability                                                                    | Status                                                                                | Ids             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------- |
| Wikilinks, aliases, heading and block tolerance                               | Works; some resolution rules differ from Obsidian                                     | data-13, obs-m1 |
| Backlinks (linked mentions)                                                   | Works; slow on a large vault                                                          | data-11         |
| `[[` autocomplete                                                             | Pointer only; can corrupt a link being edited                                         | ui-15, obs-17   |
| Search, quick switcher                                                        | Missing (search is built, not wired)                                                  | ui-10, obs-6    |
| Rename or move with link updates; folder create, rename, delete               | Missing                                                                               | obs-7, ui-11    |
| Properties (frontmatter), tags, aliases                                       | Frontmatter renders wrong; tags and aliases unknown                                   | ui-7, obs-8     |
| Embeds, images, attachments                                                   | Missing; a link to a file creates a junk `.md`                                        | obs-12          |
| Callouts, highlights, comments, tickable tasks                                | Missing                                                                               | ui-8            |
| Daily notes, templates, outline, outgoing links, unlinked mentions, bookmarks | Missing                                                                               | obs-16          |
| Trash                                                                         | Missing; delete is permanent                                                          | ui-12           |
| `.obsidian` config respected                                                  | Folder provider skips it; iCloud lists it; settings never read                        | obs-9, obs-14   |
| Real files Obsidian opens                                                     | Desktop "This folder", and iCloud from a Mac; not the default, not Obsidian on iPhone | obs-3, obs-10   |
| Graph, Canvas, Bases                                                          | Missing (later)                                                                       | obs-19          |

### The original brief against what shipped

Met: the organization backend, a storage location chosen on the phone, native
browsing, backlinks, the name. Partly met: the personal vault as the agent's
write target, the agent using the vault as context, the organization
permission model, true Obsidian compatibility, and sealing for sensitive
notes. Not met: the team tier's "no member's work is ever silently lost"
[truth-23] [orgvault-19].

## Vault v1, defined

The paragraph to hold the team to:

> Vault v1 is one plain-markdown vault that the person, every model seat,
> Crew routines, and Obsidian share, and it is the context that survives a
> model switch. On the desktop it is `~/OSCode/Vault` or any folder the person
> picks, an existing Obsidian vault included; a paired phone reads and writes
> that same vault while the computer is on, and says so; and an iPhone can
> instead open the person's own Obsidian vault in place. Before each turn the
> harness gives the seated model a small, cited pack of notes sized to that
> seat's real context window, and a transcript card names the notes it used;
> on a switch the next model gets a handoff sized to its own window. Nothing
> is lost or overwritten silently on any provider a person can pick. An
> Obsidian user finds properties, tags, aliases, code-safe links, search,
> rename with link updates, trash, today's note, and images working. Defaults
> come from the vault's own `.obsidian` settings, and one settings sheet
> changes the rest. Vault stays free, agent writes stay always-ask, and no
> copy says "faster" or "smarter" until `osc eval --deep` shows the number on
> the reference box.

Ship gates, each pinned by a test or a record:

1. **No silent loss.** No known silent-loss path on any provider a person can
   select. Pinned by the must-fix map (8.3), the provider contract test, and
   pgTAP running in CI.
2. **Honest copy.** No copy claims what the default setup does not do. Pinned
   by `app/test/vaultCopy.test.ts` over every platform and provider pair.
3. **Measured context.** Every seat class that gets the pack by default has a
   with-and-without `osc eval --deep` number on the reference box; a class
   without a number does not get it by default (tenet 2). Pinned by
   `os-code/test/vaultContext.test.ts`, `app/test/vaultContext.test.ts`, and
   an eval line in PROGRESS.
4. **Device checklist done.** The checklist in PROGRESS "What remains" (8.1)
   is ticked.

## Ground rules for every item

- **Files are the source of truth.** The index is a rebuildable cache kept
  outside the vault (the sealed store on a device, the engine's state folder
  on a computer, keyed per vault root). It never syncs, so it cannot conflict.
- **Who may write.** Agent writes stay always-ask. The only carve-outs are the
  existing ones: project memory (in the repo) and the routine's result note.
  The person's own writes from any surface need no approval. The harness
  reading notes into context is a read, and it always shows as a card.
- **The five tenets.** The context layer appears as cards in the transcript
  and rows in Vault and Wayfinding, never a new room, and the codename stays
  out of copy. Nothing is claimed before eval. The harness does the retrieval
  so a lean seat does not have to remember to. Nothing places a seat for the
  person. One pure core in `os-code/src/harness/`, shared through
  `os-code/protocol`; the app and the engine differ only by tool slice.
- **Every feature ships behind config at its own milestone** (machine config
  first, with UI in M7), so each can be measured with and without.
- **Motion and honesty.** New sheets use `components/Sheet.tsx`, every
  tappable has `press-fb`, motion uses the tokens, and anything that rises
  above the keyboard moves by transform. Teal cards when a local seat read the
  notes, amber when a cloud seat did. `polish-standards.test.ts`,
  `motion-tokens.test.ts`, and both `em-dash-policy.test.ts` files stay green
  at every milestone.

## Milestones

Three tracks: storage safety (M0, M1, M2), the context spine (M3, M4, M5), and
the Obsidian surface with customization (M6, M7). The critical path is M0, M1,
M3, M4, M5, M8. M2 runs beside M3 and M4. M6 needs M3 for the core, M2 for
compare-and-swap writes and team revisions, and M5 for images from "Your
computer" (6.2, 6.3, 6.5, and 6.6 say which).

### M0. Stop silent loss and false claims (a patch release, all S)

Goes to current users as it is; the only visible change is honest states and
copy.

**0.1 A stale draft never replays over a newer save.** Each stash entry
records the provider, the resource, and the provider's `updatedAt` the text
was typed against (never a device clock). A successful write clears that
path's entry before any replay. When a stashed entry is older than what the
provider now holds, it becomes keep-both (a conflict copy, or the resolve
sheet once 1.1 lands), never a silent drop, and it never replays onto a
different provider. Closes [data-1] [ui-3] [orgvault-2] [truth-14]. Where:
`app/src/state/store.ts:3014-3053, 6095-6126`. Test: `app/test/vaultStore.test.ts`,
"a newer save is not clobbered by its own stale stash", "a stale stash
becomes a conflict copy", "a stash never replays onto another provider".

**0.2 Creating a note never truncates one.** `vaultCreate` asks the provider
(`stat()`) before writing and opens the note if it exists; an iCloud
`downloading` result means wait, never new. Closes [data-2] [orgvault-7]
(client half). Where: `store.ts:6043-6089`, `app/src/lib/gitos/icloud.ts:36-38`.
Test: `vaultStore.test.ts`, "create over an unlisted existing note opens it,
bytes unchanged".

**0.3 Open, save, and delete by the exact listed path.** Only a name the
person types for a new note is normalized. Closes [data-12] [ui-M2] [obs-2].
Where: `store.ts:6004`. Test: `vaultStore.test.ts` opens and deletes
agent-written `Decision: auth?.md` and `C# nightly.md`.

**0.4 Failures are loud, classified, and never lose text.** A network failure
stashes and retries. A permanent refusal (P0001 or a 4xx: the 1 MB cap, a bad
path, not a member) shows the server's own message, stays out of the retry
loop, and keeps the text in a durable "Not saved" holding place with Copy and
Discard, so leaving the note or backgrounding the app cannot lose it. The
client checks the 1 MB cap before sending. The stash write gets its own try
and a persistent `vaultError`. `vaultReadAll` catches per file and returns
`{notes, failed}`. Backlinks reset on a path change and get an error state.
"Note deleted." shows only after the delete resolves. Closes [data-7]
[orgvault-9] [data-16] [data-m2] [orgvault-m1] [orgvault-m2] (copy half).
Where: `store.ts:6117-6187`, `app/src/screens/VaultScreen.tsx:179-190, 520`.
Test: `vaultStore.test.ts`, a throwing stash still sets `vaultError`; a 2 MB
body is held, not stashed for retry; one unreadable file still yields
backlinks for the rest; a failed delete never shows the success toast.

**0.5 Moving the vault never drops notes.** `vaultMoveTo` returns `{moved,
skipped}`, refuses to repoint while any read came back empty, and checks the
counts on the target before repointing. Closes [data-14] [truth-14]. Where:
`store.ts:6213-6259`. Test: `vaultStore.test.ts`, one evicted source note
aborts the move and the resource still points at the source.

**0.6 Only notes are notes.** One `isNote` filter at the seam (`*.md`, dot
segments skipped, so `.obsidian/` and `.trash/` never list); the Swift
`list()` prunes dot folders and non-notes but keeps mapping the
`.Name.md.icloud` placeholders to their real names first (never
`.skipsHiddenFiles`, which would hide a note still in iCloud and bring back a
create over it); `.md` is never appended to a known non-markdown
extension; `vaultMoveTo` copies only filtered entries. Closes [obs-9]
[data-15] (listing half) [obs-12] (junk `.pdf.md` files). Where:
`app/src/lib/gitos/providers.ts`, `icloud.ts:27`, `OscodeIcloudPlugin.swift:78`.
Test: a filter table in `app/test/vault.test.ts`; a new
`app/test/icloudProvider.test.ts` with a mocked plugin
(`.obsidian/workspace.json` is not listed); a move skips `.obsidian/` in
`vaultStore.test.ts`.

**0.7 The save target is fixed when the save is scheduled.** `scheduleSave`
captures `{providerId, resourceId}`; `setVaultScope` and `forgetSession` flush
or cancel the pending save; `forgetSession` drops team stash entries and team
body-cache keys. Closes [ui-24] [orgvault-16] [orgvault-15]. Where:
`VaultScreen.tsx:123-127, 199-221`, `store.ts:2899`. Test: `vaultStore.test.ts`,
a scope flip mid-debounce never writes team text into the personal vault;
sign-out leaves no team stash entries.

**0.8 Local index writes are serialized.** One promise chain per resource,
and a key-prefix scan rebuilds index entries for orphaned notes. Closes
[data-8] [truth-13]. Where: `app/src/lib/gitos/local.ts:45-55`. Test: a new
`app/test/localProvider.test.ts`, 20 concurrent creates all list, an orphan
is rebuilt.

**0.9 The team base revision comes only from `read()` and `write()`.** `list()`
and `stat()` stop setting it; 2.1 later moves the base into the editor.
Closes [orgvault-1] [data-6] [ui-M1] [truth-1]. Where:
`app/src/lib/gitos/orgVault.ts:102, 114`. Test: `app/test/orgVault.test.ts`,
"read rev 3, list rev 4, write sends 3".

**0.10 A bad link cannot blank the app.** The `vault:` link decode is wrapped,
and an error boundary goes around the room and around `VaultMarkdown`. Closes
[ui-9]. Where: `app/src/components/VaultMarkdown.tsx:38`, `App.tsx`. Test: a
new `app/test/vaultMarkdown.test.tsx` renders `[x](vault:%E0%A4%A)` without
throwing.

**0.11 Export reports only what happened, and the escape hatch stays.** On the
desktop, Export is replaced by a row that moves the vault to the existing
"This folder" provider (plain files Obsidian opens), so the true-compat
escape hatch the CTO required (DECISIONS, gitOS and Vault rulings) never goes
away. On iOS, export writes against a manifest, never deletes unknown files
or `.obsidian/`, and reports "N of M". Closes [data-10] [obs-11] [custom-m1]
[truth-11] [ui-14]. Where: `app/src/lib/vaultExport.ts:31-57`,
`VaultScreen.tsx:946-968`. Test: `app/test/vaultExport.test.ts`, the desktop
never reports an export count; an unknown file survives an iOS re-export.

**0.12 `vault.dir` is machine config only.** One `loadVaultDir()` expands a
leading `~` and requires an absolute path; a project file's `vault.*` is
dropped with the same warning `daemon.*` gets (DAE-9); the helper is used in
`registry.ts:145`, the scheduler's `defaultVaultRoot`, and
`app/electron/main.ts:920-922`; `osc doctor` prints the resolved path. A
security fix: today a cloned repo can widen reads that happen without a
prompt. Closes [engine-3] [keyask-9] [custom-5] [truth-16]. Where:
`os-code/src/config/load.ts:84`, `schema.ts:213`. Test: next to the DAE-9
case, a project `vault.dir` is ignored with a warning and `~/Obsidian`
resolves under home.

**0.13 Interim isolation on a shared hub.** Member sessions get no vault tools
until 5.2 gives each member a root. Closes [engine-2] [custom-10] (interim).
Where: `os-code/src/daemon/serve.ts:956`, `os-code/src/core/agent/bootstrap.ts:192`,
`registry.ts`. Test: `os-code/test/daemon.test.ts`, a member's tool list has
no `vault*` tool and the owner's is unchanged.

**0.14 Engine vault tools are bounded.** `vaultList` is capped and paged, with
a count and a "narrow with folder" line, and its walk goes async with an
entry ceiling; `vaultRead` checks size first and guards binary files and
folders named like notes. Closes [engine-7] [keyask-10] [custom-8] [truth-6]
(cap half of each). Where: `os-code/src/core/tools/vault.ts:117-170`. Test:
`os-code/test/vaultTools.test.ts`, 2,500 notes return under the cap; a folder
named `x.md` gets a clear message.

**0.15 Lean seats are never told to use a tool they cannot see.** The
`projectMemoryWrite` instructions are sent only when that tool survives
`limitToolSpecs`. (Giving lean seats a way to keep project memory current is
4.7.) Closes [engine-4] [custom-4] [keyask-6] (prompt half). Where:
`loop.ts:139-153, 508-515`. Test: `os-code/test/harnessLoopProfile.test.ts`,
"no prompt names a tool the seat was not given".

**0.16 Phone-driven sessions send the project name.** `daemonCreateSession`
carries the project name and the project instructions, so project memory no
longer splits into two folders. Closes [keyask-5]. Where:
`app/src/drivers/remoteDriver.ts:224`, `store.ts:2585`, `stackDriver.ts:1048`.
Test: a phone-created and a desktop-created session resolve the same memory
folder.

**0.17 Crew notes are well formed.** The heading reads "2026-09-26 at 06:00",
and two runs in the same minute get distinct files. Closes [custom-14]
[truth-20] [engine-11] (title half). Where: `os-code/src/routines/scheduler.ts:595`.
Test: `os-code/test/routines.test.ts` asserts the heading and two files.

**0.18 Google Drive held back (D1).** Drive stops being selectable for a new
vault (the Arriving pill, per the Creative Studio treatment). A vault that
already lives on Drive goes read-only, with a card that moves it off through
the fixed `vaultMoveTo`, so no selected provider keeps a live loss path.
Closes [data-4] [data-5] [truth-2] [obs-1] [ui-2] [missed-1/drive] [data-m3]
(for v1). Where: `app/src/lib/gitos/index.ts:40`, `store.ts`. Test:
`app/test/gdrive.test.ts`, Drive cannot be picked; an existing Drive vault
lists, refuses a write, and moves.

**0.19 Copy says only what is true today.** One map from platform and
provider to each copy line, used by onboarding, the storage sheet,
`guideCards.ts`, and the welcome note. Agent lines show only for "This
folder" on the desktop; the phone says "Your agent uses the vault on your
computer"; each provider gets its own storage line; the team vault says it is
not an Obsidian folder; the Memory line says project notes live in the
project's repo. Closes [engine-14] [custom-2] [ui-4] [ui-22] [obs-3] [obs-10]
[truth-12] [keyask-3] [data-m1] [truth-10]. Where: `VaultScreen.tsx:728-790,
852-860`, `app/src/lib/currents.ts:39-42`, `app/src/lib/guideCards.ts`. Test:
a new `app/test/vaultCopy.test.ts` renders every platform and provider pair
and fails on a false agent or Obsidian claim.

**0.20 Write the truth down.** The known gaps go into PROGRESS "What
remains", including that the team vault's "never lost" does not hold today;
the four stale "Projects/&lt;project>/ in the vault" comments are corrected; the
claim in `os-code/docs/parked-ideas.md:341` is corrected. Closes [orgvault-19]
[truth-22] [engine-13] [custom-17] [missed-2]. Test: `progressShape.test.ts`
stays green.

### M1. One vault on the desktop, and it holds

After this release a desktop has one folder that the app, the agent, routines,
and Obsidian share, and a stale editor can no longer clobber it. **1.1 and 1.3
ship together, never 1.3 alone**: flipping the default without
compare-and-swap would make [data-3] an everyday event.

**1.1 Compare-and-swap in the seam, built first on the folder (L).** `write`
gains `opts?: {ifMatch?, ifAbsent?}` and returns `{ok, file}` or `{conflict,
theirs}`, never overwriting on a mismatch. The folder provider checks mtime
and size in `osc:vaultWrite` and writes to a temp file renamed over the
target. A debounced `fs.watch` pushes changes over the bridge, and the store
re-checks the open note on focus. A clean draft reloads in place; a dirty one
pauses autosave and opens a resolve sheet on `Sheet.tsx` (Keep mine, Use
theirs, Keep both). Other providers return the new shape now and gain the
check in M2. Files carry an opaque `version` (compared for equality only;
sizes documented as bytes), the folder client is built as one shared
`folderClient.ts` over a transport so the iPhone folder (2.10a) reuses it, and
the temp-and-rename carries the note's creation date, which Obsidian shows, on macOS and Windows (on Linux the file system cannot keep it, and no copy claims it; CTO F2). The resolve sheet also takes a move's forked pairs (`VaultMoveResult.forked`), so the person can pick which copy keeps the name.
Closes [data-3] [ui-1] [obs-5] [truth-15] [data-20]. Where:
`app/src/lib/gitos/providers.ts:70-73`, `deviceFolder.ts`,
`app/electron/main.ts:916-973`, `store.ts` (vaultSave, vaultRefresh),
`VaultScreen.tsx`. Test: a new `app/test/providerContract.test.ts` that every
provider must pass (a stale `ifMatch` conflicts and leaves the file alone;
`ifAbsent` on an existing file conflicts), with the folder provider enrolled
now; `vaultStore.test.ts`, an external change reloads a clean draft and
pauses a dirty one.

**1.2 The agent's write lands exactly as approved (S).** The preview's
content hash is checked again at execute time; a changed note refuses with
"the note changed since you approved; read it again". The engine write is
atomic. Closes [engine-8]. Where: `os-code/src/core/tools/vault.ts:87-114`.
Test: `vaultTools.test.ts`, an edit between preview and execute is refused
and the file is untouched.

**1.3 The desktop defaults to the folder, with a one-time move (M).** When the
folder is available, a new personal vault is created on it. An existing Local
vault moves once through the fixed `vaultMoveTo`, behind a one-tap card (D7),
and the Local bytes are kept as a safety copy. Closes [custom-1] [keyask-2]
[data-9] [ui-4] [obs-3] [truth-4] [engine-1] (desktop half). Where:
`store.ts:5964-5985, 6213`. Test: `vaultStore.test.ts`, a fresh desktop lands
on the folder; three Local notes migrate with matching counts; the source
stays.

**1.4 Pick the folder, an existing Obsidian vault included (M).** A desktop
"Use a folder..." row opens the system folder picker; a new IPC writes
`vault.dir` through `loadVaultDir` and the global config. The sheet shows the
resolved path with Reveal folder and Open in Obsidian. On the phone the
desktop-only row disappears instead of reading "Arriving" (it returns as
"Your computer" in 5.2). Closes [custom-6] [ui-22] [obs-14] (location half).
Where: `VaultScreen.tsx:852-972`, `app/electron/main.ts`,
`os-code/src/config/load.ts`. Test: `app/test/deviceFolder.test.ts`, a picked
temp folder lists its notes and hides `.obsidian/`; a phone case in
`vaultCopy.test.ts`.

**1.5 The Memory switch does something (M).** `BootstrapOptions.memory`,
following the humanizer precedent: the app can only turn memory off, and a
project config `memory.enabled: false` always wins. Off removes
`projectMemoryPrompt` and `projectMemoryWrite` today, and the pack and the
handoff once they land. Threaded through the store, the daemon, and the
Electron bridge. The Skills and Browser switches are dead too; they are
outside Vault and go to PROGRESS as their own items. Closes [data-m1]
[engine-m1] [keyask-3] [custom-3] [truth-10]. Where: `app/src/lib/currents.ts:39-42`,
`bootstrap.ts`, `loop.ts`, `registry.ts`, `os-code/src/config/schema.ts`.
Test: a new `os-code/test/memorySwitch.test.ts` (off removes the prompt block
and the tool); `app/test/currents.test.ts`, the memory switch has a runtime
consumer.

**1.6 Permissions mean what they say (S).** Deny rules are checked before the
always-ask short-circuit; `vaultList` filters denied subtrees; approval
requests carry `alwaysAsk` so `ApprovalSheet` hides the session and project
allow buttons that never take effect; headless routine registries drop
`vaultWrite`, since the scheduler's note already records the run. Closes
[custom-7] [engine-10] [custom-15]. Where: `os-code/src/core/permissions/index.ts:151-157`,
`app/src/components/ApprovalSheet.tsx:124`, `registry.ts`. Test:
`vaultTools.test.ts`, a deny on `vaultWrite` wins; `routines.test.ts`, the
headless registry has no `vaultWrite`.

### M2. Safe with more than one writer (beside M3 and M4)

After this release, phone, iCloud, and team edits are never silently lost, and
every conflict is shown.

**2.1 Compare-and-swap on Local, iCloud, and the team vault (L).** Local
compares against its index's `updatedAt`; iCloud compares the modification
date under coordination, and `remove()` rejects on failure; the team vault
takes its base revision from the open note and sends it as `ifMatch`, and the
module-level map goes away. Stash entries carry the base the text was typed
against and the user id. After a write, the file list is patched from the
result instead of re-listed. Closes [data-3] [orgvault-1] [truth-1] [data-15]
[orgvault-11]. Where: `local.ts`, `icloud.ts`, `OscodeIcloudPlugin.swift`,
`orgVault.ts`, `store.ts:3020-3053, 6095`. Test: `providerContract.test.ts`
enrolls Local, the mocked iCloud plugin, and the fake team vault;
`orgVault.test.ts`, a replay after an interleaved list is a conflict, not an
overwrite.

**2.2 Conflicts are visible and saving has a status (M).** Every provider uses
the 1.1 resolve sheet; conflict copies wear a badge in the tree; the team
RPC's `conflict_path` drives a toast; a save chip shows Saved, Saving, or
"Offline, kept on this device" with a pending count and Retry. Closes [ui-19]
[orgvault-7] [truth-3] [ui-16]. Where: `VaultScreen.tsx`, `app/src/lib/vault.ts`,
`orgVault.ts`. Test: `vaultStore.test.ts`, a conflict result stops autosave
and sets the conflict state; every new scrim has its `closing` binding.

**2.3 One team migration (M).** An append-only `org_vault_revisions` table
(which also makes deleted and overwritten bodies restorable, with a purge
window for tombstones); unique conflict names that still pass
`org_vault_path_ok`; an advisory lock on first create; `org_vault_delete`
takes a base revision and refuses a stale delete; `org_vault_put` returns
`conflict_path`; uniqueness on `(org_id, lower(path))`; a paged `list()`.
Closes [orgvault-3] [orgvault-4] [orgvault-7] [orgvault-8] [orgvault-18]
[truth-3]. Where: a new `supabase/migrations/00NN_org_vault_v1.sql`,
`orgVault.ts:95-140`. Test: pgTAP in `supabase/tests/rls.test.sql` (two
writers, three writers in one minute, a stale delete, the first-create race,
the 1 MB cap, a removed member reads 0 rows); `orgVault.test.ts`, 1,001 rows
all list.

**2.4 SQL tests run in CI (M).** A Postgres service job applies the
migrations and runs pg_prove. Closes [orgvault-13] [truth-18]. Where:
`.github/workflows/ci.yml` (today it runs only the functions' Deno tests).
Test: the job goes red on a deliberately broken RPC.

**2.5 The lease is enforced, then relaxed once compare-and-swap exists (M).**
Create, save, delete, and rename refuse with a toast while another device
holds the lease; the UI hides the actions that write; the lease is held only
while an editor is dirty, with an idle expiry and "Take over editing". On a
provider with compare-and-swap the lease becomes an advisory "also open on
X". This revises the CTO's "single-writer lease from day one" ruling, so it is
recorded in DECISIONS (8.2). Closes [ui-13] [truth-17] [data-19]. Where:
`store.ts`, `VaultScreen.tsx:101, 166, 374`. Test: `vaultStore.test.ts`,
create and delete are refused while the lease is held elsewhere.

**2.6 An expired team session keeps the note (S).** The note stays open and
read-only with "Sign in again to save to your team". Closes [orgvault-m2].
Where: `store.ts:3112`. Test: a `vaultStore.test.ts` case.

**2.7 Team live refresh by polling (S).** While the Vault is visible, poll the
open note's revision every 30 seconds; a clean draft reloads, a dirty one
opens the resolve sheet; show "Edited by &lt;name>, 2 min ago". Closes
[orgvault-5] (polling half). Test: `orgVault.test.ts`, a revision bump reloads
a clean draft.

**2.8 Team export on every platform (M).** Team scope exports to its own
folder (`Vault Team/<org>/`) under the 0.11 manifest rule, on iOS through the
Filesystem plugin and on the desktop through a folder-export IPC, so a
desktop team member can open the team vault in Obsidian. Closes
[orgvault-10]. Where: `vaultExport.ts`, `app/electron/main.ts`,
`VaultScreen.tsx:590`. Test: `vaultExport.test.ts`, a team export never
touches the personal export; the desktop IPC writes real files in a temp
folder.

**2.9 iCloud conflict versions (M).** Unresolved `NSFileVersion` versions
feed the resolve sheet and are then marked resolved. No longer "the first cut
if M2 slips": hidden conflict versions in a person's Obsidian iCloud vault
(2.10) would break ship gate 1. Closes [data-15]. Where:
`OscodeIcloudPlugin.swift`, `icloud.ts`. Test: a device checklist line (8.1)
and the Swift test target from 2.10a.

**2.10a The iPhone opens an existing Obsidian vault in place (L, about 2.5
weeks; founder ruling 2026-09-27; needs 0.5, 0.6, 0.19, 1.1, and 2.1; behind
`settings.vaultFolderPicker`, on in TestFlight, on by default once 3.2
lands).** Designed, then checked against iOS behavior and Apple's developer
forums (the check's corrections are folded in).

- **Pick.** A storage sheet row, "Your Obsidian vault" ("Open it where it
  already is, on this iPhone or in iCloud Drive."), opens the iOS folder picker
  in place, not as a copy, from a second plugin class, `OscodeFolderPlugin`, in
  the existing `oscode-icloud` package. No new entitlement.
- **Keeping access.** A plain bookmark of the folder, made while access is
  started and kept natively in Application Support, never in JS (iOS has no
  security-scoped bookmark option; a regular bookmark carries the access).
  Resolved off the main thread on each foreground; the old scope is stopped only
  when the resolved folder changes, so scopes never pile up.
- **States.** ok, stale (re-bookmarked silently), moved (judged by the path the
  person sees, never the app container path, which changes on an update or a
  restore), in Recently Deleted, gone, denied, and unreachable while iCloud is
  signed out. Denied and signed out are decided only after a failed read.
- **What was picked.** Obsidian's iCloud folder (confirmed by the container's
  display name); an Obsidian vault on this iPhone (an app's `Documents/<vault>`
  whose dot config folder holds `workspace-mobile.json`; that folder, `.obsidian`
  or a per-device override, is kept for 3.4); Obsidian's parent folder (the
  person chooses a vault, kept with the vault's file id so a rename in Files is
  followed); a folder inside a vault (the person is asked for the vault
  itself); OpenShore's own folders (refused, pointing to the iCloud Drive row);
  any other folder (neutral copy, no Obsidian claim).
- **Reading and writing** (`CoordinatedTree`, shared with 2.1 and 2.9): a
  bounded queue with a cancel watchdog on every coordinated call; lists use
  metadata already on the device and prune dot folders without hiding iCloud
  placeholders; never coordinates a read of a note that is not current (a
  coordinated read would wait on the download); the jail compares real paths
  of the parent. Versions are opaque tokens (file id, nanosecond modification
  time, bytes). A write with `ifMatch` conflicts when the note is missing,
  evicted, has a newer version waiting in iCloud (iOS 18.4 and later can keep a
  stale local copy), or its token moved; otherwise it writes a temp file that
  carries the note's creation date, swaps it in, and checks the displaced
  file, swapping back on a change. A create checks case- and NFC-insensitively,
  placeholders included. Remove takes `ifMatch`. Writes run inside a
  background task. Only the note the person opens is downloaded.
- **Provider.** `folder`, the 1.1 `folderClient.ts` over an iOS transport. It
  writes no lease file; Obsidian does not honor leases, so compare-and-swap is
  the protection.
- **Moving.** Opening in place and leaving the folder only repoint; nothing is
  copied either way. "Bring my notes" copies OpenShore's notes in with
  `ifAbsent`, and a same-name note lands beside Obsidian's, never over it.
  Caches and stash entries carry the provider and folder, so they never cross.

Closes [obs-10] [obs-3] (iPhone half). Where: `app/plugins/oscode-icloud/ios/Sources/OscodeIcloudPlugin/`
(`CoordinatedTree.swift`, `FolderBookmarks.swift`, `OscodeFolderPlugin.swift`),
`app/src/lib/gitos/` (`folderPlugin.ts`, `iosFolder.ts`, `providers.ts`,
`index.ts`), `store.ts` (vault target, `vaultMoveTo`, new
`vaultChooseFolder`, `vaultUseFolder`, `vaultForgetFolder`), `VaultScreen.tsx`
(the storage sheet). Test: a new `app/test/folderProvider.test.ts` with a
mocked plugin (dot paths, `.canvas`, and images never list; a placeholder
lists as evicted under its real name; `ifMatch` sends the version read
returned; a conflict maps to `{conflict, theirs}`; each state refuses writes;
no lease file; not ready on web or desktop); the folder row in
`providerContract.test.ts` over a fake tree; `vaultStore.test.ts` (opening in
place writes nothing, leaving copies nothing, bring notes keeps a same-name
Obsidian note byte for byte, caches never cross folders); `vaultCopy.test.ts`
("Obsidian opens" only for the two Obsidian locations); a static
`app/test/nativePlugins.test.ts` (each plugin class is the first `@objc(` in
its own file, and `CoordinatedTree.swift` never uses `.skipsHiddenFiles`); a
Swift XCTest target for the `CoordinatedTree` decision table, run with
`xcodebuild` on the Mac that builds the iOS app and recorded in PROGRESS; the
device checklist lines in 8.1.

**2.10b The folder stays current and shows every copy (M; needs 2.10a and
2.9).** A file presenter while the Vault is on screen, removed on background,
turns iCloud's coordinated changes into hints; Obsidian does not coordinate,
so the re-check when OpenShore comes to the front is the real backstop. A
status poll finishes an open that is waiting on a download. Unresolved
`NSFileVersion` conflicts reach the resolve sheet. A "Note 2.md" beside
"Note.md" wears a "Maybe a sync copy" badge with Compare, and nothing is ever
deleted automatically. "Download all 86" asks iCloud for every evicted note
by count (iOS cannot report an evicted note's size). Closes [data-15] (folder
half). Test: `vaultStore.test.ts` (a folder change reloads a clean note and
pauses a dirty one); a `looksLikeSyncCopy` table in `vaultCore.test.ts`
("Chapter 2.md" alone is not flagged); device checklist lines.

**What the founder should know about 2.10.** OpenShore opens the vault where
it lives and keeps no copy, so a vault kept "On My iPhone" goes if Obsidian is
deleted, and the copy says so. Obsidian does not take part in iOS file
coordination, so protection comes from the check at the moment of saving and
the re-check when OpenShore comes to the front, not from live updates. No
Swift runs in CI; the device checklist and a recorded Xcode test run are the
gate. It stays TestFlight-only until the M3 index lands.

### M3. One vault core and one index

The foundation for both the context layer and the Obsidian surface. After
this release, backlinks are fast, links resolve the way Obsidian resolves
them, code blocks stay intact, and properties render.

**3.0 A purity guard (S).** A new `os-code/test/harnessPurity.test.ts` fails on
any Node built-in import reached from `os-code/src/harness/` or
`os-code/src/protocol.ts`. Tenet 5 says the core stays Node-free "by test",
and no test enforced it. `runVerify` moved out to `core/agent/verifyRun.ts`
first, since `harness/verify.ts` imported `node:child_process` (CTO 3.0).
Test: the guard, with a negative self-test.

**3.1 The shared vault core (L).** A new Node-free `os-code/src/harness/vault/`
exported through `os-code/protocol`, which `app/src/lib/vault.ts`, the engine
tools, the scheduler, and the Electron `osc:vault*` IPC all use: note-path
rules (NFC, applied to new names only); a markdown-aware wikilink and embed
tokenizer that skips code; `resolveWikilink(target, paths, sourcePath)` in
Obsidian's order (exact path, source-relative, unique suffix, then basename
with same folder first and shortest path next); relative `.md` links; a
frontmatter reader that never reserializes; nested tags, aliases, headings,
and block ids; `rewriteLinks`; and insertion of the shortest unambiguous
path. Closes [engine-9] [keyask-8] [truth-7] [custom-16] [obs-2] [data-13]
[obs-m1] [ui-6] [obs-18] [ui-23] [obs-13] [obs-17]. Test: a new
`os-code/test/vaultCore.test.ts` with a parity table of hostile names (any
name `vaultWrite` accepts, `vaultOpen` opens); `[[Ideas/Plan]]` stays
unresolved when only `Archive/Plan.md` exists; `[[ -f x ]]` in a code fence
is neither a link nor a backlink.

**3.2 A persisted, incremental index (L).** Per vault root, stored outside the
vault and outside the sealed store, which cannot hold a multi-MB blob (CTO
H3): a file main owns under `oscHome()/vault-index/` for the desktop folder,
a device-key-sealed file in the iPhone's Caches for every iPhone vault, and
memory only for the other desktop providers. Per note the path, title, aliases, tags, headings, links and their
resolutions, frontmatter keys, `updatedAt`, size, and a token estimate, plus a
reverse-link map and BM25 term statistics. Updated from write results and
watcher events, reconciled by `versionOf` alone on open (never mtime or
size), with cold reads in
bounded parallel and an async Electron walk. A first build on a large
existing vault shows progress and never blocks the editor. Closes [data-18]
[data-11] [ui-17] [truth-8] [orgvault-11]. Where:
`os-code/src/harness/vault/index.ts`, `app/src/lib/vaultIndexHost.ts`, call
sites only in `store.ts` (every write and remove through `patchVaultFiles`,
list results, the recheck and watcher paths, an opened note, and the team
index dropped at sign-out), Linked mentions in `VaultScreen.tsx` (the
on-request gate for large vaults is gone; `vaultReadAll` stays for export),
`main.ts:933`. Test: a new `app/test/vaultIndex.test.ts`, 5,000 notes give warm
backlinks under 100 ms; updating one note touches one entry; opening a note
triggers no whole-vault read; a first build over 5,000 notes reports progress
and finishes within a recorded budget on the reference box.

**3.3 The renderer runs on the core (M).** Wikilinks are handled on text
nodes only; relative `.md` links navigate; frontmatter renders as a quiet,
collapsible Properties strip (hidden when empty) and its bytes round-trip
unchanged; excerpts skip frontmatter. There is no `remark-frontmatter`
(CTO H2): the renderer shows `text.slice(fm.end)` from the core's own
frontmatter reader, so the two never disagree on where frontmatter ends, and
the save path puts CRLF back on an all-CRLF note the textarea folded to LF
(`restoreEol`). Closes [ui-6] [obs-18] [ui-23] [obs-13] [ui-7] [obs-8]
[custom-13] [truth-12]. Where: `VaultMarkdown.tsx`, `VaultProperties.tsx`,
`lib/remarkWikilinks.ts`. Test: `vaultMarkdown.test.tsx`, YAML is not an H2,
the edit round trip is byte-equal, a code fence renders verbatim; and
`vaultStore.test.ts`, an untouched CRLF note writes nothing.

**3.4 Reading config files (S).** A jailed, read-only `readConfig(name)` on
the seam for a short allow-list (`.obsidian/app.json`,
`.obsidian/daily-notes.json`, `.obsidian/templates.json`, `.oscode/vault.json`),
since the note filter in 0.6 and the `.md` rule in the normalizer keep these
out of the note path. `.obsidian/` maps to the vault's detected config folder
(Obsidian allows a per-device override, found by 2.10a). Needed by 6.4 and 7.1. Test: `providerConfigContract.test.ts`
(CTO H5), each provider reads an allowed file and refuses any other.

### M4. Context layer I: the engine and the floor

The spine starts here. After this release, a desktop engine session starts
with the vault in context, sized to the window the model is actually served,
for every class that has earned it by eval.

**4.0 Budgets use the window the model is served (M).** Send `num_ctx` on each
Ollama request from the engine and from `/chat`: the lower of the model's
`context_length` and a per-class ceiling derived from memory. Compaction, the
context meter, and the pack all use that one number. It changes every
session, not only vault work, so it ships behind config
(`providers.ollama.numCtx: auto | off`) and becomes the default only after an
`osc eval --deep` run on the reference box shows no loss and records the
prefill cost per class. Closes [missed-1/ctx]. Where:
`os-code/src/providers/openaiCompatible.ts:214`, `os-code/src/harness/profile.ts`.
Test: a provider test asserts `num_ctx` in the request body per class and its
absence when off.

Shipped 2026-09-27 (CTO I1): `providers.<id>.numCtx: 'auto' | 'off'`, unset
reads as off (no schema default), Ollama only, the class ceiling from name and
size and host memory read once per process (`providers/hostMemory.ts`),
memoized per model; `capabilities()` reports the served window and keeps the
native one as `nativeContextTokens`. `providerNumCtx.test.ts`. Default stays
off until the founder gate in 4.8.

**4.1 Wire the budgets (S).** Add `vaultPackFraction` and `vaultReadCapChars`
to the class policy, and wire the dead `codeMapContextFraction` and
`compactAtContextFraction` into the loop. The starting fractions are
placeholders until 4.8. Closes [keyask-7] [keyask-10]. Where: `profile.ts:46`,
`loop.ts`. Test: `harnessProfile.test.ts` and `harnessLoopProfile.test.ts`,
the budget scales by class.

Shipped 2026-09-27 (I2): the three vault fields on the class policy
(placeholders), `VAULT_PACK_MAX_TOKENS` 4000, the code map cut to its share
of the served window, compaction reading the class fraction.

**4.2 Privacy controls before any pack (M).** Exclude globs and local-only
folders, plus frontmatter `oscode: pin | exclude | local-only`, enforced
inside the tools and the pack, not only as permission rules. Defaults follow
D5 (`Private/`, `Journal/`, and `#private` local-only). This lands before the
pack so no note reaches a cloud seat without it. Closes [engine-15]
[keyask-13] [obs-15] (visibility half) [custom-7]. Where:
`os-code/src/harness/vaultContext.ts`, `tools/vault.ts`, `schema.ts:213`. Test:
`vaultContext.test.ts`, a local-only note never reaches a cloud pack;
`vaultTools.test.ts`, an excluded folder is invisible to list, read, and
search.

Shipped 2026-09-27 (I3 to I5): `vault.exclude`, `vault.localOnly` (machine),
`vault.context` (off-only), one judge in `harness/vault/privacy.ts` (a plan
change from `vaultContext.ts`), enforced in every vault tool and the pack; a
local-only tool result is marked and a leaving turn sends a stub, and a
journal-seeded reply after a local-only read keeps the mark across a restart.

**4.3 The pack builder (L).** A pure `buildContextPack({index, bodies, query,
project, pins, handoff, budgetTokens, seat, exclude})` returning `{text,
used[]}`. Layers in a fixed order: pins (empty until 5.5), the project's
Current State (read from the repo, not the vault), the latest handoff (empty
until 5.4), BM25 top hits with title, alias, and tag boosts, one hop along
links and backlinks, then a compact vault map. Deterministic output;
`%%comments%%` stripped; notes framed as quoted data, never instructions;
exclusions applied before ranking; under egress lockdown only keyword
retrieval runs; under a secrets lockdown nothing goes to a cloud seat. A
per-turn time budget: if the index is cold, the pack falls back to Current
State and titles instead of waiting. Closes [keyask-7] [engine-5] [truth-5]
[data-18] [custom-8]. Where: `os-code/src/harness/vaultContext.ts`. Test: a
new `os-code/test/vaultContext.test.ts`, every class stays within budget, the
same inputs give the same bytes, an excluded note never appears, a cold index
returns within the time budget.

Shipped 2026-09-27 (I6, I7): `planContextPack` and `buildContextPack` in
`harness/vaultContext.ts`, deterministic, framed as quoted data; the engine's
source (`core/vault/contextSource.ts`) waits 250 ms for a per-root index and
otherwise sends Current State only, marked cold.

**4.4 The engine injects the pack (M).** Built on the task text in `run()` and
placed after the project memory block, ordered stable to volatile so Ollama
and llama.cpp can reuse the KV cache. Behind machine config `vault.context:
auto | off`, and Memory off removes it. It goes to each class that has a 4.8
number; until then, lean seats get Current State inline only (D6). A
transcript card, "Used 3 notes from your Vault", teal or amber; on a
phone-driven session it lists the note titles and says they are on the
computer until 5.2 lets the phone open them. Closes [engine-5] [keyask-1]
(engine seats) [keyask-6] [custom-4] [truth-5]. Where: `loop.ts:464-515,
575-601`, `bootstrap.ts`, protocol events. Test: `vaultContext.test.ts`, "a
small seat gets Current State with no vault tool"; `memorySwitch.test.ts`,
off removes the pack.

Shipped 2026-09-27 (I8 to I10), with two plan changes: the pack sits after
the code map and before the text protocol (not after the memory block, so
the multi-KB standards keep their KV reuse), and every class gets Current
State only (`PACK_BY_CLASS`) until 4.8 has numbers. Bootstrap builds the
source for every host (CLI, daemon, routines, desktop); a session with no
vault root still gets Current State. The card re-fires when an escalation
changes the seat, and counts only real vault notes (never the map, the
handoff, or Current State). `vaultContextE2E.test.ts` runs it end to end.

**4.5 Tools that search first (M).** `vaultSearch(query, folder?, tag?, k)`
returns path, heading, and snippet; `vaultRead` resolves names, aliases, and
`#heading`, takes a `section`, returns a header (properties, tags, outgoing
links, size), and caps output by class; a new `vaultBacklinks(path)`. Lean
seats get one merged vault tool (search and read) through the small-seat
priority list, behind a profile knob. The descriptions teach the order:
search, read a section, follow links. Plan mode lists vault reads. Vault
writes stop triggering verify and the Jev judge. Closes [engine-6] [obs-4]
[truth-6] [keyask-10] [engine-13] [engine-12]. Where:
`os-code/src/core/tools/vault.ts`, `loop.ts:139, 502, 1196`. Test:
`vaultTools.test.ts`, a bare `[[Ideas]]` resolves into a subfolder and search
returns ranked snippets; `harnessLoopProfile.test.ts`, a small seat sees the
merged tool.

Shipped 2026-09-27 (I11): `core/tools/vaultFind.ts` (`vaultSearch`,
`vaultBacklinks`, merged `vaultLookup`, `vaultRead` with sections and a
header, capped by class); one rule for which seat sees which
(`seatOffersVaultTool`, `withVaultLookupPriority` in the registry, read by
the loop per turn); small seats see `vaultLookup`, tiny seats lean on the
pack.

**4.6 Per-root index on the engine (S).** The engine's index lives under its
state folder keyed by vault root, so a member's search on a shared hub can
never read another root through it (this matters from 5.2 on). Test: a
`daemonVault.test.ts` case, two roots, two indexes, no crossover.

Shipped 2026-09-27: `core/vault/engineIndex.ts`, one index per root keyed by
`vaultIndexKey`, saved under the engine's state folder;
`daemonVault.test.ts`.

**4.7 The harness keeps Current State current for lean seats (M).** Tenet 3:
the harness does the mechanical work. After a change that verifies, the
harness appends a dated line to the project's Current State through the
existing `projectMemoryWrite` carve-out, so the reference box's 7B keeps its
project memory without needing the tool. Closes [keyask-6] [engine-4]
[custom-4] (write half). Where: `loop.ts` (after verify),
`os-code/src/core/tools/projectMemory.ts`. Test: `harnessLoopProfile.test.ts`,
a verified change on a small seat appends one line; a failed verify appends
nothing.

Shipped 2026-09-27 (I12): `appendLandedLine`, after a passing verify on a
lean seat, never through a tool call, deduped, five harness lines at most.

**4.8 Measure before claiming (M).** Vault fixtures of about 200 notes (a
convention note, a decision behind a wikilink, a stale agent note that
contradicts it) and two tasks: recall a convention, follow a link. Run `osc
eval --deep` with and without the pack, per class, on the reference box,
recording score, turns, input tokens, and wall time. The numbers set the pack
default per class (D6). Closes [keyask-14]. Where: `os-code/src/eval/tasks.ts`,
`v2.ts`. Test: `os-code/test/evalV2.test.ts` covers the fixtures through the
mock provider; the numbers go into the PROGRESS log and DECISIONS.

Shipped 2026-09-27 in the sandbox only (I14): the 200-note fixture, the two
tasks, and `osc eval --deep --vault-pack on|off --num-ctx auto|off` (the task's
vault is the session's vault; the report records input tokens, pack tokens,
notes, and wall time per task, and files each variant separately). No number
is claimed. The founder gate is open: run it per class on the reference box,
then record the numbers in DECISIONS and PROGRESS before any class moves to
the full pack or `numCtx` defaults to auto.

**4.9 Crew notes models can build on (S).** Frontmatter (`type: crew-run`,
routine, project, model, session, started, state, tags), a link to the
previous run, and one line in the routine instructions pointing at
`Crew/<routine>/`. Closes [engine-11] [truth-20]. Where:
`scheduler.ts:581-617`. Test: `routines.test.ts` asserts the frontmatter and
the link.

Shipped 2026-09-27 (I13): frontmatter with JSON-quoted values, a full-path
`previous` link, and the instructions line; `routines.test.ts`.

### M5. Context layer II: every seat, every switch

After this release, every seat on every surface starts with the one vault, and
continuity survives a switch, a compaction, and a new day.

**5.1 The pack reaches every app driver (L).** Built on each send, after the
seat is chosen (so a Stack turn routed by the classifier or by Jev gets a pack
sized to the seat that answers), and placed beside the standing and chat
context: Stack through `StackContext.vaultPack` in `systemFor`; cloud Claude,
OpenAI-compatible, BYOM, and desktop chat through `ChatContext`; on-device
once its `extraSystem` becomes a function. About 300 to 400 tokens in a
4,096-token pocket window. The same card as 4.4. The pack does not ride an
Agentic Current (`askHermes`, `askAgent`, `cliAgent`) in v1. Closes [keyask-1]
(app seats) [engine-1] (driver half). Where: `store.ts:2431-2453`,
`app/src/drivers/stackDriver.ts:497-505`, `cloudClaudeDriver.ts`,
`onDeviceDriver.ts`, `deviceModel.ts`. Test: a new `app/test/vaultContext.test.ts`,
each driver kind carries the pack within its seat budget; Memory off leaves
it out; a Jev-routed turn is budgeted for the routed seat; no current tool
receives it.

Shipped 2026-09-27 (CTO J1 to J6): `app/src/lib/vaultPackSource.ts`
(`createAppVaultPack`) renders the engine's own `buildContextPack` from
protocol, prepared once per send inside the 250 ms cold budget and rendered
per seat after the seat is known (after `route()` and the Jev steer in the
Stack); it reads only bodies a seat can render, never a hidden note, and with
no index reads none, so the team vault never enters a pack. `lib/vaultSeat.ts`
judges a seat by address through `harness/locality.ts hostIsLocal` (BYOM
included; `byomReach` now agrees, so another tailnet's `*.ts.net`,
`0.0.0.0`, `169.254/16` and `fc*` read cloud). `lib/vaultPrivacy.ts` reads the
desktop bridge, the paired hub, or D5, and the device only narrows. Desktop
chat builds its pack on the daemon (`/chat` `vaultPack`, `memory: false`).
Still being wired by the app integrator (M5 wave 2): the store call sites in
`buildUnguardedDriver` (one pack per conversation, `{ vaultPack }` to each
driver, the Stack's `packSeat` and `vaultTools`, Memory off withholding
both), `settings.promptCache` into the context, and `fitDeviceHistory` as a
wrapper over `fitSeed`.

**5.2 The phone reaches the one vault; the hub is per owner (L).** Daemon
routes `GET /vault/notes` and `GET/PUT/DELETE /vault/notes/<path>` with
`ifMatch`, jailed and scoped to the owner on the Hermes notes pattern, with
the Electron walker moved into os-code. A `hub` provider shows as "Your
computer" when the phone is paired (D2), with "while your computer is on".
When the computer is out of reach, the phone shows the last known tree and
index read-only and stashes writes with their base. A shared hub gives each
member their own root (D9), and Crew notes go to the routine owner's vault.
Writes from the phone are the person's own and need no approval. Closes
[custom-9] [keyask-2] [engine-1] (phone half) [ui-4] [engine-2] [custom-10].
Interim member isolation (0.13) keeps the agent's no-ask tools off the owner's vault, but a member's own approved shell can still read it, so no copy says members cannot see the owner's notes until this item and a shell boundary land; when the JWT AuthContext source lands, `ownerHoldsAdmin` (serve.ts) must resolve roles through it. Where: `os-code/src/daemon/serve.ts` (the pattern at 890-905), `bootstrap.ts:192`,
`scheduler.ts`, a new `app/src/lib/gitos/hub.ts`. Test: a new
`os-code/test/daemonVault.test.ts` (jail, owner scope, conflicts);
`daemonRoutines.test.ts`, a member cannot list the owner's notes or another
member's Crew notes; the hub provider enrolled in `providerContract.test.ts`.

Shipped 2026-09-27 (J7 to J9): `os-code/src/daemon/vaultRoutes.ts` serves
`/vault/notes` (list, read, `PUT` with `ifMatch` or `ifAbsent`, `DELETE`
only with `ifMatch`), `/vault/config`, `/vault/privacy`, and `/vault/index`
(ETag, 304), every path through the Jail and the note rule, a phone edit fed
to the engine's index. `core/vault/memberRoots.ts`: the owner on the machine
vault, each member on `oscHome()/vaults/members/<hash>` (0700, made on first
use); a session gets `BootstrapOptions.vaultRoot` at create and its stored
owner's root at rehydrate (the old `vault` flag is gone), a member cwd that
overlaps any root is refused, and Crew notes land in the routine owner's
vault. `daemon.test.ts` proves the owner and two members on one hub each see
only their own root, by route and by session. App: `lib/gitos/hub.ts`, "Your
computer, while it is on", a sealed stash (200 notes or 8 MB), read-only out
of reach, compare-and-swap saves replayed on return, the D2 repoint and move
card. Still being wired by the app integrator: `setHubVaultLink` on pairing
changes, one index lifetime rule and one pairing rule, the away line on the
Vault screen, and passing `handoff` and `vaultPins` through the phone and
desktop session creates (the daemon, Electron main, and `engineHost` already
accept both).

**5.3 Vault tools on app seats that call tools (M).** A new
`app/src/lib/vaultTool.ts`, on the `codemagicTool.ts` pattern, puts search and
read into the Stack driver's Anthropic and OpenAI loops; a write is an
always-ask proposal through the approval sheet. Pocket seats get the pack
only. Closes [keyask-1] (tool half). Test: `app/test/vaultContext.test.ts`,
the tool slice is present for cloud and BYOM seats and absent for pocket
seats; a write reaches the approval sheet.

Shipped 2026-09-27 (J10): `app/src/lib/vaultTool.ts` (`vaultSearch`,
`vaultRead`, `vaultLookup` for a merged class, `vaultPropose`) on cloud and
BYOM single turns in the Stack driver, descriptions shared with the engine
through `harness/vault/toolText.ts`; proposals queue into one always-ask card
at the end of the send, nothing written on decline. A local-only read marks
the reply (`Msg.localOnly`) and a leaving seat gets the stub. The store-side
`vaultTools` wiring and carrying `localOnly` onto the transcript are the app
integrator's.

**5.4 Handoff: on a switch, a compaction, and the end of a session (L).** A
pure, offline, extractive `buildHandoff(items, budget)` in
`os-code/src/harness/handoff.ts` (goal, latest plan, open questions,
decisions, files named, next step), which never includes thinking blocks
(the Chain of Thought rule). `switchModel` seeds the new seat with the
handoff plus the newest turns that fit its window, generalizing
`fitDeviceHistory` with `contextWindowFor`; the desktop agent becomes
seedable through `BootstrapOptions.handoff`. The engine also writes a handoff
on compaction and at session end, kept per project in app and engine state
(not the vault, so no carve-out), which is what the pack's handoff layer
reads the next day. The switch note is honest ("Handed over with a summary of
14 earlier turns"), and its card offers "Save to Vault" as the person's own
one-tap write (D3). A third eval task, "continue from a handoff", joins 4.8.
Closes [keyask-4]. Where: `store.ts:3900-3990`, `deviceModel.ts:35-81`,
`loop.ts:575-601`, `remoteDriver.ts`. Test: a new `app/test/switchHandoff.test.ts`
(a 32k target never gets more history than fits; the desktop agent receives
the handoff; no thinking text in any handoff); an engine case that a
compaction writes one.

Shipped 2026-09-27 (J11 to J13): pure `harness/handoff.ts` (`buildHandoff`,
`fitSeed`, `handoffBudgetTokens`), extractive and deterministic, never
thinking, a tool's output, or a local-only turn. `switchModel` seeds through
`fitSeed` (the whole chat when it fits, else a handoff for exactly the
dropped turns) with an honest note and "Save to Vault"; a chat carried to the
desktop opens a new agent chat whose session create carries the handoff
(`BootstrapOptions.handoff`, 16 KB, first task only; Electron main and
`engineHost.createSession` forward it). The engine writes the latest handoff
per owner, workspace and project after a compaction, each completed task and
dispose (`core/agent/handoffStore.ts`, redacted, sealed), read on a fresh
session's first task at most 7 days old as a full-mode layer; a Crew run
neither writes nor reads one. Clearing: `DELETE /sessions/:id` takes its
handoff, and `DELETE /handoffs` (the owner only) and the desktop IPC
`osc:clearHandoffs` take them all; the app integrator wires "Clear
conversations" to them. Eval: `vault-continue-handoff` and `--handoff on|off`
(sandbox only). "Picks up where you left off" waits on its J19 number.

**5.5 Take a note to a model (M).** The note's options gain "Ask about this
note" and "Pin to project context". Pins live on the project
(`Project.vaultPins`, editors only, read through the active project like
currents). A `[[` picker in the composer inserts a trimmed excerpt with a cost
line. A "Recently from your agent" row. Closes [ui-5]. Where:
`VaultScreen.tsx:504`, `app/src/components/Composer.tsx`,
`ProjectDetailScreen.tsx`. Test: `vaultContext.test.ts`, a pin reaches only
its own project's pack; the composer excerpt stays within budget.

Shipped 2026-09-27 (J14, J15): `Project.vaultPins` (at most 8, editors,
device-local, never synced), `ProjectVaultPins` in `ProjectDetailScreen`, pins
in both pack modes (at most 3 and half the budget, privacy applied), carried
to engine sessions as `BootstrapOptions.vaultPins`. The `[[` picker
(`VaultNotePicker`), budgeted excerpts with a cost line, "Ask about this
note", "Pin to project context", and "Recently from your agent". Still being
wired by the app integrator: one `ComposerVault` shape wired from
`ChatScreen`, `onOpenPackNote` through `MessageList`, and the note item's
"Save to Vault" button.

**5.6 A stable prefix that caches (S).** System prompts run stable to
volatile; `cache_control` on the stable block in the app's Claude driver and
the engine's Anthropic provider; the pack is rebuilt only when its inputs
change. Closes [keyask-11]. Where: `cloudClaudeDriver.ts:150`, the engine
provider. Test: unchanged inputs give a byte-identical prefix.

Shipped 2026-09-27 (J16, J17): the app's `systemFor` runs stable then
volatile and `lib/claudeCache.ts` marks the head and caches the history
(`settings.promptCache`, off, no UI). The engine: `providers.<id>.promptCache:
'auto' | 'off'` (unset reads off, machine class) splits `system` at the
loop's `ChatMessage.cacheAt` (where the pack begins); the loop forwards the
API's cache reads and writes onto the `usage` event, and
`promptCacheLoop.test.ts` proves 'auto' marks the pack boundary while 'off'
is byte-identical to a request with no offset. Both stay off until the J19
`--prompt-cache on|off` number; the dollar rail does not yet price cache
reads and writes. The app integrator keeps one Claude system builder.

### M6. Obsidian day one

After this release, an Obsidian user's existing vault can be read, found,
fixed, reorganized, and cleaned up.

**6.1 Search and a quick switcher (M).** Search runs on the index (title hits
at once, body hits with highlighted excerpts) with `tag:`, `path:`, `file:`,
and quoted phrases; Cmd or Ctrl+O opens the switcher on the desktop; a Recent
list includes agent-written notes. Closes [ui-10] [obs-6] [custom-12]
[truth-9]. Test: a store test that finds an agent-written note in a
5,000-note vault within budget; operator cases in `vaultCore.test.ts`.

Shipped 2026-09-27 (K8, K9, K16): the K8 grammar in `harness/vault/query.ts`
over the index's `search`, `expandPrefix` and `titleMatches`; the field sits in
the tree at every level and crossfades to results (titles first, then text,
with `<mark>` excerpts); Cmd or Ctrl+O opens `VaultSwitcher` on the desktop
(the phone's switcher is the field, CX X3); Recent is a device ring per vault
merged with the agent's notes. `vaultSearch.test.ts` finds an agent-written
note in a synthetic 5,000-note vault within budget. The reference box numbers
(K16, with the bare two-letter prefix search against 50 ms) are a founder
gate.

**6.2 Rename and move, with links following (L; needs 2.1 and 2.3).** An
optional `rename()` on the seam, native per provider (a file rename, a
coordinated iCloud move, a key move in Local, an `org_vault_move` RPC with a
base revision), falling back to create-if-absent then remove. `rewriteLinks`
asks "Update N links in M notes?", and each rewrite is a compare-and-swap
write. Folders can be created, renamed, and deleted, with counts. Closes
[ui-11] [obs-7] [data-17] [orgvault-12]. Test: a rename case in
`providerContract.test.ts`; `rewriteLinks` cases that keep aliases and
headings; a rename stops and reports if a referring note changed; a pgTAP
move case.

Shipped 2026-09-27 (K3 to K5, R1): `rename` natively on the folder, the hub
(`folderFs.renameVaultFile`, a hard link that cannot replace) and Local (a key
move that keeps `v`), with the create-if-absent fallback only on a
compare-and-swap storage; the rename adopts the path the storage returns. The
pure `planLinkRewrites` and the host apply in `vaultOps.ts` ask "Update links?"
only when links point in, skip a note that changed twice and carry on, and
leave a standing card with "Update the rest". Folders are created, renamed and
trashed with counts; Local remembers an empty folder on the device. The team
`org_vault_move` (0020, pgTAP) is on the held team branch.

Team part built 2026-09-27 on the held `vault-m2-team` branch: the team client
declares `rename` over `org_vault_move` under the source's rev and adopts the
path and rev it answers; a name outside ASCII is also checked by the one
`foldPath` against the listing, since the server folds by `lower()` only. The
team row runs every rename case in `providerContract.test.ts`, and
`vaultCaps` lights Rename, folders (note by note, as Local) and the link
rewrite on the team vault. Merges once 0021 to 0026 are in production,
pushed from main (CTO 4 and CTO 11; the one sequence is
`docs/vault-gate1-runbook.md`).

**6.3 Trash with Undo (M; team restore needs 2.3).** Delete moves the note to
`.trash/` (the folder Obsidian uses for its own trash, already hidden by 0.6);
an Undo toast rides
`useExitPresence` with a haptic on commit; a Trash view offers Restore and
Empty; team deletes restore from revisions. Closes [ui-12] [data-17]
[orgvault-4]. Test: `vaultStore.test.ts`, delete then Undo restores the bytes
and `.trash` stays out of the tree.

Shipped 2026-09-27 (K6, R2, R3): `.trash/<path>` on a folder and Your
computer, sealed trash keys on Local; Delete is one tap only where Trash is
real, else two taps worded "for good" with a courtesy in-memory Undo. The Undo
toast (`VaultUndoToast`, 6 s, pauses under a hand, "Also in Trash.") and the
Trash page (the last row at the root, Restore per row, Empty on a second tap)
restore beside a taken name as "{title} (restored)". Team Trash (Restore only)
waits for the held team branch.

Team part built 2026-09-27 on the held `vault-m2-team` branch: a trash is
`org_vault_remove` under the rev; Trash lists a tombstone only while its
newest revision of any reason is `deleted`, so a path a note moved away from
never shows; Restore writes that revision's body back with `if_absent`, else
as "{title} (restored)", and a second Restore of the same entry lands nowhere
new. No Empty Trash (R3): the server's purge drops what has been there 30
days. One tap deletes on the team vault, since its Trash is real. The team row
runs every Trash case in `providerContract.test.ts`.

**6.4 Today's note (M).** A Today action whose folder, format, and template
come from `.obsidian/daily-notes.json` (through 3.4), else Obsidian's defaults
(vault root, `YYYY-MM-DD`, no template); templates support `{{date}}`,
`{{time}}`, and `{{title}}`; it opens an existing note and never overwrites
it; Crew notes link to the day's note and never append to it. Closes [obs-16]
[custom-11]. Test: date formats in `vaultCore.test.ts`; Today opens an
existing note unchanged.

Shipped 2026-09-27 (K7): the pure `dates.ts` with moment tokens, refusing an
unknown one by name; config from `obsidian/daily-notes` and `obsidian/templates`
cached 60 s; `write(path, text, { ifAbsent: true })`, and an existing note opens
byte for byte with no toast. The Today button sits beside the house +; Crew run
notes gain `day: "[[...]]"` and never append.

**6.5 Obsidian markdown in reading view (M; checkbox write-back needs 2.1).**
Callouts, `==highlight==`, hidden `%%comments%%`, block anchors, scroll to
`[[Note#Heading]]`, task checkboxes that tick and write back through
compare-and-swap, the chat's code block with Copy, and `![[Note]]` embedded
one level deep. Closes [ui-8] [obs-16]. Test: one case per syntax in
`vaultMarkdown.test.tsx`.

Shipped 2026-09-27 (K10, K11): hand-written remark plugins in
`remarkObsidian.ts` (callouts in four token families, highlights, masked
comments, block anchors, heading scroll, a `#tag` that searches `tag:x`), no
raw HTML and no `id` from note text; checkboxes write back by compare-and-swap
where `taskWriteBack` is lit; the chat's `CodeBlock` with Copy only; `![[Note]]`
one level deep.

**6.6 Images and PDFs, read-only (M; "Your computer" needs 5.2).** `readBytes`
on the folder, iCloud, and hub providers, resolved through the attachments
folder; `![[img.png]]` and `![](img.png)` render from blob URLs; PDFs show as
chips that open; moves count non-note files. Closes [data-17] [obs-12]
(read half). Test: an embed case in `vaultMarkdown.test.tsx`; a move report
that counts attachments.

Shipped 2026-09-27 (K11, K13): `readBytes` and `listAttachments` on the folder
and the hub (`GET /vault/files/<path>`, allow-listed types, 20 MB), images from
refcounted blob URLs (`vaultBlobs.ts`, revoked on a storage change, leaving the
room and iOS backgrounding), remote images as link chips, PDFs as chips that
open on the desktop. iCloud and the iPhone folder wait for their held
branches.

**6.7 Linking that feels native (M).** Up, Down, Enter or Tab, and Esc in the
suggestions; `role=option` and `aria-activedescendant`; a pick replaces
through an existing `]]` or `|`; `#heading` completion after a note name; an
accessory bar above the phone keyboard that moves by transform (motion rule
4; no new layout exemption); a folder sub-label when titles collide;
insertion through `setRangeText` so undo keeps working. Closes [ui-15]
[obs-17]. Test: a component test for a keyboard pick and an ambiguous
insert; `polish-standards.test.ts` stays green.

Shipped 2026-09-27 (K14): `VaultLinkSuggest` as a listbox with the keys, a
pick through an existing `]]` or `|`, headings after `[[Note#`, a folder
sub-label on colliding titles, and `VaultAccessoryBar` on the phone lifted by
transform. Insertion tries `execCommand('insertText')` (native undo) and falls
back to `setRangeText`; its undo on a device is a founder gate.

**6.8 Outgoing links, unlinked mentions, an outline (S).** Under Linked
mentions, plus an outline sheet from the headings. Closes [obs-16]. Test: an
unlinked-mentions case in `vaultCore.test.ts`.

Shipped 2026-09-27 (K15): outgoing links from the index, unlinked mentions on
request (at most 50 reads) with a guarded Link button (CX X16, the person's own
compare-and-swap write), and the outline sheet first in Options when a note has
two or more headings.

**6.9 The house bar (S).** The house icon button for + (44 px, `press-fb`),
press feedback on chips, mentions, and the segmented control, crossfades
between tree and note and between read and edit on the motion tokens, and a
backlinks skeleton. Closes [ui-18]. Test: `polish-standards.test.ts` and
`motion-tokens.test.ts` green, plus a guard that every Vault class name has a
rule.

Shipped 2026-09-27 (K18): the 44 px house +, press feedback on every new
tappable, the backlinks skeleton, and a guard that every `vault-` class has a
rule. Tree and note, and read and edit, are true crossfades: the leaving view's
inert snapshot (`hooks/useViewGhost.ts`) fades out while the arriving view
fades in, guarded by `vaultViewGhost.test.tsx`; `vaultRoomM6.test.tsx` mounts
the room over a Local storage with every cap lit.

What waits for the held branches (K19), each landing by adding seam members so
its `providerContract` rows enroll themselves: `vault-m2-icloud` (coordinated
rename, Trash, attachments and `readBytes`; until then an iCloud delete is
permanent with the in-memory Undo, and no Rename, images or checkbox
write-back); `vault-m2-team` with 0019 then 0020 in production (rename over
`org_vault_move`, Trash and Restore over tombstones and revisions, checkbox
write-back and link rewrites; until then the team room keeps M2's delete); and
`vault-m2-native` for the iPhone folder (the same members over its transport,
`readBytes` and `readConfig` conformed to main's shapes, daily notes and
attachments from its detected config folder).

### M7. The customization surface

**7.1 Vault settings (L).** One schema in the core, read from
`.oscode/vault.json` inside the vault (the recorded `.oscode/` convention, so
it travels with the files) and seeded from `.obsidian/app.json`,
`daily-notes.json`, and `templates.json`, which OpenShore reads and never
writes (including Obsidian's `userIgnoreFilters`). The in-vault file holds
conventions and anything that narrows the agent's reach: new-note folder,
daily folder and format, templates folder, attachments folder, link format,
default open mode, editor font and size, sort order, trash or permanent
delete, the agent's folder, excluded and local-only folders. It can never
widen reach, because anyone who can write the folder (a sync client, an
Obsidian plugin, a teammate) can write it: pins stay on the project (5.5),
and pack size (Small, Normal, Large), handoff on or off, the location, and
any budget above the default stay in app settings and machine config. The
agent can never write under `.oscode/` (a hard deny in the tool). For Local
and team vaults, where no folder exists, the same schema lives in the sealed
store and in an `org_vault_settings` row. The sheet opens from the note
options and is mirrored in Settings; the main switches also appear as
Wayfinding rows. Closes [data-21] [ui-20] [obs-14] [engine-15] [keyask-13]
[custom-11] [obs-13] (link format on insert) [obs-9] (ignore filters). Test:
new `app/test/vaultSettings.test.ts` and `os-code/test/vaultConfig.test.ts`
(no config behaves exactly like the defaults; a `.obsidian` fixture
configures the vault by itself; every field has a runtime consumer; a field
that would widen reach is rejected from the in-vault file; a `vaultWrite`
under `.oscode/` is denied).

Shipped 2026-09-27 (CTO L1 to L8, L11, L13 to L16, L18, L19): one pure core
(`harness/vault/settings.ts`: parse, resolve, union, patch, defaults) through
`os-code/protocol`; the file `.oscode/vault.json` read on every host
(`core/vault/settingsFile.ts` on the engine and daemon, `lib/vaultSettings.ts`
in the app) and written only by the sheet through the seam's `writeConfig` by
compare-and-swap (desktop folder, Your computer, Local's sealed key); Obsidian
wins where it sets a convention and the row reads "From Obsidian"; the file
only narrows (widening keys set aside with a plain line, lists union only); a
hard deny under `.oscode/` on every write path, including a symlinked note
and `writeFile`/`editFile` under an always-allow grant (`runShell` stays under
its ask rule); one sheet in seven sections from note Options, the storage
sheet and Settings, with "Notes in chats", "Handoff" and "Vault settings"
after Memory in Wayfinding; Notes in chats, Handoff (off-only) and Room for
notes (lower-only against the machine) ride engine sessions as
`vaultOverrides`. The team vault on main shows the defaults read-only. Not
shown yet: "This project's settings turn this off." (the app cannot read a
project's config) and the machine's pack size above Large.

**7.2 Provenance (M).** An `oscode:` frontmatter namespace on agent-written
notes (source, model, seat class, created, reviewed), merged without touching
the person's own keys, and a teal or amber chip in the note view. Closes
[obs-15]. Test: `vaultCore.test.ts`, the merge keeps the rest of the YAML byte
for byte.

Shipped 2026-09-27 (L9, L10, plan change): flat top-level `oscode-*` keys
(`source`, `model`, `where`, `size`, `provider`, `created`, `reviewed`), since
a nested `oscode:` map would collide with the privacy marks and drop them; the
pure `mergeProvenance` in `harness/vault/provenance.ts`, byte for byte, which
skips rather than touch bad frontmatter. It runs before the approval on both
paths, so the person approves the exact bytes: the engine's `vaultWrite` diff
carries the property lines and execute writes the hashed bytes or nothing; the
app computes an addition's final text before the card, names the change ("Also
records in its properties: Edited by {model} · Local."), and writes it by
compare-and-swap on the version read. Crew run notes use the same merge. The
chip, "About this note" and Mark as reviewed (the person's compare-and-swap
write) are in the note view. Tests: `vaultCore.test.ts`,
`vaultApprovedBytes.test.ts`, `vaultProvenanceEngine.test.ts`, the app's
`vaultTool.test.ts`.

**7.3 A starter layout for an empty vault only (S).** `Inbox/`,
`Templates/Daily.md`, and a "Vault conventions" note the person can pin. An
existing vault is never touched. Closes [custom-11]. Test:
`vaultStore.test.ts`, a non-empty vault is unchanged.

Shipped 2026-09-27 (L12): `lib/vaultStarter.ts`, offered only on an empty
personal vault with folders and no config at all, opt-in through a preview
sheet, emptiness re-checked before writing, every write `ifAbsent`, a partial
result said so. The line that Private and Journal stay off cloud models shows
only when the starter's `.oscode/vault.json` actually landed (a machine
`vault.localOnly` replaces the built-in default, so the file's union is what
makes it true).

**7.4 Team vault settings and entitlement (M).** An `org_vault_settings` row
(who may delete: admins or members; the team context folder) and an
entitlement check in `org_vault_put`, enforcing the recorded ruling that the
team vault is part of the commercial tiers. The check gates writes only; an
org that lapses can still read and export every note it has. Pricing stays a
Board gate. Closes [orgvault-14] [orgvault-17]. Test: pgTAP cases, including
a lapsed org reading and exporting.

Built 2026-09-27, held (L17): `0021_org_vault_settings.sql` and its pgTAP on
`vault-m2-team`, waiting with 0019 and 0020 (pushed in that order):
`org_vault_settings`, admin-only compare-and-swap `org_vault_settings_put`,
`org_vault_entitled`, `OV402` on every write RPC when not entitled, `OV403`
for a member's delete when only admins may (a move is not gated by the delete
role). The founder's rule for an org with no entitlement row: writes stay
open until `no_entitlement_vault_until()` (null in the beta), which one
migration sets at least 30 days out when pay gates return; a lapsed paid row
is read-only with export regardless. Team settings in the app land with that
branch; on main the team vault shows the defaults read-only.

App part built 2026-09-27 on the held `vault-m2-team` branch (CX Y14, Y15):
the team client reads and writes the row as the vault's `oscode/vault` file
(`org_vault_settings_get` and `_put`, rendered in jsonb key order, so the
writeConfig contract row compares the JSON the column holds), echoing who may
delete and the context folder from the same read. `vaultCaps` lights the
settings sheet for admins only; members read it under "Your admins set
these."; admins get "Team settings" beside Export and a "Who can delete team
notes" row. `OV402` is the calm lapsed state (the lead line, Export kept, the
room read-only, a mid-edit save held as Not saved with "The team plan is not
active, so team notes cannot change."), `OV403` says "Not deleted. Only
admins can delete team notes.", and a set `entitled_until` shows "Team notes
stay editable until <date>." Merges once 0021 to 0026 are in production,
pushed from main (CTO 4 and CTO 11).

### M8. Ship gate

**8.1 Device checklist in PROGRESS "What remains".** "This folder" takes an
agent write while the note is open and Obsidian has it open; iCloud on two
devices (lease, evicted notes, a move, a conflict version); a two-member team
vault (conflict toast, a stale delete refused, restore); iOS export; a paired
phone browsing "Your computer"; a switch from cloud to Harbor to the desktop
agent with a handoff; a real Obsidian fixture vault, since the review could
not reach Obsidian's docs. iCloud from a Mac: with the same Apple ID, iCloud Drive shows OpenShore's vault folder, desktop Obsidian opens it as a vault, an edit on each side reaches the other, and the phone lists no `.obsidian/`; the iCloud Obsidian line returns to `vaultCopy.ts` only after this passes and 2.1 and 2.9 land (CMO). For the iPhone folder (2.10): a vault On My iPhone
lists notes and not `.obsidian/`, edits save and show in Obsidian, and a save
leaves Obsidian's "Created time" unchanged; an iCloud vault with half its
notes evicted shows them, opens by downloading, and a same-name create opens
the existing note; a Mac edit opened on the phone before iCloud delivers it
never forks the note; picking Obsidian's parent folder, renaming the vault in
Files, relaunching, and rebooting still opens it; a folder inside a vault asks
for the vault; a config folder override is found; an Obsidian edit reloads a
clean note and opens the resolve sheet on a dirty one; two devices offline
then online reach the resolve sheet and badge "Note 2.md"; a deleted then
restored folder shows and clears its state; iCloud sign-out and sign-in, a
restore to a new phone, and offloading then deleting Obsidian are each
recorded; 5,000 notes stay responsive with progress; a Mac pointing `vault.dir`
at the same iCloud vault delivers an approved agent note to the phone; a save
survives backgrounding; a dismissed picker cancels cleanly; and App Review's
steps pass with a plain folder and no Obsidian installed. Closes [truth-22]
[truth-23].

**8.2 Docs and claims sweep.** Correct the "never lost" claims now that
revisions exist, "on a branch" in `docs/vault-page-redesign.md`, and the stale
CLAUDE.md lines. Record in DECISIONS: the base revision lives in the editor,
the lease revision (2.5), the trash convention, the pack budgets from 4.8, the
team vault's permission model, and every founder decision below. Closes
[truth-21] [orgvault-19]. Test: both em-dash guards pass; no "Projects/&lt;project>/"
vault references remain.

**8.3 Every must-fix id maps to a named test.** A table in PROGRESS; CI green,
the pgTAP job included. Closes [data-22] [keyask-14].

Shipped 2026-09-27 (docs): 8.1 is `docs/vault-v1-device-checklist.md`, the
plan's list merged with the device checks M1, M4, M5 and M6 left in PROGRESS;
8.2 swept the claims and recorded the M8 entry in DECISIONS; 8.3 is
`docs/vault-v1-test-map.md` (101 must-fix findings: 96 covered, 2 on the held
team branch, 2 device-only, 1 missing, orgvault-19). The table lives in its
own doc with a pointer in PROGRESS, which the line cap would not hold.

**8.4 Copy unlocked by the number.** Anything beyond "your models can read your
notes" lands only with the 4.8 and 5.4 results recorded (D12).
`vaultCopy.test.ts` refuses "faster", "smarter", and "remembers" until the
eval flag is set in the copy map.

## Defaults out of the box

| Setting                            | Default                                                                                                              | Where it changes                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Where it lives                     | Desktop: `~/OSCode/Vault`. Paired phone: "Your computer". Unpaired phone: this device, with honest copy              | The storage sheet; machine config                             |
| Context pack                       | On for each class with a 4.8 number; lean seats get Current State until theirs is measured (D6)                      | A Wayfinding row, vault settings, `vault.context`             |
| Budget                             | A fraction of the served window, per class                                                                           | Small, Normal, Large in settings; more only in machine config |
| Cloud seats                        | Pinned and retrieved notes with an amber card; `Private/`, `Journal/`, `#private`, and `local-only` never leave (D5) | Vault settings, note frontmatter                              |
| New notes, daily note, link format | From `.obsidian`, else Obsidian's defaults                                                                           | Vault settings                                                |
| Delete                             | To trash                                                                                                             | Vault settings                                                |
| Agent writes                       | Always-ask; headless routines get no `vaultWrite`                                                                    | Deny rules; D4                                                |
| Handoff                            | Seeded into the next seat; written on compaction and session end; saved to Vault with one tap (D3)                   | App settings, machine config                                  |
| Memory                             | On. The app can only turn it off; a project config off wins                                                          | Wayfinding, project config                                    |

Customization runs in layers, widest to narrowest: machine config (location,
and anything that widens reach), app settings, the in-vault `.oscode/vault.json`
(conventions and narrowing only), per-project pins, and per-note frontmatter.

## Out of v1, with reasons

- **Google Drive as a vault provider** (D1): four data-loss or staleness
  defects, and it has never run with the real OAuth clients [data-4] [data-5]
  [missed-1/drive].
- **The team vault in model context** (D15) [orgvault-6] [keyask-12]
  [engine-1] (engine half): it needs a search RPC, the entitlement gate, and
  an injection review for text teammates write. v1.1, once the team vault
  meets the M2 bar.
- **The pack or handoff riding an Agentic Current**: v1 keeps them off
  `askHermes`, `askAgent`, and `cliAgent`; when they do ride, exclusions,
  local-only, and the secrets lockdown apply to what leaves.
- **Realtime presence and automatic three-way merge** [orgvault-5]: v1 polls
  and uses the resolve sheet.
- **Team folder permissions and roles beyond who may delete; team import.**
- **Writing attachments (paste or drop an image); math and Mermaid; Canvas,
  graph, Bases, Dataview** [obs-12] (write half) [ui-8] [obs-19]. v1 hides
  `.canvas` files.
- **Obsidian's plugins, themes, CSS snippets, and hotkeys.** "Fully
  customizable" in v1 means the settings above, not Obsidian's extension
  system.
- **A live-preview editor (CodeMirror 6) and a two-pane desktop layout**
  [ui-21] (D11).
- **Multiple vaults** [data-21] (D14). Opening an Obsidian vault in place on
  iPhone is IN v1 (2.10).
- **Embeddings by default**: BM25 is the default; embeddings come only with a
  configured embedder and an eval that shows a gain [keyask-7].
- **Automatic handoff notes in the vault and an `Agent/` inbox carve-out**
  (D3, D4).
- **Two-way sync between a phone's Local vault and the desktop folder**: the
  hub provider replaces it.
- **Sealing notes (enc:v1); Lessons, or any "learns" claim** (D13).
- **Low-severity leftovers** [engine-m2] [orgvault-20]: fold in when a
  milestone already touches the file.

## Decisions only the founder can make

Each with a recommendation. **Ruled 2026-09-27: all fifteen as recommended,
except D14, where the iPhone half moves into v1** (recorded in
`os-code/DECISIONS.md`).

1. **D1. Google Drive in v1?** Hold it (0.18): not selectable for a new vault,
   an existing Drive vault goes read-only and can be moved off. Including it
   costs roughly two M items and an S, compare-and-swap on Drive, and a device
   run with the real OAuth clients.
2. **D2. The paired phone's vault.** "Your computer" by default while paired;
   this device, with honest copy, when unpaired. Offer iCloud on a Mac (point
   `vault.dir` at the iCloud container) in the folder picker, never as the
   default. On iPhone the person may instead pick their own Obsidian vault
   (2.10); that is their choice, never a default, and pairing never moves a
   person off a folder they chose.
3. **D3. Handoff notes in the vault.** A one-tap save by the person in v1,
   which needs no carve-out. Revisit a harness-written carve-out, like the
   routine note, once there is usage.
4. **D4. Agent note-taking.** Keep always-ask, with one batched approval card
   per task, over an `Agent/` inbox carve-out.
5. **D5. Does the pack go to cloud seats by default?** This sends notes to the
   cloud without a tool call, which does not happen today. Yes for pinned and
   retrieved notes, with an amber card every time, `Private/`, `Journal/`, and
   `#private` local-only by default, and nothing to the cloud under a secrets
   lockdown.
6. **D6. The pack for lean classes.** Let eval decide: Current State only,
   then retrieval for small and tiny once 4.8 shows no loss in score and fewer
   turns or less wall time on the reference box.
7. **D7. The desktop migration.** A one-tap card, with the Local copy kept.
8. **D8. Where vault settings live.** In the vault (`.oscode/vault.json`),
   limited to conventions and narrowing, with anything that widens reach in
   app settings or machine config.
9. **D9. Members on a shared hub.** Per-member roots in v1 (5.2); M0 removes
   their vault tools in the meantime.
10. **D10. The team vault's v1 status.** Ship it at the M2 bar with pgTAP in
    CI and the entitlement gate; otherwise label it BETA.
11. **D11. The editor.** The textarea with the M6 fixes in v1; CodeMirror 6 in
    v1.1.
12. **D12. The evidence each claim needs.** "Your models can read your notes":
    tests only. "Picks up where you left off": the handoff eval task passes on
    each class. "Faster": fewer turns and less wall time on the reference box,
    for the class named. The founder sets the thresholds.
13. **D13. Sealing notes.** Record "not in v1" in DECISIONS.
14. **D14. Multiple vaults and in-place folders on iOS.** Recommended v1.1 for
    both. **Ruled:** the iPhone opening an existing Obsidian vault in place is
    v1 (2.10), since it is the only way the same notes show in Obsidian and
    OpenShore on a phone; multiple vaults stays v1.1.
15. **D15. The team vault in model context.** v1.1, after the M2 bar, with a
    search RPC and an injection review; until then the team vault is for
    people only, and the copy says so.

## Risks

- **Compare-and-swap across providers is the long pole.** Hold Drive, land the
  folder first, and hold every provider to one contract test. A provider
  without it keeps the lease and says so.
- **Order matters.** The desktop default flip ships with 1.1, never before it;
  1.3 relies on 0.5; the pack reaches no cloud seat before 4.2.
- **The reference box.** At 3 to 7 tokens per second, prefilling a 400-token
  pack costs real time, and a larger `num_ctx` costs memory on a 7.6 GB
  machine. Eval may show a net loss for the tiny class; the honest result is
  then a smaller pack, or none, for that class.
- **Prompt injection through the pack.** Notes from teammates, routines, or
  cloned sources now reach a model without a tool call. Notes are framed as
  data, the card names the sources, exclusions apply before ranking, hub
  roots are per member, and the in-vault settings can only narrow.
- **Privacy.** D5 and 4.2 ship together, or the pack stays local-only.
- **Index drift.** The index is never the source of truth: reconciled by mtime
  and size, rebuildable at any time, with a progress row on a first build.
- **Dependency weight.** remark in the engine core and the app bundle: measure
  the bundle and keep `polish-standards` green.
- **Untested providers.** iCloud has no Swift unit harness and the hub is new;
  the device checklist is a hard gate.
- **Obsidian fidelity.** The review could not read Obsidian's docs; the byte
  round-trip test and a real Obsidian fixture vault are the guards.
- **Scope creep.** Obsidian parity has no natural end. Anything outside M6 and
  M7 waits for a finding and a test.

## Rough effort

Engineer-weeks for one person, estimates only.

| Milestone                            | Effort              |
| ------------------------------------ | ------------------- |
| M0 Stop silent loss and false claims | 2                   |
| M1 One vault on the desktop          | 2.5                 |
| M2 Safe with more than one writer    | 6 (2.10 is 2.5)     |
| M3 One core and one index            | 3                   |
| M4 Context layer I                   | 4                   |
| M5 Context layer II                  | 5                   |
| M6 Obsidian day one                  | 5                   |
| M7 Customization                     | 2.5                 |
| M8 Ship gate                         | 1, plus device time |

About 31 in all, with the iPhone folder in v1. Two tracks in parallel bring the calendar to roughly half,
with the critical path running through M5. M0 is worth shipping on its own the
moment it is done: it closes every known silent-loss path and every false
claim without waiting for the rest.
