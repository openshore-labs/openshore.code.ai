import { describe, expect, it } from 'vitest';
import { seedFromTranscript } from '../src/state/types.js';
import type { ThreadItem } from '../src/state/types.js';

describe('seedFromTranscript', () => {
  it('carries only the spoken turns, in order, for a mid-chat model switch', () => {
    const items: ThreadItem[] = [
      { kind: 'user', id: '1', text: 'hello' },
      { kind: 'status', id: '2', text: 'thinking' },
      { kind: 'assistant', id: '3', text: 'hi there', streaming: false },
      { kind: 'tool', id: '4', name: 'read', summary: 'read a file', state: 'ok' },
      { kind: 'user', id: '5', text: 'and again' },
      { kind: 'assistant', id: '6', text: '', streaming: true },
    ];
    expect(seedFromTranscript(items)).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' },
      { role: 'user', text: 'and again' },
    ]);
  });

  it('leaves out a message the ethics layer withheld, and the refusal answering it', () => {
    const items: ThreadItem[] = [
      { kind: 'user', id: '1', text: 'hello' },
      { kind: 'assistant', id: '2', text: 'hi there', streaming: false },
      { kind: 'user', id: '3', text: 'something blocked', withheld: true },
      { kind: 'assistant', id: '4', text: 'This request was not sent.', streaming: false },
      { kind: 'user', id: '5', text: 'answer my previous message' },
    ];
    expect(seedFromTranscript(items)).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' },
      { role: 'user', text: 'answer my previous message' },
    ]);
  });

  it('carries a plan card and a clarify card as what the model said', () => {
    const items: ThreadItem[] = [
      { kind: 'user', id: '1', text: 'build a login screen' },
      {
        kind: 'clarify',
        id: '2',
        summary: 'A couple of things first.',
        questions: [{ id: 'q1', question: 'Email or phone?', options: ['Email', 'Phone'] }],
      },
      { kind: 'user', id: '3', text: 'Email' },
      { kind: 'plan', id: '4', text: '1. Form\n2. Validation', status: 'proposed' },
    ];
    expect(seedFromTranscript(items)).toEqual([
      { role: 'user', text: 'build a login screen' },
      { role: 'assistant', text: 'A couple of things first.\n1. Email or phone? (Email / Phone)' },
      { role: 'user', text: 'Email' },
      { role: 'assistant', text: '1. Form\n2. Validation' },
    ]);
  });

  it('is empty for an empty thread', () => {
    expect(seedFromTranscript([])).toEqual([]);
  });
});
