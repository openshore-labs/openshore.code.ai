# Slack Water, the break, and "help me get set up" (Creative Studio, 2026-10-01)

Founder brief: after "If you'd rather just chat, say so", stop for a break with
two buttons, one to the main chat page with the greeting and one that carries
on with setup. Choosing chat says something like "when you want to get started
with setup, I can help guide you anytime, just ask me in any chat", then takes
the person to the chat page in "a delightful one-time transition that acts like
a splash or water ripple". And anytime someone says "help me get set up", check
what is already set up and give them a list of buttons for what is not, then
walk them through it. "Get my creative studio involved." Same shape as the room
redesigns: the read, the direction, what shipped.

## The read

A hard cut here would feel like a dismissal. The guide has just written its
first letter to a new person; they answer "just chat", and the page vanishes
mid-thought. Choosing to chat is a release, not a refusal: setup stops
pulling, the water goes still, and the room they will actually live in arrives
underneath. Nothing is lost (the guide's chat stays in the drawer, and setup is
one phrase away), so the moment stays quiet and paper-coloured, ripples out
from their own touch, has no bounce and no spend colours, and plays once.

The name: **Slack Water**, the still moment at the turn of the tide, when the
current stops pulling either way.

## The direction

- **Origin:** the centre of the "Just chat" button they tapped; typed ("I'd
  rather just chat") rises from just above the composer. The rings reach the
  farthest corner, `R = hypot(max(x, vw - x), max(y, vh - y)) + 2px`.
- **Layers:** one fixed overlay at z-index 78 (over the header, composer and
  waterline; under the currents' arrival and the toast). A dimple (a 56px
  soft pool of the water's light, no edge); a paper disc (`--bg` solid to 85
  percent, then a meniscus: a bright leading highlight of `--bg-raised` with
  the wet shadow of `--current-4` behind it, a gradient, never a blur), sized
  so its solid core covers the corner at full scale; and three 1.5px crests
  (`--current-3`, then `--current-4` twice) drawn at their final size and
  scaled up from small, each a lit edge with a soft shadow on both faces,
  not a line.
- **Beats** (the second pass, 2026-10-01, judged as an animator would: it
  needed anticipation, crests that lose energy, a meniscus, no pop, overlap
  into the ending, and a slower lift): after the guide's line inks, the
  reading pause (`READ_PAUSE_MS`, 3s). Then the surface dips where the finger
  was and lets go (`--dur-6`, `--ease-standard`). Crest a leaves at
  `--dur-2`, 1.4s on `--ease-arrive`, bright early (0.6 at 10 percent) with a
  long tail. The paper wells up behind it at `--dur-4`, 1.1s on
  `--ease-glide`, there from its first frame and simply growing. Crest b at
  `--dur-4` twice, 1.6s, peak 0.38; crest c at `--dur-6` twice, 1.8s, peak
  0.22, each slower and fainter than the last. On the disc's `animationend`
  (a 1.5s backstop) the main chat page goes in underneath with one
  `hapticTick`, the paper holds still `--dur-3`, then lifts like fog over 1s
  on `--ease-glide` while crest c is still crossing it. The greeting waits
  unseen under the paper and lands as the lift begins: the mark on
  `greet-in`, the line on its landing swell.
- **Taps:** the overlay takes taps while it rises, so the chat being covered
  cannot take one, and lets them through while it clears.
- **Reduced motion:** no overlay and no haptic; the same reading pause, then
  the greeting simply lands.
- **Avoid:** the currents' bloom and ring, amber, plum (they already mean "a
  current turned on", spend, "needs you"); a cut, a slide, a spring, splash
  droplets, a "Setup paused" toast; filter blurs; swapping on a guessed
  timeout before the screen is covered.

## The copy

- **The break's buttons:** one row, equal widths. **Just chat** first and full
  size (ghost), so skipping setup is never small; **Start setup** filled, since
  it answers the question the intro asked.
- **The chat-later line:** "Sounds good. Whenever you want to get set up, I can
  guide you through it. Just say "help me get set up" in any chat." It teaches
  the phrase that brings the list back.
- **The list:** "Happy to. Already set up: {done}. Pick what's next and I'll
  walk you through it." With nothing done: "Happy to. Nothing is set up yet,
  and none of it is required. Pick a place to start and I'll walk you through
  it." Everything done: "You're all set: {done}. Nothing is left to connect, so
  ask me anything." Everything left was skipped: "The rest can wait. Say "help
  me get set up" any time and I'll show you what's left."
- **When the list comes back** (the lead stands alone above the buttons): the
  step's own done line, or "No problem, that one can wait.", then "Here's
  what's left."
- **A repository waiting on the computer (phone):** "A repository comes after
  your computer, since that's where OpenShore works on your code."

## What shipped

- The break: `START_CHOICES`, `SETUP_LATER_LINE`, `startSetupMessage` and the
  `startChoice` state in `app/src/lib/guidedSetup.ts`; `chooseStart` in the
  store; `app/src/components/StartChoiceActions.tsx`. The opening is now the
  intro alone; step one waits for Start setup. Typed answers work too ("I'd
  rather just chat", "skip", "let's set up", "next"). "Pick up setup" after
  choosing chat opens the list.
- Slack Water: `app/src/lib/slackWater.ts` (geometry, backstops),
  `app/src/components/SlackWater.tsx`, `.slack-water` in `app/src/theme.css`,
  the held greeting and owed landing swell in `ChatScreen.tsx`, and
  `.greeting .brand-mark` now gets the `greet-in` entrance it was missing. The
  store's `carryToGreeting` raises it only if the person is still in the walk's
  chat and has not sent anything since the line.
- "Help me get set up": `setupHelpIntent`, `menuSteps`, `setupMenuMessage` and
  `menuStepIntro` in `guidedSetup.ts`; the store moves the walk to the chat it
  was asked in (a new chat whose first words ask for it too, with nothing sent
  to a model), shows the list, walks a picked step, and brings the list back
  when it lands or is skipped. `app/src/components/SetupMenuActions.tsx` reads
  the offer live. The desktop offers the repository and the API key.
- Guards: `app/test/setupMenu.test.ts`, with `guidedSetup.test.ts` and
  `introWalk.test.ts` updated for the break.

Not built from the memo: the break's buttons leaving with a fade before the
line inks (they unmount on the choice, the same as the fork after Harbor's),
and a tap on the transcript starting the water early. Not yet seen on a phone.
