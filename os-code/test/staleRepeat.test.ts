// An exact repeat of a call, with nothing changed in the workspace since it
// ran, is answered from the record instead of run again, and the third such
// repeat makes the next turn answer-only (no tools), so a model that is stuck
// still produces an answer instead of tripping the repeat rail with nothing.
// The deep eval's 3B seat did exactly this on the answer task: readFile on
// the same file three times, then the rail, final text empty. A repeat after
// a write or a shell command is a fresh question and runs normally.
import { describe, it, expect } from 'vitest';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const SRC = 'export function magic() {\n  return 42;\n}\n';

type ToolEnd = {
  type: 'tool-end';
  call: { name: string };
  result: { ok: boolean; content: string };
};
const toolEnds = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'tool-end') as unknown as ToolEnd[];
const doneReasons = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'task-done') as Array<{ reason: string }>).map((e) => e.reason);
const finalText = (events: AgentEvent[]) => {
  const finals = events.filter((e) => e.type === 'text-final') as Array<{ text: string }>;
  return finals.length ? finals[finals.length - 1]!.text : '';
};

describe('an exact repeated call with nothing changed since', () => {
  it('is not run again, and the third repeat forces an answer-only turn', async () => {
    const read = { path: 'src.mjs' };
    const provider = new MockProvider('mock', [
      toolTurn('readFile', read, 'c1'),
      toolTurn('readFile', read, 'c2'),
      toolTurn('readFile', read, 'c3'),
      textTurn('42'),
    ]);
    const session = makeTestSession(provider, { files: { 'src.mjs': SRC } });
    await session.agent.run('Read src.mjs. Reply with ONLY the number magic() returns.');

    const ends = toolEnds(session.events);
    expect(ends).toHaveLength(3);
    expect(ends[0]!.result.ok).toBe(true);
    expect(ends[1]!.result.ok).toBe(false);
    expect(ends[1]!.result.content).toMatch(/already made this exact readFile call/);
    expect(ends[2]!.result.ok).toBe(false);
    // The fourth request went out with no tools at all, and its text stands as
    // the answer; the repeat rail never had to trip.
    expect(provider.requests).toHaveLength(4);
    expect(provider.requests[3]!.tools).toBeUndefined();
    expect(
      provider.requests[3]!.messages.some(
        (m) => m.role === 'user' && /Reply now with your final answer/.test(String(m.content)),
      ),
    ).toBe(true);
    expect(finalText(session.events)).toBe('42');
    expect(doneReasons(session.events)).toEqual(['complete']);
  });

  it('a tool call written into an answer-only turn is not run; the text is the answer', async () => {
    const read = { path: 'src.mjs' };
    const provider = new MockProvider('mock', [
      toolTurn('readFile', read, 'c1'),
      toolTurn('readFile', read, 'c2'),
      toolTurn('readFile', read, 'c3'),
      toolTurn('readFile', read, 'c4'),
    ]);
    const session = makeTestSession(provider, { files: { 'src.mjs': SRC } });
    await session.agent.run('what does magic return');
    expect(toolEnds(session.events)).toHaveLength(3);
    expect(doneReasons(session.events)).toEqual(['complete']);
  });

  it('runs an identical read again once a write has happened in between', async () => {
    const read = { path: 'a.txt' };
    const provider = new MockProvider('mock', [
      toolTurn('readFile', read, 'c1'),
      toolTurn('writeFile', { path: 'a.txt', content: 'changed\n' }, 'c2'),
      toolTurn('readFile', read, 'c3'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, { files: { 'a.txt': 'before\n' } });
    await session.agent.run('edit a.txt');
    const ends = toolEnds(session.events);
    expect(ends.map((e) => e.result.ok)).toEqual([true, true, true]);
    expect(ends[2]!.result.content).toContain('changed');
    expect(provider.requests[3]!.tools).toBeDefined();
  });

  it('an identical write after itself still runs (it changed the workspace)', async () => {
    const write = { path: 'b.txt', content: 'x\n' };
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', write, 'c1'),
      toolTurn('writeFile', write, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('write b.txt');
    expect(toolEnds(session.events).map((e) => e.result.ok)).toEqual([true, true]);
  });

  it('a repeated failing editFile is answered from the record with the edit advice', async () => {
    const edit = { path: 'a.txt', search: 'not here', replace: 'x' };
    const provider = new MockProvider('mock', [
      toolTurn('editFile', edit, 'c1'),
      toolTurn('editFile', edit, 'c2'),
      textTurn('could not'),
    ]);
    const session = makeTestSession(provider, { files: { 'a.txt': 'before\n' } });
    await session.agent.run('edit a.txt');
    const ends = toolEnds(session.events);
    expect(ends).toHaveLength(2);
    expect(ends[1]!.result.content).toMatch(/copy the exact lines/);
  });
});
