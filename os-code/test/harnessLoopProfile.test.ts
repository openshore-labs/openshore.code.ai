// The discipline seam wired into the loop: a small seat gets a lean prompt.
// harness.profiles is off in the test helper by default (so the rest of the
// suite carries the full prompt), and these tests turn it on and check what the
// model actually receives: fewer tools, a compact standards digest instead of
// the multi-KB text, and a one-time note. mid and large seats, and the off
// switch, keep the full prompt and every tool.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MockProvider, textTurn, toolTurn, type ScriptedTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import type { ChatRequest } from '../src/providers/types.js';

// The mock model has no size hint and a 32k window, so it derives to the small
// class. A big window pushes it to mid; cloud is always large.
function runWith(
  turns: ScriptedTurn[],
  configOverrides: Record<string, unknown>,
  caps?: { contextTokens?: number },
  kind?: 'local' | 'cloud',
): Promise<{ requests: ChatRequest[]; events: AgentEvent[] }> {
  const provider = new MockProvider('mock', turns, { kind, caps });
  const session = makeTestSession(provider, { configOverrides });
  return session.agent.run('do the thing').then(() => ({
    requests: provider.requests,
    events: session.events,
  }));
}

const systemOf = (req: ChatRequest): string => {
  const s = req.messages.find((m) => m.role === 'system');
  return typeof s?.content === 'string' ? s.content : JSON.stringify(s?.content);
};

describe('the discipline seam in the loop: a small seat gets a lean prompt', () => {
  it('shows a small model only its profile allowance of tools, core-first', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const tools = requests[0]!.tools!;
    // small class: at most 10 tools shown.
    expect(tools.length).toBeLessThanOrEqual(10);
    const names = tools.map((t) => t.name);
    // The coding core survived the cut.
    expect(names).toContain('readFile');
    expect(names).toContain('editFile');
    expect(names).toContain('writeFile');
    expect(names).toContain('grep');
  });

  it('sends a compact digest, not the full UX and humanizer text, to a small seat', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain("OpenShore's premium bar");
    // The full multi-KB standards markers are absent.
    expect(system).not.toContain('UX STANDARD');
    expect(system).not.toContain("Hick's law");
  });

  it('gives a small seat a short, direct core instead of the full etiquette', async () => {
    // The full core tells a capable model to report like a colleague, ask
    // before touching working code, and open with todoWrite. A 3B reads those
    // as the task and explains or asks instead of editing. The lean core says:
    // do it, do not ask, answer briefly.
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain('Never ask for permission');
    expect(system).toContain('Workspace root:');
    expect(system).not.toContain('call todoWrite first');
    expect(system).not.toContain('blast radius');
    expect(system).not.toContain('propose one line for their standing instructions');
  });

  it('tells a lean seat not to reach for git tools on an ordinary task', async () => {
    // The deep eval's rename task burned turns on gitStatus (which failed,
    // the fixture is not a repo) then a hallucinated "gitAdd" tool that does
    // not exist, ending the task in a parse-error escalation instead of
    // finishing the rename. Nothing in the task asked for version control.
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const system = systemOf(requests[0]!);
    expect(system).toMatch(/do not (check git status or use|use) (any )?git/i);
  });

  it('a lean seat gets its class allowance of verify retries, a full seat the config default', async () => {
    // A check that always fails: the loop hands it back to the model until the
    // allowance is spent. Small class: 4 retries, so 5 checks. Profiles off:
    // the config default of 2, so 3 checks.
    const always = (n: number) => [
      toolTurn('writeFile', { path: 'a.txt', content: 'x\n' }),
      ...Array.from({ length: n }, () => textTurn('done')),
    ];
    const verify = { command: 'node -e "process.exit(1)"' };
    const lean = new MockProvider('mock', always(6));
    const leanSession = makeTestSession(lean, {
      configOverrides: { harness: { profiles: { enabled: true }, verify } },
    });
    await leanSession.agent.run('write a.txt');
    expect(leanSession.events.filter((e) => e.type === 'verify')).toHaveLength(5);

    const full = new MockProvider('mock', always(6));
    const fullSession = makeTestSession(full, {
      configOverrides: { harness: { profiles: { enabled: false }, verify } },
    });
    await fullSession.agent.run('write a.txt');
    expect(fullSession.events.filter((e) => e.type === 'verify')).toHaveLength(3);
  });

  it('tells a lean seat to run code it is asked about rather than reason about it', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    expect(systemOf(requests[0]!)).toMatch(/run it with runShell/);
  });

  it('a full seat keeps the complete core', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: false } },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain('call todoWrite first');
    expect(system).toContain('blast radius');
    expect(system).not.toContain('Never ask for permission');
  });

  it('carries a project ux note into the lean digest', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
      ux: { standard: 'premium', notes: 'Brand color is teal.' },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain('This project adds: Brand color is teal.');
  });

  it('says once, plainly, that a small seat is running with the harness', async () => {
    const { events } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const notes = events.filter((e) => e.type === 'note') as Array<{ message: string }>;
    const seat = notes.filter((n) => /model seat/i.test(n.message));
    expect(seat).toHaveLength(1);
    expect(seat[0]!.message).toMatch(/tools/i);
  });

  it('a mid seat (big window) keeps every tool and the full standards', async () => {
    const { requests } = await runWith(
      [textTurn('done')],
      { harness: { profiles: { enabled: true } } },
      { contextTokens: 200_000 }, // a large window derives to mid when size is unknown
    );
    const tools = requests[0]!.tools!;
    expect(tools.length).toBeGreaterThan(10);
    expect(systemOf(requests[0]!)).toContain('UX STANDARD');
  });

  it('with profiles off, a small model still gets every tool and the full prompt', async () => {
    const { requests, events } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: false } },
    });
    expect(requests[0]!.tools!.length).toBeGreaterThan(10);
    expect(systemOf(requests[0]!)).toContain('UX STANDARD');
    const seat = (events.filter((e) => e.type === 'note') as Array<{ message: string }>).filter(
      (n) => /model seat/i.test(n.message),
    );
    expect(seat).toHaveLength(0);
  });

  it('is on by default in the engine config', async () => {
    // The test helper turns it off; the shipped default is on. Lock that here so
    // a schema change cannot silently ship the harness disabled.
    const { ConfigSchema } = await import('../src/config/schema.js');
    expect(ConfigSchema.parse({}).harness.profiles.enabled).toBe(true);
  });
});

