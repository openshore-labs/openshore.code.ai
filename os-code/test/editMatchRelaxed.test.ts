// The matcher forgives how a small model SPELLS a line, never where it lands.
// The deep eval's 3B seat, once it produced real blocks, still failed every
// edit with "The SEARCH text was not found": inside a JSON string it swaps
// quote styles (a backtick or double quote for a single quote) and spacing,
// exactly on lines like `return \`hello ${name}\`;`. Two bounded strategies
// cover that: a spelling-tolerant unique match, and anchoring on a unique
// first-and-last pair with the middle allowed to drift. Ambiguity stays an
// error in every case.
import { describe, it, expect } from 'vitest';
import { applyEditBlocks } from '../src/core/edit/apply.js';

const GREETER = ['export function oldName(name) {', '  return `hello ${name}`;', '}', ''].join(
  '\n',
);

const USER = [
  "import { oldName } from './greeter.mjs';",
  '',
  'export function greetWorld() {',
  "  return oldName('world');",
  '}',
  '',
].join('\n');

const TWO_FUNCS = [
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'export function subtract(a, b) {',
  '  return a + b;',
  '}',
  '',
].join('\n');

describe('spelling-tolerant match (strategy: normalized)', () => {
  it('forgives a quote style swap on a unique line', () => {
    const r = applyEditBlocks(USER, [
      {
        search: 'import { oldName } from "./greeter.mjs";',
        replace: "import { greet } from './greeter.mjs';",
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied[0]!.strategy).toBe('normalized');
    expect(r.content).toContain("import { greet } from './greeter.mjs';");
    expect(r.content).not.toContain('oldName } from');
  });

  it('forgives backticks written as quotes and extra spacing', () => {
    const r = applyEditBlocks(GREETER, [
      { search: "return  'hello ${name}';", replace: 'return `hello ${name}`;' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied[0]!.strategy).toBe('normalized');
  });

  it('still refuses when the spelling-tolerant run is not unique', () => {
    const r = applyEditBlocks(TWO_FUNCS, [{ search: 'return a + b;', replace: 'return a - b;' }]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]!.reason).toMatch(/matches 2 places/);
  });
});

describe('two unique anchors pin the location (strategy: anchored)', () => {
  it('applies a three-line block whose middle was badly transcribed', () => {
    const r = applyEditBlocks(GREETER, [
      {
        search: 'export function oldName(name) {\n  return "hello " + name;\n}',
        replace: 'export function greet(name) {\n  return `hello ${name}`;\n}',
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied[0]!.strategy).toBe('anchored');
    expect(r.content).toContain('export function greet(name) {');
    expect(r.content).not.toContain('oldName');
  });

  it('pins the right function when the first anchor is unique even though the last is not', () => {
    // "}" closes both functions, but "export function subtract(a, b) {" is
    // unique, and the only "}" at the right distance from it is its own.
    const r = applyEditBlocks(TWO_FUNCS, [
      {
        search: 'export function subtract(a, b) {\n  return a+b\n}',
        replace: 'export function subtract(a, b) {\n  return a - b;\n}',
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('export function add(a, b) {\n  return a + b;');
    expect(r.content).toContain('export function subtract(a, b) {\n  return a - b;');
  });

  it('refuses when both anchors match in more than one place and the middle is weak', () => {
    const r = applyEditBlocks(TWO_FUNCS, [
      { search: 'export function add(a, b) {\n  something else entirely\n}', replace: 'x' },
    ]);
    // "add" is unique, so this one pins; make the ambiguous case explicit with
    // a block whose anchors are both generic.
    expect(r.ok).toBe(true);
    const ambiguous = applyEditBlocks(TWO_FUNCS, [{ search: '{\n  nope\n}', replace: 'x' }]);
    expect(ambiguous.ok).toBe(false);
  });
});

describe('lines copied with readFile line numbers', () => {
  it('drops the "N| " prefix when every SEARCH line carries one', () => {
    const r = applyEditBlocks(TWO_FUNCS, [
      {
        search: '5| export function subtract(a, b) {\n6|   return a + b;\n7| }',
        replace: 'export function subtract(a, b) {\n  return a - b;\n}',
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied[0]!.strategy).toBe('exact');
    expect(r.content).toContain('export function subtract(a, b) {\n  return a - b;');
    expect(r.content).toContain('export function add(a, b) {\n  return a + b;');
  });

  it('leaves a single numbered line among plain ones alone', () => {
    const r = applyEditBlocks(TWO_FUNCS, [
      { search: '5| export function subtract(a, b) {\n  return a + b;', replace: 'x' },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe('a bare fragment, not a whole line, still pins uniquely (strategy: fragment)', () => {
  it('splices just the fragment when it occurs exactly once in the file', () => {
    // The deep eval's rename-across-files task: the model sent
    // "function oldName(" (part of a line, not the full
    // "export function oldName(name) {"), which no whole-line strategy above
    // can match at all.
    const r = applyEditBlocks(GREETER, [
      { search: 'function oldName(', replace: 'function greet(' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied[0]!.strategy).toBe('fragment');
    expect(r.content).toContain('export function greet(name) {');
    expect(r.content).not.toContain('oldName');
    expect(r.content).toContain('return `hello ${name}`;');
  });

  it('refuses a fragment that appears in more than one line', () => {
    // "(a, b) {" sits in both function signatures; neither the whole line nor
    // this fragment says which one, so it stays an error.
    const r = applyEditBlocks(TWO_FUNCS, [{ search: '(a, b) {', replace: '(a, b, c) {' }]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]!.reason).toMatch(/appears more than once/);
  });

  it('refuses a fragment that repeats within the same line', () => {
    const src = 'const pair = [addItem, addItem];\n';
    const r = applyEditBlocks(src, [{ search: 'addItem', replace: 'addWidget' }]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]!.reason).toMatch(/appears more than once/);
  });

  it('will not guess on a fragment below the minimum length, even if unique', () => {
    // "Name(" is a unique substring of "oldName(" but too short to trust as a
    // deliberate reference; it falls through to the ordinary not-found error
    // instead of splicing on a coincidence.
    const r = applyEditBlocks(GREETER, [{ search: 'Name(', replace: 'X(' }]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]!.reason).toMatch(/not found in the file/);
  });
});

describe('a multi-line block squished onto one line still pins the range (strategy: flattened)', () => {
  const CAPITALIZE = [
    'export function capitalize(s) {',
    '  return s.charAt(0).toUpperCase() + s.slice(1);',
    '}',
    '',
  ].join('\n');

  it('matches a real three-line block joined with spaces instead of newlines', () => {
    // The deep eval's 3B seat did close to this on the add-function task: the
    // three-line capitalize body joined with spaces instead of real line
    // breaks. No line-based strategy can ever line up a 1-line SEARCH against
    // 3 real lines, however tolerant of spelling; only comparing both sides
    // flattened finds it. (The eval's exact attempt also added a stray
    // semicolon the file does not have, which is a real content mismatch,
    // not a formatting one, and is correctly left unmatched, see the "will
    // not bridge an actual content difference" case below.)
    const r = applyEditBlocks(CAPITALIZE, [
      {
        search: 'export function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }',
        replace: [
          'export function capitalize(s) {',
          '  return s.charAt(0).toUpperCase() + s.slice(1);',
          '}',
          '',
          'export function shout(s) {',
          '  return s.toUpperCase() + "!";',
          '}',
        ].join('\n'),
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied[0]!.strategy).toBe('flattened');
    expect(r.content).toContain('export function shout(s) {');
    expect(r.content).toContain('export function capitalize(s) {');
  });

  it('refuses when the flattened text matches more than one place', () => {
    const twice = CAPITALIZE + CAPITALIZE;
    const r = applyEditBlocks(twice, [
      {
        search: 'export function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }',
        replace: 'x',
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]!.reason).toMatch(/matches 2 places/);
  });

  it('will not guess below the minimum flattened length', () => {
    const r = applyEditBlocks(CAPITALIZE, [{ search: 'capitalize(s) {', replace: 'x' }]);
    // Short enough to skip the flattened strategy, but still a real substring
    // of one line, so the plain single-line fragment strategy catches it.
    expect(r.ok).toBe(true);
    expect(r.applied[0]!.strategy).toBe('fragment');
  });

  it('will not bridge an actual content difference, only a formatting one', () => {
    // The deep eval's real SEARCH had a trailing ";" after the closing brace
    // that the file simply does not have anywhere: not a squished line break,
    // a genuine wrong character. Flattening forgives HOW the lines were
    // broken, never a fact about what the file contains, so this still
    // refuses rather than guess which brace the model meant.
    const r = applyEditBlocks(CAPITALIZE, [
      {
        search: 'export function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); };',
        replace: 'x',
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]!.reason).toMatch(/not found in the file/);
  });
});
