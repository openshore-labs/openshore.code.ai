// Obsidian markdown, the pure core (Vault M6, CTO K10, K11, K14, K15):
// callouts, highlights, comment masking, sections and block anchors, tasks and
// their write-back toggle, unlinked mentions, the outline, attachments (type,
// magic bytes, the pinned resolution order) and the link pick's replace
// range. The reader's rendering of each lives in the app's
// vaultMarkdown.test.tsx; these rows pin the text rules it rides on.
import { describe, expect, it } from 'vitest';
import {
  UNLINKED_MENTION_CAP,
  VAULT_ATTACHMENT_MAX_BYTES,
  attachmentLinkText,
  attachmentMime,
  blockAnchorAt,
  bytesMatchMime,
  findHighlights,
  findUnlinkedMentions,
  isAttachmentPath,
  listTasks,
  maskComments,
  outlineOf,
  parseCallout,
  resolveAttachment,
  sectionOf,
  toggleTaskAt,
  wikilinkContext,
  wikilinkReplaceRange,
} from '../src/protocol.js';

const slices = (text: string, ranges: Array<{ start: number; end: number }>) =>
  ranges.map((r) => text.slice(r.start, r.end));

describe('parseCallout (K10, CX X12)', () => {
  it.each([
    ['> [!note]', { type: 'note', family: 'neutral' }],
    ['> [!TIP] Try this', { type: 'tip', family: 'positive', title: 'Try this' }],
    [
      '>[!warning]- Folded shut',
      { type: 'warning', family: 'caution', fold: '-', title: 'Folded shut' },
    ],
    ['> > [!bug]+', { type: 'bug', family: 'danger', fold: '+' }],
    [
      '[!question] As the renderer sees it',
      { type: 'question', family: 'caution', title: 'As the renderer sees it' },
    ],
    ['> [!my-own] Custom', { type: 'my-own', family: 'neutral', title: 'Custom' }],
    ['> [!faq]', { type: 'faq', family: 'caution' }],
    ['> [!done]', { type: 'done', family: 'positive' }],
    ['> [!error]', { type: 'error', family: 'danger' }],
  ])('%s', (line, want) => {
    expect(parseCallout(line)).toEqual(want);
  });

  it.each([
    '> just a quote',
    '> [!]',
    '> [!two words]',
    '> [!note1]',
    `> [!${'a'.repeat(25)}]`,
    '> [!x<script>]',
    '    > [!note] (indented code)',
    'text [!note]',
  ])('refuses %s', (line) => {
    expect(parseCallout(line)).toBeNull();
  });

  it('reads only the first line of a multi-line node', () => {
    expect(parseCallout('[!info] Head\nbody line')).toEqual({
      type: 'info',
      family: 'neutral',
      title: 'Head',
    });
  });
});

describe('findHighlights (K10)', () => {
  it('finds ==spans== inside one text node', () => {
    const t = 'a ==one== b ==two words== c';
    expect(slices(t, findHighlights(t))).toEqual(['==one==', '==two words==']);
  });

  it('refuses empty, space-padded, and triple runs', () => {
    for (const t of ['====', '== x ==', 'a === b === c', 'x ==y', '==a\n\nb==']) {
      expect(findHighlights(t)).toEqual([]);
    }
  });

  it('may cross a single line break', () => {
    const t = '==a\nb== c';
    expect(slices(t, findHighlights(t))).toEqual(['==a\nb==']);
  });
});

describe('maskComments (K10)', () => {
  it('replaces comment characters with spaces, keeping length and line breaks', () => {
    const t = 'Keep %%hide me%% this.\r\n%%\nmulti\r\nline\n%% after';
    const m = maskComments(t);
    expect(m.length).toBe(t.length);
    expect(m).toBe(`Keep ${' '.repeat(11)} this.\r\n  \n     \r\n    \n   after`);
  });

  it('leaves %% inside code alone, and a note without comments as is', () => {
    const t = '`%%code%%`\n```\n%%fence%%\n```\n';
    expect(maskComments(t)).toBe(t);
    expect(maskComments('plain')).toBe('plain');
  });

  it('hides the rest of the note after an unclosed %%, as Obsidian renders it', () => {
    expect(maskComments('a %%b\nc')).toBe('a    \n ');
  });
});

