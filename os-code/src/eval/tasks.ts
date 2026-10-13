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
import { buildVaultFixture, VAULT_CONVENTION, VAULT_DECISION } from './vaultFixture.js';
import type { HandoffTurn } from '../harness/handoff.js';

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
  /** Notes written into the eval's own vault folder (a sibling of the
   *  workspace, never inside it) before the agent runs, as a map of
   *  vault-relative path to markdown. Absent on a task that needs no vault. */
  vault?: Record<string, string>;
  /** A scripted earlier chat (Vault M5, tech review J13): the drive builds a handoff
   *  from it with the harness's own `buildHandoff` and hands it to the pack's
   *  handoff layer on the first send, the way the next day reads the one the
   *  last session wrote. It never reaches the workspace, the vault, or the
   *  prompt, so the handoff is the only place its decision lives. Absent on
   *  a task with no earlier chat. */
  handoff?: EvalHandoff;
}

/** The earlier chat a handoff task continues from. */
export interface EvalHandoff {
  turns: readonly HandoffTurn[];
  /** The model that held the earlier chat, as the HANDOFF line names it. */
  from: string;
  /** The date the handoff was written (YYYY-MM-DD). Fixed, so the bytes are
   *  the same on every run. */
  date: string;
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

// Vault tasks (Vault M4, 4.8, tech review I14). Both run against the generated
// fixture in `vaultFixture.ts`: about two hundred notes, one convention, one
// decision reached by a link from a hub, and an older crew-run note that
// contradicts both. The graders reject the stale note's answer even when the
// right one sits beside it, so hedging between the two scores nothing.

const SYNC_START = [
  `export const MAX_RETRIES = ${VAULT_DECISION.start};`,
  '',
  'export function nextDelay(attempt) {',
  '  return 250 * 2 ** attempt;',
  '}',
  '',
].join('\n');

/** Strip the wrapping a model tends to put around a one-word answer: code
 *  ticks, quotes, a trailing period. */
function bareAnswer(text: string): string {
  return text
    .trim()
    .replace(/^[`'"]+|[`'".]+$/g, '')
    .trim();
}

/** Grade a recalled convention: exact scores 1, present among other words
 *  scores 0.5, and the stale value anywhere in the answer scores 0. */
export function gradeConventionAnswer(finalText: string): EvalTaskScore {
  const bare = bareAnswer(finalText);
  const shown = bare.slice(0, 60) || '(empty)';
  if (finalText.includes(VAULT_CONVENTION.stale)) {
    return { score: 0, detail: `gave the stale crew-run note's prefix: ${shown}` };
  }
  if (bare === VAULT_CONVENTION.right) return { score: 1, detail: 'exact convention recalled' };
  if (finalText.includes(VAULT_CONVENTION.right)) {
    return { score: 0.5, detail: `convention present but not alone: ${shown}` };
  }
  return { score: 0, detail: `wrong or missing: ${shown}` };
}

/** Where the checker reads the workspace's retry limit. Exits 0 only on the
 *  decision's value with the rest of the module intact; exit code 3 marks the
 *  stale note's value so the detail can say which wrong answer it was. */
const SYNC_CHECK = [
  "const m = await import('./sync.mjs');",
  `if (m.MAX_RETRIES === ${VAULT_DECISION.stale}) process.exit(3);`,
  `if (m.MAX_RETRIES === ${VAULT_DECISION.right} && m.nextDelay(2) === 1000) process.exit(0);`,
  'process.exit(1);',
].join(' ');

function syncExitCode(cwd: string): number {
  try {
    execFileSync('node', ['--input-type=module', '-e', SYNC_CHECK], {
      cwd,
      stdio: 'ignore',
      timeout: 10_000,
    });
    return 0;
  } catch (err) {
    const status = (err as { status?: number | null }).status;
    return typeof status === 'number' ? status : 1;
  }
}

const VAULT_NOTE_TASKS: EvalTask[] = [
  {
    id: 'vault-recall-convention',
    title: 'Recall a convention from the vault',
    category: 'answer',
    files: {},
    vault: buildVaultFixture(),
    prompt:
      'This project keeps its conventions in the vault. What prefix do release branch names start with? Reply with ONLY the prefix, no words.',
    async check({ finalText }) {
      return gradeConventionAnswer(finalText);
    },
  },
  {
    id: 'vault-follow-link',
    title: 'Follow a vault link to a decision',
    category: 'edit',
    files: { 'sync.mjs': SYNC_START },
    vault: buildVaultFixture(),
    prompt:
      'The Atlas hub note in the vault links to the decision on how many times the sync client retries. Set MAX_RETRIES in sync.mjs to the value that decision sets. Change nothing else.',
    async check({ cwd }) {
      const code = syncExitCode(cwd);
      if (code === 0) return { score: 1, detail: 'MAX_RETRIES matches the linked decision' };
      if (code === 3) {
        return { score: 0, detail: "took the stale crew-run note's value, not the decision's" };
      }
      return { score: 0, detail: 'MAX_RETRIES wrong, or sync.mjs broken' };
    },
    // Checks the shape only, never the value: a check that printed the
    // expected number would hand the model the answer the vault is there for.
    verifyScript: [
      'let ok = true;',
      'let m;',
      "try { m = await import('./sync.mjs'); } catch (err) { console.error('FAIL: sync.mjs does not run: ' + err.message); process.exit(1); }",
      "if (!Number.isInteger(m.MAX_RETRIES)) { console.error('FAIL: sync.mjs must export MAX_RETRIES as a whole number'); ok = false; }",
      "if (typeof m.nextDelay !== 'function' || m.nextDelay(2) !== 1000) { console.error('FAIL: nextDelay must be left as it was'); ok = false; }",
      "if (ok) console.log('PASS');",
      'process.exit(ok ? 0 : 1);',
      '',
    ].join('\n'),
  },
];

// The handoff task (Vault M5, tech review J13 and J19). An earlier chat settled a
// value, and the only record of it the next session sees is the handoff built
// from that chat: the workspace holds the old value, the prompt names no
// number, the vault is empty, and the check prints no value. So a run with the
// handoff layer can finish the job and a run without it can only guess, which
// is the with and without pair behind "picks up where you left off" (D12).
// Sandbox only: the handoff is built in the drive, never read from or written
// to the person's own handoff store.

/** The values the handoff task turns on: the workspace's `start`, the one
 *  the earlier chat settled on (`right`), and the option it weighed and
 *  passed over (`other`), which the grader names when a run takes it. */
export const HANDOFF_DECISION = { start: 60, right: 5400, other: 3600 } as const;

const CACHE_START = [
  `export const CACHE_TTL_SECONDS = ${HANDOFF_DECISION.start};`,
  '',
  'export function expiresAt(now) {',
  '  return now + CACHE_TTL_SECONDS * 1000;',
  '}',
  '',
].join('\n');

/** The earlier chat, scripted. Its decision line and its closing line both
 *  carry the settled value, the lines the handoff's Decisions and Next step
 *  extract; the passed-over option sits only in a line that is neither. */
export const HANDOFF_HISTORY: readonly HandoffTurn[] = [
  {
    role: 'user',
    text: 'The session cache in cache.mjs expires too fast. Work out a better TTL with me before we change anything.',
    paths: ['cache.mjs'],
  },
  {
    role: 'assistant',
    text: `The sessions in the traffic numbers you shared run up to about an hour and a half. Two options fit: ${HANDOFF_DECISION.other} or ${HANDOFF_DECISION.right} seconds.`,
  },
  { role: 'user', text: 'Ninety minutes matches the longest sessions. Go with that.' },
  {
    role: 'assistant',
    text: [
      `Decided: CACHE_TTL_SECONDS goes to ${HANDOFF_DECISION.right} (ninety minutes). We will change only that constant; expiresAt stays as it is.`,
      `Next step: set CACHE_TTL_SECONDS to ${HANDOFF_DECISION.right} in cache.mjs.`,
    ].join('\n'),
    paths: ['cache.mjs'],
  },
];

const CACHE_CHECK = [
  "const m = await import('./cache.mjs');",
  `if (m.CACHE_TTL_SECONDS === ${HANDOFF_DECISION.other}) process.exit(3);`,
  `if (m.CACHE_TTL_SECONDS === ${HANDOFF_DECISION.right} && m.expiresAt(0) === ${HANDOFF_DECISION.right * 1000}) process.exit(0);`,
  'process.exit(1);',
].join(' ');

function cacheExitCode(cwd: string): number {
  try {
    execFileSync('node', ['--input-type=module', '-e', CACHE_CHECK], {
      cwd,
      stdio: 'ignore',
      timeout: 10_000,
    });
    return 0;
  } catch (err) {
    const status = (err as { status?: number | null }).status;
    return typeof status === 'number' ? status : 1;
  }
}

export const EVAL_HANDOFF_TASKS: EvalTask[] = [
  {
    id: 'vault-continue-handoff',
    title: 'Continue from a handoff',
    category: 'edit',
    files: { 'cache.mjs': CACHE_START },
    // An empty vault, not none: the engine renders the pack's full layers,
    // the handoff among them, only for a session with a vault root.
    vault: {},
    handoff: { turns: HANDOFF_HISTORY, from: 'an earlier model', date: '2026-09-26' },
    prompt:
      'Pick up where we left off yesterday: set CACHE_TTL_SECONDS in cache.mjs to the value we settled on. Change nothing else.',
    async check({ cwd }) {
      const code = cacheExitCode(cwd);
      if (code === 0)
        return { score: 1, detail: 'CACHE_TTL_SECONDS matches the handed-over decision' };
      if (code === 3) {
        return { score: 0, detail: 'took the option the earlier chat passed over' };
      }
      return { score: 0, detail: 'CACHE_TTL_SECONDS wrong, or cache.mjs broken' };
    },
    // The shape only, never the value, as with follow-link.
    verifyScript: [
      'let ok = true;',
      'let m;',
      "try { m = await import('./cache.mjs'); } catch (err) { console.error('FAIL: cache.mjs does not run: ' + err.message); process.exit(1); }",
      "if (!Number.isInteger(m.CACHE_TTL_SECONDS)) { console.error('FAIL: cache.mjs must export CACHE_TTL_SECONDS as a whole number'); ok = false; }",
      "else if (typeof m.expiresAt !== 'function' || m.expiresAt(0) !== m.CACHE_TTL_SECONDS * 1000) { console.error('FAIL: expiresAt must be left as it was'); ok = false; }",
      "if (ok) console.log('PASS');",
      'process.exit(ok ? 0 : 1);',
      '',
    ].join('\n'),
  },
];

/** The vault suite (4.8): the two note tasks and the handoff task. A
 *  vault-pack run measures all three with the whole pack or none; a handoff
 *  run measures the handoff task with the pack and with or without its
 *  handoff layer. */
export const EVAL_VAULT_TASKS: EvalTask[] = [...VAULT_NOTE_TASKS, ...EVAL_HANDOFF_TASKS];
