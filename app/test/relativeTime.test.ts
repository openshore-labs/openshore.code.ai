// The Chats room's secondary line: recency in a few characters.
import { describe, expect, it } from 'vitest';
import { lineStart, relativeTime } from '../src/screens/ChatsScreen.js';

describe('relativeTime', () => {
  const now = new Date('2026-09-02T18:00:00').getTime();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  // It heads a line (or a " · " part) beside "Yesterday" and "Mon", so a
  // word starts with a capital there too.
  it('reads minutes and hours within the day', () => {
    expect(relativeTime(at(10_000), now)).toBe('Just now');
    expect(relativeTime(at(12 * 60_000), now)).toBe('12m ago');
    expect(relativeTime(at(2 * 3_600_000), now)).toBe('2h ago');
  });

  it('names yesterday, then the weekday, then the date', () => {
    expect(relativeTime(at(26 * 3_600_000), now)).toBe('Yesterday');
    expect(relativeTime(at(3 * 86_400_000), now)).toMatch(/^[A-Z][a-z]{2}$/);
    expect(relativeTime(at(20 * 86_400_000), now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it("capitalizes a locale's lowercase word at the head of a line, and leaves a number", () => {
    expect(lineStart('lun.')).toBe('Lun.');
    expect(lineStart('sept. 1')).toBe('Sept. 1');
    expect(lineStart('Mon')).toBe('Mon');
    expect(lineStart('12m ago')).toBe('12m ago');
    expect(lineStart('')).toBe('');
  });

  it('never throws on a bad date', () => {
    expect(relativeTime('nope', now)).toBe('');
  });
});
