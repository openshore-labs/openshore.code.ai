// When every repair attempt at a malformed tool call is exhausted with no
// escalation available, the loop used to give up with one generic sentence:
// "The model kept producing tool calls that could not be parsed." The deep
// eval's 3B run hit exactly this on the add-function task ("no tools called;
// done: error"), and the generic sentence gave no way to tell what the model
// actually sent without a second run under a debugger. The last turn's own
// problem (the real, specific cause: an unknown tool, a schema mismatch) now
// rides along in the same message, which is also what the eval's trace prints.
import { describe, it, expect } from 'vitest';
import { MockProvider, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';

// Names a real tool but fails its schema (path must be a string): a schema
// mismatch, not an unknown call, and the shape that repeats verbatim so
// repair never recovers.
const BAD_CALL = '{"tool": "editFile", "args": {"path": 123}}';

describe('an exhausted malformed-call repair carries the actual reason', () => {
  it('names the schema problem instead of a generic sentence', async () => {
    const provider = new MockProvider('mock', [
      textTurn(BAD_CALL),
      textTurn(BAD_CALL),
      textTurn(BAD_CALL),
    ]);
    const session = makeTestSession(provider);
    await session.agent.run('fix the file');
    const done = session.events.find((e) => e.type === 'task-done') as
      { reason: string; message?: string } | undefined;
    expect(done?.reason).toBe('error');
    expect(done?.message).toContain('editFile');
    expect(done?.message).toMatch(/did not match its schema/);
    expect(done?.message).toContain('kept producing tool calls that could not be parsed');
  });
});
