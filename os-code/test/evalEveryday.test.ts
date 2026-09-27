// The everyday suite and the head-to-head baseline. The checkers must tell a
// finished job from an unfinished one by behavior alone (no judge model), the
// baseline must read Claude Code's own output into the same report shape, and
// the floor run must plan every with and without pair the founder's box owes.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUTTON_CHECK,
  CHART_DATA,
  EVAL_EVERYDAY_TASKS,
  PHOTO_KEEP,
  PHOTO_RENAMES,
  SITE_EMAIL,
  gradeButton,
  gradeChart,
  gradePhotos,
  gradeSite,
} from '../src/eval/everydayTasks.js';
import {
  BASELINE_ALLOWED_TOOLS,
  baselineArgs,
  baselineEnv,
  ollamaRoot,
  parseStreamJson,
} from '../src/eval/baseline.js';
import { defaultTasks, runEvalV2, runSuffix, type DriveTask } from '../src/eval/v2.js';
import { floorMarkdown, floorPlan } from '../src/commands/evalFloor.js';
import { evalApprover } from '../src/commands/eval.js';
import type { ApprovalRequest } from '../src/core/agent/types.js';

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'osc-everyday-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

const task = (id: string) => EVAL_EVERYDAY_TASKS.find((t) => t.id === id)!;

