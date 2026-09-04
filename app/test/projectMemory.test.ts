// The project-memory spec: the five presets, the folder convention, and the
// first-open seeding plan. These are the contract the Vault UI and the os-code
// harness both depend on, so the shape is pinned here (and mirrored by the
// os-code copy's own test).
import { describe, expect, it } from 'vitest';
import type { Project } from '../src/state/types.js';
import {
  CURRENT_STATE_FILE,
  MEMORY_FILES,
  PROJECTS_ROOT,
  isMemoryFilePath,
  isProjectMemoryFolder,
  memoryFilePath,
  projectFolders,
  sanitizeFolderSegment,
  seedPlan,
} from '../src/lib/projectMemory.js';

function project(partial: Partial<Project>): Project {
  return { id: 'p1', name: 'Demo', repoIds: [], createdAt: '2026-01-01T00:00:00Z', ...partial };
}

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
    expect(PROJECTS_ROOT).toBe('Projects');
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

describe('folder mapping', () => {
  it('strips path-hostile characters and collapses whitespace', () => {
    expect(sanitizeFolderSegment('My/App: v2')).toBe('My App v2');
    expect(sanitizeFolderSegment('  spaced   out ')).toBe('spaced out');
    expect(sanitizeFolderSegment('////')).toBe('');
  });

  it('treats a pure-dot name as unusable (no traversal out of the folder)', () => {
    expect(sanitizeFolderSegment('.')).toBe('');
    expect(sanitizeFolderSegment('..')).toBe('');
    // A dot with real characters is a fine literal folder, not traversal.
    expect(sanitizeFolderSegment('..foo')).toBe('..foo');
    expect(projectFolders([project({ id: 'dddddd44', name: '..' })]).get('dddddd44')).toBe(
      'dddddd',
    );
  });

  it('keeps folders unique when two projects sanitize to the same name', () => {
    const a = project({ id: 'aaaaaa11', name: 'My/App' });
    const b = project({ id: 'bbbbbb22', name: 'My:App' });
    const map = projectFolders([a, b]);
    expect(map.get('aaaaaa11')).toBe('My App');
    expect(map.get('bbbbbb22')).not.toBe('My App');
    expect(new Set(map.values()).size).toBe(2);
  });

  it('falls back to the id when the name is unusable', () => {
    const p = project({ id: 'zzzzzz99', name: '///' });
    expect(projectFolders([p]).get('zzzzzz99')).toBe('zzzzzz');
  });
});

describe('path predicates', () => {
  it('recognizes exactly the managed files under a one-segment project folder', () => {
    expect(isMemoryFilePath('Projects/My App/Current State.md')).toBe(true);
    expect(isMemoryFilePath('Projects/My App/Skills.md')).toBe(true);
    // Not a managed preset.
    expect(isMemoryFilePath('Projects/My App/Notes.md')).toBe(false);
    // Too deep, or outside the Projects root.
    expect(isMemoryFilePath('Projects/My App/sub/Progress.md')).toBe(false);
    expect(isMemoryFilePath('Ideas/Progress.md')).toBe(false);
    // A dot segment must never be accepted (would traverse the vault).
    expect(isMemoryFilePath('Projects/../Skills.md')).toBe(false);
    expect(isMemoryFilePath('Projects/./Progress.md')).toBe(false);
  });

  it('marks a one-segment Projects folder as a project memory folder', () => {
    expect(isProjectMemoryFolder('Projects/My App')).toBe(true);
    expect(isProjectMemoryFolder('Projects')).toBe(false);
    expect(isProjectMemoryFolder('Projects/My App/sub')).toBe(false);
  });
});

describe('seedPlan', () => {
  it('seeds all five notes for a project with none yet', () => {
    const writes = seedPlan([project({ id: 'p1', name: 'Demo' })], []);
    expect(writes.map((w) => w.path)).toEqual(
      MEMORY_FILES.map((f) => memoryFilePath('Demo', f.title)),
    );
  });

  it('is a no-op once a project already has any of its notes', () => {
    const existing = [memoryFilePath('Demo', 'Progress')];
    expect(seedPlan([project({ id: 'p1', name: 'Demo' })], existing)).toEqual([]);
  });

  it('does not resurrect a note the person deleted (respects partial folders)', () => {
    // Current State was deleted but the others remain: the project is adopted,
    // so nothing is re-seeded.
    const existing = MEMORY_FILES.slice(1).map((f) => memoryFilePath('Demo', f.title));
    expect(seedPlan([project({ id: 'p1', name: 'Demo' })], existing)).toEqual([]);
  });

  it('seeds only the projects that need it', () => {
    const a = project({ id: 'a', name: 'Alpha' });
    const b = project({ id: 'b', name: 'Beta' });
    const existing = [memoryFilePath('Alpha', 'Current State')];
    const writes = seedPlan([a, b], existing);
    expect(writes.every((w) => w.path.startsWith('Projects/Beta/'))).toBe(true);
    expect(writes).toHaveLength(MEMORY_FILES.length);
  });
});
