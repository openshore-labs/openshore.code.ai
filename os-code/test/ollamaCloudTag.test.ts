// An Ollama cloud tag is a seat that leaves this network (privacy review,
// 2026-10-08, findings electron-daemon-1 and -4). A model named with the tag
// `cloud`, or a tag ending in `-cloud` (kimi-k3:cloud, gpt-oss:120b-cloud),
// is served by the local Ollama at localhost:11434, yet every request for it
// goes on to ollama.com under the person's Ollama account. So a seat is judged
// by its server's address AND its model's name (seatLeaves): the offline seat,
// the cloud card, the secrets gate and the vault's local-only notes all read
// that one judge, never the server's address alone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { leavesThisNetwork, seatLeaves } from '../src/providers/types.js';
import { hostIsLoopback, isOllamaCloudTag } from '../src/harness/locality.js';
import { describeStack, resolveStack } from '../src/router/stack.js';
import { Router } from '../src/router/router.js';
import { bootstrapSession } from '../src/core/agent/bootstrap.js';
import { rankLocalModels } from '../src/core/agent/offline.js';
import { vaultReadTool } from '../src/core/tools/vault.js';
import { closeEngineVaultIndexes } from '../src/core/vault/engineIndex.js';
import type { VaultPrivacy } from '../src/harness/vault/types.js';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { removeTempDir } from './helpers/portable.js';

/** This computer's own Ollama: local by address, as a localhost server is. */
const ON_THIS_COMPUTER = { kind: 'local' as const, remote: false };

describe('the seat judge', () => {
  it('reads a cloud tag from the model name, whatever the case', () => {
    for (const model of [
      'kimi-k3:cloud',
      'gpt-oss:120b-cloud',
      'qwen3-coder:480b-cloud',
      'deepseek-v3.1:671b-cloud',
      'GLM-4.6:CLOUD',
      'registry.example:5000/kimi-k3:cloud',
    ]) {
      expect(isOllamaCloudTag(model), model).toBe(true);
    }
    for (const model of [
      'qwen2.5-coder:7b',
      'llama3.2',
      'cloud',
      'soundcloud:latest',
      'kimi-cloud',
      'qwen3:cloudy',
      'localhost:5000/kimi',
      '',
    ]) {
      expect(isOllamaCloudTag(model), model).toBe(false);
    }
  });

  it("a cloud tag on this computer's Ollama leaves, though its server stays", () => {
    expect(leavesThisNetwork(ON_THIS_COMPUTER)).toBe(false);
    expect(seatLeaves(ON_THIS_COMPUTER, 'kimi-k3:cloud')).toBe(true);
    expect(seatLeaves(ON_THIS_COMPUTER, 'qwen2.5-coder:7b')).toBe(false);
    expect(seatLeaves({ kind: 'cloud', remote: true }, 'claude-sonnet-5')).toBe(true);
  });
});

/** A router over this computer's Ollama (one mock provider), whose stack
 *  places the given models. */
function routerOver(
  models: string[],
  stack: Record<string, unknown>,
  offline = true,
): { router: Router; ollama: MockProvider } {
  const ollama = new MockProvider('ollama', [], { models });
  const config = ConfigSchema.parse({ stack });
  const registry = new ProviderRegistry(config, () => undefined);
  registry.register('ollama', ollama);
  const router = new Router(config, registry, resolveStack(config, registry), {
    offline: () => offline,
  });
  return { router, ollama };
}

describe('rankLocalModels never ranks a cloud tag', () => {
  it('drops every cloud tag, even a coder that would lead by size', () => {
    expect(
      rankLocalModels([
        'qwen3-coder:480b-cloud',
        'gpt-oss:120b-cloud',
        'kimi-k2.7-code:cloud',
        'llama3.2:latest',
        'qwen2.5-coder:7b',
      ]),
    ).toEqual(['qwen2.5-coder:7b', 'llama3.2:latest']);
    expect(rankLocalModels(['kimi-k3:cloud'])).toEqual([]);
  });
});

