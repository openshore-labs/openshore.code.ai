import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GREETINGS } from '../src/lib/greeting.js';
import {
  DEFAULT_GREETING_STYLE,
  GREETING_STYLES,
  buildDeck,
  dealCards,
  greetingStyleOf,
  loadDeck,
  luckyNumbers,
  peekDeck,
  revealHoldMs,
  type DeckStyle,
} from '../src/lib/greetingDecks.js';
import jokes from '../src/lib/decks/jokes.json';
import trivia from '../src/lib/decks/trivia.json';
import sports from '../src/lib/decks/sports.json';
import crossword from '../src/lib/decks/crossword.json';
import words from '../src/lib/decks/words.json';
import fortunes from '../src/lib/decks/fortunes.json';
import triviaMeta from './fixtures/deck-meta-trivia.json';
import sportsMeta from './fixtures/deck-meta-sports.json';

// The em dash and its encoded spellings, assembled from pieces so this file
// never holds one itself. The en dash is held out of the decks too.
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const NO_DASH = new RegExp(
  [EM_DASH, EN_DASH, '&' + 'mdash;', '&#x' + '2014;', '&#' + '8212;'].join('|'),
);

const PAIRS = { jokes, trivia, sports, crossword, words } as unknown as Record<
  Exclude<DeckStyle, 'fortunes'>,
  [string, string][]
>;
const FORTUNES = fortunes as unknown as string[];

// What the founder asked for, per deck.
const SIZES: Record<DeckStyle, number> = {
  jokes: 2000,
  trivia: 2000,
  sports: 2000,
  crossword: 2000,
  words: 5000,
  fortunes: 2000,
};

const DECK_STYLES = Object.keys(SIZES) as DeckStyle[];

// Folded for duplicate checks: case, curly quotes, and punctuation aside.
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('greeting styles', () => {
  it('offers languages first, as the default, then every deck', () => {
    expect(GREETING_STYLES.map((s) => s.id)).toEqual([
      'languages',
      'jokes',
      'trivia',
      'sports',
      'crossword',
      'words',
      'fortunes',
    ]);
    expect(DEFAULT_GREETING_STYLE).toBe('languages');
  });

  it('reads an unknown or missing stored value back as languages', () => {
    expect(greetingStyleOf(undefined)).toBe('languages');
    expect(greetingStyleOf('limericks')).toBe('languages');
    expect(greetingStyleOf(3)).toBe('languages');
    for (const s of DECK_STYLES) expect(greetingStyleOf(s)).toBe(s);
  });

  it('says on every Settings row what a tap and a hold do', () => {
    for (const s of GREETING_STYLES) {
      expect(s.sub).toMatch(/^Tap /);
      expect(s.sub).toMatch(/Hold /);
    }
  });
});

