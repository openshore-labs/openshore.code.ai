// The guide eval: the number Harbor Lite's harness ships on (tenet 2). Two
// halves, both scored by rule, never by a judge model:
//
//   1. Harness decisions, deterministic, run in CI (test/guideEval.test.ts):
//      does each question take the right route (app facts, setup advice, web,
//      past-my-size, chat), does it pull the card that answers it, and does the
//      prompt leave room in the window. No model needed, so it gates every push.
//   2. Answers, run on the reference box against the real weights
//      (scripts/guide-eval.ts, Ollama's smollm2:135m, the same SmolLM2-135M the
//      phone bundles): the same questions answered with the harness and without
//      it (the old way, every fact on every turn), each answer checked for the
//      facts it must carry and the things it must never say.
//
// Pure: the model and the search are injected.
import { DEVICE_CONTEXT_TOKENS, estimateTokens } from '../drivers/deviceModel.js';
import { AGENTIC_CURRENTS_TITLE } from './currents.js';
import { GUIDE_CARDS } from './guideCards.js';
import {
  buildGuidePrompt,
  cardText,
  planGuideTurn,
  sanitizeGuideText,
  type GuideRoute,
} from './guideHarness.js';
import { HARBOR_MINI_PERSONA } from './harborMini.js';
import type { WebSearchResult } from './webSearch.js';

export interface GuideEvalCase {
  id: string;
  message: string;
  route: GuideRoute;
  /** At least one of these card ids must be retrieved. */
  cards?: string[];
  /** Each inner list is an any-of group; the answer must match every group. */
  mustInclude?: string[][];
  /** Things a grounded answer never says for this question. */
  mustNot?: RegExp[];
}

