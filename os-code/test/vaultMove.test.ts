// Link rewrites for a set of moves (Vault M6, tech review K4 with R1): the pure plan.
// A link is spliced only when it would no longer reach the note it should, so
// aliases, headings, block references and the embed `!` stay byte for byte;
// a moved note's own relative links follow it; collateral links a new name
// would steal are pinned to their old note; attachments follow a folder move;
// and the plan counts what the "Update N links in M notes?" sheet shows.
import { describe, expect, it } from 'vitest';
import {
  buildPathIndex,
  planLinkRewrites,
  rewriteForMoves,
  rewriteLinks,
} from '../src/protocol.js';

function indexes(paths: string[], moves: Map<string, string>) {
  return {
    before: buildPathIndex(paths),
    after: buildPathIndex(paths.map((p) => moves.get(p) ?? p)),
  };
}

const same = (p: string) => ({ before: p, after: p });

describe('rewriteForMoves (K4)', () => {
  it('changes only the target, keeping alias, heading, block and embed', () => {
    const moves = new Map([['Plan.md', 'Plan B.md']]);
    const { before, after } = indexes(['Plan.md', 'Home.md', 'Other.md'], moves);
    const text = 'See [[Plan#Goals|the plan]], ![[Plan]], [[Plan#^b1]] and [[Other]].\n';
    expect(rewriteForMoves(text, same('Home.md'), moves, before, after)).toEqual({
      text: 'See [[Plan B#Goals|the plan]], ![[Plan B]], [[Plan B#^b1]] and [[Other]].\n',
      count: 3,
    });
  });

  it('leaves a link that still reaches the moved note, byte for byte', () => {
    const moves = new Map([['Plan.md', 'Archive/Plan.md']]);
    const { before, after } = indexes(['Plan.md', 'Home.md'], moves);
    const text = '[[Plan]] [[plan|x]] ![[Plan#H]]';
    expect(rewriteForMoves(text, same('Home.md'), moves, before, after)).toEqual({
      text,
      count: 0,
    });
  });

  it('rewrites a path-qualified link to the shortest text that reaches the note', () => {
    const moves = new Map([['Notes/Plan.md', 'Archive/Plan.md']]);
    const { before, after } = indexes(['Notes/Plan.md', 'Home.md'], moves);
    const r = rewriteForMoves(
      '[[Notes/Plan|p]] [[Notes/Plan.md]]',
      same('Home.md'),
      moves,
      before,
      after,
    );
    expect(r).toEqual({ text: '[[Plan|p]] [[Plan.md]]', count: 2 });
  });

  it("follows a moved note's own relative markdown links, only where they would break", () => {
    const moves = new Map([['Notes/Home.md', 'Archive/Deep/Home.md']]);
    const { before, after } = indexes(
      [
        'Notes/Home.md',
        'Notes/Plan.md',
        'Notes/Plan B.md',
        'Alpha/Plan.md',
        'Alpha/Plan B.md',
        'Notes/Log.md',
      ],
      moves,
    );
    // Log.md is unique, so the name still finds it from anywhere: left alone.
    const text =
      '[a](Plan.md) [b](Plan%20B.md#Goals) [c](<Plan B.md>) [d](Plan) [e](./Log.md) [f](Log.md) [[Plan]]\n';
    const r = rewriteForMoves(
      text,
      { before: 'Notes/Home.md', after: 'Archive/Deep/Home.md' },
      moves,
      before,
      after,
    );
    expect(r).toEqual({
      text:
        '[a](../../Notes/Plan.md) [b](../../Notes/Plan%20B.md#Goals) ' +
        '[c](<../../Notes/Plan B.md>) [d](../../Notes/Plan) [e](../../Notes/Log.md) [f](Log.md) ' +
        '[[Notes/Plan]]\n',
      count: 6,
    });
  });

  it('pins a collateral link that a moved note would steal', () => {
    // [[Plan]] from Notes/ reaches Archive/Plan.md by suffix; once Idea moves
    // to Notes/Plan.md, the relative step would take it.
    const moves = new Map([['Notes/Idea.md', 'Notes/Plan.md']]);
    const { before, after } = indexes(
      ['Archive/Plan.md', 'Notes/Idea.md', 'Notes/Other.md'],
      moves,
    );
    const r = rewriteForMoves(
      '[[Plan#H|x]] [[Idea]]',
      same('Notes/Other.md'),
      moves,
      before,
      after,
    );
    // Two notes are named Plan now, so the moved one is written with its folder.
    expect(r).toEqual({ text: '[[Archive/Plan#H|x]] [[Notes/Plan]]', count: 2 });
  });

  it('never touches an unresolved link, even when a move makes it resolve', () => {
    const moves = new Map([['Plan.md', 'Plan B.md']]);
    const { before, after } = indexes(['Plan.md', 'Home.md'], moves);
    const text = '[[Plan B]] [[Nowhere]] [[#Local heading]]';
    expect(rewriteForMoves(text, same('Home.md'), moves, before, after).count).toBe(0);
  });

  it('skips code, math and comments, and keeps CRLF and the BOM', () => {
    const moves = new Map([['Plan.md', 'New.md']]);
    const { before, after } = indexes(['Plan.md', 'Home.md'], moves);
    const text =
      '﻿---\r\na: 1\r\n---\r\n`[[Plan]]` %%[[Plan]]%% [[Plan]]\r\n```\r\n[[Plan]]\r\n```\r\n';
    expect(rewriteForMoves(text, same('Home.md'), moves, before, after)).toEqual({
      text: '﻿---\r\na: 1\r\n---\r\n`[[Plan]]` %%[[Plan]]%% [[New]]\r\n```\r\n[[Plan]]\r\n```\r\n',
      count: 1,
    });
  });

  it('follows attachments in a folder move, wikilink and markdown alike', () => {
    const moves = new Map([
      ['Notes/Plan.md', 'Work/Plan.md'],
      ['Notes/img.png', 'Work/img.png'],
      ['Notes/sub/doc.pdf', 'Work/sub/doc.pdf'],
    ]);
    const { before, after } = indexes(
      ['Home.md', 'Notes/Plan.md', 'Notes/img.png', 'Notes/sub/doc.pdf', 'Other/img.png'],
      moves,
    );
    const text =
      '![](Notes/img.png) ![[Notes/img.png|300]] ![[Notes/sub/doc.pdf#page=2]] [p](Notes/Plan.md)\n';
    const r = rewriteForMoves(text, same('Home.md'), moves, before, after);
    expect(r).toEqual({
      text: '![](Work/img.png) ![[Work/img.png|300]] ![[doc.pdf#page=2]] [p](Work/Plan.md)\n',
      count: 4,
    });
  });

  it('keeps a bare attachment name that still reaches the moved file', () => {
    const moves = new Map([['Notes/diagram.png', 'Assets/diagram.png']]);
    const { before, after } = indexes(['Home.md', 'Notes/diagram.png'], moves);
    const text = '![[diagram.png]]';
    expect(rewriteForMoves(text, same('Home.md'), moves, before, after)).toEqual({
      text,
      count: 0,
    });
  });

  it('agrees with rewriteLinks, the one-move wrapper, on its own cases', () => {
    const b = ['Plan.md', 'Notes/Home.md'];
    const a = ['Archive/Plan (v2).md', 'Notes/Home.md'];
    const text = [
      '---',
      'related: "[[Plan]]"',
      '---',
      '[p](../Plan.md) [q](<../Plan.md>) [[Plan|shown]]',
      '',
    ].join('\n');
    const moves = new Map([['Plan.md', 'Archive/Plan (v2).md']]);
    const viaMoves = rewriteForMoves(
      text,
      same('Notes/Home.md'),
      moves,
      buildPathIndex(b),
      buildPathIndex(a),
    );
    const viaOne = rewriteLinks(text, 'Notes/Home.md', 'Plan.md', 'Archive/Plan (v2).md', b, a);
    expect(viaMoves).toEqual(viaOne);
    expect(viaMoves.count).toBe(4);
  });
});

