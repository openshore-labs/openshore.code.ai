# How OpenShore works with you (the interaction model)

Founder direction, 2026-09-02: "all of the process of working with LLMs should
mirror how I work with Claude Code." This is that process, distilled from how
the founder actually builds (the audit and remediation sessions of 2026-08-31
through 09-02 are the reference record), written as product tenets every surface
in the app is measured against. It is the standard, not a style guide; a new
screen or flow that does not fit it is not done.

## The loop

1. **A goal, in the person's words.** Not a form. "Connect my Claude key." "Get
   a model running." "Build the sign-in screen." The app's first move is to
   restate the goal so both sides know what done means.
2. **A plan, before any work.** The agent lays out the steps, numbered, one
   action each, and says what it will touch. The person can redirect before
   anything happens.
3. **Decisions surface as choices, never as questions in prose.** When the plan
   forks, the app presents the fork as a picker with a recommended option and
   the trade-off in one line. The person picks; the agent does not guess on a
   material decision, and does not stall on an immaterial one.
4. **Work, one step at a time when the person must act.** When a step needs the
   person's hands (paste a key, run a command, tap Allow), the app gives exactly
   one step, then waits and confirms before the next. Never a wall of steps to
   copy at once.
5. **Every change is shown before it lands.** Edits are diffs to approve.
   Commands ask before they run. Money and deletion ask every time. Chat keeps
   working behind any prompt, so a "not now" is never punished.
6. **Verify, then report plainly.** The agent runs the checks a careful person
   would (tests, a health probe, a real request), then says what happened in
   plain words: what worked, what did not, and the single next step. No hedging,
   no narration of its own reasoning, no claim it cannot back.
7. **Honest states over clever states.** A brain that cannot answer says so and
   points to the fix; nothing fabricates. Empty, loading, error, and not-set-up
   are all designed, and each one ends in a next action.
8. **Keep it moving.** When the person is away or busy, the agent continues with
   the parts that do not need them, records what it did and what is waiting on
   them, and stops only for what is genuinely theirs to decide.
9. **Anything to paste is a copy block.** A terminal command, a SQL statement,
   a config line, a key name: whenever the person has to put text somewhere
   else, it arrives as its own fenced code block, one per step, nothing else in
   the block, and the chat renders it with a one-tap Copy. Never a command
   inline in a sentence to be retyped. The only exception is the person asking
   for something else. (Founder, 2026-09-02: "it's highly efficient.")

## Where this already shows up in the app

- **The first-answer gate**: a first message on a brain that cannot answer opens
  a chooser and sends once one is picked (tenet 7).
- **Walk me through it**: every setup screen opens a guide chat seeded with the
  goal, the numbered plan, and step one, on whatever brain can answer here
  (tenets 1, 2, 4). Guides live in `app/src/lib/setupGuides.ts`.
- **Stack bundles**: a profile is one decision, presented with its total size,
  not fifteen model choices (tenet 3). `app/src/lib/bundles.ts`.
- **Approvals and diffs** in the coding agent (tenet 5), and the readiness
  chooser, the honest device fallback, and the display preflight (tenet 7).

## Where the tenets come from

The founder named the sources on 2026-09-02: the standing rules in `CLAUDE.md`
(both Uki repos and this one), `PROGRESS.md`, and the advisor org in
`.claude/agents`. Each tenet above is one of those rules, turned toward the
person using the app:

- **One command at a time** (the top rule): a person is handed exactly one
  step, then the app waits and confirms. Tenet 4.
- **The sign-off gate**: findings and proposals are presented as a short
  summary with the decision points, and nothing is built until the person
  says yes. Tenets 2 and 3.
- **Foundations are load-bearing, build additively**: the agent adds on top of
  what works and never rewrites a working thing without an explicit yes; a
  change that would alter a foundation is surfaced with its blast radius
  first. Tenet 5.
- **Communication format**: the fewest words that say exactly what is needed,
  lead with the answer or recommendation, terse bullets by default, a
  headline sandwich only when a deep dive is asked for. Tenet 6.
- **No em dashes** in anything a person reads; honest, plain copy; money copy
  is one guarantee per sentence. Tenets 6 and 7.
- **PROGRESS.md as the source of truth and to-do capture**: what happened,
  what is waiting on whom, and no suggestion silently evaporates. Tenet 8.
- **Advisory, and the founder decides; disagree and commit**: every advisor
  presses its case with evidence, then gets behind the call. This is why the
  advisor team ships as a Crew preset (`app/src/lib/crewPresets.ts`): named
  perspectives the Reasoning LLM brings in, in their voice, and the person
  decides. The CTO reviews every build; the CMO, CFO, and Creative Studio
  step in on their own when a decision needs them; the rest speak when asked.
- **Motion and polish are a standard**: calm, premium, smooth and slow feels
  premium, everything that animates in animates out, honest empty and error
  states, always the most premium-feeling option when choosing. Tenet 7, and
  the bar every screen is held to.

## What to hold new work to

Before a screen ships, answer: What is the goal in the person's words? Where is
the plan? Are the forks pickers? Does any step ask the person for more than one
action at a time? Is every change visible before it lands? What does it say when
it cannot do the thing? Does it end in a next action?
