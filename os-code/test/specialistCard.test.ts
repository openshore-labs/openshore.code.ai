// A placed cloud specialist asks first on the computer (CX and CMO,
// 2026-10-08, D): before the first handoff to it in each task, per model, on
// the amber card, for delegate, analyzeImage and generateImage to any target
// that leaves this network, an Ollama cloud tag included. The approval is
// keyed by provider and model, so the orchestrator's yes does not cover a
// specialist. The handoff's tool-start names the model, and a reach event
// turns the turn cloud.
import { describe, expect, it, onTestFinished } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { deniedReasons } from './helpers/privateNotes.js';
import type { AgentEvent, ApprovalRequest } from '../src/core/agent/types.js';
import type { MachineOffline } from '../src/core/agent/offline.js';

const cloudCards = (approvals: ApprovalRequest[]) =>
  approvals.filter((a) => a.kind === 'cloud-spend');

const handoffStarts = (events: AgentEvent[]) =>
  events.filter(
    (e): e is Extract<AgentEvent, { type: 'tool-start' }> =>
      e.type === 'tool-start' && e.handoff !== undefined,
  );

const reaches = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: 'reach' }> => e.type === 'reach');

/** A local Reasoning model on this computer with the given specialists. */
function localStack(
  turns: ReturnType<typeof textTurn>[],
  specialists: Record<string, { provider: string; model: string }>,
  extra: {
    providers?: MockProvider[];
    configProviders?: Record<string, unknown>;
    imageGen?: Record<string, unknown>;
    approve?: (r: ApprovalRequest) => { approve: boolean };
    offline?: MachineOffline;
    profile?: 'headless';
  } = {},
) {
  const local = new MockProvider('mock', turns);
  const session = makeTestSession(local, {
    providers: extra.providers ?? [],
    specialists: true,
    files: { 'shot.png': 'a picture' },
    ...(extra.approve ? { approve: extra.approve } : {}),
    ...(extra.offline ? { offlineState: () => extra.offline! } : {}),
    ...(extra.profile ? { profile: extra.profile } : {}),
    configOverrides: {
      stack: { orchestrator: { provider: 'mock', model: 'mock-model' }, specialists },
      ...(extra.configProviders ? { providers: extra.configProviders } : {}),
      ...(extra.imageGen ? { imageGen: extra.imageGen } : {}),
    },
  });
  return { local, session };
}

function claude(turns: ReturnType<typeof textTurn>[] = [textTurn('From Claude.')]) {
  return new MockProvider('anthropic', turns, { kind: 'cloud', caps: { supportsVision: true } });
}

const WRITER = { writing: { provider: 'anthropic', model: 'claude-sonnet-5' } };