describe('planLinkRewrites (K4, R1)', () => {
  const moves = new Map([
    ['Plan.md', 'Projects/Plan 2.md'],
    ['Notes/Home.md', 'Archive/Home.md'],
  ]);
  const paths = ['Plan.md', 'Notes/Home.md', 'Notes/Log.md', 'Notes/Untouched.md', 'Quoted.md'];
  const { before, after } = indexes(paths, moves);

  it('plans one edit per changed note, at its path after the moves, on its read version', () => {
    const plan = planLinkRewrites(moves, before, after, [
      // A moved note, named by its old path, with its own relative link.
      { path: 'Notes/Home.md', text: '[[Plan]] [log](./Log.md) [same](Log.md)', version: 'v-home' },
      { path: 'Notes/Log.md', text: '![[Plan#^b]] and [[Home|home]]', version: 'v-log' },
      { path: 'Notes/Untouched.md', text: '[[Log]] only', version: 'v-u' },
      // Listed twice by the host (a backlink and a collateral pick).
      { path: 'Notes/Log.md', text: '![[Plan#^b]] and [[Home|home]]', version: 'v-log' },
    ]);
    expect(plan).toEqual({
      edits: [
        {
          path: 'Archive/Home.md',
          base: 'v-home',
          text: '[[Plan 2]] [log](../Notes/Log.md) [same](Log.md)',
          count: 2,
        },
        { path: 'Notes/Log.md', base: 'v-log', text: '![[Plan 2#^b]] and [[Home|home]]', count: 1 },
      ],
      links: 3,
      notes: 2,
      left: [],
    });
  });

  it('accepts a moved note named by its new path', () => {
    const plan = planLinkRewrites(moves, before, after, [
      { path: 'Archive/Home.md', text: '[log](./Log.md)', version: 'v2' },
    ]);
    expect(plan.edits).toEqual([
      { path: 'Archive/Home.md', base: 'v2', text: '[log](../Notes/Log.md)', count: 1 },
    ]);
  });

  it('leaves a quoted frontmatter link that a quote in the new name would break', () => {
    const m = new Map([['Plan.md', "Rock 'n' roll.md"]]);
    const ix = indexes(['Plan.md', 'Quoted.md'], m);
    const plan = planLinkRewrites(m, ix.before, ix.after, [
      {
        path: 'Quoted.md',
        text: "---\nrel: '[[Plan]]'\nalso: '[[Plan]]'\n---\n[[Plan]]",
        version: 'q',
      },
    ]);
    expect(plan.edits).toEqual([
      {
        path: 'Quoted.md',
        base: 'q',
        text: "---\nrel: '[[Plan]]'\nalso: '[[Plan]]'\n---\n[[Rock 'n' roll]]",
        count: 1,
      },
    ]);
    expect(plan.left).toEqual([{ path: 'Quoted.md', reason: 'frontmatter-quote' }]);
  });

  it('leaves a link no wikilink can write as ambiguous', () => {
    const m = new Map([['Plan.md', 'C# notes.md']]);
    const ix = indexes(['Plan.md', 'Home.md'], m);
    const plan = planLinkRewrites(m, ix.before, ix.after, [
      { path: 'Home.md', text: '[[Plan]] and [md](Plan.md)', version: 'h' },
    ]);
    expect(plan.edits).toEqual([
      { path: 'Home.md', base: 'h', text: '[[Plan]] and [md](C%23%20notes.md)', count: 1 },
    ]);
    expect(plan.left).toEqual([{ path: 'Home.md', reason: 'ambiguous' }]);
  });

  it('answers an empty plan when nothing needs to change', () => {
    expect(planLinkRewrites(moves, before, after, [])).toEqual({
      edits: [],
      links: 0,
      notes: 0,
      left: [],
    });
  });

  it('plans 50 sources over a 5,000-note vault well inside the budget', () => {
    const many = Array.from({ length: 5000 }, (_, k) => `F${k % 50}/Note ${k}.md`);
    const m = new Map([['F0/Note 0.md', 'Moved/Note zero.md']]);
    const ix = indexes(many, m);
    const sources = Array.from({ length: 50 }, (_, k) => ({
      path: `F${k}/Note ${k + 50}.md`,
      text: `Intro.\n${'Some words here. '.repeat(40)}\n[[Note 0]] and [[F0/Note 0#H|x]]\n`,
      version: `v${k}`,
    }));
    const t0 = performance.now();
    const plan = planLinkRewrites(m, ix.before, ix.after, sources);
    const ms = performance.now() - t0;
    expect(plan.notes).toBe(50);
    expect(plan.links).toBe(100);
    expect(plan.edits[0]!.text).toContain('[[Note zero]] and [[Note zero#H|x]]');
    expect(ms).toBeLessThan(300 * 4);
  });
});
