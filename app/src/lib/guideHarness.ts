// The guide harness: how Harbor Lite, a 135M model, answers well above its
// size. A model that small cannot hold the whole app in its head, decide when
// to search, or reason about someone's hardware, so the harness does that
// mechanical work first and hands the model only what this one question needs
// (tenet 3: raise the floor, never the ceiling, and say so).
//
// Per turn, `planGuideTurn` reads the person's message and decides:
//   - which few fact cards about the app answer it (retrieval first, instead of
//     every fact on every turn, which also overflowed the window);
//   - whether the web should be searched (a factual question the app facts do
//     not cover), and with what query;
//   - whether the person described their equipment or asked how to optimize
//     their setup, in which case the fit is computed here, from the same fit
//     table the First Seat card uses, and handed over as facts;
//   - whether the ask is past a guide's size (writing code, heavy reasoning),
//     in which case the reply is told to say so, and the chat shows an honest
//     note after it, whatever the model wrote.
//
// Pure: no platform, no network, no Node built-ins. The driver runs the search
// the plan asks for and builds the prompt with `buildGuidePrompt`.
import { resolveHarborMaster, harborMasterSizeLine } from './harborMaster.js';
import type { HardwareRead } from './firstSeat.js';
import type { FitLabel } from '../components/marketplace.js';
import type { WebSearchResult } from './webSearch.js';

/** One small, true fact about the app, retrievable by what a person would ask. */
export interface GuideCard {
  id: string;
  title: string;
  /** Where it lives in the app, as the person would tap there. */
  where?: string;
  /** What it does, why it exists, how to use it. Plain words, no em dashes. */
  text: string;
  /** Lowercase words and phrases a person might use asking about it. */
  keywords: string[];
}

export type GuideRoute = 'chat' | 'app' | 'setup' | 'web' | 'stretch';

export interface GuideEquipment {
  ramGB?: number;
  gpu?: boolean;
  gpuVramGB?: number;
  mac?: boolean;
  /** They said they have no computer, or only the phone. */
  phoneOnly?: boolean;
  /** They mentioned an iPhone model or the phone itself. */
  iphone?: boolean;
}

export interface GuidePlan {
  route: GuideRoute;
  cards: GuideCard[];
  /** Set when the harness should search the web before the model answers. */
  searchQuery?: string;
  /** Hardware-fit facts computed by the harness, for a setup question. */
  advice?: string[];
  /** Set when the ask is past a guide's size; the honest note the chat shows. */
  stretch?: string;
  /** A fixed line the chat shows after the reply, whatever the model wrote:
   *  the stretch note, or the worked-out setup size. A 135M model restating
   *  advice drops the one number that matters often enough (the reference box
   *  eval, 2026-09-24) that the harness says it itself. */
  after?: string;
}

// ------------------------------------------------------------- the words

const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at for from by with about as is are was were be been being ' +
    'do does did done have has had i me my mine you your yours we our us it its this that these those there ' +
    'what which who whom whose when where why how can could should would will shall may might must ' +
    'not no yes please thanks thank hi hello hey just really very much more most some any all each ' +
    'tell show explain know want need like get got make let lets im ive id dont cant wont whats hows ' +
    'openshore app'
  ).split(' '),
);

/** Lowercase words with a light stem, so "models" meets "model" and
 *  "connecting" meets "connect". Stopwords are dropped. */
export function guideWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+.-]*/g) ?? [])
    .map((w) => w.replace(/[.-]+$/, ''))
    .map(stem)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('es') && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

// ------------------------------------------------------------- retrieval

export interface ScoredCard {
  card: GuideCard;
  score: number;
}

/** Score every card against the message: a keyword phrase found whole in the
 *  message counts most, a shared word less, a title word in between. */