describe('the decks', () => {
  it('ship at the size asked for', () => {
    for (const s of DECK_STYLES) {
      const n = s === 'fortunes' ? FORTUNES.length : PAIRS[s].length;
      expect(n, s).toBe(SIZES[s]);
    }
  });

  it('hold no duplicate prompt within a deck', () => {
    for (const s of DECK_STYLES) {
      const prompts = s === 'fortunes' ? FORTUNES : PAIRS[s].map(([p]) => p);
      const folded = prompts.map(fold);
      const dupes = folded.filter((p, i) => folded.indexOf(p) !== i);
      expect(dupes, s).toEqual([]);
    }
  });

  it('keep every line short enough for the splash, every reveal for the bubble', () => {
    for (const s of DECK_STYLES) {
      if (s === 'fortunes') {
        for (const f of FORTUNES) expect(f.length, f).toBeLessThanOrEqual(60);
        continue;
      }
      const maxLine = s === 'words' ? 18 : 60;
      const maxReveal = s === 'words' ? 70 : 48;
      for (const [p, a] of PAIRS[s]) {
        expect(p.length, p).toBeLessThanOrEqual(maxLine);
        expect(a.length, a).toBeLessThanOrEqual(maxReveal);
        expect(p.trim(), p).toBe(p);
        expect(a.trim().length, p).toBeGreaterThan(0);
      }
    }
  });

  it('never reuse a punchline: the same payoff with a new setup reads as a repeat', () => {
    const punches = PAIRS.jokes.map(([, a]) => fold(a));
    const dupes = punches.filter((p, i) => punches.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });

  it('ask a question on every joke, trivia, and sports card', () => {
    for (const s of ['jokes', 'trivia', 'sports'] as const) {
      for (const [p, a] of PAIRS[s]) {
        expect(p, s).toMatch(/\?$/);
        expect(a, s).toMatch(/[.!?]$/);
      }
    }
  });

  it('keep trivia and sports to facts that cannot go stale', () => {
    const drift =
      /\b(current|currently|reigning|as of|this year|last year|so far|to date|still|active|recent|recently|latest|nowadays|today|now)\b/i;
    // Results from 2023 on sit at the edge of what the writers reliably knew.
    const recent = /\b20(2[3-9]|[3-9]\d)\b/;
    for (const s of ['trivia', 'sports'] as const) {
      for (const [p, a] of PAIRS[s]) {
        expect(p, s).not.toMatch(drift);
        expect(a, s).not.toMatch(drift);
        expect(`${p} ${a}`, s).not.toMatch(recent);
      }
    }
  });

  it('print every crossword answer in capitals, matching its letter count', () => {
    const uses = new Map<string, number>();
    for (const [clue, answer] of PAIRS.crossword) {
      const m = clue.match(/\((\d+)\)$/);
      expect(m, clue).not.toBeNull();
      expect(answer).toMatch(/^[A-Z]{3,15}$/);
      expect(answer.length, clue).toBe(Number(m![1]));
      expect(clue.toUpperCase(), clue).not.toContain(answer);
      uses.set(answer, (uses.get(answer) ?? 0) + 1);
    }
    for (const [answer, n] of uses) expect(n, answer).toBeLessThanOrEqual(2);
  });

  it('give every word a plain definition that does not give the word away', () => {
    for (const [word, def] of PAIRS.words) {
      expect(word).toMatch(/^[a-z][a-z-]{2,17}$/);
      expect(def, word).toMatch(/^[A-Z].*\.$/);
      expect(def.toLowerCase(), word).not.toContain(word);
    }
  });

  it('end every fortune like a fortune', () => {
    for (const f of FORTUNES) expect(f).toMatch(/[.!]$/);
  });

  // Straight apostrophes and quotes, like every other line in the app, until a
  // sweep moves all visible copy to typographic ones (DECISIONS, 2026-10-07).
  it('use straight quotes, like the rest of the app, and no dash the policy bans', () => {
    const all = [...FORTUNES, ...Object.values(PAIRS).flatMap((d) => d.flat())];
    const curly = new RegExp('[' + String.fromCharCode(0x2018, 0x2019, 0x201c, 0x201d) + ']');
    for (const text of all) {
      expect(text).not.toMatch(NO_DASH);
      expect(text, text).not.toMatch(curly);
    }
    for (const s of GREETING_STYLES) {
      for (const text of [s.name, s.sub, s.landingReveal]) expect(text).not.toMatch(NO_DASH);
    }
  });

  // The DEI audit's floor, held so a later content pass cannot bring these back:
  // retired or slur names, ableist words, and gendered defaults.
  it('keep retired, ableist, and gendered-default words out of every deck', () => {
    const banned =
      /\b(eskimos?|redskins?|gyp(sy|sies|ped)|siamese twins|oriental|third world|chinese whispers|spirit animal|pow ?wow|squaw|savages?|primitive|crazy|insane|psycho|lame|retard(ed)?|crippled?|dumb|spaz|mankind|man-made|chairman|fireman|policeman)\b/i;
    const all = [...FORTUNES, ...Object.values(PAIRS).flatMap((d) => d.map((x) => x.join(' ')))];
    const hits = all.filter((text) => banned.test(text));
    expect(hits).toEqual([]);
  });
});

// The DEI audit's balance, held by test. Each trivia and sports card carries a
// fixture row: [region, person, check]. Region is US, CA, LA, EU, AF, ME, AS,
// OC, or GL; person is m, f, x (mixed), or n for trivia, and m, w, or n for
// sports; check says how its fact was confirmed (writer-web, audit-web, read).
// A card added or reworded must get its row, and the deck must stay balanced.
describe('balance', () => {
  const META = {
    trivia: triviaMeta as unknown as Record<string, [string, string, string]>,
    sports: sportsMeta as unknown as Record<string, [string, string, string]>,
  };

  it('tags every trivia and sports card, and nothing else', () => {
    for (const s of ['trivia', 'sports'] as const) {
      const prompts = PAIRS[s].map(([p]) => p);
      expect(
        prompts.filter((p) => !META[s][p]),
        s,
      ).toEqual([]);
      expect(Object.keys(META[s]).length, s).toBe(prompts.length);
    }
  });

  it('keeps trivia about women level with trivia about men, and the US near a tenth', () => {
    const rows = Object.values(META.trivia);
    const women = rows.filter(([, p]) => p === 'f').length;
    const men = rows.filter(([, p]) => p === 'm').length;
    expect(women).toBeGreaterThanOrEqual(Math.floor(men * 0.9));
    expect(rows.filter(([r]) => r === 'US').length).toBeLessThanOrEqual(240);
  });

  it('gives sport played by women at least 30% of the almanac, and the US at most 30%', () => {
    const rows = Object.values(META.sports);
    expect(rows.filter(([, p]) => p === 'w').length).toBeGreaterThanOrEqual(600);
    expect(rows.filter(([r]) => r === 'US').length).toBeLessThanOrEqual(600);
  });

  it('leaves team names drawn from Native peoples out of the almanac', () => {
    const mascot = /\b(Braves|Chiefs|Blackhawks|Black Hawks|Seminoles|Redskins|Indians)\b/;
    expect(PAIRS.sports.filter((x) => mascot.test(x.join(' ')))).toEqual([]);
  });
});

describe('dealing', () => {
  const now = new Date(2026, 8, 23, 9, 0); // a Wednesday morning: no day flavor

  it('leads every deck with the time-of-day landing line', () => {
    for (const s of GREETING_STYLES) {
      const deck = buildDeck(s.id, undefined, seqRng([0.5]), now);
      expect(deck[0].code).toBe('en');
      expect(deck[0].riddle).toBeFalsy();
      expect(deck[0].reveal).toBe(s.landingReveal);
    }
  });

  it('keeps the languages deck: every language once, its name as the reveal', () => {
    const deck = buildDeck('languages', undefined, Math.random, now);
    expect(deck).toHaveLength(GREETINGS.length + 1);
    expect(deck[0].reveal).toBe('English');
    const rest = deck.slice(1);
    expect(new Set(rest.map((c) => c.code))).toEqual(new Set(GREETINGS.map((g) => g.code)));
    for (const c of rest) {
      const g = GREETINGS.find((x) => x.code === c.code)!;
      expect(c).toEqual({ code: g.code, line: g.native, label: g.english, reveal: g.lang });
    }
  });

  it('lands on the greeting alone until a deck has loaded', () => {
    expect(buildDeck('jokes', undefined, Math.random, now)).toHaveLength(1);
  });

  it('deals every card once, the answer behind the hold', () => {
    for (const s of ['jokes', 'trivia', 'sports', 'crossword', 'words'] as const) {
      const deck = buildDeck(s, PAIRS[s], Math.random, now);
      expect(deck).toHaveLength(PAIRS[s].length + 1);
      const answers = new Map(PAIRS[s].map(([p, a]) => [p, a]));
      for (const c of deck.slice(1)) {
        expect(answers.get(c.line), c.line).toBe(c.reveal);
        expect(c.label).toBe(c.line);
        expect(c.code).toBe('en');
        // A word keeps the display size; a sentence steps down.
        expect(c.riddle).toBe(s !== 'words');
      }
    }
  });

  it('cracks a fortune with six lucky numbers from 1 to 49', () => {
    const cards = dealCards('fortunes', ['You will read this and smile.'], Math.random);
    expect(cards[0].line).toBe('You will read this and smile.');
    expect(cards[0].reveal).toMatch(/^Lucky numbers \d+(, \d+){5}$/);
    for (let i = 0; i < 50; i++) {
      const nums = luckyNumbers();
      expect(nums).toHaveLength(6);
      expect(new Set(nums).size).toBe(6);
      expect(nums).toEqual([...nums].sort((a, b) => a - b));
      for (const n of nums) expect(n >= 1 && n <= 49).toBe(true);
    }
  });

  it('shuffles, so two launches rarely deal the same order', () => {
    const a = dealCards('jokes', PAIRS.jokes, seqRng([0.1, 0.7, 0.3, 0.9, 0.5])).map((c) => c.line);
    const b = dealCards('jokes', PAIRS.jokes, seqRng([0.8, 0.2, 0.6, 0.4, 0.05])).map(
      (c) => c.line,
    );
    expect(a).not.toEqual(b);
  });

  it('loads each deck once, and peeks it after', async () => {
    expect(peekDeck('trivia')).toBeUndefined();
    const [first, second] = await Promise.all([loadDeck('trivia'), loadDeck('trivia')]);
    expect(first).toBe(second);
    expect(peekDeck('trivia')).toBe(first);
    expect(peekDeck('languages')).toBeUndefined();
  });
});

describe('revealHoldMs', () => {
  it('holds a language name as long as it always has, and a punchline longer', () => {
    expect(revealHoldMs('French')).toBe(1400);
    expect(revealHoldMs('It was outstanding in its field.')).toBeGreaterThan(1400);
  });

  it('caps the hold so the bubble never lingers', () => {
    expect(revealHoldMs('x'.repeat(400))).toBe(4200);
  });
});

describe('wiring', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

  it('the chat splash deals from the Settings pick, and deals a lazy deck when it lands', () => {
    const chat = src('screens/ChatScreen.tsx');
    expect(chat).toMatch(/greetingStyleOf\(settings\.greetingStyle\)/);
    expect(chat).toMatch(/buildDeck\(greetingStyle\)/);
    expect(chat).toMatch(/loadDeck\(greetingStyle\)/);
    expect(chat).toMatch(/\{greeting\.reveal\}/);
  });

  it('keeps every deck out of the first load (dynamic imports only)', () => {
    const lib = src('lib/greetingDecks.ts');
    for (const s of DECK_STYLES) expect(lib).toContain(`import('./decks/${s}.json')`);
    expect(lib).not.toMatch(/^import .*decks\//m);
  });

  it('Settings offers every style', () => {
    const settings = src('screens/SettingsScreen.tsx');
    expect(settings).toMatch(/GREETING_STYLES\.map/);
    expect(settings).toMatch(/saveSettings\(\{ greetingStyle: style\.id \}\)/);
  });
});
