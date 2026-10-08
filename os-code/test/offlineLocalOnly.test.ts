// D5 in the engine (privacy review 2026-10-08, engine-routing-1 and 2): a
// local-only note's text never reaches a seat that leaves this network,
// however it travels. Desktop Offline makes the round trip automatic: a cloud
// Reasoning model gives way to a local seat, which may read a Journal note
// and carries a private project pin in its pack; the local window folds; a
// later task quotes the note; then the connection comes back and the cloud
// seat answers again, writes a title, and runs /compact. The mark must not
// fall off on the way: the fold's summary, a later reply, the title, the
// summary /compact sends, the Jev judge and the handoff all keep the note
// off the cloud. And a handoff to another model (delegate, analyzeImage,
// generateImage) bound for a seat off this network is refused while the chat
// holds such a note.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { LOCAL_ONLY_STUB, compileVaultPrivacy } from '../src/harness/vault/privacy.js';
import type { PreparedVaultContext, VaultContextSource } from '../src/harness/vaultContext.js';
import type { MachineOffline } from '../src/core/agent/offline.js';
import type { HandoffRecord } from '../src/core/agent/handoffStore.js';
import {
  HANDOFF_LOCAL_ONLY_DENIED,
  HANDOFF_PIN_DENIED,
  placeholderLine,
} from '../src/core/agent/loop.js';
import { adapterFor } from '../src/providers/adapters/index.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import type { FetchLike } from '../src/harness/jev.js';
import type { ChatEvent, ChatRequest } from '../src/providers/types.js';

const PIN = 'PIN-SECRET-7731';
const NOTE = 'NOTE-SECRET-4410';
const PIN_PATH = 'Private/plan.md';

const NETWORK_DOWN: MachineOffline = { offline: true, reason: 'network' };
const ONLINE: MachineOffline = { offline: false };

/** A switchable machine flag for one test. */
function flag(start: MachineOffline) {
  let now = start;
  return {
    read: () => now,
    set: (next: MachineOffline) => {
      now = next;
    },
  };
}

/** A vault source whose project pin sits under Private/, so it stays on this
 *  computer. The real pack builder renders it. */
function pinnedSource(): VaultContextSource {
  return {
    async prepare(): Promise<PreparedVaultContext> {
      return {
        index: null,
        bodies: new Map([[PIN_PATH, `# Plan\n\nThe plan says ${PIN}.\n`]]),
        pins: [],
        projectPins: [PIN_PATH],
        privacy: compileVaultPrivacy({
          exclude: [],
          localOnly: { paths: ['Private/', 'Journal/'], tags: ['private'] },
        }),
      };
    },
  };
}

/** A stand-in vault read: today's Journal note, local-only, as the vault
 *  tools return it to a seat that stays on this network. */
const journalRead = {
  name: 'vaultRead',
  description: 'Read a vault note.',
  schema: z.object({ path: z.string() }),
  risk: 'read' as const,
  pathJail: 'own' as const,
  async execute() {
    return {
      ok: true,
      content: `Dear diary, ${NOTE}. ${'It was a long day. '.repeat(10)}`,
      localOnly: true as const,
    };
  },
};

const ONE_SHOT = /^(Summarize this coding-session history|Write a title for this conversation)/;

/**
 * A provider that answers its one-shot summaries and titles by echoing what
 * it was sent, the worst case: a model that copies what it read. Its turns
 * still come from its script. Returns the one-shot prompts it saw.
 */
function echoOneShots(provider: MockProvider): string[] {
  const seen: string[] = [];
  const scripted = provider.chat.bind(provider);
  provider.chat = async function* (request: ChatRequest): AsyncGenerator<ChatEvent, void, void> {
    const only = request.messages.length === 1 ? request.messages[0]!.content : '';
    const prompt = typeof only === 'string' ? only : '';
    if (!ONE_SHOT.test(prompt)) {
      yield* scripted(request);
      return;
    }
    provider.requests.push({ ...request, messages: request.messages.map((m) => ({ ...m })) });
    seen.push(prompt);
    yield { type: 'text', delta: `What was read: ${prompt}` };
    yield { type: 'usage', promptTokens: 10, completionTokens: 10 };
    yield { type: 'done', stopReason: 'end' };
  } as MockProvider['chat'];
  return seen;
}

