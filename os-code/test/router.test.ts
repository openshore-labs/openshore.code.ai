// The router and stack: one mandatory orchestrator, optional specialists,
// graceful degradation, and honest hardware budgeting.
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { StackError, describeStack, resolveStack } from '../src/router/stack.js';
import { Router } from '../src/router/router.js';
import { budgetFor, fitsBudget, pickProfile } from '../src/router/resourceBudget.js';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { UsageTracker } from '../src/auth/usage.js';
import type { ChatEvent, ChatRequest } from '../src/providers/types.js';

function setup(
  overrides: Record<string, unknown> = {},
  specialists: Record<string, MockProvider> = {},
) {
  const config = ConfigSchema.parse({
    stack: {
      orchestrator: { provider: 'orch', model: 'big-model' },
      ...(overrides.stack as object),
    },
    ...overrides,
  });
  const registry = new ProviderRegistry(config, () => undefined);
  const orchestrator = new MockProvider('orch', [textTurn('orchestrator answer')]);
  registry.register('orch', orchestrator);
  for (const [id, provider] of Object.entries(specialists)) registry.register(id, provider);
  const stack = resolveStack(config, registry);
  return { config, registry, stack, orchestrator, router: new Router(config, registry, stack) };
}

describe('stack resolution', () => {
  it('requires an orchestrator with a warm pointer to init', () => {
    const config = ConfigSchema.parse({});
    const registry = new ProviderRegistry(config, () => undefined);
    expect(() => resolveStack(config, registry)).toThrow(StackError);
    expect(() => resolveStack(config, registry)).toThrow(/osc init/);
  });

  it('a solo orchestrator is a complete, described setup', () => {
    const { stack } = setup();
    expect(describeStack(stack)).toContain('solo');
  });

  it('a misconfigured specialist degrades with a note instead of failing', () => {
    const { stack } = setup({
      stack: {
        orchestrator: { provider: 'orch', model: 'big-model' },
        specialists: { coding: { provider: 'ghost', model: 'x' } },
      },
    });
    expect(stack.specialists.coding).toBeUndefined();
    expect(stack.notes.join(' ')).toContain('orchestrator will cover coding');
  });
});

