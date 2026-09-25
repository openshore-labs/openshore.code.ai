# Jump to latest, reviewed and rebuilt (Creative Studio, 2026-09-25)

Founder brief, from a screenshot of the first-open walk-through right after
tapping Get Harbor: "What's up with this little down arrow in the middle of the
screen? ... It's oddly placed. Have my creative studio redo that jump scroll
UI/UX." Same shape as the room redesigns: the read, the direction, what shipped.

## The read

1. **It sat in the middle of the text (a bug).** The transcript is its own
   scroll container, and the pill was `position: absolute` inside it, so it was
   placed against the top of the content and scrolled with it. Its
   `bottom: 14px` meant 14px above the foot of the _first_ screen, so once you
   scrolled it rode up into the paragraph you were reading. Fixed first in
   `ec698b4` with a zero-height sticky dock; this redesign builds on that dock.
2. **It was the loudest thing on the screen.** A solid ink disc with a text
   arrow (`↓`), dead center, over the reading column. It is a way back, not a
   call to action, yet it outweighed the Get Harbor button it covered.
3. **It showed up too early.** It appeared 240px off the foot, which on a phone
   is two lines of a long guide reply. Reading a reply a paragraph at a time is
   not being lost.
4. **Nothing said "there is more below"** until the pill appeared, and when it
   did, it sat on top of a half-cut line of text.

## The direction

Quiet, docked, and honest about what is below.

- **Place:** the right edge of the reading column, just above the composer,
  over the send button. The center line stays the reader's. On a wide window it
  follows the 760px column, never out at the glass.
- **Shape:** a 40px raised paper disc with a hairline and a soft lift, the
  composer card's family, and the shared `Icon` chevron in place of a text
  arrow. `ink-soft` at rest.
- **News:** when a reply lands while you are reading up, the chip opens into a
  labelled pill, "New reply" (or "3 new"), in full ink. That is the one time it
  asks for a look.
- **The foot veil:** while you are scrolled up, the transcript dissolves into
  the paper just above the composer, the way water goes clear in the shallows.
  It hints "more below" and gives the chip a calm surface to sit on.
- **When:** half a screen off the foot, never less than 240px.
- **Motion and feel:** the chip rises 8px from 0.92 scale on `--ease-arrive`
  over `--dur-5` and leaves the same way on `--ease-accel` over `--dur-3`; the
  veil fades with it. A light tick (`hapticTick`) on tap. The scroll home is
  smooth, and instant under reduced motion.
- **Words:** the accessible name is always a sentence ("Jump to latest", or "A
  new reply below. Jump to latest.").

## What shipped

`app/src/components/MessageList.tsx` (the dock, chip, veil, threshold, haptic,
reduced-motion scroll) and `app/src/theme.css` (`.jump-dock`, `.jump-veil`,
`.jump-rail`, `.jump-chip`, retiring `.scroll-pill`). Tokens only; transform
and opacity only; everything that animates in animates out. App gates green.
