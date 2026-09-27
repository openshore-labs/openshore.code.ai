// The Vault's shared core (Vault M3, CTO H4): the one new-name rule, the note
// filter, the pinned resolution order (row by row), the hostile-names table,
// the dashed-link invariant as a property test, link text, rewriting and
// excerpts. Every resolution row carries `obsidianChecked: false` until the
// M8 fixture vault confirms it against Obsidian itself.
//
// The scanner's cases are in vaultScan.test.ts, the frontmatter reader's in
// vaultFrontmatter.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPathIndex,
  checkNewNoteName,
  cleanNotePath,
  eolOf,
  excerptAt,
  foldPath,
  highlightRanges,
  isConflictCopy,
  isNotePath,
  linkTextFor,
  mergeProvenance,
  nonNoteExtension,
  normalizeNotePath,
  noteFolder,
  parseVaultQuery,
  noteTitle,
  oscodeMarks,
  PROV_KEYS,
  readFrontmatter,
  readProvenance,
  resolveMarkdownLink,
  resolveWikilink,
  rewriteLinks,
  safeNoteName,
  scanNote,
  utf8Length,
  vaultConflictCopyPath,
  wikilinkContext,
} from '../src/protocol.js';
import { vaultConflictCopyPath as fromCoreVault } from '../src/core/vault/conflictName.js';
import { phrasesMatch } from '../src/harness/vault/query.js';
import { runNoteFrontmatter, type RunNoteFields } from '../src/routines/runNote.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('the one new-name rule (H4)', () => {
  // [typed, normalizeNotePath, note]. Rows marked CHANGED differ from the
  // app's pre-M3 vault.ts on purpose.
  const table: Array<[string, string | undefined, string?]> = [
    ['  ideas / First Note ', 'ideas/First Note.md'],
    ['already.md', 'already.md'],
    ['UPPER.MD', 'UPPER.MD'],
    ['///', undefined],
    ['../x', 'x.md', 'dot segments are dropped (path jail)'],
    ['../../secrets/lease', 'secrets/lease.md'],
    ['a/../../b', 'a/b.md'],
    ['./note', 'note.md'],
    ['../..', undefined],
    ['a:b*c?.md', 'abc.md'],
    ['note#heading^block', 'noteheadingblock.md'],
    ['<>|"', undefined],
    ['[draft] Plan', 'draft Plan.md'],
    ['back\\slash', 'back/slash.md', 'a backslash becomes a separator'],
    ['.NET migration', 'NET migration.md'],
    ['...later', 'later.md'],
    ['Ideas/.env setup', 'Ideas/env setup.md'],
    ['#.hash first', 'hash first.md'],
    ['.md', 'md.md'],
    ['v1.2 plan', 'v1.2 plan.md'],
    ['Mr. Smith', 'Mr. Smith.md'],
    ['pics.png/Note', 'pics.png/Note.md'],
    ['photo.png.md', 'photo.png.md'],
    ['diagram.png', undefined, 'an attachment name never becomes a note'],
    ['Board.canvas', undefined],
    ['Mr.', 'Mr.md', 'CHANGED: no trailing dot (was "Mr..md")'],
    ['Plan ./Note', 'Plan/Note.md', 'CHANGED: no trailing dot or space on a folder'],
    ['Note. .md', 'Note.md', 'CHANGED: the stem loses its trailing dot and space'],
    ['CON', 'CON_.md', 'CHANGED: a Windows reserved name is made safe'],
    ['lpt9.draft', 'lpt9_.draft.md', 'CHANGED: reserved before the first dot'],
    ['nul/Plan', 'nul_/Plan.md', 'CHANGED: reserved folder'],
    ['Console', 'Console.md', 'only the exact reserved name'],
  ];
  it.each(table)('normalizeNotePath(%j) is %j', (typed, want) => {
    expect(normalizeNotePath(typed)).toBe(want);
    if (want) expect(isNotePath(want)).toBe(true);
    if (want) expect(isNotePath(want, { windows: true })).toBe(true);
  });

  it('is NFC, so a decomposed and a composed name are one note', () => {
    expect(normalizeNotePath('café')).toBe(normalizeNotePath('café'));
    expect(normalizeNotePath('café')).toBe('café.md');
  });

  it('caps each segment at 255 bytes on a code point boundary', () => {
    const long = 'é'.repeat(200); // 400 bytes
    const out = normalizeNotePath(`${long}/${long}`)!;
    const [folder, name] = out.split('/');
    expect(utf8Length(folder!)).toBeLessThanOrEqual(255);
    expect(utf8Length(name!)).toBeLessThanOrEqual(255);
    expect(name!.endsWith('.md')).toBe(true);
    expect(out).not.toMatch(/�/);
    const emoji = normalizeNotePath('🚀'.repeat(100))!; // 400 bytes
    expect(utf8Length(emoji)).toBeLessThanOrEqual(255);
    expect([...emoji.slice(0, -3)].every((c) => c === '🚀')).toBe(true);
  });

  it('cleanNotePath applies the rule without the extension step', () => {
    expect(cleanNotePath(' a / .b / c. ')).toBe('a/b/c');
    expect(cleanNotePath('diagram.png')).toBe('diagram.png');
  });

  it('checkNewNoteName accepts a clean name and names the path', () => {
    for (const typed of ['Plan', 'Ideas/Plan', ' Ideas / Plan ', 'Plan.md', 'v1.2 plan', 'café']) {
      const r = checkNewNoteName(typed);
      expect(r, typed).toEqual({ ok: true, path: normalizeNotePath(typed) });
    }
  });

  const refusals: Array<[string, RegExp, string | undefined]> = [
    ['', /Give the note a name/, undefined],
    ['Decision: auth?', /cannot contain : \?/, 'Decision auth.md'],
    ['Ideas\\Plan', /cannot contain \\/, 'Ideas/Plan.md'],
    ['C# notes', /cannot contain #/, 'C notes.md'],
    ['[[Plan]]', /cannot contain \[ \]/, 'Plan.md'],
    ['.env', /cannot start with a dot/, 'env.md'],
    ['Ideas/.hidden/Plan', /cannot start with a dot/, 'Ideas/hidden/Plan.md'],
    ['Mr.', /end in a dot or a space/, 'Mr.md'],
    ['Draft ./Plan', /end in a dot or a space/, 'Draft/Plan.md'],
    ['CON', /Windows reserves/, 'CON_.md'],
    ['x'.repeat(300), /255 bytes/, `${'x'.repeat(252)}.md`],
    ['diagram.png', /names a file, not a note/, undefined],
  ];
  it.each(refusals)('checkNewNoteName(%j) refuses and suggests', (typed, error, suggestion) => {
    const r = checkNewNoteName(typed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(error);
    expect(r.suggestion).toBe(suggestion);
    if (suggestion) {
      expect(r.error).toContain(`Use "${suggestion}".`);
      expect(checkNewNoteName(suggestion)).toEqual({ ok: true, path: suggestion });
    }
  });

  it('safeNoteName cleans one segment for a derived folder name', () => {
    expect(safeNoteName('Daily: standup / notes?')).toBe('Daily standup notes');
    expect(safeNoteName('  .hidden. ')).toBe('hidden');
    expect(safeNoteName('CON')).toBe('CON_');
    expect(safeNoteName('???', 'Routine')).toBe('Routine');
    expect(safeNoteName('')).toBe('Untitled');
    expect(utf8Length(safeNoteName('ü'.repeat(300)))).toBeLessThanOrEqual(255);
  });
});