export const GUIDE_EVAL_CASES: readonly GuideEvalCase[] = [
  // The app: what each part does and why.
  {
    id: 'stack',
    message: 'How does Stack work?',
    route: 'app',
    cards: ['stack'],
    mustInclude: [['reasoning']],
  },
  {
    id: 'reasoning-llm',
    message: 'What is the Reasoning LLM?',
    route: 'app',
    cards: ['stack'],
    mustInclude: [['plan', 'route', 'orchestrat']],
  },
  {
    id: 'specialists',
    message: 'What are specialists for?',
    route: 'app',
    cards: ['specialists', 'stack'],
    mustInclude: [['coding', 'writing', 'vision']],
  },
  {
    id: 'bench',
    message: "What's the Bench?",
    route: 'app',
    cards: ['bench'],
    mustInclude: [['stack', 'place']],
  },
  {
    id: 'marketplace',
    message: 'Where do I get more models?',
    route: 'app',
    cards: ['marketplace'],
  },
  {
    id: 'harbor-lite',
    message: 'What are you good for?',
    route: 'app',
    cards: ['harbor-lite'],
    mustInclude: [['guide', 'setup', 'set up']],
  },
  {
    id: 'harbor',
    message: 'What is Harbor and how do I get it?',
    route: 'app',
    cards: ['harbor'],
    mustInclude: [['1.9', 'code', 'coding']],
  },
  {
    id: 'deepblue',
    message: 'What is DeepBlue?',
    route: 'app',
    cards: ['deepblue'],
    mustInclude: [['computer', 'desktop']],
  },
  {
    id: 'pair',
    message: 'How do I connect my computer to my phone?',
    route: 'app',
    cards: ['pair-phone', 'pair-desktop'],
    mustInclude: [['tailscale']],
  },
  {
    id: 'tailscale',
    message: 'Why do I need Tailscale?',
    route: 'app',
    cards: ['pair-phone'],
    mustInclude: [['private', 'network']],
  },
  {
    id: 'cloud-key',
    message: 'How do I use Claude with my own API key?',
    route: 'app',
    cards: ['cloud-connections'],
    mustInclude: [['key']],
  },
  {
    id: 'repos',
    message: 'How do I add a GitHub repository?',
    route: 'app',
    cards: ['repositories'],
  },
  {
    id: 'vault',
    message: 'What is the Vault for?',
    route: 'app',
    cards: ['vault'],
    mustInclude: [['note', 'markdown', 'knowledge']],
  },
  { id: 'crew', message: 'What does Crew do?', route: 'app', cards: ['my-crew', 'advisors'] },
  {
    id: 'routines',
    message: 'Can a crew member do a task every morning?',
    route: 'app',
    cards: ['routines'],
    mustNot: [/always on/i],
  },
  {
    id: 'currents',
    message: `What are ${AGENTIC_CURRENTS_TITLE}?`,
    route: 'app',
    cards: ['agentic-currents'],
  },
  { id: 'wayfinding', message: 'What does Wayfinding do?', route: 'app', cards: ['wayfinding'] },
  {
    id: 'privacy',
    message: 'Do my keys leave my phone?',
    route: 'app',
    cards: ['privacy'],
    mustInclude: [['device', 'phone']],
  },
  {
    id: 'offline',
    message: 'Does this work without internet?',
    route: 'app',
    cards: ['offline', 'harbor-lite'],
  },
  { id: 'modes', message: 'What does Accept edits mean?', route: 'app', cards: ['modes'] },
  {
    id: 'reach',
    message: 'Why does it say Offshore at the top?',
    route: 'app',
    cards: ['reach-pill'],
    mustInclude: [['computer']],
  },
  {
    id: 'switch',
    message: 'How do I switch to a different model?',
    route: 'app',
    cards: ['model-picker'],
  },
  { id: 'attach', message: 'Can I send it a screenshot?', route: 'app', cards: ['attachments'] },
  { id: 'voice', message: 'Can I talk to it hands free?', route: 'app', cards: ['voice-mode'] },
  {
    id: 'byom',
    message: 'Can I use my own server with a fine-tuned model?',
    route: 'app',
    cards: ['byom'],
  },
  {
    id: 'launch',
    message: 'How do I ship my app to the App Store?',
    route: 'app',
    cards: ['launch'],
  },
  {
    id: 'web-search-set',
    message: 'Which web search does Harbor use?',
    route: 'app',
    cards: ['settings-harbor'],
  },
  {
    id: 'skipped',
    message: 'Where do I finish the setup steps I skipped?',
    route: 'app',
    cards: ['setup-page'],
    mustNot: [/settings, under get started/i],
  },
  {
    id: 'marketplace-soon',
    message: 'Why is the Marketplace grayed out?',
    route: 'app',
    cards: ['marketplace'],
    mustInclude: [['coming soon', 'soon']],
  },
  // Setup and optimizing it: the harness does the sizing.
  {
    id: 'fit-8',
    message: 'I have a laptop with 8GB of RAM and no GPU. What should I use?',
    route: 'setup',
    mustInclude: [['3b']],
  },
  {
    id: 'fit-16',
    message: 'My PC has 16 GB RAM, which model should I run?',
    route: 'setup',
    mustInclude: [['7b']],
  },
  {
    id: 'fit-4090',
    message: 'I have a desktop with 64gb and an RTX 4090, how should I set this up?',
    route: 'setup',
    mustInclude: [['14b']],
  },
  {
    id: 'fit-mac',
    message: 'I have a MacBook Pro M3 with 36GB, what is the best setup?',
    route: 'setup',
    mustInclude: [['14b']],
  },
  {
    id: 'fit-unknown',
    message: 'What model should I get for my computer?',
    route: 'setup',
    mustInclude: [['memory', 'ram']],
  },
  {
    id: 'phone-only',
    message: 'I only have my iPhone, no computer. How do I get the most out of this?',
    route: 'setup',
    mustInclude: [['harbor']],
    mustNot: [/deepblue on (your|the) phone/i],
  },
  { id: 'optimize', message: 'How do I optimize my setup?', route: 'setup' },
  // The web: factual questions the app facts do not cover.
  { id: 'web-capital', message: 'What is the capital of Australia?', route: 'web' },
  { id: 'web-news', message: 'Who won the last World Cup?', route: 'web' },
  { id: 'web-howto', message: 'How long should I boil an egg?', route: 'web' },
  { id: 'web-time', message: 'What time is it in Tokyo right now?', route: 'web' },
  { id: 'web-units', message: 'How many ounces are in a cup?', route: 'web' },
  { id: 'web-history', message: 'Who invented the telephone?', route: 'web' },
  { id: 'web-http', message: 'What does a 404 error mean?', route: 'web' },
  { id: 'web-weather', message: 'Is it going to rain in Seattle tomorrow?', route: 'web' },
  // Past a guide's size: it says so.
  {
    id: 'stretch-code',
    message: 'Write a Python function that sorts a list of dicts by date',
    route: 'stretch',
    mustInclude: [['harbor', 'deepblue']],
  },
  { id: 'stretch-fix', message: 'Can you fix the bug in my React component?', route: 'stretch' },
  { id: 'stretch-essay', message: 'Write me an essay about the history of Rome', route: 'stretch' },
  // Chat.
  { id: 'chat-hi', message: 'hi', route: 'chat' },
  { id: 'chat-thanks', message: 'thanks!', route: 'chat' },
];

// ------------------------------------------------------------- decisions (CI)

export interface DecisionResult {
  id: string;
  route: GuideRoute;
  routeOk: boolean;
  cardOk: boolean;
  promptTokens: number;
}

