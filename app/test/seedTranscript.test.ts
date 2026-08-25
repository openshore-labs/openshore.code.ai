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

  it('is empty for an empty thread', () => {
    expect(seedFromTranscript([])).toEqual([]);
  });
});
