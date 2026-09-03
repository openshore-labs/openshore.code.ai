// The Chats room's secondary line: recency in a few characters.
import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/screens/ChatsScreen.js';

describe('relativeTime', () => {
  const now = new Date('2026-09-02T18:00:00').getTime();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('reads minutes and hours within the day', () => {
    expect(relativeTime(at(10_000), now)).toBe('just now');
    expect(relativeTime(at(12 * 60_000), now)).toBe('12m ago');
    expect(relativeTime(at(2 * 3_600_000), now)).toBe('2h ago');
  });

  it('names yesterday, then the weekday, then the date', () => {
    expect(relativeTime(at(26 * 3_600_000), now)).toBe('Yesterday');
    expect(relativeTime(at(3 * 86_400_000), now)).toMatch(/^[A-Z][a-z]{2}$/);
    expect(relativeTime(at(20 * 86_400_000), now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('never throws on a bad date', () => {
    expect(relativeTime('nope', now)).toBe('');
  });
});
