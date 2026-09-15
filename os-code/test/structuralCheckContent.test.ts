// The structural check guards the PROPOSED content, and both write tools use
// it. Until 2026-09-15 the JavaScript branch ran `node --check` on the path,
// which is the file before the edit, so a corrupting edit passed and only the
// next one tripped; the deep eval's 3B seat left greeter.mjs as "(name) {"
// that way (a fragment replaced with nothing), and writeFile had no check at
// all. Now a broken result is refused before it lands, the file on disk is
// untouched, and the message names the syntax error in the real file's name.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import { structuralCheck } from '../src/core/edit/verify.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const GREETER = 'export function greet(name) {\n  return `hello ${name}`;\n}\n';

type ToolEnd = { type: 'tool-end'; result: { ok: boolean; content: string } };
const lastToolEnd = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'tool-end') as unknown as ToolEnd[]).pop()!;

describe('structuralCheck looks at the proposed content', () => {
  it('refuses content that does not parse even though the file on disk does', async () => {
    const provider = new MockProvider('mock', [textTurn('x')]);
    const session = makeTestSession(provider, { files: { 'g.mjs': GREETER } });
    const abs = join(session.cwd, 'g.mjs');
    const bad = structuralCheck(abs, '(name) {\n  return `hello ${name}`;\n}\n');
    expect(bad.ok).toBe(false);
    expect(bad.detail).toMatch(/Syntax check failed/);
    expect(bad.detail).toContain('g.mjs');
    expect(bad.detail).not.toContain('osc-check');
    const good = structuralCheck(abs, GREETER.replace('greet', 'hello'));
    expect(good.ok).toBe(true);
    // No probe file left behind either way.
    expect(readdirSync(session.cwd).filter((f) => f.includes('osc-check'))).toEqual([]);
  });
});

describe('editFile refuses an edit that would break the file', () => {
  it('leaves the file untouched when a fragment is replaced with nothing', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('editFile', { path: 'g.mjs', search: 'export function greet', replace: '' }),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, { files: { 'g.mjs': GREETER } });
    await session.agent.run('rename');
    const end = lastToolEnd(session.events);
    expect(end.result.ok).toBe(false);
    expect(end.result.content).toMatch(/NOT applied because verification failed/);
    expect(readFileSync(join(session.cwd, 'g.mjs'), 'utf8')).toBe(GREETER);
  });
});

describe('writeFile has the same gate', () => {
  it('refuses a JavaScript file that does not parse and keeps the old one', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'g.mjs', content: '(name) {\n  return 1;\n}\n' }),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, { files: { 'g.mjs': GREETER } });
    await session.agent.run('rewrite');
    const end = lastToolEnd(session.events);
    expect(end.result.ok).toBe(false);
    expect(end.result.content).toMatch(/NOT written because verification failed/);
    expect(end.result.content).toContain('The existing file is unchanged.');
    expect(readFileSync(join(session.cwd, 'g.mjs'), 'utf8')).toBe(GREETER);
  });

  it('refuses JSON that does not parse, and still writes valid files', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.json', content: '{"a": ' }, 'c1'),
      toolTurn('writeFile', { path: 'ok.mjs', content: 'export const x = 1;\n' }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('write');
    const ends = session.events.filter((e) => e.type === 'tool-end') as unknown as ToolEnd[];
    expect(ends[0]!.result.ok).toBe(false);
    expect(ends[0]!.result.content).toContain('Nothing was created.');
    expect(ends[1]!.result.ok).toBe(true);
    expect(readFileSync(join(session.cwd, 'ok.mjs'), 'utf8')).toBe('export const x = 1;\n');
  });
});
