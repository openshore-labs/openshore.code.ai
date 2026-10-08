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
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession, type TestSessionOptions } from './helpers/session.js';
import { deniedReasons, journalRead, pinnedSource } from './helpers/privateNotes.js';
import {
  MEMORY_DECLINED,
  MEMORY_ROUTINE_DENIED,
  MEMORY_ROUTINE_REFUSED,
  MEMORY_WHY_PIN,
  MEMORY_WHY_READ,
} from '../src/core/agent/loop.js';
import type { ApprovalRequest } from '../src/core/agent/types.js';

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

// CX and CMO, 2026-10-08 (A): projectMemoryWrite is the one write the engine
// allows by name. Once a chat on a seat that stays holds a private note's
// text, it asks every time, in every mode, past every grant, with a line
// above the diff that says why; a routine leaves the notes as they were. No
// other write changes behaviour.
describe('a project note change after a private note (A)', () => {
  const MEMORY_WRITE = toolTurn(
    'projectMemoryWrite',
    { file: 'Progress', content: 'quoted from the journal', mode: 'append' },
    'm1',
  );

  function privateSession(
    mode: 'default' | 'acceptEdits' | 'bypassPermissions',
    opts: {
      pinned?: boolean;
      read?: boolean;
      approve?: TestSessionOptions['approve'];
    } = {},
  ) {
    const turns = [
      ...(opts.read === false ? [] : [toolTurn('vaultRead', { path: 'Journal/today.md' }, 'r1')]),
      MEMORY_WRITE,
      textTurn('Noted.'),
    ];
    const provider = new MockProvider('mock', turns);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      permissionMode: mode,
      ...(opts.approve ? { approve: opts.approve } : {}),
      ...(opts.pinned
        ? { vaultRoot: mkdtempSync(join(tmpdir(), 'osc-vault-')), vaultContext: pinnedSource() }
        : {}),
    });
    session.tools.register(journalRead);
    return { provider, session };
  }

  const memoryCards = (approvals: ApprovalRequest[]) =>
    approvals.filter((a) => a.toolName === 'projectMemoryWrite');

  it('after a private read it asks in Ask first, Accept edits and Bypass, with why', async () => {
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
      const { session } = privateSession(mode);
      await session.agent.run('note what I wrote today');
      const cards = memoryCards(session.approvals);
      expect(cards, mode).toHaveLength(1);
      expect(cards[0]!.why).toBe(MEMORY_WHY_READ);
      expect(cards[0]!.alwaysAsk).toBe(true);
      // The tool's own preview stays: the summary and the diff.
      expect(cards[0]!.summary).toMatch(/Progress/);
      expect(cards[0]!.detail).toContain('quoted from the journal');
    }
  });

  it('after a private pin it asks with the pin line', async () => {
    const { session } = privateSession('acceptEdits', { pinned: true, read: false });
    await session.agent.run('note the plan');
    const cards = memoryCards(session.approvals);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.why).toBe(MEMORY_WHY_PIN);
  });

  it('a session allow does not quiet it', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('vaultRead', { path: 'Journal/today.md' }, 'r1'),
      MEMORY_WRITE,
      toolTurn('projectMemoryWrite', { file: 'Progress', content: 'again', mode: 'append' }, 'm2'),
      textTurn('Noted twice.'),
    ]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      approve: () => ({ approve: true, alwaysThisSession: true }),
    });
    session.tools.register(journalRead);
    await session.agent.run('note it twice');
    expect(memoryCards(session.approvals)).toHaveLength(2);
  });

  it('a clean chat writes the note without asking, as before', async () => {
    const { session } = privateSession('default', { read: false });
    await session.agent.run('note progress');
    expect(memoryCards(session.approvals)).toEqual([]);
    const body = readFileSync(
      join(session.cwd, 'OpenShore Project Demo MDs', 'Progress.md'),
      'utf8',
    );
    expect(body).toContain('quoted from the journal');
  });

  it('a seat that leaves this network was sent only the stub, so it writes without asking', async () => {
    const cloud = new MockProvider(
      'anthropic',
      [toolTurn('vaultRead', { path: 'Journal/today.md' }, 'r1'), MEMORY_WRITE, textTurn('Noted.')],
      { kind: 'cloud' },
    );
    const session = makeTestSession(cloud, {
      projectName: 'Demo',
      configOverrides: { stack: { orchestrator: { provider: 'anthropic', model: 'claude' } } },
    });
    session.tools.register(journalRead);
    await session.agent.run('note it');
    expect(memoryCards(session.approvals)).toEqual([]);
  });

  it('editFile under Accept edits still lands without asking after a private read', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('vaultRead', { path: 'Journal/today.md' }, 'r1'),
      toolTurn('editFile', { path: 'a.txt', search: 'old', replace: 'new' }, 'e1'),
      textTurn('Edited.'),
    ]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      permissionMode: 'acceptEdits',
      files: { 'a.txt': 'old\n' },
    });
    session.tools.register(journalRead);
    await session.agent.run('edit a.txt');
    expect(session.approvals.filter((a) => a.toolName === 'editFile')).toEqual([]);
    expect(readFileSync(join(session.cwd, 'a.txt'), 'utf8')).toBe('new\n');
  });

  it('a no keeps the note as it was and tells the model so', async () => {
    const { provider, session } = privateSession('default', {
      approve: (request) => ({ approve: request.toolName !== 'projectMemoryWrite' }),
    });
    await session.agent.run('note what I wrote today');
    expect(existsSync(join(session.cwd, 'OpenShore Project Demo MDs', 'Progress.md'))).toBe(false);
    expect(JSON.stringify(provider.requests.at(-1)!.messages)).toContain(MEMORY_DECLINED);
  });

  it('a headless run refuses without asking, in both lines', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('vaultRead', { path: 'Journal/today.md' }, 'r1'),
      MEMORY_WRITE,
      textTurn('Left it.'),
    ]);
    const session = makeTestSession(provider, {
      projectName: 'Demo',
      profile: 'headless',
      offline: true,
    });
    session.tools.register(journalRead);
    await session.agent.run('note what I wrote today');
    expect(session.approvals).toEqual([]);
    expect(deniedReasons(session.events)).toEqual([MEMORY_ROUTINE_DENIED]);
    expect(JSON.stringify(provider.requests.at(-1)!.messages)).toContain(MEMORY_ROUTINE_REFUSED);
    expect(existsSync(join(session.cwd, 'OpenShore Project Demo MDs', 'Progress.md'))).toBe(false);
    // The run held a private note's text, so its note will be marked.
    expect(session.agent.heldLocalOnly()).toBe(true);
  });
});
