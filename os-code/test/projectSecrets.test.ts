// The project-secrets security core: the local-only gate, the egress lockdown
// in the tool registry, the secrets block reaching the (local) model's system
// prompt, and the "never escalate a secrets session to the cloud" rule.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateProjectSecrets } from '../src/core/agent/secretsGate.js';
import { buildToolRegistry, buildToolContext } from '../src/core/agent/registry.js';
import { ConfigSchema } from '../src/config/schema.js';
import type { Router } from '../src/router/router.js';
import type { ProviderRegistry } from '../src/providers/registry.js';
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

describe('egress lockdown forces on-device repo search (no cloud embedder)', () => {
  // A router that offers an embedding role, and providers whose embedder throws
  // the moment it is touched, so any attempt to use the (possibly cloud)
  // embedder is loud. Under lockdown the embedder must never be reached.
  const router = {
    embeddingRole: () => ({ ref: { provider: 'x', model: 'm' } }),
    delegate: async () => '',
  } as unknown as Router;
  const providers = {
    embedder: () => {
      throw new Error('embedder used');
    },
    imageProvider: () => undefined,
  } as unknown as ProviderRegistry;
  const config = ConfigSchema.parse({});

  it('does not build the embedder index under lockdown, and searches locally', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'osc-lockdown-'));
    try {
      const ctx = buildToolContext({ cwd, config, router, providers, egressLockdown: true });
      // keyword search only: resolves without ever calling the embedder.
      await expect(ctx.searchRepo!('anything', 3)).resolves.toBeTypeOf('string');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('WOULD use the embedder without lockdown (proving the guard is what stops it)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'osc-open-'));
    try {
      expect(() =>
        buildToolContext({ cwd, config, router, providers, egressLockdown: false }),
      ).toThrow(/embedder used/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