describe('only notes are notes (0.6), and what Windows cannot hold', () => {
  // [path, is a note, is a note on Windows]
  const table: Array<[string, boolean, boolean]> = [
    ['Note.md', true, true],
    ['ideas/Plan.md', true, true],
    ['UPPER.MD', true, true],
    ['v1.2 plan.md', true, true],
    ['photo.png.md', true, true],
    ['Decision: auth?.md', true, false],
    ['CON.md', true, false],
    ['aux/Plan.md', true, false],
    ['Draft./Plan.md', true, false],
    ['.obsidian/workspace.json', false, false],
    ['.obsidian/snippets/theme.md', false, false],
    ['.trash/Old.md', false, false],
    ['ideas/.hidden.md', false, false],
    ['.Far.md.icloud', false, false],
    ['attachments/pic.png', false, false],
    ['README', false, false],
    ['a\\b.md', false, false],
    ['/rooted.md', false, false],
  ];
  it.each(table)('%s: note %s, on Windows %s', (path, note, windows) => {
    expect(isNotePath(path)).toBe(note);
    expect(isNotePath(path, { windows: false })).toBe(note);
    expect(isNotePath(path, { windows: true })).toBe(windows);
  });
});

describe('path helpers', () => {
  it('titles and folders come from the path, Obsidian style', () => {
    expect(noteTitle('ideas/First Note.md')).toBe('First Note');
    expect(noteTitle('UPPER.MD')).toBe('UPPER');
    expect(noteFolder('ideas/First Note.md')).toBe('ideas');
    expect(noteFolder('Root.md')).toBe('');
  });

  it('nonNoteExtension names an attachment, never a note', () => {
    expect(nonNoteExtension('diagram.png')).toBe('.png');
    expect(nonNoteExtension('photo.JPG')).toBe('.jpg');
    expect(nonNoteExtension('package.json.md')).toBeUndefined();
    expect(nonNoteExtension('v1.2 plan')).toBeUndefined();
  });

  it('foldPath folds case and normalization for comparing', () => {
    expect(foldPath('Café/PLAN.md')).toBe(foldPath('café/plan.md'));
  });

  it('eolOf tells an all-CRLF note from a mixed one', () => {
    expect(eolOf('')).toBe('lf');
    expect(eolOf('one line')).toBe('lf');
    expect(eolOf('a\nb\n')).toBe('lf');
    expect(eolOf('a\r\nb\r\n')).toBe('crlf');
    expect(eolOf('a\r\nb\n')).toBe('mixed');
    expect(eolOf('a\rb')).toBe('mixed');
  });

  it('isConflictCopy knows the conflict-copy name and nothing else', () => {
    expect(isConflictCopy('Plan (conflict 2026-01-01 1200).md')).toBe(true);
    expect(isConflictCopy('team/Plan (conflict 2026-01-01 1200).md')).toBe(true);
    expect(isConflictCopy('Plan.md')).toBe(false);
    expect(isConflictCopy('Conflict resolution.md')).toBe(false);
  });

  it('vaultConflictCopyPath moved here; core/vault/conflictName re-exports it', () => {
    const when = new Date(2026, 8, 27, 14, 5);
    expect(fromCoreVault).toBe(vaultConflictCopyPath);
    expect(vaultConflictCopyPath('Plan.md', when)).toBe('Plan (conflict 2026-09-27 1405).md');
    // A long name is shortened, never the suffix, so the copy stays a copy.
    const long = `Ideas/${'é'.repeat(200)}.md`;
    const copy = vaultConflictCopyPath(long, when, 3);
    expect(isConflictCopy(copy)).toBe(true);
    expect(copy).toMatch(/ \(conflict 2026-09-27 1405 3\)\.md$/);
    expect(utf8Length(copy.split('/').pop()!)).toBeLessThanOrEqual(255);
    expect(isNotePath(copy)).toBe(true);
  });
});

