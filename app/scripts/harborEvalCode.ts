// The Harbor eval's code runner (scripts/harbor-eval.ts): a reply's function,
// run against a case's tests. Each check runs in its own Node process started
// with --permission and an empty environment, which denies it the file system,
// child processes, workers, native addons and the maintainer's keys; inside
// that, a fresh V8 context with its own built-ins and the few web APIs a reply
// may fairly use (URL, URLSearchParams, text encoding, timers). It can still
// reach the network, so run the eval only against a model you trust, as on
// the reference box. Each step gets two seconds of CPU, the check ten in all.
import { spawn } from 'node:child_process';
import type { RunCode } from '../src/lib/harborEval.js';

/** What the child runs: read { code, tests, fn } on stdin, answer
 *  { ok, error } on stdout. */
const CHILD = `
const vm = require('node:vm');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', async () => {
  const { code, tests, fn } = JSON.parse(input);
  const answer = (r) => process.stdout.write(JSON.stringify(r), () => process.exit(0));
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, URLSearchParams, URL, TextEncoder, TextDecoder,
    module: { exports: {} }, exports: {},
  });
  try {
    // A reply written as a module still defines its function.
    vm.runInContext(code.replace(/^\\s*export\\s+(default\\s+)?/gm, ''), context, { timeout: 2000 });
    if (vm.runInContext('typeof ' + fn, context) !== 'function') {
      return answer({ ok: false, error: fn + ' is not defined' });
    }
    await vm.runInContext('(async () => {\\n' + tests + '\\n})()', context, { timeout: 2000 });
    answer({ ok: true });
  } catch (err) {
    answer({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});
`;

export const runCodeInVm: RunCode = (code, tests, fn) =>
  new Promise((resolve) => {
    // An empty environment: the maintainer's keys never ride along to code a
    // model wrote (CLAUDE.md, no secret rides a child process's environment).
    const child = spawn(process.execPath, ['--permission', '-e', CHILD], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {},
    });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out) as { ok: boolean; error?: string });
      } catch {
        resolve({ ok: false, error: out ? 'unreadable result' : 'timed out or crashed' });
      }
    });
    child.stdin.end(JSON.stringify({ code, tests, fn }));
  });
