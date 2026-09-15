# The Vault page, reviewed and rebuilt (2026-09-15)

Founder brief: "The vault page needs a ton of work. How do I know what this is
or how to use it as a new user? Use Obsidian's new-user onboarding and ramp UX
as a guide for how to make this a dynamic area of the app that draws people in
to use it and understand how it's used by their models." Same three seats, same
shape: the read, the direction, what shipped. It is on a branch, not `main`.

## The diagnosis

Two problems, one of them a real bug.

### CTO: an empty-state bug that broke the page on a phone

The empty Vault reused the chat screen's `.greeting` class. That class is, on a
touch device by design, `position: fixed` (pinned to the viewport under the
header) and `pointer-events: none`. It is built to sit as a calm backdrop behind
the chat composer. On the Vault, with projects present, that meant:

- the big "Your vault starts with one note." floated as a fixed layer **over**
  the Coding projects card (exactly the overlap in the founder's screenshot),
  and
- because the fixed layer is `pointer-events: none`, the **"New note" button in
  it could not be tapped at all** on a phone.

So the one call to action on the new-user screen was dead. This is the first
thing to fix, and it is why the empty state must not borrow `.greeting`.

### CX: a new user cannot tell what the Vault is or how it is used

Beyond the bug, the empty state said "Plain markdown files. Yours, on this
device." and stopped. It never answered the two questions a newcomer actually
has: *what is this for*, and *how does my agent use it*. The Vault is one of the
most differentiated ideas in the app (a knowledge base your models read and
write), and the front door said almost nothing about it. Obsidian's own onramp
is the reference the founder named: a fresh vault opens on a real welcome note
rather than a blank void, and the concept is taught by showing, not telling.

### Creative Studio: it did not draw anyone in

A single centered line and a button. No sense of place, no identity, nothing
that rewards a look or invites the first move. The project and stack rooms now
open on a calm cover in the brand's water; the Vault, a peer surface, had none.

## What shipped

The empty **personal** vault is now an in-flow onboarding ramp (no `.greeting`,
so nothing floats and every button is tappable):

1. **A welcome cover** in the room family's water wash: a "Your vault" kicker, a
   warm display-face line ("A home for what you and your agent know"), and a
   plain-language sentence on what it is.
2. **Two ways in.** "Write your first note" (the existing new-note flow) and
   "Add a welcome note", which seeds a real, readable starter note the way a
   fresh Obsidian vault opens on one. The starter note itself teaches the moves:
   markdown, the shared read/write with the agent, and a live `[[wikilink]]`.
3. **Three "how it works" cards**, the ramp: notes are plain markdown that stay
   yours; the agent both writes what it learns here and reads your notes back;
   and `[[wikilinks]]` connect notes so the agent can follow them. Each with a
   small teal glyph, arriving on the house stagger.
4. **Discovery in place.** When the person already has coding projects, the
   "Coding projects" card (the memory the agent already keeps) sits right above
   the ramp, so a new user sees their agent already has knowledge here.

The offline and empty-team states became plain in-flow notice cards too, so they
are never fixed overlays either.

One seam changed: `vaultCreate` gained an optional `content` argument (backward
compatible; every existing caller and test is unchanged). A note seeded with
content is already written and readable, so it opens in read mode rather than
the editor.

### CTO: safe to ship

- **Blast radius contained.** Presentational plus the one optional-arg seam on
  `vaultCreate`. No other store action, the lease/sync logic, the note editor,
  the storage providers, team scope, or the Agentic Current folder is touched.
- **`.greeting` is untouched**, so the chat screen it belongs to is unaffected;
  the Vault simply no longer borrows it.
- **Guards hold.** New motion is on the tokens (the ramp and its cards animate
  on `msg-in`/stagger, no layout transitions), reduced motion is honored, and
  the em-dash guard passes. Gates green: app typecheck, lint, 887 tests, Vite
  build. Verified in headless Chromium at phone width in both themes: the
  overlap is gone and the ramp reads.

## Open, for the founder

- **The same `.greeting` reuse elsewhere. DONE 2026-09-15.** The one other
  offender was the project memory view (its empty, error, and not-set-up states,
  the error one with an untappable "Try again" on a phone). Its states, and the
  Vault's own notices, now use a shared in-flow `.empty-notice` card; only the
  chat keeps `.greeting`.
- **Taste on a device.** The welcome-note copy and the ramp density are a first
  pass; TestFlight is the judge.
- **Deeper ramp.** A natural next step is a light "what your agent saved" feed on
  a populated vault, so the page stays dynamic past day one.
