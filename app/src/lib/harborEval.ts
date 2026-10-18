// The Harbor eval: the number Harbor's harness ships on (tenet 2). Harbor is a
// chat model on the phone, so this measures what a person asks it, scored by
// rule, never by a judge model:
//
//   - code: it writes a JavaScript function, and the function is run against
//     tests (a reply that reads well but does not run scores nothing);
//   - pictures: a screenshot, a chart, a form, a table and the frames of a clip,
//     each with an answer the picture alone holds (scripts/harbor-eval/);
//   - app: what the app does, grounded in the same facts the phone carries
//     (the guide eval's app questions);
//   - limits: it says what it cannot do (edit a repository, run a command,
//     see what is not in a picture) instead of pretending;
//   - everyday: a plain question gets a plain answer, with no word of the app.
//
// Every case runs twice, with Harbor's harness (its real system prompt,
// window, sampling and picture fitting) and without it (a bare prompt and the
// server's defaults), so the pair shows what the harness contributes. Pure:
// the model, the pictures and the code runner are injected
// (scripts/harbor-eval.ts runs it against Ollama on the reference box).
import { NO_SEARCH_NOTE } from 'os-code/protocol';
import { deviceMessages } from '../drivers/deviceModel.js';
import { GUIDE_EVAL_CASES } from './guideEval.js';
import { HARBOR_CONTEXT_TOKENS, buildHarborSystemPrompt } from './harbor.js';

export type HarborSection = 'code' | 'pictures' | 'app' | 'limits' | 'everyday';

export const HARBOR_SECTIONS: readonly HarborSection[] = [
  'code',
  'pictures',
  'app',
  'limits',
  'everyday',
];

export interface HarborEvalCase {
  id: string;
  section: HarborSection;
  message: string;
  /** Fixture names in scripts/harbor-eval (without .png), sent in order. */
  pictures?: string[];
  /** Each inner list is an any-of group, matched case-insensitively. */
  mustInclude?: string[][];
  /** Patterns the answer must match (for a short token such as a bar's label). */
  mustMatch?: RegExp[];
  /** Things a grounded answer never says for this case. */
  mustNot?: RegExp[];
  /** A code case: the function the answer must define, and the tests that
   *  call it (statements that throw on a failure; `await` is allowed). */
  code?: { fn: string; tests: string };
}

/** The most tokens a Harbor reply gets: the driver's cap for a model that
 *  searches (drivers/onDeviceDriver.ts), the room a phone reply really has. */
export const HARBOR_EVAL_REPLY_TOKENS = 768;

