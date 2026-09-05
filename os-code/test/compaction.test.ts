// Context compaction: the cut point never orphans a tool result, and the
// cheap first stage trims text-bridge observations as well as native ones.
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/providers/types.js';
import { compactHistory, trimOldObservations } from '../src/context/compaction.js';

const big = 'x'.repeat(4000);

/** One native tool exchange: the assistant's call and its result. */
function exchange(i: number): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: `c${i}`, name: 'readFile', argsText: '{}', args: {} }],
    },
    { role: 'tool', content: `${big} ${i}`, toolCallId: `c${i}`, name: 'readFile' },
  ];
}

describe('compaction cut point (ENG-6)', () => {
  it('advances past a leading tool result so the tail starts on a user turn', async () => {
    // Index -8 of the non-system messages is a tool message; a user message
    // follows two positions later.
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: `start ${big}` },
      ...exchange(1),
      ...exchange(2),
      ...exchange(3), // the tool result here sits at index -8
      { role: 'assistant', content: 'done with that' },
      { role: 'user', content: 'now the next thing' },
      ...exchange(4),
      ...exchange(5),
      { role: 'assistant', content: 'ok' },
    ];
    const result = await compactHistory(messages, 1000, async () => 'summary');
    expect(result.compacted).toBe(true);
    const rest = result.messages.filter((m) => m.role !== 'system');
    // The summary note, then the kept tail.
    expect(String(rest[0]!.content)).toContain('summary');
    expect(rest[1]!.role).toBe('user');
    expect(String(rest[1]!.content)).toBe('now the next thing');
    // Every tool result in the tail has its tool_use in the tail too.
    const useIds = new Set(rest.flatMap((m) => m.toolCalls?.map((c) => c.id) ?? []));
    for (const m of rest) {
      if (m.role === 'tool') expect(useIds.has(m.toolCallId!)).toBe(true);
    }
  });

  it('never starts the tail on a tool message even when no user turn is near', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: `start ${big}` },
      ...exchange(1),
      ...exchange(2),
      ...exchange(3),
      ...exchange(4),
      ...exchange(5),
      ...exchange(6),
      ...exchange(7),
      { role: 'assistant', content: 'ok' }, // puts a tool result at index -8
    ];
    const result = await compactHistory(messages, 1000, async () => 'summary');
    const rest = result.messages.filter((m) => m.role !== 'system');
    expect(rest.length).toBeGreaterThan(1);
    expect(rest[1]!.role).toBe('assistant');
    const useIds = new Set(rest.flatMap((m) => m.toolCalls?.map((c) => c.id) ?? []));
    for (const m of rest) {
      if (m.role === 'tool') expect(useIds.has(m.toolCallId!)).toBe(true);
    }
  });
});

describe('trimOldObservations (ENG-13)', () => {
  it('trims old text-bridge observations, which ride as user messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: `[readFile result]\n${big}` },
      { role: 'assistant', content: 'read it' },
      { role: 'user', content: `a real question ${big}` },
      ...Array.from({ length: 6 }, (): ChatMessage => ({ role: 'assistant', content: 'recent' })),
    ];
    const out = trimOldObservations(messages);
    expect(String(out[0]!.content).length).toBeLessThan(big.length);
    expect(String(out[0]!.content)).toContain('[readFile result]');
    expect(String(out[0]!.content)).toContain('trimmed');
    // A person's own long message is never trimmed.
    expect(String(out[2]!.content)).toBe(`a real question ${big}`);
  });

  it('still trims old native tool observations', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: big, toolCallId: 'c1', name: 'readFile' },
      ...Array.from({ length: 6 }, (): ChatMessage => ({ role: 'assistant', content: 'recent' })),
    ];
    const out = trimOldObservations(messages);
    expect(String(out[0]!.content)).toContain('trimmed');
  });
});
