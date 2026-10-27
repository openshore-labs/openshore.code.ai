import { describe, expect, it } from 'vitest';
import { chatReach, matchChat } from '../src/screens/ChatsScreen.js';
import { inChatScope } from '../src/lib/chatScope.js';
import type { Conversation, ThreadItem } from '../src/state/types.js';

function conv(
  title: string,
  items: ThreadItem[] = [],
  source: Conversation['source'] = { kind: 'stack' },
  model?: { name: string; kind: 'local' | 'cloud' },
): Conversation {
  return {
    id: 'c1',
    title,
    source,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    thread: { items, model } as unknown as Conversation['thread'],
  };
}

const user = (text: string): ThreadItem => ({ kind: 'user', id: 'u', text });
const reply = (text: string): ThreadItem => ({
  kind: 'assistant',
  id: 'a',
  text,
  streaming: false,
});

// The Chats room's search reads names first, then inside the conversation.
describe('matchChat', () => {
  it('matches every chat on an empty query', () => {
    expect(matchChat(conv('Anything'), '  ')).toEqual({ where: 'title' });
  });

  it('prefers a title hit, case-insensitively', () => {
    expect(matchChat(conv('Seahawks game timing', [user('seahawks')]), 'SEAHAWKS')).toEqual({
      where: 'title',
    });
  });

  it('finds a hit inside the conversation and keeps the original case', () => {
    const m = matchChat(
      conv('Rundown', [user('When is kickoff?'), reply('Kickoff is at 1:25 PM.')]),
      'kickoff',
    );
    expect(m).toEqual({ where: 'body', before: '', hit: 'Kickoff', after: ' is at 1:25 PM.' });
  });

  it('trims a long line around the hit, with ellipses where it was cut', () => {
    const long = `${'a '.repeat(60)}needle${' b'.repeat(80)}`;
    const m = matchChat(conv('x', [user(long)]), 'needle');
    expect(m?.where).toBe('body');
    if (m?.where !== 'body') return;
    expect(m.before.startsWith('…')).toBe(true);
    expect(m.after.endsWith('…')).toBe(true);
    expect(m.hit).toBe('needle');
  });

  it('drops markdown marks and collapses whitespace in the snippet', () => {
    const m = matchChat(conv('x', [reply('**Bold**\n\n  `code` here')]), 'code here');
    expect(m).toEqual({ where: 'body', before: 'Bold ', hit: 'code here', after: '' });
  });

  it('returns null when nothing matches', () => {
    expect(matchChat(conv('Harbor Lite', [user('hello')]), 'deploy')).toBeNull();
  });
});

// The reach dot is honest: it shows only what is known.
describe('chatReach', () => {
  it('reads the last served model first', () => {
    expect(chatReach(conv('x', [], { kind: 'stack' }, { name: 'Qwen', kind: 'local' }))).toBe(
      'local',
    );
    expect(chatReach(conv('x', [], { kind: 'stack' }, { name: 'Claude', kind: 'cloud' }))).toBe(
      'cloud',
    );
  });

  it('falls back to the source kind', () => {
    expect(chatReach(conv('x', [], { kind: 'cloud', provider: 'anthropic', model: 'm' }))).toBe(
      'cloud',
    );
    expect(chatReach(conv('x', [], { kind: 'device', modelId: 'm', modelName: 'M' }))).toBe(
      'local',
    );
    expect(chatReach(conv('x', [], { kind: 'desktop-chat' }))).toBe('local');
  });

  it('leaves a Stack or engine chat with no turn yet unknown (a ring, not a guess)', () => {
    expect(chatReach(conv('x', [], { kind: 'stack' }))).toBeUndefined();
    expect(chatReach(conv('x', [], { kind: 'desktop' }))).toBeUndefined();
  });
});

// The Chats room and Recents share one reach: the active project's chats,
// plus the chats a deleted project left behind, which belong to no project.
describe('inChatScope', () => {
  // Founder, 2026-10-27: no active project, so Chats and Recents list every chat.
  it('keeps every chat in scope, in a project or not', () => {
    expect(inChatScope({ ...conv('x'), unfiled: true })).toBe(true);
    expect(inChatScope({ ...conv('x'), projectId: 'p2' })).toBe(true);
    expect(inChatScope(conv('x'))).toBe(true);
  });
});
