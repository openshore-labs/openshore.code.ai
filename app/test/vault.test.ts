import { describe, expect, it } from 'vitest';
import {
  backlinksTo,
  normalizeNotePath,
  noteFolder,
  noteTitle,
  parseWikilinks,
  resolveWikilink,
  treeAt,
  wikilinkContext,
  wikilinksToMarkdown,
} from '../src/lib/vault.js';

describe('wikilink parsing (Obsidian grammar)', () => {
  it('parses plain, aliased, and heading-suffixed links', () => {
    const links = parseWikilinks(
      'See [[Ideas]] and [[a/Deep Note|the deep one]] or [[X#Heading]].',
    );
    expect(links).toEqual([
      { target: 'Ideas', alias: undefined },
      { target: 'a/Deep Note', alias: 'the deep one' },
      { target: 'X', alias: undefined },
    ]);
  });

  it('ignores empty and unclosed brackets', () => {
    expect(parseWikilinks('[[]] and [[ ]] and [[open')).toEqual([]);
  });
});

describe('note paths', () => {
  it('titles and folders come from the path, Obsidian style', () => {
    expect(noteTitle('ideas/First Note.md')).toBe('First Note');
    expect(noteFolder('ideas/First Note.md')).toBe('ideas');
    expect(noteFolder('Root.md')).toBe('');
  });

  it('normalizes typed names into vault-relative .md paths', () => {
    expect(normalizeNotePath('  ideas / First Note ')).toBe('ideas/First Note.md');
    expect(normalizeNotePath('already.md')).toBe('already.md');
    expect(normalizeNotePath('///')).toBeUndefined();
  });
});

describe('wikilink resolution', () => {
  const paths = ['Ideas.md', 'projects/Ideas.md', 'projects/Roadmap.md'];

  it('prefers an exact path, then the shortest filename match', () => {
    expect(resolveWikilink('projects/Roadmap', paths)).toBe('projects/Roadmap.md');
    expect(resolveWikilink('Ideas', paths)).toBe('Ideas.md');
    expect(resolveWikilink('Roadmap', paths)).toBe('projects/Roadmap.md');
    expect(resolveWikilink('Missing', paths)).toBeUndefined();
  });

  it('rewrites links to anchors, flagging unresolved targets', () => {
    const md = wikilinksToMarkdown('Go to [[Roadmap|the plan]] then [[Missing]].', paths);
    expect(md).toContain('[the plan](vault:projects%2FRoadmap.md)');
    expect(md).toContain('[Missing](vault:Missing.md?new)');
  });
});

describe('backlinks', () => {
  it('finds notes linking here by name or full path, never itself', () => {
    const notes = [
      { path: 'A.md', text: 'links to [[B]] here' },
      { path: 'B.md', text: 'links to itself [[B]] which does not count' },
      { path: 'c/C.md', text: 'full path [[B.md]] works too' },
      { path: 'D.md', text: 'no links at all' },
    ];
    const back = backlinksTo('B.md', notes);
    expect(back.map((b) => b.path).sort()).toEqual(['A.md', 'c/C.md']);
    expect(back[0]!.excerpt.length).toBeGreaterThan(0);
  });
});

describe('folder tree', () => {
  const files = [
    { path: 'B root.md', updatedAt: '', size: 1 },
    { path: 'a/one.md', updatedAt: '', size: 1 },
    { path: 'a/two.md', updatedAt: '', size: 1 },
    { path: 'a/deep/three.md', updatedAt: '', size: 1 },
  ];

  it('lists folders first then notes at each level', () => {
    expect(treeAt('', files)).toEqual([
      { kind: 'folder', path: 'a', name: 'a' },
      { kind: 'note', path: 'B root.md', name: 'B root' },
    ]);
    expect(treeAt('a', files)).toEqual([
      { kind: 'folder', path: 'a/deep', name: 'deep' },
      { kind: 'note', path: 'a/one.md', name: 'one' },
      { kind: 'note', path: 'a/two.md', name: 'two' },
    ]);
  });
});

describe('wikilinkContext (editor [[ autocomplete)', () => {
  it('opens a query at the caret right after "[["', () => {
    const text = 'see [[Ide';
    expect(wikilinkContext(text, text.length)).toEqual({ start: 4, query: 'Ide' });
  });

  it('reads from the caret, not the end of text', () => {
    const text = 'a [[One and later [[Two';
    // Caret right after the first "[[One" (index 7), before the second brackets.
    expect(wikilinkContext(text, 7)).toEqual({ start: 2, query: 'One' });
  });

  it('is null when the pair is already closed', () => {
    const text = 'see [[Ideas]] now';
    expect(wikilinkContext(text, text.length)).toBeNull();
  });

  it('cancels once the alias half begins', () => {
    const text = 'see [[Ideas|the';
    expect(wikilinkContext(text, text.length)).toBeNull();
  });

  it('cancels across a newline', () => {
    const text = 'see [[Ideas\nmore';
    expect(wikilinkContext(text, text.length)).toBeNull();
  });

  it('is null with no open brackets', () => {
    expect(wikilinkContext('plain text', 5)).toBeNull();
  });

  it('offers an empty query the instant "[[" is typed', () => {
    const text = 'x [[';
    expect(wikilinkContext(text, text.length)).toEqual({ start: 2, query: '' });
  });
});
