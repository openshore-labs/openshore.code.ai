// The vault context layer in the loop (Vault M4, CTO I5, I8 to I12): the pack
// rides the system prompt after the code map, per seat, gated by Memory and
// `vault.context`; a local-only note's text never reaches a seat that leaves
// this network; vault writes are not code changes; and after a change
// verifies on a lean seat the harness keeps Current State current itself.
//
// The pack builder is stream A's pure core; here it is replaced by a small
// fake that honors the contract (Current State as one note, local-only notes
// withheld from a leaving seat), so these tests pin the LOOP's wiring, not
// the builder's rendering.
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import type { ChatRequest } from '../src/providers/types.js';
import type {
  ContextPack,
  PackBuildInput,
  PreparedVaultContext,
  VaultContextSource,
} from '../src/harness/vaultContext.js';
import { LOCAL_ONLY_STUB } from '../src/harness/vault/privacy.js';
import { HARNESS_LINE_MARK, withLandedLine } from '../src/core/tools/projectMemory.js';
import { MEMORY_FILES } from '../src/core/agent/projectMemory.js';

const builds: PackBuildInput[] = [];

vi.mock('../src/harness/vaultContext.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/harness/vaultContext.js')>();
  return {
    ...real,
    buildContextPack: (input: PackBuildInput): ContextPack => {
      builds.push(input);
      const cs = input.currentState;
      if (!cs) return { text: '', tokens: 0, used: [], withheld: 0, cold: input.index === null };
      const hidden =
        input.seat.leavesNetwork && input.privacy.visibility({ path: cs.path }) === 'local-only';
      if (hidden) return { text: '', tokens: 0, used: [], withheld: 1, cold: input.index === null };
      const text = `${real.VAULT_NOTES_FRAMING}\n<note path="${cs.path}" updated="2026-09-27" why="current-state">\n${cs.text}\n</note>`;
      return {
        text,
        tokens: Math.ceil(text.length / 4),
        used: [{ layer: 'current-state', path: cs.path, title: 'Current State' }],
        withheld: 0,
        cold: input.index === null,
      };
    },
  };
});

const CS_PATH = 'OpenShore Project Demo MDs/Current State.md';
const CS_TEXT =
  '# Current State\n\n## What last landed and launched\n- the parser landed MARKER-CS';

function fakeSource(
  options: { localOnly?: boolean } = {},
): VaultContextSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async prepare(task: string): Promise<PreparedVaultContext> {
      calls.push(task);
      return {
        index: null,
        bodies: new Map(),
        currentState: { path: CS_PATH, text: CS_TEXT },
        pins: [],
        privacy: { visibility: () => (options.localOnly ? 'local-only' : 'open') },
      };
    },
  };
}

const systemOf = (req: ChatRequest): string => {
  const s = req.messages.find((m) => m.role === 'system');
  return typeof s?.content === 'string' ? s.content : JSON.stringify(s?.content);
};

const packEvents = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'context-pack') as Array<
    Extract<AgentEvent, { type: 'context-pack' }>
  >;

const SMALL = {
  stack: { orchestrator: { provider: 'mock', model: 'qwen2.5-coder:7b' } },
  harness: { profiles: { enabled: true } },
};

