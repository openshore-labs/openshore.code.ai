// The research eval asks the way the phone does (one search, then an answer
// pass told it already searched) and scores by rule, never a judge.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEARCHED_NOTE, SEARCH_PROTOCOL_NOTE } from 'os-code/protocol';
import { describe, expect, it } from 'vitest';
import type { HarborRequest } from '../src/lib/harborEval';
import {
  RESEARCH_CASES,
  SEARCH_WHEN_UNSURE_NOTE,
  harborNeedsWeb,
  harborSearchesByDefault,
  researchTable,
  researchWithHarness,
  researchWithout,
  scoreResearchAnswer,
  type ResearchCase,
} from '../src/lib/harborResearch';

const here = dirname(fileURLToPath(import.meta.url));
const EM_DASH = String.fromCharCode(8212);

const lts: ResearchCase = {
  id: 'node-lts',
  question: 'What is the latest LTS version of Node.js?',
  needsSearch: true,
  query: [['node']],
  mustInclude: [['24']],
};
const results = [
  { title: 'Node.js', url: 'https://nodejs.org/en/download', snippet: 'Get Node.js v24.22 LTS.' },
];

describe('the research flow', () => {
  it('searches once, then answers from the results on a pass told it searched', async () => {
    const asked: HarborRequest[] = [];
    const half = await researchWithHarness(
      lts,
      async (request) => {
        asked.push(request);
        return {
          text:
            asked.length === 1
              ? 'SEARCH: latest node lts'
              : 'Node.js 24 is the current LTS (https://nodejs.org/en/download).',
        };
      },
      async () => results,
    );
    expect(asked).toHaveLength(2);
    expect(asked[0]!.system).toContain(SEARCH_PROTOCOL_NOTE);
    expect(asked[1]!.system).toContain(SEARCHED_NOTE);
    expect(asked[1]!.messages.at(-1)!.content).toContain('https://nodejs.org/en/download');
    expect(half).toMatchObject({ searched: true, query: 'latest node lts', queryOk: true, cited: true, score: 1 });
  });

  it('scores an answer from memory with no search, and a failed search honestly', async () => {
    const memory = await researchWithHarness(lts, async () => ({ text: 'Node.js 20 is LTS.' }), async () => results);
    expect(memory.searched).toBe(false);
    expect(memory.misses).toEqual(['missing 24']);
    let second = '';
    await researchWithHarness(
      lts,
      async (request) => {
        if (request.messages.length === 2) second = request.messages[1]!.content;
        return { text: request.messages.length === 1 ? 'SEARCH: node lts' : 'I could not search.' };
      },
      async () => {
        throw new Error('DuckDuckGo asked to confirm a person was searching');
      },
    );
    expect(second).toMatch(/^Search failed: DuckDuckGo asked/);
  });

  it('asks the bare half with no web at all', async () => {
    const asked: HarborRequest[] = [];
    await researchWithout(lts, async (r) => {
      asked.push(r);
      return { text: '24' };
    });
    expect(asked[0]!.system).toBe('You are a helpful assistant.');
    expect(asked[0]!.harness).toBe(false);
  });

  it('scores an answer right or wrong: a wrong one nothing, a dash a quarter off', () => {
    const honest: ResearchCase = { ...lts, mustNot: [/\b\d+\.\d+\.\d+\b/] };
    // A confidently wrong answer is wrong, however tidy (it once kept two thirds).
    expect(scoreResearchAnswer(honest, 'It is 1.2.3, released last year.')).toEqual({
      score: 0,
      misses: ['missing 24', 'said \\b\\d+\\.\\d+\\.\\d+\\b'],
    });
    expect(scoreResearchAnswer(lts, `Node 24 ${EM_DASH} the LTS.`)).toEqual({ score: 0.75, misses: ['em dash'] });
    expect(scoreResearchAnswer(lts, 'Node 24 is the LTS.').score).toBe(1);
  });

  it('with the lever, searches first by rule for a current question', async () => {
    const asked: HarborRequest[] = [];
    const half = await researchWithHarness(
      lts,
      async (request) => {
        asked.push(request);
        return { text: 'Node 24 is the LTS (https://nodejs.org/en/download).' };
      },
      async () => results,
      { searchFirst: true },
    );
    // One pass only: the harness searched with the question before Harbor wrote.
    expect(asked).toHaveLength(1);
    expect(asked[0]!.system).toContain(SEARCHED_NOTE);
    expect(asked[0]!.system).toMatch(/Today is \w+day, \w+ \d{1,2}, \d{4}\./);
    expect(half).toMatchObject({ searched: true, query: lts.question, score: 1 });
    expect(harborNeedsWeb('Who won the 2026 FIFA World Cup?')).toBe(true);
    expect(harborNeedsWeb('Who is the CEO of Intel now?')).toBe(true);
    expect(harborNeedsWeb('What does HTTP status 404 mean?')).toBe(false);
    expect(harborNeedsWeb('Explain what a JavaScript closure is in two sentences.')).toBe(false);
  });

  it('reports search behavior beside the table', () => {
    const half = { score: 1, misses: [], searched: true, queryOk: true, cited: true, seconds: 30, answer: '', replies: [] };
    const table = researchTable(
      'qwen3.5:4b',
      [
        { id: 'a', needsSearch: true, withHarness: half, without: { ...half, score: 0, searched: false } },
        { id: 'b', needsSearch: false, withHarness: { ...half, searched: false }, without: half },
      ],
      60,
    );
    expect(table).toContain('| need the web | 1 | 100% | 0% |');
    expect(table).toContain('Searched when the question needed the web: 1 of 1.');
    expect(table).toContain('Searched when it did not: 0 of 1.');
  });
});

