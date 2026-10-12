// Opening a web page is the person's choice on this machine (maintainer,
// 2026-10-02): ask before each page (the default), always allow (a blanket
// yes), or never (no webFetch tool). A permission rule still wins, and a
// repository's config can never loosen it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSIONS, PermissionEngine } from '../src/core/permissions/index.js';
import { profileFor } from '../src/core/security/profiles.js';
import { buildToolRegistry } from '../src/core/agent/registry.js';
import { ConfigSchema } from '../src/config/schema.js';
import { PROJECT_POLICY } from '../src/config/projectPolicy.js';

const q = { toolName: 'webFetch', risk: 'network' as const };

describe('opening a web page', () => {
  it('asks by default in config, and the engine asks in ask mode', () => {
    expect(ConfigSchema.parse({}).tools.webFetch).toBe('ask');
    const ask = new PermissionEngine(
      DEFAULT_PERMISSIONS,
      profileFor('local-interactive'),
      false,
      'ask',
    );
    expect(ask.decide(q).decision).toBe('ask');
    // Web search is not affected.
    expect(ask.decide({ toolName: 'webSearch', risk: 'network' }).decision).toBe('allow');
  });

  it('a session allow quiets it for that session only', () => {
    const ask = new PermissionEngine(
      DEFAULT_PERMISSIONS,
      profileFor('local-interactive'),
      false,
      'ask',
    );
    ask.allowForSession('webFetch');
    expect(ask.decide(q).decision).toBe('allow');
    const fresh = new PermissionEngine(
      DEFAULT_PERMISSIONS,
      profileFor('local-interactive'),
      false,
      'ask',
    );
    expect(fresh.decide(q).decision).toBe('ask');
  });

  it('always allow is a blanket yes, and a deny rule still wins over it', () => {
    const allow = new PermissionEngine(
      DEFAULT_PERMISSIONS,
      profileFor('local-interactive'),
      false,
      'allow',
    );
    expect(allow.decide(q).decision).toBe('allow');
    const denied = new PermissionEngine(
      { ...DEFAULT_PERMISSIONS, rules: [{ tool: 'webFetch', decision: 'deny' }] },
      profileFor('local-interactive'),
      false,
      'allow',
    );
    expect(denied.decide(q).decision).toBe('deny');
  });

  it('never leaves the tool out entirely', () => {
    expect(buildToolRegistry({}).names()).toContain('webFetch');
    expect(buildToolRegistry({ webFetch: false }).names()).not.toContain('webFetch');
    expect(buildToolRegistry({ webFetch: false }).names()).toContain('webSearch');
  });

  it('is machine config: a repository can never set it', () => {
    expect((PROJECT_POLICY as { tools: Record<string, string> }).tools.webFetch).toBe('machine');
  });
});