describe('the resolution order (H4), row by row', () => {
  interface Row {
    step: string;
    target: string;
    paths: string[];
    source?: string;
    want: string | undefined;
    obsidianChecked: false;
  }
  const rows: Row[] = [
    // 1. The subpath is split off; `target.md`, and `target` itself first
    //    when it already ends in .md.
    {
      step: '1 target.md: a name that looks like a file finds its note',
      target: 'package.json',
      paths: ['package.json.md'],
      want: 'package.json.md',
      obsidianChecked: false,
    },
    {
      step: '1 a target ending in .md is tried as written first',
      target: 'Plan.md',
      paths: ['Plan.md.md', 'Plan.md'],
      want: 'Plan.md',
      obsidianChecked: false,
    },
    {
      step: '1 a target ending in .md also tries target.md',
      target: 'package.json.md',
      paths: ['package.json.md.md'],
      want: 'package.json.md.md',
      obsidianChecked: false,
    },
    {
      step: '1 the subpath is split off',
      target: 'Plan#Goals',
      paths: ['Plan.md'],
      want: 'Plan.md',
      obsidianChecked: false,
    },
    {
      step: '1 a heading link alone is the source itself',
      target: '#Goals',
      paths: ['Notes/A.md'],
      source: 'Notes/A.md',
      want: 'Notes/A.md',
      obsidianChecked: false,
    },
    // 2. The exact vault path, folded.
    {
      step: '2 exact path',
      target: 'projects/Roadmap',
      paths: ['Roadmap.md', 'projects/Roadmap.md'],
      want: 'projects/Roadmap.md',
      obsidianChecked: false,
    },
    {
      step: '2 case folds',
      target: 'ideas',
      paths: ['Ideas.md'],
      want: 'Ideas.md',
      obsidianChecked: false,
    },
    {
      step: '2 on a case collision the exact case wins',
      target: 'plan',
      paths: ['Plan.md', 'plan.md'],
      want: 'plan.md',
      obsidianChecked: false,
    },
    {
      step: '2 then code-point order',
      target: 'PLAN',
      paths: ['plan.md', 'Plan.md'],
      want: 'Plan.md',
      obsidianChecked: false,
    },
    {
      step: '2 an NFC link finds an NFD name',
      target: 'café',
      paths: ['café.md'],
      want: 'café.md',
      obsidianChecked: false,
    },
    {
      step: '2 a name Obsidian can link keeps its colon and question mark',
      target: 'Decision: auth?',
      paths: ['Decision auth.md', 'Decision: auth?.md'],
      want: 'Decision: auth?.md',
      obsidianChecked: false,
    },
    {
      step: '2 the exact root note beats the source folder',
      target: 'Plan',
      paths: ['Plan.md', 'Archive/Plan.md'],
      source: 'Archive/Today.md',
      want: 'Plan.md',
      obsidianChecked: false,
    },
    // 3. Relative to the source's folder.
    {
      step: '3 relative with ..',
      target: '../Ideas/Plan',
      paths: ['Ideas/Plan.md', 'Work/Ideas/Plan.md'],
      source: 'Work/Today.md',
      want: 'Ideas/Plan.md',
      obsidianChecked: false,
    },
    {
      step: '3 relative below the source',
      target: 'sub/Plan',
      paths: ['Other/sub/Plan.md', 'Work/sub/Plan.md'],
      source: 'Work/Today.md',
      want: 'Work/sub/Plan.md',
      obsidianChecked: false,
    },
    {
      step: '3 climbing above the vault root never matches',
      target: '../../Secret',
      paths: ['a/Secret.md'],
      source: 'a/Today.md',
      want: undefined,
      obsidianChecked: false,
    },
    // 4. Suffix match on whole segments.
    {
      step: '4 a bare name anywhere in the vault',
      target: 'Roadmap',
      paths: ['projects/Roadmap.md'],
      want: 'projects/Roadmap.md',
      obsidianChecked: false,
    },
    {
      step: '4 a folder that is not there stays unresolved',
      target: 'Ideas/Plan',
      paths: ['Archive/Plan.md'],
      want: undefined,
      obsidianChecked: false,
    },
    {
      step: '4 a partial segment never matches',
      target: 'lan',
      paths: ['Plan.md'],
      want: undefined,
      obsidianChecked: false,
    },
    {
      step: '4 a trailing folder suffix matches',
      target: 'Ideas/Plan',
      paths: ['Work/Ideas/Plan.md', 'Ideas2/Plan.md'],
      want: 'Work/Ideas/Plan.md',
      obsidianChecked: false,
    },
    {
      step: "4 tie: the source's own folder first",
      target: 'Plan',
      paths: ['a/Plan.md', 'b/Plan.md'],
      source: 'b/Today.md',
      want: 'b/Plan.md',
      obsidianChecked: false,
    },
    {
      step: '4 tie: then fewest segments (CHANGED: was shortest string)',
      target: 'Plan',
      paths: ['a/b/Plan.md', 'longfolder/Plan.md'],
      want: 'longfolder/Plan.md',
      obsidianChecked: false,
    },
    {
      step: '4 tie: then shortest string',
      target: 'Plan',
      paths: ['aaaa/Plan.md', 'bbb/Plan.md'],
      want: 'bbb/Plan.md',
      obsidianChecked: false,
    },
    {
      step: '4 tie: then code-point order',
      target: 'Plan',
      paths: ['b/Plan.md', 'a/Plan.md'],
      want: 'a/Plan.md',
      obsidianChecked: false,
    },
    // 5. The cleaned name, last.
    {
      step: '5 a dot-typed name finds the note that name created',
      target: '.NET migration',
      paths: ['NET migration.md'],
      want: 'NET migration.md',
      obsidianChecked: false,
    },
    {
      step: '5 a name with refused characters finds its cleaned note',
      target: 'a:b',
      paths: ['ab.md'],
      want: 'ab.md',
      obsidianChecked: false,
    },
    {
      step: '5 but the exact name wins when it exists',
      target: 'a:b',
      paths: ['ab.md', 'a:b.md'],
      want: 'a:b.md',
      obsidianChecked: false,
    },
    {
      step: '5 an attachment name with no note stays unresolved',
      target: 'diagram.png',
      paths: ['package.json.md'],
      want: undefined,
      obsidianChecked: false,
    },
    {
      step: '- nothing matches',
      target: 'Missing',
      paths: ['Ideas.md'],
      want: undefined,
      obsidianChecked: false,
    },
  ];
  it.each(rows)('$step', (row) => {
    expect(row.obsidianChecked).toBe(false);
    expect(resolveWikilink(row.target, row.paths, row.source)).toBe(row.want);
    // The same answer through a built index.
    expect(resolveWikilink(row.target, buildPathIndex(row.paths), row.source)).toBe(row.want);
  });

  it("keeps the app's pre-M3 answers where names keep their meaning", () => {
    const paths = ['Ideas.md', 'projects/Ideas.md', 'projects/Roadmap.md'];
    expect(resolveWikilink('projects/Roadmap', paths)).toBe('projects/Roadmap.md');
    expect(resolveWikilink('Ideas', paths)).toBe('Ideas.md');
    expect(resolveWikilink('Roadmap', paths)).toBe('projects/Roadmap.md');
    expect(resolveWikilink('Missing', paths)).toBeUndefined();
    const named = ['package.json.md', 'Data.csv.md', 'docs/report.pdf.md', 'v1.0 plan.md'];
    expect(resolveWikilink('PACKAGE.JSON', named)).toBe('package.json.md');
    expect(resolveWikilink('Data.csv', named)).toBe('Data.csv.md');
    expect(resolveWikilink('report.pdf', named)).toBe('docs/report.pdf.md');
    expect(resolveWikilink('docs/report.pdf', named)).toBe('docs/report.pdf.md');
    expect(resolveWikilink('v1.0 plan', named)).toBe('v1.0 plan.md');
    expect(resolveWikilink('package.json.md', named)).toBe('package.json.md');
  });
});