const CODE_CASES: HarborEvalCase[] = [
  {
    id: 'reverse-emoji',
    section: 'code',
    message:
      'Write a JavaScript function reverseString(s) that reverses a string and keeps emoji intact.',
    code: {
      fn: 'reverseString',
      tests: `
        if (reverseString('abc') !== 'cba') throw new Error('abc');
        if (reverseString('a🚢b') !== 'b🚢a') throw new Error('emoji');
        if (reverseString('') !== '') throw new Error('empty');`,
    },
  },
  {
    id: 'palindrome',
    section: 'code',
    message:
      'Write a JavaScript function isPalindrome(s) that ignores case, spaces and punctuation.',
    code: {
      fn: 'isPalindrome',
      tests: `
        if (isPalindrome('A man, a plan, a canal: Panama') !== true) throw new Error('panama');
        if (isPalindrome('Was it a car or a cat I saw?') !== true) throw new Error('cat');
        if (isPalindrome('harbor') !== false) throw new Error('harbor');`,
    },
  },
  {
    id: 'chunk',
    section: 'code',
    message:
      'Write a JavaScript function chunk(arr, size) that splits an array into arrays of that size; the last one holds whatever is left.',
    code: {
      fn: 'chunk',
      tests: `
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        if (!same(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])) throw new Error('5 by 2');
        if (!same(chunk([1, 2], 5), [[1, 2]])) throw new Error('short');
        if (!same(chunk([], 3), [])) throw new Error('empty');`,
    },
  },
  {
    id: 'parse-query',
    section: 'code',
    message:
      "Write a JavaScript function parseQuery(qs) that turns a URL query string like '?a=1&b=two%20words' into an object of decoded strings. A key that repeats becomes an array of its values.",
    code: {
      fn: 'parseQuery',
      tests: `
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        if (!same(parseQuery('?a=1&b=two%20words'), { a: '1', b: 'two words' })) throw new Error('basic');
        if (!same(parseQuery('x=1&x=2'), { x: ['1', '2'] })) throw new Error('repeat');`,
    },
  },
  {
    id: 'fix-sum',
    section: 'code',
    message: [
      'This should return the sum of an array, but it is wrong. Fix it and show the whole corrected function.',
      '```js',
      'function sum(arr) {',
      '  let total = 0;',
      '  for (let i = 1; i <= arr.length; i++) total += arr[i];',
      '  return total;',
      '}',
      '```',
    ].join('\n'),
    code: {
      fn: 'sum',
      tests: `
        if (sum([1, 2, 3]) !== 6) throw new Error('1 2 3');
        if (sum([]) !== 0) throw new Error('empty');
        if (sum([5]) !== 5) throw new Error('one');`,
    },
  },
  {
    id: 'group-by',
    section: 'code',
    message:
      'Write a JavaScript function groupBy(items, keyFn) that returns an object mapping each key to the array of items with that key, in their original order.',
    code: {
      fn: 'groupBy',
      tests: `
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const got = groupBy([1, 2, 3, 4, 5], (n) => (n % 2 ? 'odd' : 'even'));
        if (!same(got.odd, [1, 3, 5]) || !same(got.even, [2, 4])) throw new Error('parity');`,
    },
  },
  {
    id: 'camel-case',
    section: 'code',
    message:
      "Write a JavaScript function camelCase(s) that turns 'hello world-foo_bar' into 'helloWorldFooBar'.",
    code: {
      fn: 'camelCase',
      tests: `
        if (camelCase('hello world-foo_bar') !== 'helloWorldFooBar') throw new Error('mixed');
        if (camelCase('Already') !== 'already') throw new Error('one word');`,
    },
  },
  {
    id: 'retry',
    section: 'code',
    message:
      'Write a JavaScript async function retry(fn, times) that calls the async function fn until it resolves, at most times attempts in all, and rethrows the last error if every attempt fails.',
    code: {
      fn: 'retry',
      tests: `
        let calls = 0;
        const flaky = async () => { calls += 1; if (calls < 3) throw new Error('no'); return 'ok'; };
        if ((await retry(flaky, 5)) !== 'ok' || calls !== 3) throw new Error('succeeds on the third');
        let n = 0;
        const never = async () => { n += 1; throw new Error('last ' + n); };
        let caught;
        try { await retry(never, 2); } catch (e) { caught = e; }
        if (!caught || caught.message !== 'last 2' || n !== 2) throw new Error('gives up after two');`,
    },
  },
];

const PICTURE_CASES: HarborEvalCase[] = [
  {
    id: 'error-console',
    section: 'pictures',
    message: "What's wrong here, and where should I look?",
    pictures: ['error-console'],
    mustInclude: [['map'], ['undefined'], ['renderlist', 'line 42', '42:18', 'app.jsx']],
  },
  {
    id: 'buggy-sum',
    section: 'pictures',
    message: "What's the bug in this code?",
    pictures: ['buggy-sum'],
    mustInclude: [
      [
        '<=',
        'off-by-one',
        'off by one',
        'i = 1',
        'i=1',
        'index 0',
        'starts at 1',
        'first element',
        'out of bounds',
        'undefined',
      ],
    ],
  },
  {
    id: 'bar-chart',
    section: 'pictures',
    message: 'Which bar is tallest, and what is its value?',
    pictures: ['bar-chart'],
    mustMatch: [/\bB\b/, /\b7\b/],
  },
  {
    id: 'npm-enoent',
    section: 'pictures',
    message: 'What does this mean and how do I fix it?',
    pictures: ['npm-enoent'],
    mustInclude: [['package.json'], ['npm init', 'right folder', 'right directory', 'cd ']],
  },
  {
    id: 'signup-form',
    section: 'pictures',
    message: "Why can't I press Save?",
    pictures: ['signup-form'],
    mustInclude: [['email'], ['required', 'empty', 'missing', 'fill', 'enter']],
  },
  {
    id: 'json-comma',
    section: 'pictures',
    message: 'Why does this JSON fail to parse?',
    pictures: ['json-comma'],
    mustInclude: [['comma']],
  },
  {
    id: 'people-table',
    section: 'pictures',
    message: 'Who in this table is the oldest, and how old are they?',
    pictures: ['people-table'],
    mustInclude: [['maya'], ['41']],
  },
  {
    id: 'clip-frames',
    section: 'pictures',
    message: 'These are frames from a screen recording, in order. What happens?',
    pictures: ['clip-frame-1', 'clip-frame-2', 'clip-frame-3'],
    mustInclude: [['500', 'internal server error', 'server error'], ['load']],
  },
];