// A lean seat sees only its class allowance of tools. Whatever the prompt tells
// it to use must be on that menu, or it spends its small context on a tool it
// cannot call. The reference box's 7B (small) was told to keep project memory
// with projectMemoryWrite, which its cut never shows, and a tiny seat was told
// to run code with runShell, which its six-tool menu leaves out.
describe('no prompt names a tool the seat was not given', () => {
  const seats: Array<[string, string, number]> = [
    ['small (a 7B)', 'qwen2.5-coder:7b', 10],
    ['tiny (a 1.5B)', 'qwen2.5-coder:1.5b', 6],
  ];
  for (const [label, model, allowance] of seats) {
    it(`a ${label} seat is told only about tools it was given`, async () => {
      const provider = new MockProvider('mock', [textTurn('done')]);
      const session = makeTestSession(provider, {
        projectName: 'Demo',
        configOverrides: {
          stack: { orchestrator: { provider: 'mock', model } },
          harness: { profiles: { enabled: true } },
        },
      });
      await session.agent.run('do the thing');
      const request = provider.requests[0]!;
      const given = new Set(request.tools!.map((t) => t.name));
      expect(given.size).toBe(allowance);
      const system = systemOf(request);
      const named = session.tools
        .specs()
        .map((spec) => spec.name)
        .filter((name) => new RegExp(`\\b${name}\\b`).test(system));
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((name) => !given.has(name))).toEqual([]);
      expect(given.has('projectMemoryWrite')).toBe(false);
      // Only the write half is cut. Reading the top sheet needs readFile,
      // which every lean cut keeps, so the seat is still pointed at it.
      expect(given.has('readFile')).toBe(true);
      expect(system).toContain('PROJECT MEMORY');
      expect(system).toContain('OpenShore Project Demo MDs/Current State.md');
      expect(system).not.toContain('Keep them current');
    });
  }

  it('a seat that is offered projectMemoryWrite still gets the project memory block', async () => {
    const provider = new MockProvider('mock', [textTurn('done')]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      configOverrides: { harness: { profiles: { enabled: false } } },
    });
    await session.agent.run('do the thing');
    const request = provider.requests[0]!;
    expect(request.tools!.map((t) => t.name)).toContain('projectMemoryWrite');
    const system = systemOf(request);
    expect(system).toContain('PROJECT MEMORY');
    expect(system).toContain('projectMemoryWrite');
    expect(system).toContain('OpenShore Project Demo MDs/Current State.md');
    expect(system).toContain('Keep them current');
  });

  it('a small seat keeps the runShell line it can act on', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    expect(requests[0]!.tools!.map((t) => t.name)).toContain('runShell');
    expect(systemOf(requests[0]!)).toMatch(/run it with runShell/);
  });
});