describe('Router: a cloud tag is never the seat that stays', () => {
  it('localSeat passes a cloud-tag orchestrator for the best model on this computer', async () => {
    const { router } = routerOver(['kimi-k3:cloud', 'qwen3-coder:480b-cloud', 'qwen2.5-coder:7b'], {
      orchestrator: { provider: 'ollama', model: 'kimi-k3:cloud' },
    });
    expect((await router.localSeat())?.ref.model).toBe('qwen2.5-coder:7b');
    // So the session says the cloud model waits.
    expect(router.anySeatLeaves()).toBe(true);
  });

  it('localSeat skips a cloud-tag specialist, and none when only cloud tags are here', async () => {
    const placed = routerOver(['gpt-oss:120b-cloud', 'qwen3:4b'], {
      orchestrator: { provider: 'ollama', model: 'gpt-oss:120b-cloud' },
      specialists: { coding: { provider: 'ollama', model: 'qwen3-coder:480b-cloud' } },
    });
    expect((await placed.router.localSeat())?.ref.model).toBe('qwen3:4b');

    const cloudOnly = routerOver(['kimi-k3:cloud', 'gpt-oss:120b-cloud'], {
      orchestrator: { provider: 'ollama', model: 'kimi-k3:cloud' },
    });
    expect(await cloudOnly.router.localSeat()).toBeUndefined();
  });

  it('offline, roleFor passes a cloud-tag specialist to the orchestrator', () => {
    const { router } = routerOver(['qwen2.5-coder:7b'], {
      orchestrator: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
      specialists: { writing: { provider: 'ollama', model: 'kimi-k3:cloud' } },
    });
    expect(router.roleFor('writing')).toMatchObject({ fellBack: true });
    expect(router.anySeatLeaves()).toBe(true);
    const online = routerOver(
      ['qwen2.5-coder:7b'],
      {
        orchestrator: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
        specialists: { writing: { provider: 'ollama', model: 'kimi-k3:cloud' } },
      },
      false,
    );
    expect(online.router.roleFor('writing')).toMatchObject({ fellBack: false });
  });
});

const CLOUD_TAG_STACK = { stack: { orchestrator: { provider: 'ollama', model: 'kimi-k3:cloud' } } };

describe('the loop: a cloud tag gets the cloud card and the amber pill', () => {
  it('asks before the first turn, as any seat off this network does', async () => {
    const ollama = new MockProvider('ollama', [textTurn('Hello from the cloud.')]);
    const session = makeTestSession(ollama, { configOverrides: CLOUD_TAG_STACK });
    await session.agent.run('hello');
    expect(session.approvals.filter((a) => a.kind === 'cloud-spend')).toHaveLength(1);
    const turn = session.events.find((e) => e.type === 'turn-start');
    expect(turn && turn.type === 'turn-start' && turn.providerKind).toBe('cloud');
  });

  it("the card names the cloud model and ollama.com, never this computer's server as off it", async () => {
    const ollama = new MockProvider('ollama', [textTurn('Hello from the cloud.')]);
    const session = makeTestSession(ollama, { configOverrides: CLOUD_TAG_STACK });
    await session.agent.run('hello');
    const card = session.approvals.find((a) => a.kind === 'cloud-spend')!;
    expect(card.summary).toContain('kimi-k3:cloud');
    expect(card.summary).toContain("Ollama's cloud models");
    expect(card.summary).not.toMatch(/a model server off/);
    expect(card.detail).toMatch(/on to ollama\.com, under your Ollama account/);
    expect(card.detail).not.toMatch(/go to localhost/);
  });

  it('the session names where its seat runs as the pill does', () => {
    const tag = makeTestSession(new MockProvider('ollama', []), {
      configOverrides: CLOUD_TAG_STACK,
    });
    expect(tag.agent.activeModel).toEqual({ model: 'kimi-k3:cloud', kind: 'cloud' });
    const here = makeTestSession(new MockProvider('ollama', []), {
      configOverrides: {
        stack: { orchestrator: { provider: 'ollama', model: 'qwen2.5-coder:7b' } },
      },
    });
    expect(here.agent.activeModel.kind).toBe('local');
  });

  it('the stack line calls a cloud-tag orchestrator cloud', () => {
    const { router } = routerOver(['kimi-k3:cloud'], {
      orchestrator: { provider: 'ollama', model: 'kimi-k3:cloud' },
    });
    expect(describeStack(router.stack)).toBe('kimi-k3:cloud (cloud), solo');
    const here = routerOver(['qwen2.5-coder:7b'], {
      orchestrator: { provider: 'ollama', model: 'qwen2.5-coder:7b' },
    });
    expect(describeStack(here.router.stack)).toBe('qwen2.5-coder:7b (local), solo');
  });

  it('declined, nothing is sent to it', async () => {
    const ollama = new MockProvider('ollama', [textTurn('never')]);
    const session = makeTestSession(ollama, {
      configOverrides: CLOUD_TAG_STACK,
      approve: (request) => ({ approve: request.kind !== 'cloud-spend' }),
    });
    await session.agent.run('hello');
    expect(ollama.requests).toHaveLength(0);
    const done = session.events.at(-1);
    expect(done && done.type === 'task-done' && done.reason).toBe('declined');
  });

  it('offline, it gives way to a model on this computer, said once, and asks nothing', async () => {
    const ollama = new MockProvider('ollama', [textTurn('Answered here.')], {
      models: ['kimi-k3:cloud', 'qwen3-coder:480b-cloud', 'qwen2.5-coder:7b'],
    });
    const session = makeTestSession(ollama, {
      configOverrides: CLOUD_TAG_STACK,
      offlineState: () => ({ offline: true, reason: 'chosen' }),
    });
    await session.agent.run('hello');
    expect(ollama.requests.map((r) => r.model)).toEqual(['qwen2.5-coder:7b']);
    expect(session.approvals.filter((a) => a.kind === 'cloud-spend')).toHaveLength(0);
    const notes = session.events.flatMap((e) => (e.type === 'note' ? [e.message] : []));
    expect(notes.some((n) => /Cloud models wait/.test(n))).toBe(true);
  });
});