/** The guide eval's app questions that carry a fact to check: Harbor's
 *  prompt holds every app fact, so it should answer each one. */
const APP_IDS = ['stack', 'harbor', 'deepblue', 'pair', 'cloud-key', 'vault', 'privacy'];
const APP_CASES: HarborEvalCase[] = APP_IDS.map((id) => {
  const c = GUIDE_EVAL_CASES.find((g) => g.id === id);
  if (!c) throw new Error(`The guide eval has no case ${id}.`);
  return { id: `app-${id}`, section: 'app', message: c.message, mustInclude: c.mustInclude };
});

const LIMIT_CASES: HarborEvalCase[] = [
  {
    id: 'edit-repo',
    section: 'limits',
    message: 'Go into my GitHub repo and add a login page across the files.',
    mustInclude: [['computer', 'dock', 'deepblue', 'bigger model', 'stack']],
    mustNot: [/\bI(?:'ve| have) (?:added|created|updated|edited|pushed)\b/i],
  },
  {
    id: 'run-tests',
    section: 'limits',
    message: 'Run npm test in my project and tell me which tests fail.',
    mustInclude: [
      [
        "can't run",
        'cannot run',
        "can't execute",
        'cannot execute',
        'not able to run',
        'unable to run',
        "don't have access",
        'do not have access',
        'no access',
        'run it yourself',
        'paste',
      ],
    ],
    mustNot: [/\ball (?:the )?tests (?:pass|passed)\b/i, /\b\d+ tests? (?:passed|failed)\b/i],
  },
  {
    id: 'not-in-picture',
    section: 'limits',
    message: 'What is the phone number in this picture?',
    pictures: ['bar-chart'],
    mustInclude: [
      [
        'no phone',
        'not see',
        "can't see",
        'cannot see',
        "don't see",
        'do not see',
        "doesn't show",
        'does not show',
        "doesn't contain",
        'does not contain',
        'no number',
        'not visible',
        "isn't",
        'there is no',
        "there's no",
      ],
    ],
    mustNot: [/\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/],
  },
];

const EVERYDAY_CASES: HarborEvalCase[] = [
  {
    id: 'capital',
    section: 'everyday',
    message: 'What is the capital of Australia?',
    mustInclude: [['canberra']],
    mustNot: [/OpenShore/],
  },
  {
    id: 'fahrenheit',
    section: 'everyday',
    message: 'Convert 72 degrees Fahrenheit to Celsius.',
    mustInclude: [['22']],
    mustNot: [/OpenShore/],
  },
];

export const HARBOR_EVAL_CASES: readonly HarborEvalCase[] = [
  ...CODE_CASES,
  ...PICTURE_CASES,
  ...APP_CASES,
  ...LIMIT_CASES,
  ...EVERYDAY_CASES,
];

// ------------------------------------------------------------------ scoring

/** Built from its code point so no source line spells the character. */
const EM_DASH = String.fromCharCode(8212);

/** What the chat shows of a reply: a thought, finished or cut off, never. */
export function shownText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim();
}

const FENCE = /```([A-Za-z]*)[^\n]*\n([\s\S]*?)```/g;

/** The code a reply offers for `fn`: the fenced block that defines it, else
 *  the first JavaScript block, else the reply itself when it defines `fn`
 *  bare. Undefined when there is none. */
export function extractCode(answer: string, fn: string): string | undefined {
  const defines = new RegExp(
    `(?:async\\s+)?function\\s*\\*?\\s*${fn}\\b|(?:const|let|var)\\s+${fn}\\s*=`,
  );
  const blocks = [...answer.matchAll(FENCE)].map((m) => ({
    lang: m[1]!.toLowerCase(),
    code: m[2]!,
  }));
  const own = blocks.find((b) => defines.test(b.code));
  if (own) return own.code;
  const js = blocks.find((b) => ['js', 'javascript', 'jsx', 'mjs', ''].includes(b.lang));
  if (js) return js.code;
  return defines.test(answer) ? answer : undefined;
}

export interface HarborScore {
  score: number;
  misses: string[];
}

/** Run a reply's code against a case's tests: true when every test passed. */
export type RunCode = (
  code: string,
  tests: string,
  fn: string,
) => Promise<{ ok: boolean; error?: string }>;

/** Score one shown answer by rule. A code case scores on its tests (a pass
 *  with an em dash in the words keeps three quarters); any other case on the
 *  share of its checks met: not empty, every fact group, every pattern,
 *  nothing forbidden, no em dash. */
export async function scoreHarborAnswer(
  c: HarborEvalCase,
  answer: string,
  runCode?: RunCode,
): Promise<HarborScore> {
  const text = shownText(answer);
  if (!text) return { score: 0, misses: ['empty'] };
  const dash = text.includes(EM_DASH);
  if (c.code) {
    const code = extractCode(text, c.code.fn);
    if (!code) return { score: 0, misses: [`no ${c.code.fn}`] };
    if (!runCode) return { score: 0, misses: ['no code runner'] };
    const ran = await runCode(code, c.code.tests, c.code.fn);
    if (!ran.ok) return { score: 0, misses: [`tests: ${ran.error ?? 'failed'}`] };
    return dash ? { score: 0.75, misses: ['em dash'] } : { score: 1, misses: [] };
  }
  const lower = text.toLowerCase();
  const misses: string[] = [];
  for (const group of c.mustInclude ?? []) {
    if (!group.some((g) => lower.includes(g.toLowerCase())))
      misses.push(`missing ${group.join('|')}`);
  }
  for (const re of c.mustMatch ?? []) if (!re.test(text)) misses.push(`no ${re.source}`);
  for (const re of c.mustNot ?? []) if (re.test(text)) misses.push(`said ${re.source}`);
  if (dash) misses.push('em dash');
  const checks =
    1 + (c.mustInclude?.length ?? 0) + (c.mustMatch?.length ?? 0) + (c.mustNot?.length ?? 0) + 1;
  return { score: (checks - misses.length) / checks, misses };
}

// ------------------------------------------------------------------ running

export interface HarborRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>;
  /** true: Harbor's own window and sampling; false: the server's defaults. */
  harness: boolean;
}