// Vault M4, 4.1 and 4.5 (CTO I2, I11): the class's budgets reach the loop,
// and each seat gets one way into the vault.
describe('the class budgets and vault menu in the loop', () => {
  const bigMap = Array.from({ length: 4000 }, (_, i) => `src/file${i}.ts: fn${i}`).join('\n');
  const mapIn = (system: string): string =>
    system.slice(
      system.indexOf('Repository map'),
      system.indexOf('\n\n', system.indexOf('Repository map')),
    );

  it('cuts the code map to the class share of the served window, on a line boundary', async () => {
    const run = async (profiles: boolean, contextTokens: number) => {
      const provider = new MockProvider('mock', [textTurn('done')], { caps: { contextTokens } });
      const session = makeTestSession(provider, {
        codeMap: bigMap,
        configOverrides: { harness: { profiles: { enabled: profiles } } },
      });
      await session.agent.run('go');
      return mapIn(systemOf(provider.requests[0]!));
    };
    // small: 20% of a 32k window, 4 chars a token.
    const small = await run(true, 32768);
    expect(small.length).toBeLessThan(Math.floor(32768 * 0.2 * 4) + 120);
    expect(small).toContain("the map stops here to fit this model's window");
    expect(small).toMatch(/src\/file\d+\.ts: fn\d+\n\(the map stops here/);
    // A smaller window cuts harder: the budget scales with the window.
    const smaller = await run(true, 8192);
    expect(smaller.length).toBeLessThan(small.length);
    // mid (a big window) and profiles off keep the whole map.
    expect(await run(true, 200_000)).toContain('src/file3999.ts');
    expect(await run(false, 32768)).toContain('src/file3999.ts');
  });

  const lookup = {
    name: 'vaultLookup',
    description: 'Search and read the vault.',
    schema: z.object({ query: z.string().optional() }),
    risk: 'read' as const,
    pathJail: 'own' as const,
    async execute() {
      return { ok: true, content: 'nothing' };
    },
  };

  const menu = async (model: string, profiles: boolean) => {
    const provider = new MockProvider('mock', [textTurn('done')]);
    const session = makeTestSession(provider, {
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model } },
        harness: { profiles: { enabled: profiles } },
      },
    });
    session.tools.register(lookup);
    await session.agent.run('go');
    return provider.requests[0]!.tools!.map((t) => t.name);
  };

  it('a small seat sees the merged vault tool and not the separate reads', async () => {
    const names = await menu('qwen2.5-coder:7b', true);
    expect(names).toContain('vaultLookup');
    expect(names).not.toContain('vaultRead');
    expect(names).not.toContain('vaultList');
    expect(names).toHaveLength(10);
  });

  it('a tiny seat leans on the pack: its six tools hold no vault tool', async () => {
    const names = await menu('qwen2.5-coder:1.5b', true);
    expect(names).toHaveLength(6);
    expect(names.filter((n) => n.startsWith('vault'))).toEqual([]);
  });

  it('a full seat sees the separate reads and not the merged tool', async () => {
    for (const names of [await menu('qwen2.5-coder:32b', true), await menu('mock-model', false)]) {
      expect(names).toContain('vaultRead');
      expect(names).toContain('vaultList');
      expect(names).not.toContain('vaultLookup');
    }
  });

  it('plan mode names the vault reads the seat is offered, never the write', async () => {
    const provider = new MockProvider('mock', [textTurn('1. do it')]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { profiles: { enabled: false } } },
    });
    session.agent.setMode('plan');
    await session.agent.run('plan it');
    const plan = systemOf(provider.requests[0]!)
      .split('\n\n')
      .find((p) => p.startsWith('PLAN MODE.'))!;
    expect(plan).toContain('the vault reads vaultSearch, vaultRead, vaultBacklinks, vaultList');
    expect(plan).not.toContain('vaultWrite');
  });
});