const deniedReasons = (events: AgentEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'tool-denied' ? [e.reason] : []));

describe('an offline round trip keeps a local-only note off the cloud (D5)', () => {
  it('the fold, a later reply, the title, /compact, the judge and the handoff', async () => {
    const state = flag(NETWORK_DOWN);
    // Words of the person's own, long enough that the small window folds.
    const asked = 'Keep the release notes short and plain. '.repeat(50);
    // The cloud task runs long enough that /compact has turns to fold.
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('glob', { pattern: '*.md' }, 'g1'),
        toolTurn('glob', { pattern: '*.txt' }, 'g2'),
        toolTurn('writeFile', { path: 'out.txt', content: 'plain' }, 'w1'),
        textTurn('Wrote it.'),
      ],
      { kind: 'cloud' },
    );
    const local = new MockProvider(
      'ollama',
      [
        toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
        toolTurn('glob', { pattern: '*.md' }, 'c2'),
        toolTurn('glob', { pattern: '*.txt' }, 'c3'),
        toolTurn('glob', { pattern: '*.json' }, 'c4'),
        toolTurn('glob', { pattern: '*.ts' }, 'c5'),
        textTurn(`From your journal: ${NOTE}.`),
        // The second task reads nothing, and quotes both anyway.
        textTurn(`Again: ${NOTE}, and the plan says ${PIN}.`),
      ],
      { models: ['qwen2.5-coder:7b'], caps: { contextTokens: 4096 } },
    );
    const localOneShots = echoOneShots(local);
    const cloudOneShots = echoOneShots(cloud);
    const handoffs: HandoffRecord[] = [];
    const jevBodies: string[] = [];
    const jevFetch: FetchLike = async (_url, init) => {
      jevBodies.push(init.body);
      return { ok: false, status: 503, json: async () => ({}) };
    };
    const session = makeTestSession(cloud, {
      providers: [local],
      offlineState: state.read,
      vaultRoot: mkdtempSync(join(tmpdir(), 'osc-vault-')),
      vaultContext: pinnedSource(),
      onHandoff: (record) => handoffs.push(record),
      harnessCurrents: { jev: { baseUrl: 'https://api.typesafe.ai' } },
      jevFetch,
      configOverrides: {
        stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      },
    });
    session.tools.register(journalRead);

    // Offline: the local seat reads today's note with the pin in its pack,
    // and its small window folds the task.
    await session.agent.run(`What did I write today? ${asked}`);
    // A second task, still offline: no read, and the reply quotes both.
    await session.agent.run(`Once more, briefly. ${asked}`);
    // Back online: the cloud seat answers (and writes, so the judge runs),
    // then a title, then /compact.
    state.set(ONLINE);
    await session.agent.run('Write out.txt with the word plain.');
    await session.agent.generateTitle();
    await session.agent.compactNow();

    // The path ran: the local seat had both, folded the note's text, and the
    // cloud seat got a turn, a title and a /compact.
    expect(JSON.stringify(local.requests)).toContain(PIN);
    expect(localOneShots.some((p) => p.includes(NOTE))).toBe(true);
    expect(cloudOneShots.filter((p) => p.startsWith('Write a title'))).toHaveLength(1);
    expect(cloudOneShots.filter((p) => p.startsWith('Summarize'))).toHaveLength(1);
    const completed = session.events.filter(
      (e) => e.type === 'task-done' && e.reason === 'complete',
    );
    expect(completed).toHaveLength(3);

    // No request to the cloud carried the pin or the note, only the stub.
    const sent = JSON.stringify(cloud.requests);
    expect(sent).not.toContain(PIN);
    expect(sent).not.toContain(NOTE);
    expect(sent).toContain(LOCAL_ONLY_STUB);
    // Nor did the judge's request to api.typesafe.ai, nor a stored handoff.
    expect(jevBodies.join('\n')).not.toContain(NOTE);
    expect(jevBodies.join('\n')).not.toContain(PIN);
    expect(handoffs.length).toBeGreaterThan(0);
    expect(JSON.stringify(handoffs)).not.toContain(NOTE);
    expect(JSON.stringify(handoffs)).not.toContain(PIN);
  });

  it('a reply on a seat that stays is marked while the chat holds such a note', async () => {
    const local = new MockProvider('ollama', [
      toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
      textTurn('Read it.'),
      textTurn(`It said ${NOTE}.`),
    ]);
    const session = makeTestSession(local);
    session.tools.register(journalRead);
    await session.agent.run('read my journal');
    await session.agent.run('what did it say?');
    const replies = session.agent.history.filter((m) => m.role === 'assistant');
    expect(replies.at(-1)).toMatchObject({ content: `It said ${NOTE}.`, localOnly: true });
  });
});

