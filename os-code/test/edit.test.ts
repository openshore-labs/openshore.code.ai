// The edit engine: exact first, whitespace-tolerant second, context-anchored
// third, and ambiguity is ALWAYS a rejection, never a guess.
import { describe, expect, it } from 'vitest';
import { parseEditBlocks } from '../src/core/edit/searchReplace.js';
import { applyEditBlocks } from '../src/core/edit/apply.js';
import { unifiedDiff } from '../src/core/edit/diff.js';
import { structuralCheck } from '../src/core/edit/verify.js';

const FILE = [
  'function greet(name) {',
  '  console.log("hello " + name);',
  '}',
  '',
  'function farewell(name) {',
  '  console.log("bye " + name);',
  '}',
].join('\n');

function block(search: string, replace: string): string {
  return `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
}

describe('parseEditBlocks', () => {
  it('parses a well-formed block', () => {
    const { blocks, problems } = parseEditBlocks(block('a', 'b'));
    expect(problems).toEqual([]);
    expect(blocks).toEqual([{ search: 'a', replace: 'b' }]);
  });

  it('tolerates code fences around blocks', () => {
    const { blocks } = parseEditBlocks('```\n' + block('a', 'b') + '\n```');
    expect(blocks).toHaveLength(1);
  });

  it('parses multiple blocks and reports an unclosed one', () => {
    const text = `${block('a', 'b')}\n<<<<<<< SEARCH\nc\n=======\nd`;
    const { blocks, problems } = parseEditBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(problems.join(' ')).toContain('never closed');
  });
});

describe('applyEditBlocks', () => {
  it('applies an exact unique match', () => {
    const result = applyEditBlocks(FILE, [
      { search: '  console.log("hello " + name);', replace: '  console.log(`hello ${name}`);' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('`hello ${name}`');
    expect(result.applied[0]!.strategy).toBe('exact');
  });

  it('falls back to a whitespace-tolerant match', () => {
    const result = applyEditBlocks(FILE, [
      { search: 'console.log("hello " + name);', replace: 'console.log("hi " + name);' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('"hi "');
    expect(result.applied[0]!.strategy).toBe('trimmed');
  });

  it('anchors on surrounding context when the middle drifted', () => {
    const search = ['function greet(name) {', '  console.log("hello" + name);', '}'].join('\n');
    const result = applyEditBlocks(FILE, [
      { search, replace: ['function greet(name) {', '  console.info(name);', '}'].join('\n') },
    ]);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('console.info(name);');
    expect(result.applied[0]!.strategy).toBe('anchored');
    // The OTHER function is untouched: the anchor picked the right site.
    expect(result.content).toContain('console.log("bye " + name);');
  });

  it('REJECTS an ambiguous match instead of guessing', () => {
    const ambiguous = ['x();', 'x();'].join('\n');
    const result = applyEditBlocks(ambiguous, [{ search: 'x();', replace: 'y();' }]);
    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain('2 times');
    expect(result.content).toBe(ambiguous);
  });

  it('names the closest line when nothing matches', () => {
    const result = applyEditBlocks(FILE, [
      { search: 'console.log("helo " + name);', replace: 'x' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain('not found');
  });

  it('applies sequential blocks against the updated content', () => {
    const result = applyEditBlocks(FILE, [
      { search: '  console.log("hello " + name);', replace: '  console.log("hey " + name);' },
      { search: '  console.log("bye " + name);', replace: '  console.log("later " + name);' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('"hey "');
    expect(result.content).toContain('"later "');
  });

  it('deletes lines when the replace side is empty', () => {
    const result = applyEditBlocks(FILE, [{ search: '', replace: 'x' }]);
    expect(result.ok).toBe(false); // empty search is an instruction problem
    const del = applyEditBlocks('a\nb\nc', [{ search: 'b', replace: '' }]);
    expect(del.ok).toBe(true);
    expect(del.content).toBe('a\nc');
  });
});

describe('unifiedDiff', () => {
  it('produces a hunk with context and honest stats', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nb\nC\nd\ne';
    const { text, stats } = unifiedDiff(before, after, 'x.txt');
    expect(stats).toEqual({ additions: 1, deletions: 1 });
    expect(text).toContain('--- a/x.txt');
    expect(text).toContain('-c');
    expect(text).toContain('+C');
  });

  it('returns empty for identical content', () => {
    const { text, stats } = unifiedDiff('same', 'same', 'x');
    expect(text).toBe('');
    expect(stats).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('structuralCheck', () => {
  it('rejects JSON that no longer parses', () => {
    expect(structuralCheck('x.json', '{"a": ').ok).toBe(false);
    expect(structuralCheck('x.json', '{"a": 1}').ok).toBe(true);
  });

  it('flags unbalanced braces in brace languages', () => {
    expect(structuralCheck('x.ts', 'function f() { if (a) { }').ok).toBe(false);
    expect(structuralCheck('x.ts', 'function f() { if (a) { } }').ok).toBe(true);
  });

  it('ignores braces inside strings and comments', () => {
    expect(structuralCheck('x.ts', 'const s = "{{{"; // }\nconst t = 1;').ok).toBe(true);
  });
});