describe('the pack in the prompt (4.4, I8 to I10)', () => {
  it('a small seat gets Current State inline with no vault tool', async () => {
    builds.length = 0;
    const provider = new MockProvider('mock', [textTurn('done')]);
    const source = fakeSource();
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      vaultContext: source,
      configOverrides: SMALL,
    });
    await session.agent.run('what landed last?');
    const req = provider.requests[0]!;
    const tools = req.tools!.map((t) => t.name);
    expect(tools.filter((n) => n.startsWith('vault'))).toEqual([]);
    const system = systemOf(req);
    expect(system).toContain('MARKER-CS');
    // The seat is told it already has the top sheet, not sent to readFile it.
    expect(system).toContain('is already included below');
    expect(system).not.toContain('Read the top sheet first');
    // Prepared once, with the task's own words; rendered in Current State
    // mode (I9) on this seat's budget: 8% of the 32k served window (I2).
    expect(source.calls).toEqual(['what landed last?']);
    expect(builds[0]!.mode).toBe('current-state');
    expect(builds[0]!.budgetTokens).toBe(Math.floor(32768 * 0.08));
    expect(builds[0]!.seat).toEqual({ modelClass: 'small', leavesNetwork: false });
    const cards = packEvents(session.events);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ seat: 'local', mode: 'current-state', withheld: 0 });
    expect(cards[0]!.sources[0]!.layer).toBe('current-state');
  });

  it('sits after the code map and before the text protocol', async () => {
    const provider = new MockProvider('mock', [textTurn('done')], {
      caps: { supportsTools: false },
    });
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      vaultContext: fakeSource(),
      codeMap: 'src/a.ts: fn a',
    });
    await session.agent.run('go');
    const system = systemOf(provider.requests[0]!);
    const map = system.indexOf('Repository map');
    const pack = system.indexOf('MARKER-CS');
    // The tool protocol stays last, for its recency on a small seat.
    const protocol = system.indexOf('TOOLS. You can use tools.');
    expect(map).toBeGreaterThan(-1);
    expect(pack).toBeGreaterThan(map);
    expect(protocol).toBeGreaterThan(pack);
  });

  it('Memory off removes the pack, and so does vault.context off', async () => {
    for (const overrides of [{ memory: { enabled: false } }, { vault: { context: 'off' } }]) {
      const provider = new MockProvider('mock', [textTurn('done')]);
      const source = fakeSource();
      const session = makeTestSession(provider, {
        projectName: 'Demo',
        vaultContext: source,
        configOverrides: overrides,
      });
      await session.agent.run('go');
      expect(source.calls).toEqual([]);
      expect(systemOf(provider.requests[0]!)).not.toContain('MARKER-CS');
      expect(packEvents(session.events)).toEqual([]);
    }
  });

  it('a source that fails leaves the task without a pack, not without an answer', async () => {
    const provider = new MockProvider('mock', [textTurn('done')]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      vaultContext: {
        prepare: () => Promise.reject(new Error('index gone')),
      },
    });
    await session.agent.run('go');
    expect(session.events.at(-1)).toMatchObject({ type: 'task-done', reason: 'complete' });
    expect(systemOf(provider.requests[0]!)).not.toContain('MARKER-CS');
  });

  it('forces Current State only when the session has no vault, even under full', async () => {
    builds.length = 0;
    const provider = new MockProvider('mock', [textTurn('done')]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      vaultContext: fakeSource(),
      configOverrides: { vault: { context: 'full' } },
    });
    await session.agent.run('go');
    expect(builds[0]!.mode).toBe('current-state');
    expect(builds[0]!.index).toBeNull();
  });
});

/** A stand-in vault read whose result is a local-only note. */
const privateRead = {
  name: 'vaultRead',
  description: 'Read a vault note.',
  schema: z.object({ path: z.string() }),
  risk: 'read' as const,
  pathJail: 'own' as const,
  async execute() {
    return { ok: true, content: 'PRIVATE-TEXT from Journal/today.md', localOnly: true as const };
  },
};

function escalatingSession(source?: VaultContextSource) {
  const local = new MockProvider('mock', [
    toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
    toolTurn('readFile', { path: 'missing-1.txt' }, 'c2'),
    toolTurn('readFile', { path: 'missing-2.txt' }, 'c3'),
  ]);
  const cloud = new MockProvider('anthropic', [textTurn('Cloud finished.')], { kind: 'cloud' });
  const session = makeTestSession(local, {
    projectName: 'Demo',
    escalation: cloud,
    vaultContext: source,
    configOverrides: {
      providers: { anthropic: { kind: 'anthropic' } },
      routing: { escalation: { enabled: true, afterToolFailures: 2 } },
    },
  });
  session.tools.register(privateRead);
  return { local, cloud, session };
}