describe('a handoff never carries a local-only note to a cloud seat (D5)', () => {
  /** A local Reasoning model with one cloud specialist placed beside it. */
  function stackWith(
    specialists: Record<string, { provider: string; model: string }>,
    turns: ReturnType<typeof textTurn>[],
    extra: { offline?: MachineOffline; pinned?: boolean } = {},
  ) {
    const cloud = new MockProvider('anthropic', [textTurn('From the cloud seat.')], {
      kind: 'cloud',
      caps: { supportsVision: true },
    });
    const local = new MockProvider('mock', turns);
    const session = makeTestSession(local, {
      providers: [cloud],
      specialists: true,
      files: { 'shot.png': 'a picture' },
      ...(extra.offline ? { offlineState: () => extra.offline! } : {}),
      ...(extra.pinned
        ? {
            vaultRoot: mkdtempSync(join(tmpdir(), 'osc-vault-')),
            vaultContext: pinnedSource(),
          }
        : {}),
      configOverrides: {
        stack: { orchestrator: { provider: 'mock', model: 'mock-model' }, specialists },
      },
    });
    session.tools.register(journalRead);
    return { cloud, local, session };
  }

  const WRITER = { writing: { provider: 'anthropic', model: 'claude-sonnet-5' } };
  const EYES = { vision: { provider: 'anthropic', model: 'claude-sonnet-5' } };

  it('delegate to a cloud writer after a private read is refused in one plain line', async () => {
    const { cloud, local, session } = stackWith(WRITER, [
      toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
      toolTurn('delegate', { role: 'writing', task: `Write this up: ${NOTE}` }, 'c2'),
      textTurn('Wrote it up here.'),
    ]);
    await session.agent.run('write up my journal');
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
    expect(JSON.stringify(local.requests[2]!.messages)).toContain(HANDOFF_LOCAL_ONLY_DENIED);
    expect(session.events.at(-1)).toMatchObject({ type: 'task-done', reason: 'complete' });
  });

  it('a private pin in the pack is enough to hold it, and the refusal names the pin', async () => {
    const { cloud, session } = stackWith(
      WRITER,
      [
        toolTurn('delegate', { role: 'writing', task: `Polish: ${PIN}` }, 'c1'),
        textTurn('Did it here.'),
      ],
      { pinned: true },
    );
    await session.agent.run('polish the plan');
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([HANDOFF_PIN_DENIED]);
    expect(HANDOFF_PIN_DENIED).toBe(
      'A private note is pinned to this project, so this step is not handed to a cloud model.',
    );
  });

  // CX and CMO, 2026-10-08 (G): the refusal names its real cause. A pin alone
  // says the pin, through a reply marked only for it; once the chat also
  // reads a private note, it says the read.
  it('a pin alone, then a read: each refusal names its cause', async () => {
    const { cloud, session } = stackWith(
      WRITER,
      [
        toolTurn('delegate', { role: 'writing', task: `Polish: ${PIN}` }, 'c1'),
        textTurn('Did it here.'),
        // The next task: still only the pin, after a marked reply.
        toolTurn('delegate', { role: 'writing', task: 'Polish it again.' }, 'c2'),
        textTurn('Again here.'),
        // Then a read of a private note.
        toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c3'),
        toolTurn('delegate', { role: 'writing', task: `Write up: ${NOTE}` }, 'c4'),
        textTurn('Wrote it here.'),
      ],
      { pinned: true },
    );
    await session.agent.run('polish the plan');
    await session.agent.run('once more');
    await session.agent.run('now my journal');
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([
      HANDOFF_PIN_DENIED,
      HANDOFF_PIN_DENIED,
      HANDOFF_LOCAL_ONLY_DENIED,
    ]);
    expect(HANDOFF_LOCAL_ONLY_DENIED).toBe(
      'This chat has read a private note, so this step is not handed to a cloud model.',
    );
  });

  it('an Ollama cloud tag on this computer counts as a cloud writer (seatLeaves)', async () => {
    const { local, session } = stackWith(
      { writing: { provider: 'mock', model: 'kimi-k3:cloud' } },
      [
        toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
        toolTurn('delegate', { role: 'writing', task: `Write this up: ${NOTE}` }, 'c2'),
        textTurn('Wrote it up here.'),
      ],
    );
    await session.agent.run('write up my journal');
    expect(deniedReasons(session.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
    expect(local.requests.map((r) => r.model)).not.toContain('kimi-k3:cloud');
  });

  it('with nothing private in the chat, the same delegate runs on the cloud writer', async () => {
    const { cloud, session } = stackWith(WRITER, [
      toolTurn('delegate', { role: 'writing', task: 'Write a haiku about tides.' }, 'c1'),
      textTurn('Here it is.'),
    ]);
    await session.agent.run('a haiku');
    expect(cloud.requests).toHaveLength(1);
    expect(deniedReasons(session.events)).toEqual([]);
  });

  it('offline, the router keeps the subtask on this network, so it runs there', async () => {
    const { cloud, local, session } = stackWith(
      WRITER,
      [
        toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
        toolTurn('delegate', { role: 'writing', task: `Write this up: ${NOTE}` }, 'c2'),
        textTurn('Wrote it up here, on the subtask.'),
        textTurn('Done.'),
      ],
      { offline: NETWORK_DOWN },
    );
    await session.agent.run('write up my journal');
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([]);
    // The local orchestrator took the subtask itself.
    expect(JSON.stringify(local.requests)).toContain(`Write this up: ${NOTE}`);
  });

  it('back online, the cloud seat was sent only the stub, so its handoff to a cloud writer runs', async () => {
    // The chat still holds the note a local seat read while offline, but the
    // cloud Reasoning model that writes the delegate call never saw it.
    const state = flag(NETWORK_DOWN);
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('delegate', { role: 'writing', task: 'Write a haiku about tides.' }, 'd1'),
        textTurn('Tides come and go.'),
        textTurn('Here is the haiku.'),
      ],
      { kind: 'cloud' },
    );
    const local = new MockProvider(
      'ollama',
      [
        toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
        textTurn(`From your journal: ${NOTE}.`),
      ],
      { models: ['qwen2.5-coder:7b'] },
    );
    const session = makeTestSession(cloud, {
      providers: [local],
      offlineState: state.read,
      specialists: true,
      configOverrides: {
        stack: {
          orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' },
          specialists: WRITER,
        },
      },
    });
    session.tools.register(journalRead);
    await session.agent.run('What did I write today?');
    state.set(ONLINE);
    await session.agent.run('Now a haiku about tides.');
    expect(deniedReasons(session.events)).toEqual([]);
    // The orchestrator's turn, the writer's subtask, the orchestrator's answer.
    expect(cloud.requests).toHaveLength(3);
    expect(cloud.requests[1]!.messages.at(-1)!.content).toBe('Write a haiku about tides.');
    expect(JSON.stringify(cloud.requests)).not.toContain(NOTE);
  });

  it('analyzeImage to a cloud vision seat after a private read is refused', async () => {
    const { cloud, session } = stackWith(EYES, [
      toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
      toolTurn('analyzeImage', { path: 'shot.png', question: `Does it show ${NOTE}?` }, 'c2'),
      textTurn('Answered without the picture.'),
    ]);
    await session.agent.run('check the screenshot against my journal');
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
  });

  it('with nothing private in the chat, analyzeImage reaches the cloud vision seat', async () => {
    const { cloud, session } = stackWith(EYES, [
      toolTurn('analyzeImage', { path: 'shot.png', question: 'What does it show?' }, 'c1'),
      textTurn('It shows a picture.'),
    ]);
    await session.agent.run('what is in the screenshot?');
    expect(cloud.requests).toHaveLength(1);
  });

  /** A local Reasoning model with the stack's image maker at `baseUrl`; the
   *  prompts that reach it are recorded. */
  function imageMakerAt(baseUrl: string, turns: ReturnType<typeof textTurn>[]) {
    const local = new MockProvider('mock', turns);
    const session = makeTestSession(local, {
      specialists: true,
      configOverrides: { imageGen: { kind: 'openai-images', baseUrl } },
    });
    session.tools.register(journalRead);
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
    return { session, prompts };
  }

  const DRAW_THE_NOTE = [
    toolTurn('vaultRead', { path: 'Journal/today.md' }, 'c1'),
    toolTurn('generateImage', { prompt: `A poster that reads ${NOTE}` }, 'c2'),
    textTurn('Described it here instead.'),
  ];

  it('generateImage to an image server off this network after a private read is refused', async () => {
    const { session, prompts } = imageMakerAt('https://images.example/v1', DRAW_THE_NOTE);
    await session.agent.run('make a poster of my journal');
    expect(prompts).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
  });

  it('an image server on this computer still draws it, and a cloud one with nothing private', async () => {
    const here = imageMakerAt('http://127.0.0.1:7860', DRAW_THE_NOTE);
    await here.session.agent.run('make a poster of my journal');
    expect(here.prompts).toEqual([`A poster that reads ${NOTE}`]);
    expect(deniedReasons(here.session.events)).toEqual([]);
    const away = imageMakerAt('https://images.example/v1', [
      toolTurn('generateImage', { prompt: 'A lighthouse at dusk' }, 'c1'),
      textTurn('Here it is.'),
    ]);
    await away.session.agent.run('a lighthouse');
    expect(away.prompts).toEqual(['A lighthouse at dusk']);
  });
});

