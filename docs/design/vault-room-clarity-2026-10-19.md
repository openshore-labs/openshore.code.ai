# The Vault room, made plain, and one tidy OpenShore folder (2026-10-19)

Founder brief, from a screenshot of the desktop Vault: "I thought we had
logged standard markdown folders, I'm not seeing any of those, progress.md,
decisions.md, etc. Also it mentions Obsidian here. Is that a real connection?
[...] There should be an option to connect Obsidian itself to OpenShore [...]
This page needs to be more intuitive. As a user I don't know what to do here or
what vault does and how it functions. Have my creative studio work on
improving this. Also have the phone mirror desktop [...] with a note that
directs folks to dock to their computer and run vault locally there. There is a
third option that isn't recommended [...] running vault through your local
mobile device." And: "the OpenShore folder needs to be exceptionally organized
with folders matching all of the section names in the app."

The Creative Studio led; CX and the CTO read it with them. Same shape as the
earlier room reviews: the read, the direction, what shipped.

## The read

### CX: the project notes are there, one tap too deep and never named

Every coding project does keep the standard notes: Current State, Progress,
Decisions, Action Items and Skills, in its repository under
`OpenShore Project <name> MDs/`, written and committed by the agent
(`app/src/lib/projectMemory.ts`). The Vault showed them only as a project name
behind a chevron in a card called "Coding projects", and the card never said
which notes were inside. So a person who knows the notes exist looks for them
and does not find them. Nothing was lost; nothing told them where to look.

### CX: "Obsidian opens this folder as a vault" reads like an integration

It is true and it is the whole story: OpenShore's Vault is its own, built
here, and it keeps plain `.md` files. Obsidian is an app that works on any
folder of plain `.md` files, so Obsidian and OpenShore can work on the same
folder at once. There is no Obsidian account link, no sync with Obsidian's
servers, and no key. Obsidian has no key to give out: its vault is the folder,
and Obsidian Sync is end-to-end encrypted with no way in for another app. So
"connect Obsidian" is honestly "point OpenShore at your Obsidian vault's
folder", which the desktop already could do, hidden under Where it lives,
Choose another folder.

### Creative Studio: the room never asks the one question that matters first

An empty vault opened on a cover with two buttons that both write a note, and
three cards that describe features. The decision a newcomer actually has,
where do my notes live and does Obsidian fit, sat behind a small "Where it
lives" link. The page explained itself instead of offering a choice.

### CTO: the folder names do not match the rooms

`~/OpenShore` held `Projects/` (cloned repositories, which the app shows in the
Repositories room) and `Models/` (files from the Local Library room). A person
opening the folder could not map it to the app.

## The direction (built)

### 1. "How you keep notes", the first thing in the room

A card at the top of the personal vault, the same on every device, with one
row per way and the current one marked Here now. Empty, it is open; once the
vault has notes it folds to one line (Kept in your OpenShore folder, Change).
Copy lives in `app/src/lib/vaultWays.ts`, the choice is pure and tested
(`app/test/vaultWays.test.ts`).

On a computer, two ways:

| Way                                        | What it says                                                                                                                                                         | Does                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **In your OpenShore folder** (Recommended) | Plain .md files in OpenShore/Vault on this computer, a folder for each project. Your agents and routines work here too.                                              | Moves the vault to this computer's folder, or back to OpenShore's own folder from a picked one. |
| **Your Obsidian vault**                    | Already use Obsidian? Choose your vault's folder, and OpenShore and Obsidian work on the same files. Nothing to sign in to and no key: the folder is the connection. | Opens the folder picker. Here now when the vault folder is an Obsidian vault.                   |

On a phone or an iPad, three ways, the computer first:

