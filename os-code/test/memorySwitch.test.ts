// The Memory switch does something (Vault v1, 1.5; CTO F6). Project memory is
// on by default; config `memory.enabled: false`, a project file's false, or the
// app's override false each remove the projectMemoryWrite tool (the permission
// engine allows it by name, so it must be unregistered) and the prompt block
// that teaches it. The override can only turn memory off: it never re-enables
// a project that turned it off.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../src/config/schema.js';
import { bootstrapSession, type BootstrapOptions } from '../src/core/agent/bootstrap.js';
import { memoryEnabled } from '../src/core/agent/projectMemory.js';
import { memoryEnabled as memoryEnabledForApps } from '../src/protocol.js';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

let home: string;
let project: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-memory-home-'));
  project = mkdtempSync(join(tmpdir(), 'osc-memory-proj-'));
  previousHome = process.env.OSC_HOME;
  process.env.OSC_HOME = home;
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ stack: { orchestrator: { provider: 'ollama', model: 'qwen' } } }),
  );
});
afterEach(() => {
  process.env.OSC_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

const TOOL = 'projectMemoryWrite';
const BLOCK = 'PROJECT MEMORY';

/** A real bootstrap, and the system prompt its agent would send. */
function boot(options: Partial<BootstrapOptions> = {}) {
  const result = bootstrapSession({
    cwd: project,
    profile: 'local-interactive',
    persist: false,
    projectName: 'Atlas',
    ...options,
  });
  const prompt = (
    result.agent as unknown as { systemPrompt(mode: 'native' | 'text'): string }
  ).systemPrompt('text');
  return { tools: result.tools.names(), prompt, enabled: result.config.memory.enabled };
}

function configWith(extra: Record<string, unknown>) {
  return ConfigSchema.parse({
    stack: { orchestrator: { provider: 'ollama', model: 'qwen' } },
    ...extra,
  });
}

describe('memoryEnabled, the one precedence helper', () => {
  it('is on by default, and the app override can only turn it off', () => {
    expect(memoryEnabled(true, undefined)).toBe(true);
    expect(memoryEnabled(undefined, undefined)).toBe(true);
    expect(memoryEnabled(true, true)).toBe(true);
    expect(memoryEnabled(true, false)).toBe(false);
    expect(memoryEnabled(undefined, false)).toBe(false);
    expect(memoryEnabled(false, undefined)).toBe(false);
    // The override never forces it on over a config (or project) off.
    expect(memoryEnabled(false, true)).toBe(false);
  });

  it('is the same helper the app gets through os-code/protocol', () => {
    expect(memoryEnabledForApps).toBe(memoryEnabled);
  });
});

describe('memory on, the default', () => {
  it('registers the tool and sends the prompt block, write half included', () => {
    const on = boot({ config: configWith({}) });
    expect(on.enabled).toBe(true);
    expect(on.tools).toContain(TOOL);
    expect(on.prompt).toContain(BLOCK);
    expect(on.prompt).toContain(`using the ${TOOL} tool`);
  });
});

describe('memory off removes the tool and the prompt block', () => {
  it('config memory.enabled false', () => {
    const off = boot({ config: configWith({ memory: { enabled: false } }) });
    expect(off.enabled).toBe(false);
    expect(off.tools).not.toContain(TOOL);
    expect(off.prompt).not.toContain(BLOCK);
  });

  it("the app's override off, over a config that has it on", () => {
    const off = boot({ config: configWith({}), memory: false });
    expect(off.enabled).toBe(false);
    expect(off.tools).not.toContain(TOOL);
    expect(off.prompt).not.toContain(BLOCK);
    // Nothing else moves.
    const on = boot({ config: configWith({}) });
    expect(off.tools).toEqual(on.tools.filter((name) => name !== TOOL));
  });

  it("a project file's off, with the override undefined, from an untrusted folder", () => {
    writeFileSync(
      join(project, 'os-code.config.json'),
      JSON.stringify({ memory: { enabled: false } }),
    );
    const off = boot();
    expect(off.enabled).toBe(false);
    expect(off.tools).not.toContain(TOOL);
    expect(off.prompt).not.toContain(BLOCK);
  });

  it("the override true never re-enables a project's off", () => {
    writeFileSync(
      join(project, 'os-code.config.json'),
      JSON.stringify({ memory: { enabled: false } }),
    );
    const still = boot({ memory: true });
    expect(still.enabled).toBe(false);
    expect(still.tools).not.toContain(TOOL);
    expect(still.prompt).not.toContain(BLOCK);
  });

  it('the model sees no memory block, and a call to the tool writes nothing', async () => {
    const run = async (enabled: boolean) => {
      const provider = new MockProvider('mock', [
        toolTurn(TOOL, {
          file: 'Current State',
          content: '# Current State\nplans',
          mode: 'replace',
        }),
        textTurn('done'),
      ]);
      const session = makeTestSession(provider, {
        cwd: project,
        projectName: 'Atlas',
        configOverrides: { memory: { enabled } },
      });
      await session.agent.run('go');
      const system = provider.requests[0]!.messages.find((m) => m.role === 'system');
      return { system: String(system?.content), session };
    };
    const off = await run(false);
    expect(off.system).not.toContain(BLOCK);
    expect(off.session.tools.get(TOOL)).toBeUndefined();
    expect(readdirSync(project)).toEqual([]);
    // The same call with memory on lands without asking, which is exactly why
    // off has to unregister the tool.
    const on = await run(true);
    expect(on.system).toContain(BLOCK);
    expect(on.session.approvals).toEqual([]);
    expect(existsSync(join(project, 'OpenShore Project Atlas MDs', 'Current State.md'))).toBe(true);
  });
});
