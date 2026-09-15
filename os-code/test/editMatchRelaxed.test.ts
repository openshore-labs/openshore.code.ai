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
