import { describe, expect, it } from 'vitest';
import { timeGreeting } from '../src/lib/greeting.js';

describe('timeGreeting', () => {
  it('covers each boundary hour', () => {
    expect(timeGreeting(0)).toBe('Late night');
    expect(timeGreeting(4)).toBe('Late night');
    expect(timeGreeting(5)).toBe('Good morning');
    expect(timeGreeting(11)).toBe('Good morning');
    expect(timeGreeting(12)).toBe('Good afternoon');
    expect(timeGreeting(17)).toBe('Good afternoon');
    expect(timeGreeting(18)).toBe('Good evening');
    expect(timeGreeting(23)).toBe('Good evening');
  });
});
