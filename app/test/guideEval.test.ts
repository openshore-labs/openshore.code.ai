// Harbor Lite's guide harness, gated on its numbers (tenet 2). The decisions
// half of the guide eval needs no model, so it runs on every push: each
// question takes the right route, pulls the card that answers it, and leaves
// room in the window. The answers half runs on the reference box
// (scripts/guide-eval.ts); its scorer is pinned here so the box number means
// what it says.
import { describe, expect, it } from 'vitest';
import {
  GUIDE_EVAL_CASES,
  baselinePrompt,
  runAnswerEval,
  scoreAnswer,
  scoreDecisions,
  worstCaseHeadroom,
} from '../src/lib/guideEval.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import {
  buildGuidePrompt,
  planGuideTurn,
  readEquipment,
  sanitizeGuideText,
  setupAdvice,
  STRETCH_NOTE,
} from '../src/lib/guideHarness.js';
import { buildHarborMiniSystemPrompt, HARBOR_MINI_PERSONA } from '../src/lib/harborMini.js';
import { estimateTokens } from '../src/drivers/deviceModel.js';

describe('guide eval, decisions', () => {
  const score = scoreDecisions();

  it('routes every question the right way', () => {
    const wrong = score.results.filter((r) => !r.routeOk).map((r) => `${r.id}->${r.route}`);
    expect(wrong).toEqual([]);
    expect(score.routeAccuracy).toBe(1);
  });

  it('pulls the card that answers every app question', () => {
    const missed = score.results.filter((r) => !r.cardOk).map((r) => r.id);
    expect(missed).toEqual([]);
  });

  it('leaves room for history and a reply even on the biggest turn', () => {
    expect(worstCaseHeadroom()).toBeGreaterThan(800);
  });

  it('is far leaner than every fact on every turn', () => {
    const lean = estimateTokens(buildHarborMiniSystemPrompt('How does Your stack work?'));
    expect(lean * 2).toBeLessThan(estimateTokens(baselinePrompt()));
  });
});

describe('equipment and setup advice', () => {
  it('reads memory, GPU, and Mac without guessing', () => {
    expect(readEquipment('16GB laptop, no GPU')).toMatchObject({ ramGB: 16, gpu: false });
    expect(readEquipment('64gb and an RTX 4090')).toMatchObject({
      ramGB: 64,
      gpu: true,
      gpuVramGB: 24,
    });
    expect(readEquipment('MacBook Pro M3 with 36GB')).toMatchObject({ ramGB: 36, mac: true });
    expect(readEquipment('a 1TB SSD')).toEqual({});
    expect(readEquipment('I only have my iPhone')).toMatchObject({ phoneOnly: true });
  });

  it('sizes DeepBlue from the fit table, not from the model', () => {
    expect(setupAdvice({ ramGB: 8, gpu: false })[0]).toContain('3B');
    expect(setupAdvice({ ramGB: 16, gpu: false })[0]).toContain('7B');
    expect(setupAdvice({ ramGB: 36, mac: true })[0]).toContain('14B');
    expect(setupAdvice({ ramGB: 64, gpu: true, gpuVramGB: 24 })[0]).toMatch(/14B|32B/);
  });

  it('asks for the machine when it was not described', () => {
    expect(setupAdvice({}).join(' ')).toMatch(/memory/i);
  });

  it('puts the worked-out advice in the prompt, numbers intact', () => {
    const plan = planGuideTurn({
      message: 'I have 16 GB of RAM, what should I run?',
      cards: GUIDE_CARDS,
    });
    const prompt = buildGuidePrompt({ persona: HARBOR_MINI_PERSONA, plan });
    expect(prompt).toContain('Qwen 2.5 Coder 7B');
  });
});

describe('web and stretch turns', () => {
  it('searches a factual question the app does not cover, and cites the results', () => {
    const plan = planGuideTurn({
      message: 'What is the capital of Australia?',
      cards: GUIDE_CARDS,
    });
    expect(plan.searchQuery).toBe('What is the capital of Australia');
    const prompt = buildGuidePrompt({
      persona: HARBOR_MINI_PERSONA,
      plan,
      sources: [{ title: 'Canberra', url: 'https://x', snippet: 'Canberra is the capital.' }],
    });
    expect(prompt).toContain('[1] Canberra');
  });

  it('says plainly when the search failed', () => {
    const plan = planGuideTurn({
      message: 'What is the capital of Australia?',
      cards: GUIDE_CARDS,
    });
    expect(buildGuidePrompt({ persona: HARBOR_MINI_PERSONA, plan, searchFailed: true })).toMatch(
      /could not reach/,
    );
  });

  it('never searches the web for a question about the app', () => {
    for (const c of GUIDE_EVAL_CASES.filter((x) => x.route === 'app')) {
      expect(planGuideTurn({ message: c.message, cards: GUIDE_CARDS }).searchQuery).toBeUndefined();
    }
  });

  it('marks a coding ask as past its size, with the honest note', () => {
    const plan = planGuideTurn({
      message: 'Write a Python function that parses JSON',
      cards: GUIDE_CARDS,
    });
    expect(plan.route).toBe('stretch');
    expect(plan.stretch).toMatch(/Harbor/);
  });
});

describe('guide eval, answers', () => {
  const c = GUIDE_EVAL_CASES.find((x) => x.id === 'pair')!;

  it('scores an empty answer zero and a grounded one full', () => {
    expect(scoreAnswer(c, '').score).toBe(0);
    expect(scoreAnswer(c, 'Install Tailscale on both, then scan the QR code.').score).toBe(1);
  });

  it('marks a missing fact and an em dash', () => {
    const s = scoreAnswer(c, `Just scan it ${String.fromCharCode(8212)} easy.`);
    expect(s.misses).toEqual(['missing tailscale', 'em dash']);
  });

  it('runs with and without the harness on an injected model', async () => {
    const seen: string[] = [];
    const out = await runAnswerEval(
      async (system) => {
        seen.push(system);
        return 'Tailscale links them.';
      },
      undefined,
      [c],
    );
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(baselinePrompt());
    expect(out.withHarness).toBe(1);
  });
});

describe('what the reference box eval taught (2026-09-24)', () => {
  it('shows the worked-out size after a setup reply, so the number never gets lost', () => {
    const plan = planGuideTurn({
      message: 'I have a laptop with 8GB of RAM and no GPU. What should I use?',
      cards: GUIDE_CARDS,
    });
    expect(plan.after).toContain('Qwen 2.5 Coder 3B');
    expect(
      planGuideTurn({ message: 'What model should I get for my computer?', cards: GUIDE_CARDS })
        .after,
    ).toBeUndefined();
  });

  it('shows the past-my-size note after a stretch reply', () => {
    const plan = planGuideTurn({ message: 'Write a Python function', cards: GUIDE_CARDS });
    expect(plan.after).toBe(STRETCH_NOTE);
  });

  it('never shows an em dash in a Harbor Lite reply', () => {
    const dash = String.fromCharCode(8212);
    expect(sanitizeGuideText(`Tokyo is ahead ${dash} about 9 hours${dash}right now.`)).toBe(
      'Tokyo is ahead, about 9 hours, right now.',
    );
  });

  it('scores the shown text: words plus the fixed line, and an empty reply stays empty', async () => {
    const fit = GUIDE_EVAL_CASES.find((x) => x.id === 'fit-8')!;
    const words = await runAnswerEval(async () => 'Go with DeepBlue.', undefined, [fit]);
    expect(words.withHarness).toBe(1);
    const empty = await runAnswerEval(async () => '', undefined, [fit]);
    expect(empty.withHarness).toBe(0);
  });
});
