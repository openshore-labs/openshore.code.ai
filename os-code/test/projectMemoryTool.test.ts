// The project-memory write tool and the system-prompt injection. The tool is
// hard-scoped to the five managed notes inside the current project's memory
// folder in the repo working tree, seeds the full set from templates on first
// touch, and the memory protocol reaches the model as part of the system prompt
// whenever the session has a memory folder.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Jail } from '../src/core/security/jail.js';
import { projectMemoryWriteTool } from '../src/core/tools/projectMemory.js';
import { memoryFilePath, memorySegment } from '../src/core/agent/projectMemory.js';
import type { ToolContext } from '../src/core/tools/index.js';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

let root: string;
// The tool writes through ctx.jail (the repo working tree) and derives the
// folder from projectName/cwd, so a partial context with a real jail is enough.
const ctx = (projectName?: string, cwd = root): ToolContext =>
  ({ jail: new Jail(root), cwd, projectName }) as unknown as ToolContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'osc-memory-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('projectMemoryWriteTool', () => {
  it('writes into the repo memory folder and seeds the full set on first touch', async () => {
    const out = await projectMemoryWriteTool.execute(
      { file: 'Current State', content: '# Current State\n\nfresh', mode: 'replace' },
      ctx('My App'),
    );
    expect(out.ok).toBe(true);
    const folder = join(root, 'OpenShore Project My App MDs');
    expect(readFileSync(join(folder, 'Current State.md'), 'utf8')).toContain('fresh');
    // The other four arrived from templates.
    for (const f of ['Progress.md', 'Decisions.md', 'Action Items.md', 'Skills.md']) {
      expect(existsSync(join(folder, f))).toBe(true);
    }
  });

  it('appends without dropping the existing body', async () => {
    await projectMemoryWriteTool.execute(
      { file: 'Progress', content: 'first-run', mode: 'replace' },
      ctx('My App'),
    );
    await projectMemoryWriteTool.execute(
      { file: 'Progress', content: 'second-run', mode: 'append' },
      ctx('My App'),
    );
    const body = readFileSync(join(root, 'OpenShore Project My App MDs', 'Progress.md'), 'utf8');
    expect(body).toContain('first-run');
    expect(body).toContain('second-run');
  });

  it('falls back to the workspace basename when there is no project name', async () => {
    await projectMemoryWriteTool.execute(
      { file: 'Skills', content: 'recipe', mode: 'replace' },
      ctx(undefined, root),
    );
    const seg = memorySegment(undefined, root);
    expect(seg).toBe(basename(root));
    expect(existsSync(join(root, `OpenShore Project ${seg} MDs`, 'Skills.md'))).toBe(true);
  });

  it('refuses when neither a project name nor a workspace basename exists', async () => {
    await expect(
      projectMemoryWriteTool.execute(
        { file: 'Decisions', content: 'x', mode: 'replace' },
        ctx('..', '/'),
      ),
    ).rejects.toThrow(/no project/i);
  });

  it('reports its target path so the permission engine can confirm it', () => {
    const path = projectMemoryWriteTool.pathOf?.(
      { file: 'Action Items', content: '', mode: 'replace' },
      ctx('My App'),
    );
    expect(path).toBe(memoryFilePath('My App', 'Action Items'));
  });
});

describe('project memory in the system prompt', () => {
  async function systemMessage(projectName?: string): Promise<string> {
    const provider = new MockProvider('mock', [textTurn('ok')]);
    const session = makeTestSession(provider, { projectName });
    await session.agent.run('hello');
    const system = provider.requests[0]!.messages.find((m) => m.role === 'system');
    return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
  }

  it('teaches the memory protocol, naming the repo folder', async () => {
    const system = await systemMessage('My App');
    expect(system).toContain('PROJECT MEMORY');
    expect(system).toContain('OpenShore Project My App MDs/');
    expect(system).toContain('projectMemoryWrite');
  });
});
