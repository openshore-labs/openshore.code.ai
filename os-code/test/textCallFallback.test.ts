// A small local model offered native tools often writes its tool call as JSON
// text anyway (ollama hands it back as message content, not tool_calls). The
// loop used to read that JSON as a final answer in native mode and mark the
// task complete with nothing run: the deep eval's "1 turn; no tools called;
// done: complete" on qwen2.5-coder:3b, on the reference box. Now native mode
// falls back to text extraction when no native call arrived, records that turn
// the text way, and runs the tool. Prose that merely quotes JSON stays prose.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const toolEnds = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'tool-end') as Array<{
    call: { name: string };
    result: { ok: boolean };
  }>;
const doneReasons = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'task-done') as Array<{ reason: string }>).map((e) => e.reason);
const finalTexts = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'text-final') as Array<{ text: string }>).map((e) => e.text);

describe('native mode falls back to text tool calls', () => {
  it('runs a tool the model wrote as JSON text (the 3B failure), then finishes', async () => {
    // The mock is native-capable (supportsTools true, native adapter), yet the
    // "model" writes the call as fenced JSON, exactly as the 3B did.
    const provider = new MockProvider('mock', [
      textTurn(
        '```json\n{"name": "writeFile", "arguments": {"path": "note.txt", "content": "hello"}}\n```',
      ),
      textTurn('Wrote the note.'),
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('write a note');

    const ends = toolEnds(session.events);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.call.name).toBe('writeFile');
    expect(ends[0]!.result.ok).toBe(true);
    expect(readFileSync(join(session.cwd, 'note.txt'), 'utf8')).toBe('hello');
    expect(doneReasons(session.events)).toEqual(['complete']);
    // A second turn happened, and the observation went back the text way, as
    // a "[writeFile result]" user message, never as a fabricated tool_use.
    expect(provider.requests).toHaveLength(2);
    const second = provider.requests[1]!;
    const observation = second.messages.find(
      (m) => m.role === 'user' && String(m.content).includes('[writeFile result]'),
    );
    expect(observation).toBeDefined();
    expect(second.messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('reads a file the model asked for as text JSON, then answers from it', async () => {
    // The answer-from-code shape: the model reads, then answers in prose.
    const provider = new MockProvider('mock', [
      textTurn('{"name": "readFile", "arguments": {"path": "src.mjs"}}'),
      textTurn('42'),
    ]);
    const session = makeTestSession(provider, {
      files: { 'src.mjs': 'export function magic() { return 42; }\n' },
    });
    await session.agent.run('what does magic() return?');
    const ends = toolEnds(session.events);
    expect(ends.map((e) => e.call.name)).toEqual(['readFile']);
    expect(ends[0]!.result.ok).toBe(true);
    expect(finalTexts(session.events).at(-1)).toBe('42');
    expect(doneReasons(session.events)).toEqual(['complete']);
  });

  it('leaves a prose answer that merely quotes JSON alone', async () => {
    const answer =
      'Your package.json declares {"name": "my-app", "version": "1.0.0"}; nothing to change.';
    const provider = new MockProvider('mock', [textTurn(answer)]);
    const session = makeTestSession(provider);
    await session.agent.run('check the manifest');
    expect(toolEnds(session.events)).toHaveLength(0);
    expect(provider.requests).toHaveLength(1);
    expect(finalTexts(session.events).at(-1)).toContain('nothing to change');
    expect(doneReasons(session.events)).toEqual(['complete']);
    expect(existsSync(join(session.cwd, 'my-app'))).toBe(false);
  });

  it('a call to an unknown tool written as text is repaired, not silently completed', async () => {
    const provider = new MockProvider('mock', [
      textTurn('{"name": "makeCoffee", "arguments": {"size": "large"}}'),
      textTurn('Understood; there is no such tool. Done.'),
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('do the thing');
    // The first turn was a malformed call, so the model was asked to fix it and
    // a second turn ran; nothing was executed.
    expect(provider.requests).toHaveLength(2);
    expect(toolEnds(session.events)).toHaveLength(0);
    const repair = provider.requests[1]!.messages.find(
      (m) => m.role === 'user' && /no tool named "makeCoffee"/.test(String(m.content)),
    );
    expect(repair).toBeDefined();
    expect(doneReasons(session.events)).toEqual(['complete']);
  });
});
