// The chat splash's Easter egg decks. The splash line always lands on the warm
// time-and-day greeting (lib/greeting.ts); what a tap and a hold do after that
// is the person's pick in Settings, Greeting:
//
//   Languages        tap: the same greeting in another language; hold: which one
//   Popsicle Jokes   tap: a corny joke;                          hold: the punchline
//   Trivia Night     tap: a trivia question;                     hold: the answer
//   Sports Almanac   tap: a sports question;                     hold: the answer
//   Sunday Crossword tap: a crossword clue;                      hold: the answer
//   Word of the Day  tap: a word worth knowing;                  hold: what it means
//   Fortune Cookie   tap: a fortune;                             hold: lucky numbers
//
// Every deck is shuffled fresh each time the empty state comes back, so the
// order differs on every launch. All local: no network, no account. The decks
// are thousands of lines, so each is its own JSON chunk (lib/decks/), loaded
// only once its style is picked; the languages ship inline, as the default.
// Lines stay short on purpose, since the splash line is a heading that must
// still read on a narrow phone. No em dashes, by policy.

import { GREETINGS, pickLanding, shuffle } from './greeting.js';

export type GreetingStyle =
  'languages' | 'jokes' | 'trivia' | 'sports' | 'crossword' | 'words' | 'fortunes';

export const DEFAULT_GREETING_STYLE: GreetingStyle = 'languages';

// One card on the splash line.
export interface SplashCard {
  // BCP47 code for the line, so a screen reader voices it in the right accent
  // and RTL scripts lay out correctly. Every non-language deck is English.
  code: string;
  // What the line shows.
  line: string;
  // The accessible label for the line (the English meaning of a native line).
  label: string;
  // What a long press reveals in the bubble: the language, the punchline, the
  // answer, the meaning, the lucky numbers.
  reveal: string;
  // A joke, a question, a clue, or a fortune: a whole sentence rather than a
  // greeting, so the splash sets it a step smaller to keep it to two lines on a
  // phone. A word of the day is one word and keeps the full size.
  riddle?: boolean;
}

export interface GreetingStyleInfo {
  id: GreetingStyle;
  // The name on the Settings row.
  name: string;
  // The Settings row's byline: what a tap and a hold do.
  sub: string;
  // What a hold on the landing line reveals, before the first tap: a nudge
  // toward the tap. The language deck keeps its own answer ('English').
  landingReveal: string;
}

export const GREETING_STYLES: readonly GreetingStyleInfo[] = [
  {
    id: 'languages',
    name: 'Languages',
    sub: 'Tap for a new language. Hold to see which one.',
    landingReveal: 'English',
  },
  {
    id: 'jokes',
    name: 'Popsicle Jokes',
    sub: 'Tap for a new joke. Hold for the punchline.',
    landingReveal: 'Tap for a joke',
  },
  {
    id: 'trivia',
    name: 'Trivia Night',
    sub: 'Tap for a trivia question. Hold for the answer.',
    landingReveal: 'Tap for a question',
  },
  {
    id: 'sports',
    name: 'Sports Almanac',
    sub: 'Tap for a sports question. Hold for the answer.',
    landingReveal: 'Tap for a question',
  },
  {
    id: 'crossword',
    name: 'Sunday Crossword',
    sub: 'Tap for a crossword clue. Hold for the answer.',
    landingReveal: 'Tap for a clue',
  },
  {
    id: 'words',
    name: 'Word of the Day',
    sub: 'Tap for a word worth knowing. Hold for what it means.',
    landingReveal: 'Tap for a word',
  },
  {
    id: 'fortunes',
    name: 'Fortune Cookie',
    sub: 'Tap to crack a fortune. Hold for your lucky numbers.',
    landingReveal: 'Tap for a fortune',
  },
];

// Read a stored value back as a style, so an unknown or missing value (an older
// build, a hand-edited file) falls back to the languages the splash always had.
export function greetingStyleOf(value: unknown): GreetingStyle {
  return GREETING_STYLES.some((s) => s.id === value)
    ? (value as GreetingStyle)
    : DEFAULT_GREETING_STYLE;
}

export function greetingStyleInfo(style: GreetingStyle): GreetingStyleInfo {
  return GREETING_STYLES.find((s) => s.id === style) ?? GREETING_STYLES[0];
}