describe('searching by default', () => {
  it('searches a question about the world, and skips what stays true, code, the app and requests', () => {
    for (const q of [
      "Who's running Disney these days?",
      'Is Tim Cook still the CEO of Apple?',
      'Does the US Mint still make pennies?',
      "What's the battery life of the Lumora Halo X2 smart ring?",
      "What's the latest version of the npm package harbor-zq-frobnicate?",
    ]) {
      expect(harborSearchesByDefault(q), q).toBe(true);
    }
    for (const q of [
      'How do I check which version of Git is installed on my machine?',
      'Explain what a JavaScript closure is in two sentences.',
      'What does HTTP status 404 mean?',
      'Write a JavaScript function chunk(arr, size).',
      'How does Stack work?',
      'Do my keys leave my phone?',
      'Run npm test in my project and tell me which tests fail.',
    ]) {
      expect(harborSearchesByDefault(q), q).toBe(false);
    }
    expect(harborSearchesByDefault('Who won the 2026 World Cup?', true)).toBe(false);
  });

  it('can hand the model a sharper search line instead', async () => {
    const asked: HarborRequest[] = [];
    await researchWithHarness(
      lts,
      async (r) => {
        asked.push(r);
        return { text: 'Node 24.' };
      },
      async () => results,
      { searchNote: SEARCH_WHEN_UNSURE_NOTE },
    );
    expect(asked[0]!.system).toContain(SEARCH_WHEN_UNSURE_NOTE);
  });
});

describe('the rules', () => {
  it('count an honest "not found" in its own words as right', () => {
    // Harbor's answer on the box (2026-10-19), scored down by a phrase list
    // that lacked "do not show".
    const fake = RESEARCH_CASES.find((c) => c.id === 'fake-package')!;
    const said =
      'The search results do not show an npm package named `harbor-zq-frobnicate`. The closest match found is **`@hapic/harbor`**, version **3.0.2**.';
    expect(scoreResearchAnswer(fake, said)).toEqual({ score: 1, misses: [] });
    expect(scoreResearchAnswer(fake, 'harbor-zq-frobnicate is at version 2.4.1.').score).toBe(0);
  });
});

describe('the cases', () => {
  it('each have saved results to answer from, and something to check', () => {
    const saved = JSON.parse(
      readFileSync(join(here, '../scripts/harbor-research/results.json'), 'utf8'),
    ) as Record<string, { results: unknown[] }>;
    for (const c of RESEARCH_CASES) {
      expect(saved[c.id], c.id).toBeDefined();
      expect((c.mustInclude?.length ?? 0) + (c.mustNot?.length ?? 0), c.id).toBeGreaterThan(0);
      expect(c.question).not.toContain(EM_DASH);
    }
  });
});
