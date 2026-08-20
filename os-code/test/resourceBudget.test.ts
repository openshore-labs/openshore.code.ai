// Resource budget (F2). A small integrated-GPU VRAM carve-out (an AMD APU
// reports 0.5-2 GB) must not mask the CPU/RAM fallback and cap the machine at
// 2 GB models.
import { describe, expect, it } from 'vitest';
import { budgetFor, type Hardware } from '../src/router/resourceBudget.js';

function hw(partial: Partial<Hardware>): Hardware {
  return { gpus: [], totalVramGB: 0, systemRamGB: 0, source: 'none', ...partial };
}

describe('resource budget', () => {
  it('does not let a tiny iGPU VRAM carve-out cap a big machine at 2 GB', () => {
    const budget = budgetFor(hw({ totalVramGB: 1, systemRamGB: 64, source: 'rocm-sysfs' }));
    // Before the fix this fell to the 2 GB floor (1 GB VRAM * 0.75, clamped up
    // to 2). With the RAM fallback it should be far larger.
    expect(budget.maxModelGB).not.toBe(2);
    expect(budget.maxModelGB).toBeGreaterThan(2);
  });

  it('still budgets around a real dedicated GPU', () => {
    const budget = budgetFor(
      hw({
        totalVramGB: 24,
        systemRamGB: 32,
        source: 'nvidia-smi',
        gpus: [{ name: 'RTX 4090', vramGB: 24 }],
      }),
    );
    expect(budget.profile).toBe('fleet');
    expect(budget.maxModelGB).toBeGreaterThan(2);
  });

  it('falls back to system RAM when there is no GPU at all', () => {
    const budget = budgetFor(hw({ totalVramGB: 0, systemRamGB: 64, source: 'none' }));
    expect(budget.maxModelGB).toBeGreaterThan(2);
  });
});
