// The Vault's note scanner (Vault M3, tech review H1): code is skipped (fences,
// spans, math, comments), the wikilink and markdown-link grammar, tags,
// headings, block ids, frontmatter bounds and the per-note caps. Documented
// divergences from Obsidian have their own rows.
import { describe, expect, it } from 'vitest';
import { findFrontmatter, scanInlineLinks, scanNote } from '../src/protocol.js';

const targets = (text: string) => scanNote(text).links.map((l) => l.target);

describe('code is skipped (H1)', () => {
  // [case, text, link targets found]
  const table: Array<[string, string, string[]]> = [
    ['a shell test in a fence is not a link', '```sh\n[[ -f x ]]\n```\n[[Real]]', ['Real']],
    ['a tilde fence', '~~~\n[[A]]\n~~~\n[[B]]', ['B']],
    ['a fence closes only on a run at least as long', '````\n```\n[[A]]\n````\n[[B]]', ['B']],
    ['a fence closes only on the same character', '```\n~~~\n[[A]]\n```\n[[B]]', ['B']],
    ['an unclosed fence runs to the end', 'x\n```\n[[A]]\n[[B]]', []],
    ['a fence inside a quote', '> ```\n> [[A]]\n> ```\n[[B]]', ['B']],
    ['an indented fence (a list item)', '- item\n   ```\n   [[A]]\n   ```\n[[B]]', ['B']],
    ['a backtick info string is not a fence', '``` a ` b\n[[A]]', ['A']],
    ['an inline code span', '`[[A]]` and [[B]]', ['B']],
    ['a double-backtick span holding a backtick', '``a ` [[A]]`` [[B]]', ['B']],
    ['an unmatched backtick is literal', 'a ` [[A]]', ['A']],
    ['a span never crosses a blank line', '`a\n\n[[A]] b`', ['A']],
    ['a span may cross one line break', '`a\n[[A]]` [[B]]', ['B']],
    ['an html comment', '<!-- [[A]] -->[[B]]', ['B']],
    ['an html comment over lines', '<!--\n[[A]]\n-->\n[[B]]', ['B']],
    ['an unclosed html comment hides the rest', '[[B]] <!-- [[A]]', ['B']],
    ['an inline %% comment', 'x %%[[A]]%% [[B]]', ['B']],
    ['a %% comment over lines', '%%\n[[A]]\n```\n%%\n[[B]]', ['B']],
    ['an unclosed %% hides the rest', '[[B]] %% [[A]]', ['B']],
    ['a $$ math block', '$$\n[[A]]\n$$\n[[B]]', ['B']],
    ['an unclosed $$ is literal (money, not math)', 'costs $$5 [[A]]', ['A']],
    ['an escaped bracket is no link', '\\[[A]] and [[B]]', ['B']],
    ['an escaped backtick opens no span', '\\`[[A]]` [[B]]', ['A', 'B']],
    ['a %% inside a fence is code', '```\n%%\n```\n[[B]]', ['B']],
    ['a fence inside a comment is comment', '%% ```\n%% [[B]]', ['B']],
    ['DIVERGENCE: indented code is NOT skipped', 'para\n\n    [[A]]', ['A']],
  ];
  it.each(table)('%s', (_name, text, want) => {
    expect(targets(text)).toEqual(want);
  });

  it('records what it skipped, in order', () => {
    const s = scanNote('`a` x\n```\ncode\n```\n%%c%% <!--h--> $$m$$');
    expect(s.skipped.map((r) => r.kind)).toEqual([
      'code-span',
      'fence',
      'comment',
      'html-comment',
      'math',
    ]);
  });

  it('stays linear on a note full of stray backticks', () => {
    const text = 'a ` b '.repeat(20000);
    const t0 = Date.now();
    scanNote(text);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('the wikilink grammar', () => {
  it('reads target, subpath, alias and embed with exact offsets', () => {
    const text = 'x ![[Folder/Plan#Goals|the plan]] y';
    const [l] = scanNote(text).links;
    expect(l).toMatchObject({
      kind: 'wiki',
      target: 'Folder/Plan',
      subpath: 'Goals',
      alias: 'the plan',
      embed: true,
      where: 'body',
      start: 2,
      end: text.indexOf(' y'),
    });
    expect(text.slice(l!.targetStart, l!.targetEnd)).toBe('Folder/Plan');
  });

  it('trims the target range, keeps a block subpath, and reads a self link', () => {
    const [a, b, c] = scanNote('[[ Plan ]] [[Plan#^blk-1]] [[#Heading]]').links;
    expect(a).toMatchObject({ target: 'Plan', targetStart: 3, targetEnd: 7 });
    expect(b?.subpath).toBe('^blk-1');
    expect(c).toMatchObject({ target: '', subpath: 'Heading' });
  });

  it('refuses [ ] | # ^ and line breaks in a target', () => {
    expect(targets('[[]] [[ ]] [[open')).toEqual([]);
    expect(targets('[[Note^x]] [[a\nb]]')).toEqual([]);
    expect(targets('[[[x]]]')).toEqual(['x']);
  });

  it('reads an escaped table pipe as the alias bar', () => {
    const [l] = scanNote('| [[Plan\\|p]] | [[Plan#H\\|q]] |').links;
    expect(l).toMatchObject({ target: 'Plan', alias: 'p' });
    expect(scanNote('| [[Plan#H\\|q]] |').links[0]).toMatchObject({ subpath: 'H', alias: 'q' });
  });

  it('keeps a hostile name Obsidian can link', () => {
    expect(targets('[[Decision: auth?]] [[café]]')).toEqual(['Decision: auth?', 'café']);
  });
});

describe('the markdown-link grammar', () => {
  it('decodes a note link and keeps its subpath and text', () => {
    const text = '[the plan](Ideas/Plan%20B.md#Goals "title")';
    const [l] = scanNote(text).links;
    expect(l).toMatchObject({
      kind: 'md',
      target: 'Ideas/Plan B.md',
      subpath: 'Goals',
      alias: 'the plan',
      embed: false,
    });
    expect(text.slice(l!.targetStart, l!.targetEnd)).toBe('Ideas/Plan%20B.md');
    expect(l!.attachment).toBeUndefined();
  });

  it('reads an angle destination and an extensionless one', () => {
    expect(targets('[a](<Plan B.md>) [b](../Plan)')).toEqual(['Plan B.md', '../Plan']);
  });

  it('marks an attachment, and an embed', () => {
    const [l] = scanNote('![pic](img/shot.png)').links;
    expect(l).toMatchObject({ target: 'img/shot.png', embed: true, attachment: true });
  });

  it('skips a scheme, //, and a #-only destination', () => {
    expect(targets('[w](https://x.com/a.md) [m](mailto:a@b) [p](//host/x) [h](#Goals)')).toEqual(
      [],
    );
  });

  it('keeps a bad percent escape as written', () => {
    expect(targets('[x](%E0%A4%A.md)')).toEqual(['%E0%A4%A.md']);
  });
});

describe('tags', () => {
  const tags = (text: string) => scanNote(text).tags.map((t) => t.tag);
  it('reads nested tags after whitespace, "(" or ","', () => {
    expect(tags('#top and #area/sub-1 (#paren),#comma é#no x#no')).toEqual([
      'top',
      'area/sub-1',
      'paren',
      'comma',
    ]);
  });
  it('needs a non-digit, and is never a heading', () => {
    expect(tags('#123 #1a # heading\n## H2')).toEqual(['1a']);
  });
  it('is never in code, a comment, or link text', () => {
    expect(tags('`#a` %%#b%% [[X|#c]] [#d](Y) \\#e\n```\n#f\n```')).toEqual([]);
  });
  it('reads unicode letters', () => {
    expect(tags('#café #日本')).toEqual(['café', '日本']);
  });
});

describe('headings and block ids', () => {
  it('reads ATX headings with line numbers, closing hashes dropped', () => {
    const s = scanNote('---\na: 1\n---\n# One #\ntext\n### Three ###\n####### seven\n#tag');
    expect(s.headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, 'One', 3],
      [3, 'Three', 5],
    ]);
  });
  it('reads a === setext heading; DIVERGENCE: a --- underline is ignored', () => {
    const s = scanNote('Title\n===\n\nOther\n---\n');
    expect(s.headings.map((h) => [h.level, h.text, h.line])).toEqual([[1, 'Title', 0]]);
  });
  it('reads no heading inside a fence or a comment', () => {
    expect(scanNote('```\n# Not\n```\n%%\n# Hidden\n%%').headings).toEqual([]);
  });
  it('reads block ids at the end of a line', () => {
    const text = 'para ^abc-1\n```\nx ^code\n```\nlast ^Z9   \n^alone\nbad ^under_score';
    const s = scanNote(text);
    expect(s.blockIds.map((b) => [b.id, b.line])).toEqual([
      ['abc-1', 0],
      ['Z9', 4],
    ]);
    expect(text.slice(s.blockIds[0]!.start, s.blockIds[0]!.end)).toBe('^abc-1');
  });
});

describe('frontmatter bounds', () => {
  it('opens only at index 0, after an optional BOM', () => {
    expect(findFrontmatter('---\na: 1\n---\nbody')).toMatchObject({ start: 0, raw: 'a: 1\n' });
    const bom = '﻿---\na: 1\n---\nbody';
    const fm = findFrontmatter(bom)!;
    expect(fm.start).toBe(1);
    expect(bom.slice(fm.end)).toBe('body');
    expect(findFrontmatter('\n---\na: 1\n---\n')).toBeNull();
    expect(findFrontmatter(' ---\na: 1\n---\n')).toBeNull();
  });
  it('accepts CRLF and trailing spaces on the delimiters', () => {
    const text = '--- \r\na: 1\r\n---\t\r\nbody';
    const fm = findFrontmatter(text)!;
    expect(fm.raw).toBe('a: 1\r\n');
    expect(text.slice(fm.end)).toBe('body');
  });
  it('is none when unclosed, and ends at the end of text without a break', () => {
    expect(findFrontmatter('---\na: 1\n')).toBeNull();
    expect(findFrontmatter('---')).toBeNull();
    const text = '---\na: 1\n---';
    expect(findFrontmatter(text)!.end).toBe(text.length);
    expect(findFrontmatter('---\n---\nbody')).toMatchObject({ raw: '', end: 8 });
  });
  it('scans frontmatter wikilinks as frontmatter, and skips YAML comments', () => {
    const s = scanNote(
      '---\nrel: "[[Plan]]"\n# [[Commented]]\nlist: ["[[A]]", "[[B]]"]\n---\n[[Body]]',
    );
    expect(s.links.map((l) => [l.target, l.where])).toEqual([
      ['Plan', 'frontmatter'],
      ['A', 'frontmatter'],
      ['B', 'frontmatter'],
      ['Body', 'body'],
    ]);
    expect(s.headings).toEqual([]);
  });
  it('never reads YAML as a heading or its # as a tag', () => {
    const s = scanNote('---\ntitle: x\n# comment\ntags: [a]\n---\n');
    expect(s.headings).toEqual([]);
    expect(s.tags).toEqual([]);
  });
});

describe('caps per note (H1)', () => {
  it('stops at 2,000 links, 500 tags, 1,000 headings and says so', () => {
    const text = [
      '[[L]] '.repeat(2100),
      '#t '.repeat(600),
      ...Array.from({ length: 1100 }, (_, i) => `# H${i}`),
    ].join('\n');
    const s = scanNote(text);
    expect(s.links).toHaveLength(2000);
    expect(s.tags).toHaveLength(500);
    expect(s.headings).toHaveLength(1000);
    expect(s.capped).toEqual({ links: true, tags: true, headings: true });
    expect(scanNote('[[a]]').capped).toEqual({ links: false, tags: false, headings: false });
  });
});

describe('scanInlineLinks (the renderer text-node pass)', () => {
  it('returns wikilinks and markdown links, skipping code and comments', () => {
    const links = scanInlineLinks('a `[[x]]` [[y|Y]] %%[[z]]%% [t](T.md) #tag');
    expect(links.map((l) => [l.kind, l.target])).toEqual([
      ['wiki', 'y'],
      ['md', 'T.md'],
    ]);
  });
  it('reads no block syntax: a fence line is just text', () => {
    expect(scanInlineLinks('```\n[[x]]').map((l) => l.target)).toEqual(['x']);
  });
});
