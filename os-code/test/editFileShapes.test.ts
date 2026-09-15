// editFile accepts the shapes small models actually produce, and they all land
// through the same matcher. The deep eval's 3B seat never once produced the
// SEARCH/REPLACE mini-language inside a JSON string; a flat search/replace
// pair is the shape it can get right, and the aliases other tools taught
// models (old_string/new_string and friends), a JSON array of pairs, that
// array stringified, and shortened or renamed markers all normalize to the
// same blocks. Nothing here loosens WHERE an edit lands.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, toolTurn, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { parseEditBlocks } from '../src/core/edit/searchReplace.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const MATH = [
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'export function subtract(a, b) {',
  '  return a + b;',
  '}',
  '',
].join('\n');

const FIXED = MATH.replace(
  'export function subtract(a, b) {\n  return a + b;',
  'export function subtract(a, b) {\n  return a - b;',
);

async function runEdit(args: Record<string, unknown>) {
  const provider = new MockProvider('mock', [toolTurn('editFile', args), textTurn('Fixed.')]);
  const session = makeTestSession(provider, { files: { 'math.mjs': MATH } });
  await session.agent.run('fix subtract');
  const ends = session.events.filter((e) => e.type === 'tool-end') as Array<{
    result: { ok: boolean; content: string };
  }>;
  return { ok: ends[0]!.result.ok, content: ends[0]!.result.content, session };
}

const SEARCH = 'export function subtract(a, b) {\n  return a + b;\n}';
const REPLACE = 'export function subtract(a, b) {\n  return a - b;\n}';

describe('editFile shapes: all roads lead to the same applied edit', () => {
  it('flat search and replace fields (the simple form)', async () => {
    const { ok, session } = await runEdit({ path: 'math.mjs', search: SEARCH, replace: REPLACE });
    expect(ok).toBe(true);
    expect(readFileSync(join(session.cwd, 'math.mjs'), 'utf8')).toBe(FIXED);
  });

  it('old_string and new_string aliases', async () => {
    const { ok, session } = await runEdit({
      path: 'math.mjs',
      old_string: SEARCH,
      new_string: REPLACE,
    });
    expect(ok).toBe(true);
    expect(readFileSync(join(session.cwd, 'math.mjs'), 'utf8')).toBe(FIXED);
  });

  it('edits as a real array of pairs', async () => {
    const { ok, session } = await runEdit({
      path: 'math.mjs',
      edits: [{ search: SEARCH, replace: REPLACE }],
    });
    expect(ok).toBe(true);
    expect(readFileSync(join(session.cwd, 'math.mjs'), 'utf8')).toBe(FIXED);
  });

  it('edits as a stringified JSON array of pairs (find/replace spelling)', async () => {
    const { ok, session } = await runEdit({
      path: 'math.mjs',
      edits: JSON.stringify([{ find: SEARCH, replace: REPLACE }]),
    });
    expect(ok).toBe(true);
    expect(readFileSync(join(session.cwd, 'math.mjs'), 'utf8')).toBe(FIXED);
  });

  it('edits as text blocks with shortened, lowercase, ORIGINAL/UPDATED markers', async () => {
    const edits = `<<< original\n${SEARCH}\n===\n${REPLACE}\n>>> updated`;
    const { ok, session } = await runEdit({ path: 'math.mjs', edits });
    expect(ok).toBe(true);
    expect(readFileSync(join(session.cwd, 'math.mjs'), 'utf8')).toBe(FIXED);
  });

  it('the canonical seven-character markers still parse exactly as before', () => {
    const text = `<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE`;
    expect(parseEditBlocks(text).blocks).toEqual([{ search: 'a', replace: 'b' }]);
  });

  it('nothing recognizable still fails, honestly, and names the simple form', async () => {
    const { ok, content } = await runEdit({ path: 'math.mjs', edits: 'please fix subtract' });
    expect(ok).toBe(false);
    expect(content).toContain('No valid edit found');
    expect(content).toContain('You sent:');
    expect(content).toContain('please fix subtract');
    expect(content).toContain('search');
  });

  it('a pair that does not match still goes through the matcher and echoes the file', async () => {
    const { ok, content } = await runEdit({
      path: 'math.mjs',
      search: 'export function divide(a, b) {',
      replace: 'export function divide(a, b) {',
    });
    expect(ok).toBe(false);
    expect(content).toContain('did not apply');
    expect(content).toContain('Current contents of math.mjs');
  });
});

// Keep the type import used so the file stays a clean module under lint.
export type { AgentEvent };
