// Eval v2 task set: the benchmark that runs the real agent loop, not one-shot
// completions. Each task drops a small, self-contained fixture into a scratch
// workspace, hands the agent a prompt, and then SCORES the result
// deterministically, by behavior, not by asking a judge model. The fixtures are
// plain ES modules so the checker can run them with `node` alone, no compiler
// and no dependencies, which keeps every score reproducible on any machine.
//
// Pure data plus pure checkers (they only read the resulting workspace and the
// agent's final text). The loop that produces the result is injected by the
// runner, so this module never imports a provider or the agent.
import { execFileSync } from 'node:child_process';

/** What a task checker sees: the workspace after the agent ran, and the
 *  agent's final answer text. */
export interface EvalTaskResult {
  cwd: string;
  finalText: string;
}

export interface EvalTaskScore {
  score: number;
  detail: string;
}

export interface EvalTask {
  id: string;
  title: string;
  /** The kind of work, so the report can show a per-category breakdown. */
  category: 'edit' | 'create' | 'refactor' | 'answer';
  /** Fixture files written into a fresh workspace before the agent runs. */
  files: Record<string, string>;
  prompt: string;
  check: (result: EvalTaskResult) => Promise<EvalTaskScore>;
  /** The task's own test, as a plain ES module the harness runs in the
   *  workspace after the agent changes a file (verify in the loop), the way a
   *  real project's test suite runs. It prints what failed and exits non-zero,
   *  so a failing check goes back to the model as something to fix. Scoring
   *  still uses `check` alone. Absent on a task with nothing to run. */
  verifyScript?: string;
}

/** Where a task's verify script lands inside the workspace. */
export const EVAL_CHECK_FILE = '.eval-check.mjs';

/** The verify command for a task, or undefined when it has no script. */
export function verifyCommandFor(task: Pick<EvalTask, 'verifyScript'>): string | undefined {
  return task.verifyScript ? `node ${EVAL_CHECK_FILE}` : undefined;
}

/** Run a short ES-module script with `node` inside `cwd`; true when it exits 0.
 *  The script does the behavioral assertion and picks its own exit code. */