describe('delegation', () => {
  it('routes to an enabled specialist', async () => {
    const coder = new MockProvider('coder', [textTurn('specialist answer')]);
    const { router } = setup(
      {
        stack: {
          orchestrator: { provider: 'orch', model: 'big-model' },
          specialists: { coding: { provider: 'coder', model: 'small-coder' } },
        },
      },
      { coder },
    );
    const answer = await router.delegate('coding', 'write a function');
    expect(answer).toBe('specialist answer');
    expect(coder.requests).toHaveLength(1);
    expect(router.notes).toHaveLength(0);
  });

  it('falls back to the orchestrator with a quiet note when no specialist exists', async () => {
    const { router, orchestrator } = setup();
    const answer = await router.delegate('coding', 'write a function');
    expect(answer).toBe('orchestrator answer');
    expect(orchestrator.requests).toHaveLength(1);
    expect(router.notes[0]!.message).toContain('quarterback handled it');
  });

  it('refuses vision delegation to a text-only model with a fix hint', async () => {
    const { router } = setup();
    await expect(router.delegate('vision', 'what is in this image?')).rejects.toThrow(
      /cannot read images/,
    );
  });

  it('an abort stops a delegated subtask within a tick (DAE-4)', async () => {
    // A specialist that streams one delta and then waits on the signal, the way
    // a real provider stalls on reader.read() until the request is aborted.
    const coder = new MockProvider('coder', []);
    let sawSignal: AbortSignal | undefined;
    coder.chat = async function* (
      this: MockProvider,
      _req: ChatRequest,
      signal?: AbortSignal,
    ): AsyncGenerator<ChatEvent, void, void> {
      sawSignal = signal;
      yield { type: 'text', delta: 'partial' };
      await new Promise<void>((resolve) => {
        if (!signal || signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      yield { type: 'done', stopReason: 'aborted' };
    };
    const { router } = setup(
      {
        stack: {
          orchestrator: { provider: 'orch', model: 'big-model' },
          specialists: { coding: { provider: 'coder', model: 'small-coder' } },
        },
      },
      { coder },
    );
    const controller = new AbortController();
    const pending = router.delegate('coding', 'write a function', undefined, {
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const settled = await Promise.race([
      pending.then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('hung'), 50)),
    ]);
    expect(settled).toBe('settled');
    expect(sawSignal?.aborted).toBe(true);
  });

  it('a cloud delegate reports its usage so the dollars are counted (DAE-4)', async () => {
    const cloud = new MockProvider('anthropic', [textTurn('cloud specialist answer')], {
      kind: 'cloud',
    });
    const { router } = setup(
      {
        stack: {
          orchestrator: { provider: 'orch', model: 'big-model' },
          specialists: { coding: { provider: 'anthropic', model: 'claude-sonnet-5' } },
        },
      },
      { anthropic: cloud },
    );
    const usage = new UsageTracker();
    const answer = await router.delegate('coding', 'write a function', undefined, {
      onUsage: (u) => {
        if (u.kind === 'cloud') usage.noteCloud(u.model, u.promptTokens, u.completionTokens);
      },
    });
    expect(answer).toBe('cloud specialist answer');
    expect(usage.session.dollars).toBeGreaterThan(0);
    expect(usage.session.cloudCalls).toBe(1);
  });

  it('orchestrator-only mode never delegates', async () => {
    const coder = new MockProvider('coder', [textTurn('specialist answer')]);
    const { router, orchestrator } = setup(
      {
        routing: { mode: 'orchestrator-only' },
        stack: {
          orchestrator: { provider: 'orch', model: 'big-model' },
          specialists: { coding: { provider: 'coder', model: 'small-coder' } },
        },
      },
      { coder },
    );
    await router.delegate('coding', 'task');
    expect(coder.requests).toHaveLength(0);
    expect(orchestrator.requests).toHaveLength(1);
  });
});

describe('escalation wiring', () => {
  it('finds a cloud target only when one is configured', () => {
    const { router } = setup();
    expect(router.escalationTarget()).toBeUndefined();
    expect(router.escalationEnabled()).toBe(false);

    const cloud = new MockProvider('anthropic', [], { kind: 'cloud' });
    const withCloud = setup(
      {
        providers: { anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' } },
        routing: { escalation: { enabled: true } },
      },
      { anthropic: cloud },
    );
    expect(withCloud.router.escalationTarget()?.model).toBe('claude-sonnet-5');
    expect(withCloud.router.escalationEnabled()).toBe(true);
  });

  // P2-3: a real Anthropic cloud target with no key connected must read as
  // no-escalation, so the user is never asked to approve spend that then errors.
  function cloudKeySetup(getKey: () => string | undefined) {
    const config = ConfigSchema.parse({
      stack: { orchestrator: { provider: 'orch', model: 'big-model' } },
      providers: { anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' } },
      routing: { escalation: { enabled: true } },
    });
    const registry = new ProviderRegistry(config, getKey);
    registry.register('orch', new MockProvider('orch', [textTurn('x')]));
    const stack = resolveStack(config, registry);
    return new Router(config, registry, stack);
  }

  it('a keyless cloud target reads as no-escalation', () => {
    const router = cloudKeySetup(() => undefined);
    expect(router.escalationTarget()).toBeDefined();
    expect(router.escalationEnabled()).toBe(false);
  });

  it('a connected key enables escalation', () => {
    const router = cloudKeySetup(() => 'sk-ant-test');
    expect(router.escalationEnabled()).toBe(true);
  });
});

describe('resource budget', () => {
  it('picks profiles by VRAM', () => {
    expect(pickProfile(8)).toBe('single');
    expect(pickProfile(16)).toBe('dual');
    expect(pickProfile(24)).toBe('fleet');
  });

  it('budgets honestly with no GPU (CPU inference from RAM)', () => {
    const budget = budgetFor({ gpus: [], totalVramGB: 0, systemRamGB: 32, source: 'none' });
    expect(budget.profile).toBe('dual');
    expect(budget.summary).toContain('no dedicated GPU');
  });

  it('rates model fit: fits, tight, too big', () => {
    const budget = budgetFor({
      gpus: [{ name: 'RTX 4080', vramGB: 16 }],
      totalVramGB: 16,
      systemRamGB: 64,
      source: 'nvidia-smi',
    });
    expect(fitsBudget(4.7, budget)).toBe('fits');
    expect(fitsBudget(9, budget)).toBe('tight');
    expect(fitsBudget(20, budget)).toBe('too-big');
  });
});
