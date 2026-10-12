# The Project room, reviewed and rebuilt (2026-09-15)

Founder brief: "I want our CTO, Creative Studio, and CX to take a look at the
project UX. This is where I expect 75% of work to be done and right now it's a
bit scattered and a subpar UX/UI." This is the advisory read on the room the
person lands in when they tap a project (`ProjectDetailScreen`), the direction
the three seats agreed on, and what shipped on this branch. Advisory as always:
they surface findings and a recommendation, the person decides. The founder can
redirect any of it; it is on a branch, not on `main`.

## The diagnosis (what "scattered" was)

The old room was a stack of four visually identical `.card` sections in this
order: **Standing instructions, Repositories, Chats, Team access**, under a
paragraph of onboarding copy. Every section wore the same weight, so nothing
led. The one thing a returning person wants, get back into the work, sat third,
below two configuration cards they touch once a week.

### CX (the evidence read)

- **The information architecture is inverted for the stated job.** If 75% of the
  work is here, the room opens on config (instructions, repos) and buries the
  work (chats). The highest-frequency action, resume or start a chat, is the
  hardest to reach. A room is measured by its most common path, and this one put
  two low-frequency cards in front of it.
- **No resume.** The single most valuable action for a returning person is "pick
  up the chat I was last in." It existed only as an undifferentiated row in a
  list, indistinguishable from a chat three weeks old.
- **The counts were a text fragment.** `3 chats · 1 repo` sat inline in a
  suggestion row next to a text button, so the state of the project (how much
  work, how much context) had no visual weight.
- Honest-state posture was already good (every empty state ends in a next
  action); that survives the rebuild.

### Creative Studio (the perceptual and identity read)

- **No hierarchy, so no calm.** Four identical cards is visual monotony; the eye
  has nowhere to land. Premium reads as one clear focal point, then a settled
  descent. The room had four peers and a wall of lead copy.
- **The identity was absent.** The name repeated as a plain `h1`; the room did
  not feel like *this* project's place. The Crew command room already carries a
  premium cover (`cc-hero`); the project room, a more important surface, had
  none.
- **The shared-element title was the one nice moment** (the name flies up from
  the tapped card). Keep it, and give it a destination worthy of the move.
- Direction, the most premium of the three we weighed: a calm, paper-raised
  **cover** with a soft water wash (not a heavy dark band, so the ink title
  still lands from its flight), live count tiles, and the primary action right
  there. Work leads; context follows with a quiet teal eyebrow that says what it
  is for ("rides into every chat"); the roster and destructive actions sit last.

### CTO (safe to ship)

- **Blast radius is contained.** The rebuild is presentational plus one new
  outbound link (`openProjectMemory`, an existing store action). No store
  contract, permission gate, team-access server path, or migration is touched.
  `mayWrite` / `mayEdit` / `canManageAccess` / `canShare` gating is preserved
  exactly; a read-only teammate still sees the room and cannot start chats or
  edit content.
- **The polish guards hold.** The shared-element title, the section stagger, the
  team-roster in/out animation, and the dirty-Save emphasis are all still
  pinned by `projectPolish.test.ts`; new anchors were added, none loosened. All
  new motion references the tokens (no raw curve, no ad-hoc millisecond, no
  layout transition); the em-dash guard, the motion guard, and the
  reduced-motion reset all pass.
- Verdict: **safe to ship.** Gates green: app typecheck, lint, 887 tests (102
  files, including the extended project-polish anchors), Vite build. Not
  verifiable here: the feel on a real device (TestFlight), which is the founder
  call on taste.

## What shipped

`ProjectDetailScreen` is now a workspace, not a form:

1. **A premium cover.** Kicker, the hero title (still flown in from the list
   card), one short honest line, a live **stat strip** (chats, repos, and, on a
   company account, team size) as paper tiles, and the action that matters:
   **New chat** (primary teal) beside **Resume last chat** (secondary). The
   active state is a pill; "Make active" is one tap when it is not. A soft radial
   water wash gives depth without a dark band.
2. **Work first.** The Chats section leads. When there is history, a **resume
   card** in the brand's water sits at the top ("Pick up where you left off"),
   showing the last chat with its live working dot; the rest of the list follows
   under a prominent New chat row.
3. **Context, framed as what feeds the chat.** Standing instructions and
   Repositories each carry a small teal eyebrow, "Rides into every chat."
   Instructions render as a readable preview panel; repositories render as
   **chips** (a GitHub glyph or a local folder glyph, teal for a local
   workspace), with a link into the agent's **project memory** ("What the agent
   has learned here").
4. **Roster and danger last.** Team access (company accounts) and the
   share / stop-sharing / delete actions sit at the foot, delete in the danger
   tone.

The Projects list cards were aligned to match: each now reads as a workspace
(live `N chats · M repos`) with a one-line instructions preview, not a name and
a truncated note.

Rendered and checked in headless Chromium at phone width in both themes; the
hierarchy reads and the accents behave (teal for local and brand, danger for
delete, the warm dark ground lifting the teal correctly).

## Open, for the founder

- **Taste on a device.** The cover wash strength and the resume card's teal are
  a first pass; a TestFlight look is the real judge.
- **Three directions, one built.** Creative Studio's rule is to shape and let
  the person choose. We built the recommended direction (light premium cover,
  work-first) rather than three half-versions, because the branch is a redesign
  branch and the room is easier to judge live than on paper. The alternates we
  set aside: a dark `cc-hero`-style band (loses the clean shared-element landing),
  and a tab split (Work / Context / Team) that we judged heavier than a room this
  size needs. Say the word to explore either.