function nodePasses(cwd: string, script: string): boolean {
  try {
    execFileSync('node', ['--input-type=module', '-e', script], {
      cwd,
      stdio: 'ignore',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

const MATH_BUGGY = [
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'export function subtract(a, b) {',
  '  return a + b;',
  '}',
  '',
].join('\n');

const GREETER_OLD = ['export function oldName(name) {', '  return `hello ${name}`;', '}', ''].join(
  '\n',
);

const GREETER_USER = [
  "import { oldName } from './greeter.mjs';",
  '',
  'export function greetWorld() {',
  "  return oldName('world');",
  '}',
  '',
].join('\n');

const ANSWER_SRC = [
  'export function magic() {',
  '  const base = 20;',
  '  return base * 2 + 2;',
  '}',
  '',
].join('\n');

export const EVAL_TASKS: EvalTask[] = [
  {
    id: 'fix-bug',
    title: 'Fix a wrong operator',
    category: 'edit',
    files: { 'math.mjs': MATH_BUGGY },
    prompt:
      'The file math.mjs has a bug: subtract() adds instead of subtracting. Fix subtract so it returns a minus b. Change nothing else.',
    async check({ cwd }) {
      const ok = nodePasses(
        cwd,
        "const m = await import('./math.mjs'); if (m.subtract(5, 3) === 2 && m.add(2, 2) === 4) process.exit(0); process.exit(1);",
      );
      return ok
        ? { score: 1, detail: 'subtract now returns a - b and add still works' }
        : { score: 0, detail: 'subtract still wrong or add broken' };
    },
    verifyScript: [
      "const m = await import('./math.mjs');",
      'let ok = true;',
      "if (typeof m.subtract !== 'function') { console.error('FAIL: math.mjs does not export subtract'); ok = false; }",
      "else if (m.subtract(5, 3) !== 2) { console.error('FAIL: subtract(5, 3) returned ' + m.subtract(5, 3) + ', expected 2'); ok = false; }",
      "if (typeof m.add !== 'function' || m.add(2, 2) !== 4) { console.error('FAIL: add(2, 2) must still return 4'); ok = false; }",
      "if (ok) console.log('PASS');",
      'process.exit(ok ? 0 : 1);',
      '',
    ].join('\n'),
  },
  {
    id: 'add-function',
    title: 'Add and export a function',
    category: 'create',
    files: {
      'strings.mjs':
        'export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n',
    },
    prompt:
      'In strings.mjs, add and export a function shout(s) that returns s in all uppercase with a single exclamation mark appended. Keep capitalize as it is.',
    async check({ cwd }) {
      const ok = nodePasses(
        cwd,
        "const m = await import('./strings.mjs'); if (m.shout('hi') === 'HI!' && m.capitalize('hi') === 'Hi') process.exit(0); process.exit(1);",
      );
      return ok
        ? { score: 1, detail: 'shout works and capitalize is intact' }
        : { score: 0, detail: 'shout missing or wrong, or capitalize broken' };
    },
    verifyScript: [
      "const m = await import('./strings.mjs');",
      'let ok = true;',
      "if (typeof m.shout !== 'function') { console.error('FAIL: strings.mjs does not export a function named shout'); ok = false; }",
      "else if (m.shout('hi') !== 'HI!') { console.error('FAIL: shout(\"hi\") returned ' + JSON.stringify(m.shout('hi')) + ', expected \"HI!\"'); ok = false; }",
      "if (typeof m.capitalize !== 'function' || m.capitalize('hi') !== 'Hi') { console.error('FAIL: capitalize(\"hi\") must still return \"Hi\"'); ok = false; }",
      "if (ok) console.log('PASS');",
      'process.exit(ok ? 0 : 1);',
      '',
    ].join('\n'),
  },
  {
    id: 'rename-across-files',
    title: 'Rename an export across files',
    category: 'refactor',
    files: { 'greeter.mjs': GREETER_OLD, 'user.mjs': GREETER_USER },
    prompt:
      'Rename the exported function oldName to greet everywhere it is defined or used, across greeter.mjs and user.mjs, so the code still runs. Do not change its behavior.',
    async check({ cwd }) {
      const renamed = nodePasses(
        cwd,
        "const g = await import('./greeter.mjs'); const u = await import('./user.mjs'); if (typeof g.greet === 'function' && g.oldName === undefined && u.greetWorld() === 'hello world') process.exit(0); process.exit(1);",
      );
      return renamed
        ? { score: 1, detail: 'greet is exported, oldName is gone, and the caller still runs' }
        : { score: 0, detail: 'rename incomplete: a definition or a use was missed' };
    },
    verifyScript: [
      'let ok = true;',
      "const g = await import('./greeter.mjs');",
      "if (typeof g.greet !== 'function') { console.error('FAIL: greeter.mjs does not export a function named greet'); ok = false; }",
      "if (g.oldName !== undefined) { console.error('FAIL: greeter.mjs still exports oldName; it must be renamed to greet'); ok = false; }",
      'try {',
      "  const u = await import('./user.mjs');",
      "  if (u.greetWorld() !== 'hello world') { console.error('FAIL: greetWorld() in user.mjs returned ' + JSON.stringify(u.greetWorld()) + ', expected \"hello world\"'); ok = false; }",
      '} catch (err) {',
      "  console.error('FAIL: user.mjs does not run: ' + err.message + '. Its import and its call must both use greet.');",
      '  ok = false;',
      '}',
      "if (ok) console.log('PASS');",
      'process.exit(ok ? 0 : 1);',
      '',
    ].join('\n'),
  },
  {
    id: 'answer-from-code',
    title: 'Answer a question from the code',
    category: 'answer',
    files: { 'src.mjs': ANSWER_SRC },
    prompt: 'Read src.mjs. Reply with ONLY the number that magic() returns, no words.',
    async check({ finalText }) {
      const trimmed = finalText.trim();
      if (trimmed === '42') return { score: 1, detail: 'exact answer' };
      if (/\b42\b/.test(trimmed))
        return { score: 0.5, detail: `answer present but not alone: ${trimmed.slice(0, 40)}` };
      return { score: 0, detail: `wrong or missing: ${trimmed.slice(0, 40) || '(empty)'}` };
    },
  },
];
