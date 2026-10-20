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
import { NO_SEARCH_NOTE } from 'os-code/protocol';
import {
  HARBOR_CONTEXT_TOKENS,
  HARBOR_IMAGE_TOKENS,
  HARBOR_PICTURE_NOTE,
  buildHarborSystemPrompt,
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

  // A right answer for every code case, so no case asks for what its tests
  // cannot pass, and a new code case is not done until it has one here.
  const RIGHT: Record<string, string> = {
    'reverse-emoji': 'function reverseString(s) { return [...s].reverse().join(""); }',
    palindrome:
      'function isPalindrome(s) { const t = s.toLowerCase().replace(/[^a-z0-9]/g, ""); return t === [...t].reverse().join(""); }',
    chunk:
      'function chunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }',
    'parse-query': `function parseQuery(qs) {
      const out = {};
      for (const [k, v] of new URLSearchParams(qs)) {
        if (!(k in out)) out[k] = v;
        else out[k] = [].concat(out[k], v);
      }
      return out;
    }`,
    'fix-sum':
      'function sum(arr) { let t = 0; for (let i = 0; i < arr.length; i++) t += arr[i]; return t; }',
    'group-by':
      'function groupBy(items, keyFn) { const out = {}; for (const x of items) (out[keyFn(x)] ??= []).push(x); return out; }',
    'camel-case': `function camelCase(s) {
      return s.split(/[\\s_-]+/).filter(Boolean).map((w, i) =>
        i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join('');
    }`,
    retry: `async function retry(fn, times) {
      let last;
      for (let i = 0; i < times; i++) {
        try { return await fn(); } catch (e) { last = e; }
      }
      throw last;
    }`,
    'title-case':
      'function titleCase(s) { return s.split(" ").map((w) => w && w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" "); }',
    flatten:
      'function flatten(arr) { return arr.reduce((out, x) => out.concat(Array.isArray(x) ? flatten(x) : [x]), []); }',
    'unique-by':
      'function uniqueBy(items, keyFn) { const seen = new Set(); return items.filter((x) => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; }); }',
    'char-count': 'function charCount(s) { return [...s].length; }',
    'format-bytes': `function formatBytes(n) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return Number(n.toFixed(1)) + ' ' + units[i];
    }`,
    'map-series':
      'async function mapSeries(items, fn) { const out = []; for (const x of items) out.push(await fn(x)); return out; }',
    'csv-line': `function parseCsvLine(line) {
      const out = [];
      let field = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
          else if (c === '"') quoted = false;
          else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { out.push(field); field = ''; }
        else field += c;
      }
      out.push(field);
      return out;
    }`,
    range: `function range(start, end, step = 1) {
      const out = [];
      for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i);
      return out;
    }`,
  };

  it('ask for code a right answer passes', async () => {
    const coded = HARBOR_EVAL_CASES.filter((c) => c.code);
    expect(coded.length).toBeGreaterThanOrEqual(16);
    for (const c of coded) {
      expect(RIGHT[c.id], `a right answer for ${c.id}`).toBeDefined();
      const ran = await runCodeInVm(RIGHT[c.id], c.code!.tests, c.code!.fn);
      expect(ran, c.id).toEqual({ ok: true });
    }
  }, 60_000);

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
      const request = harborEvalRequest(c, true, () => 'AAAA', true);
      expect(request.messages.at(-1)!.images, c.id).toHaveLength(c.pictures!.length);
      expect(request.system).toContain(HARBOR_PICTURE_NOTE);
      const used =
        estimateTokens(request.system) +
        estimateTokens(c.message) +
        c.pictures!.length * HARBOR_IMAGE_TOKENS +
        HARBOR_EVAL_REPLY_TOKENS;
      expect(used, c.id).toBeLessThanOrEqual(HARBOR_CONTEXT_TOKENS);
    }
    // A turn in words carries the picture line while the model reads pictures,
    // as the phone's prompt does with the vision file on it, and not otherwise.
    const words = harborEvalRequest(byId('capital'), true, () => 'AAAA', true);
    expect(words.system).toBe(buildHarborSystemPrompt(false, NO_SEARCH_NOTE, true));
    expect(words.system).toContain(HARBOR_PICTURE_NOTE);
    const blind = harborEvalRequest(byId('capital'), true, () => 'AAAA', false);
    expect(blind.system).not.toContain(HARBOR_PICTURE_NOTE);
    const bare = harborEvalRequest(byId('bar-chart'), false, () => 'AAAA', true);
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

  it('runs only the harness half when asked, and the table says the rest did not run', async () => {
    const asked: boolean[] = [];
    const quick = await runHarborEval({
      complete: async (request) => {
        asked.push(request.harness);
        return { text: 'Canberra.' };
      },
      picture: () => 'AAAA',
      runCode: runCodeInVm,
      seesPictures: true,
      cases: [byId('capital')],
      without: false,
    });
    expect(asked).toEqual([true]);
    expect(quick.withHarness).toBe(1);
    const table = harborEvalTable('qwen3.5:4b', quick, 3);
    expect(table).toContain('| everyday | 1 | 100% | not run |');
    expect(table).toContain('| all | 1 | 100% | not run |');
  });

  it('keeps the runs an interrupted pass scored and asks only the rest', async () => {
    const cases: HarborEvalCase[] = [byId('capital'), byId('fahrenheit')];
    const asked: string[] = [];
    const first = await runHarborEval({
      complete: answerAll,
      picture: () => 'AAAA',
      runCode: runCodeInVm,
      seesPictures: true,
      cases: [byId('capital')],
    });
    const resumed = await runHarborEval({
      complete: async (request) => {
        asked.push(request.messages.at(-1)!.content);
        return { text: '72 F is 22 C.' };
      },
      picture: () => 'AAAA',
      runCode: runCodeInVm,
      seesPictures: true,
      cases,
      prior: first.runs,
    });
    expect(asked).toEqual([byId('fahrenheit').message, byId('fahrenheit').message]);
    expect(resumed.runs.map((r) => r.id)).toEqual(['capital', 'fahrenheit']);
    expect(resumed.runs[0]).toBe(first.runs[0]);
    expect(resumed.withHarness).toBe(1);
  });
});
