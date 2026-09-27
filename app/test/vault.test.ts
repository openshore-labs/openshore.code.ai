import { describe, expect, it } from 'vitest';
import {
  backlinksTo,
  isConflictCopy,
  searchNotes,
  nonNoteExtension,
  normalizeNotePath,
  noteFolder,
  noteTitle,
  parseWikilinks,
  resolveWikilink,
  treeAt,
  wikilinkContext,
  wikilinksToMarkdown,
} from '../src/lib/vault.js';
import { vaultUrlTransform } from '../src/components/VaultMarkdown.js';
import { isNotePath } from '../src/lib/gitos/providers.js';

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

  it('drops dot and dot-dot segments so a name cannot escape the vault root', () => {
    // SEC: a typed name or a wikilink target must never climb out of the vault
    // and clobber a sibling resource.
    expect(normalizeNotePath('../x')).toBe('x.md');
    expect(normalizeNotePath('../../secrets/lease')).toBe('secrets/lease.md');
    expect(normalizeNotePath('a/../../b')).toBe('a/b.md');
    expect(normalizeNotePath('./note')).toBe('note.md');
    expect(normalizeNotePath('../..')).toBeUndefined();
  });

  it('strips filesystem and Obsidian forbidden characters (R-6)', () => {
    expect(normalizeNotePath('a:b*c?.md')).toBe('abc.md');
    expect(normalizeNotePath('note#heading^block')).toBe('noteheadingblock.md');
    expect(normalizeNotePath('<>|"')).toBeUndefined();
  });

  it('strips leading dots so a typed name never lands on a path the list hides', () => {
    // A dot segment is hidden (0.6), in Obsidian and here. A note typed as
    // ".NET migration" once landed at ".NET migration.md": it never listed,
    // stat missed it, and the next create or link tap wrote '' over it.
    expect(normalizeNotePath('.NET migration')).toBe('NET migration.md');
    expect(normalizeNotePath('...later')).toBe('later.md');
    expect(normalizeNotePath('Ideas/.env setup')).toBe('Ideas/env setup.md');
    expect(normalizeNotePath('. spaced')).toBe('spaced.md');
    expect(normalizeNotePath('#.hash first')).toBe('hash first.md');
    expect(normalizeNotePath('.obsidian/Note')).toBe('obsidian/Note.md');
    expect(normalizeNotePath('...')).toBeUndefined();
    expect(normalizeNotePath('.md')).toBe('md.md');
  });

  it('every name it accepts is a note the list shows (0.6 round trip)', () => {
    for (const typed of [
      'Note',
      '.NET migration',
      '...later',
      'Ideas/.env setup',
      '.hidden/.deeper/Plan',
      './note',
      '../x',
      'a/../../b',
      'v1.2 plan',
      'Mr. Smith',
      'photo.png.md',
      'UPPER.MD',
      '.md',
      'pics.png/Note',
      '  ideas / First Note ',
      'café',
    ]) {
      const path = normalizeNotePath(typed);
      expect(path, typed).toBeDefined();
      expect(isNotePath(path!), `${typed} -> ${path}`).toBe(true);
    }
  });

  it('a link to a dot-typed name finds the note that name created', () => {
    const created = normalizeNotePath('.NET migration')!;
    expect(resolveWikilink('.NET migration', [created])).toBe(created);
    expect(wikilinksToMarkdown('[[.NET migration]]', [created])).toBe(
      '[.NET migration](vault:NET%20migration.md)',
    );
  });

  it('normalizes unicode to NFC so decomposed and composed names match (R-4)', () => {
    // "e" + combining acute (NFD) and precomposed "e-acute" (NFC) must map to
    // the same path.
    const nfd = normalizeNotePath('cafe\u0301'); // e + combining acute
    const nfc = normalizeNotePath('caf\u00e9'); // precomposed e-acute
    expect(nfd).toBe(nfc);
  });
});

