# My Crew, reviewed and reframed (2026-09-15)

Founder brief: "Do the same for My Crew too. It's very business oriented and
should be more project agnostic with business abilities, but CTO should be
called Technical Advisor or something like that instead, for example. Audit this
page for a better UX/UI also." Same three seats, same shape. On a branch, not
`main`.

## The diagnosis

### CTO: a layout bug in the command door

The "Crew command" door card renders its kicker, title, and subtitle as three
`<span>`s inside `.crew-command-door-body`, but the body was not a column, so on
a phone the spans flowed inline and ran together: "CREW COMMAND" collided with
"Put your crew to work", and the subtitle spilled off the right edge (the
overlap in the founder's screenshot). Inline elements also drop the `margin-top`
the design intended. A one-line fix (make the body a flex column) stacks them
and lets the subtitle ellipsis.

### CX + founder: the roster reads as a startup C-suite, not general advisors

The shipped advisor team was CTO, CMO, CFO, CX, Creative Studio, Chief of Staff,
Board, Corporate Strategist, with personas full of company framing ("you earned
the seat through product", "burn", "unit economics", "the org"). For a person
building anything other than a venture-backed startup, that is the wrong costume:
the *abilities* (technical review, marketing, finance, strategy) are exactly what
they want, the *titles and framing* are not.

### Creative Studio: the invite was a floating paragraph under two buttons

"New crew member", then a ghost "Add the advisor team", then a loose paragraph
explaining the team. The ready-made team, the most valuable thing on the page for
a newcomer, had the least structure.

## What shipped

1. **The door bug is fixed.** `.crew-command-door-body` is now a column;
   kicker, title, and subtitle stack, and the subtitle truncates cleanly.
2. **The advisor team is reframed as project-agnostic advisors**, keeping every
   business ability, in `crewPresets.ts`:

   | Was | Now |
   | --- | --- |
   | CTO | Technical Advisor |
   | CMO | Marketing Advisor |
   | CFO | Finance Advisor |
   | CX | Research Advisor |
   | Creative Studio | Creative Studio (kept; already agnostic) |
   | Chief of Staff | Coordinator |
   | Board | Sounding Board |
   | Corporate Strategist | Strategy Advisor |

   The personas were rewritten to advise on "whatever you are building or
   deciding" rather than a company, while keeping the capability and each one's
   voice. The activity shape is unchanged (one standing reviewer, an
   auto-engaging trio, four by request), and every persona still states it is
   advisory and the person decides. The activity labels lost their dev framing
   too: "Reviews builds" is now "Reviews the work", "Auto-reasoning" is "Joins on
   its own", "Request only" is "When you ask".
3. **The invite became a card.** An "Advisors" section with a title, the plain
   description, and the one-tap add, so the ready-made team reads as one clear
   offer. The roster sits under a "Your crew" label.

Copy that named the old titles was updated to match: the Crew screen's toast and
description, the guide knowledge string, and the one sentence in
`docs/interaction-model.md` that points at the preset (with a note that the names
shipped as a C-suite until today).

### CTO: safe to ship

- **Blast radius contained.** Content and copy plus the one CSS column fix. No
  store action, the routines/presence wiring, the editor sheet, or the activity
  model changed. `crewPresets.test.ts` was updated to the new names and gained a
  guard that the old C-suite titles are gone and the business abilities remain
  (not a weakening; a renamed assertion plus a new one).
- **Guards hold.** No new motion; the em-dash and polish guards pass. Gates
  green: app typecheck, lint, 888 tests, Vite build. Rendered in headless
  Chromium at phone width in both themes: the door no longer overlaps and the
  reframed roster reads.

## Open, for the founder

- **The internal dev-process references still say "CTO".** `CLAUDE.md` and this
  session's own review voices use the C-suite titles for how the *repo* is built
  (a separate thing from the shipped app preset). Left as-is; say the word to
  align those too.
- **Taste on the names.** "Sounding Board" (was Board) and "Coordinator" (was
  Chief of Staff) are the two judgment calls; easy to swap if you prefer others.
- **Card actions.** Edit and Delete as two pills per card is the one bit of the
  roster that still feels heavy; a swipe-to-delete (as the routines list uses)
  is a natural follow-up.