export function scoreCards(message: string, cards: readonly GuideCard[]): ScoredCard[] {
  const lower = ` ${message.toLowerCase().replace(/[^a-z0-9+.\s-]/g, ' ')} `;
  const words = new Set(guideWords(message));
  const scored: ScoredCard[] = [];
  for (const card of cards) {
    let score = 0;
    for (const kw of card.keywords) {
      const k = kw.toLowerCase().trim();
      if (!k) continue;
      if (k.includes(' ')) {
        if (lower.includes(` ${k} `)) score += 4;
        continue;
      }
      if (words.has(stem(k))) score += 2;
    }
    for (const w of guideWords(card.title)) if (words.has(w)) score += 3;
    if (score > 0) scored.push({ card, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
}

/** The best few cards for a message: at most `k`, and none far weaker than
 *  the best, so a stray shared word does not drag in an unrelated card. */
export function retrieveCards(message: string, cards: readonly GuideCard[], k = 3): GuideCard[] {
  const scored = scoreCards(message, cards);
  const best = scored[0]?.score ?? 0;
  return scored
    .filter((s) => s.score >= Math.max(2, best / 3))
    .slice(0, k)
    .map((s) => s.card);
}

// ------------------------------------------------------------- equipment

// Dedicated VRAM for the GPUs people name most, so "I have a 3060" is enough.
const GPU_VRAM: Array<[RegExp, number]> = [
  [/\b(rtx\s*)?5090\b/, 32],
  [/\b(rtx\s*)?4090\b/, 24],
  [/\b(rtx\s*)?3090\b/, 24],
  [/\b(rtx\s*)?5080\b/, 16],
  [/\b(rtx\s*)?4080\b/, 16],
  [/\b(rtx\s*)?4070\s*ti\s*super\b/, 16],
  [/\b(rtx\s*)?4060\s*ti\b/, 8],
  [/\b(rtx\s*)?(4070|5070)\b/, 12],
  [/\b(rtx\s*)?3060\b/, 12],
  [/\b(rtx\s*)?3080\b/, 10],
  [/\b(rtx\s*)?(3070|4060|2080|2070|3060\s*ti)\b/, 8],
  [/\b(rtx\s*)?2060\b/, 6],
  [/\brx\s*7900\b/, 20],
];

/** What the person said about their machine, read without guessing: a field is
 *  set only when the message states it. */
export function readEquipment(message: string): GuideEquipment {
  const t = message.toLowerCase();
  const eq: GuideEquipment = {};
  const vram = /(\d{1,3})\s*(?:gb|gigs?)\s*(?:of\s*)?(?:vram|gpu|graphics|video)/.exec(t);
  if (vram) {
    eq.gpu = true;
    eq.gpuVramGB = Number(vram[1]);
  } else {
    for (const [re, gb] of GPU_VRAM) {
      if (re.test(t)) {
        eq.gpu = true;
        eq.gpuVramGB = gb;
        break;
      }
    }
  }
  // System memory: "16gb", "16 GB of RAM", "32 gigs", skipping the VRAM figure.
  for (const m of t.matchAll(
    /(\d{1,3})\s*(?:gb|gigs?)\b(?!\s*(?:of\s*)?(?:vram|gpu|graphics|video))/g,
  )) {
    const n = Number(m[1]);
    if (
      n >= 4 &&
      n <= 512 &&
      !/storage|ssd|disk|drive|hdd|free space/.test(t.slice(m.index, m.index + 30))
    ) {
      eq.ramGB = n;
      break;
    }
  }
  if (/\bno\s+(dedicated\s+)?gpu\b|\bintegrated graphics\b|\bno graphics card\b/.test(t))
    eq.gpu = false;
  if (
    /\b(macbook|mac mini|mac studio|imac|mac pro|m[1-5]\s*(pro|max|ultra)?\b|apple silicon)\b/.test(
      t,
    )
  )
    eq.mac = true;
  if (
    /\b(only|just)\s+(have\s+)?(my|a|an|the)?\s*(i?phone)\b|\bno\s+(computer|laptop|desktop|pc)\b/.test(
      t,
    )
  )
    eq.phoneOnly = true;
  if (/\biphone\b/.test(t)) eq.iphone = true;
  return eq;
}

function hasEquipment(eq: GuideEquipment): boolean {
  return eq.ramGB !== undefined || eq.gpu !== undefined || eq.mac === true || eq.phoneOnly === true;
}

/** The setup advice for what they described, computed from the same fit rule
 *  the First Seat card and the engine use. Lines of fact the model restates;
 *  it never has to do the arithmetic itself. */
export function setupAdvice(eq: GuideEquipment): string[] {
  const lines: string[] = [];
  if (eq.phoneOnly) {
    lines.push(
      'With only a phone: keep Harbor Lite for help with the app, get Harbor (about 1.9 GB) to write and explain code on the phone, and connect your own cloud key (Claude, OpenAI, or Gemini) under Cloud Connections when you want the strongest model. DeepBlue needs a computer.',
    );
    return lines;
  }
  if (eq.ramGB === undefined && eq.gpuVramGB === undefined) {
    lines.push(
      "To size DeepBlue, the desktop coding model, I need the computer's memory (RAM, for example 8, 16, or 32 GB) and whether it has a graphics card, and how much memory that card has. Ask for these.",
    );
    if (eq.mac) {
      lines.push('On a Mac, the memory is the number in About This Mac, next to Memory.');
    }
    return lines;
  }
  const hw: HardwareRead = {
    ramGB: eq.ramGB ?? 0,
    gpu: eq.gpu === true && (eq.gpuVramGB ?? 0) > 0,
    gpuVramGB: eq.gpuVramGB,
  };
  const { size, fit } = resolveHarborMaster(hw);
  const machine = [
    eq.ramGB !== undefined ? `${eq.ramGB} GB of memory` : undefined,
    hw.gpu
      ? `a graphics card with ${eq.gpuVramGB} GB`
      : eq.mac
        ? 'a Mac'
        : 'no dedicated graphics card',
  ]
    .filter(Boolean)
    .join(' and ');
  lines.push(
    `For a computer with ${machine}, the right DeepBlue size is ${size.weightsName}. ${harborMasterSizeLine(size)} ${FIT_WORDS[fit as FitLabel]}`,
  );
  if (fit === 'tight') lines.push('It will run, but close other heavy apps while it works.');
  if (fit === 'too-big')
    lines.push(
      'Even the smallest DeepBlue is a stretch here, so a cloud key under Cloud Connections will feel much better on this machine.',
    );
  lines.push(
    'The best setup: install DeepBlue on the computer (Settings, Harbor, on the desktop app), pair this phone to it under Desktop + phone over Tailscale, and the phone reaches it as My computer, so the computer does the heavy work while the phone stays light.',
  );
  lines.push(
    'Add a cloud key under Cloud Connections only if you want the strongest model for hard tasks; it asks before it spends.',
  );
  return lines;
}

const FIT_WORDS: Record<FitLabel, string> = {
  fits: 'It fits that machine comfortably.',
  tight: 'It fits that machine, with little headroom.',
  'too-big': 'It is too big for that machine.',
};

/** The fixed setup line shown after the reply, when a size was worked out. */
export function setupNote(eq: GuideEquipment): string | undefined {
  if (eq.phoneOnly || (eq.ramGB === undefined && eq.gpuVramGB === undefined)) return undefined;
  const hw: HardwareRead = {
    ramGB: eq.ramGB ?? 0,
    gpu: eq.gpu === true && (eq.gpuVramGB ?? 0) > 0,
    gpuVramGB: eq.gpuVramGB,
  };
  const { size, fit } = resolveHarborMaster(hw);
  return `Worked out from what you described: DeepBlue on ${size.weightsName}, a ${size.sizeGB} GB download. ${FIT_WORDS[fit as FitLabel]}`;
}

/** The em dash, built from its code point so no source line spells it. */
const EM_DASH = String.fromCharCode(8212);

/** Harbor Lite's words as the chat shows them: never an em dash (house rule),
 *  which a model this small still writes now and then despite the prompt. */
export function sanitizeGuideText(text: string): string {
  return text.split(` ${EM_DASH} `).join(', ').split(EM_DASH).join(', ');
}

// ------------------------------------------------------------- the route

const CODE_ASK =
  /\b(write|build|make|create|code|fix|debug|refactor|implement|generate|convert)\b[^.?!]{0,40}\b(code|function|script|program|class|component|regex|sql|query|api|bug|app|website|site|game|test|python|javascript|typescript|swift|react|html|css)\b/;
const HEAVY_ASK =
  /\b(prove|derive|solve (this|the) (equation|integral|proof)|write (me )?(an? )?(essay|report|story|paper|article|thesis)|step[- ]by[- ]step (plan|analysis)|analy[sz]e (this|my) (data|dataset|spreadsheet)|translate (this|the) (document|file|page))\b/;
const SETUP_ASK =
  /\b(optimi[sz]e|best (setup|model|way to set)|which model (should|do|for)|what (model|size) should|recommend|what should i (get|use|install|download)|(for|on|with) my (computer|laptop|desktop|mac|pc|machine|rig|setup|gpu|graphics card)|(will|would|can) (it|this|deepblue|that) run|enough (ram|memory))\b/;
const CHAT_ONLY =
  /^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|cool|nice|great|awesome|good (morning|afternoon|evening|night)|how are you|who are you|what'?s up|sup)\b[\s!.?]*$/;
const QUESTION =
  /\?\s*$|^(who|what|when|where|why|how|which|is|are|was|were|can|could|does|do|did|will|should|would|has|have|tell me|explain|define)\b/;
// Words that mean the question is about this app, even when no card matches.
const APP_TERMS =
  /\b(openshore|harbor|deepblue|stack|bench|marketplace|vault|crew|currents?|wayfinding|repositor(y|ies)|tailscale|pair(ing)?|settings|reasoning llm|specialist|composer|offshore|onshore|jev|hermes|byom|codemagic|routine)\b/;

/** The strongest card score that still counts as "the app facts answer this". */
const APP_SCORE = 2;

export interface GuideTurnInput {
  message: string;
  cards: readonly GuideCard[];
}

export const STRETCH_NOTE =
  "That is past Harbor Lite's size, so treat the answer above as a starting point. Harbor (on this phone) or DeepBlue (on your computer) can take it all the way.";

/** Decide how this turn is answered. Deterministic, so the eval can pin it. */
export function planGuideTurn({ message, cards }: GuideTurnInput): GuidePlan {
  const text = message.trim();
  const lower = text.toLowerCase();
  const scored = scoreCards(text, cards);
  const top = retrieveCards(text, cards);
  const best = scored[0]?.score ?? 0;

  if (CHAT_ONLY.test(lower)) return { route: 'chat', cards: [] };

  if (CODE_ASK.test(lower) || HEAVY_ASK.test(lower)) {
    return {
      route: 'stretch',
      cards: top.slice(0, 1),
      stretch: STRETCH_NOTE,
      after: STRETCH_NOTE,
    };
  }

  const eq = readEquipment(text);
  if (SETUP_ASK.test(lower) || hasEquipment(eq)) {
    return {
      route: 'setup',
      cards: top.slice(0, 2),
      advice: setupAdvice(eq),
      after: setupNote(eq),
    };
  }

  if (best >= APP_SCORE || APP_TERMS.test(lower)) return { route: 'app', cards: top };

  if (QUESTION.test(lower) && guideWords(text).length > 0) {
    return { route: 'web', cards: [], searchQuery: searchQueryFor(text) };
  }
  return { route: top.length ? 'app' : 'chat', cards: top };
}

/** A search engine query from a chat message: the question minus the chat. */
export function searchQueryFor(message: string): string {
  const q = message
    .replace(/^(hey|hi|hello|so|ok|okay)[,!.\s]+/i, '')
    .replace(
      /^(can you|could you|please|would you)\s+(tell me|explain|find out|look up|search)\s*/i,
      '',
    )
    .replace(/[?!.]+$/, '')
    .trim();
  return q.length > 200 ? q.slice(0, 200) : q;
}

// ------------------------------------------------------------- the prompt

/** The most search text a 135M model is handed: a few results, snippets cut. */
const SNIPPET_CHARS = 320;

export function formatGuideSources(results: readonly WebSearchResult[]): string {
  return results
    .slice(0, 3)
    .map((r, i) => {
      const snippet =
        r.snippet.length > SNIPPET_CHARS ? `${r.snippet.slice(0, SNIPPET_CHARS)}...` : r.snippet;
      return `[${i + 1}] ${r.title}: ${snippet}`;
    })
    .join('\n');
}

export interface GuidePromptParts {
  /** The short persona, always present. */
  persona: string;
  plan: GuidePlan;
  /** Where the guided setup stands, when this is the setup chat. */
  setupLine?: string;
  /** The search results, when the plan searched and it worked. */
  sources?: readonly WebSearchResult[];
  /** The search was planned but failed (offline, rate limited). */
  searchFailed?: boolean;
}

export function cardText(card: GuideCard): string {
  return `- ${card.title}${card.where ? ` (${card.where})` : ''}: ${card.text}`;
}

/** The system prompt for one turn: the persona, then only what this question
 *  needs. The instruction for the route comes last, nearest the question,
 *  where a small model weighs it most. */
export function buildGuidePrompt({
  persona,
  plan,
  setupLine,
  sources,
  searchFailed,
}: GuidePromptParts): string {
  const parts = [persona];
  if (setupLine) parts.push(setupLine);
  if (plan.cards.length)
    parts.push(['FACTS FOR THIS QUESTION:', ...plan.cards.map(cardText)].join('\n'));
  switch (plan.route) {
    case 'setup':
      parts.push(
        [
          'SETUP ADVICE, already worked out for what they described. Restate it in your own words, in order, and do not change any number:',
          ...(plan.advice ?? []).map((a) => `- ${a}`),
        ].join('\n'),
      );
      break;
    case 'web':
      if (sources?.length) {
        parts.push(
          [
            'WEB RESULTS for their question. Answer from these only, in two or three sentences, and name the source number like [1]. If the results do not answer it, say so plainly.',
            formatGuideSources(sources),
          ].join('\n'),
        );
      } else if (searchFailed) {
        parts.push(
          'You tried to search the web for this and could not reach it. Say so in one sentence, then answer only if you are sure, and say you are not sure otherwise.',
        );
      } else {
        parts.push('The web had nothing on this. Say so, and answer only if you are sure.');
      }
      break;
    case 'stretch':
      parts.push(
        'This ask is bigger than you. Say so warmly in one sentence, give at most a short outline of the approach, and suggest Harbor on the phone or DeepBlue on their computer. Do not write a full solution.',
      );
      break;
    case 'app':
      if (!plan.cards.length)
        parts.push(
          'No fact covers this exactly. Say what you do know and point to the Menu or Settings, and never invent a feature.',
        );
      break;
    case 'chat':
      break;
  }
  return parts.join('\n\n');
}
