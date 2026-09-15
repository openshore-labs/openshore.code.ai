// A lean seat (tiny or small class) that answers with a code block but changes
// no file is nudged once to make the change, then the task continues. The deep
// eval's 3B run produced exactly this on the create task: "1 turn; no tools
// called; done: complete", the code written into the reply instead of the
// file. A plain answer, a full seat, plan mode, and a second occurrence in
// the same task are all left alone.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';

const LEAN = { harness: { profiles: { enabled: true } } };
const CODE_ANSWER =
  'Here is the function:\n```js\nexport function shout(s) { return s.toUpperCase() + "!"; }\n```';

const doneReasons = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'task-done') as Array<{ reason: string }>).map((e) => e.reason);
const nudges = (events: AgentEvent[]) =>
  (events.filter((e) => e.type === 'status') as Array<{ message: string }>).filter((e) =>
    /changed no file/.test(e.message),
  );

describe('a lean seat that answers with code but changes nothing is nudged once', () => {
  it('nudges, then the seat makes the change and the task completes', async () => {
    const provider = new MockProvider('mock', [
      textTurn(CODE_ANSWER),
      toolTurn('writeFile', { path: 'strings.mjs', content: 'export function shout(s) {}\n' }),
      textTurn('Added shout.'),
    ]);
    const session = makeTestSession(provider, { configOverrides: LEAN });
    await session.agent.run('add a shout function to strings.mjs');
    expect(nudges(session.events)).toHaveLength(1);
    expect(existsSync(join(session.cwd, 'strings.mjs'))).toBe(true);
    expect(doneReasons(session.events)).toEqual(['complete']);
    // The nudge reached the model as a user turn before its second reply.
    const second = provider.requests[1]!;
    expect(
      second.messages.some((m) => m.role === 'user' && /changed no file/.test(String(m.content))),
    ).toBe(true);
  });

  it('nudges only once: a second code-only answer completes the task', async () => {
    const provider = new MockProvider('mock', [textTurn(CODE_ANSWER), textTurn(CODE_ANSWER)]);
    const session = makeTestSession(provider, { configOverrides: LEAN });
    await session.agent.run('add a shout function');
    expect(nudges(session.events)).toHaveLength(1);
    expect(provider.requests).toHaveLength(2);
    expect(doneReasons(session.events)).toEqual(['complete']);
  });

  it('leaves a plain answer with no code block alone', async () => {
    const provider = new MockProvider('mock', [textTurn('42')]);
    const session = makeTestSession(provider, { configOverrides: LEAN });
    await session.agent.run('what does magic() return?');
    expect(nudges(session.events)).toHaveLength(0);
    expect(provider.requests).toHaveLength(1);
  });

  it('does not nudge a full seat (profiles off)', async () => {
    const provider = new MockProvider('mock', [textTurn(CODE_ANSWER)]);
    const session = makeTestSession(provider, {
      configOverrides: { harness: { profiles: { enabled: false } } },
    });
    await session.agent.run('add a shout function');
    expect(nudges(session.events)).toHaveLength(0);
    expect(provider.requests).toHaveLength(1);
  });

  it('does not nudge when a write already landed', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'a.txt', content: 'x' }),
      textTurn('Done:\n```\nx\n```'),
    ]);
    const session = makeTestSession(provider, { configOverrides: LEAN });
    await session.agent.run('write a.txt');
    expect(nudges(session.events)).toHaveLength(0);
    expect(doneReasons(session.events)).toEqual(['complete']);
  });
});
