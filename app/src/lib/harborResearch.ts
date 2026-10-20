// Harbor's research eval: how well it answers a question in chat with the
// web in reach (DuckDuckGo by default). Scored by rule like the Harbor eval,
// never by a judge model, on four things:
//
//   - the answer: the facts the search results hold, and nothing they rule out;
//   - the search: it searches when the question needs the web (current or
//     uncertain facts), and not for what it plainly knows;
//   - the query: it names what the question is about;
//   - the citation: it cites a link the results gave.
//
// The search runs the way the phone's does (drivers/searchTurn.ts): one search
// per message, the results handed back as a turn for an answer pass whose
// prompt says it already searched. Live results change by the day, so each
// case carries the results DuckDuckGo gave on the day the case was written
// (scripts/harbor-research/results.json); a live pass checks them against
// the web. Pure: the model and the search are injected (scripts/harbor-research.ts).
import { SEARCHED_NOTE, SEARCH_PROTOCOL_NOTE, parseSearchLine } from 'os-code/protocol';
import { shownText, type HarborComplete, type HarborReply } from './harborEval.js';
import { buildHarborSystemPrompt, harborSearchesByDefault } from './harbor.js';

export { harborSearchesByDefault };
import { formatSearchResults, type WebSearchResult } from './webSearch.js';

export interface ResearchCase {
  id: string;
  question: string;
  /** true: the answer needs the web; false: Harbor plainly knows it. */
  needsSearch: boolean;
  /** Written after the levers, from questions nobody tuned on (2026-10-19). */
  heldOut?: boolean;
  /** Any-of groups the search query must touch (case-insensitive). */
  query?: string[][];
  /** Any-of groups the answer must hold (case-insensitive). */
  mustInclude?: string[][];
  /** What a grounded answer never says (an invented fact). */
  mustNot?: RegExp[];
}

const EM_DASH = String.fromCharCode(8212);

// The facts below are what the saved results say (results.json, gathered
// 2026-10-19 from the pages themselves; each case's `facts` names the result
// that states it). A question that needs the web is one a model trained
// before then cannot know; a known one it plainly can.
/** The ways an honest "the results do not say" is put. */
const HONEST = [
  'could not find',
  "couldn't find",
  'not find',
  'unable to find',
  'not able to find',
  'no information',
  'does not exist',
  "doesn't exist",
  'no package',
  'no results',
  'not appear to exist',
  'not seem to exist',
  'no record',
  'not show',
  'no npm package',
  'not listed',
  'no details',
  'not mention',
  'no mention',
  'not contain',
];

