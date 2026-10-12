// Smarter chat names (2026-10-01): the first message's subject, not
// its first 48 characters. The setup walk's chat is "First-time setup".
import { describe, expect, it } from 'vitest';
import { SETUP_CHAT_TITLE, SETUP_HELP_TITLE, TITLE_MAX, chatTitle } from '../src/lib/chatTitle.js';
import { legacyTitleFrom, titleFrom } from '../src/state/transcript.js';
import { emptyThread } from '../src/state/types.js';

describe('a chat is named by what it is about', () => {
  it('drops the polite lead-in and raises the first letter', () => {
    expect(chatTitle('hey can you please explain how React hooks work?')).toBe(
      'How React hooks work',
    );
    expect(chatTitle('Hi Harbor, I want to build a habit tracker app')).toBe(
      'Build a habit tracker app',
    );
    expect(chatTitle('could you help me fix this failing test')).toBe('Fix this failing test');
    expect(chatTitle('what is the vault')).toBe('What is the vault');
  });

  it('keeps the first sentence and cuts long ones on a word, never a little word', () => {
    expect(
      chatTitle('Refactor the payment module. It has grown too big and the tests are slow.'),
    ).toBe('Refactor the payment module');
    const long = chatTitle(
      'write a migration that renames the users table column created to created_at and backfills it',
    )!;
    expect(long.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(long).toBe('Write a migration that renames the users');
    expect(long).not.toMatch(/\s(?:the|a|to|of)$/);
  });

  it('names the setup chats plainly', () => {
    expect(SETUP_CHAT_TITLE).toBe('First-time setup');
    expect(chatTitle('help me get set up')).toBe(SETUP_HELP_TITLE);
  });

  it('names a bare link by its site, and code by what it is', () => {
    expect(chatTitle('https://www.example.com/docs/page')).toBe('Link from example.com');
    expect(chatTitle('```ts\nconst a = 1\n```')).toBe('Code snippet');
  });

  it('has nothing to say about an empty message', () => {
    expect(chatTitle('   ')).toBeUndefined();
  });

  it('is what a new chat is called, and knows the old cut for the launch tidy', () => {
    const text = 'hey can you please explain how React hooks work in a function component';
    const thread = { ...emptyThread(), items: [{ kind: 'user' as const, id: 'u', text }] };
    expect(titleFrom(thread)).toBe('How React hooks work in a function');
    expect(legacyTitleFrom(thread)).toBe(text.slice(0, 48));
  });
});