describe('only notes are notes (0.6)', () => {
  // One rule at the seam: a .md file with no dot segment. Every provider's
  // list() and a vault move go through it.
  const table: Array<[string, boolean]> = [
    ['Note.md', true],
    ['ideas/Plan.md', true],
    ['UPPER.MD', true],
    ['v1.2 plan.md', true],
    ['photo.png.md', true],
    ['Decision: auth?.md', true],
    ['.obsidian/workspace.json', false],
    ['.obsidian/app.json', false],
    ['.obsidian/snippets/theme.md', false],
    ['.trash/Old.md', false],
    ['.oscode/lease.json', false],
    ['.git/HEAD', false],
    ['ideas/.hidden.md', false],
    ['.Far.md.icloud', false],
    ['attachments/pic.png', false],
    ['spec.pdf', false],
    ['Board.canvas', false],
    ['Tasks.base', false],
    ['notes.txt', false],
    ['README', false],
  ];
  it.each(table)('%s is a note: %s', (path, note) => {
    expect(isNotePath(path)).toBe(note);
  });
});

describe('.md is never appended to a known non-markdown name (0.6, obs-12)', () => {
  it('refuses an attachment name instead of turning it into a note', () => {
    for (const name of [
      'diagram.png',
      'photo.JPG',
      'pic.jpeg',
      'anim.gif',
      'shot.webp',
      'logo.svg',
      'spec.pdf',
      'Board.canvas',
      'Tasks.base',
      'memo.mp3',
      'clip.mp4',
      'take.mov',
      '.obsidian/app.json',
      'attachments/diagram.png',
    ]) {
      expect(normalizeNotePath(name), name).toBeUndefined();
    }
  });

  it('still appends .md to a note name with any other dot', () => {
    expect(normalizeNotePath('v1.2 plan')).toBe('v1.2 plan.md');
    expect(normalizeNotePath('Meeting 2026.09.27')).toBe('Meeting 2026.09.27.md');
    expect(normalizeNotePath('Mr. Smith')).toBe('Mr. Smith.md');
    expect(normalizeNotePath('pics.png/Note')).toBe('pics.png/Note.md');
    expect(normalizeNotePath('photo.png.md')).toBe('photo.png.md');
  });

  it('a wikilink to diagram.png no longer creates diagram.png.md', () => {
    const md = wikilinksToMarkdown('See [[diagram.png]] and [[spec.pdf|the spec]].', []);
    expect(md).not.toContain('.png.md');
    expect(md).not.toContain('.pdf.md');
    // The link still renders (dashed), but a tap hands vaultCreate a name
    // that normalizes to nothing, so no note is written.
    expect(md).toContain('[diagram.png](vault:diagram.png?new)');
    expect(normalizeNotePath('diagram.png')).toBeUndefined();
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

  it('resolves an existing note whose name looks like a file', () => {
    // Refusing an attachment extension is a create rule. A note that already
    // exists under such a name ("package.json.md", a pre-0.6 "report.pdf.md")
    // is a note: its links resolve and it keeps its backlinks.
    const named = ['package.json.md', 'Data.csv.md', 'docs/report.pdf.md', 'v1.0 plan.md'];
    expect(resolveWikilink('package.json', named)).toBe('package.json.md');
    expect(resolveWikilink('PACKAGE.JSON', named)).toBe('package.json.md');
    expect(resolveWikilink('Data.csv', named)).toBe('Data.csv.md');
    expect(resolveWikilink('report.pdf', named)).toBe('docs/report.pdf.md');
    expect(resolveWikilink('docs/report.pdf', named)).toBe('docs/report.pdf.md');
    expect(resolveWikilink('v1.0 plan', named)).toBe('v1.0 plan.md');
    expect(resolveWikilink('package.json.md', named)).toBe('package.json.md');
    const md = wikilinksToMarkdown('See [[package.json]] and [[report.pdf|the report]].', named);
    expect(md).toContain('[package.json](vault:package.json.md)');
    expect(md).toContain('[the report](vault:docs%2Freport.pdf.md)');
    expect(md).not.toContain('?new');
    // The resolved destination is a note, so a tap opens it rather than
    // calling it an attachment.
    expect(nonNoteExtension('package.json.md')).toBeUndefined();
    expect(nonNoteExtension('docs/report.pdf.md')).toBeUndefined();
  });

  it('keeps backlinks for a note whose name looks like a file', () => {
    const notes = [
      { path: 'package.json.md', text: 'deps notes' },
      { path: 'Build.md', text: 'bump the version in [[package.json]] first' },
      { path: 'Other.md', text: 'unrelated [[diagram.png]]' },
    ];
    expect(backlinksTo('package.json.md', notes).map((b) => b.path)).toEqual(['Build.md']);
  });

  it('an attachment name with no such note stays unresolved', () => {
    const named = ['package.json.md'];
    expect(resolveWikilink('diagram.png', named)).toBeUndefined();
    expect(resolveWikilink('settings.json', named)).toBeUndefined();
    expect(wikilinksToMarkdown('[[diagram.png]]', named)).toBe(
      '[diagram.png](vault:diagram.png?new)',
    );
    expect(nonNoteExtension('diagram.png')).toBe('.png');
  });

  it('renders an embed as a chip, not a broken image or a linked target', () => {
    const md = wikilinksToMarkdown('Look: ![[Roadmap]] and ![[Art|the art]].', paths);
    expect(md).toContain('`embed not supported yet: Roadmap`');
    expect(md).toContain('`embed not supported yet: the art`');
    // The embed's inner target is not turned into a vault link or an image.
    expect(md).not.toContain('![');
    expect(md).not.toContain('vault:projects%2FRoadmap.md)');
  });
});

describe('vault url transform (COR-1: vault links must survive the renderer)', () => {
  it('passes vault: hrefs through and blocks hostile protocols', () => {
    expect(vaultUrlTransform('vault:Ideas.md')).toBe('vault:Ideas.md');
    expect(vaultUrlTransform('vault:Missing.md?new')).toBe('vault:Missing.md?new');
    // https keeps working; javascript is stripped by the default transform.
    expect(vaultUrlTransform('https://example.com')).toBe('https://example.com');
    expect(vaultUrlTransform('javascript:alert(1)')).toBe('');
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

describe('searchNotes (review 6: a way to find a note)', () => {
  const paths = ['Ideas.md', 'ideas/Launch plan.md', 'Journal/2026-09-16.md', 'Recipes.md'];
  const bodies = new Map([
    ['Journal/2026-09-16.md', 'Met the team about the launch. Decided to ship Friday.'],
    ['Recipes.md', '# Soup\nOnions, stock, time.'],
  ]);

  it('matches nothing on a blank query so the tree shows instead', () => {
    expect(searchNotes('', paths, bodies)).toEqual([]);
    expect(searchNotes('   ', paths, bodies)).toEqual([]);
  });

  it('puts title hits first, then body hits with an excerpt, case-insensitively', () => {
    const hits = searchNotes('launch', paths, bodies);
    expect(hits.map((h) => h.path)).toEqual(['ideas/Launch plan.md', 'Journal/2026-09-16.md']);
    expect(hits[0]?.where).toBe('title');
    expect(hits[1]?.where).toBe('body');
    expect(hits[1]?.excerpt).toContain('launch');
  });

  it('matches a folder name through the path', () => {
    expect(searchNotes('journal', paths, bodies).map((h) => h.path)).toEqual([
      'Journal/2026-09-16.md',
    ]);
  });

  it('works with a plain object of bodies and without any bodies', () => {
    expect(searchNotes('soup', paths, { 'Recipes.md': 'Soup time' })).toHaveLength(1);
    expect(searchNotes('soup', paths)).toEqual([]);
  });
});

describe('isConflictCopy', () => {
  it("recognizes the server's conflict-copy name and nothing else", () => {
    expect(isConflictCopy('Plan (conflict 2026-01-01 1200).md')).toBe(true);
    expect(isConflictCopy('team/Plan (conflict 2026-01-01 1200).md')).toBe(true);
    expect(isConflictCopy('Plan.md')).toBe(false);
    expect(isConflictCopy('Conflict resolution.md')).toBe(false);
  });
});