describe('sectionOf (K10, K11)', () => {
  const note = [
    '---',
    'title: x',
    '---',
    '# Top',
    'intro',
    '## Goals',
    'g1',
    '### Detail',
    'd1',
    '## Risks',
    'r1',
    '```',
    '## Not a heading',
    '```',
    '',
  ].join('\n');

  it('runs from the heading to the next of the same or a higher level', () => {
    const r = sectionOf(note, 'Goals')!;
    expect(note.slice(r.start, r.end)).toBe('## Goals\ng1\n### Detail\nd1\n');
  });

  it('matches case and spaces loosely after an exact try, and runs to the end', () => {
    const r = sectionOf(note, '  risks ')!;
    expect(note.slice(r.start, r.end)).toBe('## Risks\nr1\n```\n## Not a heading\n```\n');
  });

  it('follows a nested path, and answers null for a heading in code or absent', () => {
    const r = sectionOf(note, 'Goals#Detail')!;
    expect(note.slice(r.start, r.end)).toBe('### Detail\nd1\n');
    expect(sectionOf(note, 'Risks#Detail')).toBeNull();
    expect(sectionOf(note, 'Not a heading')).toBeNull();
    expect(sectionOf(note, '')).toBeNull();
  });
});

describe('blockAnchorAt (K10, K11)', () => {
  it('takes the paragraph that ends in the anchor', () => {
    const t = 'Before.\n\nFirst line\nsecond line ^para1\n\nAfter.';
    const r = blockAnchorAt(t, 'para1')!;
    expect(t.slice(r.start, r.end)).toBe('First line\nsecond line ^para1');
  });

  it('takes one list item, with or without the caret, any case', () => {
    const t = '- one\n- two ^Item\n- three';
    const r = blockAnchorAt(t, '^item')!;
    expect(t.slice(r.start, r.end)).toBe('- two ^Item');
  });

  it('takes the block above an anchor alone on its line', () => {
    const t = 'x\n\n| a | b |\n| - | - |\n| 1 | 2 |\n^table1\n\ny';
    const r = blockAnchorAt(t, 'table1')!;
    expect(t.slice(r.start, r.end)).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n^table1');
  });

  it('stops at a heading above the paragraph, and ignores anchors in code', () => {
    const t = '# Head\nline ^h1\n```\ncode ^c1\n```';
    const r = blockAnchorAt(t, 'h1')!;
    expect(t.slice(r.start, r.end)).toBe('line ^h1');
    expect(blockAnchorAt(t, 'c1')).toBeNull();
    expect(blockAnchorAt(t, 'nope')).toBeNull();
  });
});

describe('listTasks and toggleTaskAt (K11)', () => {
  const note = [
    '---',
    'tasks: "- [ ] not a task"',
    '---',
    '- [ ] open',
    '  * [x] done',
    '1. [X] upper',
    '> - [/] custom in a quote',
    '- [ ]',
    '- [] no',
    '-[ ] no',
    '```',
    '- [ ] in a fence',
    '```',
    '%% - [ ] in a comment %%',
    '',
  ].join('\n');

  it('lists every task with its offset and line, frontmatter lines counted', () => {
    const tasks = listTasks(note);
    expect(tasks.map((t) => [t.line, t.status, t.checked, t.custom])).toEqual([
      [3, ' ', false, false],
      [4, 'x', true, false],
      [5, 'X', true, false],
      [6, '/', true, true],
      [7, ' ', false, false],
    ]);
    for (const t of tasks) expect(note[t.at]).toBe(t.status);
  });

  it('ticks and unticks, touching only the status byte', () => {
    const [open, done, upper] = listTasks(note);
    const r1 = toggleTaskAt(note, open!.at, ' ');
    expect(r1).toMatchObject({ ok: true, status: 'x' });
    if (r1.ok) {
      expect(r1.text.length).toBe(note.length);
      expect(r1.text.slice(0, open!.at) + ' ' + r1.text.slice(open!.at + 1)).toBe(note);
    }
    expect(toggleTaskAt(note, done!.at, 'x')).toMatchObject({ ok: true, status: ' ' });
    expect(toggleTaskAt(note, upper!.at, 'X')).toMatchObject({ ok: true, status: ' ' });
  });

  it('refuses a moved status, a custom status, and an offset with no task', () => {
    const [open, , , custom] = listTasks(note);
    expect(toggleTaskAt(note, open!.at, 'x')).toEqual({ ok: false, reason: 'moved' });
    expect(toggleTaskAt(note, custom!.at, '/')).toEqual({ ok: false, reason: 'custom' });
    expect(toggleTaskAt(note, 0, ' ')).toEqual({ ok: false, reason: 'none' });
    const fenced = note.indexOf('- [ ] in a fence') + 3;
    expect(toggleTaskAt(note, fenced, ' ')).toEqual({ ok: false, reason: 'none' });
  });

  it('keeps CRLF line ends', () => {
    const t = '- [ ] a\r\n- [ ] b\r\n';
    const [, b] = listTasks(t);
    expect(b!.line).toBe(1);
    const r = toggleTaskAt(t, b!.at, ' ');
    expect(r).toEqual({ ok: true, text: '- [ ] a\r\n- [x] b\r\n', status: 'x' });
  });
});

