// Terminal Control rules. The load-bearing contract: Off by default, scoped per
// target so an On state never travels from one machine to another, and it gates
// exactly one tool (runShell) and nothing else.
import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from 'os-code/protocol';
import {
  LOCAL_TARGET,
  canControlTerminal,
  decideApproval,
  isShellApproval,
  shouldAutoRunShell,
  terminalControlDenyReason,
  terminalControlOn,
  terminalTargetId,
  terminalTargetLabel,
} from '../src/lib/terminalControl.js';

const write = (): Pick<ApprovalRequest, 'kind' | 'toolName'> => ({
  kind: 'tool',
  toolName: 'vaultWrite',
});

const shell = (): Pick<ApprovalRequest, 'kind' | 'toolName'> => ({
  kind: 'tool',
  toolName: 'runShell',
});
const edit = (): Pick<ApprovalRequest, 'kind' | 'toolName'> => ({
  kind: 'tool',
  toolName: 'editFile',
});
const spend = (): Pick<ApprovalRequest, 'kind' | 'toolName'> => ({
  kind: 'cloud-spend',
  toolName: 'cloud',
});

describe('target identity', () => {
  it('is the fixed local key when this app is the engine', () => {
    expect(terminalTargetId({ desktopLocal: true, daemon: { baseUrl: 'http://x' } })).toBe(
      LOCAL_TARGET,
    );
  });
  it('is the hub base URL when attached over the tailnet', () => {
    expect(
      terminalTargetId({ desktopLocal: false, daemon: { baseUrl: 'http://100.1.2.3:4816' } }),
    ).toBe('http://100.1.2.3:4816');
  });
  it('is undefined when nothing is reachable', () => {
    expect(terminalTargetId({ desktopLocal: false })).toBeUndefined();
  });
  it('labels the local engine and a hub distinctly', () => {
    expect(terminalTargetLabel({ desktopLocal: true })).toBe('This computer');
    expect(
      terminalTargetLabel({ desktopLocal: false, daemon: { baseUrl: 'http://100.1.2.3:4816' } }),
    ).toBe('100.1.2.3');
  });
});

describe('default off and per target isolation', () => {
  it('reads Off with no stored state', () => {
    expect(terminalControlOn(undefined, LOCAL_TARGET)).toBe(false);
    expect(terminalControlOn({}, LOCAL_TARGET)).toBe(false);
  });
  it('reads Off for an undefined target even when other targets are On', () => {
    expect(terminalControlOn({ [LOCAL_TARGET]: true }, undefined)).toBe(false);
  });
  it('does not let On at one target leak to another', () => {
    const map = { [LOCAL_TARGET]: true };
    expect(terminalControlOn(map, LOCAL_TARGET)).toBe(true);
    expect(terminalControlOn(map, 'http://100.1.2.3:4816')).toBe(false);
  });
});

describe('it gates only the shell tool', () => {
  it('recognizes a runShell tool call', () => {
    expect(isShellApproval(shell())).toBe(true);
  });
  it('ignores edits and cloud spend', () => {
    expect(isShellApproval(edit())).toBe(false);
    expect(isShellApproval(spend())).toBe(false);
  });
});

describe('who may control the terminal', () => {
  it('lets a personal account control its own box', () => {
    expect(canControlTerminal({ type: 'personal' }, false)).toBe(true);
    expect(canControlTerminal(undefined, false)).toBe(true);
  });
  it('lets a commercial org admin control it', () => {
    expect(canControlTerminal({ type: 'commercial' }, true)).toBe(true);
  });
  it('refuses a commercial org member', () => {
    expect(canControlTerminal({ type: 'commercial' }, false)).toBe(false);
  });
});

