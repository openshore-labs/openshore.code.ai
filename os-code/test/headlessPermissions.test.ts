// The unattended profile's hard line (CTO must-fix for crew routines): a
// configured DEFAULT of allow, not just a rule, must never make shell, push,
// or cloud spend silent on the headless profile. Before this, a user config
// with permissions.defaults.shell: "allow" would have run shell at 3am with
// nobody watching, because the default fell through below the profile check.
import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/core/security/profiles.js';
import { DEFAULT_PERMISSIONS, PermissionEngine } from '../src/core/permissions/index.js';

const LOUD = {
  ...DEFAULT_PERMISSIONS,
  defaults: {
    ...DEFAULT_PERMISSIONS.defaults,
    shell: 'allow' as const,
    push: 'allow' as const,
    'cloud-spend': 'allow' as const,
  },
};

describe('headless profile: configured allows cannot make risky steps silent', () => {
  it('turns an allow default into ask for shell, push, and cloud spend', () => {
    const engine = new PermissionEngine(LOUD, PROFILES.headless);
    expect(engine.decide({ toolName: 'runShell', risk: 'shell', command: 'ls' }).decision).toBe(
      'ask',
    );
    expect(engine.decide({ toolName: 'gitPush', risk: 'push' }).decision).toBe('ask');
    expect(engine.decide({ toolName: 'cloud', risk: 'cloud-spend' }).decision).toBe('ask');
    // Reads and network stay as configured: the routine still reads and searches.
    expect(engine.decide({ toolName: 'readFile', risk: 'read', path: 'a.ts' }).decision).toBe(
      'allow',
    );
  });

  it('turns an allow RULE for push into ask on headless too', () => {
    const engine = new PermissionEngine(
      { ...DEFAULT_PERMISSIONS, rules: [{ tool: 'gitPush', decision: 'allow' }] },
      PROFILES.headless,
    );
    expect(engine.decide({ toolName: 'gitPush', risk: 'push' }).decision).toBe('ask');
  });

  it('leaves the desk profile alone, and keeps push allowed for a phone-attached session', () => {
    const desk = new PermissionEngine(LOUD, PROFILES['local-interactive']);
    expect(desk.decide({ toolName: 'runShell', risk: 'shell', command: 'ls' }).decision).toBe(
      'allow',
    );
    expect(desk.decide({ toolName: 'gitPush', risk: 'push' }).decision).toBe('allow');
    const phone = new PermissionEngine(LOUD, PROFILES['remote-attached']);
    expect(phone.decide({ toolName: 'runShell', risk: 'shell', command: 'ls' }).decision).toBe(
      'ask',
    );
    expect(phone.decide({ toolName: 'cloud', risk: 'cloud-spend' }).decision).toBe('ask');
    expect(phone.decide({ toolName: 'gitPush', risk: 'push' }).decision).toBe('allow');
  });

  it('never lets headless grant a session-wide allow', () => {
    const engine = new PermissionEngine(DEFAULT_PERMISSIONS, PROFILES.headless);
    expect(engine.allowForSession('editFile')).toBe(false);
    expect(engine.addSessionRule({ tool: 'editFile', decision: 'allow' })).toBe(false);
  });
});
