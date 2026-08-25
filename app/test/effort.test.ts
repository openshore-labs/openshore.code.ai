import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFORT,
  EFFORTS,
  activeEffort,
  effortDirective,
  effortLabel,
  setActiveEffort,
} from '../src/lib/effort.js';

describe('effort', () => {
  it('defaults to high', () => {
    expect(DEFAULT_EFFORT).toBe('high');
  });

  it('lists high first so the strong default is the headline', () => {
    expect([...EFFORTS]).toEqual(['high', 'medium', 'low']);
  });

  it('labels each level', () => {
    expect(effortLabel('high')).toBe('High');
    expect(effortLabel('medium')).toBe('Medium');
    expect(effortLabel('low')).toBe('Low');
  });

  it('mirrors the active value the drivers read', () => {
    setActiveEffort('low');
    expect(activeEffort()).toBe('low');
    setActiveEffort('high');
    expect(activeEffort()).toBe('high');
  });

  it('gives each level a distinct directive and never an em dash', () => {
    for (const e of EFFORTS) {
      const d = effortDirective(e);
      expect(d).toContain(effortLabel(e).toLowerCase());
      expect(d).not.toContain('—');
    }
    expect(effortDirective('high')).not.toBe(effortDirective('low'));
  });
});