export function scoreDecisions(cases: readonly GuideEvalCase[] = GUIDE_EVAL_CASES): {
  results: DecisionResult[];
  routeAccuracy: number;
  cardRecall: number;
  maxPromptTokens: number;
} {
  const results = cases.map((c) => {
    const plan = planGuideTurn({ message: c.message, cards: GUIDE_CARDS });
    const ids = plan.cards.map((k) => k.id);
    const prompt = buildGuidePrompt({ persona: HARBOR_MINI_PERSONA, plan, sources: fakeSources });
    return {
      id: c.id,
      route: plan.route,
      routeOk: plan.route === c.route,
      cardOk: !c.cards || c.cards.some((id) => ids.includes(id)),
      promptTokens: estimateTokens(prompt),
    };
  });
  const withCards = cases.filter((c) => c.cards);
  return {
    results,
    routeAccuracy: results.filter((r) => r.routeOk).length / results.length,
    cardRecall:
      results.filter((r, i) => cases[i]!.cards && r.cardOk).length / Math.max(1, withCards.length),
    maxPromptTokens: Math.max(...results.map((r) => r.promptTokens)),
  };
}

/** Three full-length results, the most a web turn ever carries, so the prompt
 *  budget is measured at its worst. */
const fakeSources: WebSearchResult[] = [1, 2, 3].map((n) => ({
  title: `Result ${n}`,
  url: `https://example.com/${n}`,
  snippet: 'x'.repeat(600),
}));

/** The room left for history and the reply at the harness's biggest prompt. */
export function worstCaseHeadroom(replyTokens = 512): number {
  return DEVICE_CONTEXT_TOKENS - scoreDecisions().maxPromptTokens - replyTokens;
}

// ------------------------------------------------------------- answers (box)

/** Built from its code point so no source line spells the character. */
const EM_DASH = String.fromCharCode(8212);

export interface AnswerScore {
  score: number;
  misses: string[];
}

/** Score one answer by rule: not empty, every required fact group present,
 *  nothing forbidden, no em dash. */
export function scoreAnswer(c: GuideEvalCase, answer: string): AnswerScore {
  const text = answer.trim();
  const lower = text.toLowerCase();
  const misses: string[] = [];
  if (!text) return { score: 0, misses: ['empty'] };
  for (const group of c.mustInclude ?? []) {
    if (!group.some((g) => lower.includes(g.toLowerCase())))
      misses.push(`missing ${group.join('|')}`);
  }
  for (const re of c.mustNot ?? []) if (re.test(text)) misses.push(`said ${re.source}`);
  if (text.includes(EM_DASH)) misses.push('em dash');
  const checks = 1 + (c.mustInclude?.length ?? 0) + (c.mustNot?.length ?? 0) + 1;
  return { score: (checks - misses.length) / checks, misses };
}

export type Complete = (
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
) => Promise<string>;

export type Search = (query: string) => Promise<WebSearchResult[]>;

/** The old way, for the without-harness number: every card on every turn. */
export function baselinePrompt(): string {
  return [
    HARBOR_MINI_PERSONA,
    ['FACTS ABOUT OPENSHORE:', ...GUIDE_CARDS.map(cardText)].join('\n'),
  ].join('\n\n');
}

export interface AnswerRun {
  id: string;
  withHarness: AnswerScore;
  without: AnswerScore;
}

/** Answer every case twice, with the harness and without, and score both. */
export async function runAnswerEval(
  complete: Complete,
  search: Search | undefined,
  cases: readonly GuideEvalCase[] = GUIDE_EVAL_CASES,
): Promise<{ runs: AnswerRun[]; withHarness: number; without: number }> {
  const runs: AnswerRun[] = [];
  for (const c of cases) {
    const plan = planGuideTurn({ message: c.message, cards: GUIDE_CARDS });
    let sources: WebSearchResult[] | undefined;
    let searchFailed = false;
    if (plan.searchQuery) {
      if (!search) searchFailed = true;
      else sources = await search(plan.searchQuery).catch(() => ((searchFailed = true), undefined));
    }
    const system = buildGuidePrompt({ persona: HARBOR_MINI_PERSONA, plan, sources, searchFailed });
    const messages = [{ role: 'user' as const, content: c.message }];
    // Score what the chat shows: the model's words, cleaned the way the driver
    // cleans them, then the harness's fixed line after the reply.
    const raw = await complete(system, messages);
    // An empty reply stays empty: the driver shows the line only after words.
    const words = sanitizeGuideText(raw).trim();
    const withText = words ? [words, plan.after].filter(Boolean).join('\n') : '';
    const withoutText = await complete(baselinePrompt(), messages);
    runs.push({
      id: c.id,
      withHarness: scoreAnswer(c, withText),
      without: scoreAnswer(c, withoutText),
    });
  }
  const mean = (pick: (r: AnswerRun) => number) =>
    runs.reduce((s, r) => s + pick(r), 0) / Math.max(1, runs.length);
  return {
    runs,
    withHarness: mean((r) => r.withHarness.score),
    without: mean((r) => r.without.score),
  };
}
