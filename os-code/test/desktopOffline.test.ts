// Desktop Offline (founder, 2026-10-07): "Desktop app can use offline when
// there is no internet and it needs to use just the local models." One
// machine flag, read before every turn: a cloud orchestrator gives way to the
// best model on this network, a cloud specialist is skipped, nothing
// escalates, the network tools leave the menu and are refused by name, the
// model is told, the transcript says each change once, and with no local
// model at all the turn ends with one plain line.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { resolveStack } from '../src/router/stack.js';
import { Router } from '../src/router/router.js';
import { offlineCut } from '../src/core/agent/registry.js';
import { bootstrapSession } from '../src/core/agent/bootstrap.js';
import { OFFLINE_DOWNLOAD, installOllamaRef } from '../src/market/install.js';
import {
  ONLINE_AGAIN_NOTE,
  OFFLINE_NOW_DENIED,
  OFFLINE_PROMPT,
  machineOffline,
  offlineNeedsLocalModel,
  offlineNoModelLine,
  offlineNote,
  rankLocalModels,
  setMachineOffline,
  type MachineOffline,
} from '../src/core/agent/offline.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

/** A switchable machine flag for one test. */
function flag(start: MachineOffline = { offline: false }) {
  let now = start;
  return {
    read: () => now,
    set: (next: MachineOffline) => {
      now = next;
    },
  };
}

const NETWORK_DOWN: MachineOffline = { offline: true, reason: 'network' };
const ONLINE: MachineOffline = { offline: false };

/** A cloud orchestrator with a local model server beside it. */
function cloudWithLocal(
  cloudTurns: ReturnType<typeof textTurn>[],
  localTurns: ReturnType<typeof textTurn>[],
  state: ReturnType<typeof flag>,
  extra: { models?: string[]; configOverrides?: Record<string, unknown> } = {},
) {
  const cloud = new MockProvider('anthropic', cloudTurns, { kind: 'cloud' });
  const local = new MockProvider('ollama', localTurns, {
    models: extra.models ?? ['nomic-embed-text', 'qwen3:4b', 'qwen2.5-coder:7b'],
  });
  const session = makeTestSession(cloud, {
    providers: [local],
    offlineState: state.read,
    configOverrides: {
      stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      ...extra.configOverrides,
    },
  });
  return { cloud, local, session };
}

const notes = (events: AgentEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'note' ? [e.message] : []));

describe('the offline seat', () => {
  it('ranks a local server: chat models only, coders first, larger first', () => {
    expect(
      rankLocalModels([
        'nomic-embed-text:latest',
        'qwen3:4b',
        'qwen2.5-coder:3b',
        'llama3.2:latest',
        'qwen2.5-coder:14b',
        'bge-m3',
      ]),
    ).toEqual(['qwen2.5-coder:14b', 'qwen2.5-coder:3b', 'qwen3:4b', 'llama3.2:latest']);
    expect(rankLocalModels(['all-minilm', 'mxbai-embed-large'])).toEqual([]);
  });

  it('a cloud orchestrator gives way to the best local model, said once', async () => {
    const state = flag(NETWORK_DOWN);
    const { cloud, local, session } = cloudWithLocal(
      [],
      [textTurn('Answered here.'), textTurn('Again here.')],
      state,
    );
    await session.agent.run('hello');
    await session.agent.run('and again');

    expect(cloud.requests).toHaveLength(0);
    expect(local.requests).toHaveLength(2);
    expect(local.requests[0]!.model).toBe('qwen2.5-coder:7b');
    // No spend card: nothing leaves this network.
    expect(session.approvals.filter((a) => a.kind === 'cloud-spend')).toHaveLength(0);
    const turn = session.events.find((e) => e.type === 'turn-start');
    expect(turn && turn.type === 'turn-start' && turn.providerKind).toBe('local');
    expect(notes(session.events).filter((n) => n === offlineNote('network'))).toHaveLength(1);
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
  });

  it('a local specialist the stack places stands in before a server list', async () => {
    const state = flag(NETWORK_DOWN);
    const coder = new MockProvider('coder', [textTurn('From the coder.')], { models: [] });
    const cloud = new MockProvider('anthropic', [], { kind: 'cloud' });
    const session = makeTestSession(cloud, {
      providers: [coder],
      offlineState: state.read,
      configOverrides: {
        stack: {
          orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' },
          specialists: { coding: { provider: 'coder', model: 'small-coder' } },
        },
      },
    });
    await session.agent.run('hello');
    expect(coder.requests[0]!.model).toBe('small-coder');
    expect(cloud.requests).toHaveLength(0);
  });

  it('flips live both ways: the next turn follows the flag, each change said once', async () => {
    const state = flag(ONLINE);
    const { cloud, local, session } = cloudWithLocal(
      [textTurn('Cloud one.'), textTurn('Cloud three.')],
      [textTurn('Local two.')],
      state,
    );
    await session.agent.run('one');
    expect(cloud.requests).toHaveLength(1);

    state.set(NETWORK_DOWN);
    await session.agent.run('two');
    expect(local.requests).toHaveLength(1);
    expect(cloud.requests).toHaveLength(1);

    state.set(ONLINE);
    await session.agent.run('three');
    expect(cloud.requests).toHaveLength(2);

    const said = notes(session.events);
    expect(said.filter((n) => n === offlineNote('network'))).toHaveLength(1);
    expect(said.filter((n) => n === ONLINE_AGAIN_NOTE)).toHaveLength(1);
    expect(said.indexOf(offlineNote('network'))).toBeLessThan(said.indexOf(ONLINE_AGAIN_NOTE));
  });

  it('going offline mid-task makes the next turn local', async () => {
    const state = flag(ONLINE);
    const cloud = new MockProvider('anthropic', [toolTurn('glob', { pattern: '*.md' })], {
      kind: 'cloud',
    });
    const local = new MockProvider('ollama', [textTurn('Finished locally.')], {
      models: ['qwen3:4b'],
    });
    const session = makeTestSession(cloud, {
      providers: [local],
      offlineState: state.read,
      files: { 'README.md': '# hi\n' },
      configOverrides: {
        stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      },
      // The connection goes while the tool runs.
      onEvent: (event) => {
        if (event.type === 'tool-end') state.set(NETWORK_DOWN);
      },
    });
    await session.agent.run('list the docs');
    expect(cloud.requests).toHaveLength(1);
    expect(local.requests).toHaveLength(1);
    expect(local.requests[0]!.model).toBe('qwen3:4b');
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('complete');
  });

  it('a chosen Offline says so in its own words', async () => {
    const state = flag({ offline: true, reason: 'chosen' });
    const { session } = cloudWithLocal([], [textTurn('ok')], state);
    await session.agent.run('hello');
    expect(notes(session.events)).toContain(offlineNote('chosen'));
    expect(offlineNote('chosen')).toMatch(/follow the connection again/);
  });

  it('with no model on this network, the turn ends with one plain line', async () => {
    const state = flag(NETWORK_DOWN);
    const cloud = new MockProvider('anthropic', [], { kind: 'cloud' });
    const session = makeTestSession(cloud, {
      offlineState: state.read,
      configOverrides: {
        stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      },
    });
    await session.agent.run('hello');
    expect(cloud.requests).toHaveLength(0);
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('error');
    const message = done && done.type === 'task-done' ? (done.message ?? '') : '';
    expect(message).toBe(offlineNoModelLine('network'));
    expect(offlineNeedsLocalModel(message)).toBe(true);
    expect(message).toMatch(/DeepBlue/);
    // One line: no offline note ahead of it.
    expect(notes(session.events)).toHaveLength(0);
  });
});

