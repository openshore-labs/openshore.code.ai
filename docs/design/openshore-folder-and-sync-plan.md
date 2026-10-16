# One OpenShore folder, synced through your computer (plan, 2026-10-16)

The founder's ask: everything the app saves sits in one clean OpenShore folder
on each device, in a subfolder per section, and the person's devices sync
through the docked computer, so work can differ on each device while apart and
comes together once docked. Settings keeps a way to hold it all on one
computer instead.

## Rulings (founder, 2026-10-16)

- **R1. Sync on all devices is the default.** Every device keeps a full working
  copy, works on it offline, and catches up with the computer whenever it
  docks. Settings, Vault, "Where your files live" offers the other choice:
  **Keep on one computer** (today's behavior, the phone reads the computer's
  copy while docked).
- **R2. The computer is the meeting point.** Devices sync only through the
  docked computer (or a docked server the person made their default machine),
  over the tailnet. No iCloud or other third party carries the sync, and with
  no computer docked, two phones do not sync with each other.
- **R3. Keep both on a conflict.** When two devices changed the same file while
  apart, the computer's version stays as the file and the other is saved beside
  it as a conflict copy; the existing resolve sheet opens (Keep both first).
  Nothing is overwritten silently (the vault's standing rule).
- **R4. What syncs:** the Vault, Chats, and Projects (the project list and its
  settings; the code stays on the machine the project runs on).
- **R5. Private notes travel to the person's own devices** over the tailnet,
  and stay barred from any seat that leaves this network on every device (D5
  holds per device, judged by address as today).
- **R6. One name everywhere: OpenShore.** `~/OpenShore` on the computer,
  On My iPhone > OpenShore on the phone. An existing `~/OSCode` moves over once.
- **R7. Real files for Vault, Models, Projects and Chats**, in this layout.
  Chats as files is a setting, Settings, Chats, "Save chats as files", on by
  default (founder, 2026-10-16); off, chats stay in the sealed store only.

```
OpenShore/
  Vault/            your notes (Obsidian-ready)
    Crew/           routine run notes
  Chats/            one .md per chat, by month
    2026-10/
  Projects/         cloned repos and project work
    Try OpenShore/
  Models/           downloaded model files
    Harbor/
    Harbor Lite/
  Exports/          anything you export or save out
  README.md         what each folder is
```

Machine settings, keys, tokens, indexes and session journals stay hidden
(`~/.os-code`, the app's own data), never in this folder.

## Where things move

| What | Today | After |
|---|---|---|
| Desktop vault | `~/OSCode/Vault` or a picked folder | `~/OpenShore/Vault`; a picked folder (an Obsidian vault) stays where it is |
| Desktop clones, sample, scratch | `~/OSCode/<name>`, `Try OpenShore`, `scratch` | `~/OpenShore/Projects/...`, scratch as `Projects/Scratch` (what a chat with no project made is the person's work, so it stays findable) |
| Phone vault | sealed key-value store (`local` provider) | real files in `Documents/OpenShore/Vault` (a `folder`-style provider over the app's own Documents) |
| Chats | sealed key-value store / Electron localStorage | the sealed store stays the source of truth, mirrored to `OpenShore/Chats/YYYY-MM/<title>-<id>.md` with a small front-matter header (M3: not read back until M5) |
| Phone models | `Application Support/Models` (hidden) | `Documents/OpenShore/Models/<name>/`, excluded from backup |
| Desktop models | Ollama's own store | unchanged (Ollama owns the weights); `Models/` holds ComfyUI and other OpenShore-managed files, and a `README` pointing at Ollama's |
| Exports | `Documents/Vault` (iOS export) | `OpenShore/Exports/` |

## How sync works

One engine, the daemon, holds the meeting copy in the computer's
`~/OpenShore`. Each device holds its own working copy and a small sync ledger
(hidden, in app data): for each file, the version it last agreed with the
computer (the base) and whether it changed since.

1. **Dock or reconnect** starts a sync pass; while docked, every save also
   pushes at once and the device listens for the computer's changes.
2. **Push:** each locally changed file goes up with its base version, through
   the compare-and-swap the vault routes already use (`ifMatch`, `ifAbsent`).
   Accepted: the base moves. Rejected because the computer's copy moved too:
   R3, the device's version lands beside it as a conflict copy, and both
   devices see the resolve sheet.
3. **Pull:** the device asks for everything changed since its last agreed
   point (a per-root change cursor on the daemon) and applies files it has not
   touched; a file it has touched is the push case above.
4. **Deletes and renames** ride as entries with their base, so a delete
   against an edited file is a conflict (Keep both keeps the edit), never a
   silent loss. Renames keep links following, as the vault's rename does.
5. **Chats** sync by the same ledger. A chat is mostly appended to, so two
   devices adding turns to the same chat while apart become one conflict copy
   ("Chat title (from this iPad)") rather than an interleaving guess.
6. **Projects** sync as one small file per project
   (`Projects/<name>/.openshore/project.json`), the code itself staying where
   the project runs (Runs on).
7. **Keep on one computer** turns the ledger off: the phone reads and writes
   the computer's copy while docked (today's `hub` provider) and keeps only the
   capped read cache.

Nothing here adds a host: sync rides the docking connection already on the
egress list. The list's docking entry gains "your notes, chats and project
settings, to your own computer".

## Milestones

Each lands green on its own, behind `FEATURE_TIER` until M5.

- **M1. The folder.** One path helper per host (`openshoreRoot()`), the layout
  and its `README.md`, the desktop move from `~/OSCode` (copy, verify, leave a
  link at the old path, never delete), the engine's workspace boundary moved
  to `Projects`. BUILT 2026-10-16 (`os-code/src/config/openshoreFolder.ts`,
  `test/openshoreFolder.test.ts`). Tests: the layout, the move on a fixture home, the boundary.
- **M2. Real files on the phone.** The phone vault on files in
  `Documents/OpenShore/Vault` (passes `providerContract.test.ts`), the move
  from the sealed store, models moved under `Models/` with backup excluded,
  exports under `Exports/`.
- **M3. Chats as files.** One markdown file per chat with a front-matter
  header, written on each settled turn. Copy that says chats are not synced is
  updated at M5, not before. BUILT 2026-10-16, as a mirror, not read back:
  the sealed store stays the source of truth, and each chat's file in
  `OpenShore/Chats/YYYY-MM/<title slug>-<first 8 of id>.md` is a copy the app
  keeps (written once a turn settles and the chat rests, moved on a rename,
  removed with the chat, the newest 50 checked once at launch); editing a file
  changes nothing in OpenShore. The setting is Settings, Chats, "Save chats as
  files" (`chatFiles`, device local, on by default); off asks whether to
  remove the files already written. No thinking, no attachment bytes (names
  only), a tool step in one line. Code: `app/src/lib/chatFiles.ts` (renderer
  and path), `lib/chatFileWriters.ts` (the phone's Documents, the desktop's
  guarded `osc:chatFile*` jailed to `sectionDir('chats')`, none on the web),
  `state/chatFileOps.ts`, `electron/chatFilesFs.ts`. Reading files back (and
  the move from the sealed store) waits for M5, where sync needs it.
- **M4. The sync engine.** The daemon's change cursor and batch routes, the
  device ledger, push, pull, deletes, renames, conflict copies; the Vault first.
  Tests: two simulated devices editing apart, every conflict shape, a dropped
  connection mid-pass.
- **M5. Chats and Projects ride sync; the setting.** Settings, Vault, "Where
  your files live" (Sync on all devices, Keep on one computer), copy through
  `vaultCopy.ts`, the guide's facts, the egress entry, the
  security-privacy review.

## Risks and calls for review

- **Chats as plain files** (R7) trade the sealed store for readability: on the
  phone only the person (through Files) and OpenShore can read the app's
  Documents; on a computer any program running as the person can. The privacy
  page says so plainly, and the security-privacy review runs before M3 ships.
- **The `~/OSCode` move** touches every desktop install and every repository
  path a session recorded. Once emptied, `~/OSCode` becomes a link to
  `Projects`, so recorded repository paths still resolve; a name already taken
  in the new place stays in `~/OSCode` and the link waits until it is free.
- **Phone storage:** a full working copy of a large vault, plus chats, sits on
  the phone. The setting's row shows the size; Keep on one computer is the way
  out.
- **Obsidian vaults picked elsewhere** are synced in place on the computer and
  land on the phone under `OpenShore/Vault`.