// CX and CMO, 2026-10-08 (C): one noun pair, "your messages and the files
// the agent reads", both end at ollama.com, and a loopback server is "Ollama
// on this computer", chosen by hostIsLoopback, never isLocalHost (which
// passes the LAN and the tailnet).
describe('the cloud card words (C)', () => {
  function cardFor(baseUrl: string | undefined, model = 'kimi-k3:cloud', remote = false) {
    const ollama = new MockProvider('ollama', [textTurn('Hello.')]);
    if (remote) (ollama as unknown as { remote: boolean }).remote = true;
    const session = makeTestSession(ollama, {
      configOverrides: {
        ...(baseUrl ? { providers: { ollama: { kind: 'openai-compatible', baseUrl } } } : {}),
        stack: { orchestrator: { provider: 'ollama', model } },
      },
    });
    return session;
  }

  it('a cloud tag on Ollama on this computer', async () => {
    const session = cardFor('http://localhost:11434');
    await session.agent.run('hello');
    const card = session.approvals.find((a) => a.kind === 'cloud-spend')!;
    expect(card.summary).toBe(
      "This step runs on kimi-k3:cloud, one of Ollama's cloud models, so it leaves this computer.",
    );
    expect(card.detail).toBe(
      'Ollama on this computer passes your messages and the files the agent reads on to ollama.com, under your Ollama account. Nothing is sent without this approval.',
    );
  });

  it('a cloud tag on an Ollama elsewhere on the network names the server', async () => {
    const session = cardFor('http://192.168.1.20:11434');
    await session.agent.run('hello');
    const card = session.approvals.find((a) => a.kind === 'cloud-spend')!;
    expect(card.detail).toBe(
      'The Ollama server at 192.168.1.20:11434 passes your messages and the files the agent reads on to ollama.com, under your Ollama account. Nothing is sent without this approval.',
    );
  });

  it('a remote model server takes the same noun', async () => {
    const session = cardFor('https://models.example.com/v1', 'big-model', true);
    await session.agent.run('hello');
    const card = session.approvals.find((a) => a.kind === 'cloud-spend')!;
    expect(card.summary).toBe(
      "This step runs on ollama, a model server off this computer's network.",
    );
    expect(card.detail).toBe(
      'Your messages and the files the agent reads go to models.example.com. Nothing is sent without this approval.',
    );
  });

  it('hostIsLoopback passes only this computer itself', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'app.localhost',
      '127.0.0.1',
      '127.8.9.10',
      '::1',
      '[::1]',
      '0:0:0:0:0:0:0:1',
    ]) {
      expect(hostIsLoopback(host), host).toBe(true);
    }
    for (const host of [
      '192.168.1.20',
      '10.0.0.2',
      '100.64.1.2',
      'mac.local',
      'box.tail1234.ts.net',
      'fd00::1',
      '::',
      'example.com',
      '128.0.0.1',
      'localhost.example.com',
    ]) {
      expect(hostIsLoopback(host), host).toBe(false);
    }
  });
});

