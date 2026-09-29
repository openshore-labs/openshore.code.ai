// Programs the agent starts and leaves running ("run my app", build
// 2026-09-29, P1). startProcess puts a command on the session's command lane
// (source 'agent'), waits up to readySeconds for it to come up, and returns
// its address and first output; readProcess reads the 64 KB tail later;
// stopProcess ends only a run this agent started. At most three live at once,
// all of them end with the session (dispose, eviction) and with the daemon,
// and none exist on a headless run, in a member's session, or in plan mode.
// A lean seat's menu is byte-identical with them on, and under the secrets
// lockdown starting one asks like any command.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { applyProjectConfig } from '../src/config/projectPolicy.js';
import { bootstrapSession, type BootstrapOptions } from '../src/core/agent/bootstrap.js';
import type { AgentSession } from '../src/core/agent/loop.js';
import type { DriverEvent } from '../src/core/agent/types.js';
import { localAddresses } from '../src/core/exec/localAddress.js';
import {
  LocalDriver,
  AGENT_PROCESS_LIMIT,
  AGENT_PROCESS_TAIL_CHARS,
} from '../src/daemon/session.js';
import { startDaemon, type RunningDaemon } from '../src/daemon/serve.js';
import { TerminalManager, TerminalUnavailable } from '../src/daemon/terminal.js';
import { defaultConfig } from '../src/config/load.js';
import { PROCESS_TOOLS, processesOn } from '../src/core/tools/process.js';
import type { ToolContext } from '../src/core/tools/index.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { portUnavailable, removeTempDir } from './helpers/portable.js';

const PROCESS_NAMES = PROCESS_TOOLS.map((t) => t.name);

// A server that says where it listens, writes its pid, and never exits.
const SERVER = `
require('fs').writeFileSync('pid-' + process.argv[2] + '.txt', String(process.pid));
console.log('ready at http://localhost:4321/');
setInterval(() => {}, 1000);
`;
// A program that prints numbered lines, one every 20 ms, then keeps running.
const TICKER = `
let i = 0;
const t = setInterval(() => { console.log('tick ' + ++i); if (i === 30) clearInterval(t); }, 20);
setInterval(() => {}, 1000);
`;
// A server whose address arrives in two pieces, the second 400 ms later.
const SPLIT = `
process.stdout.write('ready at http://localhost:51');
setTimeout(() => process.stdout.write('73/\\n'), 400);
setInterval(() => {}, 1000);
`;
// A program that prints far more than the kept tail, then ends.
const FLOOD = `
const line = 'x'.repeat(99);
for (let i = 0; i < 2000; i++) process.stdout.write(line + '\\n');
console.log('END');
`;

// Run last in, first out: every program a test started is stopped before its
// folder is removed, and the removal waits for Windows to let the folder go.
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'osc-proc-')));
  writeFileSync(join(dir, 'server.js'), SERVER);
  writeFileSync(join(dir, 'ticker.js'), TICKER);
  writeFileSync(join(dir, 'flood.js'), FLOOD);
  writeFileSync(join(dir, 'split.js'), SPLIT);
  writeFileSync(join(dir, 'fail.js'), "console.error('port in use'); process.exit(3);\n");
  writeFileSync(join(dir, 'once.js'), "console.log('built');\n");
  writeFileSync(
    join(dir, 'env.js'),
    "console.log('key: ' + (process.env.OSC_PROC_TEST_API_KEY ?? 'absent'));\nsetInterval(() => {}, 1000);\n",
  );
  cleanups.push(() => removeTempDir(dir));
  return dir;
}

const config = (extra: Record<string, unknown> = {}) =>
  ConfigSchema.parse({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } }, ...extra });

/** A real bootstrap on a throwaway session; every program it starts ends
 *  after the test. */
function boot(options: Partial<BootstrapOptions> = {}) {
  const cwd = options.cwd ?? workspace();
  const result = bootstrapSession({
    cwd,
    profile: 'local-interactive',
    persist: false,
    config: config(),
    ...options,
  });
  cleanups.push(() => result.driver.stopAgentProcesses());
  const events: DriverEvent[] = [];
  result.driver.subscribe((event) => events.push(event));
  return { ...result, cwd, events };
}

