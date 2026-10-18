# The flowing reveal: how a reply arrives

Proposal for the Creative Studio's review, built on branch
`claude/attach-any-file` (2026-10-18). It replaces the typing clock of
2026-09-03 and the light-start word fade of 2026-09-23.

## What the founder saw

A screen recording on the iPhone, a long reply from Harbor: "the text reveal
is super chunky. I'd rather have it be flowy with words appearing rather than
it feel like a single letter typed at fast speeds."

Frame by frame, the recording shows three seams:

1. **Race, then freeze.** Text came in bursts (about two seconds of tokens,
   then twelve seconds of nothing). The reveal ran on a fixed clock that
   cleared any backlog within 1.2 seconds, so each burst raced out and then
   the reply sat still through the pause. Stop and go reads as broken.
2. **The thread stepped.** Following the reply, the thread jumped up a whole
   line each time one appeared.
3. **The work grew with the reply.** Every 24ms the whole reply's markdown
   was parsed, highlighted and split into words again. On a long answer, on a
   phone also running the model, that alone can hold up painting.

## The pattern, and where it is proven

**A playout buffer.** Video players, voice calls and music streaming all
face the same problem: data arrives unevenly, and people must perceive it
evenly. They measure the arrival rate and play out at that rate from a small
buffer. Applied to words: the reveal measures how fast text is arriving (a
moving average over about 1.6 seconds) and plays words out at that rate. A
burst is carried smoothly across the pause that follows it, the edge never
stops while words are waiting, and it never trails the stream by more than a
few seconds. When the stream ends, what is left lands evenly within 1.2
seconds. A reading-pace floor (about seven words a second) keeps a slow model
from crawling.

**Whole words, each coming up out of a soft blur.** The same arrival the
leading chat apps use for streamed text: words appear whole, never half
typed, and each fades from nothing to full ink while the ones before it are
still settling. With several words mid-fade at once, the reply's edge reads as
one soft wave moving through the paragraph instead of a cursor. The fade rides
the house's own ink curve and clock (`--ease-ink` over `--dur-swell`, the
greeting's swell), so a reply arrives the way the first open's lines do. A
2px blur clears with the fade; it is paint only, never layout.

**A glide, not a step.** While the reader is pinned to the foot, the thread
follows the reply on a critically damped glide (time constant 110ms), so a
new line drifts into view. A finger or a wheel on the thread takes over at
once. A new turn still lands immediately.

**Bold that is bold from its first word.** While a reply is live, its last
block closes any bold, italic or code it has opened, so `**Step 1` reads bold
now instead of showing asterisks that later vanish (and making every word in
it fade again). A settled reply renders exactly what the model wrote.

**Work the size of a paragraph.** A live reply is cut into blocks at blank
lines (lists, fences and tables stay whole); finished blocks render once and
are never parsed again, so the cost of each frame stays the size of the
paragraph being written.

## Unchanged

A tap on the transcript still finishes every reveal at once (a reader is
never held to the pace). Reduced motion still shows text whole. There is
still no caret. A settled reply renders as plain text with no word spans.

## Where it lives

- Pace: `app/src/lib/streamSmoothing.ts` (`stepPace`, `wholeWordsUpTo`)
  and `app/src/hooks/useSmoothedReveal.ts`, on the display's frame clock.
- Blocks and live marks: `app/src/lib/markdownBlocks.ts`, rendered by
  `app/src/components/Markdown.tsx`.
- The word arrival: `.md-live .w` in `app/src/theme.css`.
- The glide: `glideStep` in `app/src/components/MessageList.tsx`.
- Guards: `app/test/streamSmoothing.test.ts` replays the recording's burst
  and pause and holds that every frame moves, with no stall and no leap.

## For the Studio to rule on

- The floor pace (`FLOOR_CPS`, 40 characters a second) and how long a burst
  may carry (`MAX_LAG_S`, 2 seconds).
- The blur (2px). It is the most noticeable choice; at 0 it is a pure fade.
- The anchored thread, a larger change held back on purpose: newer chat apps
  scroll the person's message to the top on send and let the reply grow into
  the space below without following it at all. It removes follow-scrolling
  altogether, but changes how every chat moves, so it is the Studio's call.