// A deck as it ships: prompt-and-answer pairs, or bare lines for the fortunes
// (their lucky numbers are drawn fresh at deal time, like a real cookie).
export type DeckData = readonly (readonly string[])[] | readonly string[];

export type DeckStyle = Exclude<GreetingStyle, 'languages'>;

// Each deck is a lazy chunk. The literal import paths let the bundler split
// every deck into its own file, so the app's first load carries none of them.
const LOADERS: Record<DeckStyle, () => Promise<{ default: unknown }>> = {
  jokes: () => import('./decks/jokes.json'),
  trivia: () => import('./decks/trivia.json'),
  sports: () => import('./decks/sports.json'),
  crossword: () => import('./decks/crossword.json'),
  words: () => import('./decks/words.json'),
  fortunes: () => import('./decks/fortunes.json'),
};

const loaded = new Map<DeckStyle, DeckData>();
const loading = new Map<DeckStyle, Promise<DeckData>>();

// Fetch a deck once; later calls share the first load. A failed load is
// forgotten, so the next visit to the empty state tries again.
export function loadDeck(style: DeckStyle): Promise<DeckData> {
  const ready = loaded.get(style);
  if (ready) return Promise.resolve(ready);
  let pending = loading.get(style);
  if (!pending) {
    pending = LOADERS[style]().then(
      (mod) => {
        const data = mod.default as DeckData;
        loaded.set(style, data);
        loading.delete(style);
        return data;
      },
      (err: unknown) => {
        loading.delete(style);
        throw err;
      },
    );
    loading.set(style, pending);
  }
  return pending;
}

// The deck if it has already loaded, so a return to the empty state deals it at
// once rather than landing on the greeting alone for a beat.
export function peekDeck(style: GreetingStyle): DeckData | undefined {
  return style === 'languages' ? undefined : loaded.get(style);
}

// Six lucky numbers from 1 to 49, in order, the way a fortune cookie prints
// them. `rng` is injectable for tests.
export function luckyNumbers(rng: () => number = Math.random): number[] {
  const pool = Array.from({ length: 49 }, (_, i) => i + 1);
  return shuffle(pool, rng)
    .slice(0, 6)
    .sort((a, b) => a - b);
}

// Deal a loaded deck into splash cards, in a fresh shuffled order.
export function dealCards(
  style: DeckStyle,
  data: DeckData,
  rng: () => number = Math.random,
): SplashCard[] {
  if (style === 'fortunes') {
    return shuffle(data as readonly string[], rng).map((line) => ({
      code: 'en',
      line,
      label: line,
      reveal: `Lucky numbers ${luckyNumbers(rng).join(', ')}`,
      riddle: true,
    }));
  }
  return shuffle(data as readonly (readonly string[])[], rng).map(([line, reveal]) => ({
    code: 'en',
    line,
    label: line,
    reveal,
    riddle: style !== 'words',
  }));
}

// Build the tap-through deck for one turn on the empty state: the fresh
// time-and-day landing line first, then the chosen deck in a freshly shuffled
// order. Tapping walks this list and wraps back to the landing line at the end.
// A deck that has not loaded yet gives the landing line alone; the splash deals
// the rest when it arrives. `rng` and `now` are injectable for tests; they
// default to Math.random and the current moment.
export function buildDeck(
  style: GreetingStyle,
  data: DeckData | undefined = peekDeck(style),
  rng: () => number = Math.random,
  now: Date = new Date(),
): SplashCard[] {
  const landing = pickLanding(now, rng);
  const first: SplashCard = {
    code: landing.code,
    line: landing.native,
    label: landing.english,
    reveal: greetingStyleInfo(style).landingReveal,
  };
  if (style === 'languages') {
    return [
      first,
      ...shuffle(GREETINGS, rng).map((g) => ({
        code: g.code,
        line: g.native,
        label: g.english,
        reveal: g.lang,
      })),
    ];
  }
  return data ? [first, ...dealCards(style, data, rng)] : [first];
}

// How long the reveal bubble stays up. A language name reads at a glance; a
// punchline or an answer gets time to land, longer for a longer line, capped
// so the bubble never lingers over the composer.
export function revealHoldMs(reveal: string): number {
  return Math.min(4200, Math.max(1400, 900 + reveal.length * 55));
}
