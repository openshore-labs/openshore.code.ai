import { describe, expect, it } from 'vitest';
import { versionIsNewer } from '../electron/updateVersion.js';

describe('versionIsNewer', () => {
  it('compares numerically, not lexically', () => {
    expect(versionIsNewer('0.1.10', '0.1.9')).toBe(true);
    expect(versionIsNewer('0.1.9', '0.1.10')).toBe(false);
  });

  it('is false for an equal version', () => {
    expect(versionIsNewer('0.1.1', '0.1.1')).toBe(false);
  });

  it('is false for an older version', () => {
    expect(versionIsNewer('0.1.0', '0.1.1')).toBe(false);
  });

  it('treats a missing trailing segment as 0', () => {
    expect(versionIsNewer('1.2', '1.2.0')).toBe(false);
    expect(versionIsNewer('1.2.1', '1.2')).toBe(true);
  });

  it('weighs the leftmost differing segment first', () => {
    expect(versionIsNewer('1.0.0', '0.99.99')).toBe(true);
  });
});
