// The project-memory spec: the five presets and the repo folder convention
// ("OpenShore Project <name> MDs/"). This is the contract the harness writes to
// and the app reads, so the shape is pinned here and mirrored by the os-code
// copy's own test.
import { describe, expect, it } from 'vitest';
import {
  CURRENT_STATE_FILE,
  MEMORY_FILES,
  MEMORY_FOLDER_PREFIX,
  MEMORY_FOLDER_SUFFIX,
  isMemoryFilePath,
  isProjectMemoryFolder,
  memoryFilePath,
  memoryFolder,
  memoryFolderForProject,
  orderMemoryTitlesFirst,
  sanitizeFolderSegment,
} from '../src/lib/projectMemory.js';

describe('the five presets', () => {
  it('are exactly these titles, in this order, with Current State first', () => {
    expect(MEMORY_FILES.map((f) => f.title)).toEqual([
      'Current State',
      'Progress',
      'Decisions',
      'Action Items',
      'Skills',
    ]);
    expect(MEMORY_FILES[0]!.title).toBe(CURRENT_STATE_FILE);
  });

  it('each seed opens with its own heading and the Current State sections', () => {
    for (const f of MEMORY_FILES) {
      expect(f.seed.startsWith(`# ${f.title}`)).toBe(true);
    }
    const cur = MEMORY_FILES[0]!.seed;
    for (const section of [
      'What last landed and launched',
      'Key outstanding build actions',
      'Key outstanding test actions',
      'Immediate blockers',
      'Suggested next steps',
    ]) {
      expect(cur).toContain(section);
    }
  });
});

describe('the repo folder convention', () => {
  it('wraps the project name as "OpenShore Project <name> MDs"', () => {
    expect(MEMORY_FOLDER_PREFIX).toBe('OpenShore Project ');
    expect(MEMORY_FOLDER_SUFFIX).toBe(' MDs');
    expect(memoryFolder('My App')).toBe('OpenShore Project My App MDs');
    expect(memoryFolderForProject('My App')).toBe('OpenShore Project My App MDs');
    expect(memoryFilePath('My App', 'Current State')).toBe(
      'OpenShore Project My App MDs/Current State.md',
    );
  });

  it('strips path-hostile characters and collapses whitespace in the name', () => {
    expect(sanitizeFolderSegment('My/App: v2')).toBe('My App v2');
    expect(sanitizeFolderSegment('  spaced   out ')).toBe('spaced out');
    expect(sanitizeFolderSegment('////')).toBe('');
  });

  it('treats a pure-dot name as unusable (no traversal out of the folder)', () => {
    expect(sanitizeFolderSegment('.')).toBe('');
    expect(sanitizeFolderSegment('..')).toBe('');
    expect(memoryFolderForProject('..')).toBeUndefined();
    // A dot with real characters is a fine literal folder name.
    expect(sanitizeFolderSegment('..foo')).toBe('..foo');
  });
});

describe('path predicates', () => {
  it('recognizes exactly the managed files inside a memory folder', () => {
    expect(isMemoryFilePath('OpenShore Project My App MDs/Current State.md')).toBe(true);
    expect(isMemoryFilePath('OpenShore Project My App MDs/Skills.md')).toBe(true);
    expect(isMemoryFilePath('OpenShore Project My App MDs/Notes.md')).toBe(false);
    expect(isMemoryFilePath('OpenShore Project My App MDs/sub/Progress.md')).toBe(false);
    expect(isMemoryFilePath('src/Progress.md')).toBe(false);
    // Not the exact wrapper.
    expect(isMemoryFilePath('OpenShore Project My App/Skills.md')).toBe(false);
    // A dot-only enclosed name is not a memory folder.
    expect(isMemoryFilePath('OpenShore Project .. MDs/Skills.md')).toBe(false);
  });

  it('marks a one-segment memory folder as a project memory folder', () => {
    expect(isProjectMemoryFolder('OpenShore Project My App MDs')).toBe(true);
    expect(isProjectMemoryFolder('OpenShore Project My App MDs/sub')).toBe(false);
    expect(isProjectMemoryFolder('docs')).toBe(false);
  });
});

describe('orderMemoryTitlesFirst', () => {
  it('pins the Current State note to the front', () => {
    const names = ['Skills', 'Current State', 'Progress'];
    expect(orderMemoryTitlesFirst(names, (n) => n)).toEqual([
      'Current State',
      'Skills',
      'Progress',
    ]);
  });
});
