// Doctor smoke test: with a bare environment it renders every section,
// names the missing links, and exits non-zero because the stack is not set
// up yet. Network probes are mocked to fail fast.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand } from '../src/commands/doctor.js';

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('osc doctor', () => {
  it('renders a complete, actionable report on a bare machine', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    await doctorCommand();

    // Every section renders.
    for (const section of [
      'Config',
      'Hardware',
      'Stack',
      'Cloud',
      'GitHub',
      'Web search',
      'Connectivity',
      'License',
    ]) {
      expect(output).toContain(section);
    }
    // The one missing prerequisite is named with its one-line fix.
    expect(output).toContain('osc init');
    // No stack traces reach the user's face.
    expect(output).not.toContain('    at ');
    // A bare machine is not healthy; the exit code says so.
    expect(process.exitCode).toBe(1);
  });
});
