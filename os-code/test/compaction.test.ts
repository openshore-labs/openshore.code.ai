// Context compaction: the cut point never orphans a tool result, and the
// cheap first stage trims text-bridge observations as well as native ones.
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/providers/types.js';
import { compactHistory, trimOldObservations } from '../src/context/compaction.js';
import { withholdLocalOnly } from '../src/harness/vault/privacy.js';

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

describe('the class sets when compaction runs (Vault M4, tech review I2)', () => {
  it('compacts at the given fraction of the window, 0.7 when none is given', async () => {
    // About 660 tokens of history against a 1000-token window, most of it an
    // old tool result the first stage can trim.
    const messages: ChatMessage[] = [
      { role: 'tool', content: 'x'.repeat(2400), toolCallId: 'c1', name: 'readFile' },
      ...Array.from({ length: 6 }, (): ChatMessage => ({ role: 'assistant', content: 'ok' })),
    ];
    expect((await compactHistory(messages, 1000, async () => 's')).compacted).toBe(false);
    expect((await compactHistory(messages, 1000, async () => 's', 0.6)).compacted).toBe(true);
  });

  it('says it compacted only when something was trimmed or folded (C1)', async () => {
    // Over budget, but nothing old to trim and too few turns to fold: the
    // history is as short as it gets, and no summary is asked for.
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(2640) },
      { role: 'assistant', content: 'ok' },
    ];
    let asked = 0;
    const result = await compactHistory(
      messages,
      1000,
      async () => {
        asked += 1;
        return 's';
      },
      0.6,
    );
    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(messages);
    expect(asked).toBe(0);
  });
});

// D5 (privacy review 2026-10-08, engine-routing-1): a summary written from a
// local-only note's text may quote it, so it keeps the mark; a fold of the
// stubbed history carries none, so it is not marked.
describe('the summary keeps the local-only mark', () => {
  const note = 'Dear diary, the secret is 4410.';
  function history(first: ChatMessage): ChatMessage[] {
    return [
      { role: 'system', content: 'sys' },
      { role: 'user', content: `read my journal ${big}` },
      first,
      ...Array.from({ length: 9 }, (_, i): ChatMessage => ({ role: 'user', content: `turn ${i}` })),
    ];
  }
  const summaryOf = async (messages: ChatMessage[]): Promise<ChatMessage> => {
    const result = await compactHistory(messages, 100, async (text) => `summary of: ${text}`);
    expect(result.compacted).toBe(true);
    return result.messages[1]!;
  };

  it('is marked when it folded a message that carries the note', async () => {
    const summary = await summaryOf(
      history({ role: 'assistant', content: `It says ${note}`, localOnly: true }),
    );
    expect(summary.content).toContain(note);
    expect(summary.localOnly).toBe(true);
  });

  it('is not marked when it folded only the stub, or nothing local-only', async () => {
    const stubbed = withholdLocalOnly(
      history({ role: 'assistant', content: `It says ${note}`, localOnly: true }),
    );
    const fromStub = await summaryOf(stubbed);
    expect(fromStub.content).not.toContain(note);
    expect(fromStub.localOnly).toBeUndefined();
    const plain = await summaryOf(history({ role: 'assistant', content: 'nothing private' }));
    expect(plain.localOnly).toBeUndefined();
  });

  it('a failed summary is the plain dropped-turns line, unmarked', async () => {
    const result = await compactHistory(
      history({ role: 'assistant', content: `It says ${note}`, localOnly: true }),
      100,
      async () => {
        throw new Error('offline');
      },
    );
    expect(result.messages[1]!.content).not.toContain(note);
    expect(result.messages[1]!.localOnly).toBeUndefined();
  });
});
