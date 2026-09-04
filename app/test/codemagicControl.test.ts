// Codemagic Access is the master gate for the model driving builds. These are
// the pure rules the store's approval handler, the phone loop, and the settings
// row all read, pinned here without standing up the store. Modeled on
// terminalControl.test.ts.
import { describe, expect, it } from 'vitest';
import {
  CODEMAGIC_TOOL,
  canControlCodemagic,
  codemagicAccessDenyReason,
  codemagicAccessOn,
  decideCodemagicApproval,
  isCodemagicApproval,
  shouldRunCodemagic,
} from '../src/lib/codemagicControl.js';

const cm = { kind: 'tool' as const, toolName: CODEMAGIC_TOOL };
const shell = { kind: 'tool' as const, toolName: 'runShell' };
const notTool = { kind: 'cloud-spend' as const, toolName: undefined };

describe('codemagicAccessOn: default off', () => {
  it('missing means off', () => {
    expect(codemagicAccessOn(undefined)).toBe(false);
  });
  it('false means off, true means on', () => {
    expect(codemagicAccessOn(false)).toBe(false);
    expect(codemagicAccessOn(true)).toBe(true);
  });
});

describe('isCodemagicApproval: only the codemagic tool', () => {
  it('matches the codemagic tool', () => {
    expect(isCodemagicApproval(cm)).toBe(true);
  });
  it('does not match the shell tool or a non-tool approval', () => {
    expect(isCodemagicApproval(shell)).toBe(false);
    expect(isCodemagicApproval(notTool)).toBe(false);
  });
});

describe('canControlCodemagic', () => {
  it('a personal account always may', () => {
    expect(canControlCodemagic(undefined, false)).toBe(true);
    expect(canControlCodemagic({ type: 'personal' }, false)).toBe(true);
  });
  it('a commercial org gates on admin', () => {
    expect(canControlCodemagic({ type: 'commercial' }, false)).toBe(false);
    expect(canControlCodemagic({ type: 'commercial' }, true)).toBe(true);
  });
});

describe('shouldRunCodemagic', () => {
  it('runs only a permitted, switched-on codemagic call', () => {
    expect(shouldRunCodemagic(cm, { access: true, canControl: true })).toBe(true);
  });
  it('off never runs', () => {
    expect(shouldRunCodemagic(cm, { access: false, canControl: true })).toBe(false);
    expect(shouldRunCodemagic(cm, { access: undefined, canControl: true })).toBe(false);
  });
  it('no permission never runs, even when on', () => {
    expect(shouldRunCodemagic(cm, { access: true, canControl: false })).toBe(false);
  });
  it('a non-codemagic call is never ours to run', () => {
    expect(shouldRunCodemagic(shell, { access: true, canControl: true })).toBe(false);
  });
});

describe('decideCodemagicApproval: the whole gate', () => {
  it('on + permitted auto-approves', () => {
    expect(decideCodemagicApproval(cm, { access: true, canControl: true })).toEqual({
      action: 'auto-approve',
    });
  });
  it('off auto-denies with a reason that points to the switch', () => {
    const d = decideCodemagicApproval(cm, { access: false, canControl: true });
    expect(d?.action).toBe('auto-deny');
    if (d?.action === 'auto-deny') {
      expect(d.reason).toContain('Codemagic Access is off');
      expect(d.reason).toContain('Settings');
    }
  });
  it('no permission auto-denies with the admin wording', () => {
    const d = decideCodemagicApproval(cm, { access: false, canControl: false });
    expect(d?.action).toBe('auto-deny');
    if (d?.action === 'auto-deny') expect(d.reason).toContain('admin');
  });
  it('a non-codemagic request returns undefined so the caller falls through', () => {
    expect(decideCodemagicApproval(shell, { access: true, canControl: true })).toBeUndefined();
    expect(decideCodemagicApproval(notTool, { access: true, canControl: true })).toBeUndefined();
  });
});

describe('codemagicAccessDenyReason', () => {
  it('tells the model to stop and not retry', () => {
    expect(codemagicAccessDenyReason({ canControl: true })).toContain('Do not retry');
  });
  it('admin wording when the person cannot control it', () => {
    expect(codemagicAccessDenyReason({ canControl: false })).toContain('admin');
  });
});