describe('what offline takes away', () => {
  it('no network tool on the menu, a call to one refused by name, the model told', async () => {
    const state = flag(NETWORK_DOWN);
    const local = new MockProvider('ollama', [
      toolTurn('webFetch', { url: 'https://example.com' }),
      textTurn('Worked from the files.'),
    ]);
    const session = makeTestSession(local, { offlineState: state.read });
    await session.agent.run('read the docs online');

    const offered = (local.requests[0]!.tools ?? []).map((t) => t.name);
    expect(offered).not.toContain('webFetch');
    expect(offered).not.toContain('webSearch');
    expect(offered).toContain('readFile');
    const system = local.requests[0]!.messages[0]!.content as string;
    expect(system).toContain(OFFLINE_PROMPT);
    const denied = session.events.find((e) => e.type === 'tool-denied');
    expect(denied && denied.type === 'tool-denied' && denied.reason).toBe(OFFLINE_NOW_DENIED);
  });

  it('online, the same session offers them again and the prompt says nothing of offline', async () => {
    const state = flag(ONLINE);
    const local = new MockProvider('ollama', [textTurn('ok')]);
    const session = makeTestSession(local, { offlineState: state.read });
    await session.agent.run('hello');
    const offered = (local.requests[0]!.tools ?? []).map((t) => t.name);
    expect(offered).toContain('webFetch');
    expect(local.requests[0]!.messages[0]!.content as string).not.toContain(OFFLINE_PROMPT);
  });

  it('no cloud escalation while offline', async () => {
    const state = flag(NETWORK_DOWN);
    const local = new MockProvider(
      'mock',
      [
        textTurn('{"tool": "nope", "args": {}}'),
        textTurn('{"tool": "nope", "args": {}}'),
        textTurn('{"tool": "nope", "args": {}}'),
        textTurn('{"tool": "nope", "args": {}}'),
      ],
      { caps: { supportsTools: false } },
    );
    const cloud = new MockProvider('anthropic', [textTurn('Cloud got it done.')], {
      kind: 'cloud',
    });
    const session = makeTestSession(local, {
      escalation: cloud,
      offlineState: state.read,
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' } },
        providers: { anthropic: { kind: 'anthropic' } },
        routing: { escalation: { enabled: true, afterToolFailures: 2 } },
      },
    });
    await session.agent.run('do the hard thing');
    expect(session.approvals.find((a) => a.kind === 'cloud-spend')).toBeUndefined();
    expect(session.events.find((e) => e.type === 'model-switch')).toBeUndefined();
    expect(cloud.requests).toHaveLength(0);
  });

  it('the cut names the routine slice, and an image server off this network', () => {
    const base = { stackHasVision: true, stackHasImageGen: true, stackHasSpecialists: true };
    const cut = offlineCut({ ...base, hasCodemagic: true, webSearch: false });
    expect(cut).toEqual(expect.arrayContaining(['webSearch', 'webFetch', 'codemagic']));
    // A handoff stays: the router keeps it on this network.
    expect(cut).not.toContain('delegate');
    expect(cut).not.toContain('analyzeImage');
    expect(cut).not.toContain('generateImage');
    expect(offlineCut({ ...base, imageServerLeaves: true })).toContain('generateImage');
  });
});

