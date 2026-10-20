// A Harbor coding request thinks first with a capped thought; every other
// turn answers at once (founder, 2026-10-19). The rule is one function the
// drivers and the eval share, and the cutoff words are the runner's own.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEVICE_TIMING, deviceTimingLine, deviceTurnShape } from '../src/drivers/deviceModel';
import {
  HARBOR_MODEL_ID,
  HARBOR_SAMPLING,
  HARBOR_THINK_BUDGET,
  HARBOR_THINK_SAMPLING,
  HARBOR_THOUGHT_CUTOFF,
  buildHarborSystemPrompt,
  harborDateLine,
  harborThinks,
} from '../src/lib/harbor';
import { HARBOR_EVAL_CASES, harborEvalRequest } from '../src/lib/harborEval';

const here = dirname(fileURLToPath(import.meta.url));

describe('which turns think', () => {
  it('a coding request thinks', () => {
    for (const ask of [
      'Write a JavaScript function that reverses a string.',
      'Can you fix this bug in my code?',
      'Refactor this class to use async/await.',
      'Implement a regex that matches an email address.',
      'Here is my code:\n```js\nconst x = 1\n```',
    ]) {
      expect(harborThinks(ask), ask).toBe(true);
    }
  });

  it('a chat or app question answers at once', () => {
    for (const ask of [
      'What is the capital of Australia?',
      'How do I connect my computer?',
      'What does the Vault do?',
      'Make me a cup of tea.',
      'Explain what a closure is.',
    ]) {
      expect(harborThinks(ask), ask).toBe(false);
    }
  });

  it('a turn with pictures answers at once until that path is measured', () => {
    expect(harborThinks("What's the bug in this code?", true)).toBe(false);
  });

  it('in the eval, exactly the code cases think', () => {
    for (const c of HARBOR_EVAL_CASES) {
      const request = harborEvalRequest(c, true, () => 'AAAA', true);
      expect(request.shape?.thinking, c.id).toBe(c.section === 'code');
      expect(harborEvalRequest(c, false, () => 'AAAA', true).shape, c.id).toBeUndefined();
    }
  });
});

describe('the turn shape', () => {
  const opts = { cot: false, guide: false, base: 768, temperature: 0.7 };
  const code = { content: 'Write a JavaScript function chunk(arr, size).', pictures: false };
  const chat = { content: 'What is the capital of Australia?', pictures: false };

  it('gives a coding request a capped, shown thought beside a full answer', () => {
    const shape = deviceTurnShape(HARBOR_MODEL_ID, code, opts);
    expect(shape).toMatchObject({
      thinking: true,
      showThought: true,
      maxTokens: 768,
      thinkBudget: HARBOR_THINK_BUDGET,
      sampling: HARBOR_THINK_SAMPLING,
    });
    expect(shape.replyRoom).toBeGreaterThan(768 + HARBOR_THINK_BUDGET);
  });

  it('keeps a chat turn quick, and Chain of Thought its doubled cap', () => {
    expect(deviceTurnShape(HARBOR_MODEL_ID, chat, opts)).toMatchObject({
      thinking: false,
      showThought: false,
      maxTokens: 768,
      thinkBudget: 0,
      sampling: HARBOR_SAMPLING,
    });
    expect(deviceTurnShape(HARBOR_MODEL_ID, chat, { ...opts, cot: true })).toMatchObject({
      thinking: true,
      maxTokens: 1536,
      thinkBudget: 0,
    });
  });

  it('never makes a guide turn or another device model think on its own', () => {
    expect(deviceTurnShape(HARBOR_MODEL_ID, code, { ...opts, guide: true }).thinking).toBe(false);
    expect(deviceTurnShape('qwen3-1.7b', code, opts).thinking).toBe(false);
  });
});

describe('the cutoff', () => {
  it('is the same words the runner writes', () => {
    const swift = readFileSync(
      join(here, '../plugins/oscode-llama/ios/Sources/OscodeLlamaPlugin/PromptFormat.swift'),
      'utf8',
    );
    const literal = /static let thoughtCutoff =\s*"((?:[^"\\]|\\.)*)"/.exec(swift)?.[1];
    expect(literal).toBeDefined();
    expect(literal!.replace(/\\n/g, '\n')).toBe(HARBOR_THOUGHT_CUTOFF);
    expect(HARBOR_THOUGHT_CUTOFF).toContain('</think>');
  });
});

describe("today's date", () => {
  it('is in every Harbor prompt, read from the clock', () => {
    expect(harborDateLine(new Date(2026, 9, 19, 9, 30))).toBe('Today is Monday, October 19, 2026.');
    expect(buildHarborSystemPrompt(true)).toContain(harborDateLine());
  });
});

describe('the timing line a measurement build shows', () => {
  it('says what the prompt, the thought and the answer took', () => {
    expect(
      deviceTimingLine({
        promptTokens: 2410,
        promptSeconds: 3.14,
        thoughtTokens: 812,
        thoughtSeconds: 41.2,
        answerTokens: 230,
        answerSeconds: 11.6,
      }),
    ).toBe(
      'Timing on this device: read the prompt (2,410 tokens) in 3.1 s; thought 812 tokens in 41.2 s, 19.7 tokens/s; answered 230 tokens in 11.6 s, 19.8 tokens/s; 55.9 s in all.',
    );
    expect(
      deviceTimingLine({
        promptTokens: 900,
        promptSeconds: 1,
        thoughtTokens: 0,
        thoughtSeconds: 0,
        answerTokens: 50,
        answerSeconds: 2,
      }),
    ).not.toContain('thought');
  });

  it('is off unless the build asks for it', () => {
    expect(DEVICE_TIMING).toBe(false);
  });
});