async function call(ctx: ToolContext, name: string, args: Record<string, unknown>) {
  const tool = PROCESS_TOOLS.find((t) => t.name === name)!;
  return tool.execute(tool.schema.parse(args) as never, ctx);
}

function runIdOf(content: string): string {
  const id = /Process (\w+) /.exec(content)?.[1];
  if (!id) throw new Error(`no process id in: ${content}`);
  return id;
}

async function until(check: () => boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pidOf(cwd: string, tag: string): Promise<number> {
  const file = join(cwd, `pid-${tag}.txt`);
  await until(() => existsSync(file) && readFileSync(file, 'utf8').length > 0, `pid ${tag}`);
  return Number(readFileSync(file, 'utf8'));
}

describe('startProcess: a program that keeps running', () => {
  it('starts on the command lane as the agent, and returns once it prints its address', async () => {
    const s = boot();
    const began = Date.now();
    const out = await call(s.toolContext, 'startProcess', {
      command: 'node server.js a',
      readySeconds: 20,
    });
    // It came back on the address, well before the 20 s wait.
    expect(Date.now() - began).toBeLessThan(15_000);
    expect(out.ok).toBe(true);
    expect(out.content).toContain('running for');
    expect(out.content).toContain('Address: http://localhost:4321/');
    expect(out.content).toContain('ready at http://localhost:4321/');
    expect(out.content).toMatch(/stop it with stopProcess/);
    const start = s.events.find((e) => e.type === 'command-start');
    expect(start).toMatchObject({ source: 'agent', command: 'node server.js a', cwd: s.cwd });
    expect(alive(await pidOf(s.cwd, 'a'))).toBe(true);
  });

  it('reads an address from whole lines, so one split between chunks is not cut short', async () => {
    const s = boot();
    const out = await call(s.toolContext, 'startProcess', {
      command: 'node split.js',
      readySeconds: 10,
    });
    expect(out.content).toContain('Address: http://localhost:5173/\n');
    const view = s.driver.readAgentProcess(runIdOf(out.content), 5)!;
    expect(view.addresses).toEqual(['http://localhost:5173/']);
  });

  it('waits no longer than readySeconds for a program that prints no address', async () => {
    const s = boot();
    const began = Date.now();
    const out = await call(s.toolContext, 'startProcess', {
      command: 'node ticker.js',
      readySeconds: 1,
    });
    expect(Date.now() - began).toBeGreaterThanOrEqual(900);
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(out.ok).toBe(true);
    expect(out.content).toContain('tick 1');
    expect(out.content).not.toContain('Address:');
  });

  it('says so when the program ends within the wait, and is not ok when it failed', async () => {
    const s = boot();
    const failed = await call(s.toolContext, 'startProcess', {
      command: 'node fail.js',
      readySeconds: 10,
    });
    expect(failed.ok).toBe(false);
    expect(failed.content).toContain('exited with code 3');
    expect(failed.content).toContain('port in use');
    expect(failed.content).toContain('It is not running.');
    const once = await call(s.toolContext, 'startProcess', {
      command: 'node once.js',
      readySeconds: 10,
    });
    expect(once.ok).toBe(true);
    expect(once.content).toContain('exited with code 0');
    expect(once.content).toMatch(/runShell is the tool/);
  });

  it("starts with the scrubbed environment, so it cannot read OpenShore's keys", async () => {
    process.env.OSC_PROC_TEST_API_KEY = 'sk-live-should-not-leak';
    cleanups.push(() => delete process.env.OSC_PROC_TEST_API_KEY);
    const s = boot();
    const out = await call(s.toolContext, 'startProcess', {
      command: 'node env.js',
      readySeconds: 2,
    });
    const id = runIdOf(out.content);
    await until(
      () => (s.driver.readAgentProcess(id, 5)?.output ?? '').includes('key:'),
      'the env line',
    );
    expect(s.driver.readAgentProcess(id, 5)!.output).toContain('key: absent');
  });

  it('is degraded, not broken, where no host is wired', async () => {
    const ctx = { cwd: tmpdir() } as ToolContext;
    const out = await call(ctx, 'startProcess', { command: 'node server.js' });
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/not available in this session/);
  });
});

