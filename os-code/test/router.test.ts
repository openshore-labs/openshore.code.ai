// The router and stack: one mandatory orchestrator, optional specialists,
// graceful degradation, and honest hardware budgeting.
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { StackError, describeStack, resolveStack } from '../src/router/stack.js';
import { Router } from '../src/router/router.js';
import { budgetFor, fitsBudget, pickProfile } from '../src/router/resourceBudget.js';
import { MockProvider, textTurn } from './helpers/mockProvider.js';

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
    expect(router.notes[0]!.message).toContain('orchestrator handled it');
  });

  it('refuses vision delegation to a text-only model with a fix hint', async () => {
    const { router } = setup();
    await expect(router.delegate('vision', 'what is in this image?')).rejects.toThrow(
      /cannot read images/,
    );
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