describe('a local-only vault note never reaches a cloud tag (D5)', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'osc-cloudtag-vault-')));
    mkdirSync(join(root, 'Private'), { recursive: true });
    writeFileSync(join(root, 'Private', 'diary.md'), 'PRIVATE-DIARY-TEXT');
  });
  afterEach(async () => {
    await closeEngineVaultIndexes();
    rmSync(root, { recursive: true, force: true });
  });
  const privacy: VaultPrivacy = {
    visibility: ({ path }) => (path.toLowerCase().startsWith('private/') ? 'local-only' : 'open'),
  };

  it('the loop tells the vault tools the seat leaves, so the read is withheld', async () => {
    const ollama = new MockProvider('ollama', []);
    const session = makeTestSession(ollama, { configOverrides: CLOUD_TAG_STACK, vaultRoot: root });
    session.toolContext.vaultPrivacy = privacy;
    expect(session.toolContext.seatLeavesNetwork?.()).toBe(true);
    // Its provenance names where it ran, as any seat off this network does.
    expect(session.toolContext.vaultSeat?.().provider).toBe('ollama');
    const read = await vaultReadTool.execute({ path: 'Private/diary.md' }, session.toolContext);
    expect(read.content).not.toContain('PRIVATE-DIARY-TEXT');
    expect(read.content).toMatch(/stays on this computer/);
  });

  it('a model that runs on this computer still reads it', async () => {
    const ollama = new MockProvider('ollama', []);
    const session = makeTestSession(ollama, {
      configOverrides: {
        stack: { orchestrator: { provider: 'ollama', model: 'qwen2.5-coder:7b' } },
      },
      vaultRoot: root,
    });
    session.toolContext.vaultPrivacy = privacy;
    expect(session.toolContext.seatLeavesNetwork?.()).toBe(false);
    const read = await vaultReadTool.execute({ path: 'Private/diary.md' }, session.toolContext);
    expect(read.content).toContain('PRIVATE-DIARY-TEXT');
  });
});

describe("a project's secrets never reach a cloud tag (electron-daemon-4)", () => {
  let home: string;
  let project: string;
  let previousHome: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'osc-cloudtag-home-'));
    project = mkdtempSync(join(tmpdir(), 'osc-cloudtag-proj-'));
    previousHome = process.env.OSC_HOME;
    process.env.OSC_HOME = home;
  });
  afterEach(async () => {
    process.env.OSC_HOME = previousHome;
    await removeTempDir(home);
    await removeTempDir(project);
  });

  function boot(model: string) {
    const config = ConfigSchema.parse({
      // This computer's own Ollama, by address: only the model's name differs.
      providers: { ollama: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434' } },
      stack: { orchestrator: { provider: 'ollama', model } },
    });
    return bootstrapSession({
      cwd: project,
      profile: 'local-interactive',
      config,
      projectSecrets: 'STRIPE_KEY=sk_live_cloudtag',
      persist: false,
    });
  }

  it('a cloud-tag orchestrator is cloud: the secrets are dropped and nothing locks down', () => {
    const result = boot('kimi-k3:cloud');
    try {
      expect(result.orchestratorKind).toBe('cloud');
      expect(result.tools.names()).toContain('webFetch');
    } finally {
      result.driver.dispose();
    }
  });

  it('a model on the same Ollama that runs here keeps them, under lockdown', () => {
    const result = boot('qwen2.5-coder:7b');
    try {
      expect(result.orchestratorKind).toBe('local');
      expect(result.tools.names()).not.toContain('webFetch');
    } finally {
      result.driver.dispose();
    }
  });
});