describe('readProcess: the tail of its output', () => {
  it('reads the latest lines of a live program, as many as asked', async () => {
    const s = boot();
    const started = await call(s.toolContext, 'startProcess', {
      command: 'node ticker.js',
      readySeconds: 0,
    });
    const id = runIdOf(started.content);
    await until(
      () => (s.driver.readAgentProcess(id, 1)?.output ?? '') === 'tick 30',
      'thirty ticks',
    );
    const read = await call(s.toolContext, 'readProcess', { runId: id, lines: 3 });
    expect(read.ok).toBe(true);
    expect(read.content).toContain('running for');
    expect(read.content).toContain('tick 28\ntick 29\ntick 30');
    expect(read.content).not.toContain('tick 27');
  });

  it('keeps a rolling 64 KB tail, and says earlier output was dropped', async () => {
    const s = boot();
    const started = await call(s.toolContext, 'startProcess', {
      command: 'node flood.js',
      readySeconds: 20,
    });
    const id = runIdOf(started.content);
    await until(() => s.driver.readAgentProcess(id, 1)?.running === false, 'the flood to end');
    const view = s.driver.readAgentProcess(id, 1_000_000)!;
    expect(view.output.length).toBeLessThanOrEqual(AGENT_PROCESS_TAIL_CHARS);
    expect(view.output.length).toBeGreaterThan(AGENT_PROCESS_TAIL_CHARS - 200);
    expect(view.dropped).toBe(true);
    expect(view.output.endsWith('END')).toBe(true);
    const read = await call(s.toolContext, 'readProcess', { runId: id, lines: 2 });
    expect(read.content).toContain('exited with code 0');
    expect(read.content).toContain('earlier output was dropped');
  });

  it("cannot read a command the person ran, or another session's program", async () => {
    const s = boot();
    const other = boot();
    const theirs = await call(other.toolContext, 'startProcess', {
      command: 'node ticker.js',
      readySeconds: 0,
    });
    const { runId: personRun } = s.driver.runCommand('node ticker.js');
    cleanups.push(() => s.driver.killCommand(personRun));
    for (const runId of [personRun, runIdOf(theirs.content)]) {
      const read = await call(s.toolContext, 'readProcess', { runId });
      expect(read.ok).toBe(false);
      expect(read.content).toMatch(/No process \w+ that you started in this chat/);
    }
  });
});

describe('stopProcess: only what this agent started', () => {
  it('stops its own program and everything it started', async () => {
    const s = boot();
    const started = await call(s.toolContext, 'startProcess', {
      command: 'node server.js own',
      readySeconds: 10,
    });
    const id = runIdOf(started.content);
    const pid = await pidOf(s.cwd, 'own');
    const stopped = await call(s.toolContext, 'stopProcess', { runId: id });
    expect(stopped.ok).toBe(true);
    expect(stopped.content).toBe(`Stopped process ${id} (\`node server.js own\`).`);
    await until(() => !alive(pid), 'the server to end');
    await until(
      () => s.events.some((e) => e.type === 'command-end' && e.runId === id),
      'the card to end',
    );
    const again = await call(s.toolContext, 'stopProcess', { runId: id });
    expect(again.content).toMatch(/is not running/);
  });

  it('refuses a command the person ran, and leaves it running', async () => {
    const s = boot();
    const { runId } = s.driver.runCommand('node server.js person');
    cleanups.push(() => s.driver.killCommand(runId));
    const pid = await pidOf(s.cwd, 'person');
    const refused = await call(s.toolContext, 'stopProcess', { runId });
    expect(refused.ok).toBe(false);
    expect(refused.content).toMatch(/that you started in this chat/);
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(pid)).toBe(true);
  });
});

