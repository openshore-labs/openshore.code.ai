import { describe, expect, it } from 'vitest';
import { offersLocalFallback, SWITCH_TO_LOCAL } from '../src/lib/usageFallback.js';

describe('usage fallback', () => {
  it('recognizes an out-of-usage stop by its shared phrase', () => {
    expect(offersLocalFallback(`No more Claude usage on your account right now. ${SWITCH_TO_LOCAL}`)).toBe(
      true,
    );
  });

  it('does not offer local for unrelated stops', () => {
    expect(offersLocalFallback('Stopped.')).toBe(false);
    expect(offersLocalFallback('Claude rejected the API key. Update it under Connections.')).toBe(
      false,
    );
  });
});
