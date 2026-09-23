import { describe, it, expect } from 'vitest';
import {
  askJev,
  buildSystemOneBody,
  parseAnswers,
  readAnswer,
  buildClassifyQuestions,
  readClassify,
  buildGateQuestions,
  readGate,
  buildJudgeQuestions,
  readJudge,
  JevAdvisor,
  JEV_SYSTEMONE_PATH,
  type FetchLike,
  type ClassifyInput,
} from '../src/harness/jev.js';
import {
  HARNESS_CURRENT_IDS,
  isHarnessCurrentId,
  JEV_DEFAULT_MODEL,
  normalizeJevBaseUrl,
  parseHarnessCurrentsHandle,
} from '../src/currents/model.js';

describe('harness current wire shapes', () => {
  it('has jev as the roster and guards its id', () => {
    expect(HARNESS_CURRENT_IDS).toEqual(['jev']);
    expect(isHarnessCurrentId('jev')).toBe(true);
    expect(isHarnessCurrentId('hermes')).toBe(false);
    expect(isHarnessCurrentId(null)).toBe(false);
  });

  it('normalizes a pasted base url, dropping /v1 and /v1/systemone', () => {
    expect(normalizeJevBaseUrl('https://api.typesafe.ai/')).toBe('https://api.typesafe.ai');
    expect(normalizeJevBaseUrl('https://api.typesafe.ai/v1')).toBe('https://api.typesafe.ai');
    expect(normalizeJevBaseUrl('https://api.typesafe.ai/v1/systemone')).toBe(
      'https://api.typesafe.ai',
    );
  });

  it('parses a jev handle and drops a non-http endpoint', () => {
    expect(parseHarnessCurrentsHandle({ jev: { baseUrl: 'https://api.typesafe.ai/v1' } })).toEqual({
      jev: { baseUrl: 'https://api.typesafe.ai', apiKey: undefined, model: undefined },
    });
    expect(parseHarnessCurrentsHandle({ jev: { baseUrl: 'file:///etc/passwd' } })).toBeUndefined();
    expect(parseHarnessCurrentsHandle({})).toBeUndefined();
  });
});

