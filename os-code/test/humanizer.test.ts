// Humanizer out of the box: the writing agent's system prompt carries the
// distilled "Signs of AI writing" tells by default, a project can turn it off in
// config, and project voice notes ride along. Checked through a real
// AgentSession on the mock provider, reading the system message it actually sent.
import { describe, expect, it } from 'vitest';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import {
  AI_WRITING_SIGNS,
  AI_VOCABULARY,
  humanizerStandardPrompt,
} from '../src/core/agent/humanizerStandard.js';

async function systemMessageWith(configOverrides?: Record<string, unknown>): Promise<string> {
  const provider = new MockProvider('mock', [textTurn('ok')]);
  const session = makeTestSession(provider, { configOverrides });
  await session.agent.run('hello');
  const first = provider.requests[0]!;
  const system = first.messages.find((m) => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
}

describe('Humanizer standard in the writing agent', () => {
  it('has a full set of signs, each an actionable rule, plus the AI vocabulary list', () => {
    expect(AI_WRITING_SIGNS.length).toBeGreaterThanOrEqual(20);
    for (const s of AI_WRITING_SIGNS) expect(s.avoid.length, s.name).toBeGreaterThan(40);
    expect(AI_VOCABULARY).toContain('delve');
    const text = humanizerStandardPrompt();
    expect(text).toContain('HUMANIZER STANDARD');
    expect(text).toContain('skip the humanizer');
    // The root habit the source names: smoothing specific facts into praise.
    expect(text).toContain('smoothing');
    // A couple of representative tells reach the prompt.
    expect(text).toContain('Negative parallelisms');
    expect(text).toContain('Em dashes');
  });

  it('is on by default and reaches the model as part of the system prompt', async () => {
    const system = await systemMessageWith();
    expect(system).toContain('HUMANIZER STANDARD');
    expect(system).toContain('Rule of three');
    expect(system).toContain('Promotional, brochure tone');
  });

  it('a project can turn it off in config', async () => {
    const system = await systemMessageWith({ humanizer: { standard: 'off' } });
    expect(system).not.toContain('HUMANIZER STANDARD');
  });

  it('project voice notes ride along on top of the standard', async () => {
    const system = await systemMessageWith({
      humanizer: {
        standard: 'on',
        notes: 'House voice is dry and understated. Prefer British spelling.',
      },
    });
    expect(system).toContain('This project adds:');
    expect(system).toContain('House voice is dry and understated.');
  });
});