describe('the everyday suite', () => {
  it('is four jobs, none with a test script of its own', () => {
    expect(EVAL_EVERYDAY_TASKS.map((t) => t.id)).toEqual([
      'everyday-site',
      'everyday-photos',
      'everyday-chart',
      'everyday-button',
    ]);
    expect(EVAL_EVERYDAY_TASKS.every((t) => t.verifyScript === undefined)).toBe(true);
    expect(defaultTasks({}, 'everyday')).toBe(EVAL_EVERYDAY_TASKS);
    expect(defaultTasks({ numCtx: 'auto' }, 'everyday')).toBe(EVAL_EVERYDAY_TASKS);
  });

  it('grades the bakery page part by part', () => {
    const full = `<!doctype html><html><body><h1>Rise &amp; Crumb</h1><p>Open Tuesday to Sunday, 7am to 3pm.</p><a href="mailto:${SITE_EMAIL}">Email us</a></body></html>`;
    expect(gradeSite(full).score).toBe(1);
    expect(gradeSite(undefined).score).toBe(0);
    const noEmail = full.replace(/<a [^>]+>Email us<\/a>/, '');
    expect(gradeSite(noEmail)).toMatchObject({ score: 0.75 });
    expect(gradeSite(noEmail).detail).toMatch(/email link/);
    const noHours = full.replace('Open Tuesday to Sunday, 7am to 3pm.', 'Come by.');
    expect(gradeSite(noHours).score).toBe(0.75);
    const headingElsewhere = full.replace('<h1>Rise &amp; Crumb</h1>', '<h1>Welcome</h1>');
    expect(gradeSite(headingElsewhere).detail).toMatch(/main heading/);
  });

  it('grades the photos by name and content, and guards the notes file', () => {
    const start = Object.fromEntries([
      ...PHOTO_RENAMES.map((p) => [`photos/${p.from}`, p.content]),
      [`photos/${PHOTO_KEEP.name}`, PHOTO_KEEP.content],
    ]);
    const untouched = workspace(start);
    expect(gradePhotos(join(untouched, 'photos')).score).toBe(0);

    const done = workspace(
      Object.fromEntries([
        ...PHOTO_RENAMES.map((p) => [`photos/${p.to}`, p.content]),
        [`photos/${PHOTO_KEEP.name}`, PHOTO_KEEP.content],
      ]),
    );
    expect(gradePhotos(join(done, 'photos')).score).toBe(1);

    // Copies instead of moves: the old names are still there.
    const copied = workspace({
      ...start,
      ...Object.fromEntries(PHOTO_RENAMES.map((p) => [`photos/${p.to}`, p.content])),
    });
    expect(gradePhotos(join(copied, 'photos')).score).toBe(0);

    // Renamed the notes too: capped at half.
    const tooMuch = workspace(
      Object.fromEntries([
        ...PHOTO_RENAMES.map((p) => [`photos/${p.to}`, p.content]),
        ['photos/2024-01-01_00-00.txt', PHOTO_KEEP.content],
      ]),
    );
    expect(gradePhotos(join(tooMuch, 'photos'))).toMatchObject({ score: 0.5 });
    for (const dir of [untouched, done, copied, tooMuch])
      rmSync(dir, { recursive: true, force: true });
  });

  it('grades the chart: the data inside it and something drawn', () => {
    const bars = CHART_DATA.map(
      (r, i) =>
        `<rect x="${i * 40}" height="${r.sales / 10}"></rect><text>${r.month}</text><title>${r.sales}</title>`,
    ).join('');
    expect(gradeChart(`<svg>${bars}</svg>`).score).toBe(1);
    const canvas = `<canvas id="c"></canvas><script>const d = ${JSON.stringify(CHART_DATA)};</script>`;
    expect(gradeChart(canvas).score).toBe(1);
    // A page that fetches the CSV cannot open from disk: the data is missing.
    expect(gradeChart(`<canvas></canvas><script>fetch('sales.csv')</script>`).score).toBe(0.5);
    expect(
      gradeChart(
        `<table>${CHART_DATA.map((r) => `<tr><td>${r.month}</td><td>${r.sales}</td></tr>`).join('')}</table>`,
      ),
    ).toMatchObject({ score: 0.5 });
    expect(gradeChart(undefined).score).toBe(0);
  });

  it('grades the button by clicking it: the broken page fails, fixes of any shape pass', () => {
    const start = task('everyday-button').files;
    const broken = workspace(start);
    expect(gradeButton(broken)).toMatchObject({ score: 0 });

    const fixedId = workspace({
      ...start,
      'script.js': start['script.js']!.replace("'join-button'", "'join'"),
    });
    expect(gradeButton(fixedId).score).toBe(1);

    const querySelector = workspace({
      ...start,
      'script.js':
        "document.querySelector('#join').onclick = () => { document.querySelector('#thanks').removeAttribute('hidden'); };\n",
    });
    expect(gradeButton(querySelector).score).toBe(1);

    const inline = workspace({
      'index.html': start['index.html']!.replace(
        '<button id="join">',
        `<button id="join" onclick="document.getElementById('thanks').style.display = 'block'">`,
      ).replace('<script src="script.js"></script>', ''),
    });
    expect(gradeButton(inline).score).toBe(1);

    const onLoad = workspace({
      ...start,
      'script.js':
        "document.addEventListener('DOMContentLoaded', () => { document.getElementById('join').addEventListener('click', () => { document.getElementById('thanks').hidden = false; }); });\n",
    });
    expect(gradeButton(onLoad).score).toBe(1);

    const stillSilent = workspace({
      ...start,
      'script.js': "document.getElementById('join').addEventListener('click', () => {});\n",
    });
    expect(gradeButton(stillSilent)).toMatchObject({ score: 0 });
    expect(BUTTON_CHECK).toContain('process.exit(shown ? 0 : 1)');
    for (const dir of [broken, fixedId, querySelector, inline, onLoad, stillSilent]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs through the same runner and names its report apart', async () => {
    const drive: DriveTask = async () => 'done';
    const report = await runEvalV2(drive, { suite: 'everyday' });
    expect(report.scores.map((s) => s.task)).toEqual(EVAL_EVERYDAY_TASKS.map((t) => t.id));
    expect(report.suite).toBe('everyday');
    expect(report.average).toBe(0);
    expect(runSuffix(report)).toBe('-everyday');
    expect(runSuffix({ suite: 'everyday', driver: 'claude-code' })).toBe('-everyday-claude-code');
    expect(runSuffix({})).toBe('');
  });
});

describe('the eval approver opens a file-move door, and only that', () => {
  const approve = evalApprover(() => false);
  const shell = (command: string): ApprovalRequest => ({
    id: 'x',
    kind: 'tool',
    toolName: 'runShell',
    risk: 'shell',
    summary: `Run: ${command}`,
  });

  it('lets a move, a copy, a folder, and a listing run inside the workspace', async () => {
    for (const c of [
      'mv photos/IMG_20240312_101500.jpg photos/2024-03-12_10-15.jpg',
      'mv "photos/IMG 1.jpg" "photos/2024-03-12_10-15.jpg"',
      'cp a.txt b.txt',
      'mkdir -p out',
      'ls photos',
    ]) {
      expect((await approve(shell(c))).approve, c).toBe(true);
    }
  });

  it('refuses anything that leaves the folder or chains', async () => {
    for (const c of [
      'mv photos/a.jpg /tmp/a.jpg',
      'mv ~/secret.txt here.txt',
      'cp ../outside.txt .',
      'mv a b && rm -rf .',
      'ls; curl x',
      'ls > out',
      'mv $(ls) x',
      'rm photos/a.jpg',
    ]) {
      expect((await approve(shell(c))).approve, c).toBe(false);
    }
  });
});

describe('the Claude Code baseline', () => {
  it('points Claude Code at Ollama with every model slot on the model under test', () => {
    const env = baselineEnv(
      { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-real' },
      { ollamaUrl: 'http://localhost:11434/v1/', model: 'qwen3:4b', configDir: '/tmp/c' },
    );
    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('ollama');
    // The person's real key never rides along into a benchmark.
    expect(env.ANTHROPIC_API_KEY).toBe('');
    for (const key of [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_SMALL_FAST_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
    ]) {
      expect(env[key], key).toBe('qwen3:4b');
    }
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/c');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(env.PATH).toBe('/usr/bin');
    expect(ollamaRoot('http://box:11434')).toBe('http://box:11434');
  });

  it('gets the same doors as the engine, with the prompt kept off the command line', () => {
    const args = baselineArgs('qwen3:4b');
    expect(args).toContain('-p');
    expect(args).toContain('acceptEdits');
    expect(args[args.indexOf('--model') + 1]).toBe('qwen3:4b');
    const tools = args[args.indexOf('--allowedTools') + 1]!.split(',');
    expect(tools).toEqual(BASELINE_ALLOWED_TOOLS);
    expect(tools.some((t) => t === 'Bash' || t === 'Bash(*)' || t.startsWith('Bash(rm'))).toBe(
      false,
    );
    expect(args.join(' ')).not.toMatch(/bypass|dangerously/i);
  });

  it("reads Claude Code's stream into the report's trace", () => {
    const lines = [
      { type: 'system', subtype: 'init' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Looking.' },
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          ],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: {} }] },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'String not found' },
          ],
        },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: {} }] },
      },
      { type: 'result', subtype: 'success', result: 'Fixed the button.', num_turns: 4 },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const outcome = parseStreamJson(`${lines}\nnot json\n`);
    expect(outcome.finalText).toBe('Fixed the button.');
    expect(outcome.trace).toMatchObject({
      turns: 4,
      toolCalls: ['Read', 'Edit', 'Write'],
      wrote: true,
      doneReason: 'success',
      toolFailures: [{ name: 'Edit', detail: 'String not found' }],
    });
    const failedOnly = parseStreamJson(
      [
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Edit' }] } },
        {
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'x' }],
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n'),
    );
    expect(failedOnly.trace?.wrote).toBe(false);
    expect(failedOnly.finalText).toBe('');
  });
});