export const RESEARCH_CASES: ResearchCase[] = [
  {
    id: 'node-lts',
    question: 'What is the latest LTS version of Node.js right now?',
    needsSearch: true,
    query: [['node']],
    mustInclude: [['24.22', 'krypton', 'node 24', 'node.js 24', 'v24']],
  },
  {
    id: 'python-latest',
    question: "What's the newest stable version of Python?",
    needsSearch: true,
    query: [['python']],
    mustInclude: [['3.15']],
  },
  {
    id: 'world-cup-2026',
    question: 'Who won the 2026 FIFA World Cup?',
    needsSearch: true,
    query: [['world cup']],
    mustInclude: [['spain']],
    mustNot: [/\bArgentina (won|are the champions|were crowned)/i],
  },
  {
    id: 'intel-ceo',
    question: 'Who is the CEO of Intel now?',
    needsSearch: true,
    query: [['intel']],
    mustInclude: [['lip-bu tan', 'lip bu tan']],
    mustNot: [/Gelsinger is (the )?(current )?CEO/i],
  },
  {
    id: 'ios-latest',
    question: 'What is the latest version of iOS?',
    needsSearch: true,
    query: [['ios']],
    mustInclude: [['ios 27', '27.0']],
  },
  {
    id: 'typescript-latest',
    question: 'What is the latest version of TypeScript?',
    needsSearch: true,
    query: [['typescript']],
    mustInclude: [['7.0']],
  },
  {
    id: 'rust-latest',
    question: "What's the latest stable Rust version?",
    needsSearch: true,
    query: [['rust']],
    mustInclude: [['1.99']],
  },
  {
    id: 'vite-latest',
    question: 'What is the current major version of Vite?',
    needsSearch: true,
    query: [['vite']],
    mustInclude: [['vite 8', 'vite@8', '8.3', 'version 8']],
  },
  {
    // The package does not exist; the results are about other packages.
    id: 'fake-package',
    question: "What's the latest version of the npm package harbor-zq-frobnicate?",
    needsSearch: true,
    query: [['frobnicate']],
    mustInclude: [HONEST],
    mustNot: [/harbor-zq-frobnicate[^\n.]{0,60}\b\d+\.\d+\.\d+/i],
  },
  {
    id: 'http-404',
    question: 'What does HTTP status 404 mean?',
    needsSearch: false,
    mustInclude: [['not found', 'cannot find', "can't find", 'could not find', 'does not exist']],
  },
  {
    id: 'closure',
    question: 'Explain what a JavaScript closure is in two sentences.',
    needsSearch: false,
    mustInclude: [['lexical', 'surrounding', 'outer', 'enclosing', 'scope'], ['function']],
  },
  // Held out (2026-10-19): written after the search levers, by a separate pass,
  // to see whether a lever holds on questions it was not tuned on.
  {
    id: 'android-newest-stable',
    question: 'Which Android version is the newest stable release right now?',
    needsSearch: true,
    heldOut: true,
    query: [['android']],
    mustInclude: [['android 17']],
  },
  {
    id: 'ubuntu-newest-release',
    question: "What's the newest Ubuntu release, and what's it called?",
    needsSearch: true,
    heldOut: true,
    query: [['ubuntu']],
    mustInclude: [['26.10']],
  },
  {
    id: 'disney-ceo-now',
    question: "Who's running Disney these days?",
    needsSearch: true,
    heldOut: true,
    query: [['disney']],
    mustInclude: [["d'amaro", 'd’amaro', 'damaro']],
  },
  {
    id: 'apple-tim-cook-still-ceo',
    question: 'Is Tim Cook still the CEO of Apple?',
    needsSearch: true,
    heldOut: true,
    query: [['apple', 'cook']],
    mustInclude: [['ternus']],
  },
  {
    id: 'most-recent-super-bowl',
    question: 'Who won the most recent Super Bowl, and what was the score?',
    needsSearch: true,
    heldOut: true,
    query: [['super bowl']],
    mustInclude: [['seahawks', 'seattle']],
  },
  {
    id: 'milan-cortina-medal-table',
    question: 'Which country topped the medal table at the Milan Cortina Winter Olympics?',
    needsSearch: true,
    heldOut: true,
    query: [['milan', 'cortina', 'olympic']],
    mustInclude: [['norway']],
  },
  {
    id: 'us-stamp-price-now',
    question: 'How much does it cost to mail a regular letter in the US right now?',
    needsSearch: true,
    heldOut: true,
    query: [['stamp', 'letter', 'postage', 'mail']],
    mustInclude: [['82 cents', '82¢', '82 ¢', '$0.82', '0.82']],
  },
  {
    id: 'us-mint-still-making-pennies',
    question: 'Does the US Mint still make pennies?',
    needsSearch: true,
    heldOut: true,
    query: [['penny', 'pennies', 'cent']],
    mustInclude: [['stopped', 'no longer', 'ended', 'halted', 'ceased', 'discontinued']],
  },
  {
    // A made-up product; one result is a spec sheet for a different ring.
    id: 'lumora-halo-x2-battery',
    question: "What's the battery life of the Lumora Halo X2 smart ring?",
    needsSearch: true,
    heldOut: true,
    query: [['lumora', 'halo']],
    mustInclude: [HONEST],
    mustNot: [/Lumora Halo X2[^.\n]{0,80}\b\d+\s*(-|to)?\s*\d*\s*(days|hours)/i],
  },
  {
    // Not played yet: it runs October 1 to November 13, 2027.
    id: 'rugby-world-cup-2027-winner',
    question: 'Who won the 2027 Rugby World Cup final?',
    needsSearch: true,
    heldOut: true,
    query: [['rugby']],
    mustInclude: [
      [
        ...HONEST,
        'not been played',
        'not yet',
        'yet to',
        "hasn't",
        'has not',
        'will be played',
        'will take place',
        'takes place',
        'scheduled',
        'upcoming',
        'not happened',
      ],
    ],
    mustNot: [
      /\b(New Zealand|South Africa|Ireland|France|England|Australia|Argentina|Scotland|Wales|Fiji|Japan) (won|beat|are the champions|claimed|lifted)/i,
    ],
  },
  {
    id: 'check-git-version',
    question: 'How do I check which version of Git is installed on my machine?',
    needsSearch: false,
    heldOut: true,
    mustInclude: [['git --version', 'git version']],
  },
  {
    id: 'docker-latest-tag-meaning',
    question: 'Does the latest tag on a Docker image always mean the newest version?',
    needsSearch: false,
    heldOut: true,
    mustInclude: [['default'], ['no', 'not']],
  },
];