| Way                                      | What it says                                                                                                                                                               | Does                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **With your computer** (Recommended)     | Dock to your computer and your vault lives there, where your agents work. This phone keeps a copy and catches up whenever it is docked.                                    | Not docked: Connect your computer (opens Computer). Docked: keeps the vault with the computer. |
| **Your Obsidian vault**                  | Obsidian keeps its vault as a folder on your computer. Choose it there, in the Vault's How you keep notes, and every docked device uses it. There is no key to enter here. | Not docked: Connect your computer. Docked: says where to choose it.                            |
| **Only on this phone** (Not recommended) | Your notes stay on this phone. Your agents on your computer cannot read them, and your other devices do not get them.                                                      | Keeps the vault on this device and stops syncing notes. Chats and projects still sync.         |

"Only on this phone" while docked is a third answer to Where your notes live
(`vaultSync: 'device'`), beside Sync on all devices and Keep on one computer.
The Obsidian choice carries across devices the only honest way it can: it is
made once, on the computer, and every docked device reaches that folder.

### 2. Projects, with their notes named

"Coding projects" became **Projects**. Each row names the notes inside
(Current State, Progress, Decisions, Action Items, Skills) under the project's
name, and opens them as before. The project's notes view gains a row to the
project's own folder in the vault, **Projects/<project>**, made on first open,
and that folder in the vault links back to the agent's notes. The agent's
notes stay in the repository on purpose: they travel with the code, are
versioned with it, and a teammate who clones it gets them.

### 3. The folder, one name per room

```
OpenShore/                (~/OpenShore; on a phone, On My iPhone > OpenShore)
  README.md               what each folder is
  Chats/                  one .md per chat, by month          (Chats)
  Repositories/           cloned repositories, Try OpenShore, Scratch  (Repositories)
  Vault/                  your notes, Obsidian-ready          (Vault)
    Projects/<project>/   notes for each project              (Projects)
    Agents/<routine>/     routine run notes                   (Agents)
  Local Library/          files from the Local Library        (Local Library)
  Exports/                anything you export
```

The phone has the same names, without Repositories (projects run on a
computer). Desktop moves, once, on start (`os-code/src/config/openshoreFolder.ts`):
`Projects/` becomes `Repositories/` and leaves a link at the old name, so every
repository path a project, a chat or a routine recorded still resolves; and
`Models/` becomes `Local Library/`. A name already taken in the new place stays
where it was. The phone renames `Models` to `Local Library` the same way
(`ModelStore.swift`), by rename, so no model downloads again. The starter
layout adds the Vault's Projects and Agents folders.

### 4. The vault folder in Settings (founder, the same day)

"In settings there should be an ability to change the default folder location
so you can place inside Obsidian's reach (or other organizers). But default is
the organized folder in the OpenShore app folder." Settings, Wayfinding, under
the vault rows, gains **Vault folder** on a computer: the path, what it is
(Default, Obsidian vault, or Your folder), and a tap to choose another. While
another is in use, **Use OpenShore's folder** brings it back to
`OpenShore/Vault`. Both hand off to the Vault room, which runs the picker (or
the switch back) and shows the result in its storage sheet, with Bring when the
folder before held notes. A phone's row says the folder is chosen on the
computer and where the phone's copy sits in Files.

## CTO: safe to ship

- The engine's workspace boundary (members' sessions, routines) moves to
  `Repositories`; recorded paths resolve through the link, and the boundary is
  judged on real paths as before.
- No new network call, stored field off the device, or claim beyond the
  code. "Only on this phone" stops a note sync; it never deletes a copy on the
  computer.
- Gates: both packages' typecheck, lint, tests, the em-dash and UI guards.

## Open, for the founder

- **The agent's notes in Obsidian.** They live in each repository, so
  Obsidian, opened on the Vault folder, does not show them. If you want them
  in the Vault folder too, the safe shape is a read-only copy under
  `Vault/Projects/<project>/From the repository/`, kept up to date by the
  desktop; the risk is that an edit made to the copy in Obsidian is replaced.
  Not built until you say.
- **Device pass:** the Here now marks on the desktop with an Obsidian vault
  picked, and on a docked and an undocked iPhone; the `Local Library` rename
  on an iPhone with a model already downloaded (no Swift build runs in CI).
