// The harness copy of the project-memory spec, plus the permission engine's
// narrow auto-allow for the memory-write tool. The spec here must match the
// app copy (app/src/lib/projectMemory.ts); both tests pin the same shape so a
// note created by the app or by the agent looks identical.
import { describe, expect, it } from 'vitest';
import {
  CURRENT_STATE_FILE,
  MEMORY_FILES,
  MEMORY_FOLDER_PREFIX,
  MEMORY_FOLDER_SUFFIX,
  PROJECT_MEMORY_WRITE_TOOL,
  isMemoryFilePath,
  isProjectMemoryFolder,
  memoryFilePath,
  memoryFolder,
  memorySegment,
  projectMemoryPrompt,
} from '../src/core/agent/projectMemory.js';
import { PermissionEngine, DEFAULT_PERMISSIONS } from '../src/core/permissions/index.js';

describe('the five presets (harness copy)', () => {
  it('match the app copy: titles, order, and Current State first', () => {
    expect(MEMORY_FILES.map((f) => f.title)).toEqual([
      'Current State',
      'Progress',
      'Decisions',
      'Action Items',
      'Skills',
    ]);
    expect(MEMORY_FILES[0]!.title).toBe(CURRENT_STATE_FILE);
    expect(PROJECT_MEMORY_WRITE_TOOL).toBe('projectMemoryWrite');
  });

  it('names the folder "OpenShore Project <name> MDs"', () => {
    expect(MEMORY_FOLDER_PREFIX).toBe('OpenShore Project ');
    expect(MEMORY_FOLDER_SUFFIX).toBe(' MDs');
    expect(memoryFolder('My App')).toBe('OpenShore Project My App MDs');
    expect(memoryFilePath('My App', 'Current State')).toBe(
      'OpenShore Project My App MDs/Current State.md',
    );
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
    expect(memorySegment('..', '/')).toBe('');
  });
});

describe('projectMemoryPrompt', () => {
  it('names the folder, the top sheet, and the write tool', () => {
    const prompt = projectMemoryPrompt('My App');
    expect(prompt).toContain('OpenShore Project My App MDs/');
    expect(prompt).toContain('Current State');
    expect(prompt).toContain('top sheet');
    expect(prompt).toContain(PROJECT_MEMORY_WRITE_TOOL);
    expect(prompt).toContain('commit');
  });
});

describe('isMemoryFilePath', () => {
  it('accepts the managed files and rejects everything else', () => {
    expect(isMemoryFilePath(memoryFilePath('My App', 'Current State'))).toBe(true);
    expect(isMemoryFilePath('OpenShore Project My App MDs/Notes.md')).toBe(false);
    expect(isMemoryFilePath('OpenShore Project My App MDs/sub/Skills.md')).toBe(false);
    expect(isMemoryFilePath('elsewhere/Progress.md')).toBe(false);
    // A dot-only enclosed name is not a memory folder (defense in depth).
    expect(isMemoryFilePath('OpenShore Project .. MDs/Skills.md')).toBe(false);
    // A path that only looks like the folder but is not the exact wrapper.
    expect(isMemoryFilePath('OpenShore Project My App/Skills.md')).toBe(false);
  });

  it('recognizes exactly a one-segment memory folder', () => {
    expect(isProjectMemoryFolder('OpenShore Project My App MDs')).toBe(true);
    expect(isProjectMemoryFolder('OpenShore Project My App MDs/sub')).toBe(false);
    expect(isProjectMemoryFolder('src')).toBe(false);
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
});