export interface ResearchHalf {
  /** The answer's share of its checks met (facts, nothing forbidden, no em dash). */
  score: number;
  misses: string[];
  searched: boolean;
  query?: string;
  /** The query touched every group the case names. */
  queryOk?: boolean;
  /** The answer cites a link the results gave. */
  cited?: boolean;
  seconds: number;
  answer: string;
  replies: HarborReply[];
}

export interface ResearchRun {
  id: string;
  needsSearch: boolean;
  withHarness: ResearchHalf;
  without: ResearchHalf;
}

/** Score an answer right or wrong, as a code answer is: every fact group
 *  met and nothing forbidden said, or it scores nothing; a right answer with
 *  an em dash keeps three quarters. (A share of checks gave a confidently
 *  wrong answer two thirds, seen on the box 2026-10-19.) */
export function scoreResearchAnswer(c: ResearchCase, answer: string): { score: number; misses: string[] } {
  const text = shownText(answer);
  if (!text) return { score: 0, misses: ['empty'] };
  const lower = text.toLowerCase();
  const misses: string[] = [];
  for (const group of c.mustInclude ?? []) {
    if (!group.some((g) => lower.includes(g.toLowerCase()))) misses.push(`missing ${group.join('|')}`);
  }
  for (const re of c.mustNot ?? []) if (re.test(text)) misses.push(`said ${re.source}`);
  if (misses.length) return { score: 0, misses };
  if (text.includes(EM_DASH)) return { score: 0.75, misses: ['em dash'] };
  return { score: 1, misses: [] };
}

/** A question about something current: the latest or newest of a thing, who
 *  holds a post or won now, news, prices, releases, a recent year. A lever
 *  under test: the harness searches for such a question before the model
 *  writes a word, the way Harbor Lite's guide harness does, instead of
 *  trusting a small model to ask. */
const CURRENT =
  /\b(latest|newest|current(ly)?|now|today|tonight|this (week|month|year)|recent(ly)?|news|price[sd]?|cost|release[sd]?|version|who (is|are|won)|won|winner|score|20[2-9]\d)\b/i;

export function harborNeedsWeb(question: string): boolean {
  return CURRENT.test(question);
}

/** A sharper search line for the model's own decision (a lever under test). */
export const SEARCH_WHEN_UNSURE_NOTE =
  'Search before you answer any question about a person, a company, a product, a price, a place, an event, a version, or anything else that may have changed since you were trained, even when you think you know. Answer from memory only what stays true, such as how code works, what a term means, or how to do something.';

/** A line for the answer pass after a search (a lever under test): a result
 *  about something with a similar name is not an answer (on the box, Harbor
 *  gave a made-up ring the battery life of a different ring in the results). */
export const EXACT_MATCH_NOTE =
  'Use a result only when it is about the exact thing the person asked about. A result about something with a similar name, or a different model or version, is not an answer: say what the results do cover, and that they do not answer the question.';

/** Levers under test, each off unless asked for. */
export interface ResearchLevers {
  /** Search first, with the question as the query: by the list of current
   *  words (harborNeedsWeb), or for every question about the world
   *  (harborSearchesByDefault). */
  searchFirst?: boolean | 'rule' | 'default';
  /** A sharper search line beside the protocol, for the model's own decision. */
  searchNote?: string;
  /** EXACT_MATCH_NOTE on the answer pass after a search. */
  exactMatch?: boolean;
}

function searchesFirst(question: string, levers: ResearchLevers): boolean {
  if (levers.searchFirst === 'default') return harborSearchesByDefault(question);
  return (levers.searchFirst === true || levers.searchFirst === 'rule') && harborNeedsWeb(question);
}

