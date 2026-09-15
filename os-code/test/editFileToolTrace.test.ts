// editFile echoes the file's own current content on a failed SEARCH match, so
// a small model that mis-transcribed whitespace can fix it on the very next
// turn instead of resending an identical, non-matching guess. This is what the
// reference box's 3B deep-eval run hit: editFile called four times with
// IDENTICAL arguments, tripping the loop guardrail, because the failure
// observation only carried a hint, never the ground truth to copy from.
import { describe, it, expect } from 'vitest';
import { MockProvider, toolTurn, textTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { ChatMessage } from '../src/providers/types.js';

function observationContaining(messages: ChatMessage[], marker: string): string | undefined {
  const m = messages.find((msg) => String(msg.content).includes(marker));
  return m ? String(m.content) : undefined;
}

const GREET_FILE = 'function greet(name) {\n  console.log("hey " + name);\n}\n';

describe('editFile echoes ground truth on a failed match', () => {
  it('includes the current file content when the SEARCH text is not found', async () => {
    // A single, wrong line: too short for the anchored-fuzzy strategy (it
    // needs 3+ lines), so this genuinely fails to locate, the case a small
    // model hits when its transcription of the line itself is wrong.
    const provider = new MockProvider('mock', [
      toolTurn('editFile', {
        path: 'greet.mjs',
        edits:
          '<<<<<<< SEARCH\nconsole.log("hi " + name);\n=======\nconsole.log("hello " + name);\n>>>>>>> REPLACE',
      }),
      textTurn('Fixed it.'),
    ]);
    const session = makeTestSession(provider, { files: { 'greet.mjs': GREET_FILE } });
    await session.agent.run('fix the greeting');

    const second = provider.requests[1]!;
    const observation = observationContaining(second.messages, 'The edit did not apply');
    expect(observation).toBeDefined();
    expect(observation).toContain('Current contents of greet.mjs');
    expect(observation).toContain('console.log("hey " + name);');
  });

  it('does not echo a file over the size cap, and says to read it instead', async () => {
    const big = 'x'.repeat(5000);
    const provider = new MockProvider('mock', [
      toolTurn('editFile', {
        path: 'big.txt',
        edits: '<<<<<<< SEARCH\nnope, not in the file\n=======\nyep\n>>>>>>> REPLACE',
      }),
      textTurn('Could not find it.'),
    ]);
    const session = makeTestSession(provider, { files: { 'big.txt': big } });
    await session.agent.run('edit the big file');

    const second = provider.requests[1]!;
    const observation = observationContaining(second.messages, 'The edit did not apply');
    expect(observation).toBeDefined();
    expect(observation).not.toContain('Current contents of big.txt');
    expect(observation).toContain('too large to show here');
    expect(observation).toContain('Call readFile');
  });

  it('echoes what the model sent when no change is recognizable at all', async () => {
    // The 3B's actual failure: an edits string with no marker in it. The old
    // message only restated the format; now it shows the model its own input
    // and leads with the simple search/replace form.
    const provider = new MockProvider('mock', [
      toolTurn('editFile', { path: 'greet.mjs', edits: 'return a - b;' }),
      textTurn('Hmm.'),
    ]);
    const session = makeTestSession(provider, { files: { 'greet.mjs': GREET_FILE } });
    await session.agent.run('fix it');
    const second = provider.requests[1]!;
    const observation = observationContaining(second.messages, 'No valid edit found');
    expect(observation).toBeDefined();
    expect(observation).toContain('You sent:');
    expect(observation).toContain('return a - b;');
    expect(observation).toContain('give search');
  });

  it('gives a specific redirect when SEARCH is left blank', async () => {
    // The deep eval's add-a-function task: the model wanted to APPEND code
    // and left search blank instead of anchoring on an existing line. Routing
    // this through the matcher produced "Your SEARCH was:" followed by
    // nothing; the tool now catches it before that and shows the replace text
    // it did send, so the retry has something concrete to anchor on.
    const provider = new MockProvider('mock', [
      toolTurn('editFile', {
        path: 'greet.mjs',
        search: '',
        replace: 'function greet2(name) {\n  console.log("hey again " + name);\n}\n',
      }),
      textTurn('Oops.'),
    ]);
    const session = makeTestSession(provider, { files: { 'greet.mjs': GREET_FILE } });
    await session.agent.run('add a second greeting function');
    const second = provider.requests[1]!;
    const observation = observationContaining(second.messages, 'no SEARCH text');
    expect(observation).toBeDefined();
    expect(observation).toContain('Current contents of greet.mjs');
    // The harness names the anchor (the file's last line) and hands back the
    // exact two fields to send, built from the model's own replacement text.
    expect(observation).toContain('send editFile again with exactly these two fields');
    expect(observation).toContain('search: "}"');
    expect(observation).toContain('replace: "}\\n\\nfunction greet2(name)');
    expect(observation).toContain('Or use writeFile');
  });

  it('a successful edit is unaffected: no echoed content, just the applied summary', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('editFile', {
        path: 'greet.mjs',
        edits:
          '<<<<<<< SEARCH\nconsole.log("hey " + name);\n=======\nconsole.log("hello " + name);\n>>>>>>> REPLACE',
      }),
      textTurn('Done.'),
    ]);
    const session = makeTestSession(provider, { files: { 'greet.mjs': GREET_FILE } });
    await session.agent.run('fix it');

    const ends = session.events.filter((e) => e.type === 'tool-end') as Array<{
      result: { ok: boolean; content: string };
    }>;
    expect(ends).toHaveLength(1);
    expect(ends[0]!.result.ok).toBe(true);
    expect(ends[0]!.result.content).toContain('Applied 1 edit');
    expect(ends[0]!.result.content).not.toContain('Current contents of');
  });
});
