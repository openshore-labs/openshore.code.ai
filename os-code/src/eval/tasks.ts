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
