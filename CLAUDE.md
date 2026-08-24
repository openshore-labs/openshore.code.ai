# Working notes for Claude, OS Code (openshore.code.ai)

## Read PROGRESS at session start (standing rule)

`os-code/PROGRESS.md` is the recent-state source of truth for OS Code: current
state first, then "What remains," then the log. Read it at the start of every
session before other work, so a fresh session picks up where the last one left
off. `os-code/DECISIONS.md` records one line per ambiguous call; skim it when a
design choice looks already settled.

## Standing reminder: gitOS and BYOM are parked, surface them until built

Two founder-requested features are captured as build-ready Opus 4.8 prompts in
`os-code/PROGRESS.md` under "Parked feature ideas":

- **gitOS** (decentralized, local-first Git hosting; the storage location is
  chosen per repo instead of centralized hosting), and
- **Bring Your Own Model (BYOM)** (a first-class "connect any model you
  control" capability; note it overlaps heavily with what OS Code already
  does, so the prompt is framed as an extension of the existing model layer).

Neither is built. Surface both at the start of any OS Code session, and
especially whenever the founder mentions "gitOS," "GitOS," "bring your own
model," or "BYOM," until each item's checkbox is checked off. These are live,
unfinished action items, not settled history. Each prompt is written to hand
straight to Opus 4.8.

## Em dash policy is TOTAL here (standing rule)

No em dash anywhere in tracked source, comments included, encoded spellings
too. Use a period, a comma, or a rewrite. `test/em-dash-policy.test.ts` in both
`os-code` and `app` enforces it and fails the build on any violation. This is
stricter than the Uki repos by design, because OS Code started under the rule.