describe('local-only text never leaves on an escalation (I5)', () => {
  it('sends the cloud seat a stub, keeps the note in history, and a local seat sees it', async () => {
    const { local, cloud, session } = escalatingSession();
    await session.agent.run('what did I write today?');
    expect(session.events.some((e) => e.type === 'model-switch')).toBe(true);
    // The local seat, which may read it, saw the note on the next turn.
    expect(JSON.stringify(local.requests[1]!.messages)).toContain('PRIVATE-TEXT');
    const sent = JSON.stringify(cloud.requests[0]!.messages);
    expect(sent).not.toContain('PRIVATE-TEXT');
    expect(sent).toContain(LOCAL_ONLY_STUB);
    // Kept history is untouched, so a later local turn still has it.
    expect(JSON.stringify(session.agent.history)).toContain('PRIVATE-TEXT');
    expect(session.toolContext.seatLeavesNetwork?.()).toBe(true);
  });

  it('re-renders the pack for the cloud seat and shows a second card', async () => {
    builds.length = 0;
    const { cloud, session } = escalatingSession(fakeSource({ localOnly: true }));
    await session.agent.run('go');
    const cards = packEvents(session.events);
    expect(cards.map((c) => c.seat)).toEqual(['local', 'cloud']);
    expect(cards[1]!.withheld).toBe(1);
    expect(systemOf(cloud.requests[0]!)).not.toContain('MARKER-CS');
    expect(builds.some((b) => b.seat.leavesNetwork)).toBe(true);
  });
});

describe('vault writes are not code changes (4.5, I11)', () => {
  const noteWrite = {
    name: 'vaultWrite',
    description: 'Write a vault note.',
    schema: z.object({ path: z.string() }),
    risk: 'write' as const,
    pathJail: 'own' as const,
    pathOf: (args: { path: string }) => args.path,
    async execute() {
      return { ok: true, content: 'Saved.' };
    },
  };
  const verify = { command: 'node -e "process.exit(0)"' };

  it('a vaultWrite runs no verify', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('vaultWrite', { path: 'Ideas.md' }),
      textTurn('noted'),
    ]);
    const session = makeTestSession(provider, { configOverrides: { harness: { verify } } });
    session.tools.register(noteWrite);
    await session.agent.run('note it');
    expect(session.events.filter((e) => e.type === 'verify')).toEqual([]);
  });

  it('a file write inside the vault runs no verify; one outside it does', async () => {
    const run = async (path: string) => {
      const provider = new MockProvider('mock', [
        toolTurn('writeFile', { path, content: 'x\n' }),
        textTurn('done'),
      ]);
      const session = makeTestSession(provider, { configOverrides: { harness: { verify } } });
      mkdirSync(join(session.cwd, 'vault'), { recursive: true });
      session.toolContext.vaultRoot = join(session.cwd, 'vault');
      await session.agent.run('write it');
      return session.events.filter((e) => e.type === 'verify').length;
    };
    expect(await run('vault/Idea.md')).toBe(0);
    expect(await run('src.txt')).toBe(1);
  });
});

