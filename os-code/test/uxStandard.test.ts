// Premium UX out of the box: the coding agent's system prompt carries the
// twenty laws and the house bar by default, a project can turn it off in
// config, and project notes ride along. Checked through a real AgentSession on
// the mock provider, reading the system message it actually sent.
import { describe, expect, it } from 'vitest';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { UX_LAWS, uxStandardPrompt } from '../src/core/agent/uxStandard.js';

async function systemMessageWith(configOverrides?: Record<string, unknown>): Promise<string> {
  const provider = new MockProvider('mock', [textTurn('ok')]);
  const session = makeTestSession(provider, { configOverrides });
  await session.agent.run('hello');
  const first = provider.requests[0]!;
  const system = first.messages.find((m) => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
}

describe('UX standard in the coding agent', () => {
  it('has twenty laws, each an actionable rule, plus the house bar', () => {
    expect(UX_LAWS).toHaveLength(20);
    for (const l of UX_LAWS) expect(l.rule.length, l.name).toBeGreaterThan(40);
    const text = uxStandardPrompt();
    expect(text).toContain("Fitts's law");
    expect(text).toContain('prefers-reduced-motion');
    expect(text).toContain('skip the UX standard');
  });

  it('is on by default and reaches the model as part of the system prompt', async () => {
    const system = await systemMessageWith();
    expect(system).toContain('UX STANDARD');
    expect(system).toContain("Hick's law");
    expect(system).toContain('Pareto principle');
  });

  it('a project can turn it off in config', async () => {
    const system = await systemMessageWith({ ux: { standard: 'off' } });
    expect(system).not.toContain('UX STANDARD');
  });

  it('project notes ride along on top of the standard', async () => {
    const system = await systemMessageWith({
      ux: { standard: 'premium', notes: 'Brand color is teal. Serif display type.' },
    });
    expect(system).toContain('This project adds:');
    expect(system).toContain('Brand color is teal.');
  });
});