describe('findUnlinkedMentions (K15, 6.8)', () => {
  it('finds whole-word, case-insensitive mentions with their lines', () => {
    const t = 'Project Plan is due.\nThe project   plan slipped; plans differ; Planning too.';
    const found = findUnlinkedMentions(t, ['Project Plan']);
    expect(found.map((m) => [t.slice(m.start, m.end), m.line, m.name])).toEqual([
      ['Project Plan', 0, 'Project Plan'],
      ['project   plan', 1, 'Project Plan'],
    ]);
  });

  it('skips links, code, math, comments, tags, URLs and frontmatter', () => {
    const t = [
      '---',
      'about: Plan',
      '---',
      '[[Plan]] [Plan](Plan.md) `Plan` $$Plan$$ %%Plan%% <!-- Plan --> #Plan',
      'https://example.com/Plan and ![[Plan]]',
      '```',
      'Plan',
      '```',
      'Only this Plan counts.',
    ].join('\n');
    const found = findUnlinkedMentions(t, ['Plan']);
    expect(found).toHaveLength(1);
    expect(found[0]!.line).toBe(8);
  });

  it('matches every title and alias, the earlier and longer match winning an overlap', () => {
    const t = 'Q3 Roadmap, then the roadmap alone, and RM.';
    const found = findUnlinkedMentions(t, ['Roadmap', 'Q3 Roadmap', 'RM', 'roadmap', ' ']);
    expect(found.map((m) => [t.slice(m.start, m.end), m.name])).toEqual([
      ['Q3 Roadmap', 'Q3 Roadmap'],
      ['roadmap', 'Roadmap'],
      ['RM', 'RM'],
    ]);
  });

  it('holds word edges for non-Latin letters and names with punctuation', () => {
    const t = 'Café au lait, Cafés, café. C++ notes and C++.';
    expect(slices(t, findUnlinkedMentions(t, ['café']))).toEqual(['Café', 'café']);
    expect(slices(t, findUnlinkedMentions(t, ['C++']))).toEqual(['C++', 'C++']);
  });

  it('answers nothing for no names, and caps a long list', () => {
    expect(findUnlinkedMentions('Plan', [])).toEqual([]);
    const t = 'Plan '.repeat(UNLINKED_MENTION_CAP + 20);
    expect(findUnlinkedMentions(t, ['Plan'])).toHaveLength(UNLINKED_MENTION_CAP);
  });
});

describe('outlineOf (K15, CX X16)', () => {
  it('lists headings with depth capped at H3 and their index', () => {
    const t = '# A\n## B\n#### D\n```\n# code\n```\nC\n===\n';
    expect(outlineOf(t).map((h) => [h.text, h.level, h.depth, h.line, h.index])).toEqual([
      ['A', 1, 0, 0, 0],
      ['B', 2, 1, 1, 1],
      ['D', 4, 2, 2, 2],
      ['C', 1, 0, 6, 3],
    ]);
  });

  it('reads a 100 KB note inside the outline budget', () => {
    const t = Array.from(
      { length: 2000 },
      (_, k) => `## Heading ${k}\n${'word '.repeat(8)}\n`,
    ).join('');
    expect(t.length).toBeGreaterThan(100_000);
    const t0 = performance.now();
    expect(outlineOf(t)).toHaveLength(1000); // the scanner's heading cap
    expect(performance.now() - t0).toBeLessThan(5 * 4 * 10);
  });
});

