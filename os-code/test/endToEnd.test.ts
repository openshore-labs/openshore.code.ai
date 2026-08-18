// The Definition of Done path, end to end on the mock provider: read a
// file, search the web (mocked HTTP), edit code with approval, run a
// command, and commit, in one continuous session. On a machine with Ollama
// this same flow runs against a real local model with: osc
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

afterEach(() => vi.restoreAllMocks());

const BUGGY = ['export function add(a, b) {', '  return a - b;', '}', ''].join('\n');

const EDIT_BLOCKS = [
  '<<<<<<< SEARCH',
  'export function add(a, b) {',
  '  return a - b;',
  '}',
  '=======',
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '>>>>>>> REPLACE',
].join('\n');

const SEARCH_HTML = `<html><body><div class="result">
  <a class="result__a" href="https://mdn.example/js-addition">Addition in JavaScript</a>
  <div class="result__snippet">The + operator adds numbers.</div>
</div></body></html>`;

describe('end to end: read, search, edit with approval, run, commit', () => {
  it('drives the whole flow through one session', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('readFile', { path: 'math.js' }, 'c1'),
      toolTurn('webSearch', { query: 'javascript addition operator' }, 'c2'),
      toolTurn('editFile', { path: 'math.js', edits: EDIT_BLOCKS }, 'c3'),
      toolTurn(
        'runShell',
        {
          command:
            'node --eval "const {add}=await import(\'./math.js\'); if(add(2,3)!==5) process.exit(1)" --input-type=module',
        },
        'c4',
      ),
      toolTurn('gitCommit', { message: 'fix: add() subtracted instead of adding' }, 'c5'),
      textTurn(
        'Fixed add() in math.js, verified with node, and committed. The web agreed: + adds.',
      ),
    ]);

    const session = makeTestSession(provider, {
      files: { 'math.js': BUGGY },
      approve: () => ({ approve: true }),
    });

    // A real git repo so the commit lands.
    execFileSync('git', ['init', '-q'], { cwd: session.cwd });
    execFileSync('git', ['config', 'user.email', 'osc@test.local'], { cwd: session.cwd });
    execFileSync('git', ['config', 'user.name', 'OS Code Test'], { cwd: session.cwd });
    execFileSync('git', ['add', '-A'], { cwd: session.cwd });
    execFileSync('git', ['commit', '-qm', 'initial'], { cwd: session.cwd });

    // Only the web search leaves the machine; mock that one route.
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('duckduckgo.com')) {
        return new Response(SEARCH_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return realFetch(input as RequestInfo, init);
    });

    await session.agent.run('math.js subtracts when it should add. Fix it, verify, and commit.');

    // 1. The file is fixed on disk.
    expect(readFileSync(join(session.cwd, 'math.js'), 'utf8')).toContain('a + b');

    // 2. The web search returned citations that reached the UI.
    const citations = session.events.find((e) => e.type === 'citations');
    expect(citations && citations.type === 'citations' && citations.citations[0]!.url).toContain(
      'mdn.example',
    );

    // 3. The shell command asked for approval (the test config allows writes,
    //    so the edit flowed; shell stays ask, per the defaults' spirit).
    expect(session.approvals.some((a) => a.toolName === 'runShell')).toBe(true);

    // 4. The verification command actually ran and passed.
    const shellEnd = session.events.find(
      (e) => e.type === 'tool-end' && e.call.name === 'runShell',
    );
    expect(shellEnd && shellEnd.type === 'tool-end' && shellEnd.result.ok).toBe(true);

    // 5. The commit exists.
    const log = execFileSync('git', ['log', '--oneline'], { cwd: session.cwd, encoding: 'utf8' });
    expect(log).toContain('fix: add() subtracted');

    // 6. The session closed with a clean final answer.
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
    const final = session.events.find((e) => e.type === 'text-final');
    expect(final && final.type === 'text-final' && final.text).toContain('Fixed add()');

    // 7. The diff that was shown for the edit is honest.
    const editEnd = session.events.find((e) => e.type === 'tool-end' && e.call.name === 'editFile');
    expect(editEnd && editEnd.type === 'tool-end' && editEnd.result.diffText).toContain(
      '+  return a + b;',
    );
  });
});
