// The project-memory write tool and the system-prompt injection. The tool is
// hard-scoped to the five managed notes under the current project's folder, and
// the memory protocol reaches the model as part of the system prompt whenever
// the session has a memory folder.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectMemoryWriteTool } from '../src/core/tools/projectMemory.js';
import type { ToolContext } from '../src/core/tools/index.js';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

let root: string;
// The tool only reads vaultRoot, projectName, and cwd, so a partial context is
// enough (mirrors vaultTools.test.ts).
const ctx = (projectName?: string, cwd = '/home/me/code/fallback-repo'): ToolContext =>
  ({ vaultRoot: root, projectName, cwd }) as unknown as ToolContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'osc-memory-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('projectMemoryWriteTool', () => {
  it('writes a preset into the project folder derived from the project name', async () => {
    const out = await projectMemoryWriteTool.execute(
      { file: 'Current State', content: '# Current State\n\nfresh', mode: 'replace' },
      ctx('My App'),
    );
    expect(out.ok).toBe(true);
    const abs = join(root, 'Projects', 'My App', 'Current State.md');
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs, 'utf8')).toContain('fresh');
  });

  it('appends without dropping the existing body', async () => {
    await projectMemoryWriteTool.execute(
      { file: 'Progress', content: 'first', mode: 'replace' },
      ctx('My App'),
    );
    await projectMemoryWriteTool.execute(
      { file: 'Progress', content: 'second', mode: 'append' },
      ctx('My App'),
    );
    const body = readFileSync(join(root, 'Projects', 'My App', 'Progress.md'), 'utf8');
    expect(body).toContain('first');
    expect(body).toContain('second');
  });

  it('falls back to the workspace basename when there is no project name', async () => {
    await projectMemoryWriteTool.execute(
      { file: 'Skills', content: 'recipe', mode: 'replace' },
      ctx(undefined, '/home/me/code/lonely-repo'),
    );
    expect(existsSync(join(root, 'Projects', 'lonely-repo', 'Skills.md'))).toBe(true);
  });

  it('refuses when neither a project name nor a workspace basename exists', async () => {
    await expect(
      projectMemoryWriteTool.execute(
        { file: 'Decisions', content: 'x', mode: 'replace' },
        ctx('///', '/'),
      ),
    ).rejects.toThrow(/no project/i);
  });

  it('reports its target path so the permission engine can confirm it', () => {
    const path = projectMemoryWriteTool.pathOf?.(
      { file: 'Action Items', content: '', mode: 'replace' },
      ctx('My App'),
    );
    expect(path).toBe('Projects/My App/Action Items.md');
  });
});

describe('project memory in the system prompt', () => {
  async function systemMessage(projectName?: string): Promise<string> {
    const provider = new MockProvider('mock', [textTurn('ok')]);
    const session = makeTestSession(provider, { projectName, vaultRoot: root });
    await session.agent.run('hello');
    const system = provider.requests[0]!.messages.find((m) => m.role === 'system');
    return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
  }

  it('teaches the memory protocol, naming the project folder', async () => {
    const system = await systemMessage('My App');
    expect(system).toContain('PROJECT MEMORY');
    expect(system).toContain('Projects/My App/');
    expect(system).toContain('projectMemoryWrite');
  });
});