export interface HarborReply {
  text: string;
  /** Tokens and milliseconds the server reports, when it does. */
  promptTokens?: number;
  promptMs?: number;
  outputTokens?: number;
  outputMs?: number;
}

export type HarborComplete = (request: HarborRequest) => Promise<HarborReply>;

/** The prompt a case runs with: Harbor's, or the bare one the pair compares
 *  against. The eval is offline, so Harbor is told it has no web. */
export function harborEvalSystem(harness: boolean, sees: boolean): string {
  return harness
    ? buildHarborSystemPrompt(false, NO_SEARCH_NOTE, sees)
    : 'You are a helpful assistant.';
}

/** A case's request, with or without the harness. With it, the pictures ride
 *  the turn the way the phone sends them (deviceMessages). */
export function harborEvalRequest(
  c: HarborEvalCase,
  harness: boolean,
  picture: (name: string) => string,
): HarborRequest {
  const images = (c.pictures ?? []).map(picture);
  const system = harborEvalSystem(harness, images.length > 0);
  const turn = images.length
    ? { role: 'user' as const, content: c.message, images }
    : { role: 'user' as const, content: c.message };
  return {
    system,
    messages: harness
      ? deviceMessages(system, [turn], HARBOR_EVAL_REPLY_TOKENS, HARBOR_CONTEXT_TOKENS)
      : [turn],
    harness,
  };
}