describe('attachments: types and magic bytes (K11)', () => {
  it('names the type by extension, any case', () => {
    expect(attachmentMime('a/b.PNG')).toBe('image/png');
    expect(attachmentMime('x.jpg')).toBe('image/jpeg');
    expect(attachmentMime('x.jpeg')).toBe('image/jpeg');
    expect(attachmentMime('x.gif')).toBe('image/gif');
    expect(attachmentMime('x.webp')).toBe('image/webp');
    expect(attachmentMime('x.avif')).toBe('image/avif');
    expect(attachmentMime('x.svg')).toBe('image/svg+xml');
    expect(attachmentMime('x.pdf')).toBe('application/pdf');
    expect(attachmentMime('x.bmp')).toBeUndefined();
    expect(attachmentMime('x.md')).toBeUndefined();
    expect(attachmentMime('.png')).toBeUndefined();
    expect(attachmentMime('png')).toBeUndefined();
  });

  it.each([
    ['Assets/pic.png', true],
    ['pic.PDF', true],
    ['a b/c d.svg', true],
    ['/root.png', false],
    ['a\\b.png', false],
    ['.trash/pic.png', false],
    ['a/.hidden/pic.png', false],
    ['a/../pic.png', false],
    ['a//pic.png', false],
    ['pic.exe', false],
    ['note.md', false],
    ['', false],
    ['a/pic\u0000.png', false],
  ])('isAttachmentPath(%j) is %s', (p, want) => {
    expect(isAttachmentPath(p)).toBe(want);
  });

  const bytes = (...parts: Array<number[] | string>) =>
    new Uint8Array(
      parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );

  it('checks the rasters and PDF by their first bytes', () => {
    expect(bytesMatchMime(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png')).toBe(
      true,
    );
    expect(bytesMatchMime(bytes('PNG'), 'image/png')).toBe(false);
    expect(bytesMatchMime(bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(bytesMatchMime(bytes('GIF89a'), 'image/gif')).toBe(true);
    expect(bytesMatchMime(bytes('GIF87a'), 'image/gif')).toBe(true);
    expect(bytesMatchMime(bytes('GIF90a'), 'image/gif')).toBe(false);
    expect(bytesMatchMime(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '), 'image/webp')).toBe(true);
    expect(bytesMatchMime(bytes('RIFF', [1, 2, 3, 4], 'WAVE'), 'image/webp')).toBe(false);
    expect(
      bytesMatchMime(bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'mif1'), 'image/avif'),
    ).toBe(true);
    expect(
      bytesMatchMime(bytes([0, 0, 0, 0x1c], 'ftypmif1', [0, 0, 0, 0], 'miafavif'), 'image/avif'),
    ).toBe(true);
    expect(
      bytesMatchMime(bytes([0, 0, 0, 0x18], 'ftypisom', [0, 0, 0, 0], 'mp41'), 'image/avif'),
    ).toBe(false);
    expect(bytesMatchMime(bytes('%PDF-1.7\n'), 'application/pdf')).toBe(true);
    expect(bytesMatchMime(bytes('\n\n%PDF-1.4'), 'application/pdf')).toBe(true);
    expect(bytesMatchMime(bytes('<html>'), 'application/pdf')).toBe(false);
    // A PNG named .jpg is refused.
    expect(bytesMatchMime(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]), 'image/jpeg')).toBe(
      false,
    );
  });

  it('sniffs SVG past a BOM, the XML declaration, comments and a doctype', () => {
    expect(
      bytesMatchMime(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'),
    ).toBe(true);
    expect(
      bytesMatchMime(
        bytes(
          [0xef, 0xbb, 0xbf],
          '<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>',
        ),
        'image/svg+xml',
      ),
    ).toBe(true);
    expect(bytesMatchMime(bytes('<html><svg>'), 'image/svg+xml')).toBe(false);
    expect(bytesMatchMime(bytes('<svg', [0], '>'), 'image/svg+xml')).toBe(false);
  });

  it('caps an attachment at 20 MB', () => {
    expect(VAULT_ATTACHMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('resolveAttachment: the pinned order (K11)', () => {
  const paths = [
    'pic.png',
    'Notes/pic.png',
    'Notes/Sub/only-sub.png',
    'Attachments/shot.png',
    'Notes/Assets/shot.png',
    'Deep/A/B/shot.png',
    'Other/shot.png',
    'Docs/Report.pdf',
    'Notes/Home.md',
  ];

  it('1. the exact vault path wins, case folded, exact case first', () => {
    expect(resolveAttachment('pic.png', 'Notes/Home.md', paths)).toBe('pic.png');
    expect(resolveAttachment('docs/report.PDF', 'Home.md', paths)).toBe('Docs/Report.pdf');
    expect(resolveAttachment('A.png', 'x.md', ['a.png', 'A.png'])).toBe('A.png');
  });

  it('2. then relative to the source, with .. resolved and never above the root', () => {
    expect(resolveAttachment('Sub/only-sub.png', 'Notes/Home.md', paths)).toBe(
      'Notes/Sub/only-sub.png',
    );
    expect(resolveAttachment('./pic.png', 'Notes/Home.md', paths)).toBe('Notes/pic.png');
    expect(resolveAttachment('../pic.png', 'Notes/Home.md', paths)).toBe('pic.png');
    expect(resolveAttachment('../../pic.png', 'Notes/Home.md', paths)).toBeUndefined();
    // An explicitly relative miss does not fall through to the basename.
    expect(resolveAttachment('./shot.png', 'Home.md', paths)).toBeUndefined();
  });

  it('3. then the attachmentFolderPath setting', () => {
    expect(resolveAttachment('shot.png', 'Home.md', paths, 'Attachments')).toBe(
      'Attachments/shot.png',
    );
    expect(resolveAttachment('shot.png', 'Notes/Home.md', paths, './Assets')).toBe(
      'Notes/Assets/shot.png',
    );
    expect(resolveAttachment('shot.png', 'Deep/A/B/x.md', paths, './')).toBe('Deep/A/B/shot.png');
  });

  it("4. then Obsidian's basename order: own folder, fewest segments, shortest, code point", () => {
    expect(resolveAttachment('shot.png', 'Other/x.md', paths)).toBe('Other/shot.png');
    expect(resolveAttachment('shot.png', 'Home.md', paths, '/')).toBe('Other/shot.png');
    expect(resolveAttachment('B/shot.png', 'Home.md', paths)).toBe('Deep/A/B/shot.png');
  });

  it('strips a subpath or size, decodes a percent-encoded destination, and refuses the rest', () => {
    expect(resolveAttachment('Docs/Report.pdf#page=3', 'x.md', paths)).toBe('Docs/Report.pdf');
    expect(resolveAttachment('pic.png|300', 'x.md', paths)).toBe('pic.png');
    expect(resolveAttachment('A%20B.png', 'x.md', ['A B.png'])).toBe('A B.png');
    expect(resolveAttachment('<A B.png>', 'x.md', ['A B.png'])).toBe('A B.png');
    expect(resolveAttachment('https://example.com/pic.png', 'x.md', paths)).toBeUndefined();
    expect(resolveAttachment('data:image/png;base64,AAAA', 'x.md', paths)).toBeUndefined();
    expect(resolveAttachment('Home', 'x.md', paths)).toBeUndefined();
    expect(resolveAttachment('Notes/Home.md', 'x.md', paths)).toBeUndefined();
    expect(resolveAttachment('.trash/pic.png', 'x.md', ['.trash/pic.png'])).toBeUndefined();
  });

  it('writes the shortest embed text that names only that attachment', () => {
    expect(attachmentLinkText('Docs/Report.pdf', 'x.md', paths)).toBe('Report.pdf');
    expect(attachmentLinkText('Other/shot.png', 'Other/x.md', paths)).toBe('Other/shot.png');
    expect(attachmentLinkText('Notes/Sub/only-sub.png', 'x.md', paths)).toBe('only-sub.png');
    expect(attachmentLinkText('Deep/A/B/shot.png', 'x.md', paths)).toBe('B/shot.png');
    expect(attachmentLinkText('A#1.png', 'x.md', ['A#1.png'])).toBeUndefined();
  });
});

describe('wikilinkReplaceRange (K14, 6.7)', () => {
  const range = (text: string, caret: number) => {
    const ctx = wikilinkContext(text, caret)!;
    const r = wikilinkReplaceRange(text, ctx);
    return [text.slice(r.start, r.end), text.slice(r.end)];
  };

  it('replaces from [[ to the caret when nothing follows', () => {
    expect(range('See [[Pla', 9)).toEqual(['[[Pla', '']);
  });

  it('replaces through an existing ]] and the rest of the target', () => {
    const t = 'See [[Plan]] now';
    expect(range(t, 8)).toEqual(['[[Plan]]', ' now']);
  });

  it('stops before an existing | so the alias is kept', () => {
    const t = 'See [[Pl old|the plan]] now';
    expect(range(t, 8)).toEqual(['[[Pl old', '|the plan]] now']);
  });

  it('keeps a #subpath unless the query is already completing one', () => {
    const t = '[[Pla#Goals]] x';
    expect(range(t, 5)).toEqual(['[[Pla', '#Goals]] x']);
    const h = '[[Plan#Go]] x';
    expect(range(h, 9)).toEqual(['[[Plan#Go]]', ' x']);
  });

  it('never swallows words after the caret when the link does not close', () => {
    expect(range('[[Pla and more text\nnext]]', 5)).toEqual(['[[Pla', ' and more text\nnext]]']);
    expect(range('[[Pla then [[Other]]', 5)).toEqual(['[[Pla', ' then [[Other]]']);
    expect(range('| [[Pla | cell |', 7)).toEqual(['[[Pla', ' | cell |']);
    expect(range('[[Pla]', 5)).toEqual(['[[Pla', ']']);
  });

  it('keeps the embed ! outside the range', () => {
    const t = '![[pic]]';
    const ctx = wikilinkContext(t, 5)!;
    expect(ctx.embed).toBe(true);
    expect(wikilinkReplaceRange(t, ctx)).toEqual({ start: 1, end: 8 });
  });
});