describe('the router offline', () => {
  function routerWith(
    specialists: Record<string, { provider: string; model: string }>,
    providers: MockProvider[],
    orchestrator: { provider: string; model: string },
    offline: () => boolean,
  ) {
    const config = ConfigSchema.parse({
      stack: { orchestrator, specialists },
      providers: { anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' } },
      routing: { escalation: { enabled: true } },
    });
    const registry = new ProviderRegistry(config, () => 'sk-ant-test');
    for (const p of providers) registry.register(p.id, p);
    return new Router(config, registry, resolveStack(config, registry), { offline });
  }

  it('skips a cloud specialist, falling to the local orchestrator', async () => {
    let offline = true;
    const orch = new MockProvider('orch', [textTurn('local did it'), textTurn('local again')]);
    const cloudCoder = new MockProvider('cloudcoder', [textTurn('cloud coder')], {
      kind: 'cloud',
    });
    const router = routerWith(
      { coding: { provider: 'cloudcoder', model: 'big-coder' } },
      [orch, cloudCoder],
      { provider: 'orch', model: 'local-model' },
      () => offline,
    );
    expect(await router.delegate('coding', 'write it')).toBe('local did it');
    expect(cloudCoder.requests).toHaveLength(0);
    expect(router.notes.at(-1)!.message).toMatch(/^Offline, so the coding specialist waits/);

    offline = false;
    expect(await router.delegate('coding', 'write it')).toBe('cloud coder');
  });

  it('a cloud orchestrator hands a subtask to the best local server model', async () => {
    const cloud = new MockProvider('anthropic', [], { kind: 'cloud' });
    const local = new MockProvider('ollama', [textTurn('from the local server')], {
      models: ['qwen2.5-coder:3b'],
    });
    const router = routerWith(
      {},
      [cloud, local],
      { provider: 'anthropic', model: 'claude-sonnet-5' },
      () => true,
    );
    expect(await router.delegate('fast', 'quick one')).toBe('from the local server');
    expect(local.requests[0]!.model).toBe('qwen2.5-coder:3b');
    expect(cloud.requests).toHaveLength(0);
  });

  it('never escalates offline, and does online', () => {
    let offline = true;
    const orch = new MockProvider('orch', []);
    const router = routerWith({}, [orch], { provider: 'orch', model: 'm' }, () => offline);
    expect(router.escalationEnabled()).toBe(false);
    offline = false;
    expect(router.escalationEnabled()).toBe(true);
  });
});

describe('the machine flag', () => {
  afterEach(() => {
    setMachineOffline(undefined);
  });

  it('is online until a host sets it, and set means set', () => {
    expect(machineOffline()).toEqual({ offline: false });
    expect(setMachineOffline('network')).toEqual({ offline: true, reason: 'network' });
    expect(machineOffline().offline).toBe(true);
    setMachineOffline(undefined);
    expect(machineOffline()).toEqual({ offline: false });
  });

  it('a model pull with no network says so plainly, before any request', async () => {
    setMachineOffline('network');
    const lines: string[] = [];
    const result = await installOllamaRef('qwen3:4b', (p) => lines.push(p.line));
    expect(result).toEqual({ ok: false, detail: OFFLINE_DOWNLOAD });
    expect(lines).toHaveLength(0);
    expect(OFFLINE_DOWNLOAD).not.toMatch(/lookup|dial|ENOTFOUND/i);
  });

  it('a bootstrapped session reads it per turn by default', async () => {
    // A cloud orchestrator and a local server on a dead port: offline, there
    // is no model to answer, so the turn ends before any request leaves.
    const cwd = mkdtempSync(join(tmpdir(), 'osc-offline-'));
    const config = ConfigSchema.parse({
      providers: {
        anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' },
        ollama: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1' },
      },
      stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    });
    const { driver } = bootstrapSession({
      cwd,
      profile: 'local-interactive',
      config,
      persist: false,
    });
    const events: AgentEvent[] = [];
    driver.subscribe((event) => {
      events.push(event as AgentEvent);
    }, 0);
    setMachineOffline('network');
    const done = new Promise<void>((resolve) => {
      driver.subscribe((event) => {
        if (event.type === 'task-done') resolve();
      }, Number.MAX_SAFE_INTEGER);
    });
    driver.send('hello');
    await done;
    const last = events.filter((e) => e.type === 'task-done').at(-1);
    expect(last && last.type === 'task-done' && last.message).toBe(offlineNoModelLine('network'));
  });
});