describe('buildSystemOneBody', () => {
  it('defaults the model to the jev alias and passes state and questions', () => {
    const body = buildSystemOneBody(
      { baseUrl: 'https://api.typesafe.ai' },
      'hello',
      buildGateQuestions(),
    );
    expect(body.model).toBe(JEV_DEFAULT_MODEL);
    expect(body.state).toBe('hello');
    expect(body.questions.needsFrontier.type).toBe('noul');
  });
  it('honors a pinned model id', () => {
    const body = buildSystemOneBody(
      { baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0' },
      's',
      {},
    );
    expect(body.model).toBe('jev-1.13.0');
  });
});

describe('readAnswer', () => {
  it('reads bare scalar answers', () => {
    expect(readAnswer(true)).toEqual({ value: true });
    expect(readAnswer('billing')).toEqual({ value: 'billing' });
    expect(readAnswer(0.8)).toEqual({ value: 0.8 });
  });
  it('reads an object answer with a value and a confidence', () => {
    expect(readAnswer({ choice: 'coding', probability: 0.91 })).toEqual({
      value: 'coding',
      probability: 0.91,
    });
    expect(readAnswer({ value: false, confidence: 0.7 })).toEqual({
      value: false,
      probability: 0.7,
    });
  });
});

describe('parseAnswers', () => {
  it('reads answers at the top level or under answers', () => {
    expect(parseAnswers({ needsFrontier: true }, ['needsFrontier'])).toEqual({
      needsFrontier: { value: true },
    });
    expect(parseAnswers({ answers: { category: 'coding' } }, ['category'])).toEqual({
      category: { value: 'coding' },
    });
  });
  it('is undefined when no requested key is present', () => {
    expect(parseAnswers({ other: 1 }, ['category'])).toBeUndefined();
    expect(parseAnswers(null, ['x'])).toBeUndefined();
  });
});

describe('the three job readers', () => {
  const classifyInput: ClassifyInput = {
    request: 'refactor the parser',
    categories: { coding: 'writing or editing code', reasoning: 'hard multi step thought' },
  };

  it('classify reads a chosen category and refuses one off the list', () => {
    expect(
      readClassify({ category: { value: 'coding', probability: 0.9 } }, classifyInput),
    ).toEqual({
      category: 'coding',
      probability: 0.9,
      line: expect.stringContaining('coding'),
    });
    expect(readClassify({ category: { value: 'astrology' } }, classifyInput)).toBeUndefined();
    expect(buildClassifyQuestions(classifyInput).category.type).toBe('choice');
  });

  it('gate reads escalate yes/no and speaks to spend', () => {
    expect(readGate({ needsFrontier: { value: true } })?.escalate).toBe(true);
    const local = readGate({ needsFrontier: { value: false, probability: 0.82 } });
    expect(local?.escalate).toBe(false);
    expect(local?.line).toContain('not spent');
    expect(readGate({})).toBeUndefined();
    expect(buildGateQuestions().needsFrontier.type).toBe('noul');
  });

  it('judge reads pass/fail', () => {
    expect(readJudge({ satisfied: { value: 'yes' } })?.passed).toBe(true);
    expect(readJudge({ satisfied: { value: false } })?.passed).toBe(false);
    expect(readJudge({})).toBeUndefined();
    expect(buildJudgeQuestions().satisfied.type).toBe('noul');
  });
});

describe('askJev and the advisor', () => {
  function fakeFetch(
    payload: unknown,
    ok = true,
  ): { impl: FetchLike; calls: Array<{ url: string; body: string }> } {
    const calls: Array<{ url: string; body: string }> = [];
    const impl: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok, status: ok ? 200 : 500, json: async () => payload };
    };
    return { impl, calls };
  }

  it('posts to the systemone path with a bearer key and parses answers', async () => {
    const { impl, calls } = fakeFetch({ needsFrontier: { value: true, probability: 0.6 } });
    const answers = await askJev(
      { baseUrl: 'https://api.typesafe.ai', apiKey: 'k' },
      'do a hard thing',
      buildGateQuestions(),
      impl,
    );
    expect(answers?.needsFrontier).toEqual({ value: true, probability: 0.6 });
    expect(calls[0]!.url).toBe('https://api.typesafe.ai' + JEV_SYSTEMONE_PATH);
    expect(JSON.parse(calls[0]!.body).model).toBe(JEV_DEFAULT_MODEL);
  });

  it('returns undefined on a non-ok response instead of throwing', async () => {
    const { impl } = fakeFetch({}, false);
    expect(
      await askJev({ baseUrl: 'https://x.dev' }, 's', buildGateQuestions(), impl),
    ).toBeUndefined();
  });

  it('returns undefined when fetch throws', async () => {
    const impl: FetchLike = async () => {
      throw new Error('network down');
    };
    expect(
      await askJev({ baseUrl: 'https://x.dev' }, 's', buildGateQuestions(), impl),
    ).toBeUndefined();
  });

  it('JevAdvisor.from is undefined without a jev handle or a fetch', () => {
    const { impl } = fakeFetch({});
    expect(JevAdvisor.from(undefined, impl)).toBeUndefined();
    expect(JevAdvisor.from({ jev: { baseUrl: 'https://x.dev' } }, undefined)).toBeUndefined();
    expect(JevAdvisor.from({ jev: { baseUrl: 'https://x.dev' } }, impl)).toBeInstanceOf(JevAdvisor);
  });

  it('advisor.gate returns a decision from the response', async () => {
    const { impl } = fakeFetch({ needsFrontier: { value: false } });
    const advisor = JevAdvisor.from({ jev: { baseUrl: 'https://api.typesafe.ai' } }, impl)!;
    const gate = await advisor.gate('add a comment');
    expect(gate?.escalate).toBe(false);
  });

  it('advisor.steer asks the gate and the classifier in one call', async () => {
    const { impl, calls } = fakeFetch({
      needsFrontier: { value: false },
      category: { value: 'coding', probability: 0.9 },
    });
    const advisor = JevAdvisor.from({ jev: { baseUrl: 'https://api.typesafe.ai' } }, impl)!;
    const decision = await advisor.steer({
      request: 'fix the bug',
      categories: { coding: 'writing or editing code' },
    });
    expect(decision?.gate?.escalate).toBe(false);
    expect(decision?.classify?.category).toBe('coding');
    // One request, both questions.
    expect(calls.length).toBe(1);
    const body = JSON.parse(calls[0]!.body);
    expect(Object.keys(body.questions).sort()).toEqual(['category', 'needsFrontier']);
  });
});
