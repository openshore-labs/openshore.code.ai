// The harness copy of the project-memory spec, plus the permission engine's
// narrow auto-allow for the memory-write tool. The spec here must match the
// app copy (app/src/lib/projectMemory.ts); both tests pin the same shape so a
// note created by the app or by the agent looks identical.
import { describe, expect, it } from 'vitest';
import {
  CURRENT_STATE_FILE,
  MEMORY_FILES,
  PROJECTS_ROOT,
  PROJECT_MEMORY_WRITE_TOOL,
  isMemoryFilePath,
  memoryFilePath,
  memorySegment,
  projectMemoryPrompt,
} from '../src/core/agent/projectMemory.js';
import { PermissionEngine, DEFAULT_PERMISSIONS } from '../src/core/permissions/index.js';

describe('the five presets (harness copy)', () => {
  it('match the app copy: titles, order, root, and Current State first', () => {
    expect(MEMORY_FILES.map((f) => f.title)).toEqual([
      'Current State',
      'Progress',
      'Decisions',
      'Action Items',
      'Skills',
    ]);
    expect(MEMORY_FILES[0]!.title).toBe(CURRENT_STATE_FILE);
    expect(PROJECTS_ROOT).toBe('Projects');
    expect(PROJECT_MEMORY_WRITE_TOOL).toBe('projectMemoryWrite');
  });

  it('each seed opens with its own heading', () => {
    for (const f of MEMORY_FILES) {
      expect(f.seed.startsWith(`# ${f.title}`)).toBe(true);
    }
  });
});

describe('memorySegment', () => {
  it('uses the sanitized project name when present', () => {
    expect(memorySegment('My/App', '/home/me/code/whatever')).toBe('My App');
  });

  it('falls back to the workspace basename with no project', () => {
    expect(memorySegment(undefined, '/home/me/code/my-app')).toBe('my-app');
  });

  it('is empty only when neither yields anything usable', () => {
    expect(memorySegment('///', '/')).toBe('');
  });
});

describe('projectMemoryPrompt', () => {
  it('names the folder, the top sheet, and the write tool', () => {
    const prompt = projectMemoryPrompt('My App');
    expect(prompt).toContain('Projects/My App/');
    expect(prompt).toContain('Current State');
    expect(prompt).toContain('top sheet');
    expect(prompt).toContain(PROJECT_MEMORY_WRITE_TOOL);
  });
});

describe('isMemoryFilePath', () => {
  it('accepts the managed files and rejects everything else', () => {
    expect(isMemoryFilePath(memoryFilePath('My App', 'Current State'))).toBe(true);
    expect(isMemoryFilePath('Projects/My App/Notes.md')).toBe(false);
    expect(isMemoryFilePath('Projects/My App/sub/Skills.md')).toBe(false);
    expect(isMemoryFilePath('elsewhere/Progress.md')).toBe(false);
    // A dot segment would climb out of the project folder; never accepted.
    expect(isMemoryFilePath('Projects/../Skills.md')).toBe(false);
    expect(isMemoryFilePath('Projects/./Progress.md')).toBe(false);
  });
});

describe('sanitizeFolderSegment (harness copy)', () => {
  it('treats a pure-dot name as unusable', () => {
    expect(memorySegment('.', '/home/me/x')).toBe('x');
    expect(memorySegment('..', '/home/me/y')).toBe('y');
  });
});

describe('permission engine: the narrow memory-write exception', () => {
  const engine = new PermissionEngine(DEFAULT_PERMISSIONS);

  it('auto-allows the memory-write tool on a managed memory file', () => {
    const r = engine.decide({
      toolName: PROJECT_MEMORY_WRITE_TOOL,
      risk: 'write',
      path: memoryFilePath('My App', 'Current State'),
    });
    expect(r.decision).toBe('allow');
  });

  it('asks when the memory-write tool has no resolved path', () => {
    const r = engine.decide({ toolName: PROJECT_MEMORY_WRITE_TOOL, risk: 'write' });
    expect(r.decision).toBe('ask');
  });

  it('does not auto-allow a different tool writing a memory-shaped path', () => {
    const r = engine.decide({
      toolName: 'writeFile',
      risk: 'write',
      path: memoryFilePath('My App', 'Skills'),
    });
    expect(r.decision).toBe('ask');
  });

  it('still asks first for a general vault write, even to a memory path', () => {
    // vaultWrite carries alwaysAsk, which the engine honors before any allow.
    const r = engine.decide({
      toolName: 'vaultWrite',
      risk: 'write',
      path: memoryFilePath('My App', 'Progress'),
      alwaysAsk: true,
    });
    expect(r.decision).toBe('ask');
  });
});
