// The Vault's frontmatter reader (Vault M3, CTO H2): js-yaml CORE_SCHEMA,
// read-only, bounded. Edge cases: BOM, CRLF, invalid YAML, a block over
// 64 KB, duplicate keys, alias bombs, `__proto__`, and tags and aliases in
// every shape people write them.
import { describe, expect, it } from 'vitest';
import { readFrontmatter } from '../src/protocol.js';

const fm = (yaml: string) => readFrontmatter(`---\n${yaml}\n---\nbody`);

/** Every value in a parsed tree, counted. */
function countValues(v: unknown): number {
  if (Array.isArray(v)) return 1 + v.reduce((n: number, x) => n + countValues(x), 0);
  if (v && typeof v === 'object') {
    return 1 + Object.values(v).reduce((n: number, x) => n + countValues(x), 0);
  }
  return 1;
}

describe('readFrontmatter (H2)', () => {
  it('answers none with no block', () => {
    expect(readFrontmatter('# Title\nbody')).toEqual({
      state: 'none',
      start: 0,
      end: 0,
      raw: '',
      props: [],
      tags: [],
      aliases: [],
      links: [],
      keys: [],
    });
    expect(readFrontmatter('---\na: 1\n').state).toBe('none');
  });

  it('reads props in order, dates as the typed strings', () => {
    const r = fm('title: Plan\ndate: 2026-09-27\ncount: 3\ndone: false\nnothing:\nlist: [1, two]');
    expect(r.state).toBe('ok');
    expect(r.keys).toEqual(['title', 'date', 'count', 'done', 'nothing', 'list']);
    expect(r.props).toEqual([
      { key: 'title', value: 'Plan' },
      { key: 'date', value: '2026-09-27' },
      { key: 'count', value: 3 },
      { key: 'done', value: false },
      { key: 'nothing', value: null },
      { key: 'list', value: [1, 'two'] },
    ]);
  });

  it('handles a BOM and CRLF, and the body starts where the block ends', () => {
    const text = '﻿---\r\ntitle: x\r\ntags: a, b\r\n---\r\nbody';
    const r = readFrontmatter(text);
    expect(r.state).toBe('ok');
    expect(r.start).toBe(1);
    expect(text.slice(r.end)).toBe('body');
    expect(r.tags).toEqual(['a', 'b']);
  });

  it('an empty block is ok with no props', () => {
    expect(readFrontmatter('---\n---\nbody')).toMatchObject({ state: 'ok', props: [], keys: [] });
  });

  it('invalid YAML is invalid with no props, as in Obsidian', () => {
    expect(fm('a: [unclosed')).toMatchObject({ state: 'invalid', props: [], keys: [] });
    expect(fm('a: b: c')).toMatchObject({ state: 'invalid', props: [] });
  });

  it('a duplicate key is invalid', () => {
    expect(fm('a: 1\na: 2')).toMatchObject({ state: 'invalid', props: [] });
  });

  it('a list or a scalar at the top is invalid (props need keys)', () => {
    expect(fm('- a\n- b').state).toBe('invalid');
    expect(fm('just text').state).toBe('invalid');
  });

  it('a block over 64 KB is too-large and never parsed', () => {
    const r = fm(`a: ${'x'.repeat(64 * 1024)}`);
    expect(r).toMatchObject({ state: 'too-large', props: [], tags: [] });
    expect(r.raw.length).toBeGreaterThan(64 * 1024);
    // Measured in UTF-8 bytes, not characters.
    expect(fm(`a: ${'é'.repeat(33 * 1024)}`).state).toBe('too-large');
    expect(fm(`a: ${'x'.repeat(60 * 1024)}`).state).toBe('ok');
  });

  it('an alias bomb is bounded to 1,000 values, fast', () => {
    const lines = ['a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol","lol"]'];
    const names = 'bcdefghi';
    let prev = 'a';
    for (const n of names) {
      lines.push(`${n}: &${n} [${Array(10).fill(`*${prev}`).join(',')}]`);
      prev = n;
    }
    const t0 = Date.now();
    const r = fm(lines.join('\n'));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.state).toBe('ok');
    const total = r.props.reduce((n, p) => n + countValues(p.value), 0);
    expect(total).toBeLessThanOrEqual(1000);
  });

  it('caps depth at 8', () => {
    let yaml = 'v';
    for (let i = 0; i < 20; i++) yaml = `[${yaml}]`;
    const r = fm(`deep: ${yaml}`);
    let v: unknown = r.props[0]!.value;
    let depth = 1;
    while (Array.isArray(v)) {
      v = v[0];
      depth++;
    }
    expect(v).toBeNull();
    expect(depth).toBeLessThanOrEqual(8);
  });

  it('a __proto__ key is a plain key on a null-prototype object', () => {
    const r = fm('__proto__:\n  polluted: true\nnested:\n  __proto__:\n    polluted: true');
    expect(r.state).toBe('ok');
    expect(r.keys).toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const nested = r.props.find((p) => p.key === 'nested')!.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(nested)).toBeNull();
    expect(Object.keys(nested)).toEqual(['__proto__']);
  });

  it('reads tags as a list or a comma string, # stripped, deduped by case', () => {
    expect(fm('tags: [a, "#b", 123, "#1x"]').tags).toEqual(['a', 'b', '1x']);
    expect(fm('tags: a, #b ,c').tags).toEqual(['a']);
    expect(fm('tags: "a, #b ,c"').tags).toEqual(['a', 'b', 'c']);
    expect(fm('tag: area/sub').tags).toEqual(['area/sub']);
    expect(fm('tags:\n  - Work\n  - work\n  - "#Home"').tags).toEqual(['Work', 'Home']);
    expect(fm('Tags: [x]').tags).toEqual(['x']);
    expect(fm('tags:').tags).toEqual([]);
  });

  it('reads aliases as a list or a comma string', () => {
    expect(fm('aliases: [One, Two]').aliases).toEqual(['One', 'Two']);
    expect(fm('alias: Three').aliases).toEqual(['Three']);
    expect(fm('aliases: "A, B"').aliases).toEqual(['A', 'B']);
  });

  it('carries the wikilinks in its string values', () => {
    const r = fm('related: "[[Plan#Goals|the plan]]"\nlist:\n  - "[[A]]"');
    expect(r.links.map((l) => [l.target, l.subpath, l.alias, l.where])).toEqual([
      ['Plan', 'Goals', 'the plan', 'frontmatter'],
      ['A', undefined, undefined, 'frontmatter'],
    ]);
  });

  it('never throws on anything', () => {
    for (const yaml of ['!!binary abc', '? complex\n: key', '&a *a', 'a: !!js/function x', '\t']) {
      expect(() => fm(yaml)).not.toThrow();
    }
  });
});