describe('a placed cloud specialist asks before its first handoff in each task (D)', () => {
  it('delegate to Claude asks once, priced, and emits reach before a named tool-start', async () => {
    const cloud = claude();
    const { session } = localStack(
      [
        toolTurn('delegate', { role: 'writing', task: 'A haiku about tides.' }, 'd1'),
        textTurn('Done.'),
      ],
      WRITER,
      { providers: [cloud] },
    );
    await session.agent.run('a haiku');
    const cards = cloudCards(session.approvals);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.summary).toBe(
      'This step goes to claude-sonnet-5, the cloud model you placed for writing.',
    );
    expect(cards[0]!.detail).toMatch(
      /^Estimated cost: about \$\d+\.\d{3} per call on claude-sonnet-5\. Spent this session: \$\d+\.\d{2}\. Nothing is sent without this approval\.$/,
    );
    expect(cloud.requests).toHaveLength(1);
    // The reach comes just before the handoff's own tool-start.
    const i = session.events.findIndex((e) => e.type === 'reach');
    expect(session.events[i]).toEqual({
      type: 'reach',
      model: 'claude-sonnet-5',
      providerKind: 'cloud',
    });
    expect(session.events[i + 1]).toMatchObject({
      type: 'tool-start',
      handoff: { model: 'claude-sonnet-5', leaves: true },
    });
  });

  it('a cloud tag on Ollama on this computer names ollama.com and this computer', async () => {
    const ollama = new MockProvider('ollama', [textTurn('From the cloud tag.')]);
    const { session } = localStack(
      [toolTurn('delegate', { role: 'coding', task: 'Write a parser.' }, 'd1'), textTurn('Done.')],
      { coding: { provider: 'ollama', model: 'qwen3-coder:480b-cloud' } },
      {
        providers: [ollama],
        configProviders: {
          ollama: { kind: 'openai-compatible', baseUrl: 'http://localhost:11434' },
        },
      },
    );
    await session.agent.run('a parser');
    const [card] = cloudCards(session.approvals);
    expect(card!.summary).toBe(
      'This step goes to qwen3-coder:480b-cloud, the cloud model you placed for coding.',
    );
    expect(card!.detail).toBe(
      'Ollama on this computer passes the step the agent wrote on to ollama.com, under your Ollama account. Nothing is sent without this approval.',
    );
    expect(handoffStarts(session.events)[0]!.handoff).toEqual({
      model: 'qwen3-coder:480b-cloud',
      leaves: true,
    });
  });

  it('a cloud tag on an Ollama elsewhere on the network names that server', async () => {
    const lan = new MockProvider('lan', [textTurn('From the cloud tag.')]);
    const { session } = localStack(
      [toolTurn('delegate', { role: 'fast', task: 'Rename it.' }, 'd1'), textTurn('Done.')],
      { fast: { provider: 'lan', model: 'gpt-oss:120b-cloud' } },
      {
        providers: [lan],
        configProviders: {
          lan: { kind: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434' },
        },
      },
    );
    await session.agent.run('rename');
    const [card] = cloudCards(session.approvals);
    expect(card!.summary).toBe(
      'This step goes to gpt-oss:120b-cloud, the cloud model you placed for fast answers.',
    );
    expect(card!.detail).toBe(
      'The Ollama server at 192.168.1.20:11434 passes the step the agent wrote on to ollama.com, under your Ollama account. Nothing is sent without this approval.',
    );
  });

  it('analyzeImage to a cloud vision seat asks, for image reading', async () => {
    const cloud = claude();
    const { session } = localStack(
      [
        toolTurn('analyzeImage', { path: 'shot.png', question: 'What does it show?' }, 'v1'),
        textTurn('It shows a picture.'),
      ],
      { vision: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      { providers: [cloud] },
    );
    await session.agent.run('what is in the screenshot?');
    const [card] = cloudCards(session.approvals);
    expect(card!.summary).toBe(
      'This step goes to claude-sonnet-5, the cloud model you placed for image reading.',
    );
    expect(cloud.requests).toHaveLength(1);
    expect(reaches(session.events)).toHaveLength(1);
  });

  it('generateImage to an image server off this network asks, named by its model', async () => {
    // The image lands under the engine's home: a temporary one here.
    const previousHome = process.env.OSC_HOME;
    process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'osc-home-'));
    onTestFinished(() => {
      if (previousHome === undefined) delete process.env.OSC_HOME;
      else process.env.OSC_HOME = previousHome;
    });
    const { session } = localStack(
      [toolTurn('generateImage', { prompt: 'A lighthouse at dusk' }, 'g1'), textTurn('Here.')],
      {},
      {
        imageGen: { kind: 'openai-images', baseUrl: 'https://images.example/v1', model: 'dalle-x' },
      },
    );
    const prompts: string[] = [];
    session.toolContext.imageProvider = {
      id: 'imageGen',
      label: 'Image server',
      async generate(prompt) {
        prompts.push(prompt);
        return { imageBase64: 'aGk=', mediaType: 'image/png' };
      },
      async health() {
        return { ok: true, detail: 'ready' };
      },
    };
    await session.agent.run('a lighthouse');
    const [card] = cloudCards(session.approvals);
    expect(card!.summary).toBe(
      'This step goes to dalle-x, the cloud model you placed for image creation.',
    );
    expect(card!.detail).toBe(
      'The step the agent wrote goes to images.example. Nothing is sent without this approval.',
    );
    expect(prompts).toEqual(['A lighthouse at dusk']);
    expect(handoffStarts(session.events)[0]!.handoff).toEqual({ model: 'dalle-x', leaves: true });
  });

  it('a second handoff to the same model in the task does not ask; another cloud model does', async () => {
    const cloud = claude([textTurn('One.'), textTurn('Two.'), textTurn('Three.')]);
    const lan = new MockProvider('lan', [textTurn('From the tag.')]);
    const { session } = localStack(
      [
        toolTurn('delegate', { role: 'writing', task: 'First piece.' }, 'd1'),
        toolTurn('delegate', { role: 'writing', task: 'Second piece.' }, 'd2'),
        toolTurn('delegate', { role: 'coding', task: 'Some code.' }, 'd3'),
        textTurn('Done.'),
      ],
      { ...WRITER, coding: { provider: 'lan', model: 'kimi-k3:cloud' } },
      {
        providers: [cloud, lan],
        configProviders: {
          lan: { kind: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434' },
        },
      },
    );
    await session.agent.run('three pieces');
    expect(cloudCards(session.approvals).map((c) => c.summary)).toEqual([
      'This step goes to claude-sonnet-5, the cloud model you placed for writing.',
      'This step goes to kimi-k3:cloud, the cloud model you placed for coding.',
    ]);
    // A new task asks again.
    const again = claude([textTurn('Four.'), textTurn('Five.')]);
    const next = localStack(
      [
        toolTurn('delegate', { role: 'writing', task: 'One.' }, 'd1'),
        textTurn('Done.'),
        toolTurn('delegate', { role: 'writing', task: 'Two.' }, 'd2'),
        textTurn('Done again.'),
      ],
      WRITER,
      { providers: [again] },
    );
    await next.session.agent.run('one');
    await next.session.agent.run('two');
    expect(cloudCards(next.session.approvals)).toHaveLength(2);
  });

  it('a local target never asks, and its tool-start names it as staying', async () => {
    const writer = new MockProvider('writer', [textTurn('From the local writer.')]);
    const { session } = localStack(
      [toolTurn('delegate', { role: 'writing', task: 'A haiku.' }, 'd1'), textTurn('Done.')],
      { writing: { provider: 'writer', model: 'qwen3:8b' } },
      { providers: [writer] },
    );
    await session.agent.run('a haiku');
    expect(cloudCards(session.approvals)).toEqual([]);
    expect(reaches(session.events)).toEqual([]);
    expect(handoffStarts(session.events)[0]!.handoff).toEqual({ model: 'qwen3:8b', leaves: false });
  });

  it('approving the orchestrator does not cover a specialist', async () => {
    const orchestrator = new MockProvider(
      'anthropic',
      [toolTurn('delegate', { role: 'writing', task: 'A haiku.' }, 'd1'), textTurn('Done.')],
      { kind: 'cloud' },
    );
    const writer = new MockProvider('openai', [textTurn('From the other cloud.')], {
      kind: 'cloud',
    });
    const session = makeTestSession(orchestrator, {
      providers: [writer],
      specialists: true,
      configOverrides: {
        stack: {
          orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' },
          specialists: { writing: { provider: 'openai', model: 'gpt-5' } },
        },
      },
    });
    await session.agent.run('a haiku');
    expect(cloudCards(session.approvals).map((c) => c.summary)).toEqual([
      'This step runs on cloud Claude.',
      'This step goes to gpt-5, the cloud model you placed for writing.',
    ]);
  });

  it('a decline refuses the step in one line, and nothing is sent', async () => {
    const cloud = claude();
    const { local, session } = localStack(
      [toolTurn('delegate', { role: 'writing', task: 'A haiku.' }, 'd1'), textTurn('Did it here.')],
      WRITER,
      { providers: [cloud], approve: (r) => ({ approve: r.kind !== 'cloud-spend' }) },
    );
    await session.agent.run('a haiku');
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([
      'You declined sending this step to claude-sonnet-5.',
    ]);
    expect(JSON.stringify(local.requests.at(-1)!.messages)).toContain(
      'Not run: You declined sending this step to claude-sonnet-5. Do this part yourself.',
    );
    expect(reaches(session.events)).toEqual([]);
  });

  it('a profile with nobody to ask refuses without asking (the belt)', async () => {
    const cloud = claude();
    const { session } = localStack(
      [toolTurn('delegate', { role: 'writing', task: 'A haiku.' }, 'd1'), textTurn('Did it here.')],
      WRITER,
      { providers: [cloud], profile: 'headless' },
    );
    await session.agent.run('a haiku');
    expect(session.approvals).toEqual([]);
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([
      'This step goes to claude-sonnet-5, a cloud model, and a routine cannot ask you first, so it did not run.',
    ]);
  });

  it('offline never asks: the router keeps the step on this network', async () => {
    const cloud = claude();
    const { session } = localStack(
      [
        toolTurn('delegate', { role: 'writing', task: 'A haiku.' }, 'd1'),
        textTurn('Subtask answered here.'),
        textTurn('Done.'),
      ],
      WRITER,
      { providers: [cloud], offline: { offline: true, reason: 'network' } },
    );
    await session.agent.run('a haiku');
    expect(cloudCards(session.approvals)).toEqual([]);
    expect(cloud.requests).toHaveLength(0);
    expect(handoffStarts(session.events)).toEqual([]);
  });
});