/** A small seeded generator, so the property test is repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the dashed-link invariant (H4, property)', () => {
  // Everything a wikilink target may hold (the grammar refuses # | ^ [ ] and
  // line breaks), weighted toward what breaks names.
  const pieces = [
    'Plan',
    'plan',
    'Ideas',
    'a',
    'B',
    ' ',
    '  ',
    '.',
    '..',
    '/',
    '/',
    ':',
    '?',
    '*',
    '"',
    '<',
    '>',
    '\\',
    'café',
    'café',
    'CON',
    'nul',
    '.md',
    '.MD',
    '.png',
    '.pdf',
    'v1.2',
    '🚀',
    '日本',
    '-',
    '_',
    '(1)',
    "'",
    'x'.repeat(90),
  ];
  const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const target = (r: () => number) =>
    Array.from({ length: 1 + Math.floor(r() * 5) }, () => pick(r, pieces)).join('');

  it('a dashed link, once its note is created, reaches that note', () => {
    const r = rng(20260927);
    let checked = 0;
    for (let n = 0; n < 3000; n++) {
      const paths = Array.from({ length: Math.floor(r() * 6) }, () =>
        normalizeNotePath(target(r)),
      ).filter((p): p is string => !!p);
      const source = r() < 0.5 ? undefined : (normalizeNotePath(target(r)) ?? undefined);
      const t = target(r);
      const created = normalizeNotePath(t);
      if (!created || resolveWikilink(t, paths, source) !== undefined) continue;
      checked++;
      expect(isNotePath(created), t).toBe(true);
      expect(
        resolveWikilink(t, [...paths, created], source),
        JSON.stringify({ t, paths, source }),
      ).toBe(created);
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('hostile names (H4): each lists, and links wherever the grammar allows', () => {
  // [existing name, linkable, note]
  const table: Array<[string, boolean, string]> = [
    ['Decision: auth?.md', true, 'Obsidian links it as written'],
    ['Café.md', true, 'an NFD name from APFS'],
    ['C# notes.md', false, 'known limit: "#" starts a subpath, so no link reaches it'],
    ['[draft] Plan.md', false, 'known limit: brackets end the link'],
    ['a|b.md', false, 'known limit: "|" starts the alias'],
    ['x^y.md', false, 'known limit: "^" is refused in a target'],
    [' leading space.md', false, 'known limit: a link target is trimmed'],
    ['Mr. Smith.md', true, 'an inner dot'],
    ['v1.2 plan.md', true, 'a dotted version'],
    ['trailing dot..md', true, 'an old name the new rule would refuse'],
    ['package.json.md', true, 'looks like a file'],
    ['CON.md', true, 'a reserved name made elsewhere'],
    ['Plan (conflict 2026-09-27 1405).md', true, 'a conflict copy'],
    ['日本語のノート.md', true, 'CJK'],
    ['launch 🚀.md', true, 'an astral character'],
    ["Rock 'n' roll.md", true, 'quotes'],
    ['deep/er/Folder Note.md', true, 'nested'],
  ];
  it.each(table)('%s (linkable: %s, %s)', (name, linkable) => {
    expect(isNotePath(name)).toBe(true);
    expect(noteTitle(name).length).toBeGreaterThan(0);
    const paths = [name, 'Home.md', 'Other/Home.md'];
    const text = linkTextFor(name, 'Home.md', paths);
    if (!linkable) {
      expect(text).toBeUndefined();
      return;
    }
    expect(text).toBeDefined();
    expect(resolveWikilink(text!, paths, 'Home.md')).toBe(name);
    // The scanner reads the same text back as one link with that target.
    const [link] = scanNote(`see [[${text}]] here`).links;
    expect(link?.target).toBe(text);
    expect(resolveWikilink(link!.target, paths, 'Home.md')).toBe(name);
  });

  it('an NFD name is reached by the NFC name a person types', () => {
    expect(resolveWikilink('Café', ['Café.md'])).toBe('Café.md');
  });
});

describe('linkTextFor (the shortest unambiguous link)', () => {
  it('is the bare name when only one note has it', () => {
    expect(linkTextFor('a/Plan.md', 'Home.md', ['a/Plan.md', 'Home.md'])).toBe('Plan');
  });

  it('grows a folder when the name is shared', () => {
    const paths = ['a/Plan.md', 'b/Plan.md'];
    expect(linkTextFor('a/Plan.md', 'Home.md', paths)).toBe('a/Plan');
    expect(linkTextFor('b/Plan.md', 'Home.md', paths)).toBe('b/Plan');
    const deep = ['x/a/Plan.md', 'y/a/Plan.md'];
    expect(linkTextFor('y/a/Plan.md', 'Home.md', deep)).toBe('y/a/Plan');
  });

  it('keeps the root note bare when a folder shares its name', () => {
    expect(linkTextFor('Plan.md', 'Home.md', ['Plan.md', 'a/Plan.md'])).toBe('Plan');
    expect(linkTextFor('a/Plan.md', 'Home.md', ['Plan.md', 'a/Plan.md'])).toBe('a/Plan');
  });

  it('falls back to the full path with .md when the stem is taken', () => {
    const paths = ['x.md', 'x.md.md'];
    expect(linkTextFor('x.md.md', 'Home.md', paths)).toBe('x.md.md');
    expect(linkTextFor('x.md', 'Home.md', paths)).toBe('x');
  });
});

describe('resolveMarkdownLink', () => {
  const paths = ['Notes/Plan B.md', 'Plan B.md', 'Ideas/Deep.md', 'pic.png'];
  it('resolves relative to the source first, then from the root', () => {
    expect(resolveMarkdownLink('Plan%20B.md', 'Notes/Home.md', paths)).toBe('Notes/Plan B.md');
    expect(resolveMarkdownLink('Plan%20B.md', 'Home.md', paths)).toBe('Plan B.md');
    expect(resolveMarkdownLink('../Plan%20B.md#Goals', 'Notes/Home.md', paths)).toBe('Plan B.md');
    expect(resolveMarkdownLink('Ideas/Deep.md', 'Notes/Home.md', paths)).toBe('Ideas/Deep.md');
    expect(resolveMarkdownLink('<Plan B.md>', 'Home.md', paths)).toBe('Plan B.md');
    expect(resolveMarkdownLink('Deep', 'Home.md', paths)).toBe('Ideas/Deep.md');
  });

  it('answers undefined for a scheme, //, #-only, an attachment, or an explicit miss', () => {
    expect(resolveMarkdownLink('https://example.com/Plan.md', 'Home.md', paths)).toBeUndefined();
    expect(resolveMarkdownLink('//host/Plan.md', 'Home.md', paths)).toBeUndefined();
    expect(resolveMarkdownLink('#Goals', 'Home.md', paths)).toBeUndefined();
    expect(resolveMarkdownLink('pic.png', 'Home.md', paths)).toBeUndefined();
    expect(resolveMarkdownLink('./Deep.md', 'Home.md', paths)).toBeUndefined();
    expect(resolveMarkdownLink('%E0%A4%A.md', 'Home.md', paths)).toBeUndefined();
  });
});

describe('wikilinkContext (the editor picker)', () => {
  it('opens a query at the caret right after "[["', () => {
    const text = 'see [[Ide';
    expect(wikilinkContext(text, text.length)).toEqual({
      start: 4,
      end: 9,
      query: 'Ide',
      embed: false,
    });
  });
  it('marks an embed', () => {
    expect(wikilinkContext('![[pic', 6)).toEqual({ start: 1, end: 6, query: 'pic', embed: true });
  });
  it('reads from the caret, not the end of text', () => {
    expect(wikilinkContext('a [[One and later [[Two', 7)?.query).toBe('One');
  });
  it('is null once closed, past a newline, in the alias half, or with no "[["', () => {
    expect(wikilinkContext('see [[Ideas]] now', 17)).toBeNull();
    expect(wikilinkContext('see [[Ideas\nmore', 16)).toBeNull();
    expect(wikilinkContext('see [[Ideas|the', 15)).toBeNull();
    expect(wikilinkContext('plain text', 5)).toBeNull();
  });
});

describe('rewriteLinks (H4)', () => {
  const before = ['Plan.md', 'Home.md', 'Other.md'];

  it('changes only the target, keeping subpath, alias and embed', () => {
    const text = 'See [[Plan#Goals|the plan]], ![[Plan]], [[Plan#^b1]] and [[Other]].\n';
    const after = ['Plan B.md', 'Home.md', 'Other.md'];
    const r = rewriteLinks(text, 'Home.md', 'Plan.md', 'Plan B.md', before, after);
    expect(r.count).toBe(3);
    expect(r.text).toBe(
      'See [[Plan B#Goals|the plan]], ![[Plan B]], [[Plan B#^b1]] and [[Other]].\n',
    );
  });

  it('leaves a link alone when it still reaches the moved note', () => {
    const text = 'See [[Plan]].';
    const after = ['Archive/Plan.md', 'Home.md', 'Other.md'];
    expect(rewriteLinks(text, 'Home.md', 'Plan.md', 'Archive/Plan.md', before, after)).toEqual({
      text,
      count: 0,
    });
  });

  it('writes a longer path when the new name is shared', () => {
    const after = ['Archive/Plan.md', 'Other/Plan.md', 'Home.md'];
    const r = rewriteLinks('[[Plan|p]]', 'Home.md', 'Plan.md', 'Archive/Plan.md', before, after);
    expect(r.text).toBe('[[Archive/Plan|p]]');
  });

  it('rewrites frontmatter links and markdown links, relative to the source', () => {
    const text = [
      '---',
      'related: "[[Plan]]"',
      '---',
      'A [link](../Plan.md#Goals "title") and [bare](../Plan) and [angle](<../Plan.md>).',
      '',
    ].join('\n');
    const b = ['Plan.md', 'Notes/Home.md'];
    const a = ['Archive/Plan (v2).md', 'Notes/Home.md'];
    const r = rewriteLinks(text, 'Notes/Home.md', 'Plan.md', 'Archive/Plan (v2).md', b, a);
    expect(r.count).toBe(4);
    expect(r.text).toBe(
      [
        '---',
        'related: "[[Plan (v2)]]"',
        '---',
        'A [link](../Archive/Plan%20%28v2%29.md#Goals "title") and [bare](../Archive/Plan%20%28v2%29) and [angle](<../Archive/Plan (v2).md>).',
        '',
      ].join('\n'),
    );
  });

  it('percent-encodes a # in a markdown destination, so it never reads as a heading', () => {
    const r = rewriteLinks(
      'A [link](Plan.md#Goals) to it.',
      'Home.md',
      'Plan.md',
      'Work/C# notes.md',
      before,
      ['Work/C# notes.md', 'Home.md', 'Other.md'],
    );
    expect(r.count).toBe(1);
    expect(r.text).toBe('A [link](Work/C%23%20notes.md#Goals) to it.');
  });

  it('never touches a link inside code, or a link to another note', () => {
    const text = '```\n[[Plan]]\n```\n`[[Plan]]` %%[[Plan]]%% [[Other]]';
    const after = ['Renamed.md', 'Home.md', 'Other.md'];
    expect(rewriteLinks(text, 'Home.md', 'Plan.md', 'Renamed.md', before, after)).toEqual({
      text,
      count: 0,
    });
  });

  it('keeps CRLF and every byte outside the targets', () => {
    const text = '﻿---\r\na: 1\r\n---\r\nx [[Plan]] y\r\n';
    const after = ['New.md', 'Home.md', 'Other.md'];
    const r = rewriteLinks(text, 'Home.md', 'Plan.md', 'New.md', before, after);
    expect(r.text).toBe('﻿---\r\na: 1\r\n---\r\nx [[New]] y\r\n');
  });

  it('leaves a frontmatter link whose new name would end the YAML string', () => {
    const text = "---\nrel: '[[Plan]]'\n---\n[[Plan]]";
    const after = ["Rock 'n' roll.md", 'Home.md', 'Other.md'];
    const r = rewriteLinks(text, 'Home.md', 'Plan.md', "Rock 'n' roll.md", before, after);
    expect(r).toEqual({ text: "---\nrel: '[[Plan]]'\n---\n[[Rock 'n' roll]]", count: 1 });
  });
});

describe('excerptAt (H4)', () => {
  it('cuts about 40 characters before and 80 after, line breaks folded', () => {
    const text = `${'a'.repeat(100)}\n[[Plan]] ${'b'.repeat(200)}`;
    const at = text.indexOf('[[');
    const e = excerptAt(text, at);
    expect(e.start).toBe(at - 40);
    expect(e.end).toBe(at + 80);
    expect(e.text).toBe(`${'a'.repeat(39)} [[Plan]] ${'b'.repeat(71)}`);
    expect(e.line).toBe(1);
  });

  it('never reaches into the frontmatter', () => {
    const text = '---\nsecret: token\n---\nSee [[Plan]] now';
    const e = excerptAt(text, text.indexOf('[['));
    expect(e.text).toBe('See [[Plan]] now');
    expect(e.start).toBe(text.indexOf('See'));
  });

  it('excerpts its own line for a frontmatter link', () => {
    const text = '---\ntitle: x\nrelated: "[[Plan]]"\n---\nbody';
    const e = excerptAt(text, text.indexOf('[['));
    expect(e.text).toBe('related: "[[Plan]]"');
    expect(e.line).toBe(2);
  });

  it('never splits a surrogate pair', () => {
    const text = `${'🚀'.repeat(30)}[[Plan]]${'🚀'.repeat(60)}`;
    for (let at = 0; at < text.length; at += 7) {
      const e = excerptAt(text, at);
      expect(e.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(e.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });
});

describe('nothing in the vault core serializes YAML (H2)', () => {
  it('has no dump( anywhere under src/harness/vault', () => {
    const dir = join(HERE, '..', 'src', 'harness', 'vault');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('frontmatter.ts');
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      // YAML is never written back. The index's own file format is JSON, so
      // JSON.stringify is allowed; any other stringify (a YAML one) is not.
      expect(src, f).not.toMatch(/\bdump\s*\(|safeDump|(?<!JSON\.)\bstringify\s*\(/);
    }
  });
});

describe('the search grammar (K8, CX X1 and X2)', () => {
  const clause = (kind: string, value: string, negated = false) => ({ kind, value, negated });
  const marked = (text: string, q: string) =>
    highlightRanges(text, parseVaultQuery(q)).map((r) => text.slice(r.start, r.end));

  it('reads bare words as terms, folded, and the last open word as the prefix', () => {
    expect(parseVaultQuery('Budget  PLAN ')).toEqual({
      clauses: [clause('term', 'budget'), clause('term', 'plan')],
      filtersOnly: false,
    });
    expect(parseVaultQuery('budget pla')).toEqual({
      clauses: [clause('term', 'budget')],
      prefix: 'pla',
      filtersOnly: false,
    });
    expect(parseVaultQuery('Ｆｕｌｌ').prefix).toBe('full');
  });

  it('reads tag:, tag:#, and #x as one tag clause, without the #', () => {
    expect(parseVaultQuery('tag:Idea ').clauses).toEqual([clause('tag', 'idea')]);
    expect(parseVaultQuery('tag:#idea/sub').clauses).toEqual([clause('tag', 'idea/sub')]);
    expect(parseVaultQuery('#idea').clauses).toEqual([clause('tag', 'idea')]);
    expect(parseVaultQuery('#idea').prefix).toBeUndefined();
  });

  it('reads path: and file:, a quoted value, and an operator in any case', () => {
    expect(parseVaultQuery('path:Work/Plans FILE:budget.md').clauses).toEqual([
      clause('path', 'work/plans'),
      clause('file', 'budget.md'),
    ]);
    expect(parseVaultQuery('path:"My  Notes/Q3" x').clauses).toEqual([
      clause('path', 'my notes/q3'),
    ]);
  });

  it('reads a quoted phrase, whitespace folded, and an unclosed one to the end', () => {
    expect(parseVaultQuery('"Exact   Phrase" more ').clauses).toEqual([
      clause('phrase', 'exact phrase'),
      clause('term', 'more'),
    ]);
    expect(parseVaultQuery('"still typ').clauses).toEqual([clause('phrase', 'still typ')]);
    expect(parseVaultQuery('"still typ').prefix).toBeUndefined();
  });

  it('negates any clause with a leading -, and a negated word is never the prefix', () => {
    expect(parseVaultQuery('-draft -tag:old -path:Archive -file:tmp -"not this"').clauses).toEqual([
      clause('term', 'draft', true),
      clause('tag', 'old', true),
      clause('path', 'archive', true),
      clause('file', 'tmp', true),
      clause('phrase', 'not this', true),
    ]);
    expect(parseVaultQuery('plan -draft').prefix).toBeUndefined();
    // A lone dash is a plain word.
    expect(parseVaultQuery('a - b ').clauses.map((c) => c.value)).toEqual(['a', '-', 'b']);
  });

  it('reads anything else, foo:bar and v1 non-operators included, as plain terms', () => {
    for (const q of ['foo:bar ', 'line:3 ', 'section:x ', 'task:todo ', 'a OR b ', '(x) ']) {
      expect(
        parseVaultQuery(q).clauses.every((c) => c.kind === 'term'),
        q,
      ).toBe(true);
    }
  });

  it('marks a query with no positive word or phrase as filters only', () => {
    expect(parseVaultQuery('tag:idea -draft').filtersOnly).toBe(true);
    expect(parseVaultQuery('tag:idea plan').filtersOnly).toBe(false);
    expect(parseVaultQuery('tag:idea "a b"').filtersOnly).toBe(false);
    expect(parseVaultQuery('').filtersOnly).toBe(false);
    expect(parseVaultQuery('   ').clauses).toEqual([]);
    // An operator with no value yet (typing) is dropped.
    expect(parseVaultQuery('tag:').clauses).toEqual([]);
  });

  it('never throws on hostile input', () => {
    for (const q of [
      '"',
      '-',
      '--',
      '-"',
      'tag:"',
      '#',
      '##',
      '\u0000',
      '🚀'.repeat(9),
      'x'.repeat(10_000),
    ]) {
      expect(() => parseVaultQuery(q), q).not.toThrow();
    }
  });

  it('highlights whole words, the prefix at a word start, and phrases', () => {
    expect(marked('The Plan, planning and a plan.', 'plan ')).toEqual(['Plan', 'plan']);
    expect(marked('The Plan, planning and a plan.', 'pla')).toEqual(['Plan', 'planning', 'plan']);
    expect(marked('see an exact   Phrase here', '"exact phrase"')).toEqual(['exact   Phrase']);
    expect(marked('no marks here', '-no tag:marks')).toEqual([]);
  });

  it('returns ranges in order, merged where they overlap, on the original offsets', () => {
    const text = 'Ｆｕｌｌ width café budget';
    const got = highlightRanges(text, parseVaultQuery('"full width" café'));
    expect(got.map((r) => text.slice(r.start, r.end))).toEqual(['Ｆｕｌｌ width', 'café']);
    const overlap = highlightRanges('big plan here', parseVaultQuery('"big plan" plan '));
    expect(overlap).toEqual([{ start: 0, end: 8 }]);
    expect(marked('東京都に行く', '京都 ')).toEqual(['京都']);
  });

  it('verifies phrases on a body, the check the index leaves to the host', () => {
    const body = 'We agreed on the Exact\nphrase yesterday.';
    expect(phrasesMatch(body, parseVaultQuery('"exact phrase"'))).toBe(true);
    expect(phrasesMatch(body, parseVaultQuery('"phrase exact"'))).toBe(false);
    expect(phrasesMatch(body, parseVaultQuery('-"exact phrase"'))).toBe(false);
    expect(phrasesMatch(body, parseVaultQuery('plan'))).toBe(true);
  });
});

// Vault M7, stream B (CTO L9, L10): provenance as flat `oscode-*` lines,
// merged into the note's text byte for byte.
describe('M7 stream B: provenance (L9, L10)', () => {
  const SET = {
    'oscode-source': 'agent',
    'oscode-model': 'qwen2.5-coder:7b',
    'oscode-where': 'local',
    'oscode-size': 'small',
    'oscode-created': '2026-09-27T10:00:00.000Z',
  } as const;
  const PROV_LINE =
    /^oscode-(?:source|model|where|size|provider|created|reviewed): "[^"\r\n]*"\r?\n/gm;

  function merged(text: string, fields: Parameters<typeof mergeProvenance>[1]): string {
    const r = mergeProvenance(text, fields);
    if (!('text' in r)) throw new Error(`skipped: ${r.skipped}`);
    return r.text;
  }

  const others = (text: string) =>
    readFrontmatter(text).props.filter((p) => !p.key.startsWith('oscode-'));

  // Each fixture holds no provenance yet; the merge must add only its lines.
  const FIXTURES: Record<string, string> = {
    simple: '---\ntitle: Plan\n---\nbody\n',
    comments:
      '---\n# top comment\ntitle: Plan # trailing\n\n# another\ntags:\n  - a\n  - b\n# last\n---\n# Heading\n',
    'compact lists': '---\ntags:\n- a\n- b\naliases: [x, y]\n---\nbody',
    'quoted keys': '---\n"quoted key": 1\n\'single\': two\n"oscode-note": keep\n---\n',
    crlf: '---\r\ntitle: Plan\r\ntags:\r\n  - a\r\n---\r\nbody\r\nmore\r\n',
    bom: '\ufeff---\ntitle: Plan\n---\nbody\n',
    'bom and crlf': '\ufeff---\r\ntitle: Plan\r\n---\r\nbody\r\n',
    'flow maps': '---\nmeta: {a: 1, b: [2, 3]}\nlist: [ {x: 1}, {y: 2} ]\n---\n',
    'block scalar': '---\nnote: |\n  line one\n\n  line two\nfolded: >-\n  a\n  b\n---\n',
    'keep-chomped scalar last': '---\nnote: |+\n  kept\n\n---\nbody\n',
    marks: '---\noscode: local-only\ntitle: T\n---\n',
    'marks as a list': '---\noscode: [exclude, local-only]\n---\n',
    'closing with trailing spaces': '---\ntitle: T\n---  \t\nbody\n',
    'opening with trailing spaces': '--- \ntitle: T\n---\n',
    empty: '---\n---\nbody\n',
    'only a comment': '---\n# nothing here\n---\n',
    'closing at end of text': '---\ntitle: T\n---',
    'dates and numbers': '---\ndate: 2026-01-01\ncount: 007\nflag: yes\nnothing: ~\n---\n',
    anchors: '---\nbase: &b {k: 1}\nref: *b\n---\n',
    'unicode and tabs': '---\ntitle: "Café \\t ünïcode"\nemoji: "\u{1F30A}"\n---\n',
    'body with a second block': '---\na: 1\n---\n---\nnot: frontmatter\n---\n',
    'mixed case lookalike': '---\nOscode-Model: theirs\nOSCODE: exclude\n---\n',
  };

  for (const [name, text] of Object.entries(FIXTURES)) {
    it(`keeps every other byte: ${name}`, () => {
      const out = merged(text, SET);
      // Taking the provenance lines back out gives the note exactly.
      expect(out.replace(PROV_LINE, '')).toBe(text);
      expect(others(out)).toEqual(others(text));
      expect(oscodeMarks(readFrontmatter(out))).toEqual(oscodeMarks(readFrontmatter(text)));
      const prov = readProvenance(readFrontmatter(out));
      expect(prov).toEqual({
        source: 'agent',
        model: 'qwen2.5-coder:7b',
        where: 'local',
        size: 'small',
        created: '2026-09-27T10:00:00.000Z',
      });
      // The block keeps the note's own line endings.
      if (text.includes('\r\n')) expect(out.replace(/\r\n/g, '')).not.toContain('\n');
      // A second merge with the same fields changes nothing.
      expect(merged(out, SET)).toBe(out);
    });
  }

  it('appends in the write order, before the closing line', () => {
    expect(merged('---\ntitle: Plan\n---\nbody\n', SET)).toBe(
      '---\ntitle: Plan\n' +
        'oscode-source: "agent"\n' +
        'oscode-model: "qwen2.5-coder:7b"\n' +
        'oscode-where: "local"\n' +
        'oscode-size: "small"\n' +
        'oscode-created: "2026-09-27T10:00:00.000Z"\n' +
        '---\nbody\n',
    );
    expect(PROV_KEYS).toEqual([
      'oscode-source',
      'oscode-model',
      'oscode-where',
      'oscode-size',
      'oscode-provider',
      'oscode-created',
      'oscode-reviewed',
    ]);
  });

  it('creates a block when there is none, after a BOM, in the note EOL', () => {
    const f = { 'oscode-source': 'agent', 'oscode-model': 'm' } as const;
    const lines = 'oscode-source: "agent"\noscode-model: "m"\n';
    expect(merged('', f)).toBe(`---\n${lines}---\n`);
    expect(merged('# Title\nbody\n', f)).toBe(`---\n${lines}---\n# Title\nbody\n`);
    expect(merged('\ufeff# T\n', f)).toBe(`\ufeff---\n${lines}---\n# T\n`);
    expect(merged('# T\r\nbody\r\n', f)).toBe(
      `---\r\n${lines.replace(/\n/g, '\r\n')}---\r\n# T\r\nbody\r\n`,
    );
    // An unclosed opener is body, and stays body.
    expect(merged('---\nnot closed\n', f)).toBe(`---\n${lines}---\n---\nnot closed\n`);
    // Nothing to set: the note is left as it was.
    expect(merged('# T\n', { 'oscode-reviewed': null })).toBe('# T\n');
    expect(merged('# T\n', {})).toBe('# T\n');
  });

  it('updates a key in place, continuation lines and all, and leaves unnamed keys alone', () => {
    const text =
      '---\ntitle: T\noscode-model: old-model\noscode-where:\n  local\nzeta: 1\noscode-created: 2026-01-01\n---\nbody\n';
    const out = merged(text, { 'oscode-model': 'new', 'oscode-where': 'cloud' });
    expect(out).toBe(
      '---\ntitle: T\noscode-model: "new"\noscode-where: "cloud"\nzeta: 1\noscode-created: 2026-01-01\n---\nbody\n',
    );
    expect(readProvenance(readFrontmatter(out))).toEqual({
      model: 'new',
      where: 'cloud',
      created: '2026-01-01',
    });
    // CRLF in place.
    const crlf = text.replace(/\n/g, '\r\n');
    expect(merged(crlf, { 'oscode-model': 'new', 'oscode-where': 'cloud' })).toBe(
      out.replace(/\n/g, '\r\n'),
    );
  });

  it('marks as reviewed, and marks as not reviewed, byte for byte', () => {
    const base = merged('---\n# mine\ntitle: T\n---\nbody\n', SET);
    const reviewed = merged(base, { 'oscode-reviewed': '2026-09-28T09:00:00.000Z' });
    expect(reviewed).toBe(
      base.replace('---\nbody', 'oscode-reviewed: "2026-09-28T09:00:00.000Z"\n---\nbody'),
    );
    expect(readProvenance(readFrontmatter(reviewed)).reviewed).toBe('2026-09-28T09:00:00.000Z');
    const again = merged(reviewed, { 'oscode-reviewed': '2026-09-29T09:00:00.000Z' });
    expect(again).toBe(reviewed.replace('2026-09-28', '2026-09-29'));
    expect(merged(reviewed, { 'oscode-reviewed': null })).toBe(base);
  });

  it('refuses malformed or oversized frontmatter, never making it worse', () => {
    expect(mergeProvenance('---\ntitle: [unclosed\n---\n', SET)).toEqual({ skipped: 'invalid' });
    expect(mergeProvenance('---\na: 1\na: 2\n---\n', SET)).toEqual({ skipped: 'invalid' });
    expect(mergeProvenance('---\n- a list\n---\n', SET)).toEqual({ skipped: 'invalid' });
    expect(mergeProvenance('---\njust a string\n---\n', SET)).toEqual({ skipped: 'invalid' });
    const big = `---\nbig: "${'x'.repeat(64 * 1024)}"\n---\n`;
    expect(mergeProvenance(big, SET)).toEqual({ skipped: 'too-large' });
  });

  it('skips on verify when a line edit would change another property', () => {
    // A quoted spelling of a provenance key is the person's own: appending
    // beside it would duplicate the key, so the merge proves nothing and skips.
    expect(mergeProvenance('---\n"oscode-model": theirs\n---\n', { 'oscode-model': 'm' })).toEqual({
      skipped: 'verify',
    });
    // A flow map continued onto a column-0 line that reads like a key.
    const flow = '---\nmeta: {a: 1,\n  oscode-model: 2}\n---\n';
    const r = mergeProvenance(flow, { 'oscode-model': 'm' });
    if ('text' in r) {
      expect(others(r.text)).toEqual(others(flow));
      expect(r.text.replace(PROV_LINE, '')).toBe(flow);
    }
    // A merge that grows the block past the cap is refused, not written.
    const edge = `---\nbig: "${'x'.repeat(64 * 1024 - 20)}"\n---\n`;
    expect(readFrontmatter(edge).state).toBe('ok');
    expect(mergeProvenance(edge, SET)).toEqual({ skipped: 'verify' });
  });

  it('never touches the oscode: marks, and the two readers never cross', () => {
    const text = '---\noscode: local-only\n---\n';
    const out = merged(text, { ...SET, 'oscode-reviewed': null });
    expect(out.startsWith('---\noscode: local-only\n')).toBe(true);
    expect(oscodeMarks(readFrontmatter(out))).toEqual(['local-only']);
    // readProvenance never reads `oscode:`; oscodeMarks never reads `oscode-*`.
    expect(readProvenance(readFrontmatter('---\noscode: agent\n---\n'))).toEqual({});
    expect(
      oscodeMarks(readFrontmatter('---\noscode-source: exclude\noscode-where: local-only\n---\n')),
    ).toEqual([]);
    // Removing every provenance key leaves the marks where they were.
    const cleared = merged(
      out,
      Object.fromEntries(PROV_KEYS.map((k) => [k, null])) as Record<string, null>,
    );
    expect(cleared).toBe(text);
  });

  it('writes any value as one safe line, and reads back only the right shapes', () => {
    const model = 'it\'s: {weird} - [model] # "quoted"\nsecond line\u2028';
    const out = merged('', { 'oscode-model': model });
    expect(out.split('\n')).toHaveLength(4);
    expect(readProvenance(readFrontmatter(out)).model).toBe(model);
    const fm = readFrontmatter(
      '---\noscode-source: robot\noscode-where: moon\noscode-size: huge\noscode-model: 7\noscode-created: yesterday\noscode-reviewed: ""\noscode-provider: acme\n---\n',
    );
    expect(readProvenance(fm)).toEqual({ provider: 'acme' });
  });

  describe('Crew run notes carry provenance (runNote.ts)', () => {
    const base: RunNoteFields = {
      routine: 'Morning review',
      project: 'app',
      model: 'qwen2.5-coder:7b',
      session: 's1',
      started: '2026-09-27T06:00:05.000Z',
      state: 'done',
      folder: 'Morning review',
    };

    it('writes crew, the model and the start, through the one merge', () => {
      const fm = readFrontmatter(runNoteFrontmatter(base));
      expect(fm.state).toBe('ok');
      expect(fm.keys.slice(-3)).toEqual(['oscode-source', 'oscode-model', 'oscode-created']);
      expect(readProvenance(fm)).toEqual({
        source: 'crew',
        model: 'qwen2.5-coder:7b',
        created: '2026-09-27T06:00:05.000Z',
      });
    });

    it('adds where, size and a cloud provider when the scheduler judged them', () => {
      const cloud = readFrontmatter(
        runNoteFrontmatter({
          ...base,
          provenance: { where: 'cloud', size: 'large', provider: 'anthropic' },
        }),
      );
      expect(readProvenance(cloud)).toMatchObject({
        source: 'crew',
        where: 'cloud',
        size: 'large',
        provider: 'anthropic',
      });
      const local = readFrontmatter(
        runNoteFrontmatter({ ...base, provenance: { where: 'local', provider: 'ollama' } }),
      );
      expect(readProvenance(local).provider).toBeUndefined();
      expect(readProvenance(local).where).toBe('local');
    });

    it("writes none when provenance is 'off'", () => {
      const fm = readFrontmatter(runNoteFrontmatter({ ...base, provenance: 'off' }));
      expect(fm.keys.some((k) => k.startsWith('oscode-'))).toBe(false);
    });
  });
});
