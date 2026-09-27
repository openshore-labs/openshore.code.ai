# Vault v1: the device checklist (plan 8.1, 2026-09-27)

Ship gate 4 in `docs/vault-v1-plan.md`: every line below is ticked on a real
device before Vault v1 ships. It merges the plan's 8.1 list with the device
checks each milestone left in `os-code/PROGRESS.md` (M1, M4, M5, M6), so this
is the one list; PROGRESS "What remains" points here. The reference box evals
(M4 to M6 numbers) are founder gates of their own and stay in PROGRESS. Record
each result (date, device, OS, pass or what happened) under its line. A line
marked (held) needs its held branch merged first: `vault-m2-icloud`,
`vault-m2-native`, or `vault-m2-team` with 0019, 0020, and 0021 pushed.

## Desktop: This folder, the agent, and Obsidian

- [ ] "This folder" takes an agent write while the note is open in OpenShore
      and Obsidian has it open: the clean note reloads in place, a dirty one
      opens the resolve sheet, nothing is overwritten.
- [ ] An Obsidian edit to the open note reloads a clean note and opens the
      resolve sheet on a dirty one.
- [ ] The macOS Files and Folders prompt on the first pick of a folder in
      Documents and of one in iCloud Drive.
- [ ] A Dropbox folder and an iCloud Drive folder each show their sync line;
      a vault in ~/Documents with iCloud Desktop and Documents on (does the
      sync line show? the realpath may not reveal it).
- [ ] An online-only note opens with a connection and fails with the 0.4
      message without one.
- [ ] Open in Obsidian on a folder Obsidian knows, and the how-to line on one
      it does not.
- [ ] A read-only folder is refused (CI runs as root, so the unit test skips
      there).
- [ ] A real Obsidian fixture vault (properties, tags, aliases, callouts,
      embeds, images, daily notes, a `.obsidian/` config) opens, reads, and
      round-trips byte for byte after an edit, since the review could not
      reach Obsidian's docs.
- [ ] The context card on the desktop ("Used N notes from your Vault"), teal
      for a local seat and amber for a cloud one.

## iCloud (held: `vault-m2-icloud`)

- [ ] Two devices on one iCloud vault: the advisory lease line, evicted notes
      listed and opening by download, a move, and a conflict version reaching
      the resolve sheet.
- [ ] iCloud from a Mac, same Apple ID: iCloud Drive shows OpenShore's vault
      folder, desktop Obsidian opens it as a vault, an edit on each side
      reaches the other, and the phone lists no `.obsidian/`. The iCloud
      Obsidian line returns to `vaultCopy.ts` only after this passes and 2.1
      and 2.9 land (CMO).
- [ ] One recorded `xcodebuild test` run of the iCloud Swift tests
      (`CoordinatedTreeTests`) on the Mac that builds the iOS app.

## The iPhone opens an Obsidian vault in place (held: `vault-m2-native`, 2.10)

- [ ] A vault On My iPhone lists notes and not `.obsidian/`; edits save and
      show in Obsidian; a save leaves Obsidian's "Created time" unchanged.
- [ ] An iCloud vault with half its notes evicted shows them, opens by
      downloading, and a same-name create opens the existing note.
- [ ] A Mac edit opened on the phone before iCloud delivers it never forks
      the note.
- [ ] Picking Obsidian's parent folder, renaming the vault in Files,
      relaunching, and rebooting still opens it.
- [ ] A folder inside a vault asks for the vault; a config folder override is
      found.
- [ ] An Obsidian edit reloads a clean note and opens the resolve sheet on a
      dirty one.
- [ ] Two devices offline then online reach the resolve sheet and badge
      "Note 2.md".
- [ ] A deleted then restored folder shows and clears its state.
- [ ] Each recorded: iCloud sign-out and sign-in, a restore to a new phone,
      and offloading then deleting Obsidian.
- [ ] 5,000 notes stay responsive, with progress on the first build.
- [ ] A Mac pointing `vault.dir` at the same iCloud vault delivers an
      approved agent note to the phone.
- [ ] A save survives backgrounding; a dismissed picker cancels cleanly.
- [ ] App Review's steps pass with a plain folder and no Obsidian installed.
- [ ] One recorded `xcodebuild test` run of the `CoordinatedTree` and folder
      Swift tests.

## Team vault, two members (held: `vault-m2-team`, 0019 to 0021 pushed)

- [ ] Two members edit one note: the conflict reaches the resolve sheet and
      the copy wears its badge.
- [ ] A stale delete is refused and says so.
- [ ] A deleted note is restored from Trash (Restore only, no Empty).
- [ ] A rename over `org_vault_move` keeps the note and its history.
- [ ] Under admins-only delete, a member's delete is refused (`OV403`) while
      a member's move still lands.
- [ ] A lapsed org can still read and export every note.

## iOS export

- [ ] Export as plain files on the iPhone reports "N of M", and an unknown
      file and `.obsidian/` in the export folder survive a re-export.
- [ ] The team export lands in "Vault Team/<org>" and never touches the
      personal export.

## A paired phone and "Your computer" (M5)

- [ ] A paired phone browses "Your computer", while the computer is on.
- [ ] The tree reads read-only with the computer off, and a stashed save
      lands on return.
- [ ] The pairing repoint and the move card.
- [ ] The context card on the phone opens a note.
- [ ] A member on a shared hub sees only their own root.

## Model switches and the pack (M4, M5)

- [ ] A switch from a cloud seat to Harbor to the desktop agent with a
      handoff: each seat continues the thread, and the switch note says
      what was handed over.
- [ ] The 327-token Current State prefill time on a pocket model, recorded.

## Obsidian day one on a device (M6)

- [ ] Link insertion's undo (`execCommand('insertText')`, else
      `setRangeText`).
- [ ] The Undo toast (6 s, pauses under a hand, 44 px Undo).
- [ ] The accessory bar rides the keyboard on a phone.
- [ ] Dynamic Type at the largest size on result, Trash, and chip rows.