describe('the auto run decision', () => {
  const on = { [LOCAL_TARGET]: true };
  it('auto runs a shell call only when On for a controllable target', () => {
    expect(
      shouldAutoRunShell(shell(), { targetId: LOCAL_TARGET, control: on, canControl: true }),
    ).toBe(true);
  });
  it('never auto runs when Off (the manual default)', () => {
    expect(
      shouldAutoRunShell(shell(), { targetId: LOCAL_TARGET, control: {}, canControl: true }),
    ).toBe(false);
  });
  it('never auto runs for someone not permitted, even with On stored', () => {
    expect(
      shouldAutoRunShell(shell(), { targetId: LOCAL_TARGET, control: on, canControl: false }),
    ).toBe(false);
  });
  it('never auto runs a non shell tool', () => {
    expect(
      shouldAutoRunShell(edit(), { targetId: LOCAL_TARGET, control: on, canControl: true }),
    ).toBe(false);
    expect(
      shouldAutoRunShell(spend(), { targetId: LOCAL_TARGET, control: on, canControl: true }),
    ).toBe(false);
  });
  it('never auto runs when the On state belongs to a different target', () => {
    expect(
      shouldAutoRunShell(shell(), {
        targetId: 'http://100.1.2.3:4816',
        control: on,
        canControl: true,
      }),
    ).toBe(false);
  });
});

describe('the store assembly (decideApproval)', () => {
  const base = {
    driverKind: 'desktop',
    desktopLocal: true,
    daemon: undefined,
    canControl: true,
    mode: 'acceptEdits' as const,
  };

  it('auto-approves a desktop shell call when On for the local engine', () => {
    expect(decideApproval(shell(), { ...base, control: { [LOCAL_TARGET]: true } })).toEqual({
      action: 'auto-approve',
    });
  });

  it('auto-denies with a reason when Off (the strict default)', () => {
    const d = decideApproval(shell(), { ...base, control: {} });
    expect(d.action).toBe('auto-deny');
    if (d.action === 'auto-deny') expect(d.reason).toContain('Terminal Control is off');
  });

  it('auto-denies a commercial member even with On stored, and tells them it is admin only', () => {
    const d = decideApproval(shell(), {
      ...base,
      canControl: false,
      control: { [LOCAL_TARGET]: true },
    });
    expect(d.action).toBe('auto-deny');
    if (d.action === 'auto-deny') expect(d.reason).toContain('admin');
  });

  it('keys On to the remote hub when the desktop runs on one, not the local engine', () => {
    const daemon = { baseUrl: 'http://100.1.2.3:4816' };
    expect(
      decideApproval(shell(), {
        ...base,
        desktopLocal: false,
        daemon,
        control: { [daemon.baseUrl]: true },
      }),
    ).toEqual({ action: 'auto-approve' });
    expect(
      decideApproval(shell(), {
        ...base,
        desktopLocal: false,
        daemon,
        control: { [LOCAL_TARGET]: true },
      }).action,
    ).toBe('auto-deny');
  });

  it('NEVER client-auto-approves a desktop non-shell tool, even an always-ask one under acceptEdits', () => {
    // The regression guard: vaultWrite is always-ask; the engine asked, so the
    // sheet must stand. It must not be swept up by the client mode rules.
    expect(decideApproval(write(), { ...base, control: { [LOCAL_TARGET]: true } })).toEqual({
      action: 'sheet',
    });
    expect(decideApproval(write(), { ...base, mode: 'bypassPermissions', control: {} })).toEqual({
      action: 'sheet',
    });
  });

  it('shows the sheet for a desktop cloud-spend ask', () => {
    expect(decideApproval(spend(), { ...base, control: { [LOCAL_TARGET]: true } })).toEqual({
      action: 'sheet',
    });
  });

  it('lets the mode auto-approve a client-brain edit, but not a client-brain shell', () => {
    // Client brains run their tools in the app, so the mode decides. acceptEdits
    // covers an edit; shell still asks.
    expect(
      decideApproval(write(), {
        driverKind: 'device',
        desktopLocal: true,
        daemon: undefined,
        canControl: true,
        control: {},
        mode: 'acceptEdits',
      }),
    ).toEqual({ action: 'auto-approve' });
    expect(
      decideApproval(shell(), {
        driverKind: 'device',
        desktopLocal: true,
        daemon: undefined,
        canControl: true,
        control: { [LOCAL_TARGET]: true },
        mode: 'acceptEdits',
      }),
    ).toEqual({ action: 'sheet' });
  });
});

describe('the deny reason', () => {
  it('points a permitted person at the Settings toggle', () => {
    expect(terminalControlDenyReason({ label: 'my-hub', canControl: true })).toContain('Settings');
  });
  it('points a member at an admin', () => {
    expect(terminalControlDenyReason({ label: 'my-hub', canControl: false })).toContain('admin');
  });
});
