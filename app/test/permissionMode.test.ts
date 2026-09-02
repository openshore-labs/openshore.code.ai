import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  autoApproves,
  nextPermissionMode,
  normalizePermissionMode,
  permissionModeLabel,
} from '../src/lib/permissionMode.js';

describe('permission mode', () => {
  it('defaults to acceptEdits', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('acceptEdits');
  });

  it('offers the four Claude Code modes', () => {
    expect([...PERMISSION_MODES]).toEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
    expect(permissionModeLabel('default')).toBe('Default');
    expect(permissionModeLabel('acceptEdits')).toBe('Accept edits');
    expect(permissionModeLabel('plan')).toBe('Plan');
    expect(permissionModeLabel('bypassPermissions')).toBe('Bypass');
  });

  it('maps the retired auto mode and unknown values on load', () => {
    expect(normalizePermissionMode('auto')).toBe('bypassPermissions');
    expect(normalizePermissionMode('plan')).toBe('plan');
    expect(normalizePermissionMode(undefined)).toBe(DEFAULT_PERMISSION_MODE);
    expect(normalizePermissionMode('nonsense')).toBe(DEFAULT_PERMISSION_MODE);
  });

  it('cycles in Claude Code order and wraps', () => {
    expect(nextPermissionMode('default')).toBe('acceptEdits');
    expect(nextPermissionMode('acceptEdits')).toBe('plan');
    expect(nextPermissionMode('plan')).toBe('bypassPermissions');
    expect(nextPermissionMode('bypassPermissions')).toBe('default');
  });

  it('auto-approves the right tools per mode, and never cloud spend', () => {
    // Bypass approves any tool.
    expect(autoApproves('bypassPermissions', 'run_shell', 'tool')).toBe(true);
    expect(autoApproves('bypassPermissions', 'edit_file', 'tool')).toBe(true);
    // Accept edits approves only edits.
    expect(autoApproves('acceptEdits', 'edit_file', 'tool')).toBe(true);
    expect(autoApproves('acceptEdits', 'write_file', 'tool')).toBe(true);
    expect(autoApproves('acceptEdits', 'run_shell', 'tool')).toBe(false);
    // Default and plan approve nothing on the client.
    expect(autoApproves('default', 'edit_file', 'tool')).toBe(false);
    expect(autoApproves('plan', 'edit_file', 'tool')).toBe(false);
    // Money always asks, whatever the mode.
    expect(autoApproves('bypassPermissions', 'anything', 'cloud-spend')).toBe(false);
  });
});