describe('the floor run', () => {
  it('plans each change against a plain run, then the baseline, per model', () => {
    const plan = floorPlan(['qwen2.5-coder:3b', 'qwen3:4b'], true);
    expect(plan).toHaveLength(12);
    expect(plan.slice(0, 6)).toEqual([
      { model: 'qwen2.5-coder:3b', suite: 'code', driver: 'engine', numCtx: 'off' },
      { model: 'qwen2.5-coder:3b', suite: 'code', driver: 'engine', numCtx: 'auto' },
      {
        model: 'qwen2.5-coder:3b',
        suite: 'everyday',
        driver: 'engine',
        numCtx: 'off',
        pageCheck: 'off',
      },
      {
        model: 'qwen2.5-coder:3b',
        suite: 'everyday',
        driver: 'engine',
        numCtx: 'auto',
        pageCheck: 'off',
      },
      {
        model: 'qwen2.5-coder:3b',
        suite: 'everyday',
        driver: 'engine',
        numCtx: 'off',
        pageCheck: 'on',
      },
      { model: 'qwen2.5-coder:3b', suite: 'everyday', driver: 'claude-code' },
    ]);
    expect(floorPlan(['qwen3:4b'], false)).toHaveLength(5);
  });

  it('ends with one table ready for DECISIONS, naming a run that did not finish', () => {
    const md = floorMarkdown(
      [
        {
          run: { model: 'qwen3:4b', suite: 'everyday', driver: 'engine', numCtx: 'auto' },
          report: {
            version: 2,
            ranAt: '',
            attempts: 2,
            scores: [
              {
                task: 'a',
                category: 'create',
                score: 0.5,
                best: 1,
                attempts: [0, 1],
                detail: '',
                trace: { turns: 1, toolCalls: [], wrote: true, wallMs: 90_000 },
              },
            ],
            average: 0.5,
            bestAverage: 1,
            byCategory: {},
            variant: { numCtx: 'auto' },
          },
        },
        { run: { model: 'qwen3:4b', suite: 'everyday', driver: 'claude-code' } },
      ],
      '2026-09-27',
      'linux x64, test CPU x4, 8 GB RAM',
      2,
    );
    expect(md).toContain('| qwen3:4b | everyday, OpenShore, num_ctx auto | 50% | 100% | 1.5 min |');
    expect(md).toContain('the page check defaults on');
    expect(md).toContain('| qwen3:4b | everyday, Claude Code baseline | did not finish | | |');
    expect(md).toContain('8 GB RAM');
  });
});
