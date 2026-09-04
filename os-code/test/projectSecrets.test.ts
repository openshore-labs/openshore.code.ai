// The project-secrets security core: the local-only gate, the egress lockdown
// in the tool registry, the secrets block reaching the (local) model's system
// prompt, and the "never escalate a secrets session to the cloud" rule.
import { describe, expect, it } from 'vitest';
import { gateProjectSecrets } from '../src/core/agent/secretsGate.js';
import { buildToolRegistry } from '../src/core/agent/registry.js';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

describe('gateProjectSecrets (the local-only gate)', () => {
  it('carries secrets and locks down egress only for a local orchestrator', () => {
    expect(gateProjectSecrets('local', 'my token')).toEqual({
      projectSecrets: 'my token',
      egressLockdown: true,
    });
  });

  it('drops secrets entirely for a cloud orchestrator, no lockdown', () => {
    expect(gateProjectSecrets('cloud', 'my token')).toEqual({
      projectSecrets: undefined,
      egressLockdown: false,
    });
  });

  it('does nothing when there are no secrets', () => {
    expect(gateProjectSecrets('local', '   ')).toEqual({
      projectSecrets: undefined,
      egressLockdown: false,
    });
    expect(gateProjectSecrets('local', undefined).egressLockdown).toBe(false);
  });
});

describe('egress lockdown in the tool registry', () => {
  const opts = {
    stackHasVision: true,
    stackHasImageGen: true,
    stackHasSpecialists: true,
  };

  it('drops every off-device tool when locked down', () => {
    const locked = buildToolRegistry({ ...opts, egressLockdown: true }).names();
    for (const off of ['webSearch', 'webFetch', 'analyzeImage', 'generateImage', 'delegate']) {
      expect(locked).not.toContain(off);
    }
    // Local tools still there: the session can still do real work on-device.
    for (const on of ['readFile', 'editFile', 'runShell', 'gitCommit', 'projectMemoryWrite']) {
      expect(locked).toContain(on);
    }
  });

  it('keeps the web and specialist tools when not locked down', () => {
    const open = buildToolRegistry({ ...opts, egressLockdown: false }).names();
    expect(open).toContain('webSearch');
    expect(open).toContain('webFetch');
    expect(open).toContain('delegate');
  });
});

describe('project secrets in the system prompt', () => {
  async function systemMessage(projectSecrets?: string): Promise<string> {
    const provider = new MockProvider('mock', [textTurn('ok')]);
    const session = makeTestSession(provider, { projectSecrets });
    await session.agent.run('hello');
    const system = provider.requests[0]!.messages.find((m) => m.role === 'system');
    return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
  }

  it('includes the secrets block when the session carries secrets', async () => {
    const system = await systemMessage('GITHUB_TOKEN=abc123');
    expect(system).toContain('PROJECT SECRETS');
    expect(system).toContain('GITHUB_TOKEN=abc123');
  });

  it('says nothing about secrets when there are none', async () => {
    const system = await systemMessage(undefined);
    expect(system).not.toContain('PROJECT SECRETS');
  });
});