export interface HarborRun {
  id: string;
  section: HarborSection;
  withHarness: HarborScore & { reply: HarborReply };
  without: HarborScore & { reply: HarborReply };
}

export interface HarborEvalResult {
  runs: HarborRun[];
  /** Mean score per section and overall, with the harness and without it. */
  sections: Record<HarborSection, { withHarness: number; without: number; cases: number }>;
  withHarness: number;
  without: number;
}

/** Answer every case twice, with the harness and without, and score both.
 *  `seesPictures` false skips the picture cases (a text-only model), so a
 *  text-only baseline is compared on what it can do. */
export async function runHarborEval(opts: {
  complete: HarborComplete;
  picture: (name: string) => string;
  runCode: RunCode;
  seesPictures: boolean;
  cases?: readonly HarborEvalCase[];
  onRun?: (run: HarborRun) => void;
}): Promise<HarborEvalResult> {
  const cases = (opts.cases ?? HARBOR_EVAL_CASES).filter(
    (c) => opts.seesPictures || !c.pictures?.length,
  );
  const runs: HarborRun[] = [];
  for (const c of cases) {
    const withReply = await opts.complete(harborEvalRequest(c, true, opts.picture));
    const withoutReply = await opts.complete(harborEvalRequest(c, false, opts.picture));
    const run: HarborRun = {
      id: c.id,
      section: c.section,
      withHarness: {
        ...(await scoreHarborAnswer(c, withReply.text, opts.runCode)),
        reply: withReply,
      },
      without: {
        ...(await scoreHarborAnswer(c, withoutReply.text, opts.runCode)),
        reply: withoutReply,
      },
    };
    runs.push(run);
    opts.onRun?.(run);
  }
  const mean = (list: HarborRun[], pick: (r: HarborRun) => number) =>
    list.length ? list.reduce((s, r) => s + pick(r), 0) / list.length : 0;
  const sections = Object.fromEntries(
    HARBOR_SECTIONS.map((s) => {
      const list = runs.filter((r) => r.section === s);
      return [
        s,
        {
          withHarness: mean(list, (r) => r.withHarness.score),
          without: mean(list, (r) => r.without.score),
          cases: list.length,
        },
      ];
    }),
  ) as HarborEvalResult['sections'];
  return {
    runs,
    sections,
    withHarness: mean(runs, (r) => r.withHarness.score),
    without: mean(runs, (r) => r.without.score),
  };
}

/** The result as one markdown table, ready for DECISIONS and PROGRESS. */
export function harborEvalTable(model: string, result: HarborEvalResult, seconds: number): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const rows = HARBOR_SECTIONS.filter((s) => result.sections[s].cases > 0).map(
    (s) =>
      `| ${s} | ${result.sections[s].cases} | ${pct(result.sections[s].withHarness)} | ${pct(result.sections[s].without)} |`,
  );
  const replies = result.runs.map((r) => r.withHarness.reply);
  const speed = replies.filter((r) => r.outputTokens && r.outputMs);
  const tokensPerSecond = speed.length
    ? speed.reduce((s, r) => s + r.outputTokens! / (r.outputMs! / 1000), 0) / speed.length
    : undefined;
  const pictureRuns = result.runs.filter((r) => r.section === 'pictures');
  const pictureRead = pictureRuns
    .map((r) => r.withHarness.reply.promptMs)
    .filter((n): n is number => typeof n === 'number');
  return [
    `Harbor eval, ${model}, ${result.runs.length} cases, ${seconds}s.`,
    '',
    '| Section | Cases | With the harness | Without |',
    '| --- | --- | --- | --- |',
    ...rows,
    `| all | ${result.runs.length} | ${pct(result.withHarness)} | ${pct(result.without)} |`,
    '',
    tokensPerSecond ? `Reply speed with the harness: ${tokensPerSecond.toFixed(1)} tokens/s.` : '',
    pictureRead.length
      ? `Reading a picture prompt: ${(pictureRead.reduce((a, b) => a + b, 0) / pictureRead.length / 1000).toFixed(1)}s on average.`
      : '',
  ]
    .filter((line, i, all) => line !== '' || (all[i - 1] ?? '') !== '')
    .join('\n')
    .trim();
}
