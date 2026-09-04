// Reading a project's memory notes: choosing the source (local clone vs
// GitHub), the reader adapters, and the note listing (Current State first,
// present flags, "folder not there yet").
import { describe, expect, it } from 'vitest';
import {
  listMemoryNotes,
  localRepoReader,
  primaryRepoSource,
  readMemoryNote,
  type RepoReader,
} from '../src/lib/projectMemoryRead.js';
import { memoryFilePath } from '../src/lib/projectMemory.js';

describe('primaryRepoSource', () => {
  const local = '/home/me/code/app';
  const gh = 'github:acme/app';

  it('prefers the local clone on desktop', () => {
    expect(primaryRepoSource([local, gh], { canReadLocal: true })).toEqual({
      kind: 'local',
      root: local,
    });
  });

  it('uses GitHub when local cannot be read (a phone)', () => {
    expect(primaryRepoSource([local, gh], { canReadLocal: false })).toEqual({
      kind: 'github',
      owner: 'acme',
      repo: 'app',
    });
  });

  it('falls back to GitHub on desktop when there is no local clone', () => {
    expect(primaryRepoSource([gh], { canReadLocal: true })).toEqual({
      kind: 'github',
      owner: 'acme',
      repo: 'app',
    });
  });

  it('is undefined for a local-only project on a phone, or no repos', () => {
    expect(primaryRepoSource([local], { canReadLocal: false })).toBeUndefined();
    expect(primaryRepoSource([], { canReadLocal: true })).toBeUndefined();
  });
});

/** A reader driven by an in-memory folder listing. */
function fakeReader(names: string[] | undefined, bodies: Record<string, string> = {}): RepoReader {
  return {
    async listDir() {
      return names;
    },
    async readFile(rel) {
      return bodies[rel];
    },
  };
}

describe('listMemoryNotes', () => {
  it('reports the folder missing and no notes present when the folder is absent', async () => {
    const listing = await listMemoryNotes(fakeReader(undefined), 'My App');
    expect(listing.folderExists).toBe(false);
    expect(listing.notes[0]!.title).toBe('Current State');
    expect(listing.notes.every((n) => !n.present)).toBe(true);
  });

  it('marks which notes exist, Current State first', async () => {
    const listing = await listMemoryNotes(fakeReader(['Skills.md', 'Current State.md']), 'My App');
    expect(listing.folderExists).toBe(true);
    expect(listing.notes[0]!.title).toBe('Current State');
    const present = new Set(listing.notes.filter((n) => n.present).map((n) => n.title));
    expect(present).toEqual(new Set(['Current State', 'Skills']));
    expect(listing.notes.find((n) => n.title === 'Current State')!.path).toBe(
      memoryFilePath('My App', 'Current State'),
    );
  });
});

describe('readMemoryNote', () => {
  it('returns the note body through the reader', async () => {
    const path = memoryFilePath('My App', 'Progress');
    const reader = fakeReader(['Progress.md'], { [path]: '# Progress\n\nhi' });
    expect(await readMemoryNote(reader, path)).toContain('hi');
  });
});

describe('localRepoReader', () => {
  it('maps the bridge nulls (missing) to undefined', async () => {
    const reader = localRepoReader('/root', {
      repoReadDir: async (_root, sub) => (sub === 'here' ? ['a.md'] : null),
      repoReadFile: async (_root, rel) => (rel === 'a.md' ? 'body' : null),
    });
    expect(await reader.listDir('here')).toEqual(['a.md']);
    expect(await reader.listDir('gone')).toBeUndefined();
    expect(await reader.readFile('a.md')).toBe('body');
    expect(await reader.readFile('missing')).toBeUndefined();
  });
});
