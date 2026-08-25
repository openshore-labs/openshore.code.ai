import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  autoApproves,
  permissionModeLabel,
} from '../src/lib/permissionMode.js';

describe('permission mode', () => {
  it('defaults to acceptEdits', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('acceptEdits');
  });

  it('offers the three Claude Code modes', () => {
    expect([...PERMISSION_MODES]).toEqual(['auto', 'acceptEdits', 'plan']);
    expect(permissionModeLabel('auto')).toBe('Auto');
    expect(permissionModeLabel('acceptEdits')).toBe('Accept edits');
    expect(permissionModeLabel('plan')).toBe('Plan');
  });

  it('auto-approves the right tools per mode, and never cloud spend', () => {
    // Auto approves any tool.
    expect(autoApproves('auto', 'run_shell', 'tool')).toBe(true);
    expect(autoApproves('auto', 'edit_file', 'tool')).toBe(true);
    // Accept edits approves only edits.
    expect(autoApproves('acceptEdits', 'edit_file', 'tool')).toBe(true);
    expect(autoApproves('acceptEdits', 'write_file', 'tool')).toBe(true);
    expect(autoApproves('acceptEdits', 'run_shell', 'tool')).toBe(false);
    // Plan approves nothing.
    expect(autoApproves('plan', 'edit_file', 'tool')).toBe(false);
    // Money always asks, whatever the mode.
    expect(autoApproves('auto', 'anything', 'cloud-spend')).toBe(false);
  });
});
