// Guided setup chats open with the goal, the numbered plan, and how to know it
// worked, so a person can act on step one immediately. Pin that shape.
import { describe, expect, it } from 'vitest';
import { SETUP_GUIDES, guideOpening } from '../src/lib/setupGuides.js';

describe('setup guides', () => {
  it('every guide has a goal, at least three one-action steps, and a done line', () => {
    for (const g of Object.values(SETUP_GUIDES)) {
      expect(g.goal.length, g.id).toBeGreaterThan(10);
      expect(g.steps.length, g.id).toBeGreaterThanOrEqual(3);
      expect(g.done.length, g.id).toBeGreaterThan(10);
    }
  });

  it('the opening names the goal, numbers every step, and asks for step one', () => {
    for (const g of Object.values(SETUP_GUIDES)) {
      const text = guideOpening(g);
      expect(text).toContain(g.goal);
      g.steps.forEach((_, i) => expect(text).toContain(`${i + 1}. `));
      expect(text).toContain(g.done);
      expect(text).toMatch(/step 1/i);
    }
  });
});