describe('Current State kept current on a lean seat (4.7, I12)', () => {
  const pass = { command: 'node -e "process.exit(0)"' };
  const now = () => new Date(2026, 8, 27, 12);
  const csFile = (cwd: string) => join(cwd, 'OpenShore Project Demo MDs', 'Current State.md');

  function leanRun(
    overrides: Record<string, unknown>,
    content = 'x\n',
    cwd?: string,
    extraTurns: ReturnType<typeof toolTurn>[] = [],
  ) {
    const provider = new MockProvider('mock', [
      ...extraTurns,
      toolTurn('writeFile', { path: 'a.txt', content }),
      textTurn('done'),
      ...Array.from({ length: 12 }, () => textTurn('done')),
    ]);
    return makeTestSession(provider, {
      projectName: 'Demo',
      now,
      cwd,
      configOverrides: { ...SMALL, ...overrides },
    });
  }

  it('a verified change on a small seat appends one dated line', async () => {
    const session = leanRun({ harness: { profiles: { enabled: true }, verify: pass } });
    await session.agent.run('write a.txt');
    const text = readFileSync(csFile(session.cwd), 'utf8');
    const lines = text.split('\n').filter((l) => l.endsWith(HARNESS_LINE_MARK));
    expect(lines).toEqual([
      '- 2026-09-27: changed a.txt, `node -e "process.exit(0)"` passed (noted by the harness)',
    ]);
    // First under its heading, the seed's placeholder gone.
    const heading = text.indexOf('## What last landed and launched');
    expect(text.slice(heading).split('\n')[1]).toBe(lines[0]);
    expect(text).not.toContain('Nothing yet. The first change to land');
    const notes = session.events.filter((e) => e.type === 'note') as Array<{ message: string }>;
    expect(notes.some((n) => n.message.startsWith('Noted in OpenShore Project Demo MDs'))).toBe(
      true,
    );
    // The line is not a tool write: no second verify ran for it.
    expect(session.events.filter((e) => e.type === 'verify')).toHaveLength(1);
  });

  it('a failed verify appends nothing', async () => {
    const session = leanRun({
      harness: { profiles: { enabled: true }, verify: { command: 'node -e "process.exit(1)"' } },
    });
    await session.agent.run('write a.txt');
    expect(existsSync(csFile(session.cwd))).toBe(false);
  });

  it('a skipped verify (no check) appends nothing', async () => {
    const session = leanRun({});
    await session.agent.run('write a.txt');
    expect(existsSync(csFile(session.cwd))).toBe(false);
  });

  it('an identical line is not written twice', async () => {
    const first = leanRun({ harness: { profiles: { enabled: true }, verify: pass } }, 'one\n');
    await first.agent.run('write a.txt');
    const before = readFileSync(csFile(first.cwd), 'utf8');
    const second = leanRun(
      { harness: { profiles: { enabled: true }, verify: pass } },
      'two\n',
      first.cwd,
    );
    await second.agent.run('write a.txt again');
    expect(readFileSync(csFile(first.cwd), 'utf8')).toBe(before);
  });

  it('a full seat, or a seat that wrote Current State itself, gets no harness line', async () => {
    const full = leanRun({ harness: { profiles: { enabled: false }, verify: pass } });
    await full.agent.run('write a.txt');
    expect(existsSync(csFile(full.cwd))).toBe(false);

    const own = leanRun(
      { harness: { profiles: { enabled: true }, verify: pass } },
      'x\n',
      undefined,
      [
        toolTurn(
          'projectMemoryWrite',
          { file: 'Current State', content: '# Current State\nmine\n', mode: 'replace' },
          'm1',
        ),
      ],
    );
    await own.agent.run('write a.txt');
    expect(readFileSync(csFile(own.cwd), 'utf8')).not.toContain(HARNESS_LINE_MARK);
  });

  it('keeps at most five harness lines, newest first, and leaves the rest alone', () => {
    const seed = MEMORY_FILES[0]!.seed;
    let text = seed;
    for (let day = 1; day <= 7; day++) {
      text = withLandedLine(text, `- 2026-09-0${day}: changed a.ts ${HARNESS_LINE_MARK}`)!;
    }
    const mine = text.split('\n').filter((l) => l.endsWith(HARNESS_LINE_MARK));
    expect(mine).toHaveLength(5);
    expect(mine[0]).toContain('2026-09-07');
    expect(mine[4]).toContain('2026-09-03');
    expect(text).toContain('## Key outstanding build actions');
    // A person's own line in the section survives the pruning.
    const withOwn = text.replace(
      '## What last landed and launched\n',
      '## What last landed and launched\n- my own line\n',
    );
    const next = withLandedLine(withOwn, `- 2026-09-08: x ${HARNESS_LINE_MARK}`)!;
    expect(next).toContain('- my own line');
    expect(next.split('\n').filter((l) => l.endsWith(HARNESS_LINE_MARK))).toHaveLength(5);
    // A note without the heading gains it.
    expect(withLandedLine('# Current State\n', '- l')).toBe(
      '# Current State\n\n## What last landed and launched\n- l\n',
    );
  });
});
