// The Harbor eval's deterministic half (src/lib/harborEval.ts): every case is
// well formed and its pictures are checked in at the phone's size, a picture
// turn fits Harbor's window, the rules score a right answer full and a wrong
// one down, a thought never counts, the code is found and really run, and a
// text-only model is compared without the picture cases. The answers half runs
// on the reference box (scripts/harbor-eval.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HARBOR_EVAL_CASES,
  HARBOR_EVAL_REPLY_TOKENS,
  HARBOR_SECTIONS,
  extractCode,
  harborEvalRequest,
  harborEvalTable,
  runHarborEval,
  scoreHarborAnswer,
  shownText,
  type HarborEvalCase,
} from '../src/lib/harborEval.js';
import {
  HARBOR_CONTEXT_TOKENS,
  HARBOR_IMAGE_TOKENS,
  HARBOR_PICTURE_NOTE,
} from '../src/lib/harbor.js';
import { estimateTokens } from '../src/drivers/deviceModel.js';
import { runCodeInVm } from '../scripts/harborEvalCode.js';

const FIXTURES = join(process.cwd(), 'scripts', 'harbor-eval');
const EM_DASH = String.fromCharCode(8212);

/** A PNG's width and height, read from its header. */
function pngSize(name: string): { width: number; height: number } {
  const bytes = readFileSync(join(FIXTURES, `${name}.png`));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const byId = (id: string) => HARBOR_EVAL_CASES.find((c) => c.id === id)!;

describe('the cases', () => {
  it('cover every section, with unique ids and something to check', () => {
    const ids = HARBOR_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HARBOR_SECTIONS) {
      expect(
        HARBOR_EVAL_CASES.some((c) => c.section === s),
        s,
      ).toBe(true);
    }
    for (const c of HARBOR_EVAL_CASES) {
      const checks = (c.mustInclude?.length ?? 0) + (c.mustMatch?.length ?? 0) + (c.code ? 1 : 0);
      expect(checks, c.id).toBeGreaterThan(0);
      expect(c.message).not.toContain(EM_DASH);
    }
  });

  it('keep every picture checked in, at most 700 pixels a side', () => {
    const names = new Set(HARBOR_EVAL_CASES.flatMap((c) => c.pictures ?? []));
    expect(names.size).toBeGreaterThanOrEqual(8);
    for (const name of names) {
      const { width, height } = pngSize(name);
      expect(Math.max(width, height), name).toBeLessThanOrEqual(700);
    }
  });

  it("fit Harbor's window with the pictures, and tell Harbor how to read them", () => {
    for (const c of HARBOR_EVAL_CASES.filter((x) => x.pictures?.length)) {
      const request = harborEvalRequest(c, true, () => 'AAAA');
      expect(request.messages.at(-1)!.images, c.id).toHaveLength(c.pictures!.length);
      expect(request.system).toContain(HARBOR_PICTURE_NOTE);
      const used =
        estimateTokens(request.system) +
        estimateTokens(c.message) +
        c.pictures!.length * HARBOR_IMAGE_TOKENS +
        HARBOR_EVAL_REPLY_TOKENS;
      expect(used, c.id).toBeLessThanOrEqual(HARBOR_CONTEXT_TOKENS);
    }
    const words = harborEvalRequest(byId('capital'), true, () => 'AAAA');
    expect(words.system).not.toContain(HARBOR_PICTURE_NOTE);
    const bare = harborEvalRequest(byId('bar-chart'), false, () => 'AAAA');
    expect(bare.system).toBe('You are a helpful assistant.');
    expect(bare.messages).toEqual([
      { role: 'user', content: byId('bar-chart').message, images: ['AAAA'] },
    ]);
  });
});

describe('the rules', () => {
  it('score a right answer full and a wrong one down', async () => {
    expect((await scoreHarborAnswer(byId('bar-chart'), 'B is tallest, at 7.')).score).toBe(1);
    const wrong = await scoreHarborAnswer(byId('bar-chart'), 'A is tallest, at 3.');
    expect(wrong.score).toBeLessThan(1);
    expect(wrong.misses).toEqual(['no \\bB\\b', 'no \\b7\\b']);
    expect((await scoreHarborAnswer(byId('capital'), '')).misses).toEqual(['empty']);
  });

  it('take a point for an em dash and for anything forbidden', async () => {
    const dashed = await scoreHarborAnswer(byId('capital'), `Canberra ${EM_DASH} the capital.`);
    expect(dashed.misses).toEqual(['em dash']);
    const app = await scoreHarborAnswer(byId('capital'), 'Canberra. OpenShore can help with more.');
    expect(app.misses).toEqual(['said OpenShore']);
    const pretend = await scoreHarborAnswer(
      byId('edit-repo'),
      "I've added the login page. Dock your computer next time.",
    );
    expect(pretend.misses).toHaveLength(1);
  });

  it('never count a thought, finished or cut off', () => {
    expect(shownText('<think>B? no, A.</think>A is tallest.')).toBe('A is tallest.');
    expect(shownText('<think>still thinking about B and 7')).toBe('');
  });

  it("find the reply's own function, fenced or bare", () => {
    const two =
      '```js\nconst x = 1;\n```\nThen:\n```javascript\nfunction sum(a) { return 0; }\n```';
    expect(extractCode(two, 'sum')).toContain('function sum');
    expect(extractCode('```\nconst sum = (a) => 0;\n```', 'sum')).toContain('const sum');
    expect(extractCode('function sum(a) { return 0; }', 'sum')).toContain('function sum');
    expect(extractCode('Just add them up.', 'sum')).toBeUndefined();
  });

  it('run the code against the tests, so a reply that does not work scores nothing', async () => {
    const fix = byId('fix-sum');
    const right =
      '```js\nfunction sum(arr) { let t = 0; for (let i = 0; i < arr.length; i++) t += arr[i]; return t; }\n```';
    const still =
      '```js\nfunction sum(arr) { let t = 0; for (let i = 1; i < arr.length; i++) t += arr[i]; return t; }\n```';
    expect((await scoreHarborAnswer(fix, right, runCodeInVm)).score).toBe(1);
    const failed = await scoreHarborAnswer(fix, still, runCodeInVm);
    expect(failed.score).toBe(0);
    expect(failed.misses[0]).toMatch(/^tests: /);
  });
});

describe('a run', () => {
  const answerAll = async () => ({ text: 'Canberra. B is tallest, at 7.' });

  it('scores both halves per section, and skips pictures for a text-only model', async () => {
    const cases: HarborEvalCase[] = [byId('capital'), byId('bar-chart')];
    const seeing = await runHarborEval({
      complete: answerAll,
      picture: () => 'AAAA',
      runCode: runCodeInVm,
      seesPictures: true,
      cases,
    });
    expect(seeing.runs.map((r) => r.id)).toEqual(['capital', 'bar-chart']);
    expect(seeing.sections.pictures.cases).toBe(1);
    const blind = await runHarborEval({
      complete: answerAll,
      picture: () => 'AAAA',
      runCode: runCodeInVm,
      seesPictures: false,
      cases,
    });
    expect(blind.runs.map((r) => r.id)).toEqual(['capital']);
    const table = harborEvalTable('qwen3.5:4b', blind, 12);
    expect(table).toContain('| everyday | 1 |');
    expect(table).not.toContain('| pictures |');
  });
});
