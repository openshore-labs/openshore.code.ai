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
  humanizerEnabled,
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

// The per-session override (the app's "Humanize Writing" setting, sent through
// the daemon or the electron bridge into bootstrapSession). It only ever turns
// the humanizer off; a project's own config always wins.
describe('humanizerEnabled precedence', () => {
  it('is on by default (config on, no override)', () => {
    expect(humanizerEnabled('on', undefined)).toBe(true);
    expect(humanizerEnabled(undefined, undefined)).toBe(true);
  });

  it('the app toggle off turns it off, even with config on', () => {
    expect(humanizerEnabled('on', false)).toBe(false);
    expect(humanizerEnabled(undefined, false)).toBe(false);
  });

  it("a project's config off holds even when the app toggle is on", () => {
    expect(humanizerEnabled('off', true)).toBe(false);
    expect(humanizerEnabled('off', undefined)).toBe(false);
  });

  it('the override never forces it on over a project that opted out', () => {
    // app on + config off stays off: the project's deliberate call wins.
    expect(humanizerEnabled('off', true)).toBe(false);
  });
});