describe('the cap: at most three live per session', () => {
  it('refuses a fourth, naming the three, until one stops', async () => {
    const s = boot();
    const ids: string[] = [];
    for (let i = 0; i < AGENT_PROCESS_LIMIT; i++) {
      const out = await call(s.toolContext, 'startProcess', {
        command: 'node ticker.js',
        readySeconds: 0,
      });
      expect(out.ok).toBe(true);
      ids.push(runIdOf(out.content));
    }
    const fourth = await call(s.toolContext, 'startProcess', {
      command: 'node server.js four',
      readySeconds: 0,
    });
    expect(fourth.ok).toBe(false);
    expect(fourth.content).toContain('3 programs you started are still running');
    for (const id of ids) expect(fourth.content).toContain(id);
    expect(s.events.filter((e) => e.type === 'command-start')).toHaveLength(3);

    await call(s.toolContext, 'stopProcess', { runId: ids[0]! });
    const now = await call(s.toolContext, 'startProcess', {
      command: 'node ticker.js',
      readySeconds: 0,
    });
    expect(now.ok).toBe(true);
  });
});

describe('they end with the session', () => {
  it('dispose kills every live one and ends its card at once', async () => {
    const s = boot();
    const started = await call(s.toolContext, 'startProcess', {
      command: 'node server.js disposed',
      readySeconds: 10,
    });
    const id = runIdOf(started.content);
    const pid = await pidOf(s.cwd, 'disposed');
    s.driver.dispose();
    // The card ends now, before the exit, so a revived journal never shows
    // it running.
    expect(s.events.find((e) => e.type === 'command-end' && e.runId === id)).toMatchObject({
      exitCode: null,
    });
    await until(() => !alive(pid), 'the server to end');
    expect(s.driver.liveAgentProcesses()).toEqual([]);
  });

  it("does not hold the session from eviction, while the person's own command does", async () => {
    const cwd = workspace();
    const driver = new LocalDriver(cwd, { id: `ev${Date.now().toString(36)}` });
    cleanups.push(() => driver.dispose());
    const started = driver.startAgentProcess('node server.js evict');
    expect('runId' in started).toBe(true);
    await pidOf(cwd, 'evict');
    expect(driver.evictable).toBe(true);
    const { runId } = driver.runCommand('node ticker.js');
    expect(driver.evictable).toBe(false);
    driver.killCommand(runId);
    await until(() => driver.evictable, 'the person command to end');
  });

  it('the daemon ends every program its sessions started when it closes', async () => {
    const cwd = workspace();
    let daemon: RunningDaemon | undefined;
    for (let attempt = 0; attempt < 30 && !daemon; attempt++) {
      try {
        daemon = await startDaemon({
          config: defaultConfig(),
          bind: 'loopback',
          port: 40000 + Math.floor(Math.random() * 20000),
          terminals: new TerminalManager({
            spawn: async () => {
              throw new TerminalUnavailable();
            },
          }),
        });
      } catch (err) {
        if (!portUnavailable(err)) throw err;
      }
    }
    const home = process.env.OSC_HOME!;
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
    );
    const token = readFileSync(join(home, 'daemon.token'), 'utf8').trim();
    const res = await fetch(`http://127.0.0.1:${daemon!.port}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const { openSessionDrivers } = await import('../src/daemon/session.js');
    const driver = openSessionDrivers().find((d) => d.id === id)!;
    cleanups.push(() => driver.dispose());
    driver.startAgentProcess('node server.js daemon');
    const pid = await pidOf(cwd, 'daemon');
    daemon!.close();
    await until(() => !alive(pid), 'the server to end with the daemon');
  });

  it('the person stopping one is said on the next turn as a process the agent started', async () => {
    const cwd = workspace();
    const driver = new LocalDriver(cwd, { persist: false });
    cleanups.push(() => driver.dispose());
    const preambles: Array<string | undefined> = [];
    driver.attachAgent({
      run: async (_text: string, _images: unknown, preamble?: string) => {
        preambles.push(preamble);
        driver.emit({ type: 'task-done', reason: 'complete' });
      },
      flushHandoff: () => undefined,
      generateTitle: async () => undefined,
    } as unknown as AgentSession);
    const failed = driver.startAgentProcess('node fail.js');
    const stopped = driver.startAgentProcess('node server.js stopped');
    if (!('runId' in failed) || !('runId' in stopped)) throw new Error('did not start');
    await pidOf(cwd, 'stopped');
    driver.killCommand(stopped.runId);
    await until(() => driver.liveAgentProcesses().length === 0, 'both to end');
    await until(() => driver.readAgentProcess(stopped.runId, 1)?.running === false, 'the stop');
    driver.send('next');
    await until(() => preambles.length === 1, 'the next task');
    const preamble = preambles[0] ?? '';
    expect(preamble).toContain('[terminal] a process you started, `node fail.js`, ended');
    expect(preamble).toContain('exit 3');
    expect(preamble).toContain('port in use');
    expect(preamble).toContain('`node server.js stopped`, ended');
    expect(preamble).toContain('stopped by the person');
    expect(preamble).not.toContain('the user ran');
  });
});

describe('where they exist', () => {
  it('registers the three right after gitCommit in an ordinary session', () => {
    const s = boot();
    const names = s.tools.names();
    const at = names.indexOf('gitCommit');
    expect(names.slice(at + 1, at + 4)).toEqual(PROCESS_NAMES);
    expect(s.toolContext.processes).toBeDefined();
  });

  it('never on a headless run', () => {
    const s = boot({ profile: 'headless' });
    for (const name of PROCESS_NAMES) expect(s.tools.names()).not.toContain(name);
    expect(s.toolContext.processes).toBeUndefined();
  });

  it("never in a member's session on a shared hub", () => {
    const s = boot({ processes: false });
    for (const name of PROCESS_NAMES) expect(s.tools.names()).not.toContain(name);
    expect(s.toolContext.processes).toBeUndefined();
  });

  it('never in plan mode, and back once the plan is approved', () => {
    const s = boot({ permissionMode: 'plan' });
    const menu = () =>
      (s.agent as unknown as { toolSpecs(): Array<{ name: string }> })
        .toolSpecs()
        .map((t) => t.name);
    for (const name of PROCESS_NAMES) {
      expect(s.tools.names()).not.toContain(name);
      expect(s.tools.get(name)).toBeUndefined();
      expect(menu()).not.toContain(name);
    }
    s.agent.setMode('default');
    for (const name of PROCESS_NAMES) expect(menu()).toContain(name);
    s.agent.setMode('plan');
    for (const name of PROCESS_NAMES) expect(menu()).not.toContain(name);
  });

  it("config's tools.processes: unset reads on, 'off' turns them off", () => {
    expect(config().tools.processes).toBe('on');
    expect(processesOn({})).toBe(true);
    const off = boot({ config: config({ tools: { processes: 'off' } }) });
    for (const name of PROCESS_NAMES) expect(off.tools.names()).not.toContain(name);
  });

  it('a project may only turn them off; turning them on waits for trust', () => {
    const off = applyProjectConfig(config(), { tools: { processes: 'off' } }, false);
    expect((off.config.tools as { processes: string }).processes).toBe('off');
    const machineOff = config({ tools: { processes: 'off' } });
    const on = applyProjectConfig(machineOff, { tools: { processes: 'on' } }, false);
    expect((on.config.tools as { processes: string }).processes).toBe('off');
    expect(on.setAside).toEqual([
      {
        path: 'tools.processes',
        plain: 'lets the agent start programs that keep running, like your app',
        trustable: true,
      },
    ]);
    const trusted = applyProjectConfig(machineOff, { tools: { processes: 'on' } }, true);
    expect((trusted.config.tools as { processes: string }).processes).toBe('on');
  });
});

describe("a lean seat's menu is byte-identical with them on", () => {
  // The mock model derives to the small class (a 32k window, no size hint).
  async function leanRequest(processes: boolean, cwd: string) {
    const provider = new MockProvider('mock', [textTurn('done')]);
    const session = makeTestSession(provider, {
      cwd,
      processes,
      now: () => new Date('2026-09-29T09:00:00Z'),
      configOverrides: { harness: { profiles: { enabled: true } } },
    });
    await session.agent.run('run my app');
    const request = provider.requests[0]!;
    const system = request.messages.find((m) => m.role === 'system')?.content;
    return { tools: JSON.stringify(request.tools), system: JSON.stringify(system), session };
  }

  it('sends the same tools and the same system prompt', async () => {
    const cwd = workspace();
    const off = await leanRequest(false, cwd);
    const on = await leanRequest(true, cwd);
    // They are registered on the second, and the lean cut drops them.
    expect(on.session.tools.names()).toEqual(expect.arrayContaining(PROCESS_NAMES));
    expect(on.tools).toBe(off.tools);
    expect(on.system).toBe(off.system);
    for (const name of PROCESS_NAMES) expect(on.tools).not.toContain(name);
  });

  it('a full seat is offered them', async () => {
    const provider = new MockProvider('mock', [textTurn('done')]);
    const session = makeTestSession(provider, { processes: true });
    await session.agent.run('run my app');
    const names = provider.requests[0]!.tools!.map((t) => t.name);
    for (const name of PROCESS_NAMES) expect(names).toContain(name);
  });
});

describe('starting one is a shell step: the lockdown and the wrapper rules apply', () => {
  const secrets = 'STRIPE_KEY=sk_live_abcdefghijklmnop';

  it('asks under the secrets lockdown whatever the rules and the mode say', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('startProcess', { command: 'npm run dev', readySeconds: 0 }, 'c1'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      processes: true,
      projectSecrets: secrets,
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'allow' },
          rules: [{ tool: 'startProcess', decision: 'allow', commandPrefix: 'npm' }],
        },
      },
      approve: () => ({ approve: false }),
    });
    session.agent.setMode('bypassPermissions');
    await session.agent.run('run my app');
    expect(session.approvals).toHaveLength(1);
    const asked = session.approvals[0]!;
    expect(asked).toMatchObject({
      toolName: 'startProcess',
      risk: 'shell',
      summary: 'Start: npm run dev',
      alwaysAsk: true,
      lockdown: true,
    });
  });

  it('without the lockdown the same rule lets it start quietly', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('startProcess', { command: 'npm run dev', readySeconds: 0 }, 'c1'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      processes: true,
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'startProcess', decision: 'allow', commandPrefix: 'npm' }],
        },
      },
    });
    await session.agent.run('run my app');
    expect(session.approvals).toEqual([]);
  });

  it('a saved interpreter prefix never matches, and code on the command line is never saved', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('startProcess', { command: 'node -e "require(\'x\')"', readySeconds: 0 }, 'c1'),
      toolTurn('startProcess', { command: 'npx vite', readySeconds: 0 }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      processes: true,
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'startProcess', decision: 'allow', commandPrefix: 'node' }],
        },
      },
      approve: () => ({ approve: true, alwaysInProject: true }),
    });
    await session.agent.run('run my app');
    expect(session.approvals.map((a) => a.summary)).toEqual([
      'Start: node -e "require(\'x\')"',
      'Start: npx vite',
    ]);
    expect(session.persistedRules).toEqual([]);
  });

  it('reading and stopping never ask', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('readProcess', { runId: 'abc' }, 'c1'),
      toolTurn('stopProcess', { runId: 'abc' }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, { processes: true });
    await session.agent.run('check it');
    expect(session.approvals).toEqual([]);
  });
});

describe('localAddresses: where a started program serves', () => {
  it('finds loopback and wildcard addresses, colour codes and all', () => {
    expect(
      localAddresses('  \x1b[32m➜\x1b[39m  Local:   http://localhost:\x1b[1m5173\x1b[22m/'),
    ).toEqual(['http://localhost:5173/']);
    expect(localAddresses('Running on http://127.0.0.1:5000.')).toEqual(['http://127.0.0.1:5000']);
    expect(localAddresses('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...')).toEqual([
      'http://localhost:8000/',
    ]);
    expect(localAddresses('ipv6 http://[::1]:3000/app, done')).toEqual(['http://[::1]:3000/app']);
  });

  it('leaves out addresses on other machines, and repeats', () => {
    expect(localAddresses('Network: http://192.168.1.20:5173/')).toEqual([]);
    expect(localAddresses('see https://example.com and http://localhost.evil.com/')).toEqual([]);
    expect(localAddresses('http://localhost:3000 http://localhost:3000')).toEqual([
      'http://localhost:3000',
    ]);
  });
});