const touches = (text: string, groups: string[][] = []) =>
  groups.every((g) => g.some((w) => text.toLowerCase().includes(w.toLowerCase())));

/** One case's harness half, the phone's way: Harbor's prompt with the search
 *  line; if it asks, one search, then the answer pass with the results. */
export async function researchWithHarness(
  c: ResearchCase,
  complete: HarborComplete,
  search: (query: string, c: ResearchCase) => Promise<WebSearchResult[]>,
  levers: ResearchLevers = {},
): Promise<ResearchHalf> {
  const started = Date.now();
  const ask = { role: 'user' as const, content: c.question };
  const ruled = searchesFirst(c.question, levers);
  const first = ruled
    ? undefined
    : await complete({
        system: buildHarborSystemPrompt(
          true,
          levers.searchNote ? `${SEARCH_PROTOCOL_NOTE} ${levers.searchNote}` : SEARCH_PROTOCOL_NOTE,
          false,
        ),
        messages: [ask],
        harness: true,
      });
  const query = first ? parseSearchLine(shownText(first.text)) : c.question;
  if (!query) {
    const scored = scoreResearchAnswer(c, first?.text ?? '');
    return {
      ...scored,
      searched: false,
      seconds: (Date.now() - started) / 1000,
      answer: first?.text ?? '',
      replies: first ? [first] : [],
    };
  }
  let results: WebSearchResult[] = [];
  let resultText: string;
  try {
    results = await search(query, c);
    resultText = formatSearchResults(query, results);
  } catch (err) {
    resultText = `Search failed: ${err instanceof Error ? err.message : String(err)}. Answer from what you already know instead, and say you could not search.`;
  }
  const second = await complete({
    system: buildHarborSystemPrompt(
      false,
      levers.exactMatch ? `${SEARCHED_NOTE} ${EXACT_MATCH_NOTE}` : SEARCHED_NOTE,
      false,
    ),
    messages: [ask, { role: 'user', content: resultText }],
    harness: true,
  });
  const scored = scoreResearchAnswer(c, second.text);
  const shown = shownText(second.text);
  return {
    ...scored,
    searched: true,
    query,
    queryOk: touches(query, c.query),
    cited: results.some((r) => shown.includes(r.url) || shown.includes(new URL(r.url).hostname)),
    seconds: (Date.now() - started) / 1000,
    answer: second.text,
    replies: first ? [first, second] : [second],
  };
}

/** The bare half: the same question to a plain prompt with no web. */
export async function researchWithout(c: ResearchCase, complete: HarborComplete): Promise<ResearchHalf> {
  const started = Date.now();
  const reply = await complete({
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: c.question }],
    harness: false,
  });
  return {
    ...scoreResearchAnswer(c, reply.text),
    searched: false,
    seconds: (Date.now() - started) / 1000,
    answer: reply.text,
    replies: [reply],
  };
}

/** The result as one markdown table plus the search behavior lines. */
export function researchTable(model: string, runs: ResearchRun[], seconds: number): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const needs = runs.filter((r) => r.needsSearch);
  const knows = runs.filter((r) => !r.needsSearch);
  const row = (name: string, rs: ResearchRun[]) =>
    `| ${name} | ${rs.length} | ${pct(mean(rs.map((r) => r.withHarness.score)))} | ${pct(mean(rs.map((r) => r.without.score)))} |`;
  const searchedNeeds = needs.filter((r) => r.withHarness.searched);
  return [
    `Harbor research eval, ${model}, ${runs.length} cases, ${seconds}s.`,
    '',
    '| Questions | Cases | With the harness | Without |',
    '| --- | --- | --- | --- |',
    row('need the web', needs),
    row('known', knows),
    row('all', runs),
    '',
    `Searched when the question needed the web: ${searchedNeeds.length} of ${needs.length}.`,
    `Searched when it did not: ${knows.filter((r) => r.withHarness.searched).length} of ${knows.length}.`,
    `Query on topic: ${searchedNeeds.filter((r) => r.withHarness.queryOk).length} of ${searchedNeeds.length}; cited a result: ${searchedNeeds.filter((r) => r.withHarness.cited).length} of ${searchedNeeds.length}.`,
    `Seconds per question with the harness: ${mean(runs.map((r) => r.withHarness.seconds)).toFixed(0)} on average.`,
  ].join('\n');
}