// CX and CMO, 2026-10-08 (F): the sticky mark stays, and the person is told
// once, where the context is lost: one status line per chat for each model
// off this network, on the first turn it is sent the placeholder.
describe('the placeholder line (F)', () => {
  const statusLines = (events: AgentEvent[]): string[] =>
    events.flatMap((e) => (e.type === 'status' ? [e.message] : []));

  /** A chat whose kept history holds a reply a local model wrote after a
   *  private read, as a revived session's seed gives it. */
  const MARKED = [
    { role: 'user' as const, content: 'What did I write today?' },
    {
      role: 'assistant' as const,
      content: `From your journal: ${NOTE}.`,
      localOnly: true as const,
    },
  ];

  it('says it once per cloud model in a marked chat, and again for a second one', async () => {
    const cloud = new MockProvider(
      'anthropic',
      [textTurn('One.'), textTurn('Two.'), textTurn('Three.')],
      { kind: 'cloud' },
    );
    const other = new MockProvider('openai', [textTurn('Four.')], { kind: 'cloud' });
    const session = makeTestSession(cloud, {
      providers: [other],
      configOverrides: {
        stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      },
    });
    session.agent.history = MARKED.map((m) => ({ ...m }));
    await session.agent.run('Now a haiku.');
    await session.agent.run('And another.');
    expect(
      statusLines(session.events).filter((l) => l === placeholderLine('claude-sonnet-5')),
    ).toHaveLength(1);
    expect(placeholderLine('claude-sonnet-5')).toBe(
      "This chat drew on a private note, so claude-sonnet-5 sees your local models' replies since then only as a placeholder.",
    );
    // The seat moves to a second cloud model (as a Stack change would): it is
    // told too, once.
    (session.agent as unknown as { active: unknown }).active = {
      provider: other,
      model: 'gpt-5',
      adapter: adapterFor('gpt-5'),
    };
    await session.agent.run('And a third.');
    expect(statusLines(session.events).filter((l) => l === placeholderLine('gpt-5'))).toHaveLength(
      1,
    );
    expect(JSON.stringify(cloud.requests)).not.toContain(NOTE);
    expect(JSON.stringify(other.requests)).not.toContain(NOTE);
  });

  it('never on a seat that stays, and never in a clean chat', async () => {
    const local = new MockProvider('ollama', [textTurn('Here.')]);
    const here = makeTestSession(local);
    here.agent.history = MARKED.map((m) => ({ ...m }));
    await here.agent.run('Once more.');
    expect(statusLines(here.events).some((l) => l.includes('placeholder'))).toBe(false);

    const cloud = new MockProvider('anthropic', [textTurn('Clean.')], { kind: 'cloud' });
    const clean = makeTestSession(cloud, {
      configOverrides: {
        stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      },
    });
    await clean.agent.run('A haiku.');
    expect(statusLines(clean.events).some((l) => l.includes('placeholder'))).toBe(false);
  });
});
